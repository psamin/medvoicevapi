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
import { CASE_STATUS, FOLLOW_UP } from './models.js';
import { getClient, updateCase } from './intakeService.js';
import { isOptedOut } from './optOut.js';
import { triggerVapiOutboundTestCall } from './vapiService.js';
import { sendSimpleReminderEmail } from './emailService.js';

const hoursBetween = (aIso, nowIso) => (new Date(nowIso).getTime() - new Date(aIso).getTime()) / 3_600_000;

export async function processCaseFollowUp(c, nowIso) {
  if (c.status !== CASE_STATUS.MISSING_INFO) return { caseId: c.id, action: 'skipped_not_missing_info' };

  const client = c.clientId ? await getClient(c.clientId) : null;
  const phone = client?.phone || null;

  // Opt-out: never contact; hand to a case manager instead.
  if (phone && (await isOptedOut(phone))) {
    await updateCase(c.id, { status: CASE_STATUS.CASE_MANAGER_REVIEW, humanFollowUpNeeded: true });
    return { caseId: c.id, action: 'opted_out_blocked' };
  }

  // Exhaustion: too many attempts or past the window.
  const pastWindow = c.followUpStartedAt && hoursBetween(c.followUpStartedAt, nowIso) > FOLLOW_UP.WINDOW_DAYS * 24;
  if (c.followUpAttemptCount >= FOLLOW_UP.MAX_ATTEMPTS || pastWindow) {
    await updateCase(c.id, {
      status: CASE_STATUS.FOLLOW_UP_EXHAUSTED,
      followUpExhaustedAt: nowIso,
      humanFollowUpNeeded: true, // flag for case-manager review
    });
    return { caseId: c.id, action: 'exhausted' };
  }

  // Spacing: at least 24h since the last attempt.
  if (c.lastFollowUpAt && hoursBetween(c.lastFollowUpAt, nowIso) < FOLLOW_UP.INTERVAL_HOURS) {
    return { caseId: c.id, action: 'too_soon' };
  }

  // Send one round: outbound call reminder + email reminder (both dry-run-safe and
  // opt-out-checked themselves).
  if (phone) await triggerVapiOutboundTestCall({ phone, caseId: c.id });
  await sendSimpleReminderEmail(c.id);

  const attempt = (c.followUpAttemptCount || 0) + 1;
  await updateCase(c.id, {
    followUpStartedAt: c.followUpStartedAt || nowIso,
    lastFollowUpAt: nowIso,
    followUpAttemptCount: attempt,
  });
  return { caseId: c.id, action: 'sent', attempt };
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
