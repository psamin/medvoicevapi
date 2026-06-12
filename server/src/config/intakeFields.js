// Centralized intake field config — single source of truth for the 5-step intake
// form, what the voice call captures, and how missing fields are computed.
// (Repo is JavaScript/ESM, so this is intakeFields.js, not .ts.)
//
// Each field: key, label, step, section, type, required, options, source,
// status, confidence, clientFacing, staffOnly, sensitive, visibleWhen, helpText.

// helper to keep the list readable
function f(key, label, opts = {}) {
  return {
    key,
    label,
    step: opts.step ?? 1,
    section: opts.section ?? '',
    type: opts.type ?? 'text', // text|textarea|tel|email|date|time|select|boolean|number
    required: opts.required ?? false,
    options: opts.options ?? null, // for type 'select'
    source: opts.source ?? null, // call|form|staff|outbound_call (set when captured)
    status: 'missing', // missing|partial|complete (per-case, computed at runtime)
    confidence: null,
    clientFacing: opts.clientFacing ?? true,
    staffOnly: opts.staffOnly ?? false,
    sensitive: opts.sensitive ?? false,
    visibleWhen: opts.visibleWhen ?? null, // { field, equals }
    helpText: opts.helpText ?? null,
  };
}

export const ACCIDENT_TYPES = [
  'Motor Vehicle Accident',
  'Premises Liability',
  'Workplace Injury',
  'Other',
];

