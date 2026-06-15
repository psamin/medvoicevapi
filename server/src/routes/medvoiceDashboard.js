// Read-only dashboard API: everything saved for a case (client, intake fields by
// source, calls/transcripts, emails, missing fields, duplicate flag).
import { Router } from 'express';
import repo from '../mvp/repo.js';
import { getMissingFields, getMissingDocuments, verifyIntakeField } from '../mvp/intakeService.js';
import { createTask, completeTask } from '../crm/tasks.js';
import { newNote } from '../mvp/models.js';

const router = Router();

async function enrich(c) {
  const [client, fields, calls, emails, missingFields, missingDocuments, documents, tasks, notes, communications, audit, attempts] =
    await Promise.all([
      c.clientId ? repo.clients.findById(c.clientId) : null,
      repo.intakeFields.listByCase(c.id),
      repo.intakeCalls.listByCase(c.id),
      repo.emailLogs.listByCase(c.id),
      getMissingFields(c.id),
      getMissingDocuments(c.id),
      repo.requiredDocuments.listByCase(c.id),
      repo.tasks.listByCase(c.id),
      repo.notes.listByCase(c.id),
      repo.communications.listByCase(c.id),
      repo.auditLogs.listByCase(c.id),
      repo.followUpAttempts.listByCase(c.id),
    ]);
  const dup = c.duplicateOfClientId ? await repo.clients.findById(c.duplicateOfClientId) : null;
  return {
    ...c,
    client,
    // AI-extracted vs human-verified is explicit per field.
    fields: fields.map((f) => ({ key: f.fieldKey, label: f.fieldLabel, value: f.value, source: f.source, status: f.status, verifiedByHuman: !!f.verifiedByHuman, verifiedAt: f.verifiedAt ?? null })),
    calls: calls.map((v) => ({ id: v.id, direction: v.direction, status: v.status, summary: v.summary, transcript: v.transcript, recordingUrl: v.recordingUrl, createdAt: v.createdAt })),
    emails: emails.map((e) => ({ id: e.id, toEmail: e.toEmail, subject: e.subject, status: e.status, createdAt: e.createdAt })),
    documents: documents.map((d) => ({ type: d.docType, label: d.label, required: d.required, status: d.status, unavailableReason: d.unavailableReason ?? null, fileUrl: d.fileUrl ?? d.uploadedFileUrl ?? null })),
    missingFields,
    missingDocuments,
    tasks,
    notes,
    communications,
    auditLog: audit,
    followUpAttempts: attempts,
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

/* ── case-scoped CRM sub-resources ── */

// GET /api/cases/:id/communications — full contact timeline for the case.
router.get('/:id/communications', async (req, res) => {
  res.json({ ok: true, communications: await repo.communications.listByCase(req.params.id) });
});

// GET /api/cases/:id/tasks — tasks for the case.
router.get('/:id/tasks', async (req, res) => {
  res.json({ ok: true, tasks: await repo.tasks.listByCase(req.params.id) });
});

// POST /api/cases/:id/tasks — create a task. { type, title, description?, priority?, ownerId?, dueAt? }
router.post('/:id/tasks', async (req, res) => {
  const c = await repo.cases.findById(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'case not found' });
  const { type, title, description, priority, ownerId, dueAt } = req.body || {};
  const task = await createTask(
    { caseId: c.id, clientId: c.clientId, type, title, description, priority, ownerId, dueAt },
    { actorType: 'user', actorId: ownerId ?? null }
  );
  res.json({ ok: true, task });
});

// POST /api/cases/:id/tasks/:taskId/complete
router.post('/:id/tasks/:taskId/complete', async (req, res) => {
  const updated = await completeTask(req.params.taskId, { actorType: 'user', actorId: req.body?.userId ?? null });
  if (!updated) return res.status(404).json({ ok: false, error: 'task not found' });
  res.json({ ok: true, task: updated });
});

// GET /api/cases/:id/notes
router.get('/:id/notes', async (req, res) => {
  res.json({ ok: true, notes: await repo.notes.listByCase(req.params.id) });
});

// POST /api/cases/:id/notes — internal note. { body, authorId? }
router.post('/:id/notes', async (req, res) => {
  const c = await repo.cases.findById(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'case not found' });
  if (!req.body?.body) return res.status(400).json({ ok: false, error: 'body is required' });
  const note = await repo.notes.save(newNote({ caseId: c.id, authorId: req.body.authorId ?? null, body: req.body.body }));
  res.json({ ok: true, note });
});

// GET /api/cases/:id/audit — audit trail for the case.
router.get('/:id/audit', async (req, res) => {
  res.json({ ok: true, auditLog: await repo.auditLogs.listByCase(req.params.id) });
});

// POST /api/cases/:id/verify-field — mark an intake field human-verified. { fieldKey, userId?, role? }
router.post('/:id/verify-field', async (req, res) => {
  const { fieldKey, userId, role } = req.body || {};
  if (!fieldKey) return res.status(400).json({ ok: false, error: 'fieldKey is required' });
  const saved = await verifyIntakeField(req.params.id, fieldKey, userId ?? null, role);
  if (!saved) return res.status(404).json({ ok: false, error: 'field not found on case' });
  res.json({ ok: true, field: { key: saved.fieldKey, verifiedByHuman: saved.verifiedByHuman, verifiedAt: saved.verifiedAt, source: saved.source } });
});

export default router;
