// Verify incoming Vapi tool/webhook requests against a shared secret.
//
// Set VAPI_WEBHOOK_SECRET in .env AND the same value as the Server URL secret in
// the Vapi dashboard. Vapi then sends it as the `x-vapi-secret` header. If the
// env var is unset we skip verification (convenient for local dev) but warn once.
let warned = false;

export function verifyVapiSecret(req, res, next) {
  const secret = process.env.VAPI_WEBHOOK_SECRET || process.env.VAPI_SERVER_URL_SECRET;
  if (!secret) {
    if (!warned) {
      console.warn('[vapi-auth] VAPI_WEBHOOK_SECRET not set — skipping webhook verification (dev only).');
      warned = true;
    }
    return next();
  }
  const provided = req.get('x-vapi-secret') || req.get('x-vapi-signature');
  if (provided && provided === secret) return next();
  console.warn(`[vapi-auth] rejected ${req.method} ${req.originalUrl} — missing/invalid x-vapi-secret`);
  return res.status(401).json({ ok: false, error: 'invalid or missing webhook secret' });
}

export default verifyVapiSecret;
