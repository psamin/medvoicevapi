// MedVoice MVP entity factories. Plain JS records stored in the JSON dev DB.
import { randomBytes } from 'crypto';

let seq = 0;
export function genId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}
export function genToken() {
  // URL-safe, unguessable token that identifies a case's intake form session.
  return randomBytes(24).toString('base64url');
}

const nowIso = () => new Date().toISOString();

// Case lifecycle for the PI intake CRM. Earlier statuses (new/in_progress/
// form_sent/missing_info/case_manager_review) are retained; the CRM adds the
// downstream legal-workflow stages. Mapping of older names:
//   complete            → ready_for_case_manager (client side done, in CM queue)
//   follow_up_exhausted → manual_review           (automation gave up; human owns it)
// COMPLETE / FOLLOW_UP_EXHAUSTED constants are kept so older data still resolves.
export const CASE_STATUS = {
  NEW: 'new',
  IN_PROGRESS: 'in_progress',
  FORM_SENT: 'form_sent',
  MISSING_INFO: 'missing_info',
  DOCUMENTS_PENDING: 'documents_pending',
  READY_FOR_CASE_MANAGER: 'ready_for_case_manager',
  CASE_MANAGER_REVIEW: 'case_manager_review',
  ATTORNEY_REVIEW: 'attorney_review',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CLOSED: 'closed',
  OPTED_OUT: 'opted_out',
  MANUAL_REVIEW: 'manual_review',
  // ── retained legacy aliases ──
  COMPLETE: 'complete',
  FOLLOW_UP_EXHAUSTED: 'follow_up_exhausted',
};

// Statuses a case can no longer be "reopened" from by a returning caller — a new
// call starts a fresh case instead of mutating one already handed off / closed.
export const TERMINAL_CASE_STATUSES = [
  CASE_STATUS.READY_FOR_CASE_MANAGER, CASE_STATUS.CASE_MANAGER_REVIEW, CASE_STATUS.ATTORNEY_REVIEW,
  CASE_STATUS.ACCEPTED, CASE_STATUS.REJECTED, CASE_STATUS.CLOSED, CASE_STATUS.OPTED_OUT,
  CASE_STATUS.MANUAL_REVIEW, CASE_STATUS.COMPLETE, CASE_STATUS.FOLLOW_UP_EXHAUSTED,
];

export const TASK_TYPE = {
  REVIEW_INTAKE: 'review_intake',
  REVIEW_DOCUMENT: 'review_document',
  CALL_CLIENT: 'call_client',
  DUPLICATE_REVIEW: 'duplicate_review',
  ATTORNEY_REVIEW: 'attorney_review',
  MANUAL_FOLLOWUP: 'manual_followup',
  MISSING_INFO_REVIEW: 'missing_info_review',
};

export const TASK_STATUS = { OPEN: 'open', IN_PROGRESS: 'in_progress', DONE: 'done', CANCELLED: 'cancelled' };

// Follow-up workflow guardrails.
export const FOLLOW_UP = {
  MAX_ATTEMPTS: 3,
  INTERVAL_HOURS: 24,
  WINDOW_DAYS: 3,
};

export function newClient(input = {}) {
  const ts = nowIso();
  return {
    id: input.id || genId('client'),
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    preferredContact: input.preferredContact ?? null,
    preferredContactTime: input.preferredContactTime ?? null,
    primaryLanguage: input.primaryLanguage ?? null,
    // ── opt-out / do-not-call (first-class on the contact, never buried in notes) ──
    optedOut: input.optedOut ?? false,
    doNotCall: input.doNotCall ?? false,
    optOutReason: input.optOutReason ?? null,
    optOutAt: input.optOutAt ?? null,
    optOutChannel: input.optOutChannel ?? null,
    createdAt: input.createdAt || ts,
    updatedAt: ts,
  };
}

