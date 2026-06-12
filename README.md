# MedVoice

MedVoice is a Vapi-powered AI voice intake agent that collects core personal-injury
intake information over the phone, stores it in a lightweight CRM/intake backend,
generates a **prefilled** client intake form, and emails the form link to the client
so they can complete the missing information.

> Setup, env, and step-by-step testing live in **[docs/medvoice-mvp.md](docs/medvoice-mvp.md)**.
> This README explains how the pieces connect.

## What MedVoice Does

- Handles AI intake calls through **Vapi** (inbound + outbound *test* calls — Vapi only, no Twilio).
- Collects the **highest-value** case information conversationally, one question at a time.
- Stores **clients, cases, calls, transcripts/summaries, and normalized intake fields**.
- Generates a **secure, prefilled** 5-step intake form (token-based link).
- **Emails** the form link to the client after the call (SendGrid, or dry-run logging).
- Supports a basic **reminder** email and **dry-run modes** for email and Vapi calls.

## System Overview

```mermaid
flowchart TD
    A[Client / Caller] --> B[Vapi Voice Agent]
    B --> C[MedVoice Backend - Express]
    C --> D[(CRM / Intake Storage - JSON dev DB)]
    C --> E[Intake Field Config]
    C --> F[Client Intake Form - Next.js]
    C --> G[Email Service]
    G --> H[Client Email Inbox]
    H --> F
    F --> C
    C --> I[Vapi Outbound Test Call]
    I --> A
```

- **Vapi Voice Agent** — runs the conversation: telephony, transcription (Deepgram), model (OpenAI), and the voice. Calls the backend via webhooks/tools.
- **MedVoice Backend** (`server/`, Express/ESM) — receives Vapi events, runs the intake services, serves the form API, sends email, and triggers outbound test calls.
- **CRM / Intake Storage** — pluggable behind a repository (`server/src/mvp/repo.js`): **Postgres** when `DATABASE_URL` is set (`server/src/db/pg.js` + `schema.sql`, `npm run migrate`), or a **JSON file dev store** (`server/src/db/mockDb.js`) with zero setup otherwise. Entities: clients, cases, intakeFields, intakeCalls, emailLogs.
- **Intake Field Config** (`server/src/config/intakeFields.js`) — single source of truth for the 5-step form, what the call prioritizes, and required/conditional/staff-only/sensitive rules.
- **Client Intake Form** (`frontend/app/intake/[token]/page.js`) — the prefilled, token-secured 5-step form.
- **Email Service** (`server/src/mvp/emailService.js`) — SendGrid via REST, or dry-run.
- **Outbound Vapi Call** (`server/src/mvp/vapiService.js`) — places a Vapi test call (dry-run by default).

## End-to-End Flow

```mermaid
sequenceDiagram
    participant Client
    participant Vapi as Vapi Voice Agent
    participant Backend as MedVoice Backend
    participant CRM as CRM / Intake Store
    participant Email as Email Service
    participant Form as Intake Form

    Client->>Vapi: Intake phone call
    Vapi->>Client: AI disclosure + intake questions
    Vapi->>Backend: Call events / end-of-call report
    Backend->>CRM: Save client, case, call, transcript, fields (source=call)
    Backend->>Backend: Generate secure intake form token
    Backend->>Email: Send intake form link
    Email->>Client: Intake form email (dry-run logged if no key)
    Client->>Form: Opens prefilled form
    Form->>Backend: Submit missing fields (source=form)
    Backend->>CRM: Update intake record + recompute status
```

## Call Intake Flow

The voice agent does **not** collect every field. It captures the highest-value
information first, then a prefilled form covers the rest. On the call it collects:
consent to continue, name, phone, email, accident type, accident date, accident
location, a short description of what happened, injury/treatment summary, ER/urgent
care status, police-report status, insurance/claim info (if handy), preferred
contact method, and primary language.

