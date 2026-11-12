import { useRef, useState } from 'react';
import { PATH_NAMES, fromClubCentral } from '../roster.js';
import { I, Select } from '../ui.jsx';
import { api } from '../api.js';

/* the member's level now: the one after the last they finished. Stored as levels finished. */
const LEVEL_OPTS = [
  ...[0, 1, 2, 3, 4].map((n) => ({ value: n, label: `Level ${n + 1}`, sub: n ? `Levels 1 to ${n} finished` : 'Just starting' })),
  { value: 5, label: 'Path complete', sub: 'All 5 levels finished' },
];

/* path and how many levels of it are finished: used for every new member, so earlier work is logged from day one */
export const programYearLabel = (d = new Date()) => { const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(2)}`; };

/* which of the finished levels were earned in the current program year: only those count towards this year's club goals */
function yearOpts(done) {
  const yr = programYearLabel();
  return [
    { value: 0, label: 'Before this year', sub: `Not counted in ${yr}` },
    ...Array.from({ length: done }, (_, i) => i + 1).map((n) => ({
      value: n,
      label: n === 1 ? `Level ${done}` : n === 2 ? `Levels ${done - 1} and ${done}` : `Levels ${done - n + 1} to ${done}`,
      sub: `Counts towards ${yr}`,
    })),
  ];
}

export function PathDone({ path, done, thisYear, onChange }) {
  const n = done ?? 0;
  return (
    <div className="ppick pdone">
      <Select sm value={path || ''} placeholder="Path" searchable={false}
        options={[...(path ? [{ value: '__none', label: 'No path yet' }] : []), ...PATH_NAMES.map((p) => ({ value: p, label: p }))]}
        onChange={(v) => onChange(v === '__none' ? { path_name: '', levels_done: 0, levels_this_year: 0 } : { path_name: v, levels_done: path === v ? done : 0, levels_this_year: path === v ? Math.min(thisYear || 0, done || 0) : 0 })} />
      <Select sm value={n} placeholder="Level" disabled={!path} options={LEVEL_OPTS}
        onChange={(v) => onChange({ path_name: path, levels_done: v, levels_this_year: Math.min(thisYear || 0, v) })} />
      {!!path && n > 0 && (
        <div className="py">
          <span className="py-l">Earned in {programYearLabel()}</span>
          <Select sm value={Math.min(thisYear || 0, n)} searchable={false} options={yearOpts(n)}
            onChange={(v) => onChange({ path_name: path, levels_done: n, levels_this_year: v })} />
        </div>
      )}
    </div>
  );
}

/* Upload the Toastmasters Club Central roster, check each person, fix any path or level, and hand the rows back. */
export default function RosterImport({ rows, onRows, matchExisting = false }) {
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const file = useRef(null);
  const read = async (f) => {
    setErr('');
    if (!f) return;
    try {
      let list = fromClubCentral(await f.text());
      if (!list.length) throw new Error('No members found in that file. Use the Club Membership export from Club Central.');
      // inside a club that already exists: people already in Brekkie start unticked, and the VPE chooses who to update
      if (matchExisting) {
        const found = await api('/vpe/people/import/match', { method: 'POST', body: { members: list.map((r) => ({ name: r.name, email: r.email })) } });
        list = list.map((r, i) => {
          const m = found[i];
          if (!m) return r;
          const keep = !r.path_name && m.path_name;
          return { ...r, match: m, on: false, ...(keep ? { path_name: m.path_name, levels_done: m.levels_done, guessed: false } : {}), levels_this_year: Math.min(m.levels_this_year || 0, (keep ? m.levels_done : r.levels_done) || 0) };
        });
      }
      setName(f.name); onRows(list);
    } catch (e) { setErr(e.message); }
  };
  const set = (i, patch) => onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.on).length;
  const adding = rows.filter((r) => r.on && !r.match).length, updating = rows.filter((r) => r.on && r.match).length;
  const unsure = rows.filter((r) => r.on && r.enrolled && !r.path_name).length;
  return (
    <div className="ri">
      <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
      {!rows.length ? (
        <button type="button" className="ri-drop" onClick={() => file.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); read(e.dataTransfer.files?.[0]); }}>
          <span className="ri-ic">{I.plus}</span>
          <b>Choose your Club Central roster</b>
          <small>The Club Membership file (.csv) from Toastmasters. You can also drop it here.</small>
        </button>
      ) : (
        <>
          <div className="ri-bar">
            <span className="ri-sum">
              <b>{chosen}</b> of {rows.length} selected{name ? ` from ${name}` : ''}
              {matchExisting && <>{adding > 0 && <i className="ri-chip">{adding} new</i>}{updating > 0 && <i className="ri-chip upd">{updating} to update</i>}</>}
            </span>
            <button type="button" className="lnk" onClick={() => { onRows([]); setName(''); }}>Choose a different file</button>
          </div>
          {unsure > 0 && <p className="ri-note">{unsure} {unsure === 1 ? 'member is' : 'members are'} on Pathways but the file does not say which path. Pick it, or leave it and set it later.</p>}
          <ul className="ri-list">
            {rows.map((r, i) => (
              <li key={r.key + i} className={r.on ? '' : 'off'}>
                <label className="ri-who">
                  <input type="checkbox" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
                  <span className="ri-t">
                    <b>{r.name}{r.match && <i className="ri-chip in">In Brekkie</i>}</b>
                    <small>{r.match
                      ? `Now: ${r.match.path_name ? `${r.match.path_name}, Level ${Math.min(5, (r.match.path_level || 1))}` : 'no path set'}`
                      : [r.position, r.phone || 'No phone', r.credential && `Credentials ${r.credential}`].filter(Boolean).join(' · ')}</small>
                  </span>
                </label>
                {r.match && !r.on && <button type="button" className="ri-upbtn" onClick={() => set(i, { on: true })}>Update details</button>}
                {r.on && <PathDone path={r.path_name} done={r.levels_done} thisYear={r.levels_this_year} onChange={(p) => set(i, p)} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
