// Legacy ElevenLabs-era tools. The CRM-related tools (log_consent, save_intake,
// transfer_to_human, schedule_callback) have moved to routes/crmTools.js with
// richer behavior and now serve /tools/*. The two screening tools below are
// EL-specific and kept here for the legacy flow.
import { Router } from 'express';
import { logToolCall, save } from '../db/mockDb.js';

const router = Router();

router.post('/screen_eligibility', (req, res) => {
  const { incident_date, state, matter_type } = req.body;
  console.log('[tool] screen_eligibility', req.body);
  logToolCall('screen_eligibility', req.body);

  let sol_status = 'unknown';
  let urgency_flag = 'expired_or_unknown';

  if (incident_date && state) {
    const diffYears =
      (Date.now() - new Date(incident_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (diffYears > 3) {
      sol_status = 'expired';
      urgency_flag = 'expired_or_unknown';
    } else if (diffYears >= 2.5) {
      sol_status = 'near';
      urgency_flag = 'near_sol';
    } else {
      sol_status = 'ok';
      urgency_flag = 'none';
    }
  }

  save('eligibilityChecks', { incident_date, state, matter_type, sol_status, urgency_flag });

  res.json({
    ok: true,
    sol_status,
    urgency_flag,
    internal_note: 'Use for routing only. Do not state legal conclusions to caller.',
  });
});

router.post('/verify_conflict', (req, res) => {
  const { at_fault_name, caller_name } = req.body;
  console.log('[tool] verify_conflict', req.body);
  logToolCall('verify_conflict', req.body);

  let status = 'clear';
  if (!at_fault_name) {
    status = 'pending';
  } else if (at_fault_name.toLowerCase().includes('test conflict')) {
    status = 'conflict';
  }

  save('conflicts', { at_fault_name, caller_name, status });
  res.json({ ok: true, status });
});

export default router;
