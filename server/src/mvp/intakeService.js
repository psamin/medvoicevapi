// Core MedVoice intake services: clients, cases, normalized intake fields,
// missing-field calc, secure form tokens, and prefilled-form payloads.
// All persistence goes through repo.js (Postgres or JSON dev store), so these
// functions are async regardless of backend.
import repo from './repo.js';
import { newClient, newCase, newIntakeField, newRequiredDocument, genToken, CASE_STATUS, TASK_TYPE } from './models.js';
import { ensureTask } from '../crm/tasks.js';
import { recordAudit, auditStatusChange } from '../crm/audit.js';
import {
  getFieldConfig,
  isKnownField,
  getRequiredFieldKeys,
  isFieldVisible,
  INTAKE_FIELDS,
} from '../config/intakeFields.js';
import {
  REQUIRED_DOCUMENTS,
  REQUIRED_DOC_TYPES,
  getDocConfig,
  DOC_STATUS,
  DOC_SATISFIED_STATUSES,
} from '../config/documents.js';

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
  const created = await repo.cases.save(newCase({ clientId, status: CASE_STATUS.IN_PROGRESS, ...patch }));
  await seedRequiredDocuments(created.id);
  return created;
}

/* ── Documents ── */
// Seed the document checklist for a case (idempotent).
export async function seedRequiredDocuments(caseId) {
  for (const d of REQUIRED_DOCUMENTS) {
    const existing = await repo.requiredDocuments.findByCaseAndType(caseId, d.type);
    if (!existing) {
      await repo.requiredDocuments.save(newRequiredDocument({ caseId, docType: d.type, label: d.label, required: d.required }));
    }
  }
}

export async function listDocuments(caseId) {
  return repo.requiredDocuments.listByCase(caseId);
}

// Look up (or lazily build) the checklist row for a document type.
async function getOrBuildDoc(caseId, docType) {
  const cfg = getDocConfig(docType);
  if (!cfg) return null; // ignore unknown document types
  return (
    (await repo.requiredDocuments.findByCaseAndType(caseId, docType)) ||
    newRequiredDocument({ caseId, docType, label: cfg.label, required: cfg.required })
  );
}

// Record an uploaded document (client form). url can be a filename/URL placeholder.
// An upload always creates a document-review task for a case manager.
export async function recordDocumentUpload(caseId, docType, url, fileName = null) {
  const existing = await getOrBuildDoc(caseId, docType);
  if (!existing) return null;
  const ts = nowIso();
  const fileUrl = url ?? existing.fileUrl ?? existing.uploadedFileUrl ?? 'uploaded';
  const saved = await repo.requiredDocuments.save({
    ...existing, status: DOC_STATUS.RECEIVED, fileUrl, uploadedFileUrl: fileUrl,
    fileName: fileName ?? existing.fileName ?? null, unavailableReason: null,
    uploadedAt: ts, receivedAt: ts, updatedAt: ts,
  });
  await recordAudit({
    actorType: 'client', action: 'document_status_changed', entityType: 'document', entityId: saved.id,
    caseId, oldValue: { status: existing.status }, newValue: { status: DOC_STATUS.RECEIVED },
  });
  await ensureTask(
    { caseId, type: TASK_TYPE.REVIEW_DOCUMENT, title: 'Review uploaded document(s)', description: `Client uploaded ${saved.label}.` },
    { actorType: 'client' }
  );
  return saved;
}

// Client says "I don't have access to this document right now." It stops counting
// as missing, but the case is flagged for case-manager review (see recompute).
export async function markDocumentUnavailable(caseId, docType, reason = null) {
  const existing = await getOrBuildDoc(caseId, docType);
  if (!existing) return null;
  const saved = await repo.requiredDocuments.save({
    ...existing, status: DOC_STATUS.NOT_AVAILABLE, fileUrl: null, uploadedFileUrl: null,
    unavailableReason: reason ?? existing.unavailableReason ?? null, uploadedAt: null, updatedAt: nowIso(),
  });
  await recordAudit({
    actorType: 'client', action: 'document_status_changed', entityType: 'document', entityId: saved.id,
    caseId, oldValue: { status: existing.status }, newValue: { status: DOC_STATUS.NOT_AVAILABLE, reason: saved.unavailableReason },
  });
  return saved;
}

// Undo: client unchecks "no access" without uploading → back to pending (missing).
// Never clobbers a document that was actually received.
export async function markDocumentMissing(caseId, docType) {
  const existing = await repo.requiredDocuments.findByCaseAndType(caseId, docType);
  if (!existing || existing.status === DOC_STATUS.RECEIVED) return existing ?? null;
  return repo.requiredDocuments.save({ ...existing, status: DOC_STATUS.PENDING, updatedAt: nowIso() });
}

// Required documents that still block completion (not received / not marked unavailable).
export async function getMissingDocuments(caseId) {
  const docs = await repo.requiredDocuments.listByCase(caseId);
  const byType = new Map(docs.map((d) => [d.docType, d]));
  return REQUIRED_DOC_TYPES
    .filter((t) => !DOC_SATISFIED_STATUSES.includes(byType.get(t)?.status ?? DOC_STATUS.PENDING))
    .map((t) => ({ type: t, label: getDocConfig(t)?.label ?? t }));
}

