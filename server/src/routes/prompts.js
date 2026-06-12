import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { BOT_VERSIONS, INTAKE_PROMPTS } from '../prompts/intakePrompts.js';

const router = Router();

// The canonical, client-provided prompt (verbatim) lives as markdown in
// prompts/henrys-law-firm/. These files are the single source of truth — paste
// the system prompt + first message straight into the Vapi dashboard.
const HLF_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../prompts/henrys-law-firm');
const readHlf = (file) => {
  const path = resolve(HLF_DIR, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

// GET /api/prompts — list available versions.
router.get('/', (_req, res) => {
  res.json({ ok: true, versions: [...BOT_VERSIONS, 'henrys_law_firm'] });
});

// GET /api/prompts/henrys-first-message — the verbatim Vapi first line.
router.get('/henrys-first-message', (_req, res) => {
  const firstMessage = readHlf('first-message.md');
  if (!firstMessage) return res.status(404).json({ ok: false, error: 'first-message.md not found' });
  res.json({ ok: true, version: 'henrys_law_firm', firstMessage: firstMessage.trim() });
});

// GET /api/prompts/:version — full system prompt for one version.
router.get('/:version', (req, res) => {
  if (req.params.version === 'henrys_law_firm') {
    const prompt = readHlf('system-prompt.md');
    const firstMessage = readHlf('first-message.md');
    if (!prompt) return res.status(404).json({ ok: false, error: 'system-prompt.md not found' });
    return res.json({ ok: true, version: 'henrys_law_firm', prompt, firstMessage: firstMessage?.trim() ?? null });
  }
  const prompt = INTAKE_PROMPTS[req.params.version];
  if (!prompt) return res.status(404).json({ ok: false, error: 'unknown version', versions: [...BOT_VERSIONS, 'henrys_law_firm'] });
  res.json({ ok: true, version: req.params.version, prompt });
});

export default router;
