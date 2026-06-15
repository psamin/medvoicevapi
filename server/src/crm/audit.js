// Audit trail — every important state change is recorded as an immutable entry so
// the workflow stays traceable (who/what changed a case, document, opt-out, etc.).
// actorType: ai | client | user | system | webhook | scheduler
import repo from '../mvp/repo.js';
import { newAuditLog } from '../mvp/models.js';

export async function recordAudit(entry = {}) {
  return repo.auditLogs.insert(newAuditLog(entry));
}

export async function listAudit(caseId) {
  return repo.auditLogs.listByCase(caseId);
}

// Convenience: log a case status transition (no-op when the status didn't change).
export async function auditStatusChange({ caseId, clientId, from, to, actorType = 'system', actorId = null }) {
  if (from === to) return null;
  return recordAudit({
    actorType, actorId, caseId, clientId,
    action: 'case_status_changed', entityType: 'case', entityId: caseId,
    oldValue: { status: from }, newValue: { status: to },
  });
}
