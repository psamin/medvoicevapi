// Outbound follow-up workflow for cases stuck in `missing_info`.
// Guardrails (server-enforced, never spams the client):
//   - only status === missing_info
//   - max 3 attempts total
//   - >= 24h between attempts
//   - within a 3-day window from the first attempt
//   - never to an opted-out client
// After 3 attempts or the 3-day window: stop, mark follow_up_exhausted, flag review.
//
// `runFollowUps(now)` is pure-ish: pass an ISO `now` to simulate time in tests.
import repo from './repo.js';
import { CASE_STATUS, FOLLOW_UP, TASK_TYPE, newFollowUpAttempt } from './models.js';
import { getClient, updateCase } from './intakeService.js';
import { isOptedOut } from './optOut.js';
import { triggerVapiOutboundTestCall } from './vapiService.js';
import { sendSimpleReminderEmail } from './emailService.js';
import { recordAudit, auditStatusChange } from '../crm/audit.js';
import { ensureTask } from '../crm/tasks.js';

const hoursBetween = (aIso, nowIso) => (new Date(nowIso).getTime() - new Date(aIso).getTime()) / 3_600_000;

const recordAttempt = (input) => repo.followUpAttempts.insert(newFollowUpAttempt(input));

export async function processCaseFollowUp(c, nowIso) {
  if (c.status !== CASE_STATUS.MISSING_INFO) return { caseId: c.id, action: 'skipped_not_missing_info' };

  const client = c.clientId ? await getClient(c.clientId) : null;
  const phone = client?.phone || null;
  const attemptNumber = (c.followUpAttemptCount || 0) + 1;

  // Opt-out / do-not-call: never contact; log the skip and hand to a case manager.
  if (phone && (await isOptedOut(phone))) {
    await recordAttempt({ caseId: c.id, clientId: c.clientId, attemptNumber, channel: 'call', status: 'skipped', skippedReason: 'opted_out', scheduledFor: nowIso });
    await updateCase(c.id, { status: CASE_STATUS.CASE_MANAGER_REVIEW, humanFollowUpNeeded: true, caseManagerHandoffRequired: true, caseManagerHandoffReason: 'client opted out', caseManagerHandoffAt: nowIso });
    await auditStatusChange({ caseId: c.id, clientId: c.clientId, from: c.status, to: CASE_STATUS.CASE_MANAGER_REVIEW, actorType: 'scheduler' });
    return { caseId: c.id, action: 'opted_out_blocked' };
  }

  // Exhaustion: too many attempts or past the window → stop, hand to a case manager.
  const pastWindow = c.followUpStartedAt && hoursBetween(c.followUpStartedAt, nowIso) > FOLLOW_UP.WINDOW_DAYS * 24;
  if (c.followUpAttemptCount >= FOLLOW_UP.MAX_ATTEMPTS || pastWindow) {
    await recordAttempt({ caseId: c.id, clientId: c.clientId, attemptNumber, channel: 'call', status: 'skipped', skippedReason: 'max_attempts_reached', scheduledFor: nowIso });
    await updateCase(c.id, {
      status: CASE_STATUS.MANUAL_REVIEW,
      followUpExhaustedAt: nowIso,
      humanFollowUpNeeded: true,
      caseManagerHandoffRequired: true,
      caseManagerHandoffReason: 'automated follow-up exhausted',
      caseManagerHandoffAt: nowIso,
    });
    await auditStatusChange({ caseId: c.id, clientId: c.clientId, from: c.status, to: CASE_STATUS.MANUAL_REVIEW, actorType: 'scheduler' });
    await ensureTask(
      { caseId: c.id, clientId: c.clientId, type: TASK_TYPE.MANUAL_FOLLOWUP, priority: 'high', title: 'Manual follow-up required', description: 'Automated outreach exhausted (3 attempts). Case manager must follow up.' },
      { actorType: 'scheduler' }
    );
    return { caseId: c.id, action: 'exhausted' };
  }

  // Spacing: at least 24h since the last attempt (not a real attempt — no row).
  if (c.lastFollowUpAt && hoursBetween(c.lastFollowUpAt, nowIso) < FOLLOW_UP.INTERVAL_HOURS) {
    return { caseId: c.id, action: 'too_soon' };
  }

  // Send one round: outbound call reminder + email reminder (both dry-run-safe and
  // opt-out-checked themselves). Each channel is recorded as a follow-up attempt;
  // the call/email also append to the communications timeline.
  if (phone) {
    await triggerVapiOutboundTestCall({ phone, caseId: c.id });
    await recordAttempt({ caseId: c.id, clientId: c.clientId, attemptNumber, channel: 'call', status: 'sent', sentAt: nowIso, scheduledFor: nowIso });
  }
  await sendSimpleReminderEmail(c.id);
  await recordAttempt({ caseId: c.id, clientId: c.clientId, attemptNumber, channel: 'email', status: 'sent', sentAt: nowIso, scheduledFor: nowIso });

  await updateCase(c.id, {
    followUpStartedAt: c.followUpStartedAt || nowIso,
    lastFollowUpAt: nowIso,
    followUpAttemptCount: attemptNumber,
  });
  await recordAudit({ actorType: 'scheduler', action: 'follow_up_sent', entityType: 'case', entityId: c.id, caseId: c.id, clientId: c.clientId, newValue: { attempt: attemptNumber } });
  return { caseId: c.id, action: 'sent', attempt: attemptNumber };
}

// Scan all missing_info cases and run one follow-up tick. Returns per-case results.
export async function runFollowUps(nowIso = new Date().toISOString()) {
  const cases = await repo.cases.list();
  const results = [];
  for (const c of cases) {
    if (c.status === CASE_STATUS.MISSING_INFO) results.push(await processCaseFollowUp(c, nowIso));
  }
  return results;
}
