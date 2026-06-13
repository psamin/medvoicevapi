import { Router } from 'express';
import { getAll, reset } from '../db/mockDb.js';
import { resetStore } from '../mvp/repo.js';

const router = Router();

router.get('/db', (_req, res) => {
  res.json(getAll());
});

router.post('/reset', async (_req, res) => {
  reset(); // legacy JSON collections (leads, opt-outs, etc.)
  await resetStore(); // MVP store for the active backend (SQLite/Postgres/JSON)
  res.json({ ok: true, message: 'Databases cleared' });
});

export default router;
