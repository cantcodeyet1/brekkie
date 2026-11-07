import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { CARDTXT, CRIT, DEFAULT_FILLERS, GE_SECTIONS, LEVELN, ROLE_META, SCRIPTS, TIMER, cardOf, cap, longDate, mmss, secs, sum } from '../data.js';
import { printEval } from '../EvalSheet.jsx';
import { Btn, Chip, ErrorMsg, Foot, I, Loading, Modal, Page, PersonSelect, Select, Seg, Shell, Wcard, Wordmark, useDebouncedSave, useDesk } from '../ui.jsx';

/* ───────── helpers ───────── */
const fill = (t, v) => t.split(/(\{\w\})/).map((p, i) => { const m = /^\{(\w)\}$/.exec(p); return m ? <em key={i}>{v[m[1]] || '…'}</em> : p; });
const sheetProjectThr = (projects, id) => { const p = projects.find((x) => x.id === id); return p ? [p.green, p.yellow, p.red] : TIMER.Speaker; };
const rowThr = (r, projects) => r.kind === 'Speaker' ? sheetProjectThr(projects, r.project_id) : r.kind === 'Other' ? (() => { const mn = secs(r.min) || 60, mx = secs(r.max) || 120; return [mn, Math.round((mn + mx) / 2), mx]; })() : TIMER[r.kind] || TIMER.Evaluator;

