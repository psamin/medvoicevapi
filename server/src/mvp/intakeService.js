// Core MedVoice intake services: clients, cases, normalized intake fields,
// missing-field calc, secure form tokens, and prefilled-form payloads.
// All persistence goes through repo.js (Postgres or JSON dev store), so these
// functions are async regardless of backend.
import repo from './repo.js';
import { newClient, newCase, newIntakeField, genToken, CASE_STATUS } from './models.js';
import {
  getFieldConfig,
  isKnownField,
  getRequiredFieldKeys,
  isFieldVisible,
  INTAKE_FIELDS,
} from '../config/intakeFields.js';

const isAnswered = (v) => v !== null && v !== undefined && v !== '';
const nowIso = () => new Date().toISOString();

// Field keys that also live as columns on the client/case "header" records.
const CLIENT_KEYS = ['firstName', 'lastName', 'phone', 'email', 'preferredContact', 'primaryLanguage'];
const CASE_KEYS = [
  'accidentType', 'accidentDate', 'accidentState', 'accidentCity', 'accidentSpecificLocation',
  'accidentDescription', 'injurySummary', 'treatmentStatus', 'humanFollowUpNeeded',
];

/* ── Clients ── */
export async function createOrUpdateClient(data = {}) {
  const existing =
    (data.phone && (await repo.clients.findByPhone(data.phone))) ||
    (data.email && (await repo.clients.findByEmail(data.email))) ||
    null;
  const patch = {};
  for (const k of CLIENT_KEYS) if (isAnswered(data[k])) patch[k] = data[k];

  if (existing) {
    return repo.clients.save({ ...existing, ...patch, updatedAt: nowIso() });
  }
  return repo.clients.save(newClient(patch));
}

/* ── Cases ── */
export async function createOrUpdateCase(clientId, data = {}) {
  const open = await repo.cases.findOpenByClient(clientId);
  const patch = {};
  for (const k of CASE_KEYS) if (isAnswered(data[k])) patch[k] = data[k];

  if (open) {
    return repo.cases.save({ ...open, ...patch, updatedAt: nowIso() });
  }
  return repo.cases.save(newCase({ clientId, status: CASE_STATUS.INTAKE_IN_PROGRESS, ...patch }));
}

export async function getCase(caseId) {
  return repo.cases.findById(caseId);
}
export async function getCaseByToken(token) {
  return repo.cases.findByToken(token);
}
export async function updateCase(caseId, patch = {}) {
  const c = await repo.cases.findById(caseId);
  if (!c) return null;
  return repo.cases.save({ ...c, ...patch, updatedAt: nowIso() });
}
export async function getClient(clientId) {
  return repo.clients.findById(clientId);
}

// Flag a case as a possible duplicate when ANOTHER client has the same name
// (phone/email already de-dupe exact matches; this catches same-name, new-number).
// Never auto-merges — just flags for staff review.
export async function flagPossibleDuplicate(caseId, client) {
  if (!client || (!client.firstName && !client.lastName)) return false;
  const sameName = (await repo.clients.findByName(client.firstName, client.lastName))
    .filter((c) => c.id !== client.id);
  if (!sameName.length) return false;
  await updateCase(caseId, { possibleDuplicate: true, duplicateOfClientId: sameName[0].id });
  return true;
}

