import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { fmtDate, longDate, partOf } from '../data.js';
import { printEval } from '../EvalSheet.jsx';
import { Btn, DatePick, ErrorMsg, I, SkPage, Modal, Page, PartSelect, Select, Seg, useToast } from '../ui.jsx';

/* Plan a speech: at this club or another. The VPE picks the member; a member plans their own. */
/* every project on a member's path for the project picker: their next one first, then the rest of the level they are on and above,
   with earlier levels last. Finished and already scheduled projects stay in the list, greyed, so the whole path is visible. */
export function projectOptions(d, keepId) {
  const cur = d.current ?? 0;
  const levels = [...d.levels].sort((a, b) => ((a.level >= cur ? 0 : 1) - (b.level >= cur ? 0 : 1)) || a.level - b.level);
  const groups = [];
  for (const l of levels) {
    const group = `Level ${l.level}${l.title ? ` · ${l.title}` : ''}`, on = [], off = [];
    for (const p of l.projects) {
      const label = p.code ? `${p.code} ${p.name}` : p.name;
      if (p.done) off.push({ value: p.id, label, group, disabled: true, sub: p.done.date ? `Done ${fmtDate(p.done.date, { day: 'numeric', month: 'short' })}` : 'Done before Brekkie' });
      else if (p.sched && p.id !== keepId) off.push({ value: p.id, label, group, disabled: true, sub: `Scheduled ${fmtDate(p.sched.date, { day: 'numeric', month: 'short' })}` });
      else on.push({ value: p.id, label, group, sub: p.kind === 'required' ? 'Required' : 'Elective', req: p.kind === 'required', parts: p.parts, next_part: p.next_part });
    }
    // electives not picked yet can be scheduled too while the level has room; scheduling one adds it to their electives
    if (l.to_pick > 0) for (const p of l.options || []) on.push({ value: p.id, label: p.name, group, sub: `Elective · ${p.length}` });
    groups.push([...on, ...off]);
  }
  // finished or fully scheduled levels go last, and the first project still open is their next one
  groups.sort((a, b) => (a.some((o) => !o.disabled) ? 0 : 1) - (b.some((o) => !o.disabled) ? 0 : 1));
  const out = groups.flat();
  const nx = out.find((o) => !o.disabled && o.req);
  if (nx) nx.tag = 'Next up';
  return out;
}

