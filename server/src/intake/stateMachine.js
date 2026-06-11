// Deterministic intake state machine.
//
// The LLM prompt leads the conversation, but this module is the source of truth
// for "what stage are we in and what must be asked next" — so the agent can't
// skip required fields, forget opt-out, or mishandle returning callers even if
// the model drifts. It is a PURE function of (lead data + call flags): no I/O,
// no side effects, trivially testable.
import { REQUIRED_LEAD_FIELDS, computeMissingFields, isAnswered } from '../models.js';

export const STATES = [
  'greeting',
  'disclosure_and_consent',
  'opt_out_check',
  'phone_lookup',
  'returning_lead_confirmation',
  'new_lead_creation',
  'intake_name',
  'intake_contact',
  'intake_location',
  'intake_accident_date',
  'intake_accident_type',
  'intake_injury',
  'intake_treatment',
  'intake_attorney_status',
  'intake_insurance',
  'intake_police_report',
  'intake_case_summary',
  'missing_info_review',
  'final_summary',
  'post_call_analysis',
  'complete',
  'human_escalation',
];

// Pre-intake phase gates. Each advances once `done(ctx)` is true.
const PHASE_GATES = [
  { state: 'greeting', done: (c) => c.greeted },
  { state: 'disclosure_and_consent', done: (c) => c.consentGiven },
  { state: 'opt_out_check', done: (c) => c.optOutOffered },
  { state: 'phone_lookup', done: (c) => c.phoneLookedUp },
  { state: 'returning_lead_confirmation', done: (c) => !c.isReturning || c.identityConfirmed },
  { state: 'new_lead_creation', done: (c) => c.isReturning || !!c.lead?.id },
];

// Ordered intake steps. Required steps block until answered; optional steps can
// be skipped (ctx.skipOptional) and never block reaching the review stage.
const INTAKE_STEPS = [
  { state: 'intake_name', fields: ['firstName', 'lastName'] },
  { state: 'intake_contact', fields: ['phone', 'email'] },
  { state: 'intake_location', fields: ['state', 'city'] },
  { state: 'intake_accident_date', fields: ['accidentDate'] },
  { state: 'intake_accident_type', fields: ['accidentType'] },
  { state: 'intake_injury', fields: ['injured'] },
  { state: 'intake_treatment', fields: ['medicalTreatmentReceived'] },
  { state: 'intake_attorney_status', fields: ['hasAttorney'] },
  { state: 'intake_insurance', fields: ['insuranceInfo'], optional: true },
  { state: 'intake_police_report', fields: ['policeReport'], optional: true },
  { state: 'intake_case_summary', fields: ['caseSummary'] },
];

const CLOSING_GATES = [
  { state: 'missing_info_review', done: (c) => c.reviewDone },
  { state: 'final_summary', done: (c) => c.summaryConfirmed },
  { state: 'post_call_analysis', done: (c) => c.analysisSaved },
];

// Suggested next question per field (the LLM phrases it naturally; this is a hint).
export const FIELD_QUESTIONS = {
  firstName: 'May I get your first and last name?',
  lastName: 'And your last name?',
  phone: 'What is the best phone number to reach you?',
  email: 'What email address should we use for you?',
  state: 'Which state did the accident happen in?',
  city: 'And which city?',
  accidentDate: 'What date did the accident happen?',
  accidentType: 'What kind of accident was it — for example a car crash, a fall, or something else?',
  injured: 'Were you injured in the accident?',
  medicalTreatmentReceived: 'Have you received any medical treatment for your injuries?',
  hasAttorney: 'Are you already working with an attorney on this matter?',
  insuranceInfo: 'Do you have any insurance information you can share?',
  policeReport: 'Was a police report filed?',
  caseSummary: 'In a sentence or two, can you tell me what happened?',
};

const PHASE_PROMPTS = {
  greeting: 'Greet the caller warmly and introduce yourself.',
  disclosure_and_consent:
    'State that you are an automated virtual assistant, that the call may be recorded, and ask if they are okay to continue.',
  opt_out_check: 'Remind them they can opt out any time, and confirm they want to continue.',
  phone_lookup: 'Look up the caller by phone number using lookupLeadByPhone.',
  returning_lead_confirmation: 'Confirm the returning caller’s identity before continuing.',
  new_lead_creation: 'Create a new lead with createLead for this caller.',
  missing_info_review: 'Review any remaining gaps and confirm the details you collected.',
  final_summary: 'Summarize the key details and the next steps for the caller.',
  post_call_analysis: 'Save the transcript and post-call analysis.',
  complete: 'The intake is complete. Thank the caller and end the call.',
  human_escalation:
    'Stop intake. Let the caller know a human team member will help, and do not give legal advice or estimates.',
};

function normalize(ctx = {}) {
  return {
    lead: ctx.lead ?? {},
    greeted: !!ctx.greeted,
    consentGiven: !!ctx.consentGiven,
    optOutOffered: !!ctx.optOutOffered,
    optedOut: !!ctx.optedOut || !!ctx.lead?.optedOut,
    phoneLookedUp: !!ctx.phoneLookedUp,
    isReturning: !!ctx.isReturning,
    identityConfirmed: !!ctx.identityConfirmed,
    escalate: !!ctx.escalate,
    skipOptional: !!ctx.skipOptional,
    reviewDone: !!ctx.reviewDone,
    summaryConfirmed: !!ctx.summaryConfirmed,
    analysisSaved: !!ctx.analysisSaved,
  };
}

function result(state, extra = {}) {
  const terminal = state === 'complete' || state === 'human_escalation';
  return {
    state,
    nextField: extra.nextField ?? null,
    nextPrompt: extra.nextField ? FIELD_QUESTIONS[extra.nextField] : PHASE_PROMPTS[state] ?? '',
    missingFields: extra.missingFields ?? [],
    requiredComplete: !!extra.requiredComplete,
    terminal,
    reason: extra.reason ?? null,
  };
}

// Decide the current state and next action from a context object.
export function decideNextState(rawCtx = {}) {
  const ctx = normalize(rawCtx);
  const lead = ctx.lead;
  const missingRequired = computeMissingFields(lead, REQUIRED_LEAD_FIELDS);
  const requiredComplete = missingRequired.length === 0;

  // Highest-priority overrides — these can fire from any point in the call.
  if (ctx.escalate) return result('human_escalation', { missingFields: missingRequired, reason: 'human_escalation_needed' });
  if (ctx.optedOut) return result('complete', { missingFields: missingRequired, reason: 'opted_out' });

  // Pre-intake phases.
  for (const gate of PHASE_GATES) {
    if (!gate.done(ctx)) return result(gate.state, { missingFields: missingRequired });
  }

  // Ordered field collection — always points at the first unanswered field,
  // which is what prevents the agent from skipping a required question.
  for (const step of INTAKE_STEPS) {
    const missing = step.fields.filter((f) => !isAnswered(lead[f]));
    if (missing.length === 0) continue;
    if (step.optional && ctx.skipOptional) continue;
    return result(step.state, { nextField: missing[0], missingFields: missingRequired, requiredComplete });
  }

  // Closing phases (only reachable once required fields are complete).
  for (const gate of CLOSING_GATES) {
    if (!gate.done(ctx)) return result(gate.state, { missingFields: missingRequired, requiredComplete });
  }

  return result('complete', { missingFields: missingRequired, requiredComplete, reason: 'ready_for_human_review' });
}

export default decideNextState;
