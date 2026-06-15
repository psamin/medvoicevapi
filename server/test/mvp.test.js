// MedVoice MVP end-to-end checks (no real phone call, no real email). Boots the
// app in-process against an in-memory SQLite store; everything runs in dry-run mode.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SQLITE_PATH = ':memory:'; // SQLite is the source of truth
process.env.MOCK_DB_PATH = join(tmpdir(), `medvoice-mvp-${process.pid}.json`); // legacy/opt-out store
process.env.APP_BASE_URL = 'http://localhost:3000';

const { default: app } = await import('../src/app.js');

let server, base;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(() => server?.close());
beforeEach(async () => { await fetch(`${base}/api/debug/reset`, { method: 'POST' }); });

const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const get = (p) => fetch(base + p).then((r) => r.json());
const caseById = (id) => get(`/api/cases/${id}`).then((r) => r.case);

const END_OF_CALL = {
  message: {
    type: 'end-of-call-report',
    call: { id: 'vapi_test_1', type: 'inboundPhoneCall' },
    summary: 'Caller injured in a motor vehicle accident.',
    transcript: 'AI: ... \nUser: ...',
    analysis: {
      structuredData: {
        firstName: 'Maria', lastName: 'Lopez', phone: '+1 555-333-1212', email: 'maria@example.com',
        accidentType: 'Motor Vehicle Accident', accidentDate: '2025-05-01', accidentState: 'NJ',
        accidentCity: 'Newark', accidentDescription: 'Rear-ended on the highway',
        injurySummary: 'Neck and back pain', preferredContact: 'Email', primaryLanguage: 'English',
      },
    },
  },
};

async function runCall() {
  return post('/api/vapi/end-of-call', END_OF_CALL);
}

test('1. health endpoint works', async () => {
  const h = await get('/api/health');
  assert.equal(h.ok, true);
  assert.equal(h.service, 'medvoice');
});

test('2. end-of-call payload creates a client and case (in SQLite)', async () => {
  const r = await runCall();
  assert.ok(r.clientId && r.caseId);
  const list = await get('/api/cases');
  assert.equal(list.count, 1);
  assert.ok(list.cases[0].client, 'case has a client');
});

test('3. intake fields saved with source=call', async () => {
  const r = await runCall();
  const c = await caseById(r.caseId);
  assert.ok(c.fields.length > 0);
  assert.ok(c.fields.every((f) => f.source === 'call'));
  assert.equal(c.fields.find((f) => f.key === 'firstName').value, 'Maria');
});

test('4. intake form link (token) generated', async () => {
  const r = await runCall();
  assert.ok(r.token && r.token.length >= 16);
});

test('5. email is dry-run logged', async () => {
  const r = await runCall();
  assert.equal(r.emailStatus, 'dry_run');
  const c = await caseById(r.caseId);
  assert.equal(c.emails.length, 1);
  assert.equal(c.emails[0].subject, 'Complete your MedVoice intake form');
});

test('6. intake form opens with prefilled values', async () => {
  const r = await runCall();
  const form = await get(`/api/intake/${r.token}`);
  assert.equal(form.ok, true);
  const allFields = form.steps.flatMap((s) => s.sections).flatMap((sec) => sec.fields);
  assert.equal(allFields.find((f) => f.key === 'firstName').value, 'Maria');
});

test('7. form submission updates fields with source=form', async () => {
  const r = await runCall();
  await post(`/api/intake/${r.token}`, { fields: { mvaAtFaultParty: 'Other driver' } });
  const c = await caseById(r.caseId);
  const fld = c.fields.find((f) => f.key === 'mvaAtFaultParty');
  assert.equal(fld.value, 'Other driver');
  assert.equal(fld.source, 'form');
});

