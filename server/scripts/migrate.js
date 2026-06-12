// Apply the Postgres schema. Usage: npm run migrate  (requires DATABASE_URL)
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { query, closePool, pgEnabled } from '../src/db/pg.js';

if (!pgEnabled()) {
  console.error('✖ DATABASE_URL is not set. Set it in server/.env to use Postgres.');
  process.exit(1);
}

const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/db/schema.sql');
const sql = readFileSync(schemaPath, 'utf8');

try {
  await query(sql);
  console.log('✓ Postgres schema applied (clients, cases, intake_fields, intake_calls, email_logs).');
} catch (err) {
  console.error('✖ Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
