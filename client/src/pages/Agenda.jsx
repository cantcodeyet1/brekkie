import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getToken, useApi } from '../api.js';
import { fmtDate } from '../data.js';
import { Btn, DatePick, ErrorMsg, I, Page, Select, SkPage, useDebouncedSave, useDesk, useToast } from '../ui.jsx';
import { clock, maxMinutes, schedule, shown, toHhmm } from './agendaTimes.js';

const OWNERS = ['SAA', 'Chairperson', 'TMOD', 'General Evaluator', 'Table Topics Master', 'Grammarian', 'Ah Counter', 'Timer'];
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`;

/* a time shown as 18:00 and typed as digits; it only changes the plan once it is a real time */
function TimeBox({ value, onChange, label, ph = '18:00', allowEmpty }) {
  const [txt, setTxt] = useState(shown(value));
  useEffect(() => setTxt(shown(value)), [value]);
  const type = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setTxt(d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d);
    if (d.length === 4 && toHhmm(d)) onChange(d); else if (!d && allowEmpty) onChange('');
  };
  return <input className="inp mono ag2-time" inputMode="numeric" aria-label={label} placeholder={ph} value={txt} onChange={(e) => type(e.target.value)} onBlur={() => setTxt(shown(value))} />;
}

/* a small stepper: minus, the number with its unit, plus */
function Step({ value, onChange, min = 0, max = 180, unit = 'min', step = 1, label }) {
  const v = Number(value) || 0;
  return (
    <span className="ag2-step" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, v - step))} disabled={v <= min} aria-label={`Less ${label}`}>{I.minus}</button>
      <b>{v}<small> {unit}</small></b>
      <button type="button" onClick={() => onChange(Math.min(max, v + step))} disabled={v >= max} aria-label={`More ${label}`}>{I.plus}</button>
    </span>
  );
}

const Grip = () => <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">{[3, 9, 15].map((y) => [3, 11].map((x) => <circle key={x + '-' + y} cx={x} cy={y} r="1.6" />))}</svg>;
const Arrow = ({ up }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>;

export default function Agenda() {
  const { id } = useParams();
  const desk = useDesk();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/vpe/meetings/${id}/agenda`);
  const people = useApi('/vpe/people');
  const [ag, setAg] = useState(null);
  const [mt, setMt] = useState(null);
  const [save, setSave] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('plan');
  const [open, setOpen] = useState({});
  const [pin, setPin] = useState({});
  const [fits, setFits] = useState(true);
  const [preview, setPreview] = useState('');
  const [drag, setDrag] = useState(null);
  const metaTimer = useRef(), rows = useRef({}), agRef = useRef(null), loaded = useRef(false);
  useEffect(() => { if (data) { setAg(schedule(data.agenda)); setMt(data.meeting); setFits(data.fits); loaded.current = false; } }, [data]);
  agRef.current = ag;
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const names = useMemo(() => (people.data || []).filter((p) => p.status !== 'inactive').map((p) => p.name), [people.data]);
  const ownerOptions = useMemo(() => [...OWNERS.map((o) => ({ value: o, label: o })), ...names.map((n) => ({ value: n, label: n }))], [names]);

  const refreshPreview = useCallback(async () => {
    try {
      const res = await fetch(`/api/vpe/meetings/${id}/agenda.pdf?inline=1&t=${Date.now()}`, { headers: { 'x-token': getToken() } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
    } catch { /* the preview is a convenience: the download still reports a real error */ }
  }, [id]);
  useEffect(() => { if (data) refreshPreview(); }, [data, refreshPreview]);

  useDebouncedSave(async () => {
    try {
      setSave('Saving…');
      const r = await api(`/vpe/meetings/${id}/agenda`, { method: 'PUT', body: agRef.current });
      setFits(r.fits); setSave('Saved'); refreshPreview();
    } catch { setSave('Not saved'); }
  }, [ag], 700);

  if (loading || !ag || !mt) return <Page title="Roster" wide full back={`/v/meetings/${id}`}><SkPage plain rows={6} pill={false} /></Page>;
  if (error) return <Page title="Roster" wide full back={`/v/meetings/${id}`}><ErrorMsg error={error} /></Page>;

  const set = (patch) => setAg((a) => schedule({ ...a, ...patch }));
  const setBlock = (bid, patch) => setAg((a) => schedule({ ...a, blocks: a.blocks.map((b) => (b.id === bid ? { ...b, ...patch } : b)) }));
  const setSpeech = (rid, patch) => setAg((a) => schedule({ ...a, speeches: a.speeches.map((s) => (s.role_id === rid ? { ...s, ...patch } : s)) }));
  const setMeta = (patch) => {
    setMt((x) => ({ ...x, ...patch }));
    clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => api(`/vpe/meetings/${id}`, { method: 'PATCH', body: patch }).then(refreshPreview).catch((e) => toast(e.message)), 600);
  };
  const move = (from, to) => setAg((a) => {
    if (to < 0 || to >= a.blocks.length || from === to) return a;
    const blocks = [...a.blocks]; const [b] = blocks.splice(from, 1); blocks.splice(to, 0, b);
    return schedule({ ...a, blocks });
  });
  const remove = (bid) => { setAg((a) => schedule({ ...a, blocks: a.blocks.filter((b) => b.id !== bid) })); };
  /* a new item goes where it belongs: a standard item back at its usual place, anything else straight after the speeches */
  const addBlock = (b) => setAg((a) => {
    const blocks = [...a.blocks], std = data.catalog.map((c) => c.id), pos = std.indexOf(b.id);
    let at = blocks.findIndex((x) => x.type === 'speeches') + 1;
    if (pos >= 0) { at = 0; for (let k = pos - 1; k >= 0; k--) { const j = blocks.findIndex((x) => x.id === std[k]); if (j >= 0) { at = j + 1; break; } } }
    else if (at === 0) at = Math.max(0, blocks.length - (blocks.at(-1)?.id === 'adjourn' ? 1 : 0));
    blocks.splice(at, 0, b);
    return schedule({ ...a, blocks });
  });

  /* dragging: hold the grip and move; the row follows the pointer and the others make room */
  const startDrag = (e, bid) => {
    e.preventDefault();
    setDrag(bid);
    const onMove = (ev) => {
      const list = agRef.current.blocks, from = list.findIndex((b) => b.id === bid);
      let to = from;
      list.forEach((b, i) => { const el = rows.current[b.id]; if (!el || b.id === bid) return; const r = el.getBoundingClientRect(), mid = r.top + r.height / 2; if (i < from && ev.clientY < mid) to = Math.min(to, i); if (i > from && ev.clientY > mid) to = Math.max(to, i); });
      if (to !== from) move(from, to);
    };
    const onUp = () => { setDrag(null); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  };

  const download = async (ext) => {
    setBusy(ext);
    try {
      await api(`/vpe/meetings/${id}/agenda`, { method: 'PUT', body: ag });
      const res = await fetch(`/api/vpe/meetings/${id}/agenda.${ext}`, { headers: { 'x-token': getToken() } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not build the agenda');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `Agenda ${mt.number}.${ext}`;
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      toast(ext === 'pdf' ? 'PDF downloaded' : 'Word file downloaded');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const asStandard = async () => {
    try { await api(`/vpe/meetings/${id}/agenda`, { method: 'PUT', body: ag }); await api('/vpe/agenda-standard', { method: 'PUT', body: ag }); toast('New agendas will start from this layout'); reload(); } catch (e) { toast(e.message); }
  };
  const reset = async (what) => {
    if (what === 'all' && !window.confirm(data.standard ? 'Put this agenda back to your club standard?' : 'Put this agenda back to the standard layout?')) return;
    try { await api(`/vpe/meetings/${id}/agenda`, { method: 'PUT', body: ag }); await api(`/vpe/meetings/${id}/agenda/reset`, { method: 'POST', body: { what } }); setPin({}); reload(); toast(what === 'times' ? 'Fixed times cleared' : 'Agenda reset'); } catch (e) { toast(e.message); }
  };
  const clearStandard = async () => { try { await api('/vpe/agenda-standard', { method: 'DELETE' }); toast('Back to the built-in layout for new agendas'); reload(); } catch (e) { toast(e.message); } };

  const inOrder = new Set(ag.blocks.map((b) => b.id));
  const back = data.catalog.filter((c) => !inOrder.has(c.id));
  const pinned = ag.blocks.some((b) => b.at);
  const R = ag.roles;
  const roleRows = [['Toastmaster', R.tmod], ['General Evaluator', R.ge], ['Grammarian', R.grammarian], ['Ah Counter', R.ah], ['Timer', R.timer], ['Table Topics Master', R.ttm]];
  const Who = ({ value, onChange }) => (
    <Select sm value={value || ''} onChange={onChange} placeholder="Who" searchable
      options={value && !ownerOptions.some((o) => o.value === value) ? [{ value, label: value }, ...ownerOptions] : ownerOptions}
      addLabel="Someone else…" onAdd={() => { const v = window.prompt('Who is taking this part?'); if (v && v.trim()) onChange(v.trim()); }} />
  );

  const row = (b, i) => {
    const sp = b.type === 'speeches', rp = b.type === 'reports';
    return (
      <li key={b.id} ref={(el) => { rows.current[b.id] = el; }} className={'ag2-row' + (drag === b.id ? ' drag' : '') + (sp ? ' sp' : '')}>
        <div className="ag2-main">
          <button type="button" className="ag2-grip" onPointerDown={(e) => startDrag(e, b.id)} aria-label={`Drag ${b.title || 'item'} to move it`} title="Drag to move"><Grip /></button>
          <span className="ag2-t">
            <b>{shown(b.time)}</b>
            {!sp && (b.at || pin[b.id]
              ? <button type="button" className="ag2-pin on" onClick={() => { setBlock(b.id, { at: undefined }); setPin((p) => ({ ...p, [b.id]: false })); }} title="Let the time follow the items above" aria-label="Stop fixing this time">{I.clock}</button>
              : <button type="button" className="ag2-pin" onClick={() => { setBlock(b.id, { at: b.time }); setPin((p) => ({ ...p, [b.id]: true })); }} title="Fix this item to a set time" aria-label="Fix this time">{I.clock}</button>)}
          </span>
          {sp ? <span className="ag2-title"><b>Prepared speeches</b><small>{ag.speeches.length ? `${ag.speeches.length} ${ag.speeches.length === 1 ? 'speaker' : 'speakers'}, each speech’s longest time plus ${ag.buffer} min` : 'Nobody on the roster yet'}</small></span>
            : <input className="inp ag2-title-in" value={b.title} placeholder="Title" aria-label="Title" onChange={(e) => setBlock(b.id, { title: e.target.value })} />}
          <span className="ag2-acts">
            {!sp && !rp && b.topic === undefined && <button type="button" onClick={() => setBlock(b.id, { topic: '' })} aria-label="Add a topic line under the title" title="Add a topic line under the title">{I.pencil}</button>}
            <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up"><Arrow up /></button>
            <button type="button" onClick={() => move(i, i + 1)} disabled={i === ag.blocks.length - 1} aria-label="Move down"><Arrow /></button>
            <button type="button" className="rm" onClick={() => remove(b.id)} aria-label={`Remove ${b.title || 'item'}`} title="Remove from the agenda">{I.bin}</button>
          </span>
        </div>
        {!sp && (
          <div className="ag2-sub">
            <Step value={b.min} onChange={(v) => setBlock(b.id, { min: v })} label="length" step={b.min >= 15 ? 5 : 1} />
            <Who value={b.owner} onChange={(v) => setBlock(b.id, { owner: v })} />
            {b.at || pin[b.id] ? <span className="ag2-fixed"><TimeBox value={b.at || b.time} onChange={(v) => setBlock(b.id, { at: v })} label="Fixed start time" /></span> : null}
            {b.topic !== undefined && <input className="inp ag2-note" value={b.topic} placeholder="Topic or note under the title" aria-label="Topic" onChange={(e) => setBlock(b.id, { topic: e.target.value })} />}
          </div>
        )}
        {rp && (
          <div className="ag2-detail">
            <small>Reports</small>
            <div className="ag2-reps">{ag.reports.items.map((r, k) => <label key={r.role}><span>{r.role}</span><input className="inp ag-in" value={r.min} onChange={(e) => set({ reports: { ...ag.reports, items: ag.reports.items.map((x, j) => (j === k ? { ...x, min: e.target.value } : x)) } })} /></label>)}</div>
          </div>
        )}
        {sp && (
          <div className="ag2-detail">
            {!ag.speeches.length && <p className="ag2-empty">Assign speakers on the roster and they appear here, with the project and evaluator filled in.</p>}
            {ag.speeches.map((s) => (
              <div className="ag2-sp" key={s.role_id}>
                <button type="button" className="ag2-sp-h" aria-expanded={!!open[s.role_id]} onClick={() => setOpen((o) => ({ ...o, [s.role_id]: !o[s.role_id] }))}>
                  <b>{shown(s.time)}</b><span>{s.name}</span><em>{s.project_name || 'Project to be confirmed'}</em><i className={open[s.role_id] ? 'up' : ''}>{I.down}</i>
                </button>
                {open[s.role_id] && (
                  <div className="ag2-sp-b">
                    <div className="two"><div><label className="fl" style={{ marginTop: 0 }}>Path and code</label><input className="inp ag-in" value={s.project_line || ''} onChange={(e) => setSpeech(s.role_id, { project_line: e.target.value })} /></div>
                      <div><label className="fl" style={{ marginTop: 0 }}>Project</label><input className="inp ag-in" value={s.project_name || ''} onChange={(e) => setSpeech(s.role_id, { project_name: e.target.value })} /></div></div>
                    <div className="two"><div><label className="fl">Speech title</label><input className="inp ag-in" value={s.title || ''} onChange={(e) => setSpeech(s.role_id, { title: e.target.value })} /></div>
                      <div><label className="fl">Length shown</label><input className="inp ag-in" value={s.length || ''} onChange={(e) => setSpeech(s.role_id, { length: e.target.value })} placeholder="5 - 7 min" /></div></div>
                    <label className="fl">Evaluator</label><input className="inp ag-in" value={s.evaluator || ''} onChange={(e) => setSpeech(s.role_id, { evaluator: e.target.value })} />
                    <p className="ag2-slot">Slot {maxMinutes(s.length)} min + {ag.buffer} min buffer</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </li>
    );
  };

  const over = ag.over;
  const plan = (
    <div className="ag2-plan">
      <div className="ag2-card">
        <div className="ag2-set">
          <label><span>Starts</span><TimeBox value={ag.start} onChange={(v) => set({ start: v })} label="Meeting start time" /></label>
          <label><span>Between speeches</span><Step value={ag.buffer} onChange={(v) => set({ buffer: v })} max={20} label="buffer" /></label>
          <label><span>Between items</span><Step value={ag.gap} onChange={(v) => set({ gap: v })} max={10} label="gap" /></label>
          <label><span>Chairperson</span>
            <Select sm value={ag.chair || ''} onChange={(v) => set({ chair: v })} placeholder="Not named" searchable
              options={[{ value: '', label: 'Not named' }, ...names.map((n) => ({ value: n, label: n }))]} /></label>
          <label><span>Should end by</span><TimeBox value={ag.end} onChange={(v) => set({ end: v })} allowEmpty ph="Optional" label="Latest finish" /></label>
        </div>
        <div className={'ag2-end' + (over > 0 ? ' late' : '')}>
          <span>{I.clock}</span>
          <b>Ends {shown(ag.ends)}</b>
          <small>{over === null ? `${clock(toMinutes(ag.ends) - toMinutes(ag.start))} in all` : over > 0 ? `${over} min past your ${shown(ag.end)} finish` : over < 0 ? `${-over} min before your ${shown(ag.end)} finish` : `right on ${shown(ag.end)}`}</small>
          {!fits && <em>Too long for one page. Trim an item or two.</em>}
        </div>
      </div>

      <div className="ag2-card">
        <div className="ag2-h"><h2>Running order</h2><p>Drag the handle, or use the arrows. Times follow on by themselves.</p></div>
        <ol className="ag2-list">{ag.blocks.map(row)}</ol>
        <div className="ag2-add">
          <span>Add</span>
          {data.extras.map((x) => <button type="button" key={x.kind} onClick={() => addBlock({ ...x.block, id: uid(x.kind) })}>{I.plus}{x.label}</button>)}
          {back.map((c) => <button type="button" key={c.id} onClick={() => addBlock({ ...c })}>{I.plus}{c.type === 'speeches' ? 'Prepared speeches' : c.title}</button>)}
        </div>
      </div>

      <div className="ag2-card">
        <div className="ag2-h"><h2>Heading</h2><p>Role takers come from the roster. <Link className="lnk" to={`/v/meetings/${id}`}>Change them there.</Link></p></div>
        <div className="dgrid" style={{ gap: 24 }}>
          <div>
            <label className="fl" style={{ marginTop: 0 }}>Theme</label><input className="inp" value={mt.theme || ''} onChange={(e) => setMeta({ theme: e.target.value })} />
            <label className="fl">Theme quotation</label><textarea className="inp" style={{ minHeight: 58 }} value={mt.theme_quote || ''} onChange={(e) => setMeta({ theme_quote: e.target.value })} placeholder="Without quote marks" />
            <label className="fl">Quotation by</label><input className="inp" value={mt.theme_quote_by || ''} onChange={(e) => setMeta({ theme_quote_by: e.target.value })} placeholder="e.g. Navi Pillay" />
          </div>
          <div>
            <label className="fl" style={{ marginTop: 0 }}>Next meeting date</label><DatePick value={ag.next_meeting} onChange={(v) => set({ next_meeting: v })} />
            <div className="agroles" style={{ marginTop: 16 }}>{roleRows.map(([l, n]) => <div key={l}><small>{l}</small><b>{n || <span style={{ color: 'var(--maroon)' }}>Not assigned</span>}</b></div>)}</div>
          </div>
        </div>
      </div>

      <div className="ag2-more">
        <button type="button" className="lnk" onClick={asStandard}>Use this layout for all new agendas</button>
        {data.standard && <button type="button" className="lnk" onClick={clearStandard}>Stop using a club standard</button>}
        {pinned && <button type="button" className="lnk" onClick={() => reset('times')}>Clear fixed times</button>}
        {data.edited && <button type="button" className="lnk" onClick={() => reset('all')}>Reset this agenda</button>}
      </div>
    </div>
  );

  const prev = (
    <div className="ag2-prev">
      {preview ? <iframe title="Agenda preview" src={`${preview}#toolbar=0&navpanes=0&view=FitH`} /> : <div className="ag2-wait">Preparing the preview…</div>}
    </div>
  );

  return (
    <Page title="Roster" wide full back={`/v/meetings/${id}`}>
      <div className="rpage ag2">
        <div className="rhead">
          <div>
            <p className="reyebrow">Meeting {mt.number} · {fmtDate(mt.date)}</p>
            <h1 className="rtitle">Agenda</h1>
            <p className="rsub">Arrange the running order and see the agenda as you go. What you see is what you download.</p>
          </div>
          <div className="ag2-dl">
            <span className="saving">{save}</span>
            <Btn kind="ghost" onClick={() => download('docx')} disabled={!!busy}>{busy === 'docx' ? 'Preparing…' : 'Word'}</Btn>
            <Btn onClick={() => download('pdf')} disabled={!!busy}>{I.dl} {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</Btn>
          </div>
        </div>
        {desk ? (
          <div className="ag2-cols">{plan}{prev}</div>
        ) : (
          <>
            <div className="ag2-tabs"><div className="seg" role="tablist">{[['plan', 'Plan'], ['preview', 'Preview']].map(([v, l]) => <button type="button" key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>)}</div></div>
            {tab === 'plan' ? plan : prev}
          </>
        )}
      </div>
    </Page>
  );
}

const toMinutes = (t) => (+String(t).slice(0, 2)) * 60 + (+String(t).slice(2));
