// ⚠️ LEGACY / OPTIONAL — pre-Vapi ElevenLabs Conversational AI web flow.
// Not used by the Vapi path (Vapi manages voice/transcription/model itself).
// Kept for reference; safe to ignore. Returns a clear error if EL keys are unset,
// so the app runs fine WITHOUT ElevenLabs configured.
import { Router } from 'express';
import { getSignedUrl } from '../services/elevenlabs.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } = process.env;

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    return res.status(503).json({
      ok: false,
      error:
        'Legacy ElevenLabs flow is not configured (ELEVENLABS_API_KEY/ELEVENLABS_AGENT_ID unset). ' +
        'This is optional — the Vapi flow does not need it.',
    });
  }

  const signedUrl = await getSignedUrl(ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID);
  res.json({ signedUrl });
});

export default router;
