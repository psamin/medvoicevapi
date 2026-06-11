// CRM service — the domain logic behind the Vapi /tools/* endpoints. Operates on
// the local JSON dev DB via mockDb. When CRM_PROVIDER points at a real CRM later,
// this is the single module to swap out.
import {
  normalizePhone,
  listLeads,
  getLead,
  createLead,
  updateLead,
  findLeadByPhone,
  insert,
  find,
  filter,
} from '../db/mockDb.js';
import { REQUIRED_LEAD_FIELDS, computeMissingFields } from '../models.js';
import {
  newPerson,
  newCallReview,
  buildDocumentChecklist,
  normalizeEvidence,
} from './schema.js';

const norm = (s) => (s ? String(s).trim().toLowerCase() : '');

// ── Duplicate / returning-caller detection ──────────────────────────────────
// Returns { matchType: 'exact'|'possible'|'none', isReturningCaller, lead,
// matchedRecordId } WITHOUT leaking prior case details (caller verifies identity
// first; routes decide what to expose).
export function matchContact({ phone, name, email } = {}) {
  const leads = listLeads();
  const np = normalizePhone(phone);
  const ne = norm(email);

  // Exact: phone match (strongest signal), or email match.
  let exact = np ? leads.find((l) => normalizePhone(l.phone) === np) : null;
  if (!exact && ne) exact = leads.find((l) => norm(l.email) === ne);
  if (exact) {
    return { matchType: 'exact', isReturningCaller: true, lead: exact, matchedRecordId: exact.id };
  }

  // Possible: name match only (weak — needs identity confirmation).
  const nn = norm(name);
  if (nn) {
    const possible = leads.find((l) => norm(`${l.firstName ?? ''} ${l.lastName ?? ''}`).trim() === nn);
    if (possible) {
      return { matchType: 'possible', isReturningCaller: true, lead: possible, matchedRecordId: possible.id };
    }
  }

  return { matchType: 'none', isReturningCaller: false, lead: null, matchedRecordId: null };
}

// ── Opt-out ─────────────────────────────────────────────────────────────────
export function recordOptOut({ caller_phone, channel = 'call_or_sms', transcript_snippet = null, timestamp } = {}) {
  const lead = caller_phone ? findLeadByPhone(caller_phone) : null;
  const record = insert('optOuts', {
    id: `optout_${Date.now().toString(36)}`,
    leadId: lead?.id ?? null,
    phone: normalizePhone(caller_phone),
    channel,
    transcriptSnippet: transcript_snippet,
    createdAt: timestamp || new Date().toISOString(),
  });
  // Flag the lead so outbound workflows skip it.
  if (lead) updateLead(lead.id, { optedOut: true, leadStatus: 'opted_out' });
  return { optOut: record, leadId: lead?.id ?? null };
}

// Safety gate for any future outbound call/SMS workflow.
export function isOptedOut(phone, channel = null) {
  const np = normalizePhone(phone);
  if (!np) return false;
  const lead = findLeadByPhone(phone);
  if (lead?.optedOut) return true;
  const outs = filter('optOuts', (o) => o.phone === np);
  if (!outs.length) return false;
  if (!channel) return true;
  // call_or_sms covers both channels.
  return outs.some((o) => o.channel === channel || o.channel === 'call_or_sms');
}

// ── Consent ─────────────────────────────────────────────────────────────────
export function logConsent({ consent_type, granted, channel = 'verbal', caller_phone, transcript_snippet, lead_id } = {}) {
  const lead = lead_id ? getLead(lead_id) : caller_phone ? findLeadByPhone(caller_phone) : null;
  return insert('structuredConsents', {
    id: `consent_${Date.now().toString(36)}`,
    leadId: lead?.id ?? lead_id ?? null,
    consentType: consent_type ?? null, // ai_disclosure | recording | phone_followup | sms_followup
    granted: granted === true,
    channel,
    phone: normalizePhone(caller_phone),
    transcriptSnippet: transcript_snippet ?? null,
    createdAt: new Date().toISOString(),
  });
}

