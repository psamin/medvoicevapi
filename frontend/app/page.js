// The entire page is interactive (voice, state, browser APIs) so we mark it as a client component.
'use client';

import { useState, useCallback } from 'react';
// @elevenlabs/react exports useConversation.
// Returns { startSession, endSession, status, isSpeaking } and accepts event callbacks.
// Docs: https://elevenlabs.io/docs/conversational-ai/libraries/react
import { useConversation } from '@elevenlabs/react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function Home() {
  const [log, setLog] = useState([]);
  const [dbSnapshot, setDbSnapshot] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  function addLog(type, text) {
    setLog(prev => [
      ...prev,
      { id: Date.now() + Math.random(), ts: new Date().toISOString().slice(11, 19), type, text },
    ]);
  }

  // useCallback so the same fn identity can be reused from the disconnect handler.
  const fetchDb = useCallback(async () => {
    setDbLoading(true);
    try {
      const res = await fetch(`${API_BASE}/debug/db`);
      setDbSnapshot(await res.json());
    } catch (err) {
      addLog('error', `DB fetch failed: ${err.message}`);
    } finally {
      setDbLoading(false);
    }
  }, []);

  const { startSession, endSession, status, isSpeaking } = useConversation({
    onConnect: () => addLog('event', 'Connected to ElevenLabs agent.'),
    onDisconnect: () => {
      addLog('event', 'Disconnected. Auto-loading captured intake...');
      // Small delay so the agent's final save_intake webhook reaches the backend
      // before we pull the snapshot.
      setTimeout(() => fetchDb(), 1500);
    },
    // message shape: { message: string, source: 'user' | 'ai' }
    onMessage: (msg) =>
      addLog('message', `[${msg.source ?? 'agent'}] ${msg.message ?? JSON.stringify(msg)}`),
    onError: (err) =>
      addLog('error', typeof err === 'string' ? err : (err?.message ?? JSON.stringify(err))),
  });

  async function handleStart() {
    try {
      addLog('event', 'Requesting microphone permission...');
      await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog('event', 'Microphone granted. Fetching signed URL...');

      const res = await fetch(`${API_BASE}/api/get-signed-url`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const { signedUrl } = await res.json();

      addLog('event', 'Got signed URL. Starting conversation...');
      await startSession({ signedUrl });
    } catch (err) {
      addLog('error', err.message);
    }
  }

  async function handleStop() {
    try {
      await endSession();
    } catch (err) {
      addLog('error', err.message);
    }
  }

  async function handleResetDb() {
    try {
      await fetch(`${API_BASE}/debug/reset`, { method: 'POST' });
      setDbSnapshot(null);
      addLog('event', 'Mock database reset.');
    } catch (err) {
      addLog('error', `DB reset failed: ${err.message}`);
    }
  }

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  const isBusy = isConnected || isConnecting;

  // Latest record from each collection (records are { id, timestamp, payload }).
  const latestIntake = lastPayload(dbSnapshot?.intakes);
  const latestEligibility = lastPayload(dbSnapshot?.eligibilityChecks);
  const latestConflict = lastPayload(dbSnapshot?.conflicts);
  const consentRecords = (dbSnapshot?.consents ?? []).map(r => r.payload);
  const toolCallNames = (dbSnapshot?.toolCalls ?? []).map(r => r.payload?.toolName);

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>PI Intake Voice Agent — Test Harness</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <span style={{ ...s.badge, background: statusColor(status) }}>
            {status.toUpperCase()}
          </span>
          {isConnected && isSpeaking && (
            <span style={{ ...s.badge, background: '#8e44ad' }}>AGENT SPEAKING</span>
          )}
        </div>

        <div style={s.controls}>
          <button onClick={handleStart} disabled={isBusy} style={s.btn}>
            Start Voice Test
          </button>
          <button
            onClick={handleStop}
            disabled={!isConnected}
            style={{ ...s.btn, background: '#c0392b' }}
          >
            Stop
          </button>
          <button onClick={fetchDb} style={{ ...s.btn, background: '#27ae60' }}>
            Refresh Debug Data
          </button>
          <button onClick={handleResetDb} style={{ ...s.btn, background: '#7f8c8d' }}>
            Reset Debug Data
          </button>
        </div>

        <section style={s.section}>
          <h2 style={s.sectionTitle}>Event Log</h2>
          <div style={s.logBox}>
            {log.length === 0 && <span style={{ color: '#666' }}>No events yet.</span>}
            {log.map(entry => (
              <div key={entry.id} style={{ color: logColor(entry.type), marginBottom: 3 }}>
                <span style={{ opacity: 0.55 }}>{entry.ts} </span>
                <span style={{ fontWeight: 600 }}>[{entry.type}]</span>{' '}
                {entry.text}
              </div>
            ))}
          </div>
        </section>

        {/* ----- Intake Dashboard ----- */}
        <section style={s.section}>
          <h2 style={s.sectionTitle}>
            Intake Dashboard
            {dbLoading && (
              <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>Loading…</span>
            )}
          </h2>

          {!dbSnapshot ? (
            <p style={s.muted}>
              Run a call — this fills in automatically when the agent ends, or click “Refresh Debug Data”.
            </p>
          ) : !latestIntake ? (
            <p style={s.muted}>
              No <code>save_intake</code> recorded yet. The agent calls it at the end of the conversation.
              {toolCallNames.length > 0 && (
                <> Tools fired so far: <strong>{toolCallNames.join(', ')}</strong>.</>
              )}
            </p>
          ) : (
            <>
              {/* Routing + screening summary chips */}
              <div style={s.chipRow}>
                <Chip
                  label="Qualified"
                  value={boolText(latestIntake.routing?.qualified)}
                  tone={latestIntake.routing?.qualified ? 'good' : 'bad'}
                />
                <Chip label="Next step" value={latestIntake.routing?.next_step ?? '—'} />
                <Chip
                  label="Urgency"
                  value={latestIntake.routing?.urgency_flag ?? '—'}
                  tone={urgencyTone(latestIntake.routing?.urgency_flag)}
                />
                {latestEligibility && (
                  <Chip
                    label="SOL"
                    value={latestEligibility.sol_status}
                    tone={solTone(latestEligibility.sol_status)}
                  />
                )}
                {latestConflict && (
                  <Chip
                    label="Conflict"
                    value={latestConflict.status}
                    tone={latestConflict.status === 'clear' ? 'good' : 'bad'}
                  />
                )}
              </div>

              <div style={s.grid}>
                <Card title="Caller" obj={latestIntake.caller} />
                <Card title="Incident" obj={latestIntake.incident} />
                <Card title="Vehicle" obj={latestIntake.vehicle} />
                <Card title="At fault" obj={latestIntake.at_fault} />
                <Card title="Insurance" obj={latestIntake.insurance} />
                <Card title="Treatment" obj={latestIntake.treatment} />
                <Card title="Damages" obj={latestIntake.damages} />
                <InjuriesCard injuries={latestIntake.injuries} />
                <ConsentsCard consents={latestIntake.consents} fallback={consentRecords} />
              </div>
            </>
          )}
        </section>

        {/* ----- Raw JSON (collapsible) ----- */}
        {dbSnapshot && (
          <section style={s.section}>
            <button onClick={() => setShowRaw(v => !v)} style={s.linkBtn}>
              {showRaw ? '▾ Hide' : '▸ Show'} raw /debug/db JSON
            </button>
            {showRaw && <pre style={s.jsonBox}>{JSON.stringify(dbSnapshot, null, 2)}</pre>}
          </section>
        )}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function lastPayload(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1].payload;
}

