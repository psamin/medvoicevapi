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
} from '../mvp/intakeService.js';
import { sendSimpleReminderEmail, sendConfirmationEmail } from '../mvp/emailService.js';
import { CASE_STATUS } from '../mvp/models.js';
import { STAFF_ONLY_FIELD_KEYS } from '../config/intakeFields.js';

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

  // Document uploads: { documents: [{type, uploadedFileUrl}] } or { documents: {type: url} }.
  const docs = req.body?.documents;
  if (Array.isArray(docs)) {
    for (const d of docs) await recordDocumentUpload(theCase.id, d.type, d.uploadedFileUrl ?? d.url);
  } else if (docs && typeof docs === 'object') {
    for (const [type, url] of Object.entries(docs)) await recordDocumentUpload(theCase.id, type, url);
  }

  const updated = await recomputeCaseStatus(theCase.id);
  // Confirmation email only when the submission completes the intake.
  if (updated.status === CASE_STATUS.COMPLETE) await sendConfirmationEmail(theCase.id);
  res.json({
    ok: true,
    caseId: theCase.id,
    status: updated.status,
    missingFields: await getMissingFields(theCase.id),
    missingDocuments: await getMissingDocuments(theCase.id),
  });
});

export default router;
