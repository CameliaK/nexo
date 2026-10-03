'use strict';
// Waits for n8n to be ready, logs in as owner, patches workflow nodes from JSON
// files (source of truth), then activates all workflows via the REST API.
//
// Why PATCH nodes explicitly instead of relying on import:workflow?
//   - n8n import:workflow always imports as inactive AND clears webhook_entity
//   - When the DB versionId differs from the file, import silently skips updating node code
//   - The REST PATCH /rest/workflows/:id with full node list always overwrites node code
//   - A second PATCH {active:true} then registers webhook handlers in n8n memory
const fs = require('fs');
const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  process.stdout.write('Waiting for n8n to be ready...\n');
  for (let i = 0; i < 60; i++) {
    try {
      const res = await request({ hostname: 'localhost', port: 5678, path: '/rest/settings', method: 'GET' });
      if (res.statusCode === 200) {
        process.stdout.write('n8n is ready\n');
        break;
      }
    } catch (_) {}
    if (i === 59) {
      process.stderr.write('n8n did not start within 120s\n');
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const ownerPassword = process.env.N8N_OWNER_PASSWORD || 'N3x0Dev2026!';
  const loginBody = JSON.stringify({ emailOrLdapLoginId: 'owner@nexo.local', password: ownerPassword });
  const loginRes = await request({
    hostname: 'localhost', port: 5678, path: '/rest/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
  }, loginBody);

  if (loginRes.statusCode !== 200) {
    process.stderr.write('Login failed (' + loginRes.statusCode + '): ' + loginRes.body + '\n');
    process.exit(1);
  }
  const cookie = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // 1. Patch node content from JSON files (source of truth)
  const workflowDir = '/workflows';
  let jsonFiles = [];
  try { jsonFiles = fs.readdirSync(workflowDir).filter(f => f.endsWith('.json')); } catch (_) {}

  for (const file of jsonFiles) {
    const wfJson = JSON.parse(fs.readFileSync(workflowDir + '/' + file, 'utf8'));
    const wfId = wfJson.id;
    if (!wfId) continue;

    // Get current workflow to obtain the live versionId
    const getRes = await request({
      hostname: 'localhost', port: 5678, path: '/rest/workflows/' + wfId, method: 'GET',
      headers: { Cookie: cookie },
    });
    if (getRes.statusCode !== 200) {
      process.stdout.write('Workflow ' + wfId + ' not found in DB (import may have failed), skipping patch\n');
      continue;
    }
    const current = JSON.parse(getRes.body);
    const versionId = (current.data || current).versionId;

    const patchPayload = {
      name: wfJson.name,
      versionId,
      nodes: wfJson.nodes,
      connections: wfJson.connections,
      settings: wfJson.settings || { executionOrder: 'v1' },
      staticData: wfJson.staticData || null,
      tags: wfJson.tags || [],
    };
    const patchBody = JSON.stringify(patchPayload);
    const patchRes = await request({
      hostname: 'localhost', port: 5678, path: '/rest/workflows/' + wfId, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(patchBody), Cookie: cookie },
    }, patchBody);

    if (patchRes.statusCode === 200) {
      process.stdout.write('Patched "' + wfJson.name + '" nodes OK\n');
    } else {
      process.stderr.write('Patch "' + wfJson.name + '" FAILED (' + patchRes.statusCode + '): ' + patchRes.body.slice(0, 200) + '\n');
    }
  }

  // 2. Activate all workflows
  const wfRes = await request({
    hostname: 'localhost', port: 5678, path: '/rest/workflows', method: 'GET',
    headers: { Cookie: cookie },
  });
  const workflows = JSON.parse(wfRes.body).data || [];

  for (const wf of workflows) {
    const activateBody = JSON.stringify({ active: true });
    const activateRes = await request({
      hostname: 'localhost', port: 5678, path: '/rest/workflows/' + wf.id, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(activateBody), Cookie: cookie },
    }, activateBody);
    const result = JSON.parse(activateRes.body);
    const ok = result.data && result.data.active === true;
    process.stdout.write('Activated "' + wf.name + '": ' + (ok ? 'OK' : 'FAILED — ' + activateRes.body.slice(0, 100)) + '\n');
  }

  process.stdout.write('Workflow activation complete\n');
}

main().catch(err => {
  process.stderr.write('activate-via-api error: ' + err.message + '\n');
  process.exit(1);
});
