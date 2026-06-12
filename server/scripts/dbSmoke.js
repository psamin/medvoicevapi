// Verify the Postgres path end-to-end through real app services.
// Usage: (DATABASE_URL set, after `npm run migrate`)  npm run db:smoke
import 'dotenv/config';
import { pgEnabled, closePool } from '../src/db/pg.js';
import { STORAGE_BACKEND } from '../src/mvp/repo.js';
import {
  createOrUpdateClient,
  createOrUpdateCase,
  upsertIntakeFields,
  getMissingFields,
  generateIntakeToken,
  generatePrefilledFormPayload,
} from '../src/mvp/intakeService.js';

console.log(`Storage backend: ${STORAGE_BACKEND}`);
if (!pgEnabled()) {
  console.error('✖ DATABASE_URL is not set — this smoke test is for the Postgres backend.');
  process.exit(1);
}

try {
  const phone = `+1555${Date.now().toString().slice(-7)}`;
  const client = await createOrUpdateClient({ firstName: 'Smoke', lastName: 'Test', phone, email: `smoke${Date.now()}@example.com` });
  console.log('✓ client saved:', client.id);

  const theCase = await createOrUpdateCase(client.id, { accidentType: 'Motor Vehicle Accident' });
  console.log('✓ case saved:', theCase.id);

  await upsertIntakeFields(theCase.id, { accidentDate: '2025-05-01', accidentState: 'NJ', accidentCity: 'Newark', accidentDescription: 'rear-ended', injurySummary: 'neck pain' }, 'call');
  console.log('✓ intake fields upserted');

  const dup = await createOrUpdateClient({ phone });
  console.log(`✓ dedupe by phone works: ${dup.id === client.id ? 'same client' : 'NEW CLIENT (BUG)'}`);

  const token = await generateIntakeToken(theCase.id);
  const payload = await generatePrefilledFormPayload(token);
  console.log('✓ form payload steps:', payload.steps.map((s) => s.name).join(' | '));
  console.log('✓ missing required:', (await getMissingFields(theCase.id)).map((m) => m.key).join(', ') || '(none)');

  console.log('\n✓ Postgres smoke test passed. (Created a "Smoke Test" client/case you can delete.)');
} catch (err) {
  console.error('✖ Smoke test failed:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
