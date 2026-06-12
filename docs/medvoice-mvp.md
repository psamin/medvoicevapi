# MedVoice MVP — Setup & Testing

The smallest clean version of a Vapi-powered PI voice intake agent: it takes a
call, captures high-value fields, stores a client/case/call, emails a **prefilled**
intake form, and lets the client finish the rest. Runs fully in **dry-run** with no
keys.

## What this MVP does
- Vapi voice intake agent (inbound + outbound **test** calls, Vapi only — no Twilio)
- Vapi event / end-of-call webhook handling → stores client, case, call, transcript, summary, fields
- Lightweight CRM/intake storage (JSON dev DB)
- 5-step intake field config (single source of truth)
- Secure, prefilled client intake form
- Emails the form link after the call (SendGrid or dry-run)
- Simple reminder email endpoint
- Dry-run modes for email **and** Vapi calls when keys are missing

## Intentionally out of scope
Twilio, SMS, MCP, complex reminder scheduling, admin dashboard, advanced outbound
chasing, auth/roles/analytics/multi-tenant. (See "Future scope" in the README.)

## API keys needed
| Key | Needed for | Without it |
|---|---|---|
| `VAPI_API_KEY` | real inbound/outbound calls | outbound dry-runs; inbound needs the dashboard wired |
| `VAPI_ASSISTANT_ID` | the assistant to run | — |
| `VAPI_PHONE_NUMBER_ID` | phone calls | — |
| `VAPI_WEBHOOK_SECRET` (`VAPI_SERVER_URL_SECRET`) | verifying Vapi webhooks | skipped locally |
| `SENDGRID_API_KEY` + `FROM_EMAIL` | sending real email | emails are dry-run logged |
| `APP_BASE_URL` | the form link in emails | defaults to `http://localhost:3000` |

`DRY_RUN_EMAILS=true` and `DRY_RUN_VAPI_CALLS=true` are the safe defaults. No Twilio vars.

## Run locally
```bash
cd server && npm install && npm run dev      # http://localhost:3001
cd frontend && npm install && npm run dev    # http://localhost:3000
cp server/.env.example server/.env           # fill in when you have keys
cd server && npm test                         # 28 tests, all dry-run (JSON store)
```

## Storage: Postgres or JSON
Storage is pluggable behind `server/src/mvp/repo.js`:
- **JSON dev store (default):** no setup; data persists to `server/data/mock-db.json`. Used by tests.
- **Postgres:** set `DATABASE_URL` in `server/.env`, then:
  ```bash
  cd server
  npm run migrate     # creates tables from src/db/schema.sql
  npm run db:smoke    # end-to-end check through the app (creates a "Smoke Test" row)
  npm run dev         # boot log shows "Storage: postgres"
  ```
  Tables: `clients`, `cases`, `intake_fields`, `intake_calls`, `email_logs`
  (record JSONB + indexed lookup columns). Set `PGSSL=disable` for a local server
  without SSL. Nothing else in the app changes between backends.

## Expose the backend to Vapi (ngrok)
```bash
ngrok http 3001
```
Then in the **Vapi dashboard → your assistant → Advanced / Server**:
- Set the **Server URL** to `https://<ngrok>/api/vapi/events` (receives server events incl. `end-of-call-report`).
- Set the **Server URL Secret** to the same value as `VAPI_WEBHOOK_SECRET`.
- (Optional) register tools `upsert-intake-fields` and `get-missing-fields` with
  Server URLs `https://<ngrok>/api/vapi/tools/<name>`.
- Paste the prompts from `prompts/vapi-mvp-opening-line.md` (first message) and
  `prompts/vapi-mvp-intake-agent.md` (system prompt).

## Test inbound calls
1. Wire the Server URL + prompts as above; set `DRY_RUN_EMAILS`/`DRY_RUN_VAPI_CALLS` as desired.
2. Call your Vapi number. At end of call, Vapi POSTs `end-of-call-report` to
   `/api/vapi/events` → a client/case/call is created and the form email is sent
   (or dry-run logged). Check `GET /api/debug/db`.

## Test outbound calls
```bash
curl -X POST http://localhost:3001/api/vapi/outbound-test-call \
  -H 'content-type: application/json' -d '{"phone":"+15551234567"}'
# dry-run by default; set DRY_RUN_VAPI_CALLS=false + VAPI_* keys to place a real call
```

