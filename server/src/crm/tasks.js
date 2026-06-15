// Human work items (the case-manager queue). Tasks are created automatically at key
// workflow points (intake ready for review, document uploaded, possible duplicate,
// follow-up exhausted) and can also be created/completed by staff.
import repo from '../mvp/repo.js';
import { newTask, TASK_STATUS } from '../mvp/models.js';
import { recordAudit } from './audit.js';

const nowIso = () => new Date().toISOString();
const isOpen = (t) => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.CANCELLED;

export async function createTask(input = {}, actor = { actorType: 'system' }) {
  const task = await repo.tasks.save(newTask(input));
  await recordAudit({
    actorType: actor.actorType, actorId: actor.actorId ?? null,
    action: 'task_created', entityType: 'task', entityId: task.id,
    caseId: task.caseId, clientId: task.clientId, newValue: { type: task.type, title: task.title },
  });
  return task;
}

// Idempotent: don't pile up duplicate OPEN tasks of the same type on a case.
export async function ensureTask(input = {}, actor = { actorType: 'system' }) {
  const existing = (await repo.tasks.listByCase(input.caseId)).find((t) => t.type === input.type && isOpen(t));
  if (existing) return existing;
  return createTask(input, actor);
}

export async function completeTask(taskId, actor = { actorType: 'user' }) {
  const t = await repo.tasks.findById(taskId);
  if (!t) return null;
  const updated = await repo.tasks.save({ ...t, status: TASK_STATUS.DONE, completedAt: nowIso(), updatedAt: nowIso() });
  await recordAudit({
    actorType: actor.actorType, actorId: actor.actorId ?? null,
    action: 'task_completed', entityType: 'task', entityId: taskId, caseId: t.caseId,
    oldValue: { status: t.status }, newValue: { status: TASK_STATUS.DONE },
  });
  return updated;
}

export async function listTasks(caseId) {
  return repo.tasks.listByCase(caseId);
}

export async function listOpenTasks() {
  return (await repo.tasks.list()).filter(isOpen);
}
