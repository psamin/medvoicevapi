// CRM operational queues + global task list. These power the case-manager
// dashboards ("what needs attention right now?") rather than static data display.
import { Router } from 'express';
import repo from '../mvp/repo.js';
import { CASE_STATUS, FOLLOW_UP, TASK_STATUS } from '../mvp/models.js';
import { completeTask } from '../crm/tasks.js';

const router = Router();

const hoursBetween = (aIso, b) => (new Date(b).getTime() - new Date(aIso).getTime()) / 3_600_000;

// A missing_info case is "due" if it hasn't hit max attempts, enough time has
// passed since the last attempt, and the client hasn't opted out.
function followUpDue(c, client, nowIso) {
  if (c.status !== CASE_STATUS.MISSING_INFO) return false;
  if ((c.followUpAttemptCount || 0) >= FOLLOW_UP.MAX_ATTEMPTS) return false;
  if (client && (client.optedOut || client.doNotCall)) return false;
  if (c.lastFollowUpAt && hoursBetween(c.lastFollowUpAt, nowIso) < FOLLOW_UP.INTERVAL_HOURS) return false;
  return true;
}

// Bucket every case into the operational queues. One pass, client looked up once.
async function buildQueues(nowIso) {
  const cases = await repo.cases.list();
  const q = {
    new_calls: [], forms_pending: [], missing_info: [], documents_pending: [],
    ready_for_case_manager: [], case_manager_review: [], attorney_review: [],
    manual_review: [], follow_ups_due: [], opt_outs: [], possible_duplicates: [],
  };
  for (const c of cases) {
    const client = c.clientId ? await repo.clients.findById(c.clientId) : null;
    const item = {
      id: c.id, status: c.status, priority: c.priority ?? 'normal',
      clientName: [client?.firstName, client?.lastName].filter(Boolean).join(' ') || '(no name)',
      phone: client?.phone ?? null, updatedAt: c.updatedAt,
      documentsPendingReview: !!c.documentsPendingReview,
    };
    if ([CASE_STATUS.NEW, CASE_STATUS.IN_PROGRESS].includes(c.status)) q.new_calls.push(item);
    if (c.status === CASE_STATUS.FORM_SENT) q.forms_pending.push(item);
    if (c.status === CASE_STATUS.MISSING_INFO) q.missing_info.push(item);
    if (c.documentsPendingReview || c.status === CASE_STATUS.DOCUMENTS_PENDING) q.documents_pending.push(item);
    if (c.status === CASE_STATUS.READY_FOR_CASE_MANAGER) q.ready_for_case_manager.push(item);
    if (c.status === CASE_STATUS.CASE_MANAGER_REVIEW) q.case_manager_review.push(item);
    if (c.status === CASE_STATUS.ATTORNEY_REVIEW) q.attorney_review.push(item);
    if ([CASE_STATUS.MANUAL_REVIEW, CASE_STATUS.FOLLOW_UP_EXHAUSTED].includes(c.status)) q.manual_review.push(item);
    if (c.status === CASE_STATUS.OPTED_OUT || client?.optedOut || client?.doNotCall) q.opt_outs.push(item);
    if (c.possibleDuplicate) q.possible_duplicates.push(item);
    if (followUpDue(c, client, nowIso)) q.follow_ups_due.push(item);
  }
  return q;
}

// GET /api/crm/queues — all queues with counts (for the dashboard top-level view).
router.get('/queues', async (req, res) => {
  const nowIso = req.query.now || new Date().toISOString();
  const queues = await buildQueues(nowIso);
  const counts = Object.fromEntries(Object.entries(queues).map(([k, v]) => [k, v.length]));
  res.json({ ok: true, counts, queues });
});

// GET /api/crm/queues/:name — a single queue.
router.get('/queues/:name', async (req, res) => {
  const nowIso = req.query.now || new Date().toISOString();
  const queues = await buildQueues(nowIso);
  const queue = queues[req.params.name];
  if (!queue) return res.status(404).json({ ok: false, error: `unknown queue '${req.params.name}'`, available: Object.keys(queues) });
  res.json({ ok: true, name: req.params.name, count: queue.length, items: queue });
});

// GET /api/crm/tasks — all open tasks (optionally ?type=, ?status=).
router.get('/tasks', async (req, res) => {
  let tasks = await repo.tasks.list();
  if (req.query.status) tasks = tasks.filter((t) => t.status === req.query.status);
  else tasks = tasks.filter((t) => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.CANCELLED);
  if (req.query.type) tasks = tasks.filter((t) => t.type === req.query.type);
  res.json({ ok: true, count: tasks.length, tasks });
});

// POST /api/crm/tasks/:id/complete
router.post('/tasks/:id/complete', async (req, res) => {
  const updated = await completeTask(req.params.id, { actorType: 'user', actorId: req.body?.userId ?? null });
  if (!updated) return res.status(404).json({ ok: false, error: 'task not found' });
  res.json({ ok: true, task: updated });
});

export default router;
