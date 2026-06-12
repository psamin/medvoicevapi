// Vapi web-call test harness. Mirrors the ElevenLabs harness on "/" but drives a
// Vapi assistant via the Web SDK. Marked client-only (mic, browser SDK, state).
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Vapi from '@vapi-ai/web';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function VapiTest() {
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | connecting | connected
  const [speaking, setSpeaking] = useState(false);
  const [health, setHealth] = useState(null);
  const [leads, setLeads] = useState([]);
  const [calls, setCalls] = useState([]);
  const vapiRef = useRef(null);

  const addLog = useCallback((type, text) => {
    setLog((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), ts: new Date().toISOString().slice(11, 19), type, text },
    ]);
  }, []);

  const refreshData = useCallback(async () => {
    try {
      const [h, l, c] = await Promise.all([
        fetch(`${API_BASE}/health`).then((r) => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/leads`).then((r) => r.json()).catch(() => ({ leads: [] })),
        fetch(`${API_BASE}/api/calls`).then((r) => r.json()).catch(() => ({ calls: [] })),
      ]);
      setHealth(h);
      setLeads(l.leads || []);
      setCalls(c.calls || []);
    } catch (err) {
      addLog('error', `Data refresh failed: ${err.message}`);
    }
  }, [addLog]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  async function handleStart() {
    try {
      setStatus('connecting');
      addLog('event', 'Starting Vapi web call (using the deployed assistant)...');

      // Browser-safe config from the server (public key + assistant id), with
      // NEXT_PUBLIC_* overrides if you prefer to set them on the frontend.
      const cfg = await fetch(`${API_BASE}/api/vapi/web-config`).then((r) => r.json());
      const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || cfg.publicKey;
      const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID || cfg.assistantId;

      if (!publicKey || !assistantId) {
        throw new Error(
          'Vapi not configured. Set VAPI_PUBLIC_KEY + VAPI_ASSISTANT_ID in server/.env ' +
            '(or NEXT_PUBLIC_VAPI_* in frontend/.env.local). See README → Vapi setup.'
        );
      }

      if (!vapiRef.current) {
        const vapi = new Vapi(publicKey);
        vapi.on('call-start', () => { setStatus('connected'); addLog('event', 'Call started.'); });
        vapi.on('call-end', () => { setStatus('idle'); setSpeaking(false); addLog('event', 'Call ended.'); setTimeout(refreshData, 1200); });
        vapi.on('speech-start', () => setSpeaking(true));
        vapi.on('speech-end', () => setSpeaking(false));
        vapi.on('message', (m) => {
          if (m.type === 'transcript' && m.transcriptType === 'final') addLog('message', `[${m.role}] ${m.transcript}`);
          else if (m.type === 'tool-calls' || m.type === 'function-call') addLog('tool', JSON.stringify(m).slice(0, 200));
        });
        vapi.on('error', (e) => addLog('error', e?.message || JSON.stringify(e)));
        vapiRef.current = vapi;
      }

      // Use the assistant exactly as deployed in Vapi (single source of truth) —
      // no prompt override, so the browser test matches real phone calls.
      await vapiRef.current.start(assistantId);
    } catch (err) {
      setStatus('idle');
      addLog('error', err.message);
    }
  }

  function handleStop() {
    vapiRef.current?.stop();
  }

  async function handleReset() {
    await fetch(`${API_BASE}/api/debug/reset`, { method: 'POST' }).catch(() => {});
    addLog('event', 'Mock DB reset.');
    refreshData();
  }

  const isBusy = status === 'connected' || status === 'connecting';

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Vapi PI Intake — Test Harness</h1>
        <p style={s.sub}>
          <a href="/" style={{ color: '#2c3e50' }}>← ElevenLabs harness</a>
        </p>

        <div style={s.row}>
          <span style={{ ...s.badge, background: status === 'connected' ? '#27ae60' : status === 'connecting' ? '#e67e22' : '#95a5a6' }}>
            {status.toUpperCase()}
          </span>
          {speaking && <span style={{ ...s.badge, background: '#8e44ad' }}>AGENT SPEAKING</span>}
          <span style={{ ...s.badge, background: health?.ok ? '#27ae60' : '#c0392b' }}>
            BACKEND {health?.ok ? 'UP' : 'DOWN'}
          </span>
        </div>

        <div style={s.controls}>
          <button onClick={handleStart} disabled={isBusy} style={s.btn}>Start Vapi Web Call</button>
          <button onClick={handleStop} disabled={status !== 'connected'} style={{ ...s.btn, background: '#c0392b' }}>Stop</button>
          <button onClick={refreshData} style={{ ...s.btn, background: '#27ae60' }}>Refresh Data</button>
          <button onClick={handleReset} style={{ ...s.btn, background: '#7f8c8d' }}>Reset Mock DB</button>
        </div>

        <Section title="Event Log">
          <div style={s.logBox}>
            {log.length === 0 && <span style={{ color: '#666' }}>No events yet.</span>}
            {log.map((e) => (
              <div key={e.id} style={{ color: logColor(e.type), marginBottom: 3 }}>
                <span style={{ opacity: 0.55 }}>{e.ts} </span>
                <strong>[{e.type}]</strong> {e.text}
              </div>
            ))}
          </div>
        </Section>

        <div style={s.grid2}>
          <Section title={`Recent Leads (${leads.length})`}>
            {leads.length === 0 ? <p style={s.muted}>None yet.</p> : (
              <ul style={s.list}>
                {leads.slice(-8).reverse().map((l) => (
                  <li key={l.id}>
                    <strong>{l.firstName || '—'} {l.lastName || ''}</strong> · {l.phone || '—'} ·{' '}
                    <em>{l.leadStatus}</em> · missing {l.missingFields?.length ?? '?'}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={`Recent Calls (${calls.length})`}>
            {calls.length === 0 ? <p style={s.muted}>None yet.</p> : (
              <ul style={s.list}>
                {calls.slice(-8).reverse().map((c) => (
                  <li key={c.id}>
                    <strong>{c.botVersion || '—'}</strong> · {c.outcome || '—'} ·{' '}
                    {c.recommendedNextAction || '—'} {c.callScore != null ? `· score ${c.callScore}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={s.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function logColor(type) {
  if (type === 'error') return '#e74c3c';
  if (type === 'message') return '#74b9ff';
  if (type === 'tool') return '#ffd166';
  return '#55efc4';
}

const s = {
  page: { minHeight: '100vh', padding: '32px 16px' },
  card: { maxWidth: 920, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 4, color: '#1a1a2e' },
  sub: { marginTop: 0, marginBottom: 18, fontSize: 13 },
  row: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  badge: { color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' },
  controls: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28, alignItems: 'center' },
  label: { fontSize: 14, fontWeight: 600, color: '#2c3e50' },
  select: { padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14 },
  btn: { padding: '10px 20px', background: '#2c3e50', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 10, color: '#2c3e50', textTransform: 'uppercase', letterSpacing: '0.04em' },
  muted: { color: '#888', fontSize: 14 },
  logBox: { background: '#1a1a2e', color: '#d4d4d4', padding: '14px 16px', borderRadius: 8, minHeight: 130, maxHeight: 280, overflowY: 'auto', fontSize: 13, fontFamily: 'ui-monospace, monospace', lineHeight: 1.6 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  list: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 },
};
