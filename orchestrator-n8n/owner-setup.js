'use strict';
// Claims the instance owner through n8n's own REST API (POST /rest/owner/setup,
// open only while no owner exists). n8n must already be running: on a fresh
// volume it has just created its tables and a placeholder ("shell") owner with
// its personal project, which this call fills in — so n8n import:workflow finds
// the owner's project afterwards.
// Never prints the password; n8n's error messages don't include it either.
const http = require('http');

const OWNER_EMAIL = 'owner@nexo.local';
const READY_ATTEMPTS = 90;   // × 2 s = 3 min for n8n to finish migrations and listen
const SETUP_ATTEMPTS = 5;

const password = process.env.N8N_OWNER_PASSWORD;
if (!password) {
  process.stderr.write('owner-setup: N8N_OWNER_PASSWORD is not set\n');
  process.exit(1);
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 5678, ...options }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function errorMessage(body) {
  try { return JSON.parse(body).message || body.slice(0, 200); } catch (_) { return body.slice(0, 200); }
}

async function waitReady() {
  for (let i = 1; i <= READY_ATTEMPTS; i++) {
    try {
      const res = await request({ path: '/rest/settings', method: 'GET' });
      if (res.statusCode === 200) return JSON.parse(res.body);
    } catch (_) {}
    await sleep(2000);
  }
  throw new Error('n8n did not become ready within ' + (READY_ATTEMPTS * 2) + ' s');
}

async function main() {
  process.stdout.write('owner-setup: waiting for n8n to create its database...\n');
  const settings = await waitReady();
  const um = (settings.data || settings).userManagement || {};
  if (um.showSetupOnFirstLoad === false) {
    process.stdout.write('owner-setup: owner already set up — nothing to do\n');
    return;
  }

  const body = JSON.stringify({ email: OWNER_EMAIL, firstName: 'Nexo', lastName: 'Owner', password });
  for (let i = 1; i <= SETUP_ATTEMPTS; i++) {
    let res;
    try {
      res = await request({
        path: '/rest/owner/setup', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
    } catch (err) {
      process.stderr.write('owner-setup: attempt ' + i + '/' + SETUP_ATTEMPTS + ' failed: ' + err.message + '\n');
      await sleep(3000);
      continue;
    }
    if (res.statusCode === 200) {
      process.stdout.write('owner-setup: instance owner created (' + OWNER_EMAIL + ')\n');
      return;
    }
    const msg = errorMessage(res.body);
    if (res.statusCode === 400 && /already setup/i.test(msg)) {
      process.stdout.write('owner-setup: owner already set up — nothing to do\n');
      return;
    }
    if (res.statusCode === 400) {
      // Validation error (e.g. password policy: 8-64 chars, 1 number, 1 uppercase).
      throw new Error('n8n rejected the owner setup: ' + msg);
    }
    process.stderr.write('owner-setup: attempt ' + i + '/' + SETUP_ATTEMPTS + ' got HTTP ' + res.statusCode + ': ' + msg + '\n');
    await sleep(3000);
  }
  throw new Error('could not create the owner after ' + SETUP_ATTEMPTS + ' attempts');
}

main().catch(err => {
  process.stderr.write('owner-setup error: ' + err.message + '\n');
  process.exit(1);
});
