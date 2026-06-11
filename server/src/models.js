// Data models for the mock CRM. Plain JS factories — no ORM, no validation
// library — so the shapes are easy to read and easy to test.

// Fields a lead must have before it is "complete" enough for human review.
// The state machine and detectMissingFields tool both use this list.
export const REQUIRED_LEAD_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'state',
  'city',
  'accidentDate',
  'accidentType',
  'injured',
  'medicalTreatmentReceived',
  'hasAttorney',
  'caseSummary',
];

// Optional fields — captured when available but never block completion.
export const OPTIONAL_LEAD_FIELDS = ['insuranceInfo', 'policeReport', 'preferredLanguage'];

let counter = 0;
function genId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

// Returns true when a field value counts as "answered". `false` is a valid
// answer (e.g. injured=false), so only null/undefined/'' count as missing.
export function isAnswered(value) {
  return value !== null && value !== undefined && value !== '';
}

// Compute which required fields are still missing on a lead-like object.
export function computeMissingFields(lead, fields = REQUIRED_LEAD_FIELDS) {
  return fields.filter((f) => !isAnswered(lead?.[f]));
}

export function newLead(input = {}) {
  const now = new Date().toISOString();
  const lead = {
    id: input.id || genId('lead'),
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    preferredLanguage: input.preferredLanguage ?? null,
    state: input.state ?? null,
    city: input.city ?? null,
    accidentDate: input.accidentDate ?? null,
    accidentType: input.accidentType ?? null,
    injured: input.injured ?? null,
    medicalTreatmentReceived: input.medicalTreatmentReceived ?? null,
    hasAttorney: input.hasAttorney ?? null,
    insuranceInfo: input.insuranceInfo ?? null,
    policeReport: input.policeReport ?? null,
    caseSummary: input.caseSummary ?? null,
    missingFields: [],
    leadStatus: input.leadStatus ?? 'new', // new | in_progress | complete | opted_out | escalated
    leadQualityScore: input.leadQualityScore ?? null,
    optedOut: input.optedOut ?? false,
    previousCallCount: input.previousCallCount ?? 0,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  lead.missingFields = computeMissingFields(lead);
  return lead;
}

export function newCall(input = {}) {
  return {
    id: input.id || genId('call'),
    leadId: input.leadId ?? null,
    phone: input.phone ?? null,
    botVersion: input.botVersion ?? null,
    transcript: input.transcript ?? null,
    outcome: input.outcome ?? null,
    leadQuality: input.leadQuality ?? null, // low | medium | high
    callerSentiment: input.callerSentiment ?? null, // positive | neutral | negative
    confusionDetected: input.confusionDetected ?? false,
    unhappyDetected: input.unhappyDetected ?? false,
    missingInfo: input.missingInfo ?? [],
    callScore: input.callScore ?? null,
    failureReason: input.failureReason ?? null,
    recommendedNextAction: input.recommendedNextAction ?? null,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}
