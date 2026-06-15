// Unified communications timeline — one row per call / email / form / sms / system
// event on a case. Every AI call, every email, and every SKIPPED outbound (with its
// reason) lands here, so the case detail page shows the full contact history.
import repo from '../mvp/repo.js';
import { newCommunication } from '../mvp/models.js';

export async function logCommunication(entry = {}) {
  return repo.communications.insert(newCommunication(entry));
}

export async function listCommunications(caseId) {
  return repo.communications.listByCase(caseId);
}
