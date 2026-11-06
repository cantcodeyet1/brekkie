import { useEffect, useState } from 'react';
import { api, useApi } from '../api.js';
import { fmtDate } from '../data.js';
import { Btn, I, Loading, PathPick, useToast } from '../ui.jsx';

/* Where a member is on their Pathways path: the path, the level they are on, what is finished and what comes next.
   The VPE marks a project done here, because being on the agenda does not mean the speech was given. */
export default function PathCard({ person }) {
  const toast = useToast();
  const prog = useApi(`/vpe/people/${person.id}/path`);
  const cat = useApi('/pathways');
  const [pl, setPl] = useState({ path_name: person.path_name || null, path_level: person.path_level ?? null });
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(null);

  const d = prog.data;
  useEffect(() => { if (d) setView((v) => (d.levels.some((l) => l.level === v) ? v : d.current)); }, [d]);

  const savePath = async (n) => {
    setPl(n);
    try { await api(`/vpe/people/${person.id}`, { method: 'PATCH', body: n }); setView(null); await prog.reload(); } catch (e) { toast(e.message); }
  };
  const setLevel = async (level) => { await savePath({ path_name: pl.path_name, path_level: level }); };
  const mark = async (p, done) => {
    setBusy(p.id);
    try { await api(`/vpe/people/${person.id}/projects`, { method: 'POST', body: { project_id: p.id, done } }); await prog.reload(); toast(done ? `${p.name} marked as done` : 'Marked as not done'); }
    catch (e) { toast(e.message); } finally { setBusy(null); }
  };

  const picker = <PathPick catalog={cat.data?.paths || []} pathName={pl.path_name} level={pl.path_level} onChange={savePath} />;
  const head = (
    <div className="pc-h">
      <div><small>Pathways</small><h2>{d?.path || 'No path yet'}</h2></div>
      <div className="pc-pick">{picker}</div>
    </div>
  );
  if (prog.loading || !d) return <section className="pcard2">{head}<Loading /></section>;
  if (!d.path) return <section className="pcard2">{head}<p className="pc-empty">Choose a path and level. When this member is put in a speaker slot, their path and next project fill in on their own.</p></section>;

  const lv = d.levels.find((l) => l.level === view) || d.levels.find((l) => l.level === d.current) || d.levels[0];
  const cur = d.levels.find((l) => l.level === d.current);
  const pct = lv && lv.required_total ? Math.round((lv.required_done / lv.required_total) * 100) : 0;
  const upLevel = d.levels.find((l) => l.level > d.current)?.level;

  return (
    <section className="pcard2">
      {head}

      <ol className="pc-steps" aria-label="Levels">
        {d.levels.map((l) => (
          <li key={l.level}>
            <button type="button" className={(l.complete ? 'is-done ' : '') + (l.level === d.current ? 'is-now ' : '') + (l.level === lv?.level ? 'is-view' : '')} onClick={() => setView(l.level)} aria-label={`Level ${l.level}${l.complete ? ', complete' : ''}`}>
              {l.complete ? I.check : l.level}
            </button>
            <span>Level {l.level}</span>
          </li>
        ))}
      </ol>

      {d.level_complete && upLevel && lv?.level === d.current && (
        <div className="pc-up"><div><b>Level {d.current} is complete.</b><span>Move them up and their next speaker slot picks the first project of Level {upLevel}.</span></div>
          <Btn sm onClick={() => setLevel(upLevel)}>Move to Level {upLevel}</Btn></div>)}

      {d.next && lv?.level === d.current && (
        <div className="pc-next">
          <div><small>Next up</small><b>{d.next.name}</b><span>{d.next.code ? `${d.next.code} · ` : ''}{d.next.kind === 'elective' ? 'Elective' : 'Required'}, Level {d.next.level}</span></div>
          <Btn sm onClick={() => mark(d.next, true)} disabled={busy === d.next.id}>{I.check} Mark as done</Btn>
        </div>)}

      {lv && (
        <>
          <div className="pc-lvh">
            <div><b>Level {lv.level}</b>{lv.title ? <span>{lv.title}</span> : null}</div>
            {lv.level !== d.current && <button type="button" className="lnk" onClick={() => setLevel(lv.level)}>Make this their current level</button>}
          </div>
          <div className="pc-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: pct + '%' }} /></div>
          <p className="pc-sum">{lv.required_done} of {lv.required_total} required done{lv.choose ? `, ${lv.electives_done} of ${lv.choose} electives` : ''}</p>
          <ul className="pc-list">
            {lv.projects.map((p) => {
              const isNext = d.next?.id === p.id && lv.level === d.current;
              return (
                <li key={p.id} className={(p.done ? 'is-done ' : '') + (isNext ? 'is-next' : '')}>
                  <span className="pc-ic">{p.done ? I.check : isNext ? <i className="pulse" /> : null}</span>
                  <span className="pc-t"><b>{p.name}</b><small>{p.code ? `${p.code} · ` : ''}{p.kind === 'elective' ? 'Elective' : 'Required'}{p.length ? ` · ${p.length}` : ''}</small></span>
                  <span className="pc-a">
                    {p.done
                      ? <><small>{p.done.source === 'evaluation' ? `Evaluated, meeting ${p.done.meeting}` : fmtDate(p.done.date, { day: 'numeric', month: 'short' })}</small>{p.done.source === 'manual' && <button type="button" className="lnk" onClick={() => mark(p, false)} disabled={busy === p.id}>Undo</button>}</>
                      : <Btn sm kind="ghost" onClick={() => mark(p, true)} disabled={busy === p.id}>Mark done</Btn>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {cur && !cur.projects.length && <p className="pc-empty">This level has no projects in the catalog yet.</p>}
    </section>
  );
}
