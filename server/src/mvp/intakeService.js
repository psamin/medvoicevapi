// Core MedVoice intake services: clients, cases, normalized intake fields,
// missing-field calc, secure form tokens, and prefilled-form payloads.
import {
  insert,
  find,
  filter,
  updateWhere,
  normalizePhone,
} from '../db/mockDb.js';
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
export function createOrUpdateClient(data = {}) {
  const existing =
    (data.phone && find('clients', (c) => normalizePhone(c.phone) === normalizePhone(data.phone))) ||
    (data.email && find('clients', (c) => (c.email || '').toLowerCase() === String(data.email).toLowerCase())) ||
    null;
  const patch = {};
  for (const k of CLIENT_KEYS) if (isAnswered(data[k])) patch[k] = data[k];

  if (existing) {
    updateWhere('clients', (c) => c.id === existing.id, { ...patch, updatedAt: nowIso() });
    return find('clients', (c) => c.id === existing.id);
  }
  return insert('clients', newClient(patch));
}

/* ── Cases ── */
export function createOrUpdateCase(clientId, data = {}) {
  // Reuse the client's most recent still-open case, else create one.
  const open = filter('cases', (c) => c.clientId === clientId && c.status !== CASE_STATUS.CLOSED && c.status !== CASE_STATUS.COMPLETED);
  const patch = {};
  for (const k of CASE_KEYS) if (isAnswered(data[k])) patch[k] = data[k];

  if (open.length) {
    const target = open[open.length - 1];
    updateWhere('cases', (c) => c.id === target.id, { ...patch, updatedAt: nowIso() });
    return find('cases', (c) => c.id === target.id);
  }
  return insert('cases', newCase({ clientId, status: CASE_STATUS.INTAKE_IN_PROGRESS, ...patch }));
}

export function getCase(caseId) {
  return find('cases', (c) => c.id === caseId);
}
export function getCaseByToken(token) {
  return token ? find('cases', (c) => c.formToken === token) : null;
}
export function updateCase(caseId, patch = {}) {
  updateWhere('cases', (c) => c.id === caseId, { ...patch, updatedAt: nowIso() });
  return getCase(caseId);
}
export function getClient(clientId) {
  return find('clients', (c) => c.id === clientId);
}

/* ── Intake fields (normalized, one row per case+key) ── */
// incoming: array of { key, value, confidence? } OR an object { key: value, ... }
export function upsertIntakeFields(caseId, incoming = [], source = 'call') {
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
    const existing = find('intakeFields', (r) => r.caseId === caseId && r.fieldKey === key);
    if (existing) {
      // Don't let a later blank overwrite an existing answered value.
      const keep = !isAnswered(value) && isAnswered(existing.value);
      updateWhere('intakeFields', (r) => r.id === existing.id, {
        value: keep ? existing.value : value,
        source,
        status: keep ? existing.status : status,
        confidence: item.confidence ?? existing.confidence,
        updatedAt: nowIso(),
      });
      saved.push(find('intakeFields', (r) => r.id === existing.id));
    } else {
      saved.push(
        insert(
          'intakeFields',
          newIntakeField({
            caseId, fieldKey: key, fieldLabel: cfg.label, value, source, status,
            required: cfg.required, confidence: item.confidence ?? null,
            clientFacing: cfg.clientFacing, staffOnly: cfg.staffOnly,
          })
        )
      );
    }
    headerPatch[key] = value;
  }

  // Mirror mapped keys onto the client/case header records.
  const theCase = getCase(caseId);
  if (theCase) {
    const clientPatch = {};
    for (const k of CLIENT_KEYS) if (k in headerPatch && isAnswered(headerPatch[k])) clientPatch[k] = headerPatch[k];
    if (Object.keys(clientPatch).length && theCase.clientId) {
      updateWhere('clients', (c) => c.id === theCase.clientId, { ...clientPatch, updatedAt: nowIso() });
    }
    const casePatch = {};
    for (const k of CASE_KEYS) if (k in headerPatch && isAnswered(headerPatch[k])) casePatch[k] = headerPatch[k];
    if (Object.keys(casePatch).length) updateCase(caseId, casePatch);
  }
  return saved;
}

// Current value map for a case (from intake field rows).
export function getCaseValues(caseId) {
  const values = {};
  for (const r of filter('intakeFields', (r) => r.caseId === caseId)) values[r.fieldKey] = r.value;
  return values;
}

// Required fields still missing, honoring conditional visibility (Step 4 modules).
export function getMissingFields(caseId) {
  const values = getCaseValues(caseId);
  return getRequiredFieldKeys()
    .map((key) => getFieldConfig(key))
    .filter((cfg) => isFieldVisible(cfg, values) && !isAnswered(values[cfg.key]))
    .map((cfg) => ({ key: cfg.key, label: cfg.label, step: cfg.step }));
}

/* ── Secure form token + prefilled payload ── */
export function generateIntakeToken(caseId) {
  const existing = getCase(caseId);
  if (existing?.formToken) return existing.formToken;
  const token = genToken();
  updateCase(caseId, { formToken: token });
  return token;
}

// Build the 5-step form payload with current values; hides staff-only fields and
// fields whose conditional module isn't active.
export function generatePrefilledFormPayload(token) {
  const theCase = getCaseByToken(token);
  if (!theCase) return null;
  const values = getCaseValues(theCase.id);
  const client = theCase.clientId ? getClient(theCase.clientId) : null;

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
    missingFields: getMissingFields(theCase.id),
    steps,
  };
}

// Recompute case status from required completeness (used after form submit).
export function recomputeCaseStatus(caseId) {
  const theCase = getCase(caseId);
  if (!theCase) return null;
  if (theCase.humanFollowUpNeeded) return updateCase(caseId, { status: CASE_STATUS.HUMAN_FOLLOW_UP_NEEDED });
  const missing = getMissingFields(caseId);
  return updateCase(caseId, {
    status: missing.length ? CASE_STATUS.WAITING_ON_CLIENT : CASE_STATUS.COMPLETED,
  });
}