// ── Save intake (first call, verbal only) ────────────────────────────────────
// Upserts the lead/person (no duplicates), stores the structured record + related
// rows, queues documents_to_collect_later from evidence_exists, saves the call
// review, and returns missing required fields for follow-up.
export function saveIntake(fullRecord = {}, callReview = {}) {
  const caller = fullRecord.caller ?? fullRecord.person ?? {};
  const phone = caller.phone ?? fullRecord.phone ?? null;

  // Upsert lead by phone (dedupe).
  const existing = phone ? findLeadByPhone(phone) : null;
  const leadFields = {
    firstName: caller.firstName, lastName: caller.lastName, phone,
    email: caller.email, preferredLanguage: caller.preferredLanguage,
    state: fullRecord.incident?.state ?? fullRecord.state,
    city: fullRecord.incident?.city ?? fullRecord.city,
    accidentDate: fullRecord.incident?.date ?? fullRecord.accidentDate,
    accidentType: fullRecord.incident?.type ?? fullRecord.accidentType,
    injured: fullRecord.injured ?? (Array.isArray(fullRecord.injuries) ? fullRecord.injuries.length > 0 : undefined),
    medicalTreatmentReceived: fullRecord.medicalTreatmentReceived ?? fullRecord.treatment?.received,
    hasAttorney: fullRecord.hasAttorney,
    insuranceInfo: fullRecord.insurance?.summary ?? fullRecord.insuranceInfo,
    policeReport: fullRecord.evidence?.policeReport != null ? String(fullRecord.evidence.policeReport) : fullRecord.policeReport,
    caseSummary: fullRecord.caseSummary ?? fullRecord.incident?.narrative,
  };
  // Drop undefined so we don't clobber existing values.
  const cleanFields = Object.fromEntries(Object.entries(leadFields).filter(([, v]) => v !== undefined));

  let lead;
  let duplicate = false;
  if (existing) {
    duplicate = true;
    lead = updateLead(existing.id, { ...cleanFields, previousCallCount: existing.previousCallCount + 1 });
  } else {
    lead = createLead({ ...cleanFields, leadStatus: 'in_progress' });
  }

  // Person record.
  insert('persons', newPerson({ leadId: lead.id, ...caller, phone }));

  // Structured intake record (full snapshot, verbal).
  const intakeRecord = insert('intakeRecords', {
    id: `intake_${Date.now().toString(36)}`,
    leadId: lead.id,
    record: fullRecord,
    createdAt: new Date().toISOString(),
  });

  // Related rows (kept simple: store what was provided).
  if (fullRecord.incident) insert('incidents', { id: `inc_${Date.now().toString(36)}`, leadId: lead.id, ...fullRecord.incident });
  for (const inj of fullRecord.injuries ?? []) insert('injuries', { id: `inj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`, leadId: lead.id, ...(typeof inj === 'string' ? { description: inj } : inj) });
  if (fullRecord.treatment) insert('treatments', { id: `tx_${Date.now().toString(36)}`, leadId: lead.id, ...fullRecord.treatment });
  if (fullRecord.insurance) insert('insurances', { id: `ins_${Date.now().toString(36)}`, leadId: lead.id, ...fullRecord.insurance });
  for (const w of fullRecord.witnesses ?? []) insert('witnesses', { id: `wit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`, leadId: lead.id, ...(typeof w === 'string' ? { description: w } : w) });

  // evidence_exists → documents_to_collect_later (files NOT required now).
  const evidence = normalizeEvidence(fullRecord.evidence ?? {});
  const documents = buildDocumentChecklist(lead.id, evidence);
  for (const doc of documents) insert('documentsToCollect', doc);

  // Call review / post-call scoring.
  const missingFields = computeMissingFields(lead, REQUIRED_LEAD_FIELDS);
  const review = insert('callReviews', newCallReview({ ...callReview, missingFields }, lead.id));

  // Disqualify already-represented callers; flag emergencies as urgent.
  let leadStatus = missingFields.length ? 'in_progress' : 'complete';
  if (lead.hasAttorney === true) leadStatus = 'disqualified_represented';
  if (callReview.urgencyFlag === 'emergency') leadStatus = 'urgent';
  updateLead(lead.id, { leadStatus, leadQualityScore: callReview.intakeCompleteness ?? lead.leadQualityScore ?? null });

  return {
    leadId: lead.id,
    duplicate,
    lead: getLead(lead.id),
    intakeRecordId: intakeRecord.id,
    evidenceExists: evidence,
    documentsToCollect: documents,
    callReviewId: review.id,
    missingFields,
  };
}