```mermaid
flowchart LR
    A[AI Disclosure] --> B[Confirm Consent]
    B --> C[Collect Contact Info]
    C --> D[Collect Accident Details]
    D --> E[Collect Injury / Treatment Info]
    E --> F[Collect Insurance Info if Available]
    F --> G[Explain Follow-Up Intake Form]
    G --> H[End Call + Save Data]
```

Prompts: `prompts/vapi-mvp-opening-line.md`, `prompts/vapi-mvp-intake-agent.md`,
`prompts/vapi-mvp-outbound-test-agent.md`.

## Intake Form Flow

The form is generated after the call, prefilled from call-collected data. The client
completes what's missing; submissions update the same case record. Staff-only fields
are hidden, and the conditional Step 4 module is chosen by accident type.

```mermaid
flowchart TD
    A[Call-Collected Fields] --> B[CRM / Intake Store]
    B --> C[Generate Secure Intake Link]
    C --> D[Prefilled Intake Form]
    D --> E[Client Completes Missing Fields]
    E --> F[Update CRM / Intake Store]
```

## Intake Form Structure

A 5-step form. Step 4 is **conditional on accident type**.

1. **Patient** — client information; primary care provider
2. **Incident** — accident details; police report; witness/video info
3. **Treatment** — ER/urgent care; imaging; procedures; missed work/school; bills/claims
4. **Module** *(conditional)* — Premises Liability **or** Motor Vehicle Accident **or** Workplace Injury
5. **Coverage** — insurance information; attorney/paralegal assignment *(staff-only)*; notes

## Data Model Overview

- **Client** — basic contact info + language/contact preferences.
- **Case** — accident, injury, status, and case-level fields; holds the form token.
- **IntakeField** — normalized per-field value with `source`, `status`, `confidence`, and client-facing/staff-only flags.
- **Call** (`intakeCalls`) — Vapi call metadata: id, direction, transcript, summary, recording link.
- **EmailLog** — each form/reminder email attempt and its status.

```mermaid
erDiagram
    CLIENT ||--o{ CASE : has
    CASE ||--o{ INTAKE_FIELD : contains
    CASE ||--o{ CALL : records
    CASE ||--o{ EMAIL_LOG : sends

    CLIENT {
        string id
        string firstName
        string lastName
        string phone
        string email
    }
    CASE {
        string id
        string clientId
        string status
        string accidentType
        string accidentDate
    }
    INTAKE_FIELD {
        string id
        string caseId
        string fieldKey
        string value
        string source
        string status
    }
    CALL {
        string id
        string caseId
        string vapiCallId
        string direction
        string transcript
    }
    EMAIL_LOG {
        string id
        string caseId
        string toEmail
        string status
    }
```

## Field Source Tracking

Each intake field records where its value came from: `call`, `form`, `staff`, or
`outbound_call`. This lets the system show what the AI captured on the call vs. what
the client confirmed in the form, compute which required fields are still missing,
and keep prefilled values editable.

**Duplicate handling.** Clients are de-duped exactly by **phone (normalized) or
email** — the same caller (even with the number typed differently) updates the same
record. A returning caller with the **same name but a new number** can't be matched
exactly, so the case is **flagged `possibleDuplicate`** (linked to the other client)
for staff review on the dashboard — it is never auto-merged, since two people can
share a name.

**Dashboard.** `/dashboard` is a read-only staff view of every saved case: client,
status, captured fields (tagged by source), call transcripts/summaries, emails sent,
missing fields, and duplicate/human-follow-up flags. It auto-refreshes, so cases
appear right after a call ends.

## Vapi Integration (conceptual)

Vapi runs the voice agent and handles the phone call, then sends call data back to
the backend (`/api/vapi/events`, `/api/vapi/end-of-call`). The backend stores the
transcript, summary, and extracted fields, and can trigger outbound **test** calls
through Vapi (`/api/vapi/outbound-test-call`). Two optional tools
(`upsert-intake-fields`, `get-missing-fields`) let the agent save fields mid-call.
*(Configuration details are in [docs/medvoice-mvp.md](docs/medvoice-mvp.md).)*

