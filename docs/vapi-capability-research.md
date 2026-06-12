# Vapi Capability Research

> Purpose: before building more, determine what Vapi already does natively so we
> don't reimplement platform features. Researched June 2026 against the live docs.
> **Rule: the goal is the best working Vapi agent with the *least* custom code.**

## TL;DR decision table

| Feature | Vapi native? | Build custom? | Use dashboard/config? | Notes |
|---|---:|---:|---:|---|
| Spanish / multilingual | **Yes** | No | **Yes** | Set transcriber language to `multi` + a TTS voice that speaks Spanish; list languages in the prompt. No custom routing. |
| Automatic language detection | **Yes** | No | **Yes** | Deepgram/Google/Gladia auto-detect within a call. Config only. |
| ElevenLabs voices | **Yes** | No | **Yes** | Native voice provider. Pick it in the Voice tab + add EL key *in Vapi*. Delete our custom EL code. |
| Other/better voices | **Yes** | No | **Yes** | 10+ providers (ElevenLabs, Cartesia, PlayHT, Azure, Deepgram, Rime, OpenAI…). Currently using built-in "Elliot". |
| Phone provider / numbers | **Yes** | No | **Yes** | Free Vapi number (limited) or import Twilio/Vonage/Telnyx. No custom telephony. |
| Outbound test calls | **Yes** | No | **Yes** | Dashboard "Call" button + `POST /call` API. Our `npm run call` is a thin convenience wrapper (optional). |
| Call recording | **Yes** | No | **Yes** | Native, encrypted, configurable retention. |
| Call transcripts | **Yes** | No | **Yes** | Native, timestamped. Drop our `saveTranscript` tool. |
| Call summaries | **Yes** | No | **Yes** | Native summary in end-of-call report. Don't build summaries. |
| Post-call analysis / structured outputs | **Yes** | No (extraction) / **Yes** (storage) | **Yes** | Vapi extracts JSON-schema data, sentiment, success eval from the transcript. We only *store* the PI result. |
| Tool / function calls | **Yes** | **Yes** (our endpoints) | **Yes** | Vapi calls our server URLs. The tool *handlers* are our business logic — keep. |
| Post-call webhook | **Yes** | **Yes** (receiver) | **Yes** | Native `end-of-call-report` server event → we add a receiver to persist it. |
| Mock CRM / dedupe / PI schema | No | **Yes** | No | Business-specific. Keep. |
| Opt-out logging + enforcement | Partial | **Yes** | No | Vapi has no PI opt-out ledger. Keep ours. |
| A/B testing prompt variants | **No** | **Yes** | No | Test Suites test *one* assistant vs scripts; no variant comparison. Keep our variant tracking. |
| Post-call score storage | No | **Yes** | No | Storing the score in our CRM is business logic. Keep (fed by Vapi structured outputs). |
| Agent testing / eval | **Yes** | No | **Yes** | Native Test Suites (AI tester calls the agent, LLM-graded vs success criteria). Use instead of bespoke harnesses. |
| CRM integrations (GHL/HubSpot) | Partial | n/a | **Yes** | Native GoHighLevel tool; Make/Zapier middleware. Not our mock CRM, but relevant later. |

---

## Per-feature detail

