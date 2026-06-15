// Shared opt-out service. The CRM opt-out store (crmService + mockDb `optOuts`)
// remains the canonical do-not-call ledger, but opt-out is now ALSO first-class on
// the client record (optedOut / doNotCall / optOutReason / optOutAt / optOutChannel)
// so it is visible directly on the contact and survives store resets. Used by the
// outbound pre-dial check, the Vapi opt-out tool, and the dev endpoints.
import { normalizePhone, filter } from '../db/mockDb.js';
import { isOptedOut as crmIsOptedOut, recordOptOut as crmRecordOptOut } from '../crm/crmService.js';
import repo from './repo.js';
import { CASE_STATUS } from './models.js';
import { recordAudit } from '../crm/audit.js';
import { logCommunication } from '../crm/communications.js';

export function normalizePhoneNumber(phoneNumber) {
  return normalizePhone(phoneNumber);
}

// Opted out if the ledger says so OR the matching client is flagged (defense in depth).
export async function isOptedOut(phoneNumber) {
  if (crmIsOptedOut(phoneNumber)) return true;
  const client = await repo.clients.findByPhone(phoneNumber);
  return !!(client && (client.optedOut || client.doNotCall));
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

  // Mirror onto the client record (first-class), and stop any automated outreach.
  const reason = metadata.reason ?? metadata.transcriptSnippet ?? null;
  const at = metadata.timestamp || new Date().toISOString();
  const channel = metadata.channel || 'call_or_sms';
  const client = (metadata.clientId && (await repo.clients.findById(metadata.clientId))) || (await repo.clients.findByPhone(phoneNumber));
  if (client) {
    await repo.clients.save({
      ...client, optedOut: true, doNotCall: true,
      optOutReason: reason, optOutAt: at, optOutChannel: channel, updatedAt: new Date().toISOString(),
    });
    await recordAudit({
      actorType: metadata.source === 'vapi_call' ? 'ai' : 'user', action: 'opt_out_recorded',
      entityType: 'client', entityId: client.id, clientId: client.id, caseId: metadata.caseId ?? null,
      newValue: { optedOut: true, doNotCall: true, channel, reason },
    });
    await logCommunication({
      caseId: metadata.caseId ?? null, clientId: client.id, channel: 'system', direction: 'inbound',
      type: 'opt_out', status: 'completed', subject: 'Client opted out', bodySummary: reason,
    });
  }

  // If tied to a case, move it out of the automated pipeline.
  if (metadata.caseId) {
    const theCase = await repo.cases.findById(metadata.caseId);
    if (theCase) {
      await repo.cases.save({ ...theCase, status: CASE_STATUS.OPTED_OUT, updatedAt: new Date().toISOString() });
      await recordAudit({
        actorType: metadata.source === 'vapi_call' ? 'ai' : 'user', action: 'case_status_changed',
        entityType: 'case', entityId: theCase.id, caseId: theCase.id, clientId: theCase.clientId,
        oldValue: { status: theCase.status }, newValue: { status: CASE_STATUS.OPTED_OUT },
      });
    }
  }
  return optOut;
}

// Dev/debug: list all opt-out records.
export async function listOptOuts() {
  return filter('optOuts', () => true);
}
