import { Router } from 'express';
import { getAll, reset } from '../db/mockDb.js';

const router = Router();

router.get('/db', (_req, res) => {
  res.json(getAll());
});

router.post('/reset', (_req, res) => {
  reset();
  res.json({ ok: true, message: 'Mock database cleared' });
});

export default router;
