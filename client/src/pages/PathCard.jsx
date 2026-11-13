import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate } from '../data.js';
import { Btn, I, SkPath, PathPick, Select, useToast } from '../ui.jsx';
import { PlanModal } from './Dashboard.jsx';
import Requirements from './Requirements.jsx';

/* Where a member is on their path: the path and a timeline of levels. The detail (next project, what is finished,
   electives) stays folded away until the VPE opens it. The VPE marks a project done, because being on the agenda
   does not mean the speech was given. */
export default function PathCard({ person, mine = false, initial = null, canPlan = true }) {
  const toast = useToast();
  const url = mine ? '/me/path' : `/vpe/people/${person.id}/path`;
  // the page that shows this card already fetched the progress, so there is only one loading stage
  const [data, setData] = useState(initial);
  const [err, setErr] = useState(null);
  const reload = async () => { try { setData(await api(url)); setErr(null); } catch (e) { setErr(e); } };
  useEffect(() => { if (initial) setData(initial); else reload(); }, [url, initial]); // eslint-disable-line
  const prog = { data, loading: !data && !err, reload };
  // the catalogue is only needed to change the path, so it loads then
  const [catalog, setCatalog] = useState(null);
  const cat = { data: catalog };
  const loadCatalog = () => { if (!catalog) api('/pathways').then(setCatalog).catch(() => {}); };
  const [pl, setPl] = useState({ path_name: person.path_name || null, path_level: person.path_level ?? null });
  const [qs] = useSearchParams();
  const want = Number(qs.get('level')) || null;   // a link can ask for one level to be open, such as electives still to choose
  const card = useRef(null);
  const [view, setView] = useState(want);
  const [busy, setBusy] = useState(null);
  const [plan, setPlan] = useState(null);
  const unplan = (id) => call(id, () => api(`/me/plans/${id}`, { method: 'DELETE' }), 'Unscheduled');
  // a speech scheduled at this club on a meeting date is a roster slot: unscheduling empties the slot
  const unslot = (id) => call(id, () => api(`/vpe/roles/${id}`, { method: 'PATCH', body: { person_id: null, project_id: null, speech_title: '' } }), 'Taken off the roster');
  const [open, setOpen] = useState(!!want);
  const [edit, setEditRaw] = useState(false);
  const setEdit = setEditRaw;
  useEffect(() => { if (edit || (data && !data.path)) loadCatalog(); }, [edit, data]); // eslint-disable-line

  const d = prog.data;
  useEffect(() => { if (want && d) card.current?.scrollIntoView({ block: 'center' }); }, [!!d]); // eslint-disable-line
  useEffect(() => { if (d) setView((v) => (d.levels.some((l) => l.level === v) ? v : d.current)); }, [d]);

  const savePath = async (n) => {
    setPl(n);
    try { await api(`/vpe/people/${person.id}`, { method: 'PATCH', body: n }); setView(null); await prog.reload(); } catch (e) { toast(e.message); }
  };
  const call = async (id, fn, msg) => {
    setBusy(id);
    try { await fn(); await prog.reload(); if (msg) toast(msg); } catch (e) { toast(e.message); } finally { setBusy(null); }
  };
  // a project made of parts is marked one part at a time: `part` is the one the VPE picked on its chips
  const mark = (p, done, part, at) => call(p.id, () => api(`/vpe/people/${person.id}/projects`, { method: 'POST', body: { project_id: p.id, done, ...(part ? { part } : {}), ...(done && at && at.date <= new Date().toISOString().slice(0, 10) ? { date: at.date } : {}) } }), done ? `${p.name}${part ? `, part ${part},` : ''} marked as done` : 'Marked as not done');
  const [sel, setSel] = useState({});   // the part picked on each project that has parts
  const elective = (id, on) => call(id, () => api(`/vpe/people/${person.id}/electives`, { method: 'POST', body: { project_id: id, on } }), on ? 'Elective added' : 'Elective removed');

  const head = (
    <>
      <div className="pc-h">
        <div><small>Pathways</small><h2>{d?.path || 'No path yet'}</h2></div>
        {!mine && <button type="button" className="pc-chg" onClick={() => setEdit(!edit)} aria-expanded={edit}>{edit ? 'Done' : d?.path ? 'Change path' : 'Choose a path'}</button>}
      </div>
      {!mine && (edit || (d && !d.path)) && <div className="pc-pick"><PathPick catalog={cat.data?.paths || []} pathName={pl.path_name} level={pl.path_level} onChange={savePath} /></div>}
    </>
  );
  if (prog.loading || !d) return <section className="pcard2">{head}<SkPath /></section>;
  if (!d.path) return <section className="pcard2">{head}<p className="pc-empty">{mine ? 'Your VPE sets your path. Once it is set, your next project shows up here.' : 'Choose a path and level. When this member is put in a speaker slot, their path and next project fill in on their own.'}</p></section>;

  const lv = d.levels.find((l) => l.level === view) || d.levels.find((l) => l.level === d.current) || d.levels[0];
  const pct = lv && lv.required_total ? Math.round((lv.required_done / lv.required_total) * 100) : 0;
  const reqs = lv ? lv.projects.filter((p) => p.kind === 'required') : [];
  const els = lv ? lv.projects.filter((p) => p.kind === 'elective') : [];

  const row = (p) => {
    const isNext = d.next?.id === p.id && lv.level === d.current;
    // for a project with parts, everything below (scheduled, done, Schedule, Mark done) is about the part picked on the chips
    const multi = !!p.parts && !p.done;
    const pn = multi ? (sel[p.id] ?? p.next_part ?? p.parts[0].n) : null;
    const cur = multi ? p.parts.find((x) => x.n === pn) : p;
    const evalPart = multi && cur.kind === 'evaluator';
    const today = new Date().toISOString().slice(0, 10);
    return (
      <li key={p.id} className={(p.done ? 'is-done ' : '') + (isNext ? 'is-next' : '')}>
        <span className="pc-ic">{p.done ? I.check : isNext ? <i className="pulse" /> : null}</span>
        <span className="pc-t">{isNext && <em className="pc-tag">Next up</em>}<b>{p.name}</b><small>{p.code ? `${p.code} · ` : ''}{p.kind === 'elective' ? 'Elective' : 'Required'}{p.length ? ` · ${p.length}` : ''}</small>
          {p.parts && <span className="pc-parts" role={multi ? 'group' : undefined} aria-label="Parts">{p.parts.map((x) => {
            const state = x.done ? ' dn' : x.sched ? ' bk' : '';
            const inner = <>{x.done ? I.check : null}{x.label}</>;
            const tip = x.done ? 'Done' : x.sched ? `Scheduled ${x.sched.date}` : 'Not scheduled';
            return multi
              ? <button type="button" key={x.n} className={'pc-part' + state + (x.n === pn ? ' pick' : '')} aria-pressed={x.n === pn} title={tip} onClick={() => setSel({ ...sel, [p.id]: x.n })}>{inner}</button>
              : <span key={x.n} className={'pc-part' + state} title={tip}>{inner}</span>;
          })}</span>}
          {!cur.done && cur.sched && <small className="pc-when">{multi ? `${cur.label}: ` : ''}{cur.sched.date < today ? 'Was scheduled' : 'Scheduled'} {fmtDate(cur.sched.date, { weekday: 'short', day: 'numeric', month: 'short' })}{cur.sched.venue ? ` at ${cur.sched.venue}` : ''}</small>}
          {evalPart && !cur.done && !cur.sched && <small className="pc-when">Given from an evaluator slot on the roster: schedule it on a meeting date, then mark it done once they have evaluated.</small>}
        </span>
        <span className="pc-a">
          {cur.done
            ? <><small>{multi ? `${cur.label}: ` : ''}{cur.done.source === 'prior' ? (cur.done.date ? `Logged ${fmtDate(cur.done.date, { day: 'numeric', month: 'short' })}` : 'Before Brekkie') : cur.done.source === 'evaluation' ? `Evaluated, meeting ${cur.done.meeting}` : fmtDate(cur.done.date, { day: 'numeric', month: 'short' })}{cur.done.venue ? ` at ${cur.done.venue}` : ''}</small>{!mine && cur.done.source === 'manual' && <button type="button" className="lnk" onClick={() => mark(p, false, multi ? pn : undefined)} disabled={busy === p.id}>Undo</button>}</>
            : <>
                {canPlan && !cur.sched && <button type="button" className="pc-sch" onClick={() => setPlan({ person: person.id, name: person.name, project: p.id, label: p.code, ...(multi ? { part: pn } : {}) })}>Schedule{multi ? ` ${cur.label.toLowerCase()}` : ''}</button>}
                {canPlan && cur.sched?.plan && <button type="button" className="lnk" onClick={() => unplan(cur.sched.plan)}>Unschedule</button>}
                {canPlan && !mine && cur.sched?.role && <button type="button" className="lnk" onClick={() => unslot(cur.sched.role)}>Unschedule</button>}
              {!mine && <>
                {p.kind === 'elective' && <button type="button" className="lnk" onClick={() => elective(p.id, false)} disabled={busy === p.id}>Remove</button>}
                <Btn sm kind={isNext ? '' : 'ghost'} onClick={() => mark(p, true, multi ? pn : undefined, cur.sched)} disabled={busy === p.id}>{isNext && I.check} Mark done{multi ? ` ${cur.label.toLowerCase()}` : ''}</Btn>
              </>}
              </>}
        </span>
      </li>
    );
  };

  return (
    <section className="pcard2" ref={card}>
      {head}

      <ol className="pc-steps" aria-label="Levels">
        {d.levels.map((l) => (
          <li key={l.level} className={(l.complete ? 'is-done ' : '') + (l.level === d.current ? 'cur' : '')}>
            <button type="button" className={(l.complete ? 'is-done ' : '') + (l.level === d.current ? 'is-now ' : '') + (l.level === lv?.level ? 'is-view' : '')} onClick={() => { setView(l.level); setOpen(true); }} aria-label={`Level ${l.level}, ${l.required_done} of ${l.required_total} projects done${l.enh?.applies ? `, ${l.enh.done} of ${l.enh.total} requirements done` : ''}${l.complete ? ', complete' : ''}`}>
              {l.complete ? I.check : l.level}
            </button>
            <span>Level {l.level}</span>
            <small>{l.required_done}/{l.required_total}{l.enh?.applies ? ` + ${l.enh.done}/${l.enh.total}` : ''}</small>
          </li>
        ))}
      </ol>

      {lv && (
        <>
          <button type="button" className="pc-tog" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span><b>Level {lv.level}</b>{lv.title ? ` · ${lv.title}` : ''}</span>
            <span className="pc-sum">{(() => { const left = lv.required_total - lv.required_done + Math.max(0, (lv.choose || 0) - lv.electives_done), rq = lv.enh?.applies ? lv.enh.total - lv.enh.done : 0; if (lv.complete) return 'Level complete'; const bits = [left > 0 && `${left} project${left === 1 ? '' : 's'}`, rq > 0 && `${rq} requirement${rq === 1 ? '' : 's'}`].filter(Boolean); return bits.length ? `${bits.join(' and ')} to go` : 'Level complete'; })()}</span>
            <span className={'pc-car' + (open ? ' up' : '')}>{I.chev}</span>
          </button>

          {open && (
            <div className="pc-more">
              <div className="pc-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: pct + '%' }} /></div>

              {lv.enh?.applies && <div className="pc-sec"><b>Path projects</b></div>}
              <ul className="pc-list">{reqs.map(row)}</ul>

              {lv.choose > 0 && (
                <>
                  <div className="pc-elh"><b>Electives</b><span>{els.length} of {lv.choose} chosen</span></div>
                  {els.length > 0 && <ul className="pc-list">{els.map(row)}</ul>}
                  {!mine && lv.to_pick > 0 && (
                    <div className="pc-pickel">
                      <Select sm value="" placeholder={`Choose ${lv.to_pick} elective${lv.to_pick === 1 ? '' : 's'}`} searchable
                        options={lv.options.map((o) => ({ value: o.id, label: o.name, sub: o.length }))} onChange={(v) => elective(v, true)} />
                    </div>)}
                  {mine && lv.to_pick > 0 && <p className="pc-empty" style={{ margin: '6px 2px' }}>Your VPE will add your {lv.to_pick === 1 ? 'elective' : 'electives'} once you have chosen.</p>}
                </>
              )}
              <Requirements lv={lv} person={person} mine={mine} canPlan={canPlan} reload={prog.reload} />
            </div>
          )}
        </>
      )}
      {plan && <PlanModal preset={plan} meId={mine ? person.id : undefined} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); reload(); }} />}
    </section>
  );
}
