import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { fmtDate, longDate } from '../data.js';
import { Btn, DatePick, ErrorMsg, I, Modal, Page, Select, Seg, useToast } from '../ui.jsx';
import { PlanModal, projectOptions } from './Dashboard.jsx';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const first = (name) => name.split(' ')[0];

/* the six weeks that cover a month, Monday first */
function gridOf(y, m) {
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(y, m, 1 - lead + i));
}

const stateOf = (s, today) => (s.done ? 'k-done' : s.date < today ? 'k-due' : 'sched');
const STATE_TEXT = { 'k-done': 'Done', 'k-due': 'Date has passed', sched: 'Scheduled' };

/* a speech chip: the member's first name. Blue when scheduled, yellow at another club, green once done. */
function Chip({ s, today, onOpen }) {
  const st = stateOf(s, today);
  const drag = s.kind === 'plan' && !s.done;
  return (
    <button type="button" className={'cal-c ' + st + (s.venue ? ' away' : '')} onClick={(e) => { e.stopPropagation(); onOpen(s); }}
      draggable={drag} onDragStart={drag ? (e) => { e.dataTransfer.setData('text/plain', String(s.id)); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      title={`${s.person}${s.project ? `, ${s.project}` : ''}${s.venue ? `, at ${s.venue}` : ''}`}>
      <span className="cal-st">{st === 'k-done' ? I.check : null}</span>
      <b>{first(s.person)}</b>{s.venue ? <em>{s.venue}</em> : null}
    </button>
  );
}

/* change a planned speech: date, where, project, title */
function EditModal({ s, onClose, onSaved }) {
  const toast = useToast();
  const club = s.kind === 'club';   // a speaker slot on a meeting: its date is the meeting's
  const [date, setDate] = useState(s.date);
  const [where, setWhere] = useState(s.venue ? 'there' : 'here');
  const [venue, setVenue] = useState(s.venue || '');
  const [project, setProject] = useState(s.project_id || '');
  const [title, setTitle] = useState(s.title || '');
  const [opts, setOpts] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/vpe/people/${s.person_id}/path`).then((d) => {
      setOpts(projectOptions(d, s.project_id));
    }).catch(() => {});
  }, [s.person_id, s.project_id]);
  const save = async () => {
    if (!date) return toast('Choose a date');
    if (where === 'there' && !venue.trim()) return toast('Enter the club name');
    setBusy(true);
    try {
      if (club) await api(`/vpe/roles/${s.id}`, { method: 'PATCH', body: { project_id: project || null, speech_title: title } });
      else await api(`/me/plans/${s.id}`, { method: 'PATCH', body: { date, project_id: project || null, title, venue: where === 'there' ? venue : '' } });
      toast('Speech updated'); onSaved();
    } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Edit ${first(s.person)}'s speech`} onClose={onClose}>
      <div className="pm">
        {club
          ? <div className="pmf"><span className="fl">Meeting</span><p className="pm-fix">Meeting {s.meeting} · {longDate(s.date)}. Change the date from the meeting.</p></div>
          : <>
              <label className="pmf"><span className="fl">Date</span><DatePick value={date} onChange={setDate} /></label>
              <div className="pmf"><span className="fl">Where</span><Seg value={where} onChange={setWhere} options={[['here', 'This club'], ['there', 'Another club']]} /></div>
            </>}
        {!club && where === 'there' && <label className="pmf"><span className="fl">Club name</span><input className="inp" value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={80} /></label>}
        <label className="pmf"><span className="fl">Project</span><Select value={project} onChange={setProject} placeholder="Choose the project" searchable options={project && !opts.some((o) => o.value === project) ? [{ value: project, label: s.project || 'Current project', sub: 'Current choice' }, ...opts] : opts} /></label>
        <label className="pmf"><span className="fl">Speech title <i>(optional)</i></span><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
        <div className="pm-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>Save</Btn></div>
      </div>
    </Modal>
  );
}

