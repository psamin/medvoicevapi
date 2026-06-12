// Vapi-facing MVP services: turn an end-of-call report into CRM records + an
// emailed intake form, and place outbound TEST calls through Vapi (no Twilio).
import { insert } from '../db/mockDb.js';
import { newIntakeCall, CASE_STATUS } from './models.js';
import {
  createOrUpdateClient,
  createOrUpdateCase,
  upsertIntakeFields,
  generateIntakeToken,
  updateCase,
  getMissingFields,
} from './intakeService.js';
import { sendIntakeFormEmail } from './emailService.js';
import { redactSensitive } from '../config/intakeFields.js';

// Pull the bits we need from either a Vapi end-of-call-report webhook payload or a
// flat test payload. Captured fields come from Vapi structured outputs
// (analysis.structuredData) or a top-level `fields` object in tests.
export function extractEndOfCall(body = {}) {
  const msg = body.message ?? body;
  const call = msg.call ?? {};
  const analysis = msg.analysis ?? {};
  const artifact = msg.artifact ?? {};

  const fields = msg.fields ?? analysis.structuredData ?? body.fields ?? {};
  return {
    vapiCallId: call.id ?? msg.callId ?? body.callId ?? null,
    direction: call.type === 'outboundPhoneCall' ? 'outbound' : msg.direction ?? body.direction ?? 'inbound',
    status: msg.endedReason ?? call.status ?? 'ended',
    transcript: msg.transcript ?? artifact.transcript ?? body.transcript ?? null,
    summary: msg.summary ?? analysis.summary ?? body.summary ?? null,
    recordingUrl: msg.recordingUrl ?? artifact.recordingUrl ?? body.recordingUrl ?? null,
    startedAt: msg.startedAt ?? call.startedAt ?? null,
    endedAt: msg.endedAt ?? call.endedAt ?? null,
    customerPhone: msg.customer?.number ?? call.customer?.number ?? body.customerPhone ?? fields.phone ?? null,
    fields: fields ?? {},
  };
}

// Main end-of-call pipeline: upsert client+case, save fields (source=call), store
// the call, set status, then email the prefilled intake form link.
export async function processVapiEndOfCall(body = {}) {
  const e = extractEndOfCall(body);
  const fields = { ...e.fields };
  if (!fields.phone && e.customerPhone) fields.phone = e.customerPhone;

  const client = createOrUpdateClient(fields);
  const theCase = createOrUpdateCase(client.id, fields);

  upsertIntakeFields(theCase.id, fields, 'call');

  // Human-follow-up flag from the call.
  const humanFollowUp = fields.humanFollowUpNeeded === true || fields.humanFollowUpNeeded === 'true';
  if (humanFollowUp) updateCase(theCase.id, { humanFollowUpNeeded: true });

  const call = insert(
    'intakeCalls',
    newIntakeCall({
      caseId: theCase.id, vapiCallId: e.vapiCallId, direction: e.direction, status: e.status,
      transcript: e.transcript, summary: e.summary, recordingUrl: e.recordingUrl,
      startedAt: e.startedAt, endedAt: e.endedAt,
    })
  );

  const token = generateIntakeToken(theCase.id);
  updateCase(theCase.id, {
    status: humanFollowUp ? CASE_STATUS.HUMAN_FOLLOW_UP_NEEDED : CASE_STATUS.INTAKE_FORM_SENT,
  });

  const emailLog = await sendIntakeFormEmail(theCase.id);

  console.log(`[end-of-call] case=${theCase.id} call=${e.vapiCallId} fields=`, Object.keys(redactSensitive(fields)));
  return {
    clientId: client.id,
    caseId: theCase.id,
    callId: call.id,
    token,
    missingFields: getMissingFields(theCase.id),
    emailStatus: emailLog?.status ?? null,
  };
}

// Outbound TEST call through Vapi only (no Twilio). Dry-runs unless configured.
export async function triggerVapiOutboundTestCall({ phone, caseId = null } = {}) {
  if (!phone) throw new Error('phone is required');
  const dryRun = process.env.DRY_RUN_VAPI_CALLS !== 'false' || !process.env.VAPI_API_KEY;

  if (dryRun) {
    console.log(`[vapi-call:dry-run] outbound to ${phone} (assistant=${process.env.VAPI_ASSISTANT_ID || 'unset'})`);
    if (caseId) insert('intakeCalls', newIntakeCall({ caseId, direction: 'outbound', status: 'dry_run' }));
    return { dryRun: true, phone, caseId, message: 'DRY_RUN_VAPI_CALLS or missing VAPI_API_KEY — call not placed.' };
  }

  const res = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistantId: process.env.VAPI_ASSISTANT_ID,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      customer: { number: phone },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vapi call API ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  if (caseId) insert('intakeCalls', newIntakeCall({ caseId, vapiCallId: data.id, direction: 'outbound', status: data.status ?? 'queued' }));
  return { dryRun: false, vapiCallId: data.id, status: data.status, phone, caseId };
}
