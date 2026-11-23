import { useEffect, useState } from 'react';
import { api, getToken } from '../api.js';
import { Btn, I, Select, promptBox } from '../ui.jsx';

/* ───────── a club's agenda details: area line (found from the club number) and the executive committee ─────────
   value: { profile: { region, mission, officers: [{ role, name, phone }] }, blocks, start } or null */
const BLANK = { profile: { region: '', mission: '', officers: [] }, blocks: [], start: '' };
const OFFICERS = ['President', 'VP Education', 'VP Membership', 'VP Public Relations', 'Secretary', 'Treasurer', 'Sergeant-At-Arms'];
const MAX = 10;   // the side of the agenda page fits ten (the type tightens after seven)

export default function AgendaTemplate({ value, onChange, number = '', members = [] }) {
  const v = value || BLANK, p = v.profile;
  const [note, setNote] = useState('');
  const [peeking, setPeeking] = useState(false);
  const setP = (patch) => onChange({ ...v, profile: { ...p, ...patch } });
  const setOff = (i, patch) => setP({ officers: p.officers.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  // the club number gives the area, division and district: the club never has to type them
  useEffect(() => {
    if (p.region || String(number).length < 3) return;
    let live = true;
    api(`/clubs/lookup/${number}`).then((r) => { if (live && r.club) { onChange({ ...v, profile: { ...p, region: r.club.region } }); setNote(`Found ${r.club.name || 'your club'}: ${r.club.region}`); } }).catch(() => {});
    return () => { live = false; };
  }, [number]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (m) => m.name + (m.credential && m.credential !== 'TM' ? `, ${m.credential}` : '');
  const team = members.filter((m) => m.kind === 'member' && m.status !== 'inactive');
  const pickOfficer = (i, id) => { const o = p.officers[i]; const m = team.find((x) => String(x.id) === String(id)); if (m) setOff(i, { name: nameOf(m), phone: m.phone || o.phone || '' }); };
  const move = (i, d) => { const a = [...p.officers]; [a[i], a[i + d]] = [a[i + d], a[i]]; setP({ officers: a }); };
  const fillExco = () => setP({ officers: OFFICERS.map((role, i) => p.officers[i] || { role, name: '', phone: '' }) });
  const preview = async () => {
    setPeeking(true); setNote('');
    const w = window.open('', '_blank');   // opened now, while the click still counts
    try {
      const r = await fetch('/api/vpe/club/agenda-preview', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': getToken() || '' }, body: JSON.stringify({ profile: p }) });
      if (!r.ok) { let m = 'We could not draw the agenda page'; try { m = (await r.json()).error || m; } catch { /* not json */ } throw new Error(m); }
      const url = URL.createObjectURL(await r.blob());
      if (w) w.location.href = url; else window.location.href = url;
    } catch (e) { w?.close(); setNote(e.message); } finally { setPeeking(false); }
  };

  return (
    <div className="at">
      <label className="fl" htmlFor="at-region">Area, division and district</label>
      <input id="at-region" className="inp" value={p.region} maxLength={80} placeholder={String(number).length >= 3 ? 'Looking it up from your club number…' : 'e.g. Area 4, Division C, District 129'} onChange={(e) => setP({ region: e.target.value })} />
      {note && <p className="fine">{note}</p>}
      <p className="fl" style={{ marginBottom: 6 }}>Executive committee <i>({team.length ? 'pick each officer from your members; ' : ''}use the arrows to reorder; shown down the side of the agenda)</i></p>
      {p.officers.length < OFFICERS.length && <button type="button" className="lnk" onClick={fillExco}>Add all seven officers</button>}
      <div className="at-offs">
        {p.officers.map((o, i) => (
          <div className="at-off" key={i}>
            <input className="inp" aria-label="Role" value={o.role} maxLength={40} placeholder="Role" onChange={(e) => setOff(i, { role: e.target.value })} />
            {team.length ? (
              <Select label="Name" searchable value={team.find((m) => nameOf(m) === o.name)?.id ?? ''} placeholder={o.name || 'Pick a member'} options={team.map((m) => ({ value: m.id, label: nameOf(m) }))} onChange={(id) => pickOfficer(i, id)}
                onAdd={async () => { const x = await promptBox('Name of the officer'); if (x && x.trim()) setOff(i, { name: x.trim().slice(0, 60) }); }} addLabel="Someone else…" />
            ) : <input className="inp" aria-label="Name" value={o.name} maxLength={60} placeholder="Name" onChange={(e) => setOff(i, { name: e.target.value })} />}
            <input className="inp" aria-label="Phone" value={o.phone} maxLength={30} placeholder="Phone" onChange={(e) => setOff(i, { phone: e.target.value })} />
            <span className="at-acts">
              <button type="button" className="at-x at-up" aria-label={`Move ${o.role || 'officer'} up`} disabled={i === 0} onClick={() => move(i, -1)}>{I.chev}</button>
              <button type="button" className="at-x at-dn" aria-label={`Move ${o.role || 'officer'} down`} disabled={i === p.officers.length - 1} onClick={() => move(i, 1)}>{I.chev}</button>
              <button type="button" className="at-x" aria-label={`Remove ${o.role || 'officer'}`} onClick={() => setP({ officers: p.officers.filter((_, j) => j !== i) })}>{I.close}</button>
            </span>
          </div>
        ))}
      </div>
      {p.officers.length < MAX && <button type="button" className="lnk" onClick={() => setP({ officers: [...p.officers, { role: OFFICERS[p.officers.length] || '', name: '', phone: '' }] })}>Add another officer <i>(an Area Director, or an extra role)</i></button>}
      <div className="at-btns">
        <Btn kind="ghost" onClick={preview} disabled={peeking}>{peeking ? 'Drawing…' : 'See the agenda page'}</Btn>
      </div>
    </div>
  );
}
