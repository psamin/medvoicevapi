// Post-call scoring & analysis. Pure function — no I/O — so it's easy to test and
// can run locally without any LLM. Sentiment/confusion/anger are simple keyword
// heuristics over the transcript; everything else derives from the lead record.
import { REQUIRED_LEAD_FIELDS, computeMissingFields } from '../models.js';

const NEGATIVE_WORDS = ['angry', 'upset', 'furious', 'terrible', 'awful', 'hate', 'ridiculous', 'frustrat', 'annoyed', 'unacceptable', 'worst', 'stupid', 'useless'];
const POSITIVE_WORDS = ['thank', 'thanks', 'great', 'wonderful', 'appreciate', 'helpful', 'perfect', 'awesome', 'good', 'happy'];
const CONFUSION_WORDS = ["don't understand", 'dont understand', 'confused', 'what do you mean', 'makes no sense', "i'm lost", 'im lost', 'repeat that', 'say that again', 'huh'];
const ESCALATION_WORDS = ['speak to a human', 'talk to a person', 'real person', 'lawyer now', 'how much is my case', 'settlement', 'what is my case worth', "what's my case worth", 'sue', 'legal advice'];

// Accept a transcript as a string or an array of {role,text}/{role,transcript}.
function transcriptToText(transcript) {
  if (!transcript) return '';
  if (typeof transcript === 'string') return transcript.toLowerCase();
  if (Array.isArray(transcript)) {
    return transcript.map((t) => t.text ?? t.transcript ?? t.message ?? '').join(' ').toLowerCase();
  }
  return String(transcript).toLowerCase();
}

function countHits(text, words) {
  return words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
}

export function analyzeCall(input = {}) {
  const { lead = {}, transcript = '', botVersion = null, optedOut = false, escalated = false, duplicate = false } = input;
  const text = transcriptToText(transcript);

  const missingFields = computeMissingFields(lead, REQUIRED_LEAD_FIELDS);
  const filled = REQUIRED_LEAD_FIELDS.length - missingFields.length;
  const intakeCompleteness = Math.round((filled / REQUIRED_LEAD_FIELDS.length) * 100);

  const negHits = countHits(text, NEGATIVE_WORDS);
  const posHits = countHits(text, POSITIVE_WORDS);
  const confusionDetected = countHits(text, CONFUSION_WORDS) > 0;
  const escalationLanguage = countHits(text, ESCALATION_WORDS) > 0;
  const unhappyDetected = negHits > 0;

  let callerSentiment = 'neutral';
  if (negHits > posHits && negHits > 0) callerSentiment = 'negative';
  else if (posHits > negHits && posHits > 0) callerSentiment = 'positive';

  // Lead quality: completeness plus signal adjustments.
  let leadQuality = 'medium';
  if (lead.hasAttorney === true || intakeCompleteness < 50) leadQuality = 'low';
  else if (intakeCompleteness >= 80 && lead.injured === true && lead.hasAttorney === false) leadQuality = 'high';

  const needsEscalation = escalated || escalationLanguage || (unhappyDetected && negHits >= 2);

  // Recommended next action — precedence matters.
  let recommendedNextAction;
  if (optedOut || lead.optedOut === true) recommendedNextAction = 'opted_out';
  else if (needsEscalation) recommendedNextAction = 'human_escalation_needed';
  else if (duplicate) recommendedNextAction = 'duplicate_lead';
  else if (missingFields.length > 0) recommendedNextAction = 'missing_required_info';
  else if (intakeCompleteness === 100) recommendedNextAction = 'ready_for_human_review';
  else recommendedNextAction = 'needs_follow_up';

  // Failure reason — only when the call did not produce a usable, complete lead.
  let failureReason = null;
  if (recommendedNextAction === 'opted_out') failureReason = 'caller_opted_out';
  else if (recommendedNextAction === 'human_escalation_needed') failureReason = 'escalated_to_human';
  else if (missingFields.length > 0) failureReason = `incomplete_intake: missing ${missingFields.join(', ')}`;

  return {
    intakeCompleteness,
    leadQuality,
    callerSentiment,
    confusionDetected,
    unhappyDetected,
    missingFields,
    failureReason,
    botVersion,
    recommendedNextAction,
  };
}

export default analyzeCall;