export const INTAKE_FIELDS = [
  // ── Call-meta (not on the client form) ──
  f('consentToContinue', 'Consent to continue', { step: 0, section: 'Call', type: 'boolean', clientFacing: false }),
  f('bestTimeToCall', 'Best time to call', { step: 0, section: 'Call', clientFacing: false }),
  f('humanFollowUpNeeded', 'Human follow-up needed', { step: 0, section: 'Call', type: 'boolean', clientFacing: false }),

  // ── STEP 1: Patient ──
  f('firstName', 'First name', { step: 1, section: 'Client Information', required: true }),
  f('lastName', 'Last name', { step: 1, section: 'Client Information', required: true }),
  f('dateOfBirth', 'Date of birth', { step: 1, section: 'Client Information', type: 'date' }),
  f('phone', 'Phone', { step: 1, section: 'Client Information', type: 'tel', required: true }),
  f('email', 'Email', { step: 1, section: 'Client Information', type: 'email', required: true }),
  f('ssnLast4', 'SSN (last 4)', { step: 1, section: 'Client Information', sensitive: true, helpText: 'Last 4 digits only.' }),
  f('address', 'Street address', { step: 1, section: 'Client Information' }),
  f('city', 'City', { step: 1, section: 'Client Information' }),
  f('state', 'State', { step: 1, section: 'Client Information' }),
  f('zip', 'ZIP', { step: 1, section: 'Client Information' }),
  f('maritalStatus', 'Marital status', { step: 1, section: 'Client Information', type: 'select', options: ['Single', 'Married', 'Divorced', 'Widowed', 'Other'] }),
  f('sex', 'Sex', { step: 1, section: 'Client Information', type: 'select', options: ['Female', 'Male', 'Other', 'Prefer not to say'] }),
  f('preferredContact', 'Preferred contact method', { step: 1, section: 'Client Information', type: 'select', options: ['Phone', 'Email', 'Text'] }),
  f('primaryLanguage', 'Primary language', { step: 1, section: 'Client Information' }),
  f('pcpName', 'Primary care provider name', { step: 1, section: 'Primary Care Provider' }),
  f('pcpPhone', 'PCP phone', { step: 1, section: 'Primary Care Provider', type: 'tel' }),
  f('pcpAddress', 'PCP address', { step: 1, section: 'Primary Care Provider' }),

  // ── STEP 2: Incident ──
  f('accidentDate', 'Accident date', { step: 2, section: 'Accident Details', type: 'date', required: true }),
  f('accidentTime', 'Accident time', { step: 2, section: 'Accident Details', type: 'time' }),
  f('accidentType', 'Accident type', { step: 2, section: 'Accident Details', type: 'select', options: ACCIDENT_TYPES, required: true }),
  f('accidentState', 'Accident state', { step: 2, section: 'Accident Details', required: true }),
  f('accidentCounty', 'Accident county', { step: 2, section: 'Accident Details' }),
  f('accidentCity', 'Accident city', { step: 2, section: 'Accident Details', required: true }),
  f('accidentSpecificLocation', 'Specific location', { step: 2, section: 'Accident Details', helpText: 'Intersection, business, or property name.' }),
  f('accidentDescription', 'What happened', { step: 2, section: 'Accident Details', type: 'textarea', required: true }),
  f('lightingTimeContext', 'Lighting / time context', { step: 2, section: 'Accident Details' }),
  f('weatherSurface', 'Weather / surface', { step: 2, section: 'Accident Details' }),
  f('policeReportFiled', 'Police report filed?', { step: 2, section: 'Accident Details', type: 'boolean' }),
  f('policeReportNumber', 'Police report number', { step: 2, section: 'Accident Details', visibleWhen: { field: 'policeReportFiled', equals: true } }),
  f('policeAgency', 'Police agency', { step: 2, section: 'Accident Details', visibleWhen: { field: 'policeReportFiled', equals: true } }),
  f('witnesses', 'Witnesses?', { step: 2, section: 'Accident Details', type: 'boolean' }),
  f('witnessCount', 'Witness count', { step: 2, section: 'Accident Details', type: 'number', visibleWhen: { field: 'witnesses', equals: true } }),
  f('videoExists', 'Video exists?', { step: 2, section: 'Accident Details', type: 'boolean' }),
  f('videoHolder', 'Who has the video', { step: 2, section: 'Accident Details', visibleWhen: { field: 'videoExists', equals: true } }),

  // ── STEP 3: Treatment ──
  f('wentToErUrgentCare', 'Went to ER / urgent care?', { step: 3, section: 'Post-Accident Treatment', type: 'boolean' }),
  f('dateOfFirstVisit', 'Date of first visit', { step: 3, section: 'Post-Accident Treatment', type: 'date' }),
  f('imagingDone', 'Imaging done (X-ray/MRI/CT)?', { step: 3, section: 'Post-Accident Treatment', type: 'boolean' }),
  f('surgeriesRecommendedProcedures', 'Surgeries / recommended procedures', { step: 3, section: 'Post-Accident Treatment', type: 'textarea' }),
  f('missedWorkSchool', 'Missed work / school?', { step: 3, section: 'Post-Accident Treatment', type: 'boolean' }),
  f('medicalBillsToDate', 'Medical bills to date', { step: 3, section: 'Post-Accident Treatment' }),
  f('healthInsurancePaid', 'Health insurance paid?', { step: 3, section: 'Post-Accident Treatment', type: 'boolean' }),
  f('otherClaimsValue', 'Other claims value', { step: 3, section: 'Post-Accident Treatment' }),
  f('injurySummary', 'Injury summary', { step: 3, section: 'Post-Accident Treatment', type: 'textarea', required: true }),
  f('treatmentStatus', 'Treatment status', { step: 3, section: 'Post-Accident Treatment', type: 'select', options: ['Not treated', 'Treating now', 'Finished treatment'] }),

  // ── STEP 4: Conditional modules (by accidentType) ──
  // Premises Liability
  f('premisesCauseOfFallOrInjury', 'Cause of fall / injury', { step: 4, section: 'Premises Liability', type: 'textarea', visibleWhen: { field: 'accidentType', equals: 'Premises Liability' } }),
  f('premisesHazardVisibleMarked', 'Hazard visible / marked?', { step: 4, section: 'Premises Liability', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Premises Liability' } }),
  f('premisesLightingAtLocation', 'Lighting at location', { step: 4, section: 'Premises Liability', visibleWhen: { field: 'accidentType', equals: 'Premises Liability' } }),
  f('premisesOwnerKnewAboutHazard', 'Owner knew about hazard?', { step: 4, section: 'Premises Liability', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Premises Liability' } }),
  f('premisesCamerasPresent', 'Cameras present?', { step: 4, section: 'Premises Liability', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Premises Liability' } }),
  // Motor Vehicle Accident
  f('mvaDriverPassengerPedestrian', 'Driver / passenger / pedestrian', { step: 4, section: 'Motor Vehicle Accident', type: 'select', options: ['Driver', 'Passenger', 'Pedestrian', 'Cyclist'], visibleWhen: { field: 'accidentType', equals: 'Motor Vehicle Accident' } }),
  f('mvaVehiclesInvolved', 'Vehicles involved', { step: 4, section: 'Motor Vehicle Accident', type: 'number', visibleWhen: { field: 'accidentType', equals: 'Motor Vehicle Accident' } }),
  f('mvaAtFaultParty', 'At-fault party', { step: 4, section: 'Motor Vehicle Accident', visibleWhen: { field: 'accidentType', equals: 'Motor Vehicle Accident' } }),
  f('mvaSeatbeltUsed', 'Seatbelt used?', { step: 4, section: 'Motor Vehicle Accident', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Motor Vehicle Accident' } }),
  f('mvaAirbagsDeployed', 'Airbags deployed?', { step: 4, section: 'Motor Vehicle Accident', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Motor Vehicle Accident' } }),
  f('mvaVehicleDrivable', 'Vehicle drivable?', { step: 4, section: 'Motor Vehicle Accident', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Motor Vehicle Accident' } }),
  // Workplace Injury
  f('workplaceEmployerName', 'Employer name', { step: 4, section: 'Workplace Injury', visibleWhen: { field: 'accidentType', equals: 'Workplace Injury' } }),
  f('workplaceReportedToEmployer', 'Reported to employer?', { step: 4, section: 'Workplace Injury', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Workplace Injury' } }),
  f('workplaceReportDate', 'Report date', { step: 4, section: 'Workplace Injury', type: 'date', visibleWhen: { field: 'accidentType', equals: 'Workplace Injury' } }),
  f('workplaceSupervisorName', 'Supervisor name', { step: 4, section: 'Workplace Injury', visibleWhen: { field: 'accidentType', equals: 'Workplace Injury' } }),
  f('workplaceWorkersCompClaim', 'Workers comp claim?', { step: 4, section: 'Workplace Injury', type: 'boolean', visibleWhen: { field: 'accidentType', equals: 'Workplace Injury' } }),
  f('workplaceJobDuties', 'Job duties', { step: 4, section: 'Workplace Injury', type: 'textarea', visibleWhen: { field: 'accidentType', equals: 'Workplace Injury' } }),

  // ── STEP 5: Coverage ──
  f('insuranceCarrier', 'Insurance carrier', { step: 5, section: 'Insurance Information' }),
  f('policyNumber', 'Policy number', { step: 5, section: 'Insurance Information' }),
  f('claimNumber', 'Claim number', { step: 5, section: 'Insurance Information' }),
  f('coverageLimit', 'Coverage limit', { step: 5, section: 'Insurance Information' }),
  f('leadAttorney', 'Lead attorney', { step: 5, section: 'Attorney Assignment', clientFacing: false, staffOnly: true }),
  f('paralegal', 'Paralegal', { step: 5, section: 'Attorney Assignment', clientFacing: false, staffOnly: true }),
  f('additionalNotes', 'Additional notes', { step: 5, section: 'Notes', type: 'textarea' }),
];

// Fields the voice call should prioritize collecting (order matters).
export const CALL_PRIORITY_FIELDS = [
  'consentToContinue', 'firstName', 'lastName', 'phone', 'email', 'accidentType',
  'accidentDate', 'accidentState', 'accidentCity', 'accidentSpecificLocation',
  'accidentDescription', 'injurySummary', 'wentToErUrgentCare', 'treatmentStatus',
  'policeReportFiled', 'insuranceCarrier', 'policyNumber', 'claimNumber',
  'preferredContact', 'primaryLanguage', 'bestTimeToCall', 'humanFollowUpNeeded',
];

const BY_KEY = new Map(INTAKE_FIELDS.map((f) => [f.key, f]));
export const SENSITIVE_FIELD_KEYS = INTAKE_FIELDS.filter((f) => f.sensitive).map((f) => f.key);
export const STAFF_ONLY_FIELD_KEYS = INTAKE_FIELDS.filter((f) => f.staffOnly).map((f) => f.key);

export function getFieldConfig(key) {
  return BY_KEY.get(key) || null;
}
export function isKnownField(key) {
  return BY_KEY.has(key);
}
export function getRequiredFieldKeys() {
  return INTAKE_FIELDS.filter((f) => f.required).map((f) => f.key);
}
export function getClientFacingFields() {
  return INTAKE_FIELDS.filter((f) => f.clientFacing);
}

// Is a field visible given the current values (handles conditional Step 4 modules)?
export function isFieldVisible(field, values = {}) {
  if (!field.visibleWhen) return true;
  return values[field.visibleWhen.field] === field.visibleWhen.equals;
}

// Strip sensitive field values for safe logging.
export function redactSensitive(values = {}) {
  const out = { ...values };
  for (const k of SENSITIVE_FIELD_KEYS) if (k in out) out[k] = '***';
  return out;
}

export default INTAKE_FIELDS;
