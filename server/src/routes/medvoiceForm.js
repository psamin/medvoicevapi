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
} from '../mvp/intakeService.js';
import { sendSimpleReminderEmail } from '../mvp/emailService.js';
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
router.get('/:token', (req, res) => {
  const payload = generatePrefilledFormPayload(req.params.token);
  if (!payload) return res.status(404).json({ ok: false, error: 'invalid or expired form link' });
  res.json({ ok: true, ...payload });
});

// POST /api/intake/:token — client submits (partial allowed). source=form.
router.post('/:token', (req, res) => {
  const theCase = getCaseByToken(req.params.token);
  if (!theCase) return res.status(404).json({ ok: false, error: 'invalid or expired form link' });

  // Clients can never write staff-only fields, even if they post them.
  const incoming = req.body?.fields ?? req.body ?? {};
  const fields = Object.fromEntries(
    Object.entries(incoming).filter(([k]) => !STAFF_ONLY_FIELD_KEYS.includes(k))
  );

  upsertIntakeFields(theCase.id, fields, 'form');
  const updated = recomputeCaseStatus(theCase.id);
  res.json({
    ok: true,
    caseId: theCase.id,
    status: updated.status,
    missingFields: getMissingFields(theCase.id),
  });
});

export default router;
