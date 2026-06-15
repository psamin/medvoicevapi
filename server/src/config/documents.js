// Document requirements for an intake. The voice call only records WHETHER a
// document exists; the client uploads it on the form. "Required" docs must be
// uploaded, marked `not_available` (client has no access), or waived (staff) for
// the intake to stop counting them as missing.
export const DOC_STATUS = {
  PENDING: 'pending', // not provided yet (counts as missing if required)
  REQUESTED: 'requested', // formally requested from client/provider
  RECEIVED: 'received', // uploaded by the client
  RECEIVED_FROM_PROVIDER: 'received_from_provider', // obtained via a records request
  NOT_AVAILABLE: 'not_available', // client doesn't have access right now
  NEEDS_REVIEW: 'needs_review', // uploaded, awaiting a case-manager review task
  APPROVED: 'approved', // reviewed and accepted
  REJECTED_BAD_FILE: 'rejected_bad_file', // unreadable/wrong file — must re-upload
  WAIVED: 'waived', // staff decision (not surfaced to the client form)
};

// Doc statuses that mean "don't count this document as missing" (it's provided,
// being reviewed, accepted, or the client legitimately can't supply it).
export const DOC_SATISFIED_STATUSES = [
  DOC_STATUS.RECEIVED, DOC_STATUS.RECEIVED_FROM_PROVIDER, DOC_STATUS.NEEDS_REVIEW,
  DOC_STATUS.APPROVED, DOC_STATUS.NOT_AVAILABLE, DOC_STATUS.WAIVED,
];

// Statuses representing a successfully uploaded file that needs a human review task.
export const DOC_UPLOADED_STATUSES = [DOC_STATUS.RECEIVED, DOC_STATUS.RECEIVED_FROM_PROVIDER, DOC_STATUS.NEEDS_REVIEW];

export const REQUIRED_DOCUMENTS = [
  { type: 'government_id', label: 'Government ID', required: true },
  { type: 'insurance_information', label: 'Insurance information', required: true },
  { type: 'police_report', label: 'Police report (if available)', required: false },
  { type: 'medical_records', label: 'Medical records (if available)', required: false },
  { type: 'accident_photos', label: 'Accident / injury photos (if relevant)', required: false },
];

export const REQUIRED_DOC_TYPES = REQUIRED_DOCUMENTS.filter((d) => d.required).map((d) => d.type);

export function getDocConfig(type) {
  return REQUIRED_DOCUMENTS.find((d) => d.type === type) || null;
}
