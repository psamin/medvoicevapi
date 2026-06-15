// Client-facing 5-step intake form. Loads the prefilled payload by token, lets the
// client edit/complete fields, and submits back (source=form). Staff-only fields
// are never sent by the backend, so they never render here.
'use client';

import { useState, useEffect, useCallback, use } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function IntakeForm({ params }) {
  const { token } = use(params);
  const [payload, setPayload] = useState(null);
  const [values, setValues] = useState({});
  const [docValues, setDocValues] = useState({});
  const [docUnavailable, setDocUnavailable] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/intake/${token}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Could not load form');
      setPayload(data);
      const v = {};
      for (const step of data.steps) for (const sec of step.sections) for (const f of sec.fields) v[f.key] = f.value ?? '';
      setValues(v);
      const dv = {};
      const du = {};
      for (const d of data.documents || []) {
        dv[d.type] = d.uploadedFileUrl ?? '';
        du[d.type] = d.status === 'not_available';
      }
      setDocValues(dv);
      setDocUnavailable(du);
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function setField(key, val) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSavedMsg(null);
  }

  async function submit() {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/intake/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fields: values,
          documents: (payload.documents || []).map((d) => ({
            type: d.type,
            uploadedFileUrl: docUnavailable[d.type] ? '' : docValues[d.type] || '',
            notAvailable: !!docUnavailable[d.type],
          })),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Submit failed');
      setSavedMsg(
        data.status === 'complete'
          ? 'All set — your intake is complete. Thank you!'
          : `Saved. ${data.missingFields.length} item(s) still needed; you can finish anytime.`
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <Shell><p style={s.error}>{error}</p></Shell>;
  if (!payload) return <Shell><p style={s.muted}>Loading your intake form…</p></Shell>;

  const missingKeys = new Set(payload.missingFields.map((m) => m.key));

  return (
    <Shell>
      <h1 style={s.title}>Your MedVoice Intake</h1>
      <p style={s.muted}>
        Some details from your call are already filled in. Please complete anything missing.
        {' '}Status: <strong>{payload.status}</strong>
      </p>

      {payload.steps.map((step) => (
        <section key={step.step} style={s.step}>
          <h2 style={s.stepTitle}>Step {step.step}: {step.name}</h2>
          {step.sections.map((sec) => (
            <div key={sec.name} style={{ marginBottom: 14 }}>
              <h3 style={s.section}>{sec.name}</h3>
              <div style={s.grid}>
                {sec.fields.map((f) => (
                  <Field key={f.key} f={f} value={values[f.key]} onChange={setField} missing={missingKeys.has(f.key)} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {(payload.documents || []).length > 0 && (
        <section style={s.step}>
          <h2 style={s.stepTitle}>Documents</h2>
          <p style={s.muted}>Paste a link or filename for each document you can provide. If you don’t have one right now, check the box — it won’t hold up your intake.</p>
          <div style={s.grid}>
            {payload.documents.map((d) => {
              const na = !!docUnavailable[d.type];
              return (
                <label key={d.type} style={s.label}>
                  <span>
                    {d.label}{d.required && <span style={{ color: '#c0392b' }}> *</span>}
                    {d.status === 'received' ? <em style={{ color: '#1b7a3d' }}> ✓ received</em> : null}
                    {d.status === 'not_available' ? <em style={{ color: '#9a7d0a' }}> — marked unavailable</em> : null}
                  </span>
                  <input
                    type="text"
                    placeholder="link or filename"
                    value={na ? '' : docValues[d.type] ?? ''}
                    disabled={na}
                    onChange={(e) => { setDocValues((p) => ({ ...p, [d.type]: e.target.value })); setSavedMsg(null); }}
                    style={{ ...s.input, ...(na ? s.inputDisabled : null) }}
                  />
                  <label style={s.checkRow}>
                    <input
                      type="checkbox"
                      checked={na}
                      onChange={(e) => { setDocUnavailable((p) => ({ ...p, [d.type]: e.target.checked })); setSavedMsg(null); }}
                    />
                    <span>I don’t have access to this document right now.</span>
                  </label>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {savedMsg && <p style={s.saved}>{savedMsg}</p>}
      <button onClick={submit} disabled={saving} style={s.btn}>{saving ? 'Saving…' : 'Save my information'}</button>
      <p style={s.fine}>You can submit partial progress and come back later.</p>
    </Shell>
  );
}

function Field({ f, value, onChange, missing }) {
  const common = { id: f.key, value: value ?? '', onChange: (e) => onChange(f.key, e.target.value), style: s.input };
  return (
    <label style={s.label}>
      <span>{f.label}{f.required && <span style={{ color: '#c0392b' }}> *</span>}{missing && f.required && <em style={s.needed}> needed</em>}</span>
      {f.type === 'textarea' ? (
        <textarea {...common} rows={3} />
      ) : f.type === 'boolean' ? (
        <select {...common}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select>
      ) : f.type === 'select' ? (
        <select {...common}><option value="">—</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
      ) : (
        <input type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'number' ? 'number' : 'text'} {...common} />
      )}
      {f.helpText && <small style={s.help}>{f.helpText}</small>}
    </label>
  );
}

function Shell({ children }) {
  return (
    <div style={s.page}><div style={s.card}>{children}</div></div>
  );
}

const s = {
  page: { minHeight: '100vh', padding: '32px 16px', background: '#f0f2f5' },
  card: { maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
  title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 },
  muted: { color: '#667', fontSize: 14, marginBottom: 18 },
  step: { borderTop: '1px solid #eee', paddingTop: 16, marginBottom: 8 },
  stepTitle: { fontSize: 16, fontWeight: 700, color: '#2c3e50', marginBottom: 8 },
  section: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#7a8290', marginBottom: 8 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: '#333' },
  input: { padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, fontWeight: 400, fontFamily: 'inherit' },
  inputDisabled: { background: '#f3f4f6', color: '#9aa0a6' },
  checkRow: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 400, color: '#667' },
  help: { color: '#999', fontWeight: 400, fontSize: 11 },
  needed: { color: '#c0392b', fontWeight: 400, fontSize: 11 },
  btn: { marginTop: 18, padding: '11px 22px', background: '#2c3e50', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 15, fontWeight: 600 },
  saved: { color: '#1b7a3d', fontWeight: 600, fontSize: 14, marginTop: 12 },
  fine: { color: '#999', fontSize: 12, marginTop: 8 },
  error: { color: '#c0392b', fontWeight: 600 },
};
