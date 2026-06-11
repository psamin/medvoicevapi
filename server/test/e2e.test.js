// End-to-end tests for the Vapi intake workflow — no real phone call required.
// They boot the Express app in-process and exercise the same /api/tools/*
// endpoints Vapi would call, plus the intake state machine and analysis engine.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use a throwaway DB file BEFORE importing the app (mockDb resolves the path lazily).
process.env.MOCK_DB_PATH = join(tmpdir(), `medvoice-e2e-${process.pid}.json`);

const { default: app } = await import('../src/app.js');

let server, base;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
after(() => server?.close());
beforeEach(async () => { await fetch(`${base}/api/debug/reset`, { method: 'POST' }); });

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (path) => fetch(base + path).then((r) => r.json());

const FULL_FIELDS = {
  firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
  state: 'NY', city: 'Brooklyn', accidentDate: '2025-03-03', accidentType: 'car',
  injured: true, medicalTreatmentReceived: true, hasAttorney: false, caseSummary: 'rear-ended at a red light',
};

test('1. New caller completes full intake', async () => {
  const phone = '+15551110001';

  const lookup = await post('/api/tools/lookupLeadByPhone', { phone });
  assert.equal(lookup.found, false, 'no existing lead');

  const created = await post('/api/tools/createLead', { phone, firstName: 'Jane' });
  assert.equal(created.created, true);
  assert.equal(created.duplicate, false);

  await post('/api/tools/updateLead', { phone, ...FULL_FIELDS });

  const missing = await post('/api/tools/detectMissingFields', { phone });
  assert.equal(missing.complete, true, 'all required fields collected');

  const t = await post('/api/tools/saveTranscript', { phone, transcript: 'full happy-path intake', botVersion: 'v1_direct' });
  assert.ok(t.callId, 'transcript call record created');

  const analysis = await post('/api/tools/savePostCallAnalysis', { phone, botVersion: 'v1_direct', transcript: 'thank you so much' });
  assert.equal(analysis.analysis.recommendedNextAction, 'ready_for_human_review');
  assert.equal(analysis.analysis.intakeCompleteness, 100);

  const lead = (await get(`/api/leads/lookup?phone=${encodeURIComponent(phone)}`)).lead;
  assert.equal(lead.leadStatus, 'complete');
  const calls = (await get('/api/calls')).calls;
  assert.ok(calls.length >= 2, 'transcript + analysis call records saved');
});

test('2. Returning caller with missing info', async () => {
  const phone = '+15552220002';
  // Seed an existing lead that is missing email + caseSummary.
  await post('/api/leads', { phone, firstName: 'Bob', lastName: 'Lee', state: 'NJ', city: 'Newark',
    accidentDate: '2025-01-01', accidentType: 'truck', injured: true, medicalTreatmentReceived: false, hasAttorney: false });

  const lookup = await post('/api/tools/lookupLeadByPhone', { phone });
  assert.equal(lookup.found, true);
  assert.equal(lookup.isReturningCaller, true);
  assert.ok(lookup.missingFields.includes('email'));
  assert.ok(lookup.missingFields.includes('caseSummary'));

  // Confirm identity (state machine) and update ONLY the missing fields.
  await post('/api/tools/updateLead', { phone, email: 'bob@example.com', caseSummary: 'truck merged into me' });

  const missing = await post('/api/tools/detectMissingFields', { phone });
  assert.equal(missing.complete, true);

  await post('/api/tools/savePostCallAnalysis', { phone, transcript: 'thanks for the update' });
  const leads = (await get('/api/leads')).leads;
  assert.equal(leads.length, 1, 'still a single lead (updated, not duplicated)');
  assert.equal(leads[0].email, 'bob@example.com');
});

test('3. Opt-out caller', async () => {
  const phone = '+15553330003';
  await post('/api/tools/createLead', { phone, firstName: 'Pat' });

  const opt = await post('/api/tools/markOptOut', { phone });
  assert.equal(opt.optedOut, true);
  assert.equal(opt.lead.leadStatus, 'opted_out');

  // State machine must ask NO further intake questions once opted out.
  const next = await post('/api/intake/next', { phone, optedOut: true });
  assert.equal(next.terminal, true);
  assert.equal(next.nextField, null, 'no intake question after opt-out');
  assert.equal(next.reason, 'opted_out');

  const analysis = await post('/api/tools/savePostCallAnalysis', { phone, optedOut: true });
  assert.equal(analysis.analysis.recommendedNextAction, 'opted_out');
});

test('4. Duplicate lead detection', async () => {
  const phone = '+15554440004';
  const first = await post('/api/tools/createLead', { phone, firstName: 'Sam' });
  assert.equal(first.created, true);

  const second = await post('/api/tools/createLead', { phone, lastName: 'Twin' });
  assert.equal(second.created, false, 'no new lead created');
  assert.equal(second.duplicate, true);
  assert.equal(second.lead.id, first.lead.id, 'same lead updated');
  assert.equal(second.lead.lastName, 'Twin', 'existing lead updated with new info');
  assert.equal(second.lead.previousCallCount, 1);

  const leads = (await get('/api/leads')).leads;
  assert.equal(leads.length, 1, 'exactly one lead for the phone');
});

test('5. Human escalation on legal-advice request', async () => {
  const phone = '+15555550005';
  await post('/api/tools/createLead', { phone, ...FULL_FIELDS });

  // Caller asks for legal advice / settlement value.
  const score = await post('/api/tools/scoreCall', { phone, transcript: 'just tell me how much is my case worth and the settlement amount' });
  assert.equal(score.recommendedNextAction, 'human_escalation_needed');

  const next = await post('/api/intake/next', { phone, escalate: true });
  assert.equal(next.state, 'human_escalation');
  assert.equal(next.terminal, true);

  const analysis = await post('/api/tools/savePostCallAnalysis', { phone, escalated: true });
  assert.equal(analysis.analysis.recommendedNextAction, 'human_escalation_needed');
});