export function newCase(input = {}) {
  const ts = nowIso();
  return {
    id: input.id || genId('case'),
    clientId: input.clientId ?? null,
    status: input.status ?? CASE_STATUS.NEW,
    formToken: input.formToken ?? null,
    accidentType: input.accidentType ?? null,
    accidentDate: input.accidentDate ?? null,
    accidentState: input.accidentState ?? null,
    accidentCity: input.accidentCity ?? null,
    accidentSpecificLocation: input.accidentSpecificLocation ?? null,
    accidentDescription: input.accidentDescription ?? null,
    injurySummary: input.injurySummary ?? null,
    treatmentStatus: input.treatmentStatus ?? null,
    humanFollowUpNeeded: input.humanFollowUpNeeded ?? false,
    possibleDuplicate: input.possibleDuplicate ?? false,
    duplicateOfClientId: input.duplicateOfClientId ?? null,
    // Set when a case completes but the client marked one or more REQUIRED
    // documents as `not_available` — a case manager still needs to obtain them.
    documentsPendingReview: input.documentsPendingReview ?? false,
    // ── CRM: source / triage / ownership / handoff ──
    source: input.source ?? 'voice_intake', // voice_intake | web | referral | manual
    priority: input.priority ?? 'normal', // low | normal | high
    assignedCaseManagerId: input.assignedCaseManagerId ?? null,
    assignedAttorneyId: input.assignedAttorneyId ?? null,
    caseManagerHandoffRequired: input.caseManagerHandoffRequired ?? false,
    caseManagerHandoffReason: input.caseManagerHandoffReason ?? null,
    caseManagerHandoffAt: input.caseManagerHandoffAt ?? null,
    // --- follow-up workflow tracking ---
    formSentAt: input.formSentAt ?? null,
    completedAt: input.completedAt ?? null,
    followUpStartedAt: input.followUpStartedAt ?? null,
    followUpExhaustedAt: input.followUpExhaustedAt ?? null,
    followUpAttemptCount: input.followUpAttemptCount ?? 0,
    lastFollowUpAt: input.lastFollowUpAt ?? null,
    createdAt: input.createdAt || ts,
    updatedAt: ts,
  };
}

export function newIntakeField(input = {}) {
  return {
    id: input.id || genId('fld'),
    caseId: input.caseId ?? null,
    fieldKey: input.fieldKey,
    fieldLabel: input.fieldLabel ?? input.fieldKey,
    value: input.value ?? null,
    source: input.source ?? 'call', // call | form | staff | outbound_call
    status: input.status ?? 'missing', // missing | partial | complete
    required: input.required ?? false,
    allowNA: input.allowNA ?? false,
    category: input.category ?? null, // core | incident | medical | insurance_police | liability
    confidence: input.confidence ?? null,
    // AI-extracted data is NOT human-verified until a case manager/attorney confirms it.
    verifiedByHuman: input.verifiedByHuman ?? false,
    verifiedByUserId: input.verifiedByUserId ?? null,
    verifiedAt: input.verifiedAt ?? null,
    clientFacing: input.clientFacing ?? true,
    staffOnly: input.staffOnly ?? false,
    updatedAt: nowIso(),
  };
}

export function newIntakeCall(input = {}) {
  const ts = nowIso();
  return {
    id: input.id || genId('vcall'),
    caseId: input.caseId ?? null,
    vapiCallId: input.vapiCallId ?? null,
    direction: input.direction ?? 'inbound', // inbound | outbound
    status: input.status ?? null,
    transcript: input.transcript ?? null,
    summary: input.summary ?? null,
    recordingUrl: input.recordingUrl ?? null,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    createdAt: input.createdAt || ts,
  };
}

