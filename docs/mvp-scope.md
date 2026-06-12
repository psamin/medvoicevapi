# MVP Scope — Vapi PI Intake Agent

Derived from [vapi-capability-research.md](./vapi-capability-research.md). Principle:
**use Vapi natively wherever possible; only write code for business-specific logic.**

## The three buckets

### Bucket 1 — Use Vapi out of the box (no work)
- Phone number (free Vapi number for testing) and the call flow
- Voice selection (built-in "Elliot" today; any provider incl. ElevenLabs later)
- Spanish / multilingual + automatic language detection
- Call recording, transcripts, and end-of-call **summary**
- Basic outbound/inbound test calls (dashboard "Call" button)
- Test Suites for conversation-quality testing

### Bucket 2 — Configure in the Vapi dashboard (no code, just settings)
- Providers: voice, model (OpenAI), transcriber (Deepgram; set to `multi` for Spanish)
- Phone number assignment + (later) Twilio import
- First message + main system prompt (from `GET /api/prompts/:version`)
- **Structured Output schema** = our PI intake fields (so Vapi extracts them)
- Tool definitions + Server URLs (`${WEBHOOK_BASE_URL}/tools/<name>`) + server secret
- Server-event webhook URL (end-of-call-report)
- Interruption / silence timeout / response speed / voicemail behavior / recording on

### Bucket 3 — Build in this repo (business-specific only)
- Mock CRM / local dev DB *(done)*
- Tool endpoints Vapi calls: `lookup_crm_contact`, `log_consent`, `record_opt_out`,
  `save_intake`, `transfer_to_human`, `schedule_callback` *(done)*
- PI intake data schema + lead create/update *(done)*
- Opt-out logging **and enforcement** *(done)*
- Escalation flagging *(done)*
- Prompt-variant tracking + **A/B comparison** *(variants done; comparison TODO)*
- Post-call **score storage** *(done; should be fed by Vapi structured outputs)*
- **End-of-call-report webhook receiver** that persists Vapi's transcript/summary/
  structured outputs into the CRM *(TODO — replaces agent-invoked saveTranscript)*

## What we are building now (MVP)
1. Keep the CRM tool endpoints (Bucket 3) and wire them into the Vapi assistant.
2. Add a **`/vapi/events` webhook receiver** for `end-of-call-report` to store the
   native transcript + summary + structured outputs (replaces `saveTranscript` and
   demotes the custom analysis heuristic to a fallback).
3. Define the **Structured Output schema** in Vapi for the PI fields.
4. Use the promoted first line + main prompt (from the attached prompt docs).

## What we are NOT building (Vapi already handles it)
- Custom telephony / phone infrastructure
- Custom ElevenLabs API integration
- Custom Spanish detection or per-language routing
- Custom call recording / transcription
- Custom summary generation
- A bespoke "simulate + grade a conversation" test harness (use Test Suites)

## Blocked by credentials
- Real web/phone test calls: `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`,
  `VAPI_PUBLIC_KEY`, `VAPI_WEBHOOK_SECRET` (none set in `server/.env` yet).
- Scaling outbound beyond the free number: Twilio SID/Auth Token + number.
- Custom voice (only if we leave "Elliot"): ElevenLabs key (entered in Vapi).

## Blocked by Vapi dashboard access
- Creating/configuring the assistant (providers, prompt, structured-output schema)
- Registering tools + server URLs + server secret
- Setting the server-event webhook URL
- Importing a Twilio number; enabling recording; tuning interruption/silence/voicemail

## Needs Iqbol / Fayyoz approval
- Buying/porting a real phone number (cost) and any Twilio account usage
- Choosing the production CRM (mock now; GoHighLevel/other later)
- Production data handling: recording consent storage, PII retention, compliance review
- Go-live on real inbound traffic for Henry's Law Firm

## What can be tested locally (no Vapi, no phone call)
- All `/tools/*` and `/api/*` endpoints via curl
- `npm test` (18 tests: CRM scenarios, intake, unit) — already green
- Mock CRM dedupe, opt-out enforcement, identity gating, document checklist
- Prompt rendering (`GET /api/prompts/:version`)

## What requires a real Vapi test call
- Voice quality / interruption / latency tuning (Bucket 2 settings, not prompt)
- Spanish auto-detection end-to-end
- Live tool-call round-trips from the assistant
- End-of-call-report delivery to our webhook
- Test Suites runs and success-criteria grading

## Updated 10-iteration loop (diagnose before editing the prompt)
Before each iteration, classify the failure — **prompt**, **Vapi setting**, or
**backend/tool** — and fix it in the right place:

| Symptom | Likely cause | Fix where |
|---|---|---|
| Agent interrupts too much | silence/interruption settings | Vapi dashboard |
| Voice sounds bad | voice provider/voice | Vapi dashboard |
| Spanish fails | transcriber `multi` / voice language | Vapi dashboard |
| Tool calls fail | tool schema / server URL / secret | Repo schema + Vapi tool config |
| Bad/unsafe answers | wording, guardrails | Prompt |
| Misses structured fields | prompt + structured-output schema | Prompt + Vapi schema |
| Call too slow | verbosity / response settings | Prompt brevity + Vapi settings |

**Rule:** don't keep editing the prompt for problems that are really Vapi settings
or tool-schema issues. The goal is the best working agent with the least custom code.

## Status snapshot
- **Done (repo):** mock CRM, 6 CRM tools, opt-out enforcement, identity gating,
  document checklist, prompt variants, 18 passing tests.
- **Next (repo):** end-of-call-report webhook receiver; A/B comparison reporting;
  demote custom analysis to fallback; delete legacy ElevenLabs code.
- **Next (dashboard):** create assistant, set providers + `multi`, structured-output
  schema, register tools + webhook + secret.
- **Blocked:** real Vapi/Twilio credentials + stakeholder approval for number/CRM/go-live.