/* everything about one speech, and what can be done about it */
function SpeechModal({ s, today, onClose, onChanged, onEdit }) {
  const toast = useToast();
  const st = stateOf(s, today);
  const call = async (fn, msg, stay) => { try { await fn(); toast(msg); onChanged(); if (!stay) onClose(); } catch (e) { toast(e.message); } };
  const row = (k, v) => v ? <div className="sd-r"><span>{k}</span><b>{v}</b></div> : null;
  return (
    <Modal title={s.person} onClose={onClose}>
      <div className="sd">
        <div className="sd-top">
          <span className={'sd-st ' + st}>{st === 'k-done' && I.check} {STATE_TEXT[st]}</span>
          {!s.done && (
            <span className="sd-ic">
              <button type="button" className="sp-x" onClick={() => onEdit(s)} aria-label="Edit this speech" title="Edit">{I.pencil}</button>
              <button type="button" className="sp-x" onClick={() => call(() => (s.kind === 'club' ? api(`/vpe/roles/${s.id}`, { method: 'PATCH', body: { person_id: null } }) : api(`/me/plans/${s.id}`, { method: 'DELETE' })), s.kind === 'club' ? 'Removed from the roster' : 'Removed')} aria-label={s.kind === 'club' ? 'Remove from the roster' : 'Remove this speech'} title={s.kind === 'club' ? 'Remove from the roster' : 'Remove'}>{I.bin}</button>
            </span>
          )}
        </div>
        {row('Project', s.project ? `${s.code ? `${s.code} · ` : ''}${s.project}` : 'No project chosen')}
        {row('Level', s.level ? `Level ${s.level}${s.path ? ` · ${s.path}` : ''}` : s.path)}
        {row('Speech title', s.title)}
        {row('Date', longDate(s.date))}
        {row('Where', s.venue ? s.venue : s.kind === 'club' ? `This club, meeting ${s.meeting}` : 'This club')}
        {row('Length', s.length)}
        <div className="pm-btns sd-b">
          <Link className="btn ghost" to={`/v/members/${s.person_id}`}>Open member</Link>
          {s.kind === 'club' && <Link className="btn ghost" to={`/v/meetings/${s.meeting_id}`}>Open meeting</Link>}
          {s.kind === 'plan' && s.done && s.project_id && <Btn kind="ghost" onClick={() => call(() => api(`/vpe/people/${s.person_id}/projects`, { method: 'POST', body: { project_id: s.project_id, done: false } }), 'Marked as not done', true)}>Undo done</Btn>}
          {s.kind === 'plan' && !s.done && <Btn onClick={() => call(() => api(`/vpe/plans/${s.id}/complete`, { method: 'POST' }), 'Marked as done', true)}>{I.check} Mark done</Btn>}
        </div>
      </div>
    </Modal>
  );
}

/* what is on one day */
function DayModal({ day, items, meeting, today, onClose, onAdd, onOpen }) {
  return (
    <Modal title={longDate(day)} onClose={onClose}>
      <div className="cal-day">
        {meeting && <p className="cal-mt"><Link to={`/v/meetings/${meeting.id}`}>Meeting {meeting.number}</Link>{meeting.theme ? ` · ${meeting.theme}` : ''}</p>}
        {!items.length && <p className="dt-empty">Nothing scheduled this day.</p>}
        {items.map((s) => {
          const st = stateOf(s, today);
          return (
            <button type="button" key={s.key} className={'sprow sp-btn ' + st} onClick={() => onOpen(s)}>
              <span className={'sp-dot ' + st}>{st === 'k-done' ? I.check : ''}</span>
              <span className="sp-t"><b>{s.person}</b><span>{[s.project || s.title, s.kind === 'club' ? `Meeting ${s.meeting}` : s.venue || 'This club'].filter(Boolean).join(' · ')}</span></span>
              <span className="tc">{I.chev}</span>
            </button>
          );
        })}
        <div className="pm-btns"><Btn kind="ghost" onClick={onClose}>Close</Btn><Btn onClick={onAdd}>{I.plus} Plan a speech</Btn></div>
      </div>
    </Modal>
  );
}