test('same phone is NOT flagged duplicate; same name + new phone IS flagged', async () => {
  await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dup', lastName: 'Test', phone: '+15557770001' } } } });
  const same = await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dup', lastName: 'Test', phone: '5557770001' } } } });
  assert.equal(same.possibleDuplicate, false);
  const dup = await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dup', lastName: 'Test', phone: '+15558880002' } } } });
  assert.equal(dup.possibleDuplicate, true);
  const theCase = await caseById(dup.caseId);
  assert.equal(theCase.possibleDuplicate, true);
  assert.ok(theCase.duplicateOfClient, 'links to the other client');
});

test('dashboard returns enriched cases', async () => {
  const r = await runCall();
  const list = await get('/api/cases');
  assert.ok(list.count >= 1);
  const c = list.cases.find((x) => x.id === r.caseId);
  assert.ok(c.client, 'has client');
  assert.ok(c.fields.length > 0, 'has fields');
  assert.ok(c.fields.every((f) => 'source' in f && 'status' in f));
});

test('8. missing fields calculated correctly', async () => {
  const r = await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', call: { id: 'c2' }, analysis: { structuredData: { firstName: 'Sam', phone: '+15554440000' } } } });
  assert.ok(r.missingFields.some((m) => m.key === 'email'));
  assert.ok(r.missingFields.some((m) => m.key === 'accidentDescription'));
});

test('9. staff-only fields hidden in form and not writable by client', async () => {
  const r = await runCall();
  const form = await get(`/api/intake/${r.token}`);
  assert.ok(!JSON.stringify(form).includes('leadAttorney'), 'staff-only field not in form payload');
  await post(`/api/intake/${r.token}`, { fields: { leadAttorney: 'HACKER' } });
  const c = await caseById(r.caseId);
  assert.equal(c.fields.filter((f) => f.key === 'leadAttorney').length, 0, 'client cannot write staff-only field');
});

test('10. outbound Vapi test call works in dry-run mode', async () => {
  const r = await post('/api/vapi/outbound-test-call', { phone: '+15550001111' });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
});

// runCall captures every required FIELD, so the only thing left missing after a
// submit is the two required documents (government_id, insurance_information).
test('11. with all fields captured, only required documents keep a case in missing_info', async () => {
  const r = await runCall();
  const sub = await post(`/api/intake/${r.token}`, {});
  assert.equal(sub.status, 'missing_info');
  assert.deepEqual(
    sub.missingDocuments.map((d) => d.type).sort(),
    ['government_id', 'insurance_information']
  );
});

test('12. marking required documents unavailable completes the case + flags doc review', async () => {
  const r = await runCall();
  const sub = await post(`/api/intake/${r.token}`, {
    documentsUnavailable: { government_id: true, insurance_information: true },
  });
  assert.equal(sub.missingDocuments.length, 0, 'unavailable docs no longer count as missing');
  assert.equal(sub.status, 'ready_for_case_manager');

  const c = await caseById(r.caseId);
  assert.equal(c.documentsPendingReview, true, 'flagged for a case manager to obtain the docs');
  // Status is persisted on the document rows, not just frontend state.
  assert.equal(c.documents.find((d) => d.type === 'government_id').status, 'not_available');
  // Client still gets the confirmation email (automation preserved).
  assert.ok(c.emails.some((e) => e.subject === 'Your MedVoice intake is complete'));
});

test('13. uploading required documents completes the case with NO pending-review flag', async () => {
  const r = await runCall();
  const sub = await post(`/api/intake/${r.token}`, {
    documents: [
      { type: 'government_id', uploadedFileUrl: 'id.png' },
      { type: 'insurance_information', uploadedFileUrl: 'ins.pdf' },
    ],
  });
  assert.equal(sub.status, 'ready_for_case_manager');
  const c = await caseById(r.caseId);
  assert.equal(c.documentsPendingReview, false);
  assert.equal(c.documents.find((d) => d.type === 'government_id').status, 'received');
});

test('14. follow-up job does NOT chase a case resolved via unavailable documents', async () => {
  const r = await runCall();
  await post(`/api/intake/${r.token}`, {
    documentsUnavailable: { government_id: true, insurance_information: true },
  });
  const before = await caseById(r.caseId);
  assert.equal(before.status, 'ready_for_case_manager'); // no longer missing_info
  const run = await post('/api/follow-up/run', { now: '2026-06-15T10:00:00.000Z' });
  assert.equal(run.results.length, 0, 'nothing left in missing_info to follow up on');
});

