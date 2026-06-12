// Storage repository for MedVoice MVP entities. One async interface, two backends:
//   - Postgres (when DATABASE_URL is set)        — real DB, survives restarts/scale
//   - JSON dev store (default, via mockDb)        — zero setup, used by tests
// Services depend ONLY on this module, so swapping backends changes nothing else.
import { pgEnabled, query } from '../db/pg.js';
import {
  insert as jInsert,
  find as jFind,
  filter as jFilter,
  updateWhere as jUpdate,
  normalizePhone,
} from '../db/mockDb.js';

const OPEN_EXCLUDED = ['closed', 'completed'];
const norm = (s) => (s ? String(s).trim().toLowerCase() : '');

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
  intakeCalls: {
    async insert(rec) { return jInsert('intakeCalls', rec); },
    async listByCase(caseId) { return jFilter('intakeCalls', (r) => r.caseId === caseId); },
  },
  emailLogs: {
    async insert(rec) { return jInsert('emailLogs', rec); },
    async listByCase(caseId) { return jFilter('emailLogs', (r) => r.caseId === caseId); },
  },
};

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
};

const repo = pgEnabled() ? pgRepo : jsonRepo;
export const STORAGE_BACKEND = pgEnabled() ? 'postgres' : 'json';
export default repo;
