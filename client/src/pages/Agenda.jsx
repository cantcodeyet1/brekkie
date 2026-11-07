import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getToken, useApi } from '../api.js';
import { fmtDate, longDate } from '../data.js';
import { Btn, Chip, DatePick, ErrorMsg, Foot, I, Loading, Page, useDebouncedSave, useDesk, useToast } from '../ui.jsx';

/* The agenda is the club's own Word template, filled in from this page. Everything here can be edited;
   roles, speakers and evaluators come from the meeting and update themselves unless you change them. */
export default function Agenda() {
  const { id } = useParams();
  const desk = useDesk();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/vpe/meetings/${id}/agenda`);
  const [ag, setAg] = useState(null);
  const [mt, setMt] = useState(null);
  const [save, setSave] = useState('');
  const [busy, setBusy] = useState(false);
  const metaTimer = useRef(), startTimer = useRef(), agRef = useRef(null);
  useEffect(() => { if (data) { setAg(data.agenda); setMt(data.meeting); } }, [data]);
  agRef.current = ag;

  useDebouncedSave(async () => {
    try { setSave('Saving…'); await api(`/vpe/meetings/${id}/agenda`, { method: 'PUT', body: ag }); setSave('Saved'); } catch { setSave('Not saved'); }
  }, [ag]);

  if (loading || !ag) return <Page title="Agenda" wide back={`/v/meetings/${id}`}><Loading /></Page>;
  if (error) return <Page title="Agenda" wide back={`/v/meetings/${id}`}><ErrorMsg error={error} /></Page>;

  const setMeta = (patch) => {
    setMt((x) => ({ ...x, ...patch }));
    clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => api(`/vpe/meetings/${id}`, { method: 'PATCH', body: patch }).catch((e) => toast(e.message)), 600);
  };
  const upd = (key, i, patch) => setAg((a) => ({ ...a, [key]: a[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const updRep = (i, patch) => setAg((a) => ({ ...a, reports: { ...a.reports, items: a.reports.items.map((r, j) => (j === i ? { ...r, ...patch } : r)) } }));

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
  // changing the start time moves the whole running order, so recalculate once they stop typing
  const changeStart = (v) => {
    const t = v.replace(/\D/g, '').slice(0, 4);
    setAg((x) => ({ ...x, start: t }));
    clearTimeout(startTimer.current);
    if (t.length === 4) startTimer.current = setTimeout(async () => {
      try { await api(`/vpe/meetings/${id}/agenda`, { method: 'PUT', body: { ...agRef.current, start: t } }); const r = await api(`/vpe/meetings/${id}/agenda/reset`, { method: 'POST', body: { what: 'times' } }); setAg(r.agenda); toast('Times updated from the start time'); } catch (e) { toast(e.message); }
    }, 900);
  };
  const recalc = async () => { await api(`/vpe/meetings/${id}/agenda`, { method: 'PUT', body: ag }); const r = await api(`/vpe/meetings/${id}/agenda/reset`, { method: 'POST', body: { what: 'times' } }); setAg(r.agenda); toast('Times recalculated from the start time'); };
  const reset = async () => { if (!window.confirm('Put the whole agenda back to the template defaults?')) return; const r = await api(`/vpe/meetings/${id}/agenda/reset`, { method: 'POST', body: { what: 'all' } }); setAg(r.agenda); reload(); toast('Agenda reset'); };

  const T = ({ v, on, w = 64, ph, label }) => <input className="inp ag-in mono" style={desk ? { width: w } : null} value={v || ''} placeholder={ph} aria-label={label} onChange={(e) => on(e.target.value)} />;
  const progRow = (key, it, i) => (
    <div className="agrow" key={key + i}>
      <T v={it.time} on={(v) => upd(key, i, { time: v.replace(/\D/g, '').slice(0, 4) })} label="Time" ph="1800" />
      <input className="inp ag-in grow" value={it.title || ''} onChange={(e) => upd(key, i, { title: e.target.value })} aria-label="Item" />
      <T v={it.min} on={(v) => upd(key, i, { min: v })} w={84} label="Length" ph="5 min" />
      <input className="inp ag-in own" value={it.owner || ''} onChange={(e) => upd(key, i, { owner: e.target.value })} aria-label="Who" placeholder="Who" />
    </div>
  );
  const R = ag.roles;
  const roleRows = [['Toastmaster of the Day', R.tmod], ['General Evaluator', R.ge], ['Grammarian', R.grammarian], ['Ah Counter', R.ah], ['Timer', R.timer], ['Table Topics Master', R.ttm]];

  return (
    <Page title={`Meeting ${mt.number}`} wide back={`/v/meetings/${id}`}
      foot={<Foot><span className="saving">{save}</span>
        <Btn kind="ghost" onClick={recalc}>Recalculate times</Btn>
        <Btn kind="ghost" onClick={() => download('docx')} disabled={!!busy}>{busy === 'docx' ? 'Preparing…' : 'Word (.docx)'}</Btn>
        <Btn onClick={() => download('pdf')} disabled={!!busy}>{I.dl} {busy === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}</Btn></Foot>}>
      <h1 className="pg sm">Agenda · No. {mt.number}, {fmtDate(mt.date)}</h1>
      <p className="lede" style={{ maxWidth: 640 }}>This fills in your club’s agenda template. The club mission, officers and banner stay as they are in the template. Change anything below, then download.</p>

      <div className="lab">Heading</div>
      <div className="dgrid" style={{ gap: 28 }}>
        <div>
          <label className="fl" style={{ marginTop: 0 }}>Theme</label><input className="inp" value={mt.theme || ''} onChange={(e) => setMeta({ theme: e.target.value })} />
          <label className="fl">Theme quotation</label><textarea className="inp" style={{ minHeight: 58 }} value={mt.theme_quote || ''} onChange={(e) => setMeta({ theme_quote: e.target.value })} placeholder="Without quote marks" />
          <label className="fl">Quotation by</label><input className="inp" value={mt.theme_quote_by || ''} onChange={(e) => setMeta({ theme_quote_by: e.target.value })} placeholder="e.g. Navi Pillay" />
        </div>
        <div>
          <div className="two">
            <div><label className="fl" style={{ marginTop: 0 }}>Meeting starts (hhmm)</label><input className="inp mono" value={ag.start} maxLength={4} inputMode="numeric" onChange={(e) => changeStart(e.target.value)} /></div>
            <div><label className="fl" style={{ marginTop: 0 }}>Next meeting date</label><DatePick value={ag.next_meeting} onChange={(v) => setAg((a) => ({ ...a, next_meeting: v }))} /></div>
          </div>
          <p style={{ margin: '12px 0 0', color: 'var(--mute)', fontSize: 14 }}>Word of the day <b style={{ color: 'var(--ink)' }}>{mt.word || 'not set'}</b>. Edit it on the <Link className="lnk" to={`/v/meetings/${id}`}>meeting page</Link>.</p>
        </div>
      </div>

      <div className="lab">Role takers <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(change them in Roles)</span></div>
      <div className="agroles">{roleRows.map(([l, n]) => <div key={l}><small>{l}</small><b>{n || <span style={{ color: 'var(--maroon)' }}>Not assigned</span>}</b></div>)}</div>

      <div className="lab">Opening</div>
      {ag.opening.map((it, i) => progRow('opening', it, i))}

      <div className="lab">Prepared speeches</div>
      {!ag.speeches.length && <p className="lede" style={{ fontSize: 14.5 }}>No speakers assigned yet. Assign them in Roles and they appear here.</p>}
      {ag.speeches.map((s, i) => (
        <div className="agspeech" key={s.role_id}>
          <div className="agrow">
            <T v={s.time} on={(v) => upd('speeches', i, { time: v.replace(/\D/g, '').slice(0, 4) })} label="Time" ph="1820" />
            <div className="grow"><b style={{ font: '700 15px var(--head)' }}>{s.name}</b></div>
            <input className="inp ag-in own" value={s.evaluator || ''} onChange={(e) => upd('speeches', i, { evaluator: e.target.value })} aria-label="Evaluator" placeholder="Evaluator" />
          </div>
          <div className="two" style={{ marginTop: 6 }}>
            <input className="inp ag-in" value={s.project_line || ''} onChange={(e) => upd('speeches', i, { project_line: e.target.value })} aria-label="Path and project code" placeholder="Presentation Mastery (L2P2)" />
            <input className="inp ag-in" value={s.project_name || ''} onChange={(e) => upd('speeches', i, { project_name: e.target.value })} aria-label="Project name" placeholder="Project name" />
          </div>
          <div className="two" style={{ marginTop: 6 }}>
            <input className="inp ag-in" value={s.title || ''} onChange={(e) => upd('speeches', i, { title: e.target.value })} aria-label="Speech title" placeholder="Speech title" />
            <input className="inp ag-in" value={s.length || ''} onChange={(e) => upd('speeches', i, { length: e.target.value })} aria-label="Length" placeholder="5 - 7 min" />
          </div>
        </div>
      ))}

      <div className="lab">Rest of the meeting</div>
      {ag.closing.map((it, i) => (
        <div key={i}>
          {progRow('closing', it, i)}
          {it.kind === 'reports' && (
            <div className="agreports">
              <small>Top table reports</small>
              <div className="two" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
                <div><label className="fl" style={{ marginTop: 0 }}>Total</label><input className="inp ag-in" value={ag.reports.total} onChange={(e) => setAg((a) => ({ ...a, reports: { ...a.reports, total: e.target.value } }))} /></div>
                {ag.reports.items.map((r, k) => <div key={r.role}><label className="fl" style={{ marginTop: 0 }}>{r.role}</label><input className="inp ag-in" value={r.min} onChange={(e) => updRep(k, { min: e.target.value })} /></div>)}
              </div>
            </div>)}
        </div>
      ))}
      <p style={{ margin: '24px 0 0' }}><button type="button" className="lnk" onClick={reset}>Reset everything to the template defaults</button></p>
    </Page>
  );
}
