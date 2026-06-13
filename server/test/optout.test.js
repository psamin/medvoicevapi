// Outbound opt-out handling tests. Boots the app in-process; dry-run (no keys).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SQLITE_PATH = ':memory:';
process.env.MOCK_DB_PATH = join(tmpdir(), `medvoice-optout-${process.pid}.json`);
const { default: app } = await import('../src/app.js');
const { normalizePhoneNumber } = await import('../src/mvp/optOut.js');

let server, base;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(() => server?.close());
beforeEach(async () => { await fetch(`${base}/api/debug/reset`, { method: 'POST' }); });

const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const get = (p) => fetch(base + p).then((r) => r.json());
const outbound = (phone) => post('/api/vapi/outbound-test-call', { phone });

test('outbound proceeds when number is NOT opted out', async () => {
  const r = await outbound('+15551230001');
  assert.notEqual(r.skipped, true);
  assert.equal(r.dryRun, true); // dry-run placed (no real key)
});

test('outbound is SKIPPED when number is opted out', async () => {
  await post('/api/vapi/opt-out', { phone: '+15551230002' });
  const r = await outbound('+15551230002');
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'opted_out');
});

test('phone normalization is consistent across formats', async () => {
  const forms = ['+1 (555) 123-0003', '5551230003', '+15551230003', '(555) 123-0003'];
  const normalized = forms.map(normalizePhoneNumber);
  assert.equal(new Set(normalized).size, 1, 'all formats normalize to the same value');
  // and an opt-out in one format is seen in another
  await post('/api/vapi/opt-out', { phone: '555-123-0003' });
  assert.equal((await get('/api/vapi/opt-out?phone=' + encodeURIComponent('+1 (555) 123-0003'))).optedOut, true);
});

test('opt-out via the Vapi record-opt-out tool blocks future outbound', async () => {
  const phone = '+15551230004';
  await post('/api/vapi/tools/record-opt-out', { phone, source: 'vapi_outbound', reason: 'stop calling me' });
  const r = await outbound(phone);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'opted_out');
});

test('inbound opt-out (CRM tool) blocks future outbound — shared store', async () => {
  const phone = '+15551230005';
  await post('/tools/record_opt_out', { caller_phone: phone, opt_out_requested: true, channel: 'call_or_sms' });
  const r = await outbound(phone);
  assert.equal(r.skipped, true);
});

test('callback scheduling still refuses opted-out numbers', async () => {
  const phone = '+15551230006';
  await post('/api/vapi/opt-out', { phone });
  const r = await post('/tools/schedule_callback', { phone, preferred_window: 'tomorrow' });
  assert.equal(r.scheduled, false);
  assert.equal(r.reason, 'opted_out');
});

test('skipped opted-out calls do not attempt a Vapi call', async () => {
  const phone = '+15551230007';
  await post('/api/vapi/opt-out', { phone });
  const r = await outbound(phone);
  // The skip returns BEFORE the dry-run/real-dial branch, so no dial markers.
  assert.equal(r.skipped, true);
  assert.equal(r.dryRun, undefined, 'did not enter the dial path');
  assert.equal(r.vapiCallId, undefined, 'no call placed');
});
