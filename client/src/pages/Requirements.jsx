import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate } from '../data.js';
import { Btn, DatePick, I, Modal, Select, Seg, useToast } from '../ui.jsx';

/* The meeting roles and Education Series presentation a level asks for, besides its projects (Pathways enhancements).
   A role counts at the level it was done in. Scheduling one at this club on a meeting date puts the member on that
   meeting's roster, the same as a speaker. */
const roster = (r) => {
  if (!r) return '';
  if (r.status === 'placed') return `Added to the roster as ${r.label}, meeting ${r.meeting}`;
  if (r.status === 'taken') return `${r.label} is already taken by ${r.by || 'someone else'} that day, so it is scheduled but not on the roster`;
  return 'There is no meeting on that date, so it is not on the roster';
};

export function EnhModal({ person, level, it, onClose, onSaved }) {
  const toast = useToast();
  const [item, setItem] = useState(it.preset || (it.options.length === 1 ? it.options[0].key : ''));
  const [date, setDate] = useState('');
  const [mode, setMode] = useState('plan');
  const [where, setWhere] = useState('here');
  const [venue, setVenue] = useState('');
  const [busy, setBusy] = useState(false);
  const series = it.kind === 'series';
  const save = async () => {
    if (!item) return toast(series ? 'Choose the presentation' : 'Choose the role');
    if (!date) return toast('Choose a date');
    if (where === 'there' && !venue.trim()) return toast('Enter the club name');
    setBusy(true);
    try {
      const r = await api(`/vpe/people/${person.id}/enh`, { method: 'POST', body: { level, kind: it.kind, item, date, venue: where === 'there' ? venue : '', done: mode === 'done' } });
      toast(mode === 'done' ? 'Recorded as done' : roster(r.roster) || 'Scheduled'); onSaved();
    } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <Modal title={series ? 'Education Series presentation' : 'Schedule a role'} onClose={onClose}>
      <div className="pm">
        <p className="rq-lead"><b>{person.name}</b>, Level {level}{series ? `, ${it.set}` : ''}</p>
        {it.options.length > 1 && <label className="pmf"><span className="fl">{series ? 'Presentation' : 'Role'}</span><Select value={item} onChange={setItem} placeholder={series ? 'Choose the presentation' : 'Choose the role'} options={it.options.map((o) => ({ value: o.key, label: o.label }))} /></label>}
        <div className="pm-row">
          <label className="pmf"><span className="fl">Date</span><DatePick value={date} onChange={setDate} /></label>
          <div className="pmf"><span className="fl">When</span><Seg value={mode} onChange={setMode} options={[['plan', 'Coming up'], ['done', 'Already done']]} /></div>
        </div>
        <div className="pmf"><span className="fl">Where</span><Seg value={where} onChange={setWhere} options={[['here', 'This club'], ['there', 'Another club']]} /></div>
        {where === 'there' && <label className="pmf"><span className="fl">Club name</span><input className="inp" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="For example, Sunrise Toastmasters" maxLength={80} /></label>}
        {!series && where === 'here' && mode === 'plan' && <p className="rq-hint">On a meeting date, they go on that meeting's roster if the role is on the agenda.</p>}
        <div className="pm-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>{mode === 'done' ? 'Record' : 'Schedule'}</Btn></div>
      </div>
    </Modal>
  );
}

export default function Requirements({ lv, person, mine, canPlan, reload }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(null);
  const [qs] = useSearchParams();
  const [open, setOpen] = useState(qs.get('req') === '1' && Number(qs.get('level')) === lv.level);
  const [pick, setPick] = useState({});   // the role chosen on a toggle, per requirement
  const enh = lv.enh;
  if (!enh?.applies) return null;
  const today = new Date().toISOString().slice(0, 10);
  const edit = !mine && canPlan;
  const call = async (key, fn, msg) => {
    setBusy(key);
    try { const r = await fn(); await reload(); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); } catch (e) { toast(e.message); } finally { setBusy(null); }
  };
  const waive = (on) => call('waive', () => api(`/vpe/people/${person.id}/enh/waive`, { method: 'POST', body: { level: lv.level, on } }), on ? 'Counted as done' : 'Requirements open again');
  const left = enh.total - enh.done;
  // a role with a few choices: the names in the title are what you click
  const linked = (it) => edit && it.kind === 'role' && it.options.length > 1 && it.options.length <= 5 && it.entries.length < it.need && !enh.waived;

  return (
    <div className="rq">
      <button type="button" className="rq-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>Level {lv.level} requirements</b>
        <span>{enh.waived ? 'Counted as done' : enh.complete ? 'All done' : `${enh.done} of ${enh.total} done`}</span>
        <i className={'rq-car' + (open ? ' up' : '')}>{I.chev}</i>
      </button>
      {open && <>
      <p className="rq-sub">Meeting roles{lv.enh.items.some((i) => i.kind === 'series') ? ' and an Education Series presentation' : ''}, done while on this level. They count as well as the projects.</p>
      <ul className="rq-list">
        {enh.items.map((it) => {
          const open = it.state !== 'done' || !it.entries.length;
          return (
            <li key={it.id} className={'rq-' + it.state}>
              <span className="rq-ic" aria-hidden="true">{it.state === 'done' ? I.check : it.kind === 'series' ? I.doc : I.mic}</span>
              <span className="rq-t">
                <b>{linked(it) ? it.options.map((o, i) => <span key={o.key}>{i > 0 && ' or '}<button type="button" className={'rq-opt' + ((pick[it.id] || it.options[0].key) === o.key ? ' on' : '')} aria-pressed={(pick[it.id] || it.options[0].key) === o.key} onClick={() => setPick({ ...pick, [it.id]: o.key })}>{o.label}</button></span>) : it.label}{it.need > 1 && <em className="rq-n">{it.have}/{it.need}</em>}</b>
                {(it.kind === 'series' || it.note) && <small>{it.kind === 'series' ? `Choose one of ${it.options.length}` : ''}{it.kind === 'series' && it.note ? ' · ' : ''}{it.note}</small>}
                {it.options.length > 1 && it.entries.length < it.need && !enh.waived && !linked(it) && (
                  edit && !linked(it)
                    ? <span className="rq-pick"><Select sm value="" placeholder={it.kind === 'series' ? `Choose a presentation (${it.options.length})` : `Choose a role (${it.options.length})`} options={it.options.map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => setModal({ ...it, preset: v })} /></span>
                    : <span className="rq-opts" role="group" aria-label={`${it.label} presentations`}>{it.options.map((o) => <span key={o.key} className="rq-o">{o.label}</span>)}</span>)}
                {it.entries.map((e) => (
                  <span key={e.id} className={'rq-e' + (e.done ? ' dn' : '')}>
                    <span className="rq-et">{e.done ? I.check : null}{(e.label !== it.label || !e.date) && <b>{e.label}</b>}<small>{e.date ? `${e.done ? '' : e.date < today ? 'Was scheduled ' : 'Scheduled '}${fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}{e.venue ? ` at ${e.venue}` : ''}</small></span>
                    {edit && <span className="rq-ea">
                      {!e.done && <button type="button" className="lnk" onClick={() => call(`d${e.id}`, () => api(`/vpe/enh/${e.id}/complete`, { method: 'POST', body: {} }), 'Ticked off')} disabled={busy === `d${e.id}`}>Tick off</button>}
                      {e.done && <button type="button" className="lnk" onClick={() => call(`d${e.id}`, () => api(`/vpe/enh/${e.id}/complete`, { method: 'POST', body: { done: false } }))} disabled={busy === `d${e.id}`}>Undo</button>}
                      <button type="button" className="lnk" onClick={() => call(`r${e.id}`, () => api(`/vpe/enh/${e.id}`, { method: 'DELETE' }), 'Removed')} disabled={busy === `r${e.id}`}>Remove</button>
                    </span>}
                  </span>
                ))}
              </span>
              {edit && (it.options.length === 1 || linked(it)) && it.entries.length < it.need && !enh.waived && <button type="button" className="pc-sch" onClick={() => setModal(linked(it) ? { ...it, preset: pick[it.id] || it.options[0].key } : it)}>Schedule</button>}
              {open && it.state === 'done' && enh.waived && <small className="rq-w">Counted</small>}
            </li>
          );
        })}
      </ul>
      {edit && (enh.waived
        ? <p className="rq-foot"><button type="button" className="lnk" onClick={() => waive(false)} disabled={busy === 'waive'}>Undo, track them one by one</button></p>
        : left > 0 && <p className="rq-foot"><button type="button" className="lnk" onClick={() => waive(true)} disabled={busy === 'waive'}>Already met before Brekkie? Count them all as done</button></p>)}
      </>}
      {modal && <EnhModal person={person} level={lv.level} it={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </div>
  );
}