test('15. un-checking "no access" puts the required document back to missing', async () => {
  const r = await runCall();
  await post(`/api/intake/${r.token}`, {
    documentsUnavailable: { government_id: true, insurance_information: true },
  });
  assert.equal((await caseById(r.caseId)).status, 'ready_for_case_manager');
  // Client uploads the insurance doc but un-marks the government ID with no upload.
  const sub = await post(`/api/intake/${r.token}`, {
    documents: [
      { type: 'government_id', notAvailable: false },
      { type: 'insurance_information', uploadedFileUrl: 'ins.pdf' },
    ],
  });
  assert.equal(sub.status, 'missing_info');
  assert.deepEqual(sub.missingDocuments.map((d) => d.type), ['government_id']);
});

test('16. an empty document value never marks a document as received', async () => {
  const r = await runCall();
  // Mirrors the form posting a blank entry for a document the client skipped.
  const sub = await post(`/api/intake/${r.token}`, {
    documents: [{ type: 'government_id', uploadedFileUrl: '' }],
  });
  assert.equal(sub.status, 'missing_info');
  assert.ok(sub.missingDocuments.some((d) => d.type === 'government_id'));
});

/* ───────────────────────── CRM foundation ───────────────────────── */

test('CRM: completed intake → ready_for_case_manager + review task + handoff + audit', async () => {
  const r = await runCall();
  await post(`/api/intake/${r.token}`, {
    documents: [
      { type: 'government_id', uploadedFileUrl: 'id.png' },
      { type: 'insurance_information', uploadedFileUrl: 'ins.pdf' },
    ],
  });
  const c = await caseById(r.caseId);
  assert.equal(c.status, 'ready_for_case_manager');
  assert.equal(c.caseManagerHandoffRequired, true);
  assert.ok(c.caseManagerHandoffAt, 'handoff timestamp set');
  // review_intake task created
  assert.ok(c.tasks.some((t) => t.type === 'review_intake'), 'review_intake task');
  // a document upload created a review_document task
  assert.ok(c.tasks.some((t) => t.type === 'review_document'), 'review_document task');
  // status transition is audited
  assert.ok(c.auditLog.some((a) => a.action === 'case_status_changed' && a.newValue?.status === 'ready_for_case_manager'));
});

test('CRM: AI-extracted fields are NOT human-verified until a case manager verifies', async () => {
  const r = await runCall();
  let c = await caseById(r.caseId);
  const fn = c.fields.find((f) => f.key === 'firstName');
  assert.equal(fn.source, 'call');
  assert.equal(fn.verifiedByHuman, false);
  const v = await post(`/api/cases/${r.caseId}/verify-field`, { fieldKey: 'firstName', userId: 'cm_1' });
  assert.equal(v.field.verifiedByHuman, true);
  c = await caseById(r.caseId);
  assert.equal(c.fields.find((f) => f.key === 'firstName').verifiedByHuman, true);
});

test('CRM: every call + email + form submit lands in the communications timeline', async () => {
  const r = await runCall();
  await post(`/api/intake/${r.token}`, { fields: { mvaAtFaultParty: 'Other driver' } });
  const types = (await get(`/api/cases/${r.caseId}/communications`)).communications.map((m) => m.type);
  assert.ok(types.includes('vapi_call'), 'AI call logged');
  assert.ok(types.includes('intake_form_sent'), 'form-link email logged');
  assert.ok(types.includes('intake_form_submitted'), 'form submission logged');
});

