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