export function PlanModal({ people, meId, preset, initialDate, onClose, onSaved }) {
  const toast = useToast();
  const [who, setWho] = useState(preset?.person || meId || '');
  const [date, setDate] = useState(initialDate || '');
  const [where, setWhere] = useState('here');
  const [venue, setVenue] = useState('');
  const [project, setProject] = useState(preset?.project || '');
  const [part, setPart] = useState(preset?.part || 1);
  const [title, setTitle] = useState('');
  const [opts, setOpts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState([]);
  useEffect(() => { api('/projects').then(setProjects).catch(() => {}); }, []);
  useEffect(() => {
    setOpts([]);
    if (!preset?.project) setProject('');
    if (!who || preset?.project) return;
    api(who === meId ? '/me/path' : `/vpe/people/${who}/path`).then((d) => {
      const list = projectOptions(d);
      setOpts(list);
      const nx = list.find((o) => o.tag && !o.disabled);   // the roster fills in the next project, so start there
      if (nx) { setProject(nx.value); setPart(nx.next_part || 1); }
    }).catch(() => {});
  }, [who, meId, preset]);
  const save = async () => {
    if (!who) return toast('Choose who is speaking');
    if (!date) return toast('Choose a date');
    if (where === 'there' && !venue.trim()) return toast('Enter the club name');
    if (!preset?.project && opts.some((o) => !o.disabled) && !project) return toast('Choose the project, so it counts towards their level');
    setBusy(true);
    try {
      const body = { date, project_id: project || null, part, title, venue: where === 'there' ? venue : '' };
      await api(who === meId ? '/me/plans' : `/vpe/people/${who}/plans`, { method: 'POST', body });
      toast('Speech added'); onSaved();
    } catch (e) { toast(e.message); setBusy(false); }
  };
  const pj = partOf(projects.find((x) => x.id === Number(project)), part);
  const mm = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const memberName = (people || []).find((p) => p.id === who)?.name || preset?.name || '';
  const form = () => printEval({
    form_title: pj.form_title, project: pj.name, member: memberName, date: date || '', by: '', length_text: pj.length_text, title,
    purpose: pj.purpose || [], notes: pj.notes || pj.overview || '', about: pj.about || [], ratings: [], comments: [], excelled: '', work: '', challenge: '',
  });
  return (
    <Modal title="Schedule a speech" onClose={onClose}>
      <div className="pm">
        {people && !preset?.person && <label className="pmf"><span className="fl">Who is speaking</span><Select value={who} onChange={setWho} placeholder="Choose a member" searchable options={people.map((p) => ({ value: p.id, label: p.name }))} /></label>}
        {!preset?.project && <label className="pmf"><span className="fl">Project</span><Select value={project} onChange={(v) => { setProject(v); setPart(opts.find((o) => o.value === v)?.next_part || 1); }} placeholder={who ? (opts.length ? 'Choose the project' : 'No path set, so no project') : 'Choose who is speaking first'} disabled={!who} searchable options={opts} /></label>}
        {!preset?.project && <PartSelect sm={false} parts={opts.find((o) => o.value === project)?.parts} value={part} onChange={setPart} />}
        {pj && (
          <div className="pj">
            <div className="pj-h">
              {preset?.label && <span className="pj-c">{preset.label}</span>}
              <b>{pj.name}</b>{pj.part_label && <span className="pj-c">Part {pj.part_n} · {pj.part_label}</span>}
            </div>
            <div className="pj-k">
              {!preset?.label && <span>Level {pj.level}</span>}
              {pj.path && <span className="p">{pj.path}</span>}
              {pj.length_text && <span>{I.clock} {pj.length_text}</span>}
            </div>
            {pj.green != null && (
              <div className="pj-t" aria-label="Timing">
                <span><i className="g" />Green <b>{mm(pj.green)}</b></span>
                <span><i className="y" />Yellow <b>{mm(pj.yellow)}</b></span>
                <span><i className="r" />Red <b>{mm(pj.red)}</b></span>
              </div>
            )}
            <button type="button" className="pj-dl" onClick={form}>{I.dl} Download evaluation form</button>
          </div>
        )}
        <div className="pm-row">
          <label className="pmf"><span className="fl">Date</span><DatePick value={date} onChange={setDate} /></label>
          <div className="pmf"><span className="fl">Where</span><Seg value={where} onChange={setWhere} options={[['here', 'This club'], ['there', 'Another club']]} /></div>
        </div>
        {where === 'there' && <label className="pmf"><span className="fl">Club name</span><input className="inp" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="For example, Sunrise Toastmasters" maxLength={80} /></label>}
        <label className="pmf"><span className="fl">Speech title <i>(optional)</i></span><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
        <div className="pm-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>Schedule</Btn></div>
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
  const nav = useNavigate();
  const [pick, setPick] = useState(null);   // the project whose details are showing
  const when = e.state === 'done' ? `Earned ${short(e.date)}` : e.state === 'forecast' ? `Completes ${short(e.date)}${e.date > d.year.end ? ' (next year)' : ''}` : e.due ? `${e.due} to confirm` : `${e.unscheduled} to schedule`;
  const can = e.items.length > 0;   // finished levels open too, to look back at what was done and when
  return (
    <li className={'dv-row lv-' + e.state + (open ? ' is-open' : '')}>
      <div role="button" tabIndex={can ? 0 : -1} className="dv-h" aria-expanded={can ? open : undefined} aria-disabled={!can} onClick={() => can && setOpen(!open)}
        onKeyDown={(e) => { if (can && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpen(!open); } }}>
        <span className="dv-rk" title={rank ? `Number ${rank} to finish towards the goal` : undefined}>{rank || ''}</span>
        <span className="dv-n"><Link className="dv-nl" to={`/v/members/${m.id}`} onClick={(e) => e.stopPropagation()} title={`Open ${m.name}`}><b>{m.name}</b></Link>{lv > 3 && <small title={lv === 5 ? 'Path completion' : undefined}>{`Level ${lv}`}</small>}</span>
        <span className="dv-seg" aria-label={`${e.done} of ${e.total} projects done`}>
          {Array.from({ length: e.total }, (_, i) => <i key={i} className={i < e.done ? 'on' : ''} />)}
          <small>{e.done} of {e.total}</small>
        </span>
        <span className={'dv-when w-' + (e.due ? 'due' : e.state)}>{when}</span>
        <span className={'dv-car' + (open ? ' up' : '')}>{can && I.chev}</span>
      </div>
      {can && open && (
        <ul className="lvr-items">
          {e.items.map((it, i) => {
            const stop = (fn) => (ev) => { ev.stopPropagation(); fn(); };
            const shown = pick === i;
            const status = it.state === 'done' ? 'Done' : it.state === 'sched' ? 'Scheduled' : it.state === 'due' ? 'Date has passed, not marked done yet' : it.id ? 'Not scheduled yet' : 'Elective not chosen yet';
            const where = it.state === 'done' ? (it.source === 'evaluation' ? `This club, meeting ${it.meeting}` : it.venue || 'This club') : (it.state === 'sched' || it.state === 'due') ? (it.venue || 'This club') : '';
            return (
              <li key={i} className="it-wrap">
                <div role="button" tabIndex={0} aria-expanded={it.id ? shown : undefined} className={'it it-' + it.state + (shown ? ' it-on' : '')} onClick={() => (it.id ? setPick(shown ? null : i) : nav(`/v/members/${m.id}?level=${lv}`))}
                  onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); it.id ? setPick(shown ? null : i) : nav(`/v/members/${m.id}?level=${lv}`); } }}>
                  <span className="it-s" aria-hidden="true">{it.state === 'done' ? I.check : ''}</span>
                  <span className="it-t"><b>{it.code || 'Elective'}</b><span>{it.id ? it.name : 'Choose an elective'}</span></span>
                  <span className="it-d">
                    {it.state === 'done' ? <><em>{it.source === 'prior' ? 'Done before Brekkie' : <>Done {short(it.date)}</>}{it.source === 'evaluation' ? ` · meeting ${it.meeting}` : it.venue ? ` · ${it.venue}` : ''}</em>{it.source === 'manual' && <button type="button" className="ghost" onClick={stop(() => onUndo(m, it))}>Undo</button>}</>
                      : it.state === 'sched' || it.state === 'due' ? <><em>{it.state === 'due' ? 'Was ' : ''}{short(it.date)}{it.venue ? ` · ${it.venue}` : ''}</em><button type="button" className={it.state === 'due' ? 'go' : ''} onClick={stop(() => onDone(m, it, lv))}>{I.check} Mark done</button></>
                      : it.id ? <button type="button" onClick={stop(() => onSchedule(m, it))}>Schedule</button>
                      : <Link to={`/v/members/${m.id}?level=${lv}`} onClick={(ev) => ev.stopPropagation()}>Choose</Link>}
                  </span>
                </div>
                {shown && (
                  <dl className="it-more">
                    <div><dt>Project</dt><dd>{it.code ? `${it.code} · ` : ''}{it.name}</dd></div>
                    <div><dt>Status</dt><dd>{status}</dd></div>
                    {it.date && <div><dt>Date</dt><dd>{longDate(it.date)}</dd></div>}
                    {where && <div><dt>Where</dt><dd>{where}</dd></div>}
                    {it.length && <div><dt>Length</dt><dd>{it.length}</dd></div>}
                    {it.kind && <div><dt>Type</dt><dd>{it.kind === 'required' ? 'Required' : 'Elective'}</dd></div>}
                    <Link className="it-go" to={`/v/members/${m.id}`}>Open {m.name.split(' ')[0]}'s page {I.chev}</Link>
                  </dl>
                )}
              </li>
            );
          })}
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
  if (!d) return <Page title="Dashboard" root wide full><SkPage tabs={5} avatar rows={6} /></Page>;
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
          <p className="reyebrow">Distinguished Club Program {d.year.label}</p>
          <h1 className="rtitle">Dashboard</h1>
          <p className="rsub">Pick a level to see who is working on it and which projects are scheduled.</p>
        </div>
      </div>

      <div className="dv-card">
        <div className="dv-tabs" role="tablist" aria-label="Levels">
          {groups.map((g) => (
            <button type="button" key={g.key} role="tab" aria-selected={g.key === sel.key} className={'dv-tab st-' + g.status + (g.key === sel.key ? ' sel' : '')} onClick={() => { setPick(g.key); setAll(false); }}>
              <span className="dv-tl">{g.title.replace(' awards', '')}</span>
              <span className="dv-tn">{g.have}<em> of {g.need}</em></span>
              <span className="dv-tf">{g.status === 'done' ? 'Goal met' : g.status === 'short' ? 'Not enough scheduled yet' : <>On track for <b>{longDate(g.date)}</b>{g.status === 'late' ? ' (after 30 June)' : ''}</>}</span>
            </button>
          ))}
        </div>
        <div className="dv-bar">
          <div className="dv-goals">{sel.gs.map((g) => <span key={g.n} className="dv-g"><i>Goal {g.n}</i>{g.label}</span>)}</div>
          <span>Numbers show the order they finish</span>
        </div>
        {!sel.rows.length && <p className="dt-empty dv-empty">Nobody is working on this level yet. Set a path for more members and they show up here.</p>}
        <ul className="dv-rows">{rows.map((r) => <Row key={r.m.id + '-' + r.lv} {...r} d={d} onSchedule={(m, it) => setPlan({ person: m.id, name: m.name, project: it.id, label: it.code })} onDone={markDone} onUndo={undo} />)}</ul>
        {sel.rows.length > 8 && <button type="button" className="dv-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${sel.rows.length}`}</button>}
      </div>

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
