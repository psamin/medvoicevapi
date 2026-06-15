// Storage repository for MedVoice MVP entities. One async interface, three backends:
//   - SQLite  (DEFAULT for local/dev — source of truth, node:sqlite)
//   - Postgres (when DATABASE_URL is set) — production
//   - JSON dev store (STORAGE=json) — zero setup, legacy/escape hatch
// Services depend ONLY on this module, so swapping backends changes nothing else.
import { pgEnabled, query } from '../db/pg.js';
import { getDb, resetDb } from '../db/sqlite.js';
import {
  insert as jInsert,
  find as jFind,
  filter as jFilter,
  updateWhere as jUpdate,
  normalizePhone,
} from '../db/mockDb.js';
import { TERMINAL_CASE_STATUSES } from './models.js';

// A returning caller reopens a case unless it has reached a terminal stage.
const OPEN_EXCLUDED = TERMINAL_CASE_STATUSES;
const norm = (s) => (s ? String(s).trim().toLowerCase() : '');

// CRM collections added on top of the original entities. Repo key → physical table.
const NEW_COLLECTIONS = {
  tasks: 'tasks',
  notes: 'notes',
  communications: 'communications',
  auditLogs: 'audit_logs',
  followUpAttempts: 'follow_up_attempts',
};
// Build {repoKey: factory(table)} for a backend's generic collection factory.
function mapCollections(factory) {
  return Object.fromEntries(Object.entries(NEW_COLLECTIONS).map(([key, table]) => [key, factory(table)]));
}

/* ───────────────────────── JSON backend ───────────────────────── */
const jsonRepo = {
  clients: {
    async findByPhone(phone) {
      const n = normalizePhone(phone);
      return n ? jFind('clients', (c) => normalizePhone(c.phone) === n) : null;
    },
    async findByEmail(email) {
      return email ? jFind('clients', (c) => (c.email || '').toLowerCase() === String(email).toLowerCase()) : null;
    },
    async findById(id) {
      return jFind('clients', (c) => c.id === id);
    },
    async findByName(firstName, lastName) {
      const f = norm(firstName), l = norm(lastName);
      if (!f && !l) return [];
      return jFilter('clients', (c) => norm(c.firstName) === f && norm(c.lastName) === l);
    },
    async save(rec) {
      if (jFind('clients', (c) => c.id === rec.id)) jUpdate('clients', (c) => c.id === rec.id, rec);
      else jInsert('clients', rec);
      return rec;
    },
  },
  cases: {
    async findById(id) {
      return jFind('cases', (c) => c.id === id);
    },
    async findByToken(token) {
      return token ? jFind('cases', (c) => c.formToken === token) : null;
    },
    async findOpenByClient(clientId) {
      const open = jFilter('cases', (c) => c.clientId === clientId && !OPEN_EXCLUDED.includes(c.status));
      return open.length ? open[open.length - 1] : null;
    },
    async list() {
      return jFilter('cases', () => true);
    },
    async save(rec) {
      if (jFind('cases', (c) => c.id === rec.id)) jUpdate('cases', (c) => c.id === rec.id, rec);
      else jInsert('cases', rec);
      return rec;
    },
  },
  intakeFields: {
    async findByCaseAndKey(caseId, key) {
      return jFind('intakeFields', (r) => r.caseId === caseId && r.fieldKey === key);
    },
    async listByCase(caseId) {
      return jFilter('intakeFields', (r) => r.caseId === caseId);
    },
    async save(rec) {
      if (jFind('intakeFields', (r) => r.id === rec.id)) jUpdate('intakeFields', (r) => r.id === rec.id, rec);
      else jInsert('intakeFields', rec);
      return rec;
    },
  },
  requiredDocuments: {
    async findByCaseAndType(caseId, docType) {
      return jFind('requiredDocuments', (r) => r.caseId === caseId && r.docType === docType);
    },
    async listByCase(caseId) {
      return jFilter('requiredDocuments', (r) => r.caseId === caseId);
    },
    async save(rec) {
      if (jFind('requiredDocuments', (r) => r.id === rec.id)) jUpdate('requiredDocuments', (r) => r.id === rec.id, rec);
      else jInsert('requiredDocuments', rec);
      return rec;
    },
  },
  intakeCalls: {
    async insert(rec) { return jInsert('intakeCalls', rec); },
    async listByCase(caseId) { return jFilter('intakeCalls', (r) => r.caseId === caseId); },
  },
  emailLogs: {
    async insert(rec) { return jInsert('emailLogs', rec); },
    async listByCase(caseId) { return jFilter('emailLogs', (r) => r.caseId === caseId); },
  },
  ...jsonCollections(['tasks', 'notes', 'communications', 'auditLogs', 'followUpAttempts']),
};

