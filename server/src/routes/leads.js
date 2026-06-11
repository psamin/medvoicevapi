import { Router } from 'express';
import {
  listLeads,
  getLead,
  findLeadByPhone,
  createLead,
  updateLead,
} from '../db/mockDb.js';

const router = Router();

// GET /api/leads/lookup?phone=...  (defined before /:id so "lookup" isn't an id)
router.get('/lookup', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ ok: false, error: 'phone query param required' });
  const lead = findLeadByPhone(phone);
  res.json({ ok: true, found: !!lead, lead });
});

// GET /api/leads
router.get('/', (_req, res) => {
  res.json({ ok: true, leads: listLeads() });
});

// GET /api/leads/:id
router.get('/:id', (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
  res.json({ ok: true, lead });
});

// POST /api/leads
router.post('/', (req, res) => {
  const lead = createLead(req.body || {});
  res.status(201).json({ ok: true, lead });
});

// PATCH /api/leads/:id
router.patch('/:id', (req, res) => {
  const lead = updateLead(req.params.id, req.body || {});
  if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
  res.json({ ok: true, lead });
});

// POST /api/leads/:id/opt-out
router.post('/:id/opt-out', (req, res) => {
  const lead = updateLead(req.params.id, { optedOut: true, leadStatus: 'opted_out' });
  if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
  res.json({ ok: true, lead });
});

export default router;