/* ── Intake fields (normalized, one row per case+key) ── */
// incoming: array of { key, value, confidence? } OR an object { key: value, ... }
export async function upsertIntakeFields(caseId, incoming = [], source = 'call') {
  const items = Array.isArray(incoming)
    ? incoming
    : Object.entries(incoming).map(([key, value]) => ({ key, value }));

  const saved = [];
  const headerPatch = {};
  for (const item of items) {
    const key = item.key;
    if (!isKnownField(key)) continue; // ignore unknown keys
    const cfg = getFieldConfig(key);
    const value = item.value ?? null;
    const status = isAnswered(value) ? 'complete' : 'missing';
    const existing = await repo.intakeFields.findByCaseAndKey(caseId, key);
    if (existing) {
      // Don't let a later blank overwrite an existing answered value.
      const keep = !isAnswered(value) && isAnswered(existing.value);
      saved.push(await repo.intakeFields.save({
        ...existing,
        value: keep ? existing.value : value,
        source,
        status: keep ? existing.status : status,
        confidence: item.confidence ?? existing.confidence,
        updatedAt: nowIso(),
      }));
    } else {
      saved.push(await repo.intakeFields.save(newIntakeField({
        caseId, fieldKey: key, fieldLabel: cfg.label, value, source, status,
        required: cfg.required, confidence: item.confidence ?? null,
        clientFacing: cfg.clientFacing, staffOnly: cfg.staffOnly,
      })));
    }
    headerPatch[key] = value;
  }

  // Mirror mapped keys onto the client/case header records.
  const theCase = await repo.cases.findById(caseId);
  if (theCase) {
    const clientPatch = {};
    for (const k of CLIENT_KEYS) if (k in headerPatch && isAnswered(headerPatch[k])) clientPatch[k] = headerPatch[k];
    if (Object.keys(clientPatch).length && theCase.clientId) {
      const client = await repo.clients.findById(theCase.clientId);
      if (client) await repo.clients.save({ ...client, ...clientPatch, updatedAt: nowIso() });
    }
    const casePatch = {};
    for (const k of CASE_KEYS) if (k in headerPatch && isAnswered(headerPatch[k])) casePatch[k] = headerPatch[k];
    if (Object.keys(casePatch).length) await updateCase(caseId, casePatch);
  }
  return saved;
}

// Current value map for a case (from intake field rows).
export async function getCaseValues(caseId) {
  const values = {};
  for (const r of await repo.intakeFields.listByCase(caseId)) values[r.fieldKey] = r.value;
  return values;
}

// Required fields still missing, honoring conditional visibility (Step 4 modules).
export async function getMissingFields(caseId) {
  const values = await getCaseValues(caseId);
  return getRequiredFieldKeys()
    .map((key) => getFieldConfig(key))
    .filter((cfg) => isFieldVisible(cfg, values) && !isAnswered(values[cfg.key]))
    .map((cfg) => ({ key: cfg.key, label: cfg.label, step: cfg.step }));
}

/* ── Secure form token + prefilled payload ── */
export async function generateIntakeToken(caseId) {
  const existing = await repo.cases.findById(caseId);
  if (existing?.formToken) return existing.formToken;
  const token = genToken();
  await updateCase(caseId, { formToken: token });
  return token;
}

// Build the 5-step form payload with current values; hides staff-only fields and
// fields whose conditional module isn't active.
export async function generatePrefilledFormPayload(token) {
  const theCase = await repo.cases.findByToken(token);
  if (!theCase) return null;
  const values = await getCaseValues(theCase.id);
  const client = theCase.clientId ? await repo.clients.findById(theCase.clientId) : null;

  const stepNames = { 1: 'Patient', 2: 'Incident', 3: 'Treatment', 4: 'Module', 5: 'Coverage' };
  const steps = [];
  for (const stepNum of [1, 2, 3, 4, 5]) {
    const stepFields = INTAKE_FIELDS.filter(
      (fld) => fld.step === stepNum && fld.clientFacing && !fld.staffOnly && isFieldVisible(fld, values)
    );
    if (!stepFields.length) continue;
    const sections = {};
    for (const fld of stepFields) {
      (sections[fld.section] ??= []).push({
        key: fld.key, label: fld.label, type: fld.type, required: fld.required,
        options: fld.options, helpText: fld.helpText,
        value: values[fld.key] ?? null,
        status: isAnswered(values[fld.key]) ? 'complete' : 'missing',
      });
    }
    steps.push({
      step: stepNum,
      name: stepNames[stepNum],
      sections: Object.entries(sections).map(([name, fields]) => ({ name, fields })),
    });
  }

  return {
    token,
    caseId: theCase.id,
    status: theCase.status,
    accidentType: theCase.accidentType,
    client: client ? { firstName: client.firstName, lastName: client.lastName, email: client.email } : null,
    missingFields: await getMissingFields(theCase.id),
    steps,
  };
}

// Recompute case status from required completeness (used after form submit).
export async function recomputeCaseStatus(caseId) {
  const theCase = await repo.cases.findById(caseId);
  if (!theCase) return null;
  if (theCase.humanFollowUpNeeded) return updateCase(caseId, { status: CASE_STATUS.HUMAN_FOLLOW_UP_NEEDED });
  const missing = await getMissingFields(caseId);
  return updateCase(caseId, {
    status: missing.length ? CASE_STATUS.WAITING_ON_CLIENT : CASE_STATUS.COMPLETED,
  });
}
