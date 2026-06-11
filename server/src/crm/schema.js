// Schema + factories for the richer CRM model. First-call intake is VERBAL ONLY:
// we record WHETHER a document/evidence exists, and queue it in
// documents_to_collect_later for a follow-up workflow — we never require the files.
import { isAnswered } from '../models.js';

let seq = 0;
export function genId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

const nowIso = () => new Date().toISOString();

// Standard PI document checklist. `existsKey` maps to the evidence_exists flags
// captured verbally on the first call, so we only queue docs that actually exist.
export const DOCUMENT_TYPES = [
  { type: 'government_id', label: 'Government ID', existsKey: null, required: true },
  { type: 'insurance_card', label: 'Insurance card', existsKey: 'insuranceCard', required: true },
  { type: 'police_report', label: 'Police report', existsKey: 'policeReport', required: false },
  { type: 'accident_photos', label: 'Accident / injury photos', existsKey: 'photos', required: false },
  { type: 'medical_records', label: 'Medical records', existsKey: 'medicalRecords', required: false },
  { type: 'medical_bills', label: 'Medical bills', existsKey: 'medicalBills', required: false },
  { type: 'vehicle_repair_estimate', label: 'Vehicle repair estimate', existsKey: 'repairEstimate', required: false },
  { type: 'lost_wage_documentation', label: 'Lost-wage documentation', existsKey: 'lostWages', required: false },
  { type: 'dashcam_or_video', label: 'Dashcam / video footage', existsKey: 'video', required: false },
  { type: 'witness_contact_info', label: 'Witness contact info', existsKey: 'witnesses', required: false },
];

// The evidence_exists flags we try to capture verbally on the first call.
export const EVIDENCE_KEYS = [
  'policeReport', 'photos', 'medicalRecords', 'medicalBills', 'repairEstimate',
  'lostWages', 'video', 'witnesses', 'insuranceCard',
];

export function newPerson(input = {}) {
  return {
    id: input.id || genId('person'),
    leadId: input.leadId ?? null,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    preferredLanguage: input.preferredLanguage ?? null,
    isInjuredParty: input.isInjuredParty ?? true,
    relationshipToInjured: input.relationshipToInjured ?? null,
    createdAt: input.createdAt || nowIso(),
  };
}

export function newDocumentToCollect(input = {}) {
  return {
    id: input.id || genId('doc'),
    leadId: input.leadId ?? null,
    type: input.type ?? 'other',
    label: input.label ?? input.type ?? 'Document',
    required: input.required ?? false,
    exists: input.exists ?? null, // does the caller say it exists? (verbal, first call)
    status: input.status ?? 'pending', // pending | received | waived
    notes: input.notes ?? null,
    createdAt: input.createdAt || nowIso(),
  };
}

// Build the documents_to_collect_later list from the verbally-reported evidence.
// Required docs are always queued; optional docs only when the caller says they exist.
export function buildDocumentChecklist(leadId, evidence = {}) {
  return DOCUMENT_TYPES.filter((d) => d.required || (d.existsKey && evidence[d.existsKey] === true)).map((d) =>
    newDocumentToCollect({
      leadId,
      type: d.type,
      label: d.label,
      required: d.required,
      exists: d.existsKey ? evidence[d.existsKey] ?? null : null,
    })
  );
}

// Normalize the evidence_exists object to only known boolean-ish keys.
export function normalizeEvidence(evidence = {}) {
  const out = {};
  for (const k of EVIDENCE_KEYS) {
    if (isAnswered(evidence[k])) out[k] = evidence[k] === true || evidence[k] === 'true';
  }
  return out;
}

export function newCallReview(input = {}, leadId = null) {
  return {
    id: input.id || genId('review'),
    leadId,
    botVersion: input.botVersion ?? null,
    intakeCompleteness: input.intakeCompleteness ?? null,
    leadQuality: input.leadQuality ?? null,
    callerSentiment: input.callerSentiment ?? null,
    confusionDetected: input.confusionDetected ?? false,
    unhappyDetected: input.unhappyDetected ?? false,
    elderlyOrConfusedFlag: input.elderlyOrConfusedFlag ?? false,
    missingFields: input.missingFields ?? [],
    failureReason: input.failureReason ?? null,
    recommendedNextAction: input.recommendedNextAction ?? null,
    urgencyFlag: input.urgencyFlag ?? null,
    createdAt: input.createdAt || nowIso(),
  };
}
