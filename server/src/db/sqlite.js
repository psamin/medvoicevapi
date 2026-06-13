// SQLite source of truth for local/dev, using Node's built-in node:sqlite
// (no dependency). Requires the --experimental-sqlite flag, which is baked into the
// npm scripts. Records are stored as JSON text in a `doc` column plus indexed
// lookup columns — same shape as the Postgres backend.
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const require = createRequire(import.meta.url);

export function sqlitePath() {
  return resolve(process.env.SQLITE_PATH || './data/medvoice.db');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, phone_norm TEXT, email TEXT, doc TEXT NOT NULL, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS clients_phone_idx ON clients(phone_norm);
CREATE INDEX IF NOT EXISTS clients_email_idx ON clients(email);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, client_id TEXT, form_token TEXT, status TEXT, doc TEXT NOT NULL, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS cases_client_idx ON cases(client_id);
CREATE INDEX IF NOT EXISTS cases_token_idx ON cases(form_token);

CREATE TABLE IF NOT EXISTS intake_fields (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, field_key TEXT NOT NULL, doc TEXT NOT NULL, updated_at TEXT,
  UNIQUE(case_id, field_key)
);
CREATE INDEX IF NOT EXISTS intake_fields_case_idx ON intake_fields(case_id);

CREATE TABLE IF NOT EXISTS required_documents (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, doc_type TEXT NOT NULL, doc TEXT NOT NULL, updated_at TEXT,
  UNIQUE(case_id, doc_type)
);
CREATE INDEX IF NOT EXISTS required_documents_case_idx ON required_documents(case_id);

CREATE TABLE IF NOT EXISTS follow_up_attempts (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT
);
CREATE INDEX IF NOT EXISTS follow_up_attempts_case_idx ON follow_up_attempts(case_id);

CREATE TABLE IF NOT EXISTS intake_calls (
  id TEXT PRIMARY KEY, case_id TEXT, doc TEXT NOT NULL, created_at TEXT
);
CREATE INDEX IF NOT EXISTS intake_calls_case_idx ON intake_calls(case_id);

CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY, case_id TEXT, doc TEXT NOT NULL, created_at TEXT
);
CREATE INDEX IF NOT EXISTS email_logs_case_idx ON email_logs(case_id);
`;

const TABLES = ['clients', 'cases', 'intake_fields', 'required_documents', 'follow_up_attempts', 'intake_calls', 'email_logs'];

let db = null;

export function getDb() {
  if (db) return db;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    throw new Error(
      'node:sqlite is unavailable. Run with the --experimental-sqlite flag ' +
        '(baked into npm scripts), or set STORAGE=json to use the JSON dev store.'
    );
  }
  const path = sqlitePath();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function resetDb() {
  const d = getDb();
  for (const t of TABLES) d.exec(`DELETE FROM ${t}`);
}
