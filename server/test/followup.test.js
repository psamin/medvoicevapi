// Follow-up workflow + validation/confirmation tests. In-memory SQLite, dry-run.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SQLITE_PATH = ':memory:';
process.env.MOCK_DB_PATH = join(tmpdir(), `medvoice-fu-${process.pid}.json`);
process.env.APP_BASE_URL = 'http://localhost:3000';

const { default: app } = await import('../src/app.js');

let server, base;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(() => server?.close());
beforeEach(async () => { await fetch(`${base}/api/debug/reset`, { method: 'POST' }); });

const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const get = (p) => fetch(base + p).then((r) => r.json());
const caseById = (id) => get(`/api/cases/${id}`).then((r) => r.case);
const hoursFromNow = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

const FULL = {
  firstName: 'Full', lastName: 'Complete', phone: '+15551110000', email: 'full@example.com',
  accidentType: 'Motor Vehicle Accident', accidentDate: '2025-05-01', accidentState: 'NJ',
  accidentCity: 'Newark', accidentDescription: 'rear-ended', injurySummary: 'neck pain',
};
const endOfCall = (data) => post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: data } } });

// Create a case stuck in missing_info (caller gave only name + phone, then submitted).
async function missingInfoCase(phone = '+15551110000') {
  // Has contact info (so reminders can send) but is missing other required fields.
  const r = await endOfCall({ firstName: 'Foll', phone, email: 'foll@example.com' });
  await post(`/api/intake/${r.token}`, { fields: {} }); // submit -> recompute -> missing_info
  return r;
}
const runAt = (nowIso) => post('/api/follow-up/run', { now: nowIso });

const REQUIRED_DOCS = { government_id: 'id.jpg', insurance_information: 'ins.pdf' };

test('complete submission (fields + required docs) -> complete + confirmation email', async () => {
  const r = await endOfCall(FULL);
  const submit = await post(`/api/intake/${r.token}`, { fields: {}, documents: REQUIRED_DOCS });
  assert.equal(submit.status, 'complete');
  const c = await caseById(r.caseId);
  assert.ok(c.emails.some((e) => e.subject === 'Your MedVoice intake is complete'), 'confirmation email sent');
});

test('required documents gate completion', async () => {
  const r = await endOfCall(FULL); // all fields present, no docs yet
  const form = await get(`/api/intake/${r.token}`);
  assert.ok(form.documents.some((d) => d.type === 'government_id' && d.required), 'doc requirement on form');
  // all fields but no docs -> still missing_info
  const s1 = await post(`/api/intake/${r.token}`, { fields: {} });
  assert.equal(s1.status, 'missing_info');
  assert.ok(s1.missingDocuments.some((d) => d.type === 'insurance_information'));
  // upload the required docs -> complete
  const s2 = await post(`/api/intake/${r.token}`, { documents: REQUIRED_DOCS });
  assert.equal(s2.status, 'complete');
});

test('incomplete submission -> status missing_info', async () => {
  const r = await missingInfoCase();
  const c = await caseById(r.caseId);
  assert.equal(c.status, 'missing_info');
});

test('follow-up sends an outbound call + reminder email (attempt 1)', async () => {
  const r = await missingInfoCase();
  const [res] = await runAt(hoursFromNow(0)).then((x) => x.results);
  assert.equal(res.action, 'sent');
  assert.equal(res.attempt, 1);
  const c = await caseById(r.caseId);
  assert.equal(c.followUpAttemptCount, 1);
  assert.ok(c.calls.some((v) => v.direction === 'outbound'), 'outbound call logged');
  assert.ok(c.emails.some((e) => /Reminder/i.test(e.subject)), 'reminder email logged');
});

test('attempts are spaced by 24h (immediate re-run is skipped)', async () => {
  const r = await missingInfoCase();
  await runAt(hoursFromNow(0));
  const [res2] = await runAt(hoursFromNow(1)).then((x) => x.results); // 1h later
  assert.equal(res2.action, 'too_soon');
  assert.equal((await caseById(r.caseId)).followUpAttemptCount, 1);
});

test('max 3 attempts, then follow_up_exhausted + flagged for review', async () => {
  const r = await missingInfoCase();
  await runAt(hoursFromNow(0));   // attempt 1
  await runAt(hoursFromNow(24));  // attempt 2
  await runAt(hoursFromNow(48));  // attempt 3
  assert.equal((await caseById(r.caseId)).followUpAttemptCount, 3);
  const [res4] = await runAt(hoursFromNow(72)).then((x) => x.results); // 4th tick
  assert.equal(res4.action, 'exhausted');
  const c = await caseById(r.caseId);
  assert.equal(c.status, 'follow_up_exhausted');
  assert.equal(c.humanFollowUpNeeded, true, 'flagged for case-manager review');
});

test('follow-up stops after the 3-day window even with attempts left', async () => {
  const r = await missingInfoCase();
  await runAt(hoursFromNow(0)); // attempt 1 sets followUpStartedAt
  const [res] = await runAt(hoursFromNow(73)).then((x) => x.results); // past 3 days
  assert.equal(res.action, 'exhausted');
  assert.equal((await caseById(r.caseId)).status, 'follow_up_exhausted');
});

test('complete intake stops all future follow-ups', async () => {
  const r = await endOfCall(FULL);
  await post(`/api/intake/${r.token}`, { fields: {}, documents: REQUIRED_DOCS }); // -> complete
  const results = await runAt(hoursFromNow(0)).then((x) => x.results);
  assert.equal(results.length, 0, 'completed case is not followed up');
});

test('opted-out client is never called/emailed; routed to case manager', async () => {
  const phone = '+15552220000';
  await post('/api/vapi/opt-out', { phone }); // do-not-call
  const r = await missingInfoCase(phone);
  const [res] = await runAt(hoursFromNow(0)).then((x) => x.results);
  assert.equal(res.action, 'opted_out_blocked');
  const c = await caseById(r.caseId);
  assert.equal(c.status, 'case_manager_review');
  assert.equal(c.followUpAttemptCount, 0, 'no outbound attempts made');
});