// Generic JSON-backed collection (insert/save/findById/list/listByCase/listByClient).
function jsonCollection(name) {
  return {
    async insert(rec) { return jInsert(name, rec); },
    async save(rec) {
      if (jFind(name, (r) => r.id === rec.id)) jUpdate(name, (r) => r.id === rec.id, rec);
      else jInsert(name, rec);
      return rec;
    },
    async findById(id) { return jFind(name, (r) => r.id === id); },
    async list() { return jFilter(name, () => true); },
    async listByCase(caseId) { return jFilter(name, (r) => r.caseId === caseId); },
    async listByClient(clientId) { return jFilter(name, (r) => r.clientId === clientId); },
  };
}
function jsonCollections(names) {
  return Object.fromEntries(names.map((n) => [n, jsonCollection(n)]));
}

/* ───────────────────────── Postgres backend ───────────────────────── */
const one = (res) => (res.rows[0] ? res.rows[0].doc : null);

const pgRepo = {
  clients: {
    async findByPhone(phone) {
      const n = normalizePhone(phone);
      return n ? one(await query('SELECT doc FROM clients WHERE phone_norm=$1 LIMIT 1', [n])) : null;
    },
    async findByEmail(email) {
      return email ? one(await query('SELECT doc FROM clients WHERE lower(email)=lower($1) LIMIT 1', [email])) : null;
    },
    async findById(id) {
      return one(await query('SELECT doc FROM clients WHERE id=$1', [id]));
    },
    async findByName(firstName, lastName) {
      const f = norm(firstName), l = norm(lastName);
      if (!f && !l) return [];
      return (await query(
        `SELECT doc FROM clients WHERE lower(doc->>'firstName')=$1 AND lower(doc->>'lastName')=$2`,
        [f, l]
      )).rows.map((r) => r.doc);
    },
    async save(rec) {
      await query(
        `INSERT INTO clients (id, phone_norm, email, doc, updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (id) DO UPDATE SET phone_norm=EXCLUDED.phone_norm, email=EXCLUDED.email, doc=EXCLUDED.doc, updated_at=now()`,
        [rec.id, normalizePhone(rec.phone) || null, rec.email || null, rec]
      );
      return rec;
    },
  },
  cases: {
    async findById(id) {
      return one(await query('SELECT doc FROM cases WHERE id=$1', [id]));
    },
    async findByToken(token) {
      return token ? one(await query('SELECT doc FROM cases WHERE form_token=$1 LIMIT 1', [token])) : null;
    },
    async findOpenByClient(clientId) {
      return one(await query(
        `SELECT doc FROM cases WHERE client_id=$1 AND status <> ALL($2) ORDER BY updated_at DESC LIMIT 1`,
        [clientId, OPEN_EXCLUDED]
      ));
    },
    async list() {
      return (await query('SELECT doc FROM cases ORDER BY updated_at DESC')).rows.map((r) => r.doc);
    },
    async save(rec) {
      await query(
        `INSERT INTO cases (id, client_id, form_token, status, doc, updated_at) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (id) DO UPDATE SET client_id=EXCLUDED.client_id, form_token=EXCLUDED.form_token, status=EXCLUDED.status, doc=EXCLUDED.doc, updated_at=now()`,
        [rec.id, rec.clientId || null, rec.formToken || null, rec.status || null, rec]
      );
      return rec;
    },
  },
  intakeFields: {
    async findByCaseAndKey(caseId, key) {
      return one(await query('SELECT doc FROM intake_fields WHERE case_id=$1 AND field_key=$2', [caseId, key]));
    },
    async listByCase(caseId) {
      return (await query('SELECT doc FROM intake_fields WHERE case_id=$1', [caseId])).rows.map((r) => r.doc);
    },
    async save(rec) {
      await query(
        `INSERT INTO intake_fields (id, case_id, field_key, doc, updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id, field_key=EXCLUDED.field_key, doc=EXCLUDED.doc, updated_at=now()`,
        [rec.id, rec.caseId, rec.fieldKey, rec]
      );
      return rec;
    },
  },
  requiredDocuments: {
    async findByCaseAndType(caseId, docType) {
      return one(await query('SELECT doc FROM required_documents WHERE case_id=$1 AND doc_type=$2', [caseId, docType]));
    },
    async listByCase(caseId) {
      return (await query('SELECT doc FROM required_documents WHERE case_id=$1', [caseId])).rows.map((r) => r.doc);
    },
    async save(rec) {
      await query(
        `INSERT INTO required_documents (id, case_id, doc_type, doc, updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id, doc_type=EXCLUDED.doc_type, doc=EXCLUDED.doc, updated_at=now()`,
        [rec.id, rec.caseId, rec.docType, rec]
      );
      return rec;
    },
  },
  intakeCalls: {
    async insert(rec) {
      await query('INSERT INTO intake_calls (id, case_id, doc) VALUES ($1,$2,$3)', [rec.id, rec.caseId || null, rec]);
      return rec;
    },
    async listByCase(caseId) {
      return (await query('SELECT doc FROM intake_calls WHERE case_id=$1 ORDER BY created_at', [caseId])).rows.map((r) => r.doc);
    },
  },
  emailLogs: {
    async insert(rec) {
      await query('INSERT INTO email_logs (id, case_id, doc) VALUES ($1,$2,$3)', [rec.id, rec.caseId || null, rec]);
      return rec;
    },
    async listByCase(caseId) {
      return (await query('SELECT doc FROM email_logs WHERE case_id=$1 ORDER BY created_at', [caseId])).rows.map((r) => r.doc);
    },
  },
  ...mapCollections(pgCollection),
};

