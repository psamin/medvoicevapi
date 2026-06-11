import { Router } from 'express';
import { decideNextState, STATES } from '../intake/stateMachine.js';
import { getLead, findLeadByPhone } from '../db/mockDb.js';

const router = Router();

// POST /api/intake/next — decide the next intake state/question.
// Body: { id?|phone?, lead?, ...flags } where flags are greeted, consentGiven,
// optOutOffered, optedOut, phoneLookedUp, isReturning, identityConfirmed,
// escalate, skipOptional, reviewDone, summaryConfirmed, analysisSaved.
router.post('/next', (req, res) => {
  const body = req.body || {};
  // Resolve the lead from the DB when an id/phone is given; otherwise use the
  // inline lead object (handy for tests and stateless callers).
  let lead = body.lead || {};
  if (body.id) lead = getLead(body.id) || lead;
  else if (body.phone && !body.lead) lead = findLeadByPhone(body.phone) || { phone: body.phone };

  const decision = decideNextState({ ...body, lead, isReturning: body.isReturning ?? !!lead?.id });
  res.json({ ok: true, ...decision });
});

// GET /api/intake/states — list all states (for docs/UI).
router.get('/states', (_req, res) => res.json({ ok: true, states: STATES }));

export default router;