**Prompt management (config-as-code).** The repo's `prompts/*.md` files are the
single source of truth. Deploy them to the persistent Vapi assistant via the API:
```bash
cd server && npm run sync:assistant         # PATCH the assistant from the prompt files
#            npm run sync:assistant -- --create   # first time: make a new assistant
```
Don't hand-edit the prompt in the dashboard (it would drift from the repo). The
`/vapi` web-call test page uses the **deployed assistant as-is** (no prompt override),
so it faithfully matches real phone calls. Opt-out disclosure is **outbound-only** —
the inbound intake prompt has no opt-out step.

## Email Flow

```mermaid
flowchart LR
    A[Call Ends] --> B[Generate Intake Link]
    B --> C[Send Email]
    C --> D[Client Opens Form]
    D --> E[Client Completes Missing Fields]
```

If `SENDGRID_API_KEY` is missing or `DRY_RUN_EMAILS=true`, the app logs the email
instead of sending it and records an `EmailLog`. Reminders are basic in this MVP
(`POST /api/intake/send-reminder`) — no automated schedule.

## Current MVP Scope (implemented)

- Vapi voice intake agent (prompts + inbound webhook handling)
- Vapi event / end-of-call processing
- CRM / intake field storage (local JSON dev store by default)
- Prefilled 5-step client intake form
- Emailing the form link (SendGrid or dry-run)
- Basic outbound Vapi test call + outbound opt-out / do-not-call handling
- Duplicate detection: exact de-dupe by phone/email + **possible-duplicate flag** by name (flagged for review, never auto-merged)
- Read-only **staff dashboard** (`/dashboard`) showing every case, fields by source, transcripts, emails, missing fields, and duplicate flags
- Simple reminder email endpoint
- Dry-run modes for email and Vapi calls
- 37 automated checks (`npm test`)

## ⚠️ Known Constraints (must change before production)

These are intentional MVP shortcuts — the app works locally today, but each of
these needs to change before any real/production use:

- **Storage is a local JSON dev store.** Postgres scaffolding exists behind a
  repository (`server/src/mvp/repo.js`, set `DATABASE_URL`) but is unused by default
  and unverified against a live DB. **Future:** run on a managed Postgres (or at
  least SQLite locally); migrate the legacy CRM collections and the opt-out store
  onto the same DB so nothing lives in the JSON file.
- **No telephony provider integrated.** Calls go through Vapi only. **Future:**
  **Twilio integration** (import/port a real number, SMS reminders) — none of the
  Twilio path exists yet.
- **Opt-out store lives in the JSON CRM layer**, not the MVP DB. **Future:** move it
  onto the repo/Postgres path when storage is migrated.
- **Email/calls default to dry-run** and the Vapi assistant is configured by hand in
  the dashboard (not provisioned by code).
- **No auth, rate limiting, or audit logging**; single-process only.

## Future Scope (planned, not implemented)

- **Move storage to a managed database (Postgres)** — see Constraints above
- **Twilio integration** — real number import/porting + SMS reminders
- MCP tool layer
- Admin CRM dashboard
- Automated reminder scheduling (no scheduler today)
- Production auth / roles, rate limiting, audit logging
- Human-handoff workflow *(the call sets a `humanFollowUpNeeded` flag today, but there's no downstream workflow)*
- Deeper analytics / call scoring *(a heuristic post-call analyzer exists from an earlier layer; not wired into the MVP flow)*
- Compliance review (TCPA, recording-consent retention, PII handling)

> Note: the repo also contains an **earlier CRM-tools layer** (`/tools/*`,
> `server/src/crm/`) and Vapi capability research (`docs/vapi-capability-research.md`,
> `docs/mvp-scope.md`) from prior iterations. The MedVoice MVP described here is the
> current focus.

## Important Design Principle

MedVoice is intentionally split into two stages:

1. The **voice call** collects high-signal intake information quickly.
2. The **intake form** completes the remaining structured fields.

This keeps the phone call short while still giving the CRM a complete intake record.
