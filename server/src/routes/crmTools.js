// Vapi CRM tool endpoints (snake_case paths, per the intake spec). These are the
// canonical tools to wire into the Vapi assistant. They reuse the Vapi adapter so
// each works with Vapi's wrapped tool-call webhook AND plain curl/test JSON.
import { Router } from 'express';
import { toolHandler } from '../vapi/adapter.js';
import { save } from '../db/mockDb.js';
import {
  matchContact,
  recordOptOut,
  isOptedOut,
  logConsent,
  saveIntake,
} from '../crm/crmService.js';

const router = Router();

// POST /tools/lookup_crm_contact — { phone, name, email, identity_confirmed? }
// Detects duplicates / returning callers. Does NOT reveal prior case details
// unless identity_confirmed is true (privacy). matchedRecordId is internal-only.
router.post(
  '/lookup_crm_contact',
  toolHandler('lookup_crm_contact', (args) => {
    const m = matchContact({ phone: args.phone, name: args.name, email: args.email });
    const identityConfirmed = args.identity_confirmed === true;

    const payload = {
      match: m.matchType, // exact | possible | none
      isReturningCaller: m.isReturningCaller,
      matchedRecordId: m.matchedRecordId, // internal use only
      identityConfirmed,
    };

    if (!m.lead) {
      return { payload: { ...payload, message: 'No existing contact found. Treat as a new caller.' } };
    }
    if (!identityConfirmed) {
      // Returning caller, but identity not verified — reveal nothing case-specific.
      return {
        payload: {
          ...payload,
          message:
            m.matchType === 'exact'
              ? 'A matching contact exists. Confirm the caller’s identity (name + one detail) before discussing any prior information.'
              : 'A possible match exists by name. Verify identity by phone/email before proceeding.',
        },
      };
    }
    // Identity confirmed → safe to share a limited, non-sensitive summary.
    return {
      payload: {
        ...payload,
        contact: {
          firstName: m.lead.firstName,
          lastName: m.lead.lastName,
          leadStatus: m.lead.leadStatus,
          optedOut: m.lead.optedOut,
          missingFields: m.lead.missingFields,
          previousCallCount: m.lead.previousCallCount,
        },
        message: 'Identity confirmed. Continue from the missing fields; do not re-ask what is already known.',
      },
    };
  })
);

// POST /tools/log_consent — { consent_type, granted, channel, caller_phone, transcript_snippet, lead_id? }
router.post(
  '/log_consent',
  toolHandler('log_consent', (args) => {
    const record = logConsent(args);
    // Backward-compat: also keep a row in the legacy "consents" collection.
    save('consents', { consent_type: args.consent_type, granted: args.granted === true, channel: args.channel });
    return { payload: { consentId: record.id, consentType: record.consentType, granted: record.granted, leadId: record.leadId } };
  })
);

// POST /tools/record_opt_out — { caller_phone, channel, opt_out_requested, transcript_snippet, timestamp }
router.post(
  '/record_opt_out',
  toolHandler('record_opt_out', (args) => {
    if (args.opt_out_requested === false) {
      return { payload: { optedOut: false, message: 'No opt-out recorded (opt_out_requested was false).' } };
    }
    const { optOut, leadId } = recordOptOut(args);
    return {
      payload: {
        optedOut: true,
        optOutId: optOut.id,
        leadId,
        channel: optOut.channel,
        message: 'Opt-out recorded. Do not contact this caller again on this channel.',
      },
    };
  })
);

// POST /tools/save_intake — { full_structured_record, call_review }
router.post(
  '/save_intake',
  toolHandler('save_intake', (args) => {
    // Accept the spec shape, or fall back to treating the whole body as the record.
    const fullRecord = args.full_structured_record ?? args.record ?? args;
    const callReview = args.call_review ?? args.callReview ?? {};
    const result = saveIntake(fullRecord, callReview);
    return { payload: result, status: 201 };
  })
);

// POST /tools/transfer_to_human — { case_summary, urgency_flag }  (mock)
router.post(
  '/transfer_to_human',
  toolHandler('transfer_to_human', (args) => {
    const record = save('transfers', { case_summary: args.case_summary, urgency_flag: args.urgency_flag });
    return {
      payload: {
        transferStatus: 'mock_transfer_started',
        transferId: record.id,
        urgencyFlag: args.urgency_flag ?? null,
        message: 'Mock warm transfer started. (Configure a real transfer destination in Vapi for production.)',
      },
    };
  })
);

// POST /tools/schedule_callback — { preferred_window, phone, consent_id }  (mock)
router.post(
  '/schedule_callback',
  toolHandler('schedule_callback', (args) => {
    // Safety: never schedule outbound contact for an opted-out caller.
    if (args.phone && isOptedOut(args.phone)) {
      return { payload: { scheduled: false, reason: 'opted_out', message: 'Caller has opted out — no callback scheduled.' } };
    }
    const record = save('callbacks', { preferred_window: args.preferred_window, phone: args.phone, consent_id: args.consent_id });
    return {
      payload: {
        scheduled: true,
        callbackId: record.id,
        preferredWindow: args.preferred_window ?? null,
        message: 'Mock callback scheduled. (Wire to a real scheduler/queue for production.)',
      },
    };
  })
);

export default router;
