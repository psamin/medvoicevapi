// MedVoice MVP — client intake form API + simple reminder. Mounted at /api/intake
// AFTER the state-machine router; /send-reminder is declared before /:token so it
// isn't captured as a token.
import { Router } from 'express';
import {
  generatePrefilledFormPayload,
  getCaseByToken,
  upsertIntakeFields,
  recomputeCaseStatus,
  getMissingFields,
  getMissingDocuments,
  recordDocumentUpload,
  markDocumentUnavailable,
  markDocumentMissing,
} from '../mvp/intakeService.js';

const isAnswered = (v) => v !== null && v !== undefined && v !== '';
import { sendSimpleReminderEmail, sendConfirmationEmail } from '../mvp/emailService.js';
import { CASE_STATUS } from '../mvp/models.js';
import { STAFF_ONLY_FIELD_KEYS } from '../config/intakeFields.js';
import { logCommunication } from '../crm/communications.js';

const router = Router();

// POST /api/intake/send-reminder — { caseId }  (declared before /:token)
router.post('/send-reminder', async (req, res) => {
  const { caseId } = req.body || {};
  if (!caseId) return res.status(400).json({ ok: false, error: 'caseId is required' });
  const result = await sendSimpleReminderEmail(caseId);
  res.json({ ok: true, ...result });
});

// GET /api/intake/:token — prefilled form payload (staff-only fields excluded).
router.get('/:token', async (req, res) => {
  const payload = await generatePrefilledFormPayload(req.params.token);
  if (!payload) return res.status(404).json({ ok: false, error: 'invalid or expired form link' });
  res.json({ ok: true, ...payload });
});

// POST /api/intake/:token — client submits (partial allowed). source=form.
router.post('/:token', async (req, res) => {
  const theCase = await getCaseByToken(req.params.token);
  if (!theCase) return res.status(404).json({ ok: false, error: 'invalid or expired form link' });

  // Clients can never write staff-only fields, even if they post them.
  const incoming = req.body?.fields ?? req.body ?? {};
  const fields = Object.fromEntries(
    Object.entries(incoming).filter(([k]) => !STAFF_ONLY_FIELD_KEYS.includes(k))
  );

  await upsertIntakeFields(theCase.id, fields, 'form');

  // Document handling. Three shapes are accepted:
  //   documents: [{ type, uploadedFileUrl?, notAvailable? }]   (form sends this)
  //   documents: { type: url }                                  (legacy upload-only)
  //   documentsUnavailable: { type: true|false }                (curl/test convenience)
  // `notAvailable: true` records "I don't have access to this document right now",
  // which stops it counting as missing. An empty value with no flag → still missing
  // (a blank field must never silently mark a document received).
  const docs = req.body?.documents;
  if (Array.isArray(docs)) {
    for (const d of docs) {
      const url = d.uploadedFileUrl ?? d.url;
      if (d.notAvailable === true || d.status === 'not_available') await markDocumentUnavailable(theCase.id, d.type, d.unavailableReason ?? d.reason);
      else if (isAnswered(url)) await recordDocumentUpload(theCase.id, d.type, url, d.fileName);
      else await markDocumentMissing(theCase.id, d.type);
    }
  } else if (docs && typeof docs === 'object') {
    for (const [type, url] of Object.entries(docs)) {
      if (isAnswered(url)) await recordDocumentUpload(theCase.id, type, url);
    }
  }
  const docsUnavailable = req.body?.documentsUnavailable;
  if (docsUnavailable && typeof docsUnavailable === 'object') {
    for (const [type, flag] of Object.entries(docsUnavailable)) {
      if (flag) await markDocumentUnavailable(theCase.id, type);
      else await markDocumentMissing(theCase.id, type);
    }
  }

  await logCommunication({
    caseId: theCase.id, clientId: theCase.clientId, channel: 'form', direction: 'inbound',
    type: 'intake_form_submitted', status: 'completed', subject: 'Intake form submitted',
  });

  const updated = await recomputeCaseStatus(theCase.id);
  // Confirmation email once the client's side is done (case handed to a case manager).
  if (updated.status === CASE_STATUS.READY_FOR_CASE_MANAGER) await sendConfirmationEmail(theCase.id);
  res.json({
    ok: true,
    caseId: theCase.id,
    status: updated.status,
    missingFields: await getMissingFields(theCase.id),
    missingDocuments: await getMissingDocuments(theCase.id),
  });
});

export default router;