### 1. Spanish / multilingual + automatic language detection
- **Native?** Yes. Vapi supports multilingual agents with automatic language detection, cross-language conversation, and localized voices.
- **Use:** Dashboard/config. Set the **transcriber language to `multi`** (not English), choose a **TTS voice that supports Spanish** (built-in "Elliot" is English-oriented — use Azure `es-ES-*`, or ElevenLabs/Cartesia multilingual), and **list supported languages in the system prompt**. Deepgram/Google/Gladia do the auto-detection.
- **Setup:** Vapi dashboard (Transcriber + Voice tabs) + one prompt edit.
- **Remove from our plan:** any custom Spanish detection/routing or per-language prompt switching.
- Source: [Multilingual support](https://docs.vapi.ai/customization/multilingual), [Multilingual agent example](https://docs.vapi.ai/assistants/examples/multilingual-agent)

### 2. Voice providers (incl. ElevenLabs)
- **Native?** Yes. ElevenLabs is a first-class provider; also Cartesia, PlayHT, Azure, Deepgram, Rime, OpenAI, LMNT, MiniMax, Inworld.
- **Use:** Dashboard. Voice tab → pick provider/voice. For ElevenLabs, add the EL key **inside Vapi**, not in this repo.
- **Setup:** Vapi Voice tab (+ EL key in Vapi if chosen).
- **Remove from our plan:** `src/services/elevenlabs.js`, `routes/signedUrl.js`, `scripts/setupAgent.js`, and any `ELEVENLABS_*` env in our backend. Already marked legacy — safe to delete.
- Source: [ElevenLabs provider](https://docs.vapi.ai/providers/voice/elevenlabs), [Cartesia](https://docs.vapi.ai/providers/voice/cartesia), [ElevenLabs alternatives](https://vapi.ai/blog/elevenlabs-alternative)

### 3. Phone numbers / telephony / outbound test calls
- **Native?** Yes. Free Vapi number (limited daily outbound) or import **Twilio/Vonage/Telnyx** for scale. Outbound via dashboard or `POST /call` with `assistantId` + `phoneNumberId` + `customer.number`.
- **Use:** Dashboard for setup; API for programmatic calls.
- **Setup:** Vapi **Phone Numbers** tab (import Twilio needs Twilio SID/auth token + the number).
- **Remove from our plan:** any custom telephony. Our `scripts/vapiCall.js` is just a wrapper around `POST /call` — keep only as a convenience; the dashboard's Call button covers manual testing.
- Source: [Import from Twilio](https://docs.vapi.ai/phone-numbers/import-twilio), [Outbound calling](https://docs.vapi.ai/calls/outbound-calling), [Phone calling](https://docs.vapi.ai/phone-calling)

### 4. Recording, transcripts, summaries, structured outputs, analysis
- **Native?** Yes. Recording (encrypted, retention-configurable), timestamped transcripts, an end-of-call **summary**, and **structured outputs** that extract JSON-schema data + sentiment + success evaluation from the full transcript/tool-results after the call (`ai` or `regex` extraction). Delivered via API + webhooks.
- **Use:** Native for capture + extraction; our backend only **persists** the PI-specific result into the mock CRM.
- **Setup:** Dashboard: enable recording; define a **Structured Output schema** (our PI intake fields) on the assistant.
- **Remove from our plan:** `saveTranscript` tool (Vapi already has the transcript); custom summary generation; the keyword heuristic in `postCallAnalysis.js` as the *primary* analyzer — let Vapi extract, keep ours only as an offline fallback.
- Source: [Call recording/logging/transcribing](https://docs.vapi.ai/assistants/call-recording), [Structured outputs quickstart](https://docs.vapi.ai/assistants/structured-outputs-quickstart), [Structured outputs blog](https://vapi.ai/blog/structured-outputs)

### 5. Tool / function calls + server URLs
- **Native?** Yes (the mechanism). Vapi POSTs tool calls to your server URL with a `toolCallId`; you reply with a matching result. URLs settable at org/assistant/tool level.
- **Use:** Native mechanism + **our custom handlers** (the business logic — CRM lookup, save_intake, opt-out). This is exactly what we keep building.
- **Setup:** Dashboard: define each tool (or paste from `GET /tools/_schema`) with Server URL `${WEBHOOK_BASE_URL}/tools/<name>`; set a server secret = `VAPI_WEBHOOK_SECRET`.
- **Remove from our plan:** nothing — but prefer Vapi-native `endCall`/`transferCall` default tools where they fit instead of custom ones.
- Source: [Custom tools](https://docs.vapi.ai/tools/custom-tools), [Default tools](https://docs.vapi.ai/tools/default-tools), [Setting server URLs](https://docs.vapi.ai/server-url/setting-server-urls)

### 6. Post-call webhook (server events)
- **Native?** Yes. `end-of-call-report` (summary, transcript, recording, structured outputs, cost) plus `transcript`, `conversation-update`, `status-update`, `tool-calls`, `hang` events — all POSTed to the server URL. Target <~6s response; host near us-west-2.
- **Use:** Native event + **a receiver we build** to persist the report into the CRM. This is the *correct* place to store transcript/score, replacing agent-invoked `saveTranscript`/`savePostCallAnalysis`.
- **Setup:** Dashboard: set assistant/org Server URL to `${WEBHOOK_BASE_URL}/vapi/events` (to build) + secret.
- Source: [Server events](https://docs.vapi.ai/server-url/events), [Server URLs](https://docs.vapi.ai/server-url)

### 7. Testing / evaluation / monitoring
- **Native?** Yes. **Test Suites**: an AI tester calls/chats your agent following a script; the transcript is graded by an LLM against your success criteria. Native logs include audio, transcripts, and AI success evaluations. Third parties (Cekura, Hamming, Coval) extend with persona/load/red-team testing.
- **Use:** Native Test Suites for conversation-quality/regression testing. Our `node:test` suite stays for **backend tool logic** (no phone call), which Test Suites don't cover.
- **Setup:** Dashboard **Test** section (define tester prompt + success questions).
- **Remove from our plan:** any bespoke "simulate a conversation and grade it" harness — use Test Suites.
- Source: [Test Suites](https://docs.vapi.ai/test/test-suites), [Voice testing](https://docs.vapi.ai/test/voice-testing), [Test Suites blog](https://vapi.ai/blog/launching-testing-suites)

### 8. CRM integrations
- **Native?** Partial. Native **GoHighLevel** tool (contacts, calendars, appointments); Make/Zapier as middleware; Sympana connector for GHL.
- **Use:** Not relevant to our **mock** CRM (a local dev stand-in). If a real CRM is chosen later (e.g., GHL), prefer the native integration over custom sync code.
- **Remove from our plan:** don't build custom CRM *sync* until a real CRM is chosen; the mock + tool endpoints are enough for the MVP.
- Source: [GoHighLevel integration](https://docs.vapi.ai/tools/go-high-level), [Intro to tools](https://docs.vapi.ai/tools), [Vapi on Zapier](https://zapier.com/apps/vapi-ca229271/integrations)

---

## What gets removed / demoted in our repo plan

| Item in repo | Verdict | Action |
|---|---|---|
| `services/elevenlabs.js`, `routes/signedUrl.js`, `scripts/setupAgent.js`, `ELEVENLABS_*` env | Redundant (Vapi handles voice) | Already legacy → delete in a cleanup pass |
| `saveTranscript` tool | Redundant (native transcripts) | Deprecate; rely on end-of-call-report |
| Custom summary / sentiment heuristic as primary (`postCallAnalysis.js`) | Redundant (native structured outputs) | Demote to offline fallback only |
| `scoreCall` heuristic as source of truth | Redundant | Feed score from Vapi structured outputs; keep storage |
| Deterministic intake **state machine** | Likely overbuilt (LLM + prompt lead the call) | Defer/keep as optional safety net; remove if calls don't skip fields |
| Custom Spanish routing (never built) | Don't build | Use Vapi `multi` transcriber + multilingual voice |
| Custom telephony (never built) | Don't build | Use Vapi numbers / Twilio import |

## What stays (genuinely business-specific)

Mock CRM / local dev DB · `lookup_crm_contact` duplicate & returning-caller detection ·
PI intake data schema · lead create/update · opt-out logging **and enforcement** ·
escalation flagging (`transfer_to_human`) · prompt-variant tracking + A/B comparison ·
post-call **score storage** · the **end-of-call-report receiver** that persists Vapi's
structured outputs into the CRM.

## Credentials / dashboard setup implied by this research

- **Vapi:** API key (private + public), assistant, phone number id, server secret. *(needed)*
- **Twilio** (only to scale beyond the free Vapi number): Account SID, Auth Token, the number. *(optional)*
- **ElevenLabs** (only if we switch off built-in "Elliot"): EL key entered **in Vapi**, not here. *(optional)*
- **Dashboard config (no code):** voice/model/transcriber providers, `multi` for Spanish, recording on, structured-output schema, tool definitions + server URLs, server-event webhook URL, interruption/silence/voicemail settings.

Sources consolidated: [Vapi docs](https://docs.vapi.ai), [phone import](https://docs.vapi.ai/phone-numbers/import-twilio), [multilingual](https://docs.vapi.ai/customization/multilingual), [custom tools](https://docs.vapi.ai/tools/custom-tools), [server events](https://docs.vapi.ai/server-url/events), [structured outputs](https://docs.vapi.ai/assistants/structured-outputs-quickstart), [call recording](https://docs.vapi.ai/assistants/call-recording), [test suites](https://docs.vapi.ai/test/test-suites), [ElevenLabs provider](https://docs.vapi.ai/providers/voice/elevenlabs).
