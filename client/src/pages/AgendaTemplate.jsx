import { useRef, useState } from 'react';
import { api } from '../api.js';
import { Btn, I } from '../ui.jsx';

/* ───────── a club's own agenda: upload the Word file or PDF, check what was read, keep it ─────────
   value: { profile: { region, mission, officers: [{ role, name, phone }] }, blocks, start } or null */
const BLANK = { profile: { region: '', mission: '', officers: [] }, blocks: [], start: '' };
const OFFICERS = ['President', 'VP Education', 'VP Membership', 'VP Public Relations', 'Secretary', 'Treasurer', 'Sergeant-At-Arms'];

export default function AgendaTemplate({ value, onChange, onFound }) {
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const read = async (f) => {
    if (!f) return;
    setErr('');
    if (f.size > 3 * 1024 * 1024) { setErr('That file is too big. Use one under 3 MB.'); return; }
    setBusy(true);
    try {
      const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(f); });
      const r = await api('/agenda-template/read', { method: 'POST', body: { name: f.name, data } });
      // the Word file is kept only when it can be filled; a PDF is read for the details only
      onChange({ profile: r.profile, blocks: r.blocks, start: r.start, template: r.template, note: r.note, pdf: /\.pdf$/i.test(f.name), file: r.template?.usable ? { name: f.name, data } : undefined });
      onFound?.(r.club);
    } catch (e) { setErr(e.message || 'We could not read that file'); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const p = value?.profile;
  const setP = (patch) => onChange({ ...value, profile: { ...p, ...patch } });
  const setOff = (i, patch) => setP({ officers: p.officers.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  if (!value) {
    return (
      <div className="at">
        <input ref={file} type="file" hidden accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => read(e.target.files?.[0])} />
        <div className="at-btns">
          <Btn onClick={() => file.current?.click()} disabled={busy}>{busy ? 'Reading your agenda…' : 'Upload your Word agenda'}</Btn>
          <button type="button" className="lnk" onClick={() => onChange(BLANK)}>Enter the details by hand</button>
        </div>
        <p className="fine">Upload the Word file your club uses (a past agenda is fine). Brekkie keeps it as your template and fills it in for each meeting, so it looks just like yours. You check what we found before anything is kept. A PDF works too, but only for your club details.</p>
        {err && <p className="err">{err}</p>}
      </div>
    );
  }
  return (
    <div className="at">
      {value.template && (
        <div className="at-tpl">
          <p className="fl" style={{ marginBottom: 6 }}>{value.template.usable ? 'Your Word file will be your agenda' : 'We could not use this file as a template'}</p>
          <div className="at-ro">{value.template.parts.map((x) => <span key={x.key} className={x.found ? 'ok' : 'miss'}>{x.found ? I.check : null}{x.label}</span>)}</div>
          <p className="fine">{value.template.usable ? 'Anything marked in grey was not found, so it stays exactly as it is in your file. Download the Word agenda for any meeting to see it filled in.' : 'We could not find the running order and the role table, so only your club details will be used.'}</p>
        </div>
      )}
      {value.pdf && <p className="fine">A PDF cannot be used as a template. Upload the Word version of your agenda to use your own layout.</p>}
      {value.note && <p className="fine">{value.note}</p>}
      <label className="fl" htmlFor="at-region">Area, division and district</label>
      <input id="at-region" className="inp" value={p.region} maxLength={80} placeholder="e.g. Area 4, Division C, District 129" onChange={(e) => setP({ region: e.target.value })} />
      <label className="fl" htmlFor="at-mission">Club mission</label>
      <textarea id="at-mission" className="inp at-ta" rows={4} maxLength={600} value={p.mission} onChange={(e) => setP({ mission: e.target.value })} />
      <p className="fl" style={{ marginBottom: 6 }}>Officers <i>(shown down the side of the agenda)</i></p>
      <div className="at-offs">
        {p.officers.map((o, i) => (
          <div className="at-off" key={i}>
            <input className="inp" aria-label="Role" value={o.role} maxLength={40} placeholder="Role" onChange={(e) => setOff(i, { role: e.target.value })} />
            <input className="inp" aria-label="Name" value={o.name} maxLength={60} placeholder="Name" onChange={(e) => setOff(i, { name: e.target.value })} />
            <input className="inp" aria-label="Phone" value={o.phone} maxLength={30} placeholder="Phone" onChange={(e) => setOff(i, { phone: e.target.value })} />
            <button type="button" className="at-x" aria-label={`Remove ${o.role || 'officer'}`} onClick={() => setP({ officers: p.officers.filter((_, j) => j !== i) })}>{I.close}</button>
          </div>
        ))}
      </div>
      {p.officers.length < 7 && <button type="button" className="lnk" onClick={() => setP({ officers: [...p.officers, { role: OFFICERS[p.officers.length] || '', name: '', phone: '' }] })}>Add an officer</button>}
      {value.blocks?.length > 0 && (
        <>
          <p className="fl" style={{ marginBottom: 6 }}>Running order we found{value.start ? `, starting ${value.start.slice(0, 2)}:${value.start.slice(2)}` : ''}</p>
          <div className="at-ro">{value.blocks.map((b) => <span key={b.id}>{b.title}{b.min ? ` · ${b.min} min` : ''}</span>)}</div>
          <p className="fine">New agendas start from this. You can still change any meeting's agenda.</p>
        </>
      )}
      <div className="at-btns">
        <button type="button" className="lnk" onClick={() => { onChange(null); setErr(''); }}>Start again</button>
      </div>
    </div>
  );
}
