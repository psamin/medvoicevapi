// E2E test flow for the CRM /tools/* endpoints — simulates the 8 caller
// scenarios from the spec without a real phone call. Boots the app in-process.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SQLITE_PATH = ':memory:';
process.env.MOCK_DB_PATH = join(tmpdir(), `medvoice-crm-e2e-${process.pid}.json`);
const { default: app } = await import('../src/app.js');

let server, base;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(() => server?.close());
beforeEach(async () => { await fetch(`${base}/api/debug/reset`, { method: 'POST' }); });

const tool = (name, body) =>
  fetch(`${base}/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const db = () => fetch(`${base}/api/debug/db`).then((r) => r.json());

const fullRecord = (phone, over = {}) => ({
  caller: { firstName: 'Jane', lastName: 'Doe', phone, email: 'jane@example.com' },
  incident: { state: 'NY', city: 'Brooklyn', date: '2025-03-03', type: 'car', narrative: 'rear-ended' },
  injuries: ['neck'], treatment: { received: true }, hasAttorney: false, medicalTreatmentReceived: true,
  caseSummary: 'rear-ended at a light',
  evidence: { policeReport: true, photos: true, insuranceCard: true },
  ...over,
});

test('1. New caller', async () => {
  const phone = '+15550000001';
  const lookup = await tool('lookup_crm_contact', { phone });
  assert.equal(lookup.match, 'none');
  assert.equal(lookup.isReturningCaller, false);
  const saved = await tool('save_intake', { full_structured_record: fullRecord(phone), call_review: { recommendedNextAction: 'ready_for_human_review', intakeCompleteness: 100 } });
  assert.equal(saved.duplicate, false);
  assert.equal(saved.lead.leadStatus, 'complete');
});

test('2. Returning caller (identity-gated)', async () => {
  const phone = '+15550000002';
  await tool('save_intake', { full_structured_record: fullRecord(phone), call_review: {} });
  const blind = await tool('lookup_crm_contact', { phone });
  assert.equal(blind.match, 'exact');
  assert.equal(blind.isReturningCaller, true);
  assert.equal(blind.contact, undefined, 'no case details before identity confirmed');
  const confirmed = await tool('lookup_crm_contact', { phone, identity_confirmed: true });
  assert.ok(confirmed.contact, 'limited summary after identity confirmed');
  assert.equal(confirmed.contact.firstName, 'Jane');
});

test('3. Possible duplicate caller', async () => {
  await tool('save_intake', { full_structured_record: fullRecord('+15550000003'), call_review: {} });
  // Same person calls from a different number — matches by name only => "possible".
  const possible = await tool('lookup_crm_contact', { name: 'Jane Doe' });
  assert.equal(possible.match, 'possible');
  // And saving with the SAME phone does not create a duplicate.
  const again = await tool('save_intake', { full_structured_record: fullRecord('+15550000003', { caseSummary: 'updated' }), call_review: {} });
  assert.equal(again.duplicate, true);
  const leads = (await db()).leads;
  assert.equal(leads.length, 1);
});

test('4. Caller who opts out', async () => {
  const phone = '+15550000004';
  await tool('save_intake', { full_structured_record: fullRecord(phone), call_review: {} });
  const opt = await tool('record_opt_out', { caller_phone: phone, channel: 'call_or_sms', opt_out_requested: true, transcript_snippet: 'stop calling' });
  assert.equal(opt.optedOut, true);
  // Outbound is now blocked.
  const cb = await tool('schedule_callback', { phone, preferred_window: 'tomorrow' });
  assert.equal(cb.scheduled, false);
  assert.equal(cb.reason, 'opted_out');
});

test('5. Caller with documents to collect later', async () => {
  const saved = await tool('save_intake', { full_structured_record: fullRecord('+15550000005', { evidence: { policeReport: true, photos: false, insuranceCard: true, repairEstimate: true } }), call_review: {} });
  const types = saved.documentsToCollect.map((d) => d.type);
  assert.ok(types.includes('government_id') && types.includes('insurance_card'), 'required docs queued');
  assert.ok(types.includes('police_report') && types.includes('vehicle_repair_estimate'), 'existing optional docs queued');
  assert.ok(!types.includes('accident_photos'), 'photos not queued (caller said none exist)');
  assert.equal(saved.evidenceExists.insuranceCard, true);
});

test('6. Caller who needs human handoff', async () => {
  const t = await tool('transfer_to_human', { case_summary: 'serious injury, no attorney', urgency_flag: 'high' });
  assert.equal(t.transferStatus, 'mock_transfer_started');
  assert.equal(t.urgencyFlag, 'high');
});

test('7. Elderly / confused caller flag', async () => {
  const phone = '+15550000007';
  await tool('save_intake', { full_structured_record: fullRecord(phone), call_review: { elderlyOrConfusedFlag: true, confusionDetected: true, callerSentiment: 'neutral' } });
  const review = (await db()).callReviews.find((r) => r.elderlyOrConfusedFlag);
  assert.ok(review, 'call review stored');
  assert.equal(review.confusionDetected, true);
});

test('8. Incomplete intake requires follow-up', async () => {
  const phone = '+15550000008';
  // Only a name + phone — most required fields missing.
  const saved = await tool('save_intake', { full_structured_record: { caller: { firstName: 'Pat', phone } }, call_review: {} });
  assert.ok(saved.missingFields.length > 0, 'missing required fields surfaced');
  assert.equal(saved.lead.leadStatus, 'in_progress');
});
