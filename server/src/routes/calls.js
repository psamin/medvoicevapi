import { Router } from 'express';
import { listCalls, createCall } from '../db/mockDb.js';

const router = Router();

// GET /api/calls
router.get('/', (_req, res) => {
  res.json({ ok: true, calls: listCalls() });
});

// POST /api/calls
router.post('/', (req, res) => {
  const call = createCall(req.body || {});
  res.status(201).json({ ok: true, call });
});

export default router;
