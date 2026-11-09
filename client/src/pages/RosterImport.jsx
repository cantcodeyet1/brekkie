import { useRef, useState } from 'react';
import { PATH_NAMES, fromClubCentral } from '../roster.js';
import { I, Select } from '../ui.jsx';

/* the member's level now: the one after the last they finished. Stored as levels finished. */
const LEVEL_OPTS = [
  ...[0, 1, 2, 3, 4].map((n) => ({ value: n, label: `Level ${n + 1}`, sub: n ? `Levels 1 to ${n} finished` : 'Just starting' })),
  { value: 5, label: 'Path complete', sub: 'All 5 levels finished' },
];

/* path and how many levels of it are finished: used for every new member, so earlier work is logged from day one */
export function PathDone({ path, done, onChange }) {
  return (
    <div className="ppick pdone">
      <Select sm value={path || ''} placeholder="Path" searchable={false}
        options={[...(path ? [{ value: '__none', label: 'No path yet' }] : []), ...PATH_NAMES.map((n) => ({ value: n, label: n }))]}
        onChange={(v) => onChange(v === '__none' ? { path_name: '', levels_done: 0 } : { path_name: v, levels_done: path === v ? done : 0 })} />
      <Select sm value={done ?? 0} placeholder="Level" disabled={!path} options={LEVEL_OPTS}
        onChange={(v) => onChange({ path_name: path, levels_done: v })} />
    </div>
  );
}

/* Upload the Toastmasters Club Central roster, check each person, fix any path or level, and hand the rows back. */
export default function RosterImport({ rows, onRows }) {
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const file = useRef(null);
  const read = async (f) => {
    setErr('');
    if (!f) return;
    try {
      const list = fromClubCentral(await f.text());
      if (!list.length) throw new Error('No members found in that file. Use the Club Membership export from Club Central.');
      setName(f.name); onRows(list);
    } catch (e) { setErr(e.message); }
  };
  const set = (i, patch) => onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.on).length;
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
            <span><b>{chosen}</b> of {rows.length} members will be added{name ? ` from ${name}` : ''}</span>
            <button type="button" className="lnk" onClick={() => { onRows([]); setName(''); }}>Choose a different file</button>
          </div>
          {unsure > 0 && <p className="ri-note">{unsure} {unsure === 1 ? 'member is' : 'members are'} on Pathways but the file does not say which path. Pick it, or leave it and set it later.</p>}
          <ul className="ri-list">
            {rows.map((r, i) => (
              <li key={r.key + i} className={r.on ? '' : 'off'}>
                <label className="ri-who">
                  <input type="checkbox" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
                  <span className="ri-t"><b>{r.name}</b><small>{[r.position, r.phone || 'No phone', r.credential && `Credentials ${r.credential}`].filter(Boolean).join(' · ')}</small></span>
                </label>
                {r.on && <PathDone path={r.path_name} done={r.levels_done} onChange={(p) => set(i, p)} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