/* the shape of the page while it loads: the month grid, or a few day groups in the list */
function CalSkeleton({ list }) {
  if (list) return (
    <div className="cal-list" role="status" aria-label="Loading">
      {[2, 1, 3].map((n, g) => (
        <section key={g} className="cal-lg">
          <i className="sk sk-h" />
          {Array.from({ length: n }, (_, i) => <div key={i} className="sk-row"><i className="sk sk-dot" /><span><i className="sk sk-l" /><i className="sk sk-l s" /></span></div>)}
        </section>
      ))}
    </div>
  );
  return (
    <div className="cal" role="status" aria-label="Loading">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => <div key={n} className="cal-h">{n}</div>)}
      {Array.from({ length: 42 }, (_, i) => (
        <div key={i} className="cal-d sk-cell">
          <i className="sk sk-n" />
          {(i * 7 + 3) % 5 < 2 && <i className="sk sk-c" />}
          {(i * 5 + 1) % 7 === 0 && <i className="sk sk-c s" />}
        </div>
      ))}
    </div>
  );
}

export default function Calendar() {
  const toast = useToast();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [mode, setMode] = useState('month');
  const [who, setWho] = useState('all');
  const [day, setDay] = useState(null);
  const [openKey, setOpen] = useState(null);         // the speech whose details are showing, by key, so it stays current after a change
  const [editing, setEditing] = useState(null);
  const [over, setOver] = useState(null);
  const [adding, setAdding] = useState(null);       // a date to plan on, or '' for none chosen
  const days = useMemo(() => gridOf(ym.y, ym.m), [ym]);
  const from = iso(days[0]), to = iso(days[41]);
  const { data: fresh, error, reload } = useApi(`/vpe/calendar?from=${from}&to=${to}`);
  // keep showing the last month while the next one loads, so the card never collapses or flashes
  const last = useRef(null);
  if (fresh) last.current = fresh;
  const d = fresh || last.current, busy = !fresh;
  const people = useApi('/vpe/people');
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 760);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 760); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const step = (n) => setYm(({ y, m }) => { const t = new Date(y, m + n, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  if (error) return <Page root wide full><ErrorMsg error={error} /></Page>;

  const members = (people.data || []).filter((p) => p.kind === 'member' && p.status === 'active');
  const by = {};
  (d?.speeches || []).filter((s) => who === 'all' || s.person_id === who).forEach((s) => { (by[s.date] ||= []).push(s); });
  const meet = {};
  (d?.meetings || []).forEach((m) => { meet[m.date] = m; });
  const open = openKey ? (d?.speeches || []).find((x) => x.key === openKey) || null : null;
  const view = narrow ? 'list' : mode;
  const inMonth = (dt) => dt.getMonth() === ym.m;
  const prefix = `${ym.y}-${pad(ym.m + 1)}`;
  const listDays = [...new Set([...Object.keys(by), ...(who === 'all' ? Object.keys(meet) : [])])].filter((k) => k.startsWith(prefix)).sort();
  const call = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message); } };
  const drop = (e, k) => {
    e.preventDefault(); setOver(null);
    const sp = (d?.speeches || []).find((x) => x.kind === 'plan' && String(x.id) === e.dataTransfer.getData('text/plain'));
    if (sp && sp.date !== k) call(() => api(`/me/plans/${sp.id}`, { method: 'PATCH', body: { date: k } }), `Moved to ${fmtDate(k, { day: 'numeric', month: 'long' })}`);
  };
  const openSpeech = (s) => { setDay(null); setOpen(s.key); };

  return (
    <Page root wide full>
      <div className="rpage">
        <div className="rhead">
          <div>
            <p className="reyebrow">Calendar</p>
            <h1 className="rtitle">{MONTHS[ym.m]} {ym.y}</h1>
            <p className="rsub">Meetings and every scheduled project, here and at other clubs.</p>
          </div>
          <div className="rbar cal-bar">
            <div className="cal-who"><Select sm value={who} onChange={setWho} searchable label="Filter by member"
              options={[{ value: 'all', label: 'All members' }, ...members.map((p) => ({ value: p.id, label: p.name }))]} /></div>
            {!narrow && <Seg value={mode} onChange={setMode} options={[['month', 'Month'], ['list', 'List']]} />}
            <div className="cal-nav" role="group" aria-label="Change month">
              <button type="button" onClick={() => step(-1)} aria-label="Previous month">{I.back}</button>
              <button type="button" className="t" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
              <button type="button" onClick={() => step(1)} aria-label="Next month">{I.chev}</button>
            </div>
            <Btn sm onClick={() => setAdding('')}>{I.plus} Plan a speech</Btn>
          </div>
        </div>

        <div className={'cal-card' + (busy && d ? ' busy' : '')}>
        {d?.pending?.filter((s) => who === 'all' || s.person_id === who).length > 0 && (
          <section className="cal-pend">
            <h2>Did these happen?</h2>
            <div className="cal-pl">
            {d.pending.filter((s) => who === 'all' || s.person_id === who).map((s) => (
              <div key={s.id} className="sprow">
                <span className="sp-t"><b>{s.person}</b><span>{[s.project || s.title, s.venue || 'This club', longDate(s.date)].filter(Boolean).join(' · ')}</span></span>
                <Btn sm onClick={() => call(() => api(`/vpe/plans/${s.id}/complete`, { method: 'POST' }), 'Marked as done')}>Mark done</Btn>
                <Btn sm kind="ghost" onClick={() => call(() => api(`/me/plans/${s.id}`, { method: 'DELETE' }), 'Removed')}>Remove</Btn>
              </div>
            ))}
            </div>
          </section>
        )}

        {!d ? <CalSkeleton list={view !== 'month'} /> : view === 'month' ? (
          <div className="cal" role="grid" aria-label={`${MONTHS[ym.m]} ${ym.y}`}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => <div key={n} className="cal-h" role="columnheader">{n}</div>)}
            {days.map((dt) => {
              const k = iso(dt), items = by[k] || [], mt = meet[k];
              return (
                <div key={k} role="gridcell" tabIndex={0} className={'cal-d' + (inMonth(dt) ? '' : ' out') + (k === d.today ? ' today' : '') + (mt ? ' mtg' : '') + (over === k ? ' drop' : '')}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== k) setOver(k); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }} onDrop={(e) => drop(e, k)}
                  onClick={() => setDay(k)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDay(k); } }}
                  aria-label={`${fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}${mt ? `, meeting ${mt.number}` : ''}${items.length ? `, ${items.length} speeches` : ''}`}>
                  <span className="cal-n2">{dt.getDate()}</span>
                  {mt && <span className="cal-m">Meeting {mt.number}</span>}
                  <span className="cal-cs">
                    {items.slice(0, 3).map((s) => <Chip key={s.key} s={s} today={d.today} onOpen={openSpeech} />)}
                    {items.length > 3 && <span className="cal-more">+{items.length - 3} more</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cal-list">
            {!listDays.length && <p className="dt-empty">Nothing scheduled in {MONTHS[ym.m]}{who !== 'all' ? ' for this member' : ''}.</p>}
            {listDays.map((k) => (
              <section key={k} className={'cal-lg' + (k === d.today ? ' today' : '')}>
                <header><b>{fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}</b>{meet[k] && <Link to={`/v/meetings/${meet[k].id}`} className="cal-m">Meeting {meet[k].number}</Link>}</header>
                {(by[k] || []).map((s) => {
                  const st = stateOf(s, d.today);
                  return (
                    <button type="button" key={s.key} className={'sprow sp-btn ' + st} onClick={() => setOpen(s.key)}>
                      <span className={'sp-dot ' + st}>{st === 'k-done' ? I.check : ''}</span>
                      <span className="sp-t"><b>{s.person}</b><span>{s.project || s.title || 'Speech'}</span></span>
                      {s.venue && <span className="sp-w away">{s.venue}</span>}
                      <span className="tc">{I.chev}</span>
                    </button>
                  );
                })}
                {!(by[k] || []).length && <p className="cal-none">No speeches yet</p>}
              </section>
            ))}
          </div>
        )}
        </div>
      </div>
      {day && <DayModal day={day} items={by[day] || []} meeting={meet[day]} today={d.today} onClose={() => setDay(null)} onOpen={openSpeech} onAdd={() => { setAdding(day); setDay(null); }} />}
      {open && <SpeechModal s={open} today={d.today} onClose={() => setOpen(null)} onChanged={reload} onEdit={(x) => { setOpen(null); setEditing(x); }} />}
      {editing && <EditModal s={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {adding !== null && <PlanModal people={members} initialDate={adding || undefined} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }} />}
    </Page>
  );
}
