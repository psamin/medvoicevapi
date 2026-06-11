import { Router } from 'express';
import { BOT_VERSIONS, INTAKE_PROMPTS, buildAssistantPrompt } from '../prompts/intakePrompts.js';

const router = Router();

// GET /api/prompts — list bot versions.
router.get('/', (_req, res) => {
  res.json({ ok: true, versions: BOT_VERSIONS });
});

// GET /api/prompts/:version — full system prompt for one version.
router.get('/:version', (req, res) => {
  const prompt = INTAKE_PROMPTS[req.params.version];
  if (!prompt) return res.status(404).json({ ok: false, error: 'unknown version', versions: BOT_VERSIONS });
  res.json({ ok: true, version: req.params.version, prompt });
});

export default router;
