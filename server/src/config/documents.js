// Document requirements for an intake. The voice call only records WHETHER a
// document exists; the client uploads it on the form. "Required" docs must be
// uploaded (or waived) for the intake to be `complete`.
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
