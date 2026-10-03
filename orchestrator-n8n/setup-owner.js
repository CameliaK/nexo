'use strict';
// Creates the instance owner in SQLite if not already present.
// n8n 1.x requires each user to have a personal project (project + project_relation)
// before n8n import:workflow can assign workflows to that user.
// All writes are idempotent (INSERT OR IGNORE / INSERT OR REPLACE).
// Runs before "exec n8n start" so there are no concurrent writes.
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const bcrypt  = require('/usr/local/lib/node_modules/n8n/node_modules/.pnpm/bcryptjs@2.4.3/node_modules/bcryptjs');
const crypto  = require('crypto');

const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || 'N3x0Dev2026!';
if (!process.env.N8N_OWNER_PASSWORD) {
  process.stdout.write('Warning: N8N_OWNER_PASSWORD not set — using insecure dev default\n');
}

const DB_PATH = (process.env.HOME || '/home/node') + '/.n8n/database.sqlite';
const db = new sqlite3.Database(DB_PATH);

function run(sql, params) {
  return new Promise((res, rej) => db.run(sql, params || [], function(err) { err ? rej(err) : res(this); }));
}
function get(sql, params) {
  return new Promise((res, rej) => db.get(sql, params || [], (err, row) => err ? rej(err) : res(row)));
}
function close() { return new Promise(res => db.close(res)); }

(async () => {
  try {
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

    // --- Owner user ---
    let ownerId;
    const existing = await get("SELECT id FROM user WHERE email='owner@nexo.local'");
    if (existing) {
      ownerId = existing.id;
      process.stdout.write('Owner already exists (' + ownerId + ') — skipping user insert\n');
    } else {
      ownerId = crypto.randomUUID();
      const hash = bcrypt.hashSync(OWNER_PASSWORD, 10);
      await run(
        `INSERT INTO user
          (id, email, firstName, lastName, password, createdAt, updatedAt, disabled, mfaEnabled, roleSlug)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'global:owner')`,
        [ownerId, 'owner@nexo.local', 'Nexo', 'Owner', hash, now, now]
      );
      process.stdout.write('Instance owner created (owner@nexo.local)\n');
    }

    // --- Personal project ---
    const existingProject = await get(
      "SELECT p.id FROM project p INNER JOIN project_relation pr ON pr.projectId=p.id WHERE p.type='personal' AND pr.userId=? AND pr.role='project:personalOwner'",
      [ownerId]
    );
    if (existingProject) {
      process.stdout.write('Personal project already exists — skipping project insert\n');
    } else {
      const projectId = crypto.randomUUID();
      await run(
        `INSERT INTO project (id, name, type, createdAt, updatedAt) VALUES (?, ?, 'personal', ?, ?)`,
        [projectId, 'Nexo Owner', now, now]
      );
      await run(
        `INSERT INTO project_relation (projectId, userId, role, createdAt, updatedAt) VALUES (?, ?, 'project:personalOwner', ?, ?)`,
        [projectId, ownerId, now, now]
      );
      process.stdout.write('Personal project created for owner\n');
    }

    // --- Mark instance as set up ---
    await run(
      "INSERT OR REPLACE INTO settings (key, value, loadOnStartup) VALUES ('userManagement.isInstanceOwnerSetUp', 'true', 1)"
    );
    process.stdout.write('Owner setup complete\n');

  } catch (err) {
    process.stderr.write('setup-owner error: ' + err.message + '\n');
    process.exit(1);
  } finally {
    await close();
  }
})();
