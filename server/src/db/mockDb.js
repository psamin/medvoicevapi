// JSON-file-backed mock CRM. Persists to MOCK_DB_PATH so leads/calls survive a
// restart, and is trivial to inspect (open the file) or reset (POST /api/debug/reset
// or delete the file). Falls back to in-memory only if the path can't be written.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { newLead, newCall, computeMissingFields } from '../models.js';

// Resolved lazily on first use so tests can set MOCK_DB_PATH before the first call.
function dbPath() {
  return resolve(process.env.MOCK_DB_PATH || './data/mock-db.json');
}

function emptyDb() {
  return {
    leads: [],
    calls: [],
    // ---- MedVoice MVP (client → case → intake fields → call → email) ----
    clients: [],
    cases: [],
    intakeFields: [],
    intakeCalls: [],
    emailLogs: [],
    // ---- richer CRM model (first-call verbal intake; docs collected later) ----
    persons: [],
    intakeRecords: [],
    incidents: [],
    injuries: [],
    treatments: [],
    insurances: [],
    witnesses: [],
    documentsToCollect: [],
    structuredConsents: [],
    callReviews: [],
    optOuts: [],
    // ---- legacy ElevenLabs collections (kept so /tools/* + /debug/db still work) ----
    toolCalls: [],
    consents: [],
    eligibilityChecks: [],
    conflicts: [],
    transfers: [],
    callbacks: [],
    intakes: [],
  };
}

let db = null;

function load() {
  const path = dbPath();
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      return { ...emptyDb(), ...parsed };
    } catch (err) {
      console.warn(`[mockDb] could not parse ${path}, starting fresh: ${err.message}`);
    }
  }
  return emptyDb();
}

function ensureLoaded() {
  if (db === null) db = load();
  return db;
}

function persist() {
  const path = dbPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(db, null, 2));
  } catch (err) {
    // Stay in-memory rather than crash the tool call.
    console.warn(`[mockDb] could not write ${path}: ${err.message}`);
  }
}

export function normalizePhone(phone) {
  if (!phone) return '';
  // Keep digits only, then drop a leading US country code so "+1 555 123 4567",
  // "(555) 123-4567", and "5551234567" all compare equal.
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits;
}

/* ──────────── Generic document-store helpers (richer CRM model) ──────────── */

export function insert(collection, record) {
  ensureLoaded();
  if (!db[collection]) db[collection] = [];
  db[collection].push(record);
  persist();
  return record;
}

export function find(collection, predicate) {
  ensureLoaded();
  return (db[collection] || []).find(predicate) || null;
}

export function filter(collection, predicate) {
  ensureLoaded();
  return (db[collection] || []).filter(predicate);
}

export function updateWhere(collection, predicate, patch) {
  ensureLoaded();
  const matches = (db[collection] || []).filter(predicate);
  for (const rec of matches) Object.assign(rec, patch);
  if (matches.length) persist();
  return matches;
}

/* ───────────────────────── Leads ───────────────────────── */

export function listLeads() {
  return ensureLoaded().leads;
}

export function getLead(id) {
  return ensureLoaded().leads.find((l) => l.id === id) || null;
}

export function findLeadByPhone(phone) {
  ensureLoaded();
  const target = normalizePhone(phone);
  if (!target) return null;
  return db.leads.find((l) => normalizePhone(l.phone) === target) || null;
}

export function createLead(input = {}) {
  ensureLoaded();
  const lead = newLead(input);
  db.leads.push(lead);
  persist();
  return lead;
}

export function updateLead(id, patch = {}) {
  ensureLoaded();
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return null;
  // Never let callers overwrite identity/bookkeeping fields by accident.
  const { id: _i, createdAt: _c, ...safe } = patch;
  Object.assign(lead, safe);
  lead.missingFields = computeMissingFields(lead);
  lead.updatedAt = new Date().toISOString();
  persist();
  return lead;
}

/* ───────────────────────── Calls ───────────────────────── */

export function listCalls() {
  return ensureLoaded().calls;
}

export function createCall(input = {}) {
  ensureLoaded();
  const call = newCall(input);
  db.calls.push(call);
  persist();
  return call;
}

/* ──────────────────── Legacy generic API ──────────────────── */

function makeRecord(payload) {
  return {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function logToolCall(toolName, payload) {
  ensureLoaded();
  const record = makeRecord({ toolName, ...payload });
  db.toolCalls.push(record);
  persist();
  return record;
}

export function save(collection, payload) {
  ensureLoaded();
  if (!db[collection]) db[collection] = [];
  const record = makeRecord(payload);
  db[collection].push(record);
  persist();
  return record;
}

export function getAll() {
  return ensureLoaded();
}

export function reset() {
  db = emptyDb();
  // Remove the file too so a fresh load starts clean.
  try {
    if (existsSync(dbPath())) rmSync(dbPath());
  } catch (err) {
    console.warn(`[mockDb] could not remove ${dbPath()}: ${err.message}`);
  }
  persist();
}