test('CRM: opt-out is first-class on the client + blocks outbound + sets case opted_out', async () => {
  const r = await runCall();
  await post('/api/vapi/opt-out', { phone: '+1 555-333-1212', reason: 'asked to stop', caseId: r.caseId });
  const c = await caseById(r.caseId);
  assert.equal(c.client.optedOut, true);
  assert.equal(c.client.doNotCall, true);
  assert.equal(c.client.optOutReason, 'asked to stop');
  assert.equal(c.status, 'opted_out');
  assert.ok(c.communications.some((m) => m.type === 'opt_out'));
  // outbound call to this number is blocked
  const call = await post('/api/vapi/outbound-test-call', { phone: '+15553331212', caseId: r.caseId });
  assert.equal(call.skipped, true);
  assert.equal(call.reason, 'opted_out');
});

test('CRM: follow-ups exhaust to manual_review with attempts logged + manual task', async () => {
  const r = await post('/api/vapi/end-of-call', {
    message: { type: 'end-of-call-report', call: { id: 'fu1' }, analysis: { structuredData: {
      firstName: 'Fu', lastName: 'Up', phone: '+15557778888', email: 'fu@example.com',
      accidentType: 'Motor Vehicle Accident', accidentDate: '2025-01-01', accidentState: 'NJ',
      accidentCity: 'Newark', accidentDescription: 'x', injurySummary: 'y',
    } } },
  });
  // partial submit → missing_info (required docs still missing)
  await post(`/api/intake/${r.token}`, {});
  const days = ['2026-06-15T10:00:00.000Z', '2026-06-16T10:00:00.000Z', '2026-06-17T10:00:00.000Z', '2026-06-18T10:00:00.000Z'];
  const actions = [];
  for (const now of days) actions.push((await post('/api/follow-up/run', { now })).results[0].action);
  assert.deepEqual(actions, ['sent', 'sent', 'sent', 'exhausted']);
  const c = await caseById(r.caseId);
  assert.equal(c.status, 'manual_review');
  assert.ok(c.tasks.some((t) => t.type === 'manual_followup'), 'manual_followup task created');
  // attempt rows recorded (3 sent rounds × call+email = 6, plus the exhausted skip)
  assert.ok(c.followUpAttempts.length >= 6, `attempts logged (${c.followUpAttempts.length})`);
  assert.ok(c.followUpAttempts.some((a) => a.status === 'skipped' && a.skippedReason === 'max_attempts_reached'));
});

test('CRM: duplicate caller creates a duplicate_review task', async () => {
  await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dee', lastName: 'Plicate', phone: '+15551110000' } } } });
  const dup = await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dee', lastName: 'Plicate', phone: '+15552220000' } } } });
  assert.equal(dup.possibleDuplicate, true);
  const c = await caseById(dup.caseId);
  assert.ok(c.tasks.some((t) => t.type === 'duplicate_review'), 'duplicate_review task created');
});

test('CRM: queues bucket cases by stage', async () => {
  const r = await runCall(); // → form_sent
  let q = await get('/api/crm/queues');
  assert.equal(q.counts.forms_pending, 1);
  await post(`/api/intake/${r.token}`, {}); // → missing_info
  q = await get('/api/crm/queues');
  assert.equal(q.counts.missing_info, 1);
  assert.equal(q.counts.follow_ups_due, 1, 'a fresh missing_info case is due for follow-up');
  const single = await get('/api/crm/queues/missing_info');
  assert.equal(single.count, 1);
  assert.equal(single.items[0].id, r.caseId);
});

test('CRM: notes and tasks can be created and listed per case', async () => {
  const r = await runCall();
  await post(`/api/cases/${r.caseId}/notes`, { body: 'Spoke with client, will send records.', authorId: 'cm_1' });
  const notes = await get(`/api/cases/${r.caseId}/notes`);
  assert.equal(notes.notes.length, 1);
  assert.equal(notes.notes[0].body, 'Spoke with client, will send records.');

  const created = await post(`/api/cases/${r.caseId}/tasks`, { type: 'call_client', title: 'Call client back' });
  assert.equal(created.task.type, 'call_client');
  const done = await post(`/api/crm/tasks/${created.task.id}/complete`, { userId: 'cm_1' });
  assert.equal(done.task.status, 'done');
});
