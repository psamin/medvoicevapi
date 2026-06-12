// MedVoice MVP end-to-end checks (no real phone call, no real email). Boots the
// app in-process; everything runs in dry-run mode (no keys set).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MOCK_DB_PATH = join(tmpdir(), `medvoice-mvp-${process.pid}.json`);
process.env.APP_BASE_URL = 'http://localhost:3000';
// dry-run defaults (no SENDGRID_API_KEY / VAPI_API_KEY present)

const { default: app } = await import('../src/app.js');
const { getAll } = await import('../src/db/mockDb.js');

let server, base;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(() => server?.close());
beforeEach(async () => { await fetch(`${base}/api/debug/reset`, { method: 'POST' }); });

const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const get = (p) => fetch(base + p).then((r) => r.json());

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

test('2. end-of-call payload creates a client and case', async () => {
  const r = await runCall();
  assert.ok(r.clientId && r.caseId);
  const db = getAll();
  assert.equal(db.clients.length, 1);
  assert.equal(db.cases.length, 1);
});

test('3. intake fields saved with source=call', async () => {
  await runCall();
  const fields = getAll().intakeFields;
  assert.ok(fields.length > 0);
  assert.ok(fields.every((f) => f.source === 'call'));
  assert.equal(fields.find((f) => f.fieldKey === 'firstName').value, 'Maria');
});

test('4. intake form link (token) generated', async () => {
  const r = await runCall();
  assert.ok(r.token && r.token.length >= 16);
});

test('5. email is dry-run logged', async () => {
  const r = await runCall();
  assert.equal(r.emailStatus, 'dry_run');
  const emails = getAll().emailLogs;
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, 'Complete your MedVoice intake form');
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
  const fld = getAll().intakeFields.find((f) => f.fieldKey === 'mvaAtFaultParty');
  assert.equal(fld.value, 'Other driver');
  assert.equal(fld.source, 'form');
});

test('same phone is NOT flagged duplicate; same name + new phone IS flagged', async () => {
  await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dup', lastName: 'Test', phone: '+15557770001' } } } });
  // same phone again -> same client, not a duplicate flag
  const same = await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dup', lastName: 'Test', phone: '5557770001' } } } });
  assert.equal(same.possibleDuplicate, false);
  // same name, different phone -> flagged
  const dup = await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', analysis: { structuredData: { firstName: 'Dup', lastName: 'Test', phone: '+15558880002' } } } });
  assert.equal(dup.possibleDuplicate, true);
  const theCase = (await get(`/api/cases/${dup.caseId}`)).case;
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
  // Minimal call: only name + phone → several required fields still missing.
  const r = await post('/api/vapi/end-of-call', { message: { type: 'end-of-call-report', call: { id: 'c2' }, analysis: { structuredData: { firstName: 'Sam', phone: '+15554440000' } } } });
  assert.ok(r.missingFields.some((m) => m.key === 'email'));
  assert.ok(r.missingFields.some((m) => m.key === 'accidentDescription'));
});

test('9. staff-only fields hidden in form and not writable by client', async () => {
  const r = await runCall();
  const form = await get(`/api/intake/${r.token}`);
  assert.ok(!JSON.stringify(form).includes('leadAttorney'), 'staff-only field not in form payload');
  await post(`/api/intake/${r.token}`, { fields: { leadAttorney: 'HACKER' } });
  assert.equal(getAll().intakeFields.filter((f) => f.fieldKey === 'leadAttorney').length, 0, 'client cannot write staff-only field');
});

test('10. outbound Vapi test call works in dry-run mode', async () => {
  const r = await post('/api/vapi/outbound-test-call', { phone: '+15550001111' });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
});
