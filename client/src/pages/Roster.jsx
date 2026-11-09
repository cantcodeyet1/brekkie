import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { fmtDate } from '../data.js';
import { Btn, DatePick, ErrorMsg, I, SkPage, Modal, Page, PersonSelect, Select, Wcard, useToast } from '../ui.jsx';

/* The meeting roster. One column per meeting, one row per thing to plan, like the club's planner sheet.
   The grid always fits the screen: how many meetings you see depends on the width, and you move between
   meetings with the timeline, the arrows, or "Go to". Every cell saves as you leave it. */
const FIXED = [['toastmaster', 'Toastmaster of the Day'], ['general_evaluator', 'General Evaluator'], ['timer', 'Timer'], ['grammarian', 'Grammarian'], ['ah_counter', 'Ah Counter'], ['topicsmaster', 'Table Topics Master']];
const quarter = (iso) => { const d = new Date(iso + 'T12:00:00'); return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`; };
const MIN_COL = 180, MAX_COLS = 4;

export default function Roster() {
  const toast = useToast();
  const wrap = useRef(null);
  const [cols, setCols] = useState(() => Math.max(1, Math.min(MAX_COLS, Math.floor((window.innerWidth - 300) / MIN_COL))));
  const [from, setFrom] = useState(undefined);
  const [focus, setFocus] = useState(null);
  const [view, setView] = useState(null);                       // last good data, kept on screen while the next page loads
  const rq = useApi(`/vpe/roster?count=${cols}${from === undefined ? '' : `&from=${from}`}`);
  const peopleQ = useApi('/vpe/people');
  const [ms, setMs] = useState([]);
  const [wordFor, setWordFor] = useState(null);
  const [drag, setDrag] = useState(null), [over, setOver] = useState(null);   // dragging a name between cells
  const [menu, setMenu] = useState(null);                       // right-click menu on the date strip
  const [del, setDel] = useState(null), [delBusy, setDelBusy] = useState(false);
  const timers = useRef({}), pending = useRef({}), strip = useRef(null);

  // fit the number of columns to the space
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const calc = () => { const w = el.clientWidth, pad = w < 900 ? 32 : 88, label = w < 560 ? 112 : 184; setCols(Math.max(1, Math.min(MAX_COLS, Math.floor((w - pad - label) / MIN_COL)))); };
    calc();
    const ro = new ResizeObserver(calc); ro.observe(el);
    return () => ro.disconnect();
  }, [!!view && !peopleQ.loading && !(rq.error || peopleQ.error)]); // the ref moves when the real page replaces the loading state
  useEffect(() => { if (rq.data) { setView(rq.data); setMs(rq.data.meetings); } }, [rq.data]);
  // keep the timeline centred on what you are looking at
  useEffect(() => { strip.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [view?.from, view?.count]);

  const people = useMemo(() => (peopleQ.data || []).filter((p) => p.status !== 'inactive'), [peopleQ.data]);

  if (!view || peopleQ.loading) return <Page root wide full><div ref={wrap}><SkPage rows={9} avatar pill={false} /></div></Page>;
  if (rq.error || peopleQ.error) return <Page root wide full><div ref={wrap}><ErrorMsg error={rq.error || peopleQ.error} /></div></Page>;

  const loadingNext = rq.loading;
  const nameOf = (id) => people.find((p) => p.id === id);

  const setMeta = (mid, patch) => {
    setMs((cur) => cur.map((m) => (m.id === mid ? { ...m, ...patch } : m)));
    pending.current[mid] = { ...(pending.current[mid] || {}), ...patch };
    clearTimeout(timers.current[mid]);
    timers.current[mid] = setTimeout(async () => {
      const body = pending.current[mid]; pending.current[mid] = {};
      try { await api(`/vpe/meetings/${mid}`, { method: 'PATCH', body }); } catch (e) { toast(e.message); }
    }, 500);
  };
  const setRole = async (m, role, body) => {
    setMs((cur) => cur.map((x) => (x.id !== m.id ? x : { ...x, roles: x.roles.map((r) => {
      if (r.id !== role.id) return r;
      const next = { ...r, ...body };
      if ('person_id' in body) { const p = nameOf(body.person_id); next.person = p?.name || null; next.person_kind = p?.kind || null; }
      return next;
    }) })));
    try {
      const res = await api(`/vpe/roles/${role.id}`, { method: 'PATCH', body });
      if (res.path_name !== undefined) setMs((cur) => cur.map((x) => (x.id !== m.id ? x : { ...x, roles: x.roles.map((r) => (r.id === role.id ? { ...r, path_name: res.path_name, path_level: res.path_level, project_id: res.project_id } : r)) })));
      if ('path_name' in body || 'person_id' in body) peopleQ.reload();
    } catch (e) { toast(e.message); rq.reload(); }
  };
  const addGuest = async (name) => { const g = await api('/people/guest', { method: 'POST', body: { name } }); await peopleQ.reload(); return g; };
  const removeMeeting = async () => {
    setDelBusy(true);
    try { await api(`/vpe/meetings/${del.id}`, { method: 'DELETE' }); toast(`Meeting ${del.number} removed. Later meetings moved up one.`); setDel(null); rq.reload(); }
    catch (e) { toast(e.message); setDel(null); } finally { setDelBusy(false); }
  };
  const go = (n) => { setFocus(n); setFrom(n); };
  const addMeeting = async () => { const r = await api('/vpe/meetings', { method: 'POST' }); toast(`Meeting ${r.number} added`); go(r.number); rq.reload(); };
  const addRow = async (key) => { await Promise.all(ms.map((m) => api(`/vpe/meetings/${m.id}/roles`, { method: 'POST', body: { role_key: key } }))); rq.reload(); };
  const removeRow = async (key) => {
    const bad = [];
    await Promise.all(ms.map(async (m) => { const last = m.roles.filter((r) => r.role_key === key).at(-1); if (last && last.person_id === null) { try { await api(`/vpe/roles/${last.id}`, { method: 'DELETE' }); } catch { bad.push(m.number); } } else if (last) bad.push(m.number); }));
    if (bad.length) toast(`That row has someone in it for meeting ${bad.join(', ')}. Clear it first.`);
    rq.reload();
  };

  const of = (m, key) => m.roles.filter((r) => r.role_key === key);
  const nS = Math.max(3, ...ms.map((m) => of(m, 'speaker').length)), nE = Math.max(3, ...ms.map((m) => of(m, 'evaluator').length));
  const dupes = (m) => { const c = {}; m.roles.forEach((r) => { if (r.person_id) c[r.person_id] = (c[r.person_id] || 0) + 1; }); return c; };
  const n = ms.length, first = view.from, last = view.from + view.count - 1;
  const cls = (m) => (m.status === 'Next' ? ' isnext' : '') + (focus === m.number ? ' picked' : '');

  const dropOn = async (m, role) => {
    const from = drag; setDrag(null); setOver(null);
    if (!from || from.role.id === role.id || !from.role.person_id) return;
    const mine = from.role.person_id, theirs = role.person_id || null;
    await setRole(m, role, { person_id: mine });
    await setRole(from.m, from.role, { person_id: theirs });
  };
  const cell = (m, role, extra) => {
    if (!role) return <td className={'rc na' + cls(m)} key={m.id}><span>None</span></td>;
    const d = dupes(m), dup = role.person_id && d[role.person_id] > 1;
    return (
      <td className={'rc' + (role.person_id ? ' filled' : '') + (dup ? ' dup' : '') + (over === role.id && drag && drag.role.id !== role.id ? ' dropto' : '') + cls(m)} key={m.id} title={dup ? 'This person has more than one role at this meeting' : undefined}
        onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(role.id); } }} onDragLeave={() => setOver((o) => (o === role.id ? null : o))} onDrop={(e) => { e.preventDefault(); dropOn(m, role); }}>
        <div className={'pwrap' + (role.person_id ? ' grab' : '')} draggable={!!role.person_id} onDragStart={(e) => { setDrag({ m, role }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', role.person || ''); }} onDragEnd={() => { setDrag(null); setOver(null); }}>
          <PersonSelect value={role.person_id} placeholder="Assign" sm allowClear people={people} onAddGuest={addGuest} onChange={(v) => setRole(m, role, { person_id: v })} />
        </div>
        {extra}
      </td>
    );
  };
  const row = (label, render, c = '') => <tr className={c}><th className="lbl" scope="row">{label}</th>{ms.map(render)}</tr>;
  const group = (label, after) => <tr className="grp"><td colSpan={n + 1}><span>{label}</span>{after}</td></tr>;
  const goTo = [...view.index].reverse().map((m) => ({ value: m.number, label: `No. ${m.number}`, sub: fmtDate(m.date) }));

  return (
    <Page root wide full>
      <div className="rpage" ref={wrap}>
        <div className="rhead">
          <div>
            <p className="reyebrow">{ms[0] ? quarter(ms[0].date) : 'Roster'}</p>
            <h1 className="rtitle">Meeting roster</h1>
            <p className="rsub">Plan ahead in one place. Assign a role and that person has their link straight away.</p>
          </div>
          <div className="rbar">
            <div className="rgo"><Select sm value={focus ?? view.from} placeholder="Go to meeting" options={goTo} onChange={go} searchable /></div>
            <Btn sm onClick={addMeeting}>{I.plus} New meeting</Btn>
          </div>
        </div>

        <div className="rtime" role="group" aria-label="Meetings">
          <button type="button" className="rnav" disabled={!view.has_earlier} onClick={() => go(Math.max(view.lo, first - view.count))} aria-label="Earlier meetings">{I.back}</button>
          <div className="rstrip" ref={strip}>
            {view.index.map((m) => (
              <button type="button" key={m.number} className={'rp' + (m.number >= first && m.number <= last ? ' on' : '') + (m.status === 'Next' ? ' nx' : '') + (m.status === 'Done' ? ' dn' : '')} onClick={() => go(m.number)} onContextMenu={(e) => { e.preventDefault(); setMenu({ m, x: Math.min(e.clientX, window.innerWidth - 200), y: e.clientY }); }} aria-label={`Meeting ${m.number}, ${fmtDate(m.date)}`} aria-current={m.number >= first && m.number <= last ? 'true' : undefined}>
                <b>{m.number}</b><small>{fmtDate(m.date, { day: 'numeric', month: 'short' })}</small>
              </button>
            ))}
          </div>
          <button type="button" className="rnav" disabled={!view.has_later} onClick={() => go(Math.min(view.hi, first + view.count))} aria-label="Later meetings">{I.chev}</button>
        </div>

        <div className={'rcard' + (loadingNext ? ' busy' : '')}>
          <table className="rtbl" style={{ '--n': n }}>
            <thead>
              <tr>
                <th className="lbl corner"><span>{first === last || n === 1 ? `Meeting ${first}` : `Meetings ${first} to ${first + n - 1}`}</span></th>
                {ms.map((m) => (
                  <th className={'rcol' + cls(m)} key={m.id}>
                    <span className={'rst rst-' + m.status.toLowerCase()}><i />{m.status}</span>
                    <Link className="mno" to={`/v/meetings/${m.id}`}>{m.number}</Link>
                    <span className="md">{fmtDate(m.date)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row('Date', (m) => <td className={'rc' + cls(m)} key={m.id}><DatePick bare value={m.date} onChange={(v) => setMeta(m.id, { date: v })} label={`Date, meeting ${m.number}`} /></td>)}
              {row('Attendance', (m) => <td className={'rc' + cls(m)} key={m.id}><input type="number" min="0" inputMode="numeric" value={m.attendance ?? ''} placeholder={m.status === 'Done' ? 'How many came?' : 'After the meeting'} onChange={(e) => setMeta(m.id, { attendance: e.target.value })} aria-label={`Attendance, meeting ${m.number}`} /></td>)}
              {row('Theme', (m) => <td className={'rc' + cls(m)} key={m.id}><input className="strong" value={m.theme} placeholder="Add a theme" onChange={(e) => setMeta(m.id, { theme: e.target.value })} aria-label={`Theme, meeting ${m.number}`} /></td>)}
              {row('Quotation', (m) => (
                <td className={'rc' + cls(m)} key={m.id}>
                  <textarea rows={3} value={m.theme_quote} placeholder="Add a quotation" onChange={(e) => setMeta(m.id, { theme_quote: e.target.value })} aria-label={`Quotation, meeting ${m.number}`} />
                  <input className="by" value={m.theme_quote_by} placeholder="Said by" onChange={(e) => setMeta(m.id, { theme_quote_by: e.target.value })} aria-label={`Quotation by, meeting ${m.number}`} />
                </td>), 'tall')}
              {row('Word of the Day', (m) => (
                <td className={'rc' + cls(m)} key={m.id}>
                  <input className="strong" value={m.word} placeholder="Add a word" onChange={(e) => setMeta(m.id, { word: e.target.value })} aria-label={`Word of the day, meeting ${m.number}`} />
                  <button type="button" className={'wlink' + (m.word && !m.meaning ? ' warn' : '')} onClick={() => setWordFor(m.id)}>
                    {m.word ? (m.meaning ? `${m.pos ? `${m.pos} · ` : ''}Meaning and example` : 'Add the meaning and example') : 'Word details'}
                  </button>
                </td>))}

              {group('Top table')}
              {FIXED.map(([key, label]) => row(label, (m) => cell(m, of(m, key)[0])))}

              {group('Speakers', <span className="gact"><button type="button" onClick={() => addRow('speaker')}>{I.plus} Add speaker</button>{nS > 3 && <button type="button" onClick={() => removeRow('speaker')}>Remove last</button>}</span>)}
              {Array.from({ length: nS }, (_, k) => row(`Speaker ${k + 1}`, (m) => cell(m, of(m, 'speaker')[k])))}

              {group('Evaluators', <span className="gact"><button type="button" onClick={() => addRow('evaluator')}>{I.plus} Add evaluator</button>{nE > 3 && <button type="button" onClick={() => removeRow('evaluator')}>Remove last</button>}</span>)}
              {Array.from({ length: nE }, (_, k) => row(`Evaluator ${k + 1}`, (m) => cell(m, of(m, 'evaluator')[k])))}
            </tbody>
          </table>
        </div>
      </div>

      {menu && (
        <>
          <div className="ctx-back" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="ctx" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" role="menuitem" onClick={() => { go(menu.m.number); setMenu(null); }}>Go to meeting {menu.m.number}</button>
            <button type="button" role="menuitem" className="dng" onClick={() => { setDel(menu.m); setMenu(null); }}>Remove meeting {menu.m.number}</button>
          </div>
        </>
      )}
      {del && (
        <Modal title={`Remove meeting ${del.number}?`} onClose={() => setDel(null)}>
          <p style={{ margin: '4px 0 0', color: 'var(--mute)', fontSize: 15 }}>{fmtDate(del.date)} comes off the roster, along with any roles planned for it. Every later meeting moves up one number, so there is no gap. This cannot be undone.</p>
          <div className="row-btns"><Btn kind="ghost" onClick={() => setDel(null)}>Keep it</Btn><Btn onClick={removeMeeting} disabled={delBusy}>{delBusy ? 'Removing…' : 'Remove meeting'}</Btn></div>
        </Modal>
      )}
      {wordFor && <WordModal m={ms.find((x) => x.id === wordFor)} onChange={(p) => setMeta(wordFor, p)} onClose={() => setWordFor(null)} />}
    </Page>
  );
}

function WordModal({ m, onChange, onClose }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [alts, setAlts] = useState([]);
  const fill = async () => {
    setBusy(true); setNote(''); setAlts([]);
    try {
      const d = await api('/vpe/word-details', { method: 'POST', body: { word: m.word, theme: m.theme, quote: m.theme_quote } });
      const patch = {}; for (const k of ['word', 'pos', 'pron', 'meaning', 'example', 'synonyms', 'origin']) if (d[k]) patch[k] = d[k];
      onChange(patch); setAlts(d.alternatives || []);
      setNote(d.source === 'ai' ? 'Written by AI to fit your theme. Read it through before you keep it.' : (d.note || 'Filled in from the dictionary.'));
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const f = (label, k, ph, area) => (
    <div key={k}>
      <label className="fl">{label}</label>
      {area ? <textarea className="inp" style={{ minHeight: 60 }} value={m[k] || ''} placeholder={ph} onChange={(e) => onChange({ [k]: e.target.value })} />
        : <input className="inp" value={m[k] || ''} placeholder={ph} onChange={(e) => onChange({ [k]: e.target.value })} />}
    </div>
  );
  return (
    <Modal title={`Word of the day, meeting ${m.number} (${fmtDate(m.date)})`} wide onClose={onClose}>
      <p style={{ margin: '2px 0 0', color: 'var(--mute)', fontSize: 14.5 }}>Everything saves as you type. The Grammarian reads this on their sheet and in their script.</p>
      <div className="wordgrid">
        <div>
          {f('Word', 'word', 'e.g. Assiduous')}
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn sm onClick={fill} disabled={busy || !m.word}>{busy ? 'Looking it up…' : 'Fill in the details'}</Btn>
            <span style={{ fontSize: 13.5, color: 'var(--mute)', flex: 1, minWidth: 180 }}>{note || 'Meaning, part of speech, pronunciation, synonyms and an example for your theme.'}</span>
          </div>
          <div className="two">{f('Part of speech', 'pos', 'adj.')}{f('Pronunciation', 'pron', 'uh-SIJ-oo-us')}</div>
          {f('Meaning', 'meaning', 'What it means', true)}
          {alts.length > 0 && <div className="alts"><small>Other meanings. Tap one to use it.</small>{alts.map((a, k) => <button type="button" key={k} className={m.meaning === a.text ? 'on' : ''} onClick={() => onChange({ meaning: a.text, ...(a.pos ? { pos: a.pos } : {}) })}>{a.pos && <b>{a.pos}</b>} {a.text}</button>)}</div>}
          {f('Example', 'example', 'Use it in a sentence', true)}
          {f('Synonyms', 'synonyms', 'Diligent, Studious, Persevering')}
          {f('Origin', 'origin', 'Where the word comes from', true)}
        </div>
        <div><div className="lab" style={{ marginTop: 14 }}>What the Grammarian sees</div><Wcard m={m} /></div>
      </div>
      <div className="row-btns"><Btn onClick={onClose}>Done</Btn></div>
    </Modal>
  );
}
