'use strict';
// Waits for n8n to be ready, logs in as owner, and activates all imported
// workflows via the REST API. This is the only correct activation path:
// - n8n import:workflow always imports as inactive AND clears webhook_entity
// - Setting active=1 in SQLite alone does NOT populate webhook_entity
// - The REST PATCH /rest/workflows/:id activation populates webhook_entity
//   and registers webhook handlers in n8n's in-memory state
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

  const loginBody = JSON.stringify({ emailOrLdapLoginId: 'owner@nexo.local', password: 'N3x0Dev2026!' });
  const loginRes = await request({
    hostname: 'localhost', port: 5678, path: '/rest/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
  }, loginBody);

  if (loginRes.statusCode !== 200) {
    process.stderr.write('Login failed (' + loginRes.statusCode + '): ' + loginRes.body + '\n');
    process.exit(1);
  }
  const cookie = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  const wfRes = await request({
    hostname: 'localhost', port: 5678, path: '/rest/workflows', method: 'GET',
    headers: { Cookie: cookie },
  });
  const workflows = JSON.parse(wfRes.body).data || [];

  for (const wf of workflows) {
    const patchBody = JSON.stringify({ active: true });
    const patchRes = await request({
      hostname: 'localhost', port: 5678, path: '/rest/workflows/' + wf.id, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(patchBody), Cookie: cookie },
    }, patchBody);
    const result = JSON.parse(patchRes.body);
    const ok = result.data && result.data.active === true;
    process.stdout.write('Activated "' + wf.name + '": ' + (ok ? 'OK' : 'FAILED — ' + patchRes.body) + '\n');
  }

  process.stdout.write('Workflow activation complete\n');
}

main().catch(err => {
  process.stderr.write('activate-via-api error: ' + err.message + '\n');
  process.exit(1);
});
