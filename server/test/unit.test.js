// Unit tests for the two pure modules: the intake state machine and the
// post-call analysis engine. No server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNextState } from '../src/intake/stateMachine.js';
import { analyzeCall } from '../src/intake/postCallAnalysis.js';

const PRE = { greeted: true, consentGiven: true, optOutOffered: true, phoneLookedUp: true };

test('state machine: walks gates then required fields in order', () => {
  assert.equal(decideNextState({}).state, 'greeting');
  assert.equal(decideNextState({ greeted: true }).state, 'disclosure_and_consent');
  assert.equal(decideNextState({ ...PRE, lead: { id: 'l1' } }).nextField, 'firstName');
});

test('state machine: cannot skip a required field', () => {
  // Everything filled EXCEPT email — machine must point back at contact/email.
  const lead = { id: 'l1', firstName: 'A', lastName: 'B', phone: '5551', state: 'NY', city: 'NYC',
    accidentDate: '2025-01-01', accidentType: 'car', injured: true, medicalTreatmentReceived: true, hasAttorney: false, caseSummary: 'x' };
  const d = decideNextState({ ...PRE, isReturning: true, identityConfirmed: true, lead });
  assert.equal(d.state, 'intake_contact');
  assert.equal(d.nextField, 'email');
});

test('state machine: opt-out and escalation override everything', () => {
  assert.equal(decideNextState({ ...PRE, optedOut: true, lead: { id: 'l1' } }).reason, 'opted_out');
  assert.equal(decideNextState({ ...PRE, escalate: true, lead: { id: 'l1' } }).state, 'human_escalation');
});

test('analysis: completeness and quality', () => {
  const full = { firstName: 'A', lastName: 'B', phone: '5551', email: 'e@x.com', state: 'NY', city: 'NYC',
    accidentDate: '2025-01-01', accidentType: 'car', injured: true, medicalTreatmentReceived: true, hasAttorney: false, caseSummary: 'x' };
  const a = analyzeCall({ lead: full, transcript: 'thanks, very helpful' });
  assert.equal(a.intakeCompleteness, 100);
  assert.equal(a.leadQuality, 'high');
  assert.equal(a.callerSentiment, 'positive');
  assert.equal(a.recommendedNextAction, 'ready_for_human_review');
});

test('analysis: false is a valid (answered) value, not missing', () => {
  const a = analyzeCall({ lead: { injured: false } });
  assert.ok(!a.missingFields.includes('injured'), 'injured=false counts as answered');
});