// Generic Postgres-backed collection. `table` is a fixed internal name (never user input).
function pgCollection(table) {
  return {
    async insert(rec) {
      await query(`INSERT INTO ${table} (id, case_id, doc) VALUES ($1,$2,$3)`, [rec.id, rec.caseId || null, rec]);
      return rec;
    },
    async save(rec) {
      await query(
        `INSERT INTO ${table} (id, case_id, doc, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id, doc=EXCLUDED.doc, updated_at=now()`,
        [rec.id, rec.caseId || null, rec]
      );
      return rec;
    },
    async findById(id) { return one(await query(`SELECT doc FROM ${table} WHERE id=$1`, [id])); },
    async list() { return (await query(`SELECT doc FROM ${table} ORDER BY created_at DESC`)).rows.map((r) => r.doc); },
    async listByCase(caseId) { return (await query(`SELECT doc FROM ${table} WHERE case_id=$1 ORDER BY created_at`, [caseId])).rows.map((r) => r.doc); },
    async listByClient(clientId) {
      return (await query(`SELECT doc FROM ${table} WHERE doc->>'clientId'=$1 ORDER BY created_at`, [clientId])).rows.map((r) => r.doc);
    },
  };
}

/* ───────────────────────── SQLite backend (default) ───────────────────────── */
const sdoc = (row) => (row ? JSON.parse(row.doc) : null);
const NOW = () => new Date().toISOString();

