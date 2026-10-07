'use strict';
// Read-only check: has this n8n instance already been given an owner?
// Exit 0 = owner set up, 3 = needs setup (no database yet, no tables yet,
// or the setting is not true), 1 = unexpected error.
// Opens SQLite read-only so it never creates or changes anything; n8n itself
// creates the schema (migrations) when it starts.
const fs = require('fs');
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');

const DB_PATH = (process.env.HOME || '/home/node') + '/.n8n/database.sqlite';

if (!fs.existsSync(DB_PATH)) {
  process.stdout.write('owner-state: no database yet (fresh volume)\n');
  process.exit(3);
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => {
  if (err) fail(err);
});

function fail(err) {
  process.stderr.write('owner-state error: ' + err.message + '\n');
  process.exit(1);
}

db.get(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
  (err, table) => {
    if (err) return fail(err);
    if (!table) {
      process.stdout.write('owner-state: database has no tables yet\n');
      return db.close(() => process.exit(3));
    }
    db.get(
      "SELECT value FROM settings WHERE key='userManagement.isInstanceOwnerSetUp'",
      (err2, row) => {
        if (err2) return fail(err2);
        const ready = !!row && String(row.value) === 'true';
        process.stdout.write('owner-state: ' + (ready ? 'owner already set up' : 'owner not set up yet') + '\n');
        db.close(() => process.exit(ready ? 0 : 3));
      }
    );
  }
);
