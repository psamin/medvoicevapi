// Read-only dashboard API: everything saved for a case (client, intake fields by
// source, calls/transcripts, emails, missing fields, duplicate flag).
import { Router } from 'express';
import repo from '../mvp/repo.js';
import { getMissingFields } from '../mvp/intakeService.js';

const router = Router();

async function enrich(c) {
  const [client, fields, calls, emails, missingFields] = await Promise.all([
    c.clientId ? repo.clients.findById(c.clientId) : null,
    repo.intakeFields.listByCase(c.id),
    repo.intakeCalls.listByCase(c.id),
    repo.emailLogs.listByCase(c.id),
    getMissingFields(c.id),
  ]);
  const dup = c.duplicateOfClientId ? await repo.clients.findById(c.duplicateOfClientId) : null;
  return {
    ...c,
    client,
    fields: fields.map((f) => ({ key: f.fieldKey, label: f.fieldLabel, value: f.value, source: f.source, status: f.status })),
    calls: calls.map((v) => ({ id: v.id, direction: v.direction, status: v.status, summary: v.summary, transcript: v.transcript, recordingUrl: v.recordingUrl, createdAt: v.createdAt })),
    emails: emails.map((e) => ({ id: e.id, toEmail: e.toEmail, subject: e.subject, status: e.status, createdAt: e.createdAt })),
    missingFields,
    duplicateOfClient: dup ? { id: dup.id, firstName: dup.firstName, lastName: dup.lastName, phone: dup.phone } : null,
  };
}

// GET /api/cases — all cases, most recent first (enriched).
router.get('/', async (_req, res) => {
  const cases = await repo.cases.list();
  cases.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ ok: true, count: cases.length, cases: await Promise.all(cases.map(enrich)) });
});

// GET /api/cases/:id — one case (enriched).
router.get('/:id', async (req, res) => {
  const c = await repo.cases.findById(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'case not found' });
  res.json({ ok: true, case: await enrich(c) });
});

export default router;
