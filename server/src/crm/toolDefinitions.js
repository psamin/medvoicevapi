// Vapi "function" tool definitions for the canonical CRM tools (snake_case,
// served at /tools/*). Add each in the Vapi dashboard as a Function tool with
// Server URL `${WEBHOOK_BASE_URL}/tools/<name>`. Fetch live at GET /tools/_schema.
const BASE = '{{WEBHOOK_BASE_URL}}/tools';

function tool(name, description, properties, required = []) {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
    server: { url: `${BASE}/${name}` },
  };
}

const PHONE = { type: 'string', description: "Caller's phone number, any format." };

export const CRM_TOOL_DEFINITIONS = [
  tool(
    'lookup_crm_contact',
    'Call FIRST to detect a returning caller or duplicate. Returns match (exact/possible/none). Does NOT reveal prior case details until you pass identity_confirmed=true after verifying the caller.',
    { phone: PHONE, name: { type: 'string' }, email: { type: 'string' }, identity_confirmed: { type: 'boolean', description: 'Set true only after verifying the caller’s identity.' } }
  ),
  tool(
    'log_consent',
    'Record a consent decision. Use for AI disclosure, call recording, and phone/SMS follow-up — one call per consent type.',
    {
      consent_type: { type: 'string', enum: ['ai_disclosure', 'recording', 'phone_followup', 'sms_followup'] },
      granted: { type: 'boolean' },
      channel: { type: 'string', default: 'verbal' },
      caller_phone: PHONE,
      transcript_snippet: { type: 'string' },
    },
    ['consent_type', 'granted']
  ),
  tool(
    'record_opt_out',
    'Record that the caller does not want to be contacted. Stops future outbound call/SMS for this caller.',
    {
      caller_phone: PHONE,
      channel: { type: 'string', enum: ['call', 'sms', 'call_or_sms'], default: 'call_or_sms' },
      opt_out_requested: { type: 'boolean' },
      transcript_snippet: { type: 'string' },
    },
    ['caller_phone', 'opt_out_requested']
  ),
  tool(
    'save_intake',
    'Save the first-call verbal intake at the end. Provide the full structured record and the call review. Records WHETHER documents/evidence exist; the files are collected later.',
    {
      full_structured_record: {
        type: 'object',
        description: 'caller{firstName,lastName,phone,email}, incident{state,city,date,type,narrative}, injuries[], treatment{received}, insurance{summary}, hasAttorney, evidence{policeReport,photos,insuranceCard,medicalRecords,repairEstimate,...}',
      },
      call_review: {
        type: 'object',
        description: 'botVersion, intakeCompleteness, leadQuality, callerSentiment, confusionDetected, elderlyOrConfusedFlag, recommendedNextAction, urgencyFlag',
      },
    },
    ['full_structured_record']
  ),
  tool(
    'transfer_to_human',
    'Hand off to a human now (legal questions, anger, sensitive/edge cases, or caller asks for a person).',
    { case_summary: { type: 'string' }, urgency_flag: { type: 'string', enum: ['none', 'high', 'emergency'] } }
  ),
  tool(
    'schedule_callback',
    'Schedule a callback. Refused automatically if the caller has opted out.',
    { preferred_window: { type: 'string' }, phone: PHONE, consent_id: { type: 'string' } }
  ),
];

export default CRM_TOOL_DEFINITIONS;
