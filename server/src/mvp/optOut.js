// Shared opt-out service. Thin async wrapper over the existing CRM opt-out store
// (crmService + mockDb `optOuts`), which stays the SINGLE source of truth — no
// duplicate opt-out state. Used by the outbound pre-dial check, the Vapi opt-out
// tool, and the dev endpoints.
import { normalizePhone, filter } from '../db/mockDb.js';
import { isOptedOut as crmIsOptedOut, recordOptOut as crmRecordOptOut } from '../crm/crmService.js';

export function normalizePhoneNumber(phoneNumber) {
  return normalizePhone(phoneNumber);
}

export async function isOptedOut(phoneNumber) {
  return crmIsOptedOut(phoneNumber);
}

// metadata: { source, caseId, clientId, callId, reason|transcriptSnippet, channel, timestamp }
export async function markOptOut(phoneNumber, metadata = {}) {
  const { optOut } = crmRecordOptOut({
    caller_phone: phoneNumber,
    channel: metadata.channel || 'call_or_sms',
    transcript_snippet: metadata.reason ?? metadata.transcriptSnippet ?? null,
    timestamp: metadata.timestamp,
    source: metadata.source || 'manual',
    caseId: metadata.caseId ?? null,
    clientId: metadata.clientId ?? null,
    callId: metadata.callId ?? null,
  });
  return optOut;
}

// Dev/debug: list all opt-out records.
export async function listOptOuts() {
  return filter('optOuts', () => true);
}