function initSheet(data) {
  const key = data.role.key, saved = data.sheet || {};
  const speakers = data.roles.filter((r) => r.role_key === 'speaker' && r.person_id);
  const subjectRows = (extra) => speakers.map((s) => ({ subject_id: s.person_id, ...extra }));
  if (key === 'grammarian') return { rows: saved.rows?.length ? saved.rows : subjectRows({ used: false, uses: 0, liked: '', improper: '', suggestion: '' }) };
  if (key === 'ah_counter') return { fillers: saved.fillers || DEFAULT_FILLERS.map(([k, l]) => ({ k, l, custom: false })), rows: saved.rows?.length ? saved.rows : subjectRows({ counts: {}, comment: '' }) };
  if (key === 'timer') {
    const agenda = data.roles.filter((r) => r.person_id && (r.role_key === 'speaker' || r.role_key === 'evaluator' || r.role_key === 'general_evaluator'))
      .map((r) => ({ subject_id: r.person_id, label: r.label, kind: r.role_key === 'speaker' ? 'Speaker' : 'Evaluator', project_id: r.project_id, fixed: true }));
    const old = saved.rows || [];
    const rows = agenda.map((a) => { const o = old.find((x) => x.fixed && x.subject_id === a.subject_id && x.label === a.label); return { ...a, seconds: o?.seconds ?? null, comment: o?.comment || '' }; });
    return { rows: [...rows, ...old.filter((x) => !x.fixed)] };
  }
  if (key === 'topicsmaster') {
    const t = Array.isArray(saved.topics) ? saved.topics : String(saved.topics || '').split('\n').map((x) => x.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    return { topics: t.length ? t : [''], rows: saved.rows?.length ? saved.rows : [{ subject_id: null, topic: '' }] };
  }
  if (key === 'evaluator') return { ratings: saved.ratings || Array(7).fill(0), comments: saved.comments || Array(7).fill(''), open: saved.open || Array(7).fill(false), excelled: saved.excelled || '', work: saved.work || '', challenge: saved.challenge || '', seconds: saved.seconds ?? null };
  if (key === 'general_evaluator') return { sections: saved.sections?.length === GE_SECTIONS.length ? saved.sections : GE_SECTIONS.map(([, qs]) => ({ a: qs.map(() => null), notes: '' })), comments: saved.comments || [] };
  return saved;
}

/* the evaluation resource: blank for the evaluator to take along, completed once they have filled it in */
function evalDoc(data, sheet, people, blank) {
  const target = data.roles.find((x) => x.id === data.role.target_role_id), proj = target && data.projects.find((p) => p.id === target.project_id);
  if (!target?.person_id || !proj) return null;
  return {
    form_title: proj.form_title, project: proj.name, member: people.find((p) => p.id === target.person_id)?.name || '', date: data.meeting.date, by: data.me?.name || '',
    length_text: proj.length_text, title: target.speech_title || '', purpose: proj.purpose || [], notes: proj.notes || proj.overview || '', about: proj.about || [],
    ratings: blank ? [] : sheet.ratings, comments: blank ? [] : sheet.comments, excelled: blank ? '' : sheet.excelled, work: blank ? '' : sheet.work, challenge: blank ? '' : sheet.challenge,
  };
}
/* the greeting follows the meeting date, since a link can arrive days ahead */
function greeting(date, role) {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = Math.round((new Date(date + 'T12:00:00') - new Date(key(new Date()) + 'T12:00:00')) / 864e5);
  const r = <span>{role}</span>;
  const when = new Date(date + 'T12:00:00');
  if (days === 0) return <>you’re tonight’s {r}.</>;
  if (days === 1) return <>you’re tomorrow’s {r}.</>;
  if (days > 1 && days < 7) return <>you’re {when.toLocaleDateString('en-GB', { weekday: 'long' })}’s {r}.</>;
  if (days >= 7) return <>you’re the {r} on {when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</>;
  return <>thank you for being the {r} on {when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</>;
}

/* ───────── entry ───────── */
export default function RoleApp() {
  const { token } = useParams();
  const { data, error, loading } = useApi('/role', { token });
  if (loading) return <Shell nav={[]} who="" bare><div className="main"><div className="rwel"><Wordmark className="wm-light" /></div></div></Shell>;
  if (error) return <Shell nav={[]} who="" bare><Page root><h1 className="pg">This link is not valid</h1><p className="lede">It may have been replaced by a newer one. Ask the VPE to send your link again.</p></Page></Shell>;
  return <Shell nav={[]} who={data.me?.name || ''} noSide bare><RoleBody data={data} token={token} /></Shell>;
}

/* shown to visitors: one tap tells the VPE, and opens a ready-written WhatsApp message to them */
const VPE_WHATSAPP = '263719373950';
export function JoinAsk({ data, token, dark, endpoint = '/role/join-request' }) {
  const [asked, setAsked] = useState(!!data.me?.join_requested);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (data.me?.kind !== 'guest') return null;
  const wa = () => `https://wa.me/${VPE_WHATSAPP}?text=${encodeURIComponent(`Hi, it's ${data.me.name}. I enjoyed being a visitor at Champions Toastmasters Club and would like to join as a member. What are the next steps?`)}`;
  const send = async () => {
    const win = window.open('', '_blank');           // opened on the tap so the browser lets it through
    setBusy(true); setErr('');
    try { await api(endpoint, { method: 'POST', body: {}, token }); setAsked(true); } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
    if (win) win.location.href = wa(); else window.location.href = wa();
  };
  return (
    <div className={'joinask' + (dark ? ' dark' : '')}>
      <span className="jic" aria-hidden="true">{I.ppl}</span>
      <div className="jtx">
        <b>{asked ? 'Thanks, your VPE knows.' : 'Want to join Champions?'}</b>
        <span>{asked ? 'They will make you a member of Champions Toastmasters Club.' : 'One tap tells the VPE and opens a message to them on WhatsApp.'}</span>
        {err && <p className="err">{err}</p>}
        {asked
          ? <a className="jbtn ghost" href={wa()} target="_blank" rel="noreferrer">Message the VPE again</a>
          : <button type="button" className="jbtn" onClick={send} disabled={busy}>{busy ? 'One moment…' : 'I would like to join'}</button>}
      </div>
    </div>
  );
}

function RoleBody({ data, token }) {
  const key = data.role.key, meta = ROLE_META[key];
  const [view, setView] = useState('land');
  const [mode, setMode] = useState('script');
  const [people, setPeople] = useState(data.people);
  const [sheet, setSheet] = useState(() => initSheet(data));
  const [save, setSave] = useState('');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(!!data.role.submitted_at);
  const addGuest = async (name) => {
    const g = await api('/people/guest', { method: 'POST', body: { name }, token });
    setPeople((p) => (p.some((x) => x.id === g.id) ? p : [...p, g].sort((a, b) => a.name.localeCompare(b.name))));
    return g;
  };
  useDebouncedSave(async () => {
    try { setSave('Saving…'); await api('/role/sheet', { method: 'PUT', body: sheet, token }); setSave('Saved'); } catch { setSave('Not saved. Check your connection.'); }
  }, [sheet]);
  const submit = async () => {
    setConfirm(false);
    try { await api('/role/submit', { method: 'POST', body: sheet, token }); setSubmitted(true); setView('done'); } catch (e) { setErr(e.message); }
  };
  const first = (data.me?.name || '').split(' ')[0];
  const desk = useDesk();
  const [dlBusy, setDlBusy] = useState(false);
  const downloadPdf = async () => {
    if (key === 'evaluator') { const d = evalDoc(data, sheet, people, false); if (d) printEval(d); return; }
    // the official Toastmasters International script and log, filled in with these notes
    setDlBusy(true); setErr('');
    try {
      const res = await fetch('/api/role/report.pdf', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': token }, body: JSON.stringify(sheet) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not make the PDF');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${meta.name}.pdf`;
      const url = URL.createObjectURL(await res.blob()), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { setErr(e.message); } finally { setDlBusy(false); }
  };
  const pdfTitle = key === 'evaluator' ? 'Completed evaluation form' : 'Official report (PDF)';
  const pdfSub = key === 'evaluator' ? 'Your ratings and comments, as a PDF' : dlBusy ? 'Filling in the official form…' : 'Your notes on the Toastmasters International form';
  const ctx = { data, sheet, setSheet, people, addGuest, mode };
  // swipe sideways to move between script, notes and report
  const touch = useRef(null);
  const swipe = {
    start: (e) => { const t = e.touches[0]; touch.current = e.target.closest('input,textarea,select,.stage,[data-noswipe]') ? null : { x: t.clientX, y: t.clientY }; },
    end: (e) => {
      const s0 = touch.current; touch.current = null; if (!s0) return;
      const t = e.changedTouches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const order = ['script', 'notes', 'report'], i = order.indexOf(mode), n = order[Math.max(0, Math.min(2, i + (dx < 0 ? 1 : -1)))];
      if (n !== mode) { setMode(n); document.querySelector('.scroll')?.scrollTo({ top: 0 }); }
    },
  };

  if (view === 'land') return (
    <div className="main">
      <div className="rwel">
        <Wordmark className="wm-light" />
        <div className="rwel-in">
          <div className="tag">Meeting {data.meeting.number} · {longDate(data.meeting.date)}</div>
          <h1>Hi {first}, {greeting(data.meeting.date, data.role.label.replace(/ \d$/, ''))}</h1>
          <p className="sub">{meta?.blurb}</p>
          {data.me?.kind === 'guest' && <p className="rwel-note">Welcome as a visitor. Your access is temporary and your notes are kept with {data.club || 'the club'}.</p>}
          {submitted && <JoinAsk data={data} token={token} dark />}
          <button type="button" className="rwel-go" onClick={() => setView('sheet')}>{submitted ? 'View or edit my notes' : 'Open my sheet'}</button>
        </div>
      </div>
    </div>
  );
  if (view === 'done') return (
    <div className="main">
      <div className="rwel done-full">
        <Wordmark className="wm-light" />
        <div className="rwel-in">
          <div className="tickbig">{I.check}</div>
          <h1>Thanks, {first}.</h1>
          <p className="sub">Your {meta.name.toLowerCase()} notes are in. Members will find them in their history from now on. You can open your link again at any time to edit them.</p>
          <JoinAsk data={data} token={token} dark />
          <div className="done-btns">
            <button type="button" className="rwel-go" onClick={downloadPdf} disabled={dlBusy}>{key === 'evaluator' ? 'Download my evaluation (PDF)' : dlBusy ? 'Filling in the form…' : 'Download the official report (PDF)'}</button>
            <button type="button" className="rwel-go ghost" onClick={() => setView('sheet')}>Edit my notes</button>
          </div>
          {err && <p className="err" style={{ color: '#ffd6d6' }}>{err}</p>}
        </div>
      </div>
    </div>
  );

  const Sheet = { grammarian: GramSheet, ah_counter: AhSheet, timer: TimeSheet, topicsmaster: TTSheet, evaluator: EvalForm, general_evaluator: GESheet }[key];
  return (
    <Page title={meta.name} narrow onBack={() => setView('land')} foot={<Foot><span className="saving">{save}</span><Btn onClick={() => setConfirm(true)}>{submitted ? 'Update my notes' : 'Submit notes'}</Btn></Foot>}>
      <h1 className="pg sm">{meta.name}</h1>
      <div className="meta"><span>{data.me?.name}</span><span>Meeting {data.meeting.number} · {longDate(data.meeting.date)}</span></div>
      {(
        <div className="modebar">
          <div className="modes" role="tablist" aria-label="View">
            {[['script', 'Script'], ['notes', 'Notes'], ['report', 'Report']].map(([k, l]) => <button type="button" role="tab" aria-selected={mode === k} key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); document.querySelector('.scroll')?.scrollTo({ top: 0 }); }}>{l}</button>)}
          </div>
        </div>
      )}
      <div className="swipe" onTouchStart={swipe.start} onTouchEnd={swipe.end}><Sheet {...ctx} /></div>
      {mode === 'report' && <div style={{ marginTop: 14 }}><DlBtn onClick={downloadPdf} title={pdfTitle} sub={pdfSub} /></div>}
      {err && <p className="err">{err}</p>}
      {confirm && (
        <Modal title={submitted ? 'Update your notes?' : 'Submit your notes?'} onClose={() => setConfirm(false)}>
          <p style={{ margin: '4px 0 0', color: 'var(--mute)', fontSize: 15.5, lineHeight: 1.45 }}>{submitted ? 'Your latest changes replace what members already see.' : 'Members will see what you wrote about them in their history.'} You can open your link again at any time to edit.</p>
          <div className="row-btns"><Btn kind="ghost" onClick={() => setConfirm(false)}>Not yet</Btn><Btn onClick={submit}>{submitted ? 'Yes, update' : 'Yes, submit'}</Btn></div>
        </Modal>
      )}
    </Page>
  );
}

/* ───────── shared bits ───────── */
function Split({ side: refCol, form, wide }) { return <div className={'split ' + (wide ? 'wide' : '')}><aside className="ref">{refCol}</aside><div className="formcol">{form}</div></div>; }
function Script({ k, vars }) {
  const desk = useDesk();
  const [open, setOpen] = useState(null);
  const o = open ?? desk;
  return (
    <div className={'script' + (o ? ' open' : '')}>
      <button type="button" onClick={() => setOpen(!o)} aria-expanded={o}>Your script{I.chev}</button>
      <div className="sb">{SCRIPTS[k].map(([h, t]) => <div key={h}><h5>{h}</h5><p>{fill(t, vars || {})}</p></div>)}</div>
    </div>
  );
}
/* one role, three ways to read it: the script to speak from, the notes to take, the report to give */
function Modes({ mode, script, form, report }) { return mode === 'script' ? script : mode === 'report' ? report : form; }
function ScriptDoc({ k, vars, before }) {
  return (
    <div className="sv">
      {before}
      {SCRIPTS[k].map(([h, t]) => <section key={h}><h5>{h}</h5><p>{fill(t, vars || {})}</p></section>)}
    </div>
  );
}
/* each improper use is paired with its own suggestion, so they stay linked line for line */
const fixesOf = (r) => {
  if (Array.isArray(r.fixes)) return r.fixes;
  const a = String(r.improper || '').split('\n').filter((x) => x.trim()), b = String(r.suggestion || '').split('\n');
  return a.length || String(r.suggestion || '').trim() ? Array.from({ length: Math.max(a.length, b.filter((x) => x.trim()).length) }, (_, i) => ({ improper: a[i] || '', suggestion: b[i] || '' })) : [];
};
const joinNames = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const Rep = ({ title, sub, children }) => <div className="rep"><div className="rep-h"><b>{title}</b>{sub && <span>{sub}</span>}</div>{children}</div>;
const RepLine = ({ label, kind, children }) => children ? <p className="rep-l"><span className={kind || ''}>{label}</span>{children}</p> : null;
const RepEmpty = ({ children }) => <div className="rep-empty">{children || 'Nothing noted yet. Fill in your notes first and they will appear here.'}</div>;
function Block({ i, n, onRemove, children, label = 'PERSON' }) {
  return <div className="blk"><div className="blk-h"><span className="no">{label} {i + 1}</span>{n > 1 && <button type="button" className="x" onClick={onRemove} aria-label="Remove">{I.close}</button>}</div>{children}</div>;
}
const AddRow = ({ onClick, children }) => <button type="button" className="addrow" onClick={onClick}>{I.plus} {children}</button>;
const rowsApi = (setSheet, key = 'rows') => ({
  upd: (i, patch) => setSheet((s) => ({ ...s, [key]: s[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) })),
  del: (i) => setSheet((s) => ({ ...s, [key]: s[key].filter((_, j) => j !== i) })),
  add: (row) => setSheet((s) => ({ ...s, [key]: [...s[key], row] })),
});
/* a note box that grows with what is written, so nothing hides behind a scrollbar */
function Grow({ value, min = 66, ...p }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.max(min, el.scrollHeight + 2) + 'px'; }, [value, min]);
  return <textarea ref={ref} className="inp grow" value={value} {...p} />;
}
const TA = ({ label, kind = '', value, onChange, placeholder, min }) => (
  <><label className={'fl ' + kind}>{label}</label><Grow min={min} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></>
);
const DlBtn = ({ href, onClick, title, sub }) => {
  const inner = <><span className="ic">{I.dl}</span><span className="tx"><b>{title}</b>{sub && <small>{sub}</small>}</span><span className="go">{I.chev}</span></>;
  return href ? <a className="dlbtn" href={href} target="_blank" rel="noreferrer">{inner}</a> : <button type="button" className="dlbtn" onClick={onClick}>{inner}</button>;
};
const subjectName = (people, id) => people.find((p) => p.id === id)?.name || '';

/* ───────── Grammarian ───────── */
function GramSheet({ data, sheet, setSheet, people, addGuest, mode }) {
  const { upd, del, add } = rowsApi(setSheet);
  const m = data.meeting;
  const writeFixes = (x, i, fixes) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, fixes, improper: fixes.map((f) => f.improper).join('\n'), suggestion: fixes.map((f) => f.suggestion).join('\n') } : r)) });
  const setFix = (i, k, patch) => setSheet((x) => writeFixes(x, i, fixesOf(x.rows[i]).map((f, n) => (n === k ? { ...f, ...patch } : f))));
  const addFix = (i) => setSheet((x) => writeFixes(x, i, [...fixesOf(x.rows[i]), { improper: '', suggestion: '' }]));
  const delFix = (i, k) => setSheet((x) => writeFixes(x, i, fixesOf(x.rows[i]).filter((_, n) => n !== k)));
  const bump = (i, d) => setSheet((x) => ({ ...x, rows: x.rows.map((r, j) => { if (j !== i) return r; const n = Math.max(0, (r.uses || 0) + d); return { ...r, uses: n, used: n > 0 }; }) }));
  return (
    <Modes mode={mode}
      script={<ScriptDoc k="grammarian" vars={{ w: m.word, m: m.meaning, x: m.example }} before={<Wcard m={m} />} />}
      report={<GramReport m={m} rows={sheet.rows} people={people} />}
      form={<>
        <div className="lab" style={{ marginTop: 4 }}>Notes by person</div>
        {sheet.rows.map((r, i) => (
          <Block key={i} i={i} n={sheet.rows.length} onRemove={() => del(i)}>
            <PersonSelect value={r.subject_id} onChange={(v) => upd(i, { subject_id: v })} people={people} onAddGuest={addGuest} />
            <div className="wcount" data-noswipe>
              <span>Times they used the word of the day</span>
              <div className="stp"><button type="button" onClick={() => bump(i, -1)} aria-label="One fewer">{I.minus}</button><b>{r.uses || 0}</b><button type="button" onClick={() => bump(i, 1)} aria-label="One more">{I.plus}</button></div>
            </div>
            <TA label="Quote, saying or word you liked" kind="blue" value={r.liked} onChange={(v) => upd(i, { liked: v })} placeholder="What did they say?" />
            <div className="lab maroon" style={{ marginTop: 14 }}>Improper use and its suggestion</div>
            {fixesOf(r).map((fx, k) => (
              <div className="fixrow" key={k}>
                <span className="fixno">{k + 1}</span>
                <div className="fixin">
                  <input className="inp" value={fx.improper} onChange={(e) => setFix(i, k, { improper: e.target.value })} placeholder="What was said" aria-label={`Improper use ${k + 1}`} />
                  <span className="fixarr" aria-hidden="true">{I.chev}</span>
                  <input className="inp" value={fx.suggestion} onChange={(e) => setFix(i, k, { suggestion: e.target.value })} placeholder="A better way to say it" aria-label={`Suggestion ${k + 1}`} />
                </div>
                <button type="button" className="x" onClick={() => delFix(i, k)} aria-label={`Remove correction ${k + 1}`}>{I.close}</button>
              </div>
            ))}
            <button type="button" className="addrow" onClick={() => addFix(i)}>{I.plus} Add an improper use</button>
          </Block>
        ))}
        <AddRow onClick={() => add({ subject_id: null, used: false, uses: 0, liked: '', improper: '', suggestion: '' })}>Add another person</AddRow>
      </>} />
  );
}

/* ───────── Ah Counter ───────── */
function AhSheet({ sheet, setSheet, people, addGuest, mode }) {
  const { upd, del, add } = rowsApi(setSheet);
  const [adding, setAdding] = useState(false);
  const [word, setWord] = useState('');
  const keys = sheet.fillers.map((f) => f.k);
  const addWord = () => {
    const l = word.trim();
    if (l) { const k = l.toLowerCase(); setSheet((s) => (s.fillers.some((f) => f.k === k) ? s : { ...s, fillers: [...s.fillers, { k, l, custom: true }] })); }
    setAdding(false); setWord('');
  };
  const inc = (i, k, d) => setSheet((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, counts: { ...r.counts, [k]: Math.max(0, (r.counts[k] || 0) + d) } } : r)) }));
  return (
    <Modes mode={mode}
      script={<ScriptDoc k="ah_counter" />}
      report={<AhReport sheet={sheet} people={people} />}
      form={<>
        <div className="lab" style={{ marginTop: 4 }}>Words you’re counting</div>
        <div className="pill-row" style={{ marginTop: 0 }}>
          {sheet.fillers.map((f) => <span className="chip" key={f.k}>{f.l}{f.custom && <button type="button" className="xx" onClick={() => setSheet((s) => ({ ...s, fillers: s.fillers.filter((x) => x.k !== f.k) }))} aria-label={`Remove ${f.l}`}>{I.close}</button>}</span>)}
          {adding
            ? <><input className="inp" autoFocus placeholder="e.g. mmm" value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWord()} aria-label="New filler word" /><Btn sm onClick={addWord}>Add</Btn><button type="button" className="x" onClick={() => setAdding(false)} aria-label="Cancel">{I.close}</button></>
            : <button type="button" className="chip" onClick={() => setAdding(true)}>{I.plus} Add a word</button>}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--mute)' }}>Heard something that isn’t listed? Add it and it appears for everyone you’re counting.</p>
        <div className="lab">Count by person</div>
        {sheet.rows.map((r, i) => (
          <Block key={i} i={i} n={sheet.rows.length} onRemove={() => del(i)}>
            <PersonSelect value={r.subject_id} onChange={(v) => upd(i, { subject_id: v })} people={people} onAddGuest={addGuest} />
            <div className="cnts">
              {sheet.fillers.map(({ k, l }) => (
                <div className={'cnt ' + (r.counts[k] ? '' : 'z')} key={k}><small>{l}</small><b>{r.counts[k] || 0}</b>
                  <div><button type="button" onClick={() => inc(i, k, -1)} aria-label={`Minus ${l}`}>{I.minus}</button><button type="button" onClick={() => inc(i, k, 1)} aria-label={`Plus ${l}`}>{I.plus}</button></div></div>
              ))}
            </div>
            <div className="total" style={{ textAlign: 'right', marginTop: 8 }}>Total {sum(r.counts, keys)}</div>
            <TA label="Comment" value={r.comment} onChange={(v) => upd(i, { comment: v })} placeholder={`Anything to tell ${subjectName(people, r.subject_id) || 'them'}? (optional)`} />
          </Block>
        ))}
        <AddRow onClick={() => add({ subject_id: null, counts: {}, comment: '' })}>Add another person</AddRow>
      </>} />
  );
}

/* ───────── Timer ───────── */
function TimeSheet({ data, sheet, setSheet, people, addGuest, mode }) {
  const { upd, del, add } = rowsApi(setSheet);
  const [stage, setStage] = useState(null);
  const projects = data.projects;
  const agenda = sheet.rows.map((r, i) => [r, i]).filter((x) => x[0].fixed);
  const extra = sheet.rows.map((r, i) => [r, i]).filter((x) => !x[0].fixed);

  if (stage !== null) {
    const row = sheet.rows[stage];
    return <Stage row={row} name={subjectName(people, row.subject_id)} thr={rowThr(row, projects)}
      onSave={(s) => { upd(stage, { seconds: s }); setStage(null); }} onPause={(s) => upd(stage, { seconds: s })} />;
  }
  const card = ([r, i]) => {
    const g = rowThr(r, projects), c = r.seconds != null ? cardOf(r.seconds, g) : null;
    const name = subjectName(people, r.subject_id);
    return (
      <div className="blk" key={i}>
        {r.fixed
          ? <div className="blk-h"><span style={{ font: '700 15px var(--head)' }}>{name}</span><Chip>{r.label}</Chip></div>
          : <>
            <div className="blk-h"><span className="no">ADDED BY YOU</span><button type="button" className="x" onClick={() => del(i)} aria-label="Remove">{I.close}</button></div>
            <PersonSelect value={r.subject_id} onChange={(v) => upd(i, { subject_id: v })} people={people} onAddGuest={addGuest} />
            <Seg style={{ marginTop: 8 }} value={r.kind} onChange={(v) => upd(i, { kind: v })} options={['Table Topics', 'Speaker', 'Evaluator', 'Other'].map((k) => [k, k])} />
            {r.kind === 'Other' && <div className="addname">
              <input className="inp mono" placeholder="Min, e.g. 1:00" value={r.min || ''} onChange={(e) => upd(i, { min: e.target.value, min_s: secs(e.target.value) })} aria-label="Minimum time" />
              <input className="inp mono" placeholder="Max, e.g. 2:00" value={r.max || ''} onChange={(e) => upd(i, { max: e.target.value, max_s: secs(e.target.value) })} aria-label="Maximum time" /></div>}
          </>}
        <div className="tm">
          <div className="big" style={{ minWidth: 96, color: r.seconds == null ? 'var(--gray)' : undefined }}>{r.seconds == null ? '0:00' : mmss(r.seconds)}</div>
          <div className="res">{c ? <><span className={'dot ' + c} /> <b>{CARDTXT[c]}</b> · Within time: <b>{c !== 'under' && r.seconds <= g[2] + 30 ? 'Yes' : 'No'}</b></> : 'Not timed yet'}<br />Green {mmss(g[0])} · Yellow {mmss(g[1])} · Red {mmss(g[2])}</div>
        </div>
        <Btn sm kind={r.seconds == null ? '' : 'ghost'} style={{ marginTop: 10 }} onClick={() => { if (!r.subject_id) return; if (r.seconds != null) upd(i, { seconds: 0 }); setStage(i); }} disabled={!r.subject_id}>{I.clock} {r.seconds == null ? 'Start timer' : 'Time again'}</Btn>
        {!r.subject_id && <p style={{ fontSize: 13, color: 'var(--mute)', margin: '6px 0 0' }}>Choose who first.</p>}
        <TA label="Comment" value={r.comment || ''} onChange={(v) => upd(i, { comment: v })} placeholder="Anything to add about the timing? (optional)" />
      </div>
    );
  };
  return (
    <Modes mode={mode}
      script={<ScriptDoc k="timer" before={<div className="obj"><small>How it works</small><p style={{ marginTop: 8 }}>The VPE sets the roles, so you only pick a name. Tap Start timer and the screen turns green, then yellow, then red as time runs.</p>
        <ul style={{ marginTop: 8 }}>{Object.entries(TIMER).map(([k, g]) => <li key={k}><span style={{ width: 104, fontWeight: 600 }}>{k}</span><span>{mmss(g[0])} · {mmss(g[1])} · {mmss(g[2])}</span></li>)}</ul>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--mute)' }}>Green · Yellow · Red</p></div>} />}
      report={<TimeReport rows={sheet.rows} projects={projects} people={people} />}
      form={<>
        <div className="lab" style={{ marginTop: 4 }}>On the agenda</div>
        {agenda.length ? agenda.map(card) : <p className="lede">The VPE has not assigned speakers or evaluators yet.</p>}
        <div className="lab">Not on the agenda</div>
        {extra.map(card)}
        <AddRow onClick={() => add({ subject_id: null, label: 'Table Topics', kind: 'Table Topics', seconds: null, comment: '', fixed: false })}>Add a person (Table Topics or other)</AddRow>
      </>} />
  );
}

/* the full-screen timer: white, then green, yellow, red. The clock is small; the colour does the talking.
   A buzzer sounds 30 seconds after the red card (7:30 for a speech). */
function buzz(ac) {
  try {
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = 'sawtooth'; o.frequency.value = 150;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.05); g.gain.setValueAtTime(0.6, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g).connect(ac.destination); o.start(); o.stop(t + 1.55);
  } catch { /* no audio available */ }
}
function Stage({ row, name, thr, onSave, onPause }) {
  const [base, setBase] = useState(row.seconds || 0);
  const [started, setStarted] = useState(null);
  const [, tick] = useState(0);
  const audio = useRef(null);
  const limit = thr[2] + 30;
  useEffect(() => { if (started === null) return; const t = setInterval(() => tick((x) => x + 1), 200); return () => clearInterval(t); }, [started]);
  useEffect(() => {
    let lock; if (started !== null && navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => lock?.release?.().catch(() => {});
  }, [started]);
  const cur = base + (started !== null ? (Date.now() - started) / 1000 : 0), s = Math.floor(cur), c = cardOf(s, thr), over = s >= limit;
  // once past the limit the buzzer keeps ringing until the timer is paused, reset or saved
  const ringing = started !== null && over;
  useEffect(() => {
    if (!ringing) return undefined;
    const ring = () => { buzz(audio.current); navigator.vibrate?.([300, 150, 300]); };
    ring();
    const t = setInterval(ring, 1700);
    return () => { clearInterval(t); navigator.vibrate?.(0); };
  }, [ringing]);
  const start = () => {
    if (!audio.current) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio.current = new AC(); }
    audio.current?.resume?.();
    setStarted(Date.now());
  };
  const pause = () => { setBase(cur); setStarted(null); onPause(Math.floor(cur)); };
  const [hide, setHide] = useState(() => { try { return localStorage.getItem('brekkie-timer-hide') === '1'; } catch { return false; } });
  const toggleHide = () => setHide((h) => { try { localStorage.setItem('brekkie-timer-hide', h ? '0' : '1'); } catch { /* not saved */ } return !h; });
  const txt = over ? 'Time is up. Please wrap up.' : c === 'under' ? (s <= 0 && started === null ? 'Ready when you are' : 'Counting up to green') : CARDTXT[c];
  return (
    <div className={'stage ' + c + (over ? ' over' : '') + (hide ? ' hide' : '')} style={{ position: 'fixed', inset: 0, zIndex: 40, height: '100dvh' }}>
      <div className="st-top"><button type="button" className="back" onClick={() => onSave(Math.floor(cur))} aria-label="Back">{I.back}</button><span>{row.label}</span><button type="button" className="eye" onClick={toggleHide} aria-label={hide ? 'Show the details' : 'Hide the details'} aria-pressed={hide}>{hide ? I.eyeoff : I.eye}</button></div>
      <div className="clk">{mmss(s)}</div>
      <div className="who2">{name}</div>
      <div className="cardname">{txt}</div>
      <div className="thr">Green {mmss(thr[0])} · Yellow {mmss(thr[1])} · Red {mmss(thr[2])} · Buzzer {mmss(limit)}</div>
      <div className="st-btns">
        <button type="button" className="btn" onClick={() => (started === null ? start() : pause())}>{started !== null ? 'Pause' : s > 0 ? 'Resume' : 'Start'}</button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn ghost" onClick={() => { setBase(0); setStarted(null); }}>Reset</button>
          <button type="button" className="btn ghost" onClick={() => onSave(Math.floor(cur))}>Save time</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Topicsmaster ───────── */
function TTSheet({ data, sheet, setSheet, people, addGuest, mode }) {
  const { upd, del, add } = rowsApi(setSheet);
  const [focus, setFocus] = useState(null);
  const topics = sheet.topics;
  const setTopic = (i, v) => setSheet((s) => ({ ...s, topics: s.topics.map((t, j) => (j === i ? v : t)) }));
  const addTopic = () => { setFocus(topics.length); setSheet((s) => ({ ...s, topics: [...s.topics, ''] })); };
  const delTopic = (i) => setSheet((s) => ({ ...s, topics: s.topics.length > 1 ? s.topics.filter((_, j) => j !== i) : [''] }));
  const topicOpts = topics.map((t) => t.trim()).filter(Boolean).map((t) => ({ value: t, label: t }));
  return (
    <Modes mode={mode}
      script={<ScriptDoc k="topicsmaster" before={<div className="obj"><small>Today’s meeting theme</small><p style={{ margin: '6px 0 0', font: '700 20px var(--head)' }}>{data.meeting.theme || 'Not set'}</p></div>} />}
      report={<TTReport topics={topics} rows={sheet.rows} people={people} />}
      form={<>
        <div className="lab" style={{ marginTop: 4 }}>Step 1 · Your topics</div>
        <p style={{ margin: '0 0 10px', color: 'var(--mute)', fontSize: 14.5 }}>Add them one at a time. You will pick from this list below.</p>
        {topics.map((t, i) => (
          <div className="addname" key={i} style={{ marginTop: i ? 8 : 0 }}>
            <input className="inp" autoFocus={focus === i} value={t} onChange={(e) => setTopic(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { e.preventDefault(); addTopic(); } }} placeholder={`Topic ${i + 1}`} aria-label={`Topic ${i + 1}`} />
            {topics.length > 1 && <button type="button" className="x" onClick={() => delTopic(i)} aria-label={`Remove topic ${i + 1}`}>{I.close}</button>}
          </div>
        ))}
        <AddRow onClick={addTopic}>Add a topic</AddRow>
        <div className="lab">Step 2 · Who spoke on what</div>
        {sheet.rows.map((r, i) => (
          <Block key={i} i={i} n={sheet.rows.length} onRemove={() => del(i)} label="SPEAKER">
            <PersonSelect value={r.subject_id} onChange={(v) => upd(i, { subject_id: v })} people={people} onAddGuest={addGuest} />
            <label className="fl">Topic they were given</label>
            <Select value={r.topic} onChange={(v) => upd(i, { topic: v })} options={topicOpts} placeholder={topicOpts.length ? 'Choose a topic' : 'Add a topic above first'} disabled={!topicOpts.length} />
          </Block>
        ))}
        <AddRow onClick={() => add({ subject_id: null, topic: '' })}>Add another speaker</AddRow>
      </>} />
  );
}

/* ───────── Speech Evaluator ───────── */
function EvalForm({ data, sheet, setSheet, people, mode }) {
  const target = data.roles.find((r) => r.id === data.role.target_role_id);
  const proj = target && data.projects.find((p) => p.id === target.project_id);
  if (!target?.person_id || !proj) return <div className="banner"><b>Waiting for the VPE.</b> You can fill this in once you have been matched with a speaker and their project.</div>;
  const who = subjectName(people, target.person_id);
  const set = (patch) => setSheet((s) => ({ ...s, ...patch }));
  const rate = (i, v) => set({ ratings: sheet.ratings.map((x, j) => (j === i ? v : x)) });
  const note = (i, v) => set({ comments: sheet.comments.map((x, j) => (j === i ? v : x)) });
  const open = (i) => set({ open: sheet.open.map((x, j) => (j === i ? true : x)) });
  return (
    <Modes mode={mode}
      script={<ScriptDoc k="evaluator" vars={{ s: who.split(' ')[0], t: target.speech_title }} before={<>
        {(() => { const r = data.evalResources?.[proj.name], url = r?.pdf || r?.page; return url ? <DlBtn href={url} title="Evaluation form" sub="The official resource, to take along" /> : null; })()}
        <div className="obj"><small>Evaluating</small><p style={{ margin: '6px 0 2px', font: '700 20px var(--head)' }}>{who}</p>
          <p style={{ margin: 0 }}>“{target.speech_title || 'Untitled'}” · {target.path_name || proj.path}, Level {target.path_level ?? proj.level}</p></div>
        <div className="obj"><small>{proj.form_title} · {proj.length_text}</small>
          <h6 style={{ marginTop: 8 }}>Purpose</h6><ul>{proj.purpose.map((o) => <li key={o}>{I.check}<span>{o}</span></li>)}</ul>
          <h6>{proj.overview ? 'Overview' : 'Notes for the evaluator'}</h6><p style={{ marginTop: 4 }}>{proj.overview || proj.notes}</p>
          <h6>{proj.overview ? 'This project includes' : 'About this speech'}</h6><ul>{proj.about.map((o) => <li key={o}>{I.check}<span>{o}</span></li>)}</ul></div></>} />}
      report={<EvalReport who={who} target={target} sheet={sheet} />}
      form={<>
        <div className="obj slim"><small>Evaluating</small><p style={{ margin: '4px 0 0', font: '700 17px var(--head)' }}>{who}</p><p style={{ margin: '2px 0 0' }}>“{target.speech_title || 'Untitled'}” · {target.path_name || proj.path}, Level {target.path_level ?? proj.level}</p></div>
        <div className="lab blue" style={{ marginTop: 18 }}>Start with your general comments</div>
        <TA label="You excelled at" kind="blue" min={120} value={sheet.excelled} onChange={(v) => set({ excelled: v })} placeholder="What worked, with an example" />
        <TA label="You may want to work on" kind="maroon" min={120} value={sheet.work} onChange={(v) => set({ work: v })} placeholder="One or two things to improve" />
        <TA label="To challenge yourself" min={96} value={sheet.challenge} onChange={(v) => set({ challenge: v })} placeholder="A stretch for the next speech" />
        <div className="lab" style={{ marginTop: 30 }}>Then rate the speaker · 5 Exemplary → 1 Developing</div>
        {CRIT.map(([n, desc, lv], i) => (
          <div className="rate-row" key={n}>
            <span><b>{n}:</b> {desc}</span>
            <div className="nums">{[5, 4, 3, 2, 1].map((v) => <button type="button" key={v} className={sheet.ratings[i] === v ? 'on' : ''} onClick={() => rate(i, v)} aria-pressed={sheet.ratings[i] === v}>{v}</button>)}</div>
            <div className="lv">{sheet.ratings[i] ? <><b>{LEVELN[sheet.ratings[i]]}</b>: {lv[sheet.ratings[i] - 1]}</> : 'Tap a number'}</div>
            {sheet.comments[i] || sheet.open[i]
              ? <Grow min={48} value={sheet.comments[i]} onChange={(e) => note(i, e.target.value)} placeholder="Comment" />
              : <button type="button" className="lnk" onClick={() => open(i)}>+ Add comment</button>}
          </div>
        ))}
      </>} />
  );
}

/* ───────── General Evaluator ───────── */
// each checklist section carries the comments for the role players it covers
const GE_ROLES = { Toastmaster: ['toastmaster'], 'General Evaluator': ['grammarian', 'timer', 'ah_counter'], Topicsmaster: ['topicsmaster'] };
function GESheet({ data, sheet, setSheet, people, mode }) {
  const setA = (si, qi, v) => setSheet((s) => ({ ...s, sections: s.sections.map((x, a) => (a === si ? { ...x, a: x.a.map((y, b) => (b === qi ? v : y)) } : x)) }));
  const setN = (si, v) => setSheet((s) => ({ ...s, sections: s.sections.map((x, a) => (a === si ? { ...x, notes: v } : x)) }));
  const getC = (id) => (sheet.comments || []).find((c) => c.role_id === id) || { role_id: id, well: '', improve: '' };
  const setC = (id, patch) => setSheet((s) => {
    const cur = s.comments || [], has = cur.some((c) => c.role_id === id);
    return { ...s, comments: has ? cur.map((c) => (c.role_id === id ? { ...c, ...patch } : c)) : [...cur, { role_id: id, well: '', improve: '', ...patch }] };
  });
  const cards = (keys) => data.roles.filter((r) => r.person_id && keys.includes(r.role_key)).map((r) => { const c = getC(r.id); return (
    <div className="rolecard" key={r.id}>
      <div className="rh2"><b>{subjectName(people, r.person_id)}</b><Chip>{r.label}</Chip></div>
      <TA label="What went well" kind="blue" value={c.well} onChange={(v) => setC(r.id, { well: v })} placeholder="Something specific they did well" />
      <TA label="To improve" kind="maroon" value={c.improve} onChange={(v) => setC(r.id, { improve: v })} placeholder="One suggestion for next time" />
      <div style={{ height: 10 }} />
    </div>); });
  const Qs = ({ si, qs }) => <div className="list">{qs.map((q, qi) => { const a = sheet.sections[si].a[qi]; return (
    <div className="qrow" key={q}><span>{q}</span>
      <div className="yn"><button type="button" className={a === 'y' ? 'on y' : ''} onClick={() => setA(si, qi, 'y')}>Yes</button><button type="button" className={a === 'n' ? 'on n' : ''} onClick={() => setA(si, qi, 'n')}>No</button></div></div>); })}</div>;
  const evalCards = cards(['evaluator']);
  return (
    <Modes mode={mode}
      script={<ScriptDoc k="general_evaluator" />}
      report={<GEReport data={data} sheet={sheet} people={people} />}
      form={<>
        <p style={{ margin: '0 0 4px', color: 'var(--mute)', fontSize: 14.5 }}>Tick each question. Where a section covers role players, leave a comment for each of them. They will see it under the role they played.</p>
        {GE_SECTIONS.map(([name, qs], si) => {
          const role = cards(GE_ROLES[name] || []);
          return (
            <div key={name}>
              <div className="lab" style={{ marginTop: si ? 28 : 12 }}>{name}</div>
              <Qs si={si} qs={qs} />
              {role.length > 0 && <><div className="lab maroon" style={{ marginTop: 18 }}>Comments for {name === 'General Evaluator' ? 'the Grammarian, Timer and Ah Counter' : `the ${name}`}</div>{role}</>}
              <div style={{ marginTop: 8 }}><Grow value={sheet.sections[si].notes} onChange={(e) => setN(si, e.target.value)} placeholder="Notes" /></div>
            </div>);
        })}
        {evalCards.length > 0 && <><div className="lab" style={{ marginTop: 28 }}>Speech Evaluators</div>{evalCards}</>}
      </>} />
  );
}


/* ───────── Reports: what you noted, written the way you would say it ───────── */
function GramReport({ m, rows, people }) {
  const filled = rows.filter((x) => x.subject_id);
  const nm = (x) => subjectName(people, x.subject_id);
  const cnt = (x) => x.uses || (x.used ? 1 : 0);
  const users = filled.filter((x) => cnt(x) > 0);
  const total = users.reduce((a, x) => a + cnt(x), 0);
  const any = filled.some((x) => cnt(x) > 0 || x.liked || fixesOf(x).length);
  return (
    <div className="rpt">
      <div className="rep-hero wod"><small>Word of the day</small><b>{m.word || 'Not set'}</b>
        {any && (users.length
          ? <><p className="wod-sum">Used {total} {total === 1 ? 'time' : 'times'} in all</p>
            <ul className="wod-list">{users.map((x, i) => <li key={i}><span>{nm(x)}</span><b>{cnt(x)}×</b></li>)}</ul></>
          : <p className="wod-sum">No one used it yet.</p>)}
      </div>
      {!any && <RepEmpty />}
      {filled.filter((x) => x.liked || fixesOf(x).some((f) => f.improper || f.suggestion)).map((x, i) => (
        <Rep key={i} title={nm(x)} sub={cnt(x) ? (cnt(x) > 1 ? `Used the word ${cnt(x)} times` : 'Used the word') : ''}>
          <RepLine label="Liked" kind="blue">{x.liked}</RepLine>
          {fixesOf(x).filter((f) => f.improper || f.suggestion).map((f, k) => (
            <div className="fixpair" key={k}><span className="was">{f.improper || '…'}</span><span className="arr" aria-hidden="true">→</span><span className="now">{f.suggestion || '…'}</span></div>))}
        </Rep>))}
    </div>
  );
}

function AhReport({ sheet, people }) {
  const keys = sheet.fillers.map((f) => f.k), label = Object.fromEntries(sheet.fillers.map((f) => [f.k, f.l]));
  const rows = sheet.rows.filter((x) => x.subject_id).map((x) => ({ ...x, total: sum(x.counts, keys) })).sort((a, b) => b.total - a.total);
  const all = rows.reduce((t, x) => t + x.total, 0);
  const any = rows.some((x) => x.total || x.comment);
  return (
    <div className="rpt">
      <div className="rep-hero"><small>Filler words</small><b>{all} counted</b><p>{any ? `Across ${rows.length} ${rows.length === 1 ? 'person' : 'people'}.` : ''}</p></div>
      {!any && <RepEmpty />}
      {rows.filter((x) => x.total || x.comment).map((x, i) => (
        <Rep key={i} title={subjectName(people, x.subject_id)} sub={`${x.total} total`}>
          {x.total > 0 && <div className="pill-row" style={{ marginTop: 2 }}>{keys.filter((k) => x.counts[k]).map((k) => <span className="chip" key={k}>{label[k]} <b>{x.counts[k]}</b></span>)}</div>}
          <RepLine label="Comment">{x.comment}</RepLine>
        </Rep>))}
    </div>
  );
}

function TTReport({ topics, rows, people }) {
  const list = topics.map((t) => t.trim()).filter(Boolean);
  const given = rows.filter((x) => x.subject_id);
  return (
    <div className="rpt">
      <div className="rep-hero"><small>Table Topics</small><b>{given.length} {given.length === 1 ? 'speaker' : 'speakers'}</b><p>{list.length ? `${list.length} ${list.length === 1 ? 'topic' : 'topics'} prepared.` : ''}</p></div>
      {!given.length && !list.length && <RepEmpty />}
      {given.length > 0 && <Rep title="Who spoke on what">{given.map((x, i) => <p className="rep-l" key={i}><span>{subjectName(people, x.subject_id)}</span>{x.topic || 'No topic chosen'}</p>)}</Rep>}
      {list.length > 0 && <Rep title="Your topics">{list.map((t, i) => <p className="rep-l" key={i}><span>{i + 1}</span>{t}</p>)}</Rep>}
    </div>
  );
}

function EvalReport({ who, target, sheet }) {
  const rated = CRIT.map(([n], i) => ({ n, v: sheet.ratings[i], c: sheet.comments[i] })).filter((x) => x.v);
  const high = rated.filter((x) => x.v >= 4), low = rated.filter((x) => x.v <= 3).sort((a, b) => a.v - b.v);
  const any = rated.length || sheet.excelled || sheet.work || sheet.challenge;
  return (
    <div className="rpt">
      <div className="rep-hero"><small>Evaluation of</small><b>{who}</b><p>“{target.speech_title || 'Untitled'}”</p></div>
      {!any && <RepEmpty />}
      {any && <>
        {sheet.excelled && <Rep title="You excelled at"><p className="rep-t">{sheet.excelled}</p></Rep>}
        {sheet.work && <Rep title="You may want to work on"><p className="rep-t">{sheet.work}</p></Rep>}
        {sheet.challenge && <Rep title="To challenge yourself"><p className="rep-t">{sheet.challenge}</p></Rep>}
        {rated.length > 0 && <Rep title="Your ratings" sub={`${rated.length} of ${CRIT.length}`}>
          {high.length > 0 && <RepLine label="Strongest" kind="blue">{high.map((x) => `${x.n} (${x.v})`).join(', ')}</RepLine>}
          {low.length > 0 && <RepLine label="Room to grow" kind="maroon">{low.map((x) => `${x.n} (${x.v})`).join(', ')}</RepLine>}
          {rated.filter((x) => x.c).map((x) => <RepLine key={x.n} label={x.n}>{x.c}</RepLine>)}
        </Rep>}
      </>}
    </div>
  );
}

function GEReport({ data, sheet, people }) {
  const answered = sheet.sections.reduce((t, s) => t + s.a.filter(Boolean).length, 0);
  const roleName = (id) => subjectName(people, data.roles.find((r) => r.id === id)?.person_id);
  const roleLabel = (id) => data.roles.find((r) => r.id === id)?.label;
  const cms = (sheet.comments || []).filter((c) => c.well || c.improve);
  const any = answered || cms.length || sheet.sections.some((s) => s.notes);
  return (
    <div className="rpt">
      <div className="rep-hero"><small>Meeting checklist</small><b>{answered} answered</b><p>{any ? `Out of ${GE_SECTIONS.reduce((t, [, qs]) => t + qs.length, 0)} questions.` : ''}</p></div>
      {!any && <RepEmpty />}
      {GE_SECTIONS.map(([name, qs], si) => {
        const a = sheet.sections[si].a, yes = a.filter((x) => x === 'y').length, no = qs.filter((_, qi) => a[qi] === 'n');
        if (!a.some(Boolean) && !sheet.sections[si].notes) return null;
        return (
          <Rep key={name} title={name} sub={`${yes} yes${no.length ? `, ${no.length} no` : ''}`}>
            {no.length > 0 && <RepLine label="To raise" kind="maroon">{no.join(' ')}</RepLine>}
            <RepLine label="Notes">{sheet.sections[si].notes}</RepLine>
          </Rep>);
      })}
      {cms.length > 0 && <Rep title="Comments on role players">
        {cms.map((c) => <div className="rep-sub" key={c.role_id}><b>{roleName(c.role_id)} <span>{roleLabel(c.role_id)}</span></b><RepLine label="Went well" kind="blue">{c.well}</RepLine><RepLine label="To improve" kind="maroon">{c.improve}</RepLine></div>)}
      </Rep>}
    </div>
  );
}


function TimeReport({ rows, projects, people }) {
  const timed = rows.filter((r) => r.seconds != null && r.subject_id);
  // the same rule as the notes: under the green card is under time, up to 30 seconds past red is still within time
  const kind = (r) => { const g = rowThr(r, projects); return r.seconds < g[0] ? 'under' : r.seconds > g[2] + 30 ? 'over' : 'in'; };
  const n = { in: 0, under: 0, over: 0 }; timed.forEach((r) => { n[kind(r)]++; });
  const summary = !timed.length ? '' : n.in === timed.length ? (timed.length === 1 ? 'Within time.' : 'Everyone was within time.')
    : [n.in && `${n.in} within time`, n.under && `${n.under} under time`, n.over && `${n.over} over time`].filter(Boolean).join(', ') + '.';
  return (
    <div className="rpt">
      <div className="rep-hero"><small>Timing</small><b>{timed.length} timed</b><p>{summary}</p></div>
      {!timed.length && <RepEmpty />}
      {timed.map((r, i) => {
        const g = rowThr(r, projects), c = cardOf(r.seconds, g);
        return (
          <Rep key={i} title={subjectName(people, r.subject_id)} sub={r.label}>
            <p className="rep-l"><span>Time</span><b style={{ font: '700 22px var(--head)' }}>{mmss(r.seconds)}</b> <span className={'dot ' + c} style={{ display: 'inline-block', marginLeft: 6 }} /> {CARDTXT[c]}</p>
            <RepLine label="Regime">{`${mmss(g[0])} to ${mmss(g[2])}`}</RepLine>
            <RepLine label="Comment">{r.comment}</RepLine>
          </Rep>);
      })}
    </div>
  );
}
