import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { fmtDate, longDate } from '../data.js';
import { Btn, DatePick, ErrorMsg, I, Loading, Modal, Page, Select, Seg, useToast } from '../ui.jsx';

/* Plan a speech: at this club or another. The VPE picks the member; a member plans their own. */
export function PlanModal({ people, meId, preset, initialDate, onClose, onSaved }) {
  const toast = useToast();
  const [who, setWho] = useState(preset?.person || meId || '');
  const [date, setDate] = useState(initialDate || '');
  const [where, setWhere] = useState('here');
  const [venue, setVenue] = useState('');
  const [project, setProject] = useState(preset?.project || '');
  const [title, setTitle] = useState('');
  const [opts, setOpts] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOpts([]);
    if (!preset?.project) setProject('');
    if (!who || preset?.project) return;
    api(who === meId ? '/me/path' : `/vpe/people/${who}/path`).then((d) => {
      // every project still to do, from their current level up, that is not already scheduled
      setOpts(d.levels.filter((l) => l.level >= (d.current ?? 0)).flatMap((l) => l.projects.filter((p) => !p.done && !p.sched)
        .map((p) => ({ value: p.id, label: p.code ? `${p.code} ${p.name}` : p.name, sub: `Level ${l.level} · ${p.kind === 'required' ? 'Required' : 'Elective'}` }))));
    }).catch(() => {});
  }, [who, meId, preset]);
  const save = async () => {
    if (!who) return toast('Choose who is speaking');
    if (!date) return toast('Choose a date');
    if (where === 'there' && !venue.trim()) return toast('Enter the club name');
    if (!preset?.project && opts.length && !project) return toast('Choose the project, so it counts towards their level');
    setBusy(true);
    try {
      const body = { date, project_id: project || null, title, venue: where === 'there' ? venue : '' };
      await api(who === meId ? '/me/plans' : `/vpe/people/${who}/plans`, { method: 'POST', body });
      toast('Speech added'); onSaved();
    } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <Modal title={preset?.label ? `Schedule ${preset.label}` : 'Plan a speech'} onClose={onClose}>
      <div className="pm">
        {people && !preset?.person && <label className="pmf"><span className="fl">Who is speaking</span><Select value={who} onChange={setWho} placeholder="Choose a member" searchable options={people.map((p) => ({ value: p.id, label: p.name }))} /></label>}
        <label className="pmf"><span className="fl">Date</span><DatePick value={date} onChange={setDate} /></label>
        <div className="pmf"><span className="fl">Where</span><Seg value={where} onChange={setWhere} options={[['here', 'This club'], ['there', 'Another club']]} /></div>
        {where === 'there' && <label className="pmf"><span className="fl">Club name</span><input className="inp" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="For example, Sunrise Toastmasters" maxLength={80} /></label>}
        {!preset?.project && <label className="pmf"><span className="fl">Project</span><Select value={project} onChange={setProject} placeholder={who ? (opts.length ? 'Choose the project' : 'No path set, so no project') : 'Choose who is speaking first'} disabled={!who} searchable options={opts} /></label>}
        <label className="pmf"><span className="fl">Speech title <i>(optional)</i></span><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
        <div className="pm-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>{preset?.project ? 'Schedule' : 'Add speech'}</Btn></div>
      </div>
    </Modal>
  );
}

/* a row for one planned or scheduled speech */
export function SpeechRow({ s, who = true, onRemove }) {
  const d = new Date(s.date + 'T12:00:00');
  return (
    <div className="sprow">
      <span className="calbox"><small>{d.toLocaleDateString('en-GB', { month: 'short' })}</small><b>{d.getDate()}</b></span>
      <span className="sp-t">
        <b>{who ? s.person : (s.project || s.title || 'Speech')}</b>
        <span>{[who ? (s.project || s.title) : s.title && s.project ? s.title : '', fmtDate(s.date, { weekday: 'long' })].filter(Boolean).join(' · ')}</span>
      </span>
      <span className={'sp-w' + (s.venue ? ' away' : '')}>{s.venue || (s.kind === 'club' ? `Meeting ${s.meeting}` : 'This club')}</span>
      {onRemove && s.kind !== 'club' && <button type="button" className="sp-x" onClick={onRemove} aria-label="Remove this speech">{I.close}</button>}
    </div>
  );
}

const GROUPS = [
  { key: 'l1', title: 'Level 1 awards', levels: [1], goals: [1] },
  { key: 'l2', title: 'Level 2 awards', levels: [2], goals: [2, 3] },
  { key: 'l3', title: 'Level 3 awards', levels: [3], goals: [4] },
  { key: 'l45', title: 'Level 4 or 5 awards', levels: [4, 5], goals: [5, 6] },
];
const SHOW_UPCOMING = false;   // the upcoming speeches list is switched off for now
const RANK = { done: 0, forecast: 1, open: 2 };
const short = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });

