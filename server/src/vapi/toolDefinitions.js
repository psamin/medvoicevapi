// Vapi "function" tool definitions for the intake assistant.
//
// HOW TO USE:
//   - In the Vapi dashboard, add each of these as a Tool of type "Function" with
//     a Server URL of `${WEBHOOK_BASE_URL}/api/tools/<name>` (e.g. via ngrok).
//   - Or fetch them live at GET /api/tools/_schema and paste into Vapi's tool JSON.
//
// The `server.url` below uses a {{WEBHOOK_BASE_URL}} placeholder — replace it with
// your public HTTPS base URL (your ngrok tunnel to PORT) before pasting into Vapi.

const BASE = '{{WEBHOOK_BASE_URL}}/api/tools';

function tool(name, description, properties, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
    server: { url: `${BASE}/${name}` },
  };
}

const PHONE = { type: 'string', description: "Caller's phone number, any format." };
const LEAD_ID = { type: 'string', description: 'Internal lead id, if known.' };

export const TOOL_DEFINITIONS = [
  tool(
    'lookupLeadByPhone',
    'Look up an existing lead by phone number at the start of the call to recognize returning callers. ALWAYS call this before creating a new lead.',
    { phone: PHONE },
    ['phone']
  ),
  tool(
    'createLead',
    'Create a new lead. Automatically de-duplicates by phone (updates the existing lead instead of creating a duplicate). Call after a phone lookup returns no match.',
    {
      phone: PHONE,
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      email: { type: 'string' },
      state: { type: 'string' },
      city: { type: 'string' },
      preferredLanguage: { type: 'string' },
    },
    ['phone']
  ),
  tool(
    'updateLead',
    'Update fields on an existing lead as you collect them during intake. Pass the lead id or phone plus any fields to set.',
    {
      id: LEAD_ID,
      phone: PHONE,
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      email: { type: 'string' },
      state: { type: 'string' },
      city: { type: 'string' },
      accidentDate: { type: 'string', description: 'Date of the accident (ISO or spoken date).' },
      accidentType: { type: 'string', description: 'car, truck, motorcycle, slip-and-fall, dog-bite, other.' },
      injured: { type: 'boolean' },
      medicalTreatmentReceived: { type: 'boolean' },
      hasAttorney: { type: 'boolean' },
      insuranceInfo: { type: 'string' },
      policeReport: { type: 'string' },
      caseSummary: { type: 'string', description: 'Short plain-language summary of what happened.' },
    }
  ),
  tool(
    'markOptOut',
    'Mark the caller as opted out when they say they do not want to continue or be contacted. Stops all further intake questions.',
    { id: LEAD_ID, phone: PHONE },
  ),
  tool(
    'detectMissingFields',
    'Return which required intake fields are still missing for this lead and the single next field to ask about. Use to decide the next question.',
    { id: LEAD_ID, phone: PHONE }
  ),
  tool(
    'saveTranscript',
    'Save the full call transcript at the end of the call.',
    {
      leadId: LEAD_ID,
      phone: PHONE,
      transcript: { type: 'string', description: 'Full conversation transcript.' },
      botVersion: { type: 'string', description: 'Which prompt version handled the call (v1_direct, v2_warm, v3_fast_screening).' },
    },
    ['transcript']
  ),
  tool(
    'savePostCallAnalysis',
    'Save the structured post-call analysis (sentiment, completeness, recommended next action) at the end of the call.',
    {
      leadId: LEAD_ID,
      phone: PHONE,
      botVersion: { type: 'string' },
      outcome: { type: 'string' },
      leadQuality: { type: 'string', enum: ['low', 'medium', 'high'] },
      callerSentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
      confusionDetected: { type: 'boolean' },
      unhappyDetected: { type: 'boolean' },
      missingInfo: { type: 'array', items: { type: 'string' } },
      callScore: { type: 'number', description: 'intakeCompleteness 0-100.' },
      failureReason: { type: 'string' },
      recommendedNextAction: {
        type: 'string',
        enum: [
          'ready_for_human_review',
          'needs_follow_up',
          'missing_required_info',
          'opted_out',
          'duplicate_lead',
          'human_escalation_needed',
        ],
      },
    }
  ),
  tool(
    'scoreCall',
    'Compute an intake completeness score and lead quality for a lead. Useful mid-call or at the end.',
    { id: LEAD_ID, phone: PHONE }
  ),
];

export default TOOL_DEFINITIONS;
