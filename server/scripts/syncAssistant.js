// Config-as-code: deploy the repo's prompt to the Vapi assistant via the API.
// The repo files are the SINGLE SOURCE OF TRUTH; this pushes them to Vapi.
//
// Usage:
//   npm run sync:assistant          # update VAPI_ASSISTANT_ID in place (PATCH)
//   npm run sync:assistant -- --create   # create a new assistant, print its id
//
// Reads (this assistant handles INBOUND intake; opt-out is outbound-only):
//   prompts/vapi-mvp-intake-agent.md          -> system prompt
//   prompts/vapi-mvp-inbound-first-message.md -> first message
// Requires: VAPI_API_KEY  (+ VAPI_ASSISTANT_ID for PATCH).
// If WEBHOOK_BASE_URL is set, also wires the end-of-call webhook + the 3 MVP tools
// (with VAPI_WEBHOOK_SECRET as the server secret).
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const API = 'https://api.vapi.ai';
const { VAPI_API_KEY, VAPI_ASSISTANT_ID, WEBHOOK_BASE_URL, VAPI_WEBHOOK_SECRET } = process.env;
const create = process.argv.includes('--create');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
if (!VAPI_API_KEY) fail('VAPI_API_KEY is required in server/.env');
if (!create && !VAPI_ASSISTANT_ID) fail('Set VAPI_ASSISTANT_ID in server/.env, or run with --create to make a new assistant.');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8').trim();
const systemPrompt = read('prompts/vapi-mvp-intake-agent.md');
const firstMessage = read('prompts/vapi-mvp-inbound-first-message.md');

// Optional: wire tools + end-of-call webhook when a public URL is configured.
const base = WEBHOOK_BASE_URL ? WEBHOOK_BASE_URL.replace(/\/$/, '') : null;
const server = base ? { url: `${base}/api/vapi/events`, ...(VAPI_WEBHOOK_SECRET ? { secret: VAPI_WEBHOOK_SECRET } : {}) } : null;

function fnTool(name, description, properties, required = []) {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
    server: { url: `${base}/api/vapi/tools/${name}`, ...(VAPI_WEBHOOK_SECRET ? { secret: VAPI_WEBHOOK_SECRET } : {}) },
  };
}
// Inbound assistant: intake tools only. Opt-out is an OUTBOUND-only concern, so
// record-opt-out is not registered here (outbound calls are screened server-side
// by the pre-dial do-not-call check).
const tools = base
  ? [
      fnTool('upsert-intake-fields', 'Save captured intake fields for the case as they are confirmed.',
        { caseId: { type: 'string' }, phone: { type: 'string' }, fields: { type: 'object', description: 'key/value pairs of intake fields' } }),
      fnTool('get-missing-fields', 'Return which required intake fields are still missing for the case.',
        { caseId: { type: 'string' }, phone: { type: 'string' } }),
    ]
  : null;

async function vapi(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) fail(`Vapi API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

if (create) {
  const payload = {
    name: 'MedVoice Intake',
    firstMessage,
    model: { provider: 'openai', model: 'gpt-4o', messages: [{ role: 'system', content: systemPrompt }], ...(tools ? { tools } : {}) },
    ...(server ? { server } : {}),
  };
  const a = await vapi('POST', '/assistant', payload);
  console.log(`✓ Created assistant ${a.id}`);
  console.log(`  → put this in server/.env:  VAPI_ASSISTANT_ID=${a.id}`);
} else {
  // Merge into the existing model so we don't clobber the dashboard's provider/voice/etc.
  const current = await vapi('GET', `/assistant/${VAPI_ASSISTANT_ID}`);
  const model = { ...(current.model || { provider: 'openai', model: 'gpt-4o' }), messages: [{ role: 'system', content: systemPrompt }], ...(tools ? { tools } : {}) };
  await vapi('PATCH', `/assistant/${VAPI_ASSISTANT_ID}`, { firstMessage, model, ...(server ? { server } : {}) });
  console.log(`✓ Synced prompt + first message to assistant ${VAPI_ASSISTANT_ID}`);
}
console.log(tools ? '  + wired end-of-call webhook and 3 MVP tools (WEBHOOK_BASE_URL set)' : '  (set WEBHOOK_BASE_URL to also wire the webhook + tools)');