/* where a date falls in the program year, 0 to 1 */
const at = (iso, y) => Math.min(1, Math.max(0, (new Date(iso) - new Date(y.start)) / (new Date(y.end) - new Date(y.start))));

/* one member at one level: a tight row that opens to every project in it, with its date or a button to schedule it */
function Row({ m, lv, e, d, rank, onSchedule, onDone, onUndo }) {
  const [open, setOpen] = useState(false);
  const when = e.state === 'done' ? `Earned ${short(e.date)}` : e.state === 'forecast' ? `Completes ${short(e.date)}${e.date > d.year.end ? ' (next year)' : ''}` : e.due ? `${e.due} to confirm` : `${e.unscheduled} to schedule`;
  const can = e.items.length > 0;   // finished levels open too, to look back at what was done and when
  return (
    <li className={'lvrow lv-' + e.state + (open ? ' is-open' : '')}>
      <button type="button" className="lvr-h" aria-expanded={can ? open : undefined} disabled={!can} onClick={() => setOpen(!open)}>
        <span className={'lvr-rk' + (rank ? ' on' : '')} title={rank ? `Number ${rank} to finish towards the goal` : 'Not needed for the goal yet'}>{rank || ''}</span>
        <span className="lvr-n"><b>{m.name}</b>{lv > 3 && <small>{lv === 5 ? 'Level 5 · Path completion' : `Level ${lv}`}</small>}</span>
        <span className="lvr-seg" aria-label={`${e.done} of ${e.total} projects done`}>
          {Array.from({ length: e.total }, (_, i) => <i key={i} className={i < e.done ? 'on' : ''} />)}
          <small>{e.done} of {e.total}</small>
        </span>
        <span className={'lvr-when w-' + (e.due ? 'due' : e.state)}>{when}</span>
        <span className={'lvr-car' + (open ? ' up' : '')}>{can && I.chev}</span>
      </button>
      {can && open && (
        <ul className="lvr-items">
          {e.items.map((it, i) => (
            <li key={i} className={'it it-' + it.state}>
              <span className="it-s" aria-hidden="true">{it.state === 'done' ? I.check : ''}</span>
              <span className="it-t"><b>{it.code || 'Elective'}</b><span>{it.id ? it.name : 'Choose an elective'}</span></span>
              <span className="it-d">
                {it.state === 'done' ? <><em>Done {short(it.date)}{it.source === 'evaluation' ? ` · meeting ${it.meeting}` : it.venue ? ` · ${it.venue}` : ''}</em>{it.source === 'manual' && <button type="button" className="ghost" onClick={() => onUndo(m, it)}>Undo</button>}</>
                  : it.state === 'sched' || it.state === 'due' ? <><em>{it.state === 'due' ? 'Was ' : ''}{short(it.date)}{it.venue ? ` · ${it.venue}` : ''}</em><button type="button" className={it.state === 'due' ? 'go' : ''} onClick={() => onDone(m, it, lv)}>{I.check} Mark done</button></>
                  : it.id ? <button type="button" onClick={() => onSchedule(m, it)}>Schedule</button>
                  : <Link to={`/v/members/${m.id}`}>Choose</Link>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Dashboard() {
  const toast = useToast();
  const { data: d, error, reload } = useApi('/vpe/dashboard');
  const [plan, setPlan] = useState(null);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState(null);
  const [all, setAll] = useState(false);
  if (error) return <Page title="Dashboard" root wide full><ErrorMsg error={error} /></Page>;
  if (!d) return <Page title="Dashboard" root wide full><Loading /></Page>;
  const goal = (n) => d.goals.find((g) => g.n === n);
  const groups = GROUPS.map((g) => {
    const gs = g.goals.map(goal), need = gs.reduce((a, x) => a + x.need, 0), have = gs.reduce((a, x) => a + x.have, 0);
    const status = gs.every((x) => x.status === 'done') ? 'done' : gs.some((x) => x.status === 'short') ? 'short' : gs.some((x) => x.status === 'late') ? 'late' : 'on';
    const date = gs.at(-1).date;
    // the order they finish in, for the people the goals are counting on
    const rank = new Map(gs.flatMap((x) => x.people).map((p, i) => [`${p.id}-${p.level}`, i + 1]));
    const rows = d.members.flatMap((m) => g.levels.filter((lv) => m.levels[lv] && m.levels[lv].state !== 'earlier').map((lv) => ({ m, lv, e: m.levels[lv], rank: rank.get(`${m.id}-${lv}`) || 0 })))
      .sort((a, b) => (RANK[a.e.state] - RANK[b.e.state]) || (a.e.date || '').localeCompare(b.e.date || '') || (a.e.unscheduled - b.e.unscheduled));
    const earlier = d.members.filter((m) => g.levels.some((lv) => m.levels[lv]?.state === 'earlier')).length;
    return { ...g, gs, need, have, status, date, rows, earlier };
  });
  const sel = groups.find((g) => g.key === pick) || groups.find((g) => g.status !== 'done') || groups[0];
  const rows = all ? sel.rows : sel.rows.slice(0, 8);
  /* done on the date it was scheduled for (never in the future) */
  const markDone = async (m, it, lv) => {
    try {
      const r = await api(`/vpe/people/${m.id}/projects`, { method: 'POST', body: { project_id: it.id, done: true, date: it.date <= d.today ? it.date : d.today } });
      const l = r.levels.find((x) => x.level === lv);
      toast(l?.complete ? `${m.name} finished Level ${lv}` : `${it.code || it.name} done for ${m.name.split(' ')[0]}`); reload();
    } catch (e) { toast(e.message); }
  };
  const undo = async (m, it) => { try { await api(`/vpe/people/${m.id}/projects`, { method: 'POST', body: { project_id: it.id, done: false } }); toast('Marked as not done'); reload(); } catch (e) { toast(e.message); } };
  const call = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message); } };
  return (
    <Page root wide full>
      <div className="rpage">
      <div className="rhead">
        <div>
          <p className="reyebrow">Distinguished Club Program {d.year.label} · {d.year.days_left} days left</p>
          <h1 className="rtitle">Dashboard</h1>
          <p className="rsub">Pick a level to see who is working on it and which projects are scheduled.</p>
        </div>
      </div>

      <div className="lvtiles" role="tablist" aria-label="Levels">
        {groups.map((g) => (
          <button type="button" key={g.key} role="tab" aria-selected={g.key === sel.key} className={'lvtile st-' + g.status + (g.key === sel.key ? ' sel' : '')} onClick={() => { setPick(g.key); setAll(false); }}>
            <small>{g.goals.length > 1 ? `Goals ${g.goals.join(' and ')}` : `Goal ${g.goals[0]}`}</small>
            <strong>{g.title}</strong>
            <b className="lvt-n">{g.have}<em> of {g.need}</em></b>
            <span className={'lvt-fc st-' + g.status}>
              {g.status === 'done' ? <><label>Status</label><b>Met</b></>
                : g.status === 'short' ? <><label>Forecast</label><b className="lvt-nt">Not enough scheduled yet</b></>
                : <><label>On track for</label><b>{longDate(g.date)}</b>{g.status === 'late' && <small>After 30 June</small>}</>}
            </span>
          </button>
        ))}
      </div>

      <section className="lvpanel">
        <div className="ph2">
          <div>
            <h2>Who is working on {sel.title.replace(' awards', '')}</h2>
            <p>{sel.gs.map((g) => `Goal ${g.n}: ${g.label}`).join('. ')}. Earliest first. Numbers show the order they finish towards the goal.</p>
          </div>

        </div>
        {!sel.rows.length && <p className="dt-empty">Nobody is working on this level yet. Set a path for more members and they show up here.</p>}
        <ul className="lvrows">{rows.map((r) => <Row key={r.m.id + '-' + r.lv} {...r} d={d} onSchedule={(m, it) => setPlan({ person: m.id, project: it.id, label: it.code || it.name })} onDone={markDone} onUndo={undo} />)}</ul>
        {sel.rows.length > 8 && <button type="button" className="lnk" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${sel.rows.length}`}</button>}
      </section>

      {SHOW_UPCOMING && (
      <section className="panel">
        <div className="ph2">
          <div><h2>Upcoming speeches</h2><p>On the roster at this club, and planned by members here or at other clubs.</p></div>
          <Btn sm onClick={() => setAdding(true)}>{I.plus} Plan a speech</Btn>
        </div>
        {!d.upcoming.length && <p className="dt-empty">Nothing scheduled yet. Members can plan their own speeches from their home page.</p>}
        <div className="splist">{d.upcoming.map((s, i) => <SpeechRow key={i} s={s} onRemove={s.id ? () => call(() => api(`/me/plans/${s.id}`, { method: 'DELETE' }), 'Removed') : null} />)}</div>
        {d.past.length > 0 && (
          <div className="sp-past">
            <h3>Did these happen?</h3>
            {d.past.map((s) => (
              <div key={s.id} className="sprow">
                <span className="sp-t"><b>{s.person}</b><span>{[s.project || s.title, s.venue || 'This club', longDate(s.date)].filter(Boolean).join(' · ')}</span></span>
                <Btn sm onClick={() => call(() => api(`/vpe/plans/${s.id}/complete`, { method: 'POST' }), 'Marked as done')}>Mark done</Btn>
                <Btn sm kind="ghost" onClick={() => call(() => api(`/me/plans/${s.id}`, { method: 'DELETE' }), 'Removed')}>Remove</Btn>
              </div>
            ))}
          </div>
        )}
      </section>
      )}
      {plan && <PlanModal preset={plan} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); reload(); }} />}
      {adding && <PlanModal people={d.members} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      </div>
    </Page>
  );
}
