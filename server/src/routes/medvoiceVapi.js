// MedVoice MVP — Vapi-facing endpoints: event/end-of-call webhooks, two intake
// tools, and an outbound test-call trigger (Vapi only, no Twilio).
import { Router } from 'express';
import { toolHandler } from '../vapi/adapter.js';
import { verifyVapiSecret } from '../vapi/verifySecret.js';
import { processVapiEndOfCall, triggerVapiOutboundTestCall } from '../mvp/vapiService.js';
import { markOptOut, isOptedOut, normalizePhoneNumber, listOptOuts } from '../mvp/optOut.js';
import {
  getCase,
  createOrUpdateClient,
  createOrUpdateCase,
  upsertIntakeFields,
  getMissingFields,
} from '../mvp/intakeService.js';

const router = Router();

// Resolve a case from a tool call: by caseId, or by phone (find/create).
async function resolveCaseId(args = {}) {
  if (args.caseId && (await getCase(args.caseId))) return args.caseId;
  if (args.phone) {
    const client = await createOrUpdateClient({ phone: args.phone });
    return (await createOrUpdateCase(client.id, {})).id;
  }
  return null;
}

// POST /api/vapi/events — generic Vapi server event sink. Routes end-of-call
// reports into the pipeline; logs others (no sensitive payload dumping).
router.post('/events', verifyVapiSecret, async (req, res) => {
  const type = req.body?.message?.type ?? req.body?.type ?? 'unknown';
  console.log(`[vapi-event] ${type}`);
  if (type === 'end-of-call-report') {
    const result = await processVapiEndOfCall(req.body);
    return res.json({ ok: true, handled: 'end-of-call-report', ...result });
  }
  res.json({ ok: true, received: type });
});

// POST /api/vapi/end-of-call — process an end-of-call payload directly.
router.post('/end-of-call', verifyVapiSecret, async (req, res) => {
  const result = await processVapiEndOfCall(req.body);
  res.json({ ok: true, ...result });
});

// POST /api/vapi/tools/upsert-intake-fields — { caseId?|phone?, fields:{...} }
router.post(
  '/tools/upsert-intake-fields',
  verifyVapiSecret,
  toolHandler('upsert-intake-fields', async (args) => {
    const caseId = await resolveCaseId(args);
    if (!caseId) return { payload: { ok: false, error: 'provide caseId or phone' } };
    const fields = args.fields ?? args;
    const saved = await upsertIntakeFields(caseId, fields, 'call');
    return { payload: { caseId, saved: saved.length, missingFields: await getMissingFields(caseId) } };
  })
);

// POST /api/vapi/tools/get-missing-fields — { caseId?|phone? }
router.post(
  '/tools/get-missing-fields',
  verifyVapiSecret,
  toolHandler('get-missing-fields', async (args) => {
    const caseId = await resolveCaseId(args);
    if (!caseId) return { payload: { ok: false, error: 'provide caseId or phone' } };
    return { payload: { caseId, missingFields: await getMissingFields(caseId) } };
  })
);

// POST /api/vapi/tools/record-opt-out — { phone, reason?, source?, caseId?, callId? }
// The assistant calls this when the caller asks to stop/opt out. Reuses the shared
// opt-out store, so it blocks future outbound calls to this number.
router.post(
  '/tools/record-opt-out',
  verifyVapiSecret,
  toolHandler('record-opt-out', async (args) => {
    if (!args.phone) return { payload: { ok: false, error: 'phone is required' } };
    const optOut = await markOptOut(args.phone, {
      source: args.source || 'vapi_call',
      reason: args.reason ?? args.transcript_snippet ?? null,
      caseId: args.caseId ?? null,
      callId: args.callId ?? null,
    });
    return { payload: { optedOut: true, optOutId: optOut.id, message: 'Opt-out recorded. This number will not be called again.' } };
  })
);

// POST /api/vapi/outbound-test-call — { phone, caseId? } (triggered by us, not Vapi)
router.post('/outbound-test-call', async (req, res) => {
  const { phone, caseId } = req.body || {};
  if (!phone) return res.status(400).json({ ok: false, error: 'phone is required' });
  const result = await triggerVapiOutboundTestCall({ phone, caseId });
  res.json({ ok: true, ...result });
});

/* ── DEV / TEST opt-out endpoints (no auth; for local verification) ── */

// GET /api/vapi/opt-out?phone=...  → check opt-out status for a number.
router.get('/opt-out', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ ok: false, error: 'phone query param required' });
  res.json({ ok: true, phone, normalized: normalizePhoneNumber(phone), optedOut: await isOptedOut(phone) });
});

// POST /api/vapi/opt-out  { phone, reason?, caseId? }  → manually mark a number opted out.
router.post('/opt-out', async (req, res) => {
  const { phone, reason, caseId } = req.body || {};
  if (!phone) return res.status(400).json({ ok: false, error: 'phone is required' });
  const optOut = await markOptOut(phone, { source: 'manual', reason, caseId: caseId ?? null });
  res.json({ ok: true, optedOut: true, optOutId: optOut.id, normalized: normalizePhoneNumber(phone) });
});

// GET /api/vapi/opt-outs  → list all opt-out records (debug).
router.get('/opt-outs', async (_req, res) => {
  res.json({ ok: true, optOuts: await listOptOuts() });
});

export default router;