const sqliteRepo = {
  clients: {
    async findByPhone(phone) {
      const n = normalizePhone(phone);
      return n ? sdoc(getDb().prepare('SELECT doc FROM clients WHERE phone_norm=?').get(n)) : null;
    },
    async findByEmail(email) {
      return email ? sdoc(getDb().prepare('SELECT doc FROM clients WHERE lower(email)=lower(?)').get(email)) : null;
    },
    async findById(id) {
      return sdoc(getDb().prepare('SELECT doc FROM clients WHERE id=?').get(id));
    },
    async findByName(firstName, lastName) {
      const f = norm(firstName), l = norm(lastName);
      if (!f && !l) return [];
      return getDb()
        .prepare(`SELECT doc FROM clients WHERE lower(json_extract(doc,'$.firstName'))=? AND lower(json_extract(doc,'$.lastName'))=?`)
        .all(f, l).map((r) => JSON.parse(r.doc));
    },
    async save(rec) {
      getDb().prepare(
        `INSERT INTO clients (id,phone_norm,email,doc,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET phone_norm=excluded.phone_norm, email=excluded.email, doc=excluded.doc, updated_at=excluded.updated_at`
      ).run(rec.id, normalizePhone(rec.phone) || null, rec.email || null, JSON.stringify(rec), NOW());
      return rec;
    },
  },
  cases: {
    async findById(id) {
      return sdoc(getDb().prepare('SELECT doc FROM cases WHERE id=?').get(id));
    },
    async findByToken(token) {
      return token ? sdoc(getDb().prepare('SELECT doc FROM cases WHERE form_token=?').get(token)) : null;
    },
    async findOpenByClient(clientId) {
      const placeholders = OPEN_EXCLUDED.map(() => '?').join(',');
      return sdoc(getDb()
        .prepare(`SELECT doc FROM cases WHERE client_id=? AND status NOT IN (${placeholders}) ORDER BY updated_at DESC LIMIT 1`)
        .get(clientId, ...OPEN_EXCLUDED));
    },
    async list() {
      return getDb().prepare('SELECT doc FROM cases ORDER BY updated_at DESC').all().map((r) => JSON.parse(r.doc));
    },
    async save(rec) {
      getDb().prepare(
        `INSERT INTO cases (id,client_id,form_token,status,doc,updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id, form_token=excluded.form_token, status=excluded.status, doc=excluded.doc, updated_at=excluded.updated_at`
      ).run(rec.id, rec.clientId || null, rec.formToken || null, rec.status || null, JSON.stringify(rec), NOW());
      return rec;
    },
  },
  intakeFields: {
    async findByCaseAndKey(caseId, key) {
      return sdoc(getDb().prepare('SELECT doc FROM intake_fields WHERE case_id=? AND field_key=?').get(caseId, key));
    },
    async listByCase(caseId) {
      return getDb().prepare('SELECT doc FROM intake_fields WHERE case_id=?').all(caseId).map((r) => JSON.parse(r.doc));
    },
    async save(rec) {
      getDb().prepare(
        `INSERT INTO intake_fields (id,case_id,field_key,doc,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET case_id=excluded.case_id, field_key=excluded.field_key, doc=excluded.doc, updated_at=excluded.updated_at`
      ).run(rec.id, rec.caseId, rec.fieldKey, JSON.stringify(rec), NOW());
      return rec;
    },
  },
  requiredDocuments: {
    async findByCaseAndType(caseId, docType) {
      return sdoc(getDb().prepare('SELECT doc FROM required_documents WHERE case_id=? AND doc_type=?').get(caseId, docType));
    },
    async listByCase(caseId) {
      return getDb().prepare('SELECT doc FROM required_documents WHERE case_id=?').all(caseId).map((r) => JSON.parse(r.doc));
    },
    async save(rec) {
      getDb().prepare(
        `INSERT INTO required_documents (id,case_id,doc_type,doc,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET case_id=excluded.case_id, doc_type=excluded.doc_type, doc=excluded.doc, updated_at=excluded.updated_at`
      ).run(rec.id, rec.caseId, rec.docType, JSON.stringify(rec), NOW());
      return rec;
    },
  },
  intakeCalls: {
    async insert(rec) {
      getDb().prepare('INSERT INTO intake_calls (id,case_id,doc,created_at) VALUES (?,?,?,?)').run(rec.id, rec.caseId || null, JSON.stringify(rec), NOW());
      return rec;
    },
    async listByCase(caseId) {
      return getDb().prepare('SELECT doc FROM intake_calls WHERE case_id=? ORDER BY created_at').all(caseId).map((r) => JSON.parse(r.doc));
    },
  },
  emailLogs: {
    async insert(rec) {
      getDb().prepare('INSERT INTO email_logs (id,case_id,doc,created_at) VALUES (?,?,?,?)').run(rec.id, rec.caseId || null, JSON.stringify(rec), NOW());
      return rec;
    },
    async listByCase(caseId) {
      return getDb().prepare('SELECT doc FROM email_logs WHERE case_id=? ORDER BY created_at').all(caseId).map((r) => JSON.parse(r.doc));
    },
  },
  ...mapCollections(sqliteCollection),
};