// Required documents the client marked `not_available` — a case manager must obtain
// these even though they no longer block the client's side of the intake.
export async function getUnavailableRequiredDocuments(caseId) {
  const docs = await repo.requiredDocuments.listByCase(caseId);
  return docs
    .filter((d) => REQUIRED_DOC_TYPES.includes(d.docType) && d.status === DOC_STATUS.NOT_AVAILABLE)
    .map((d) => ({ type: d.docType, label: d.label }));
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
  await recordAudit({
    actorType: 'system', action: 'possible_duplicate_flagged', entityType: 'case', entityId: caseId,
    caseId, clientId: client.id, newValue: { duplicateOfClientId: sameName[0].id },
  });
  await ensureTask(
    {
      caseId, clientId: client.id, type: TASK_TYPE.DUPLICATE_REVIEW, priority: 'high',
      title: 'Review possible duplicate client',
      description: `Same name as ${sameName[0].firstName ?? ''} ${sameName[0].lastName ?? ''} (${sameName[0].phone ?? 'no phone'}).`,
    },
    { actorType: 'system' }
  );
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
        required: cfg.required, allowNA: cfg.allowNA, category: cfg.category,
        confidence: item.confidence ?? null,
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

// Mark an AI-extracted / client-submitted field as human-verified by a case manager
// or attorney. Keeps the AI-vs-human provenance distinction explicit.
export async function verifyIntakeField(caseId, fieldKey, userId = null, role = 'case_manager_verified') {
  const existing = await repo.intakeFields.findByCaseAndKey(caseId, fieldKey);
  if (!existing) return null;
  const saved = await repo.intakeFields.save({
    ...existing, verifiedByHuman: true, verifiedByUserId: userId, verifiedAt: nowIso(), source: role, updatedAt: nowIso(),
  });
  await recordAudit({
    actorType: 'user', actorId: userId, action: 'intake_field_verified', entityType: 'intake_field', entityId: saved.id,
    caseId, oldValue: { verifiedByHuman: existing.verifiedByHuman }, newValue: { verifiedByHuman: true, by: userId },
  });
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

  const documents = (await repo.requiredDocuments.listByCase(theCase.id)).map((d) => ({
    type: d.docType, label: d.label, required: d.required, status: d.status, uploadedFileUrl: d.uploadedFileUrl,
  }));

  return {
    token,
    caseId: theCase.id,
    status: theCase.status,
    accidentType: theCase.accidentType,
    client: client ? { firstName: client.firstName, lastName: client.lastName, email: client.email } : null,
    missingFields: await getMissingFields(theCase.id),
    missingDocuments: await getMissingDocuments(theCase.id),
    documents,
    steps,
  };
}

// Recompute case status from required completeness (used after form submit).
//
// Lifecycle: while any required FIELD or required DOCUMENT is still outstanding the
// case sits in `missing_info` (the only state the follow-up job acts on). Once the
// client's side is done it moves to `ready_for_case_manager` — the confirmation
// email fires, a `review_intake` task is created, and the case is handed off.
//
// A required document marked `not_available` no longer blocks completion, so the
// client never stays stuck over a document they can't access; `documentsPendingReview`
// is raised instead so a case manager obtains it later.
export async function recomputeCaseStatus(caseId) {
  const theCase = await repo.cases.findById(caseId);
  if (!theCase) return null;
  const from = theCase.status;

  if (theCase.humanFollowUpNeeded) {
    const updated = await updateCase(caseId, {
      status: CASE_STATUS.CASE_MANAGER_REVIEW,
      caseManagerHandoffRequired: true,
      caseManagerHandoffReason: theCase.caseManagerHandoffReason ?? 'flagged during call',
      caseManagerHandoffAt: theCase.caseManagerHandoffAt ?? new Date().toISOString(),
    });
    await auditStatusChange({ caseId, clientId: theCase.clientId, from, to: updated.status });
    await ensureTask(
      { caseId, clientId: theCase.clientId, type: TASK_TYPE.REVIEW_INTAKE, priority: 'high', title: 'Review intake (flagged on call)' },
      { actorType: 'system' }
    );
    return updated;
  }

  const missing = await getMissingFields(caseId);
  const missingDocs = await getMissingDocuments(caseId);
  if (missing.length || missingDocs.length) {
    const updated = await updateCase(caseId, { status: CASE_STATUS.MISSING_INFO });
    await auditStatusChange({ caseId, clientId: theCase.clientId, from, to: updated.status });
    return updated;
  }

  // Client side complete → hand off to a case manager.
  const unavailableDocs = await getUnavailableRequiredDocuments(caseId);
  const updated = await updateCase(caseId, {
    status: CASE_STATUS.READY_FOR_CASE_MANAGER,
    completedAt: new Date().toISOString(),
    documentsPendingReview: unavailableDocs.length > 0,
    caseManagerHandoffRequired: true,
    caseManagerHandoffReason: unavailableDocs.length ? 'intake complete; documents pending review' : 'intake complete',
    caseManagerHandoffAt: new Date().toISOString(),
  });
  await auditStatusChange({ caseId, clientId: theCase.clientId, from, to: updated.status });
  await ensureTask(
    {
      caseId, clientId: theCase.clientId, type: TASK_TYPE.REVIEW_INTAKE,
      title: 'Review completed intake',
      description: unavailableDocs.length ? `Documents pending: ${unavailableDocs.map((d) => d.label).join(', ')}.` : 'Intake complete — ready for case manager.',
    },
    { actorType: 'system' }
  );
  return updated;
}
