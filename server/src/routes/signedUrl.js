import { Router } from 'express';
import { getSignedUrl } from '../services/elevenlabs.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } = process.env;

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    return res.status(500).json({
      ok: false,
      error: 'ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID must be set in .env',
    });
  }

  const signedUrl = await getSignedUrl(ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID);
  res.json({ signedUrl });
});

export default router;
