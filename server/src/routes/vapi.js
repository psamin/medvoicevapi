import { Router } from 'express';

const router = Router();

// GET /api/vapi/web-config — browser-safe config for the Web SDK.
// Only returns PUBLIC values (public key + assistant id). Never the API key.
router.get('/web-config', (_req, res) => {
  const publicKey = process.env.VAPI_PUBLIC_KEY || null;
  const assistantId = process.env.VAPI_ASSISTANT_ID || null;
  res.json({
    ok: true,
    publicKey,
    assistantId,
    configured: !!(publicKey && assistantId),
  });
});

export default router;