function boolText(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '—';
}

function prettyKey(k) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function prettyVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/* ---------- presentational components ---------- */

function Chip({ label, value, tone }) {
  const bg = tone === 'good' ? '#d4f4dd' : tone === 'bad' ? '#fde2e1' : tone === 'warn' ? '#fef3cd' : '#e9ecef';
  const fg = tone === 'good' ? '#1b7a3d' : tone === 'bad' ? '#b3261e' : tone === 'warn' ? '#8a6d00' : '#495057';
  return (
    <div style={{ ...s.chip, background: bg, color: fg }}>
      <span style={{ opacity: 0.7, fontWeight: 600, textTransform: 'uppercase', fontSize: 10 }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function Card({ title, obj }) {
  const entries = obj && typeof obj === 'object' ? Object.entries(obj) : [];
  return (
    <div style={s.dataCard}>
      <h3 style={s.cardTitle}>{title}</h3>
      {entries.length === 0 ? (
        <p style={s.muted}>Not captured</p>
      ) : (
        <dl style={s.dl}>
          {entries.map(([k, v]) => (
            <div key={k} style={s.row}>
              <dt style={s.dt}>{prettyKey(k)}</dt>
              <dd style={s.dd}>{prettyVal(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function InjuriesCard({ injuries }) {
  const list = Array.isArray(injuries) ? injuries : [];
  return (
    <div style={s.dataCard}>
      <h3 style={s.cardTitle}>Injuries</h3>
      {list.length === 0 ? (
        <p style={s.muted}>None captured</p>
      ) : (
        list.map((inj, i) => (
          <div key={i} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: i < list.length - 1 ? '1px solid #eee' : 'none' }}>
            <strong style={{ fontSize: 13 }}>{prettyVal(inj.body_region)}</strong>
            <dl style={s.dl}>
              {Object.entries(inj).filter(([k]) => k !== 'body_region').map(([k, v]) => (
                <div key={k} style={s.row}>
                  <dt style={s.dt}>{prettyKey(k)}</dt>
                  <dd style={s.dd}>{prettyVal(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}
    </div>
  );
}

function ConsentsCard({ consents, fallback }) {
  // Prefer the structured consents object on the intake; fall back to log_consent rows.
  const entries = consents && typeof consents === 'object' ? Object.entries(consents) : [];
  return (
    <div style={s.dataCard}>
      <h3 style={s.cardTitle}>Consents</h3>
      {entries.length > 0 ? (
        <dl style={s.dl}>
          {entries.map(([k, v]) => (
            <div key={k} style={s.row}>
              <dt style={s.dt}>{prettyKey(k)}</dt>
              <dd style={s.dd}>{v?.granted === true ? 'Granted ✓' : v?.granted === false ? 'Denied ✗' : prettyVal(v)}</dd>
            </div>
          ))}
        </dl>
      ) : fallback.length > 0 ? (
        <dl style={s.dl}>
          {fallback.map((c, i) => (
            <div key={i} style={s.row}>
              <dt style={s.dt}>{prettyKey(c.consent_type ?? 'consent')}</dt>
              <dd style={s.dd}>{c.granted ? 'Granted ✓' : 'Denied ✗'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p style={s.muted}>None captured</p>
      )}
    </div>
  );
}

/* ---------- tone helpers ---------- */

function statusColor(status) {
  if (status === 'connected') return '#27ae60';
  if (status === 'connecting') return '#e67e22';
  return '#95a5a6';
}

function logColor(type) {
  if (type === 'error') return '#e74c3c';
  if (type === 'message') return '#74b9ff';
  return '#55efc4';
}

function solTone(v) {
  if (v === 'ok') return 'good';
  if (v === 'near') return 'warn';
  if (v === 'expired' || v === 'unknown') return 'bad';
  return undefined;
}

function urgencyTone(v) {
  if (v === 'none') return 'good';
  if (v === 'near_sol') return 'warn';
  if (v === 'expired_or_unknown' || v === 'emergency' || v === 'conflict') return 'bad';
  return undefined;
}

/* ---------- styles ---------- */

const s = {
  page: { minHeight: '100vh', padding: '32px 16px' },
  card: {
    maxWidth: 920,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 12,
    padding: 32,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
  },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 18, color: '#1a1a2e' },
  badge: {
    color: '#fff',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  controls: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 },
  btn: {
    padding: '10px 20px',
    background: '#2c3e50',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 10,
    color: '#2c3e50',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  muted: { color: '#888', fontSize: 14 },
  logBox: {
    background: '#1a1a2e',
    color: '#d4d4d4',
    padding: '14px 16px',
    borderRadius: 8,
    minHeight: 130,
    maxHeight: 280,
    overflowY: 'auto',
    fontSize: 13,
    fontFamily: 'ui-monospace, "Cascadia Code", monospace',
    lineHeight: 1.6,
  },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 13,
    minWidth: 80,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 14,
  },
  dataCard: {
    border: '1px solid #e3e6ea',
    borderRadius: 10,
    padding: '14px 16px',
    background: '#fbfcfd',
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#5a6472',
    marginBottom: 8,
  },
  dl: { margin: 0 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 13 },
  dt: { color: '#7a8290', flexShrink: 0 },
  dd: { margin: 0, fontWeight: 600, color: '#222', textAlign: 'right', wordBreak: 'break-word' },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#2c3e50',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: 0,
  },
  jsonBox: {
    background: '#f8f9fa',
    border: '1px solid #dee2e6',
    padding: '14px 16px',
    borderRadius: 8,
    marginTop: 10,
    maxHeight: 520,
    overflowY: 'auto',
    fontSize: 12,
    fontFamily: 'ui-monospace, "Cascadia Code", monospace',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};