## Deploying the prompt (config-as-code)
The `prompts/*.md` files are the source of truth; push them to the Vapi assistant:
```bash
cd server
npm run sync:assistant -- --create   # first time → prints a new VAPI_ASSISTANT_ID to paste into .env
npm run sync:assistant               # thereafter → PATCHes that assistant in place
```
It deploys `vapi-mvp-intake-agent.md` (system prompt) + `vapi-mvp-inbound-first-message.md`
(first message), and — when `WEBHOOK_BASE_URL` is set — wires the end-of-call webhook
and the `upsert-intake-fields` / `get-missing-fields` tools (with `VAPI_WEBHOOK_SECRET`).
Edit a prompt file → commit → re-run sync. Don't hand-edit the dashboard prompt (drift).
The `/vapi` web page uses the deployed assistant as-is (no override).

## Opt-out handling (outbound only)
Opt-out is an **outbound-only** concern — the inbound intake prompt has no opt-out
step (an inbound caller dialed in; they're not on an outbound list).
Outbound calls honor a do-not-call list backed by the shared CRM opt-out store
(single source of truth — no duplicate state):
- **Pre-dial check:** `/api/vapi/outbound-test-call` refuses opted-out numbers and
  returns `{ skipped: true, reason: "opted_out" }` (never hits Vapi, not a failure).
- **On the call:** the opening line discloses opt-out before the good-time check; if
  the caller says "stop calling me" / "remove me" / "do not call", the assistant calls
  the `record-opt-out` tool and ends.
- **Inbound opt-outs** (via `/tools/record_opt_out`) block future outbound too.
- **Dev/test endpoints:**
  ```bash
  curl "http://localhost:3001/api/vapi/opt-out?phone=+15551234567"      # status
  curl -X POST http://localhost:3001/api/vapi/opt-out -H 'content-type: application/json' -d '{"phone":"+15551234567"}'
  curl http://localhost:3001/api/vapi/opt-outs                           # list (debug)
  ```
Phone numbers are normalized (formatting + US country code) so all formats match.

## View saved data (staff dashboard)
After a call ends (or any simulated end-of-call), open **http://localhost:3000/dashboard**
— a read-only view of every case: client, status, captured fields (tagged `call` /
`form`), transcripts/summaries, emails, missing fields, and flags. It auto-refreshes
every 5s, so a case appears right after the call ends. (Raw data is also at
`GET /api/cases` and `GET /api/debug/db`.)

## Duplicate detection
- **Exact de-dupe** by phone (normalized) or email — same caller updates the same client.
- **Possible duplicate** when the name matches an existing client but the number is new:
  the case is flagged `possibleDuplicate` (linked to the other client) for staff review
  on the dashboard. Never auto-merged.

## Test the intake form (no phone call needed)
```bash
# 1) Simulate an end-of-call to create a case + token
TOKEN=$(curl -s -X POST http://localhost:3001/api/vapi/end-of-call -H 'content-type: application/json' \
 -d '{"message":{"type":"end-of-call-report","analysis":{"structuredData":{"firstName":"Maria","phone":"+15553331212","email":"maria@example.com","accidentType":"Motor Vehicle Accident"}}}}' \
 | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
# 2) Open the form in the browser
open "http://localhost:3000/intake/$TOKEN"
```
The form shows prefilled values, highlights missing required fields, includes only
the Step 4 module matching the accident type, and hides staff-only fields.

## Test email dry-run mode
With `DRY_RUN_EMAILS=true` (or no `SENDGRID_API_KEY`), emails are logged, not sent:
```
[email:dry-run] to=maria@example.com subject="Complete your MedVoice intake form"
```
and recorded in `GET /api/debug/db` under `emailLogs` with `status: "dry_run"`.

## Key endpoints (flow only)
- `GET /api/health`
- `POST /api/vapi/events`, `POST /api/vapi/end-of-call` (Vapi → backend; secret-gated)
- `POST /api/vapi/tools/upsert-intake-fields`, `.../get-missing-fields` (optional Vapi tools)
- `POST /api/vapi/outbound-test-call` (Vapi-only outbound)
- `GET /intake/:token` (form page), `GET/POST /api/intake/:token` (load/submit)
- `POST /api/intake/send-reminder`

## What's still mocked / not real
CRM is a local JSON file; email/calls dry-run by default; the Vapi assistant is
configured in the dashboard (not by code); reminders are manual (no scheduler).
