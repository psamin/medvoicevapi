import { Router } from 'express';
import { logToolCall, save } from '../db/mockDb.js';

const router = Router();

router.post('/log_consent', (req, res) => {
  const body = req.body;
  console.log('[tool] log_consent', body);
  logToolCall('log_consent', body);
  save('consents', body);
  res.json({
    ok: true,
    consent_id: `consent_${Date.now()}`,
    message: 'Consent logged',
  });
});

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

router.post('/transfer_to_human', (req, res) => {
  const { case_summary, urgency_flag } = req.body;
  console.log('[tool] transfer_to_human', req.body);
  logToolCall('transfer_to_human', req.body);
  save('transfers', { case_summary, urgency_flag });
  res.json({
    ok: true,
    transfer_status: 'mock_transfer_started',
    message: 'Mock transfer created',
  });
});

router.post('/schedule_callback', (req, res) => {
  const { preferred_window, phone, consent_id } = req.body;
  console.log('[tool] schedule_callback', req.body);
  logToolCall('schedule_callback', req.body);
  save('callbacks', { preferred_window, phone, consent_id });
  res.json({
    ok: true,
    callback_id: `callback_${Date.now()}`,
    message: 'Callback scheduled in mock system',
  });
});

router.post('/save_intake', (req, res) => {
  const body = req.body;
  console.log('[tool] save_intake', JSON.stringify(body, null, 2));
  logToolCall('save_intake', body);
  save('intakes', body);
  res.json({
    ok: true,
    intake_id: `intake_${Date.now()}`,
    message: 'Intake saved',
  });
});

export default router;
