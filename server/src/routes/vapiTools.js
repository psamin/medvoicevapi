import { Router } from 'express';
import { toolHandler } from '../vapi/adapter.js';
import { TOOL_DEFINITIONS } from '../vapi/toolDefinitions.js';
import {
  findLeadByPhone,
  getLead,
  createLead,
  updateLead,
  createCall,
  listCalls,
} from '../db/mockDb.js';
import { REQUIRED_LEAD_FIELDS, computeMissingFields, isAnswered } from '../models.js';

const router = Router();

// Resolve a lead from whatever identifier a tool call provides.
function resolveLead({ id, leadId, phone }) {
  if (id || leadId) return getLead(id || leadId);
  if (phone) return findLeadByPhone(phone);
  return null;
}

// Only copy known lead fields out of a tool payload (ignore control keys).
const LEAD_WRITABLE = [...REQUIRED_LEAD_FIELDS, 'insuranceInfo', 'policeReport', 'preferredLanguage'];
function pickLeadFields(args = {}) {
  const out = {};
  for (const k of LEAD_WRITABLE) {
    if (args[k] !== undefined) out[k] = args[k];
  }
  return out;
}

// POST /api/tools/lookupLeadByPhone — { phone }
router.post(
  '/lookupLeadByPhone',
  toolHandler('lookupLeadByPhone', (args) => {
    if (!args.phone) return { payload: { found: false, error: 'phone is required' } };
    const lead = findLeadByPhone(args.phone);
    return {
      payload: {
        found: !!lead,
        lead: lead || null,
        isReturningCaller: !!lead,
        missingFields: lead ? lead.missingFields : REQUIRED_LEAD_FIELDS,
      },
    };
  })
);

// POST /api/tools/createLead — {...lead fields}. Dedups by phone (updates instead).
router.post(
  '/createLead',
  toolHandler('createLead', (args) => {
    const fields = pickLeadFields(args);
    const existing = args.phone ? findLeadByPhone(args.phone) : null;
    if (existing) {
      const updated = updateLead(existing.id, { ...fields, previousCallCount: existing.previousCallCount + 1 });
      return {
        payload: { duplicate: true, created: false, lead: updated, message: 'Lead already exists; updated instead.' },
      };
    }
    const lead = createLead({ ...fields, leadStatus: 'in_progress' });
    return { payload: { duplicate: false, created: true, lead }, status: 201 };
  })
);

// POST /api/tools/updateLead — { id|leadId|phone, ...fields }
router.post(
  '/updateLead',
  toolHandler('updateLead', (args) => {
    const lead = resolveLead(args);
    if (!lead) return { payload: { updated: false, error: 'lead not found' } };
    const patch = pickLeadFields(args);
    if (isAnswered(args.leadStatus)) patch.leadStatus = args.leadStatus;
    const updated = updateLead(lead.id, patch);
    return { payload: { updated: true, lead: updated, missingFields: updated.missingFields } };
  })
);

// POST /api/tools/markOptOut — { id|leadId|phone }
router.post(
  '/markOptOut',
  toolHandler('markOptOut', (args) => {
    let lead = resolveLead(args);
    // If an unknown caller opts out, record them so we honor it next time.
    if (!lead && args.phone) lead = createLead({ phone: args.phone });
    if (!lead) return { payload: { optedOut: false, error: 'lead not found and no phone to create one' } };
    const updated = updateLead(lead.id, { optedOut: true, leadStatus: 'opted_out' });
    return { payload: { optedOut: true, lead: updated } };
  })
);

// POST /api/tools/detectMissingFields — { id|leadId|phone } OR a raw lead object
router.post(
  '/detectMissingFields',
  toolHandler('detectMissingFields', (args) => {
    const lead = resolveLead(args) || pickLeadFields(args);
    const missingFields = computeMissingFields(lead);
    return {
      payload: {
        missingFields,
        complete: missingFields.length === 0,
        nextField: missingFields[0] ?? null,
      },
    };
  })
);

// POST /api/tools/saveTranscript — { leadId|phone, transcript, botVersion }
router.post(
  '/saveTranscript',
  toolHandler('saveTranscript', (args) => {
    const lead = resolveLead(args);
    const call = createCall({
      leadId: lead?.id ?? null,
      phone: args.phone ?? lead?.phone ?? null,
      botVersion: args.botVersion ?? null,
      transcript: args.transcript ?? null,
      outcome: 'transcript_saved',
    });
    return { payload: { callId: call.id, call }, status: 201 };
  })
);

// POST /api/tools/savePostCallAnalysis — { leadId|phone, ...analysis fields }
router.post(
  '/savePostCallAnalysis',
  toolHandler('savePostCallAnalysis', (args) => {
    const lead = resolveLead(args);
    const call = createCall({
      leadId: lead?.id ?? null,
      phone: args.phone ?? lead?.phone ?? null,
      botVersion: args.botVersion ?? null,
      transcript: args.transcript ?? null,
      outcome: args.outcome ?? 'analysis_saved',
      leadQuality: args.leadQuality ?? null,
      callerSentiment: args.callerSentiment ?? null,
      confusionDetected: args.confusionDetected ?? false,
      unhappyDetected: args.unhappyDetected ?? false,
      missingInfo: args.missingInfo ?? args.missingFields ?? [],
      callScore: args.callScore ?? args.intakeCompleteness ?? null,
      failureReason: args.failureReason ?? null,
      recommendedNextAction: args.recommendedNextAction ?? null,
    });
    // Reflect quality back onto the lead if we have one.
    if (lead && isAnswered(args.leadQuality)) {
      updateLead(lead.id, { leadQualityScore: args.callScore ?? args.intakeCompleteness ?? null });
    }
    return { payload: { callId: call.id, call }, status: 201 };
  })
);

// POST /api/tools/scoreCall — { id|leadId|phone, transcript? }
// Basic completeness scoring here; Feature 8 plugs in the full analysis engine.
router.post(
  '/scoreCall',
  toolHandler('scoreCall', (args) => {
    const lead = resolveLead(args);
    const missingFields = lead ? computeMissingFields(lead) : REQUIRED_LEAD_FIELDS;
    const filled = REQUIRED_LEAD_FIELDS.length - missingFields.length;
    const intakeCompleteness = Math.round((filled / REQUIRED_LEAD_FIELDS.length) * 100);
    const leadQuality = intakeCompleteness >= 80 ? 'high' : intakeCompleteness >= 50 ? 'medium' : 'low';
    return { payload: { intakeCompleteness, leadQuality, missingFields } };
  })
);

// GET /api/tools/_schema — the tool definitions to copy into Vapi.
router.get('/_schema', (_req, res) => {
  res.json({ ok: true, tools: TOOL_DEFINITIONS });
});

// GET /api/tools/_calls — recent saved call records (handy while testing).
router.get('/_calls', (_req, res) => {
  res.json({ ok: true, calls: listCalls() });
});

export default router;