export function newRequiredDocument(input = {}) {
  return {
    id: input.id || genId('doc'),
    caseId: input.caseId ?? null,
    docType: input.docType,
    label: input.label ?? input.docType,
    required: input.required ?? false,
    // missing | requested | uploaded | not_available | received_from_provider |
    // needs_review | approved | rejected_bad_file  (see config/documents.js)
    status: input.status ?? 'pending',
    fileUrl: input.fileUrl ?? input.uploadedFileUrl ?? null,
    uploadedFileUrl: input.uploadedFileUrl ?? null, // legacy alias, kept in sync
    fileName: input.fileName ?? null,
    unavailableReason: input.unavailableReason ?? null,
    requestedAt: input.requestedAt ?? null,
    uploadedAt: input.uploadedAt ?? null,
    receivedAt: input.receivedAt ?? null,
    reviewedAt: input.reviewedAt ?? null,
    reviewedByUserId: input.reviewedByUserId ?? null,
    updatedAt: nowIso(),
  };
}

export function newEmailLog(input = {}) {
  return {
    id: input.id || genId('email'),
    caseId: input.caseId ?? null,
    toEmail: input.toEmail ?? null,
    subject: input.subject ?? null,
    body: input.body ?? null,
    status: input.status ?? 'dry_run', // dry_run | sent | failed
    reason: input.reason ?? null,
    createdAt: nowIso(),
  };
}

/* ── CRM entities: tasks, notes, audit logs, communications, follow-up attempts ── */

// Human work item (case-manager queue).
export function newTask(input = {}) {
  const ts = nowIso();
  return {
    id: input.id || genId('task'),
    caseId: input.caseId ?? null,
    clientId: input.clientId ?? null,
    ownerId: input.ownerId ?? null,
    title: input.title ?? '',
    description: input.description ?? null,
    type: input.type ?? TASK_TYPE.MANUAL_FOLLOWUP,
    status: input.status ?? TASK_STATUS.OPEN,
    priority: input.priority ?? 'normal',
    dueAt: input.dueAt ?? null,
    completedAt: input.completedAt ?? null,
    createdAt: input.createdAt || ts,
    updatedAt: ts,
  };
}

// Internal human note (NOT a communication with the client).
export function newNote(input = {}) {
  const ts = nowIso();
  return {
    id: input.id || genId('note'),
    caseId: input.caseId ?? null,
    authorId: input.authorId ?? null,
    body: input.body ?? '',
    createdAt: input.createdAt || ts,
    updatedAt: ts,
  };
}

// Immutable audit record for traceability of automated + human actions.
export function newAuditLog(input = {}) {
  return {
    id: input.id || genId('audit'),
    actorType: input.actorType ?? 'system', // ai | client | user | system | webhook | scheduler
    actorId: input.actorId ?? null,
    caseId: input.caseId ?? null,
    clientId: input.clientId ?? null,
    action: input.action ?? '',
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    createdAt: nowIso(),
  };
}

// One row per call / email / form / sms / system event (the case comms timeline).
export function newCommunication(input = {}) {
  return {
    id: input.id || genId('comm'),
    caseId: input.caseId ?? null,
    clientId: input.clientId ?? null,
    channel: input.channel ?? 'system', // call | email | form | sms | system
    direction: input.direction ?? 'internal', // inbound | outbound | internal
    type: input.type ?? null, // vapi_call | intake_form_sent | follow_up_email | ...
    status: input.status ?? null, // sent | delivered | failed | completed | skipped
    subject: input.subject ?? null,
    bodySummary: input.bodySummary ?? null,
    externalProvider: input.externalProvider ?? null,
    externalId: input.externalId ?? null,
    skippedReason: input.skippedReason ?? null,
    metadata: input.metadata ?? null,
    createdAt: nowIso(),
  };
}

// One row per automated follow-up tick (sent or skipped, with the reason).
export function newFollowUpAttempt(input = {}) {
  return {
    id: input.id || genId('fua'),
    caseId: input.caseId ?? null,
    clientId: input.clientId ?? null,
    attemptNumber: input.attemptNumber ?? null,
    channel: input.channel ?? null, // call | email
    status: input.status ?? null, // sent | skipped
    skippedReason: input.skippedReason ?? null,
    scheduledFor: input.scheduledFor ?? null,
    sentAt: input.sentAt ?? null,
    createdAt: nowIso(),
  };
}
