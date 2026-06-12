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

export const CASE_STATUS = {
  NEW: 'new',
  INTAKE_IN_PROGRESS: 'intake_in_progress',
  INTAKE_FORM_SENT: 'intake_form_sent',
  WAITING_ON_CLIENT: 'waiting_on_client',
  COMPLETED: 'completed',
  HUMAN_FOLLOW_UP_NEEDED: 'human_follow_up_needed',
  CLOSED: 'closed',
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
    primaryLanguage: input.primaryLanguage ?? null,
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
    confidence: input.confidence ?? null,
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
