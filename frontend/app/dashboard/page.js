// Read-only staff dashboard: every case saved from a call — client, status,
// captured fields (by source), calls/transcripts, emails, missing fields, and
// possible-duplicate flags. Polls so new calls show up after they end.
'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function Dashboard() {
  const [cases, setCases] = useState([]);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/cases`).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || 'failed to load');
      setCases(r.cases);
      setLoadedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // refresh so new calls appear
    return () => clearInterval(t);
  }, [load]);

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <div style={s.head}>
          <h1 style={s.title}>MedVoice — Intake Dashboard</h1>
          <button onClick={load} style={s.btn}>Refresh</button>
        </div>
        <p style={s.muted}>
          {cases.length} case(s){loadedAt ? ` · updated ${loadedAt}` : ''} · auto-refreshes every 5s
          {error && <span style={{ color: '#c0392b' }}> · {error}</span>}
        </p>

        {cases.length === 0 && <p style={s.muted}>No cases yet. End a call (or simulate one) and they'll appear here.</p>}

        {cases.map((c) => {
          const name = [c.client?.firstName, c.client?.lastName].filter(Boolean).join(' ') || '(no name)';
          const open = openId === c.id;
          return (
            <div key={c.id} style={s.card}>
              <div style={s.row} onClick={() => setOpenId(open ? null : c.id)}>
                <div>
                  <strong style={{ fontSize: 15 }}>{name}</strong>
                  <span style={s.sub}> · {c.client?.phone || '—'} · {c.accidentType || 'type ?'}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {c.possibleDuplicate && <span style={{ ...s.tag, ...s.dup }}>POSSIBLE DUPLICATE</span>}
                  {c.documentsPendingReview && <span style={{ ...s.tag, ...s.warn }}>DOCS PENDING</span>}
                  {c.humanFollowUpNeeded && <span style={{ ...s.tag, ...s.warn }}>HUMAN</span>}
                  <span style={{ ...s.tag, ...statusTone(c.status) }}>{c.status}</span>
                  <span style={s.chev}>{open ? '▾' : '▸'}</span>
                </div>
              </div>

              {open && (
                <div style={s.body}>
                  {c.possibleDuplicate && c.duplicateOfClient && (
                    <p style={s.dupNote}>
                      ⚠ Possible duplicate of <strong>{c.duplicateOfClient.firstName} {c.duplicateOfClient.lastName}</strong>
                      {' '}({c.duplicateOfClient.phone}) — review before merging.
                    </p>
                  )}

                  <Section title={`Captured fields (${c.fields.length})`}>
                    <table style={s.table}>
                      <thead><tr><th style={s.th}>Field</th><th style={s.th}>Value</th><th style={s.th}>Source</th></tr></thead>
                      <tbody>
                        {c.fields.map((f) => (
                          <tr key={f.key}>
                            <td style={s.td}>{f.label}</td>
                            <td style={s.td}>{String(f.value)}</td>
                            <td style={s.td}>
                              <span style={{ ...s.tag, ...sourceTone(f.source) }}>{f.source}</span>
                              {f.verifiedByHuman ? <span style={{ ...s.tag, ...s.done, marginLeft: 4 }}>✓ verified</span> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Section>

                  {c.missingFields.length > 0 && (
                    <Section title={`Still missing (${c.missingFields.length})`}>
                      <span style={s.muted}>{c.missingFields.map((m) => m.label).join(', ')}</span>
                    </Section>
                  )}

                  <Section title={`Calls (${c.calls.length})`}>
                    {c.calls.length === 0 ? <span style={s.muted}>none</span> : c.calls.map((v) => (
                      <div key={v.id} style={s.call}>
                        <div><strong>{v.direction}</strong> · {v.status || '—'}</div>
                        {v.summary && <div style={s.muted}>Summary: {v.summary}</div>}
                        {v.transcript && <details><summary style={s.link}>transcript</summary><pre style={s.pre}>{v.transcript}</pre></details>}
                        {v.recordingUrl && <a href={v.recordingUrl} style={s.link}>recording</a>}
                      </div>
                    ))}
                  </Section>

                  <Section title={`Documents (${(c.documents || []).length})`}>
                    {(c.documents || []).length === 0 ? <span style={s.muted}>none</span> : (c.documents || []).map((d) => (
                      <div key={d.type} style={s.muted}>
                        {d.label}{d.required ? ' *' : ''}: <strong>{d.status}</strong>
                        {d.status === 'not_available' && d.unavailableReason ? ` (${d.unavailableReason})` : ''}
                      </div>
                    ))}
                  </Section>

                  <Section title={`Tasks (${(c.tasks || []).filter((t) => t.status !== 'done' && t.status !== 'cancelled').length} open)`}>
                    {(c.tasks || []).length === 0 ? <span style={s.muted}>none</span> : (c.tasks || []).map((t) => (
                      <div key={t.id} style={s.muted}>
                        <span style={{ ...s.tag, ...(t.status === 'done' ? s.done : s.warn) }}>{t.type}</span> {t.title}
                        {t.priority === 'high' ? <strong style={{ color: '#b3261e' }}> · high</strong> : ''}
                        {t.status === 'done' ? ' · ✓' : ''}
                      </div>
                    ))}
                  </Section>

                  <Section title={`Communications (${(c.communications || []).length})`}>
                    {(c.communications || []).length === 0 ? <span style={s.muted}>none</span> : (c.communications || []).map((m) => (
                      <div key={m.id} style={s.muted}>
                        {m.direction}/{m.channel} · <strong>{m.type}</strong> · {m.status}
                        {m.status === 'skipped' && m.skippedReason ? ` (skipped: ${m.skippedReason})` : ''}
                      </div>
                    ))}
                  </Section>

                  <Section title={`Emails (${c.emails.length})`}>
                    {c.emails.length === 0 ? <span style={s.muted}>none</span> : c.emails.map((e) => (
                      <div key={e.id} style={s.muted}>{e.status} → {e.toEmail} · "{e.subject}"</div>
                    ))}
                  </Section>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={s.sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

function statusTone(status) {
  if (status === 'complete' || status === 'accepted') return { background: '#d4f4dd', color: '#1b7a3d' };
  if (status === 'ready_for_case_manager') return { background: '#dbeafe', color: '#1e40af' };
  if (status === 'case_manager_review' || status === 'attorney_review') return { background: '#fde2e1', color: '#b3261e' };
  if (status === 'manual_review' || status === 'follow_up_exhausted' || status === 'rejected') return { background: '#f5d0d0', color: '#7a1f1f' };
  if (status === 'opted_out') return { background: '#e2d6f0', color: '#5b2a86' };
  if (status === 'missing_info' || status === 'documents_pending') return { background: '#fef3cd', color: '#8a6d00' };
  return { background: '#e9ecef', color: '#495057' };
}
function sourceTone(src) {
  if (src === 'call') return { background: '#dbeafe', color: '#1e40af' };
  if (src === 'form') return { background: '#d4f4dd', color: '#1b7a3d' };
  return { background: '#e9ecef', color: '#495057' };
}

const s = {
  page: { minHeight: '100vh', padding: '32px 16px', background: '#f0f2f5' },
  wrap: { maxWidth: 900, margin: '0 auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e' },
  btn: { padding: '8px 16px', background: '#2c3e50', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600 },
  muted: { color: '#667', fontSize: 13 },
  card: { background: '#fff', borderRadius: 10, padding: '12px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' },
  sub: { color: '#667', fontSize: 13 },
  chev: { color: '#999', marginLeft: 4 },
  tag: { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, letterSpacing: '0.04em' },
  dup: { background: '#ffe0b2', color: '#9a5b00' },
  warn: { background: '#fde2e1', color: '#b3261e' },
  done: { background: '#d4f4dd', color: '#1b7a3d' },
  body: { borderTop: '1px solid #eee', marginTop: 10, paddingTop: 10 },
  dupNote: { background: '#fff7e6', border: '1px solid #ffe0b2', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#7a4a00' },
  sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#7a8290', margin: '6px 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', color: '#888', fontWeight: 600, padding: '2px 6px', borderBottom: '1px solid #eee' },
  td: { padding: '3px 6px', borderBottom: '1px solid #f3f3f3', verticalAlign: 'top' },
  call: { borderLeft: '3px solid #dbeafe', paddingLeft: 10, marginBottom: 8, fontSize: 13 },
  link: { color: '#2c3e50', cursor: 'pointer', fontSize: 12 },
  pre: { background: '#1a1a2e', color: '#d4d4d4', padding: 10, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' },
};
