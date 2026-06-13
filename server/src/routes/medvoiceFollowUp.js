// Follow-up workflow trigger. In production this would be a cron/queue; here it's a
// manual/scheduled endpoint. Optional { now } (ISO) lets tests simulate time.
import { Router } from 'express';
import { runFollowUps } from '../mvp/followUp.js';

const router = Router();

// POST /api/follow-up/run  { now? }
router.post('/run', async (req, res) => {
  const nowIso = req.body?.now || new Date().toISOString();
  const results = await runFollowUps(nowIso);
  res.json({ ok: true, ranAt: nowIso, results });
});

export default router;
