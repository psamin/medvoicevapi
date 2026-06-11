// Trigger an outbound Vapi phone test call.
//
// Usage:
//   node scripts/vapiCall.js +15551234567
//   npm run call -- +15551234567
//
// Requires in server/.env:  VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID
// Does NOT invent credentials — if any are missing it prints exactly what to set
// and exits without calling Vapi.
import 'dotenv/config';

const { VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID } = process.env;
const destination = process.argv[2];

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const missing = [
  !VAPI_API_KEY && 'VAPI_API_KEY',
  !VAPI_ASSISTANT_ID && 'VAPI_ASSISTANT_ID',
  !VAPI_PHONE_NUMBER_ID && 'VAPI_PHONE_NUMBER_ID',
].filter(Boolean);

if (missing.length) {
  fail(
    `Missing required env var(s): ${missing.join(', ')}.\n` +
      `  Set them in server/.env. Get them from the Vapi dashboard:\n` +
      `   - VAPI_API_KEY        → API Keys (private)\n` +
      `   - VAPI_ASSISTANT_ID   → Assistants → your assistant\n` +
      `   - VAPI_PHONE_NUMBER_ID→ Phone Numbers`
  );
}

if (!destination) {
  fail('Provide a destination phone number, e.g.  npm run call -- +15551234567');
}

console.log(`Placing Vapi call to ${destination} with assistant ${VAPI_ASSISTANT_ID}...`);

const res = await fetch('https://api.vapi.ai/call', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${VAPI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    assistantId: VAPI_ASSISTANT_ID,
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: { number: destination },
  }),
});

const text = await res.text();
if (!res.ok) {
  fail(`Vapi API error ${res.status}: ${text}`);
}

console.log('✓ Call created:\n', text);