// Generic SQLite-backed collection. `table` is a fixed internal name (never user input).
// follow_up_attempts lacks an updated_at column, so writes use insert-only there.
function sqliteCollection(table) {
  const hasUpdatedAt = table !== 'follow_up_attempts';
  return {
    async insert(rec) {
      const cols = hasUpdatedAt ? '(id,case_id,doc,created_at,updated_at)' : '(id,case_id,doc,created_at)';
      const vals = hasUpdatedAt ? '(?,?,?,?,?)' : '(?,?,?,?)';
      const args = hasUpdatedAt
        ? [rec.id, rec.caseId || null, JSON.stringify(rec), NOW(), NOW()]
        : [rec.id, rec.caseId || null, JSON.stringify(rec), NOW()];
      getDb().prepare(`INSERT INTO ${table} ${cols} VALUES ${vals}`).run(...args);
      return rec;
    },
    async save(rec) {
      getDb().prepare(
        `INSERT INTO ${table} (id,case_id,doc,created_at,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET case_id=excluded.case_id, doc=excluded.doc, updated_at=excluded.updated_at`
      ).run(rec.id, rec.caseId || null, JSON.stringify(rec), NOW(), NOW());
      return rec;
    },
    async findById(id) { return sdoc(getDb().prepare(`SELECT doc FROM ${table} WHERE id=?`).get(id)); },
    async list() { return getDb().prepare(`SELECT doc FROM ${table} ORDER BY created_at DESC`).all().map((r) => JSON.parse(r.doc)); },
    async listByCase(caseId) { return getDb().prepare(`SELECT doc FROM ${table} WHERE case_id=? ORDER BY created_at`).all(caseId).map((r) => JSON.parse(r.doc)); },
    async listByClient(clientId) {
      return getDb().prepare(`SELECT doc FROM ${table} WHERE json_extract(doc,'$.clientId')=? ORDER BY created_at`).all(clientId).map((r) => JSON.parse(r.doc));
    },
  };
}

/* ───────────────────────── backend selection ───────────────────────── */
function pickBackend() {
  if (pgEnabled()) return 'postgres';
  if (process.env.STORAGE === 'json') return 'json';
  return 'sqlite'; // default source of truth for local/dev
}
const BACKEND = pickBackend();
const repo = BACKEND === 'postgres' ? pgRepo : BACKEND === 'json' ? jsonRepo : sqliteRepo;

export const STORAGE_BACKEND = BACKEND;

// Clear MVP data for the active backend (used by POST /api/debug/reset in tests).
export async function resetStore() {
  if (BACKEND === 'sqlite') resetDb();
  // json: mockDb.reset() (called by the debug route) already clears MVP collections.
  // postgres: not auto-cleared (production).
}

export default repo;
