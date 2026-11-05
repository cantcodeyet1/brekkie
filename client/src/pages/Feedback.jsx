import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { fmtDate } from '../data.js';
import { Btn, ErrorMsg, I, Loading, Select, Wordmark } from '../ui.jsx';

/* Public page behind the QR code: anyone at the meeting picks who they want to write to. No sign-in. */
export default function Feedback() {
  const { code } = useParams();
  const { data, error, loading } = useApi(`/f/${code}`, { token: '' });
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);       // [{ id, name, well, improve }]
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);

  if (loading) return <div className="ffwrap"><div className="ff"><Loading /></div></div>;
  if (error) return <div className="ffwrap"><div className="ff"><Wordmark /><h1>This link is not valid</h1><p className="lede">Ask someone at the meeting to show you the QR code again.</p></div></div>;

  const has = (id) => picked.some((p) => p.id === id);
  const toggle = (p) => setPicked((cur) => (has(p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, { id: p.id, name: p.name, well: '', improve: '' }]));
  const upd = (id, patch) => setPicked((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const ready = picked.filter((p) => p.well.trim() || p.improve.trim());

  const send = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api(`/f/${code}`, { method: 'POST', token: '', body: { from_name: name, items: ready.map((p) => ({ to_person_id: p.id, well: p.well, improve: p.improve })) } });
      setSent(r.count); setPicked([]);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (sent) return (
    <div className="ffwrap"><div className="ff" style={{ textAlign: 'center', paddingTop: 90 }}>
      <div className="done" style={{ padding: 0 }}><div className="tick">{I.check}</div></div>
      <h1>Thank you</h1>
      <p className="lede" style={{ fontSize: 17 }}>Your feedback has been sent to {sent} {sent === 1 ? 'person' : 'people'}. They will see it in Brekkie.</p>
      <Btn kind="ghost" style={{ maxWidth: 320, margin: '20px auto 0' }} onClick={() => setSent(0)}>Give feedback to someone else</Btn>
    </div></div>
  );

  const others = data.others.filter((o) => !has(o.id)).map((o) => ({ value: o.id, label: o.name }));
  return (
    <div className="ffwrap">
      <div className="ff">
        <Wordmark />
        <h1>Tell people how they did</h1>
        <p className="lede" style={{ fontSize: 17 }}>Meeting {data.meeting.number}, {fmtDate(data.meeting.date)}{data.meeting.theme ? `. ${data.meeting.theme}.` : '.'} It takes a minute, and they will see what you wrote.</p>

        <div className="step">Step 1 · Your name (optional)</div>
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank to stay anonymous" aria-label="Your name" />

        <div className="step">Step 2 · Who do you want to write to?</div>
        <p style={{ margin: '0 0 10px', color: 'var(--mute)', fontSize: 14.5 }}>Tap as many people as you like.</p>
        <div className="pickgrid">
          {data.agenda.map((p) => <button type="button" key={p.id} className={'pbtn' + (has(p.id) ? ' on' : '')} onClick={() => toggle(p)} aria-pressed={has(p.id)}>{p.name}<small>{p.roles.join(', ')}</small></button>)}
        </div>
        {others.length > 0 && <div style={{ marginTop: 12 }}><Select value="" placeholder="Someone else…" options={others} onChange={(id) => toggle(data.others.find((o) => o.id === id))} /></div>}

        {picked.length > 0 && <div className="step">Step 3 · Write a few words</div>}
        {picked.map((p) => (
          <div className="fcard" key={p.id}>
            <div className="fh"><b>{p.name}</b><button type="button" className="x" onClick={() => toggle(p)} aria-label={`Remove ${p.name}`}>{I.close}</button></div>
            <label className="fl blue">What did they do well?</label>
            <textarea className="inp" value={p.well} onChange={(e) => upd(p.id, { well: e.target.value })} placeholder="Something that worked for you" />
            <label className="fl maroon">What could they try next time?</label>
            <textarea className="inp" style={{ marginBottom: 10 }} value={p.improve} onChange={(e) => upd(p.id, { improve: e.target.value })} placeholder="One kind, useful suggestion" />
          </div>
        ))}
        {err && <p className="err">{err}</p>}
      </div>
      {picked.length > 0 && <div className="sendbar"><Btn onClick={send} disabled={busy || !ready.length}>{ready.length ? `Send to ${ready.length} ${ready.length === 1 ? 'person' : 'people'}` : 'Write something to send'}</Btn></div>}
    </div>
  );
}
