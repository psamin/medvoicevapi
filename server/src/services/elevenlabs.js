// ⚠️ LEGACY / OPTIONAL — direct ElevenLabs API client for the pre-Vapi web flow.
// The current Vapi build does NOT use this (Vapi handles voice itself). Kept for
// reference and only reachable via the legacy GET /api/get-signed-url route.
// Uses Node 18+ built-in fetch — no extra dependency needed.
export async function getSignedUrl(apiKey, agentId) {
  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;

  const res = await fetch(url, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.signed_url;
}
