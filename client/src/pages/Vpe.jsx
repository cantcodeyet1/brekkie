import { useEffect, useMemo, useRef, useState, Children } from 'react';
import QRCode from 'qrcode';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { printEval, printPoster } from '../EvalSheet.jsx';
import { api, getToken, useApi } from '../api.js';
import { CARDTXT, CRIT, FEEDBACK_ROLES, GE_SECTIONS, LEVELN, cap, cardOf, evalFormUrl, fmtDate, longDate, mean, mmss, sum } from '../data.js';
import PathCard from './PathCard.jsx';
import RosterImport, { PathDone } from './RosterImport.jsx';
import { toMembers } from '../roster.js';
import { Btn, Chip, DatePick, ErrorMsg, Foot, GBadge, I, SkPage, SkRows, Meter, Modal, Page, PersonSelect, ProjectPicker, Select, Seg, Avatar, copyText, useDesk, useToast } from '../ui.jsx';

export const VPE_NAV = [
  { to: '/v', end: true, label: 'Dashboard', icon: I.chart },
  { to: '/v/roster', label: 'Roster', icon: I.cal },
  { to: '/v/calendar', label: 'Calendar', icon: I.month },
  { to: '/v/members', label: 'Members', icon: I.ppl },
  { to: '/v/club', label: 'Club', icon: I.home },
];
const statusKind = (s) => (s === 'Done' ? '' : s === 'Next' ? 'on' : 'wait');
const roleLink = (base, token) => `${base}/r/${token}`;
const memberLink = (base, token) => `${base}/s/${token}`;

/* Phones can't reach "localhost", so when the VPE is on localhost we use this computer's network address in links and the QR code. */
function useBaseUrl() {
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const [ip, setIp] = useState(null);
  useEffect(() => { if (local) api('/vpe/network').then((r) => setIp(r.ip)).catch(() => {}); }, [local]);
  return local && ip ? `http://${ip}:${window.location.port || 80}` : window.location.origin;
}

function QrCard({ code, meeting, base }) {
  const toast = useToast();
  const url = `${base}/f/${code}`;
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 640, color: { dark: '#004165', light: '#ffffff' } }).then(setSrc).catch(() => {}); }, [url]);
  return (
    <div className="qrcard">
      {src ? <img src={src} alt={`QR code for meeting ${meeting.number} feedback`} /> : <div style={{ width: 168, height: 168 }} />}
      <div className="qt">
        <b style={{ font: '800 18px var(--head)', letterSpacing: '-.02em' }}>Room feedback form</b>
        <p style={{ margin: '6px 0 0', color: 'var(--mute)', fontSize: 14.5 }}>Anyone at the meeting scans this, picks the people they want to write to, and they see it in Brekkie.</p>
        <code>{url}</code>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn sm onClick={() => printPoster({ src, url, when: fmtDate(meeting.date) })}>Print poster</Btn>
          <Btn sm kind="ghost" onClick={async () => toast((await copyText(url)) ? 'Link copied' : 'Copy failed')}>{I.copy}Copy link</Btn>
          <a className="btn sm ghost" style={{ textDecoration: 'none' }} href={url} target="_blank" rel="noreferrer">Open form</a>
        </div>
      </div>
    </div>
  );
}
const wa = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/* ───────── meetings table ───────── */
export function VpeHome() {
  const { data, error, loading, reload, setData } = useApi('/vpe/meetings');
  const desk = useDesk();
  const toast = useToast();
  const timers = useRef({}), pending = useRef({});
  if (loading) return <Page root wide><SkPage rows={6} avatar /></Page>;
  if (error) return <Page root wide><ErrorMsg error={error} /></Page>;

  const patch = (m, fields) => {
    setData(data.map((x) => (x.id === m.id ? { ...x, ...fields } : x)));
    pending.current[m.id] = { ...(pending.current[m.id] || {}), ...fields };
    clearTimeout(timers.current[m.id]);
    timers.current[m.id] = setTimeout(async () => {
      const body = pending.current[m.id]; pending.current[m.id] = {};
      try { await api(`/vpe/meetings/${m.id}`, { method: 'PATCH', body }); } catch (e) { toast(e.message); }
    }, 500);
  };
  const add = async () => { const m = await api('/vpe/meetings', { method: 'POST' }); toast(`Meeting ${m.number} added`); reload(); };

  const upcoming = data.filter((m) => m.status !== 'Done').sort((a, b) => a.number - b.number);
  const past = data.filter((m) => m.status === 'Done').sort((a, b) => b.number - a.number);
  const next = data.find((m) => m.status === 'Next');
  const last3 = past.slice(0, 3), fbIn = last3.reduce((a, m) => a + m.fb_in, 0), fbTot = last3.reduce((a, m) => a + m.fb_total, 0);
  const wset = upcoming.filter((m) => m.word).length;
  const flag = (m) => (m.word && !m.meaning ? <small style={{ color: 'var(--maroon)' }}>details missing</small> : m.pos ? <small style={{ color: 'var(--mute)' }}>{m.pos}</small> : null);

  const stats = (
    <div className="stats">
      <div><b>{next ? `${next.roles_filled}/${next.roles_total}` : 'None'}</b><small>Roles filled, next meeting</small></div>
      <div><b>{fbTot ? `${fbIn}/${fbTot}` : 'None'}</b><small>Feedback in, last 3 meetings</small></div>
      <div><b>{wset}/{upcoming.length}</b><small>Upcoming words set</small></div>
    </div>
  );
  const row = (m) => (
    <tr key={m.id}>
      <td><Link className="lnk" to={`/v/meetings/${m.id}`}>No. {m.number}</Link></td>
      <td><DatePick bare value={m.date} onChange={(v) => patch(m, { date: v })} label="Date" /></td>
      <td><input value={m.theme} onChange={(e) => patch(m, { theme: e.target.value })} placeholder="Theme" aria-label="Theme" /></td>
      <td><input value={m.word} onChange={(e) => patch(m, { word: e.target.value })} placeholder="Word of the day" aria-label="Word" /></td>
      <td>{flag(m)}</td>
      <td className={'num ' + (m.status !== 'Done' && m.roles_filled < m.roles_total ? 'warn' : '')}>{m.roles_filled}/{m.roles_total}</td>
      <td className="num">{m.status === 'Done' ? `${m.fb_in}/${m.fb_total}` : 'n/a'}</td>
      <td><Chip kind={statusKind(m.status)}>{m.status}</Chip></td>
      <td><Link className="x" to={`/v/meetings/${m.id}`} aria-label="Open">{I.chev}</Link></td>
    </tr>
  );
  const block = (m) => (
    <div className="blk" key={m.id}>
      <div className="blk-h"><Link className="lnk" style={{ font: '700 15px var(--head)' }} to={`/v/meetings/${m.id}`}>No. {m.number}</Link><Chip kind={statusKind(m.status)}>{m.status}</Chip></div>
      <div className="two">
        <div><label className="fl" style={{ marginTop: 0 }}>Date</label><DatePick value={m.date} onChange={(v) => patch(m, { date: v })} /></div>
        <div><label className="fl" style={{ marginTop: 0 }}>Word</label><input className="inp" value={m.word} placeholder="Not set" onChange={(e) => patch(m, { word: e.target.value })} /></div>
      </div>
      <label className="fl">Theme</label><input className="inp" value={m.theme} placeholder="Theme" onChange={(e) => patch(m, { theme: e.target.value })} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ color: 'var(--mute)', fontSize: 13.5 }}>Roles {m.roles_filled}/{m.roles_total}{m.status === 'Done' && ` · Feedback ${m.fb_in}/${m.fb_total}`} {flag(m)}</span>
        <Link className="btn sm ghost" to={`/v/meetings/${m.id}`} style={{ textDecoration: 'none' }}>Open</Link>
      </div>
    </div>
  );
  return (
    <Page root wide foot={<Foot><Btn kind="yel" onClick={add}>{I.plus} Add meeting</Btn></Foot>}>
      <h1 className="pg">Meetings</h1>
      {stats}
      {desk ? (
        <table className="tbl">
          <thead><tr><th style={{ width: 72 }}>No.</th><th style={{ width: 158 }}>Date</th><th>Theme</th><th style={{ width: 190 }}>Word of the day</th><th style={{ width: 90 }} /><th style={{ width: 70 }}>Roles</th><th style={{ width: 80 }}>Feedback</th><th style={{ width: 84 }}>Status</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            <tr className="sec"><td colSpan={9}>Upcoming</td></tr>{upcoming.map(row)}
            <tr className="sec"><td colSpan={9}>Past</td></tr>{past.map(row)}
          </tbody>
        </table>
      ) : <><div className="lab" style={{ marginTop: 6 }}>Upcoming</div>{upcoming.map(block)}<div className="lab">Past</div>{past.map(block)}</>}
    </Page>
  );
}

/* ───────── one meeting: details, word, roles, links, received ───────── */
function Panel({ k, title, hint, right, children }) {
  return (
    <section className="panel" id={`sec-${k}`}>
      <div className="ph2"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{right}</div>
      {children}
    </section>
  );
}

export function VpeMeeting() {
  const { id } = useParams();
  const toast = useToast();
  const base = useBaseUrl();
  const { data, error, loading, reload } = useApi(`/vpe/meetings/${id}`);
  const peopleQ = useApi('/vpe/people');
  const projQ = useApi('/projects');
  const catQ = useApi('/pathways');
  const resQ = useApi('/evaluation-resources');
  const [m, setM] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [wordBusy, setWordBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [wordNote, setWordNote] = useState('');
  const [wordAlts, setWordAlts] = useState([]);
  const saveT = useRef();
  useEffect(() => { if (data) setM(data.meeting); }, [data]);
  // each evaluator starts out paired with the speaker in the same position, so the two line up in one column
  useEffect(() => {
    if (!data || data.meeting.status === 'Done') return;
    const sp = data.roles.filter((r) => r.role_key === 'speaker'), ev = data.roles.filter((r) => r.role_key === 'evaluator');
    const taken = new Set(ev.map((e) => e.target_role_id).filter(Boolean)), todo = [];
    ev.forEach((e, i) => { if (!e.target_role_id && sp[i] && !taken.has(sp[i].id)) { taken.add(sp[i].id); todo.push([e.id, sp[i].id]); } });
    if (todo.length) Promise.all(todo.map(([rid, t]) => api(`/vpe/roles/${rid}`, { method: 'PATCH', body: { target_role_id: t } }))).then(reload).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  if (loading || peopleQ.loading || projQ.loading || catQ.loading || !m) return <Page title="Roster" wide back="/v/roster"><SkPage plain rows={7} /></Page>;
  if (error || peopleQ.error) return <Page title="Roster" wide back="/v/roster"><ErrorMsg error={error || peopleQ.error} /></Page>;

  const roles = data.roles, projects = projQ.data, catalog = catQ.data?.paths || [];
  const locked = m.status === 'Done';
  const people = peopleQ.data.filter((p) => p.status !== 'inactive');
  const setField = (f) => {
    setM((x) => ({ ...x, ...f }));
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => api(`/vpe/meetings/${id}`, { method: 'PATCH', body: f }).catch((e) => toast(e.message)), 600);
  };
  const setRole = async (r, body) => { try { await api(`/vpe/roles/${r.id}`, { method: 'PATCH', body }); await reload(); if (body.person_id !== undefined) peopleQ.reload(); } catch (e) { toast(e.message); } };
  const addGuest = async (name) => { const g = await api('/people/guest', { method: 'POST', body: { name } }); await peopleQ.reload(); return g; };
  const fb = roles.filter((r) => FEEDBACK_ROLES.includes(r.role_key));
  const linkRows = roles.filter((r) => FEEDBACK_ROLES.includes(r.role_key) || r.role_key === 'speaker');
  const speakers = roles.filter((r) => r.role_key === 'speaker');
  const personChip = (r) => r.person_kind === 'guest' && <GBadge />;
  const fillWord = async () => {
    setWordBusy(true); setWordNote(''); setWordAlts([]);
    try {
      const d = await api('/vpe/word-details', { method: 'POST', body: { word: m.word, theme: m.theme, quote: m.theme_quote } });
      const patch = {}; for (const k of ['word', 'pos', 'pron', 'meaning', 'example', 'synonyms', 'origin']) if (d[k]) patch[k] = d[k];
      setField(patch); setWordAlts(d.alternatives || []);
      setWordNote(d.source === 'ai' ? 'Written by AI to fit your theme. Read it through before you keep it.' : (d.note || 'Filled in from the dictionary.'));
    } catch (e) { setWordNote(e.message); } finally { setWordBusy(false); }
  };
  const downloadAgenda = async () => {
    setPdfBusy(true);
    try {
      const res = await fetch(`/api/vpe/meetings/${id}/agenda.pdf`, { headers: { 'x-token': getToken() } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create the agenda');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `Agenda ${m.number}.pdf`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Agenda downloaded');
    } catch (e) { toast(e.message); } finally { setPdfBusy(false); }
  };
  const downloadEval = async (r) => {
    try {
      const sub = await api(`/vpe/roles/${r.id}/submission`);
      if (!sub.evaluation?.id) return toast('No evaluation recorded yet');
      printEval(await api(`/vpe/evaluations/${sub.evaluation.id}`));
    } catch (e) { toast(e.message); }
  };
  const jump = (k) => document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const field = ({ label, k, ph, type = 'text', area }) => (
    <div key={k}>
      <label className="fl">{label}</label>
      {area
        ? <textarea className="inp" style={{ minHeight: 64 }} value={m[k] || ''} placeholder={ph} onChange={(e) => setField({ [k]: e.target.value })} />
        : type === 'date' ? <DatePick value={m[k] || ''} onChange={(v) => setField({ [k]: v })} />
        : <input className="inp" type={type} value={m[k] || ''} placeholder={ph} onChange={(e) => (type !== 'date' || e.target.value) && setField({ [k]: e.target.value })} />}
    </div>
  );
  // a speaker and their evaluator are told who the other is, with contact details, and asked to get in touch
  const personOf = (id) => people.find((x) => x.id === id);
  const reach = (x) => [x?.phone && `WhatsApp or call ${x.phone}`, x?.email && `email ${x.email}`].filter(Boolean).join(', or ') || 'ask me for their details';
  const evalsOf = (r) => roles.filter((e) => e.role_key === 'evaluator' && e.target_role_id === r.id && e.person_id).map((e) => personOf(e.person_id)).filter(Boolean);
  const speakerOf = (r) => personOf(roles.find((x) => x.id === r.target_role_id)?.person_id);
  const talkOf = (sp) => { const pr = projects.find((x) => x.id === sp?.project_id), t = sp?.speech_title && `"${sp.speech_title}"`, pj = pr && `${pr.name}, Level ${pr.level}`; return t && pj ? `${t} (${pj})` : t || pj || ''; };
  const pairing = (r, kind) => {
    if (r.role_key === 'evaluator' && kind !== 'remind') {
      const sr = roles.find((x) => x.id === r.target_role_id), sp = speakerOf(r);
      if (!sp) return '';
      const talk = talkOf(sr);
      return `

You will be evaluating ${sp.name}${talk ? `, speaking on ${talk}` : ''}. Please get in touch with them before the meeting to introduce yourself and ask what they would like feedback on. You can reach them: ${reach(sp)}.`;
    }
    return '';
  };
  const speakerMsg = (r, kind) => {
    const who = personOf(r.person_id), title = who?.credential ? `${who.credential} ` : '';
    const sender = people.find((p) => p.is_vpe)?.name;
    const evs = evalsOf(r), talk = talkOf(r);
    const theme = m.theme ? ` The theme for the evening is "${m.theme}".` : '';
    const pair = evs.length
      ? `Your speech evaluator is ${evs.map((e) => e.name).join(' and ')}. Please get in touch with them before the meeting: tell them what you are working on and what you would like feedback on. You can reach ${evs.length > 1 ? evs.map((e) => `${e.name}: ${reach(e)}`).join('; ') : `them: ${reach(evs[0])}`}.`
      : 'Your speech evaluator has not been chosen yet. Their name and contact details will show on your link as soon as they are.';
    return `Hello ${title}${r.person},

${kind === 'remind' ? 'A gentle reminder that you are speaking' : 'Thank you for agreeing to speak'} at our club meeting on ${fmtDate(m.date)}${talk ? `, with ${talk}` : ''}.${theme}

${pair}

Your link below opens your project's evaluation form to download, your evaluator's details and, as soon as they have submitted it, the feedback they wrote for you. There is no sign-in or app to install.

${roleLink(base, r.token)}

Good luck, we are looking forward to your speech!

Kind regards,
${sender || 'Your VPE'}
VPE, Champions Toastmasters Club`;
  };
  const msg = (r, kind = 'send') => {
    if (r.role_key === 'speaker') return speakerMsg(r, kind);
    const who = people.find((p) => p.id === r.person_id), title = who?.credential ? `${who.credential} ` : '';
    const sender = people.find((p) => p.is_vpe)?.name;
    const theme = m.theme ? ` The theme for the evening is "${m.theme}".` : '';
    const word = r.role_key === 'grammarian' && m.word ? `

The word of the day is "${m.word}". Please introduce it at the start of the meeting and listen for how members use it.` : '';
    const intro = kind === 'remind'
      ? `Thank you for serving as ${r.label} at our club meeting on ${fmtDate(m.date)}. It really does make the meeting.${theme}

A gentle reminder to fill in your notes on Brekkie when you have a moment. The people you observed benefit most from hearing your feedback while the meeting is still fresh, and it helps every member keep growing in their Pathways journey.`
      : `Thank you for agreeing to serve as ${r.label} at our club meeting on ${fmtDate(m.date)}.${theme}`;
    return `Hello ${title}${r.person},

I trust this message finds you well.

${intro}${kind === 'remind' ? '' : word}${pairing(r, kind)}

${kind === 'remind'
    ? 'Your link is below. It opens your sheet with your notes as you left them, and you can edit and resubmit at any time.'
    : 'At Champions, we use a tool called Brekkie to run our meetings and share feedback. Your link below opens your personal script and sheet for the role, with no sign-in or app to install. You will still give your report at the meeting as usual, and your notes will be there on the sheet. When you submit it, the feedback goes straight to the people you wrote about.'}

${roleLink(base, r.token)}

${kind === 'remind' ? 'Let me know if you would like any help with it. Thank you again!' : 'Please let me know when you are available for a quick tutorial, so we can make sure you are ready.'}

Kind regards,
${sender || 'Your VPE'}
VPE, Champions Toastmasters Club`;
  };
  const copy = async (text) => { toast((await copyText(text)) ? 'Copied' : 'Copy failed'); };
  const all = linkRows.filter((r) => r.person).map((r) => `${r.label} (${r.person}): ${roleLink(base, r.token)}`).join('\n');
  const resetFb = async () => {
    if (!window.confirm(`Clear everything submitted for meeting ${m.number}? Every role sheet goes back to blank and the notes, counts, timings and evaluations built from them are removed. Room comments stay. This cannot be undone.`)) return;
    try { const r = await api(`/vpe/meetings/${id}/reset-feedback`, { method: 'POST' }); toast(`Cleared ${r.sheets} ${r.sheets === 1 ? 'sheet' : 'sheets'}`); reload(); } catch (e) { toast(e.message); }
  };
  const upcoming = m.status !== 'Done';
  const pending = fb.filter((r) => r.person && !r.submitted_at).length;

  const projOf = (id) => projects.find((p) => p.id === id);
  const tile = (r) => (
    <div className={'rtile ' + (r.person_id ? 'filled' : 'open')} key={r.id}>
      <div className="rl"><b><i className="dot" aria-hidden="true" />{r.label}</b>{!r.person_id ? <span className="openpill">Needs someone</span> : FEEDBACK_ROLES.includes(r.role_key) && <span>Gets a link</span>}</div>
      {locked
        ? <div style={{ fontSize: 16, fontWeight: 600 }}>{r.person || 'None'}{personChip(r)}</div>
        : <PersonSelect value={r.person_id} placeholder="Unassigned" allowClear people={people} onAddGuest={addGuest} onChange={(v) => setRole(r, { person_id: v })} />}
      {r.role_key === 'speaker' && (locked
        ? <div style={{ color: 'var(--mute)', fontSize: 14, marginTop: 4 }}>{projOf(r.project_id) ? `${r.path_name || projOf(r.project_id).path}, Level ${r.path_level ?? projOf(r.project_id).level}: ${projOf(r.project_id).name}${projOf(r.project_id).parts?.length > 1 ? ` (Part ${r.part})` : ''}` : 'No project set'}{r.speech_title ? ` · “${r.speech_title}”` : ''}</div>
        : <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <ProjectPicker catalog={catalog} value={r.project_id} part={r.part} pathName={r.path_name} level={r.path_level} onChange={(body) => setRole(r, body)} />
          <input className={'inp' + (r.speech_title ? '' : ' todo')} defaultValue={r.speech_title} placeholder="Speech title" onBlur={(e) => e.target.value !== r.speech_title && setRole(r, { speech_title: e.target.value })} />
        </div>)}
      {r.role_key === 'evaluator' && (locked
        ? r.target_role_id && <div style={{ color: 'var(--mute)', fontSize: 14, marginTop: 4 }}>Evaluated {speakers.find((s) => s.id === r.target_role_id)?.label}</div>
        : <div style={{ marginTop: 8 }}>
          <Select value={r.target_role_id} placeholder="Evaluates which speaker?" options={speakers.map((s) => ({ value: s.id, label: s.label, sub: s.person || 'unassigned' }))} onChange={(v) => setRole(r, { target_role_id: v })} />
          {(() => { const sp = speakers.find((s) => s.id === r.target_role_id), pj = sp && projOf(sp.project_id); return pj ? <p className="evnote">Will see {sp.path_name || pj.path}, Level {sp.path_level ?? pj.level}: {pj.name}{pj.parts?.length > 1 ? `, ${pj.parts[(sp.part || 1) - 1]?.label}` : ''}</p> : null; })()}
        </div>)}
      {r.role_key === 'evaluator' && (() => {
        const sp = speakers.find((s) => s.id === r.target_role_id), pj = sp && projOf(sp.project_id), res = pj && resQ.data?.[pj.name], url = evalFormUrl(res, sp?.part);
        return (url || r.submitted_at) ? (
          <div className="dlrow">
            {url && <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">{I.dl} Official form</a>}
            {r.submitted_at && <Btn sm onClick={() => downloadEval(r)}>{I.dl} Completed (PDF)</Btn>}
          </div>) : null;
      })()}
    </div>
  );

  return (
    <Page title="Roster" wide back="/v/roster">
      <div className="mhead">
        <div>
          <div className="meta" style={{ margin: 0 }}><Chip kind={statusKind(m.status)}>{m.status}</Chip><span>Meeting {m.number}</span></div>
          <h1 className="pg" style={{ margin: '6px 0 2px' }}>{fmtDate(m.date)}</h1>
          <p className="lede" style={{ margin: 0 }}>{m.theme || 'No theme yet'}{m.word ? <> · Word of the day <b style={{ color: 'var(--ink)' }}>{m.word}</b></> : ''}</p>
        </div>
        <nav className="jump" aria-label="Sections">
          {[['details', 'Theme and word'], ['roles', 'Roles'], ['links', 'Links'], ['recv', 'Received']].map(([k, l]) => <button type="button" key={k} onClick={() => jump(k)}>{l}</button>)}
        </nav>
      </div>

      <Panel k="details" title="Theme and word of the day" hint="The Grammarian reads the word on their sheet, with its meaning and example."
        right={<div className="ph-r"><div className="ph-pills">
          <Link className="btn sm ghost" to={`/v/meetings/${id}/agenda`}>{I.cal}Configure agenda</Link>
          <Btn sm kind="ghost" onClick={downloadAgenda} disabled={pdfBusy}>{I.dl}{pdfBusy ? 'Preparing…' : 'Agenda PDF'}</Btn>
        </div></div>}>
        <div className="mgrid">
          <div className="mcol">
            <div className="lab blue" style={{ marginTop: 0 }}>The meeting</div>
            {field({ label: 'Date', k: 'date', type: 'date' })}
            {field({ label: 'Theme', k: 'theme', ph: 'e.g. Boundless Learning' })}
            {field({ label: 'Theme quotation', k: 'theme_quote', ph: 'Without quote marks', area: true })}
            {field({ label: 'Quotation by', k: 'theme_quote_by', ph: 'e.g. Navi Pillay' })}
          </div>
          <div className="mcol">
            <div className="lab blue" style={{ marginTop: 0 }}>Word of the day</div>
            <div className="wd">
              <div className="wd-word">
                <label className="fl" htmlFor="wd-w">Word</label>
                <div className="wd-in">
                  <input id="wd-w" className="inp" value={m.word || ''} placeholder="e.g. Assiduous" onChange={(e) => setField({ word: e.target.value })} />
                  <button type="button" className="wd-fill" onClick={fillWord} disabled={wordBusy || !m.word} title="Look up the meaning, example and more">{wordBusy ? 'Looking it up…' : 'Fill in the rest'}</button>
                </div>
                {wordNote && <p className="wd-note">{wordNote}</p>}
              </div>
              <div className="wd-pos">
                <label className="fl">Part of speech</label>
                <div className="wd-chips" role="group" aria-label="Part of speech">
                  {['noun', 'verb', 'adj.', 'adv.'].map((x) => <button type="button" key={x} className={(m.pos || '') === x ? 'on' : ''} aria-pressed={(m.pos || '') === x} onClick={() => setField({ pos: (m.pos || '') === x ? '' : x })}>{x}</button>)}
                  {m.pos && !['noun', 'verb', 'adj.', 'adv.'].includes(m.pos) && <button type="button" className="on" onClick={() => setField({ pos: '' })}>{m.pos}</button>}
                </div>
              </div>
              <div className="wd-pron">{field({ label: 'Pronunciation', k: 'pron', ph: 'uh-SIJ-oo-us' })}</div>
              <div className="wd-meaning">
                {field({ label: 'Meaning', k: 'meaning', ph: 'What it means', area: true })}
                {wordAlts.length > 0 && <div className="alts"><small>Other meanings. Tap one to use it.</small>{wordAlts.map((a, k) => <button type="button" key={k} className={m.meaning === a.text ? 'on' : ''} onClick={() => setField({ meaning: a.text, ...(a.pos ? { pos: a.pos } : {}) })}>{a.pos && <b>{a.pos}</b>} {a.text}</button>)}</div>}
              </div>
              <div className="wd-example">{field({ label: 'Example', k: 'example', ph: 'Use it in a sentence', area: true })}</div>
              <div className="wd-syn">{field({ label: 'Synonyms', k: 'synonyms', ph: 'Diligent, Studious, Persevering' })}</div>
              <div className="wd-origin">{field({ label: 'Origin', k: 'origin', ph: 'Where the word comes from' })}</div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel k="roles" title="Roles" hint={locked ? 'This meeting has happened. Roles are shown as they were.' : 'Choose who plays each role. They get their link as soon as you assign them.'}
        right={<Link className="lnk" to="/v/roster">Plan several meetings at once in the roster</Link>}>
        <div className="rgroup"><h3>Top table</h3><div className="rgrid">{roles.filter((r) => !['speaker', 'evaluator'].includes(r.role_key)).map(tile)}</div></div>
        <div className="rgroup"><h3>Speakers and their evaluators</h3>{(() => {
          const evs = roles.filter((r) => r.role_key === 'evaluator'), used = new Set();
          const cols = speakers.map((s) => { const mine = evs.filter((e) => e.target_role_id === s.id); mine.forEach((e) => used.add(e.id)); return { key: s.id, items: [s, ...mine] }; });
          evs.filter((e) => !used.has(e.id)).forEach((e) => cols.push({ key: e.id, items: [e] }));
          return <Strip>{cols.map((c) => <div className="pcol" key={c.key}>{c.items.map(tile)}</div>)}</Strip>;
        })()}</div>
      </Panel>

      <div className="pair">
        <Panel k="links" title="Role links" hint="Send each person their link. It opens their script and sheet, no sign-in."
          right={<div style={{ display: 'flex', gap: 8 }}><a className="btn sm" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer" href={wa(all)}>{I.send} Send all</a><Btn sm kind="ghost" onClick={() => copy(all)}>Copy all</Btn></div>}>
          <div className="list">
            {linkRows.map((r) => r.person ? (
              <div className="linkrow" key={r.id}>
                <div className="grow"><b>{r.label}</b> <small>· {r.person}</small>{personChip(r)}<code>{roleLink(base, r.token)}</code></div>
                <Btn sm kind="ghost" onClick={() => copy(roleLink(base, r.token))}>{I.copy}Copy</Btn>
                <a className="btn sm ghost" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer" href={wa(msg(r))} aria-label={`Send ${r.label} link on WhatsApp`}>{I.send}</a>
              </div>
            ) : <div className="linkrow" key={r.id}><div className="grow"><b>{r.label}</b><br /><span className="redpill">Assign someone to get a link</span></div></div>)}
          </div>
        </Panel>

        <Panel k="recv" title="Feedback received" hint={upcoming ? 'Opens up after the meeting. Open anyone to read what they submitted.' : `${pending ? `${pending} still to come. ` : 'Everyone has submitted. '}Open anyone to read what they submitted.`}
          right={fb.some((r) => r.submitted_at) ? <Btn sm kind="ghost" onClick={resetFb}>Reset submitted feedback</Btn> : null}>
          <div className="list">
            {fb.filter((r) => r.person).map((r) => (
              <div className="linkrow rowbtn" key={r.id}>
                <button type="button" className="grow" onClick={() => setViewing(r.id)} aria-label={`Read ${r.label} feedback from ${r.person}`}><b>{r.label}</b><br /><small>{r.person}</small>{personChip(r)}</button>
                {r.submitted_at ? <Chip kind="ok">{I.check}Submitted</Chip> : <><Chip kind="wait">Pending</Chip>
                  <a className="btn sm ghost" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer" href={wa(msg(r, 'remind'))}>Remind</a></>}
                <button type="button" className="x" onClick={() => setViewing(r.id)} aria-label="Open">{I.chev}</button>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {viewing && <SubmissionViewer id={viewing} list={fb.filter((r) => r.person)} onGo={setViewing} onClose={() => setViewing(null)} remind={(r) => wa(msg(r, 'remind'))} />}
    </Page>
  );
}

/* a submitted sheet as a full page: what they wrote on the left, the official form filled in on the right */
const FORM_ROLES = ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'general_evaluator'];
export function SubmissionPage({ mine }) {
  const { id } = useParams();
  const desk = useDesk();
  const { data: d, error, loading } = useApi(mine ? `/me/given/${id}` : `/vpe/roles/${id}/submission`);
  const [pdf, setPdf] = useState(null);
  useEffect(() => { document.querySelector('.scroll')?.scrollTo({ top: 0 }); }, []);
  const hasForm = !!d && FORM_ROLES.includes(d.role.key);
  useEffect(() => {
    if (!hasForm) return undefined;
    let url = null, gone = false;
    fetch(`/api/${mine ? `me/given/${id}` : `vpe/roles/${id}`}/report.pdf`, { headers: { 'x-token': getToken() } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no form'))))
      .then((b) => { if (gone) return; url = URL.createObjectURL(b); setPdf(url); })
      .catch(() => { if (!gone) setPdf(''); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [id, mine, hasForm]);
  const back = mine ? '/m/given' : undefined;
  const title = d ? d.role.label : 'Feedback';
  if (error) return <Page title="Feedback" back={back}><ErrorMsg error={error} /></Page>;
  const preview = (
    <div className="ref"><div className="pdfwrap">
      {pdf ? <iframe className="pdfframe" title={`${title} form`} src={`${pdf}#toolbar=0&navpanes=0&view=FitH`} />
        : <i className="sk1" style={{ display: 'block', width: '100%', height: '100%', minHeight: 300, borderRadius: 12 }} />}
    </div></div>
  );
  if (loading || !d) return (
    <Page title="Feedback" wide={desk} back={back}>
      {desk ? <div className="split wide"><div><SkPage plain rows={5} pill={false} /></div>{preview}</div> : <SkPage plain rows={5} pill={false} />}
    </Page>
  );
  const cur = { label: d.role.label, person: d.role.person, submitted_at: d.role.submitted_at };
  const left = (
    <>
      <h1 className="pg sm">{d.role.label}</h1>
      <ul className="ev-list">
        {!mine && d.role.person && <li><span className="evi">{I.ppl}<span><b>{d.role.person}</b></span></span></li>}
        <li><span className="evi">{I.cal}<span>Meeting {d.role.meeting} · {longDate(d.role.date)}</span></span>
          <span className="evi">{I.doc}<span>{d.role.submitted_at ? `Submitted ${longDate(String(d.role.submitted_at).slice(0, 10))}` : 'Not submitted yet'}</span></span></li>
      </ul>
      <SubmissionBody flat d={d} cur={cur} remind={() => '#'} />
    </>
  );
  const download = () => { const a = document.createElement('a'); a.href = pdf; a.download = `${d.role.label.replace(/\s+/g, '-')}.pdf`; document.body.appendChild(a); a.click(); a.remove(); };
  const dl = hasForm && pdf ? <Btn onClick={download}>{I.dl} Download the form (PDF)</Btn> : null;
  return (
    <Page title="Feedback" wide={desk} back={back}>
      {desk && hasForm
        ? <><div className="split wide"><div>{left}</div>{preview}</div>{dl && <div className="eval-go">{dl}</div>}</>
        : <>{left}{dl && <div style={{ marginTop: 16 }}>{dl}</div>}</>}
    </Page>
  );
}

/* what a role player wrote, laid out by role: used in the pop-up and on the full sheet page */
const SayCard = ({ children }) => <div className="say">{children}</div>;
export function SubmissionBody({ d, cur, error, loading, remind, flat }) {
  const Card = SayCard;
  return (
    <div className={'viewer' + (flat ? ' flat' : '')}>
        {loading && <SkRows n={4} avatar />}
        {error && <ErrorMsg error={error} />}
        {d && !cur?.submitted_at && <div className="banner"><b>Waiting on {cur.person}.</b> <a className="lnk" href={remind(cur)} target="_blank" rel="noreferrer">Send a reminder</a>{(d.rows?.length || d.evaluation) ? ' Their draft so far is shown below.' : ''}</div>}
        {d && d.role.key === 'grammarian' && (d.rows.length ? d.rows.map((r, k) => (
          <Card key={k}><div className="who">{r.name}</div><Chip kind={r.used ? 'ok' : ''}>{r.used && I.check}{r.used ? (r.uses > 1 ? `Used the word ${r.uses} times` : 'Used the word of the day') : 'Did not use the word'}</Chip>
            {r.liked && <div className="note g" style={{ marginTop: 8 }}><i>Liked</i>{r.liked}</div>}
            {(r.improper || r.suggestion) && <div className="note m" style={{ marginTop: 8 }}><i>To polish</i>{r.improper}{r.improper && r.suggestion ? ' → ' : ''}{r.suggestion}</div>}</Card>)) : <p className="lede">Nothing recorded.</p>)}
        {d && d.role.key === 'ah_counter' && (d.rows.length ? d.rows.map((r, k) => (
          <Card key={k}><div className="who">{r.name}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}><div className="cnts" style={{ flex: 1 }}>{Object.entries(r.counts).filter(([, n]) => n).map(([w, n]) => <div className="cnt" key={w}><small>{cap(w)}</small><b>{n}</b></div>)}</div>
              <div style={{ textAlign: 'right' }}><span className="total">TOTAL</span><div className="big">{sum(r.counts)}</div></div></div>
            {r.comment && <div className="note" style={{ marginTop: 8 }}><i>Comment</i>{r.comment}</div>}</Card>)) : <p className="lede">Nothing recorded.</p>)}
        {d && d.role.key === 'timer' && (d.rows.length ? d.rows.map((r, k) => { const c = cardOf(r.seconds, [r.green, r.yellow, r.red]); return (
          <Card key={k}><div className="who">{r.name} · {r.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><div className="big">{mmss(r.seconds)}</div><div style={{ textAlign: 'right', fontSize: 14 }}><span className={'dot ' + c} /> <b>{CARDTXT[c]}</b></div></div>
            {r.comment && <div className="note" style={{ marginTop: 8 }}><i>Comment</i>{r.comment}</div>}</Card>); }) : <p className="lede">No times recorded.</p>)}
        {d && d.role.key === 'topicsmaster' && <>
          <div className="lab" style={{ marginTop: 0 }}>Topics</div>{d.topics.length ? <ul className="plain">{d.topics.map((t, k) => <li key={k}>{t}</li>)}</ul> : <p className="lede">None listed.</p>}
          <div className="lab">Who spoke on what</div>{d.rows.length ? d.rows.map((r, k) => <Card key={k}><div className="who">{r.name}</div>{r.topic || 'No topic recorded'}</Card>) : <p className="lede">Nobody recorded.</p>}</>}
        {d && d.role.key === 'evaluator' && (d.evaluation ? (() => { const e = d.evaluation, avg = mean((e.ratings || []).filter(Boolean)); return (<>
          <Card><div className="who">{e.speaker}</div><b>{e.path}, Level {e.level}: {e.project}</b><div style={{ color: 'var(--mute)', fontSize: 14 }}>“{e.title}”{e.seconds != null ? ` · ${mmss(e.seconds)}` : ''}</div>
            <div className="score"><b>{avg ? avg.toFixed(1) : '-'}</b><span>out of 5</span></div></Card>
          <div className="list">{CRIT.map(([n], k) => { const v = e.ratings?.[k] || 0; return <div className="rrow" key={n}><div className="rh"><b>{n}</b><span className="scale">{[1, 2, 3, 4, 5].map((q) => <u key={q} className={q <= v ? (v >= 4 ? 'hi' : v === 3 ? 'mid' : 'lo') : ''} />)}</span><span className="v">{v ? `${v} · ${LEVELN[v]}` : 'Not rated'}</span></div>{e.comments?.[k] && <p>{e.comments[k]}</p>}</div>; })}</div>
          <div className="note g" style={{ marginTop: 14 }}><i>Excelled at</i>{e.excelled || 'Nothing recorded'}</div>
          <div className="note m" style={{ marginTop: 10 }}><i>May want to work on</i>{e.work || 'Nothing recorded'}</div>
          <div className="note" style={{ marginTop: 10 }}><i>Challenge</i>{e.challenge || 'Nothing recorded'}</div></>); })() : <p className="lede">No evaluation recorded.</p>)}
        {d && d.role.key === 'general_evaluator' && <>
          {d.comments.length > 0 && <><div className="lab" style={{ marginTop: 0 }}>Comments on role players</div>{d.comments.map((c, k) => <Card key={k}><div className="who">{c.person} · {c.role}</div>{c.well && <div className="note g"><i>Went well</i>{c.well}</div>}{c.improve && <div className="note m" style={{ marginTop: 8 }}><i>To improve</i>{c.improve}</div>}</Card>)}</>}
          <div className="lab">Checklist</div>
          {GE_SECTIONS.map(([name, qs], si) => { const sec = d.sections?.[si]; if (!sec) return null; return (
            <div key={name} style={{ marginBottom: 10 }}><div className="who" style={{ margin: '10px 0 4px' }}>{name}</div>
              {qs.map((q, qi) => <div className="qrow" key={q}><span>{q}</span><span className={'chip ' + (sec.a?.[qi] === 'y' ? 'ok' : sec.a?.[qi] === 'n' ? 'wait' : '')}>{sec.a?.[qi] === 'y' ? 'Yes' : sec.a?.[qi] === 'n' ? 'No' : 'Not answered'}</span></div>)}
              {sec.notes && <div className="note" style={{ marginTop: 6 }}><i>Notes</i>{sec.notes}</div>}</div>); })}</>}
      </div>
  );
}

/* read what a role player submitted, and step through everyone's */
export function SubmissionViewer({ id, list, onGo, onClose, remind, mine }) {
  const { data: d, error, loading } = useApi(mine ? `/me/given/${id}` : `/vpe/roles/${id}/submission`);
  const i = list.findIndex((r) => r.id === id), cur = list[i];
  const prev = list[i - 1], next = list[i + 1];
  return (
    <Modal wide title={cur ? (mine ? cur.label : `${cur.label} · ${cur.person}`) : 'Feedback'} onClose={onClose}>
      <p style={{ margin: '0 0 12px', color: 'var(--mute)', fontSize: 14.5 }}>
        {cur?.submitted_at ? `Submitted ${longDate(String(cur.submitted_at).slice(0, 10))}` : 'Not submitted yet'}{d?.role ? ` · Meeting ${d.role.meeting}` : ''}
      </p>
      <SubmissionBody d={d} cur={cur} error={error} loading={loading} remind={remind} />
      <div className="row-btns" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" sm disabled={!prev} onClick={() => onGo(prev.id)}>{I.back} {prev ? prev.label : 'Previous'}</Btn>
          <Btn kind="ghost" sm disabled={!next} onClick={() => onGo(next.id)}>{next ? next.label : 'Next'} {I.chev}</Btn>
        </div>
        <Btn sm onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

/* ───────── people: members and visitors ───────── */
export function VpePeople() {
  const { data, error, loading, reload } = useApi('/vpe/people');
  const desk = useDesk();
  const toast = useToast();
  const base = useBaseUrl();
  const [tab, setTab] = useState('members');
  const [qy, setQy] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [inv, setInv] = useState(null);
  const sess = useApi('/session');
  if (loading) return <Page root wide full><SkPage avatar rows={8} /></Page>;
  if (error) return <Page root wide full><div className="rpage"><ErrorMsg error={error} /></div></Page>;

  const hit = (p) => !qy.trim() || `${p.name} ${p.email || ''}`.toLowerCase().includes(qy.trim().toLowerCase());
  const allMembers = data.filter((p) => p.kind === 'member' && p.status !== 'inactive');
  const visitors = data.filter((p) => p.kind === 'guest');
  const liveGuests = visitors.filter((p) => p.status !== 'inactive'), archived = visitors.filter((p) => p.status === 'inactive');
  const members = allMembers.filter(hit);                    // the server already returns them A to Z
  const act = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message); } };
  const copyLink = async (e, p) => { e.preventDefault(); e.stopPropagation(); toast((await copyText(memberLink(base, p.token))) ? 'Access link copied' : 'Copy failed'); };

  const memberRow = (p) => (
    <Link className="prow m" key={p.id} to={`/v/members/${p.id}`}>
      <span className="who"><Avatar name={p.name} /><span><b>{p.name}{p.is_vpe && <Chip style={{ marginLeft: 8 }}>VPE</Chip>}</b><small>{desk ? p.email : `${p.path_name ? `${p.path_name}, L${p.path_level || 1} · ` : ''}${p.speeches} ${p.speeches === 1 ? 'speech' : 'speeches'} · ${p.roles_done} ${p.roles_done === 1 ? 'role' : 'roles'} · ${p.feedback_given} feedback given`}</small></span></span>
      {desk && <span className="pth">{p.path_name ? <><b>{p.path_name}</b><span className="lvs" aria-label={`Level ${p.path_level || 1} of 5`}>{[1, 2, 3, 4, 5].map((k) => <i key={k} className={k < (p.path_level || 1) ? 'dn' : k === (p.path_level || 1) ? 'now' : ''} />)}<small>Level {p.path_level || 1}</small></span></> : <small className="dim">No path set</small>}</span>}
      {desk && <><span className="num cnt0">{p.speeches}</span><span className="num cnt0">{p.roles_done}</span><span className="num cnt0">{p.feedback_given}</span></>}
      <span className="pact">{I.chev}</span>
    </Link>
  );

  const guestRow = (p) => (
    <div className="prow guest" key={p.id}>
      <span className="who"><Avatar name={p.name} tone="gray" /><span><b><Link className="plink" to={`/v/members/${p.id}`}>{p.name}</Link></b><small>{p.email || 'No email'}</small></span></span>
      <span className="gstat">{p.status === 'inactive' ? <Status kind="fin">Archived</Status> : p.join_requested_at ? <Status kind="ok">Wants to join</Status> : <Status kind="up">Temporary</Status>}{p.temp_until && <small>until {longDate(p.temp_until)}</small>}</span>
      {desk && <span className="num hm">{p.roles_played} {p.roles_played === 1 ? 'role' : 'roles'}</span>}
      {desk && <span className="hm dim c-opt">{p.created_via === 'role_sheet' ? 'Added from a sheet' : 'Added by VPE'}</span>}
      <span className="gbtns">
        <Btn sm kind={p.join_requested_at ? '' : 'ghost'} onClick={() => act(() => api(`/vpe/people/${p.id}`, { method: 'PATCH', body: { convert: true } }), `${p.name} is now a member`)}>Make member</Btn>
        {p.status !== 'inactive' && <button type="button" className="gico" title="Copy access link" aria-label={`Copy ${p.name}'s access link`} onClick={(e) => copyLink(e, p)}>{I.copy}</button>}
        {p.status === 'inactive'
          ? <button type="button" className="gtxt" onClick={() => act(() => api(`/vpe/people/${p.id}`, { method: 'PATCH', body: { status: 'active' } }), 'Restored')}>Restore</button>
          : <>
              <button type="button" className="gtxt" onClick={() => act(() => api(`/vpe/people/${p.id}/extend`, { method: 'POST' }), 'Extended by 30 days')}>Extend</button>
              <button type="button" className="gtxt warn" onClick={() => act(() => api(`/vpe/people/${p.id}`, { method: 'PATCH', body: { status: 'inactive' } }), 'Archived. Their data is kept.')}>Archive</button>
            </>}
      </span>
    </div>
  );

  return (
    <Page root wide full>
      <div className="rpage">
      <div className="rhead">
        <div>
          <p className="reyebrow">Champions Toastmasters Club</p>
          <h1 className="rtitle">Members</h1>
          <p className="rsub">Open anyone to see what they have delivered and the feedback they have given.</p>
        </div>
        <div className="rh-act"><Btn kind="ghost" onClick={() => setImporting(true)}>{I.dl} Import roster</Btn><Btn onClick={() => setAdding(true)}>{I.plus} Add member</Btn></div>
      </div>

      <div className="pp-card">
      <div className="ptools">
        <Seg value={tab} onChange={setTab} options={[['members', `Members ${allMembers.length}`], ['guests', `Visitors ${liveGuests.length}`]]} style={{ minWidth: 240 }} />
        <label className="psearch"><span aria-hidden="true">{I.search}</span><input value={qy} onChange={(e) => setQy(e.target.value)} placeholder="Search by name or email" aria-label="Search members" /></label>
      </div>

      {tab === 'members' && (
        <>
          <div className="plist">
            {desk && <div className="prow m hd"><span>Member</span><span>Pathway</span><span className="num" title="Speeches that have been evaluated">Speeches</span><span className="num" title="Roles at meetings that have already happened">Roles done</span><span className="num" title="Role sheets they have submitted">Feedback given</span><span /></div>}
            {members.map(memberRow)}
            {!members.length && <p className="empty">No one matches “{qy}”.</p>}
          </div>
        </>
      )}
      {tab === 'guests' && (
        <>
          <div className="plist g">
            {desk && <div className="prow hd guest"><span>Visitor</span><span>Status</span><span className="num">Roles</span><span className="c-opt">Source</span><span /></div>}
            {liveGuests.filter(hit).map(guestRow)}
            {!liveGuests.length && <p className="empty">No visitors right now. Add one here, from a role dropdown, or a role player can add them from their sheet.</p>}
          </div>
          {archived.length > 0 && <><button type="button" className="lnk" style={{ margin: '18px 4px 6px' }} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide' : 'Show'} archived visitors ({archived.length})</button>{showArchived && <div className="plist g">{archived.filter(hit).map(guestRow)}</div>}</>}
        </>
      )}
      </div>
      {inv && <InviteModal person={inv} mode="invite" club={sess.data?.club || 'our club'} onClose={() => setInv(null)} onDone={reload} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); toast(n); reload(); }} />}
      {adding && <AddPerson onClose={() => setAdding(false)} onInvite={(p) => { setAdding(false); setTab('members'); setInv(p); reload(); }} onDone={(p) => { setAdding(false); toast(`${p.name} added`); setTab(p.kind === 'guest' ? 'guests' : 'members'); reload(); }} />}
      </div>
    </Page>
  );
}

const WA_ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.95L2 22l5.2-1.5A9.9 9.9 0 1 0 12.04 2zm0 1.8a8.1 8.1 0 1 1-4.3 14.96l-.3-.2-3 .87.9-2.9-.2-.3A8.1 8.1 0 0 1 12.04 3.8zM8.6 7.6c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4l-.5-.3-1.8-.9c-.3-.1-.5-.1-.7.1l-.8 1c-.2.2-.3.2-.6.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.3.1-.2 0-.4 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5z"/></svg>;
/* the Club Central roster, added to a club that already exists */
function ImportModal({ onClose, onDone }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/vpe/people/import', { method: 'POST', body: { members: toMembers(rows) } });
      onDone(`${r.added} added${r.updated ? `, ${r.updated} updated` : ''}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Import your roster" onClose={onClose} wide>
      <p style={{ color: 'var(--mute)', fontSize: 14.5, margin: '6px 0 12px' }}>Export your club roster from Club Central and choose the file. People already in Brekkie are matched by email or name and brought up to date, not added twice. Paths and levels come from the credentials in the file; fix any that are wrong.</p>
      <RosterImport rows={rows} onRows={setRows} />
      {err && <p className="err">{err}</p>}
      <div className="row-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={go} disabled={busy || !rows.some((r) => r.on)}>{busy ? 'Importing…' : `Import ${rows.filter((r) => r.on).length || ''}`.trim()}</Btn></div>
    </Modal>
  );
}

function AddPerson({ onClose, onDone, onInvite }) {
  const [kind, setKind] = useState('member');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [cred, setCred] = useState('TM');
  const [pd, setPd] = useState({ path_name: '', levels_done: 0 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const p = await api('/vpe/people', { method: 'POST', body: { name, email, phone, kind, credential: cred, ...(kind === 'member' ? pd : {}) } });
      kind === 'member' ? onInvite({ ...p, phone: phone.trim() }) : onDone(p);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Add a member or visitor" onClose={onClose}>
      <Seg style={{ margin: '12px 0 4px' }} value={kind} onChange={setKind} options={[['member', 'Club member'], ['guest', 'Visitor (temporary)']]} />
      <p style={{ color: 'var(--mute)', fontSize: 14, margin: '6px 0 0' }}>{kind === 'guest' ? 'For someone outside the club taking a role. They get a temporary link, and their data is kept with Champions.' : 'A full member with their own sign in and history. Next you can send them an invite on WhatsApp.'}</p>
      <label className="fl">Full name</label><input className="inp" autoFocus autoComplete="off" name="person-name" data-bwignore="true" data-lpignore="true" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name as it should appear" />
      <label className="fl">Email (optional)</label><input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mail.com" />
      <label className="fl">Phone (optional)</label><input className="inp" type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263 7…" maxLength={30} />
      <p className="fine" style={{ margin: '2px 0 0' }}>Used to message them on WhatsApp about their role.</p>
      <label className="fl">Toastmasters title on the agenda (optional)</label><input className="inp" value={cred} onChange={(e) => setCred(e.target.value)} placeholder="TM, DTM, ACB…" maxLength={20} />
      {kind === 'member' && <>
        <label className="fl">Pathways path and current level (optional)</label>
        <PathDone path={pd.path_name} done={pd.levels_done} onChange={setPd} />
        <p className="fine" style={{ margin: '6px 0 0' }}>Every level before the one you pick is logged as finished, so you do not need the individual projects or dates.</p>
      </>}
      {err && <p className="err">{err}</p>}
      <div className="row-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={go} disabled={busy || name.trim().length < 2}>Add</Btn></div>
    </Modal>
  );
}

/* a row that opens the full list of one kind of feedback they have received */
function Rec({ title, count, to }) {
  return count > 0 ? <Link className="rec-link" to={to}><span>{title}</span><span className="dim">{count}</span>{I.chev}</Link> : null;
}

/* the kinds of feedback a member receives, each with how one entry reads */
const Pt = ({ good, tag, children }) => <p className={'pt ' + (good ? 'good' : 'bad')} title={tag}>{children}</p>;
const dShort = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });
const RECEIVED = {
  gram: { title: 'Grammar notes', pick: (r) => r.gram, row: (g) => <><b>{dShort(g.date)} · {g.by}</b>{g.liked && <Pt good tag="Liked">{g.liked}</Pt>}{(g.improper || g.suggestion) && <Pt tag="To polish">{g.improper}{g.improper && g.suggestion ? ' → ' : ''}{g.suggestion}</Pt>}</> },
  fill: { title: 'Filler words', pick: (r) => r.fill, row: (f) => <><b>{dShort(f.date)} · {f.by}</b><div className="fchips">{Object.entries(f.counts).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([w, n]) => <span className="fchip" key={w}>{cap(w)}<b>{n}</b></span>)}<span className="fchip tot">Total<b>{sum(f.counts)}</b></span></div>{f.comment && <p>{f.comment}</p>}</> },
  time: { title: 'Timing', pick: (r) => r.time, row: (t) => { const c = cardOf(t.seconds, [t.green, t.yellow, t.red]); return <><b>{dShort(t.date)} · {t.by}</b><p><span className={'dot ' + c} /> {mmss(t.seconds)} · {CARDTXT[c]}{t.comment ? ` · ${t.comment}` : ''}</p></>; } },
  general: { title: 'From the General Evaluator', pick: (r) => r.roleFeedback, row: (r) => <><b>{r.role} · {dShort(r.date)}</b>{r.well && <Pt good tag="Went well">{r.well}</Pt>}{r.improve && <Pt tag="To improve">{r.improve}</Pt>}</> },
  room: { title: 'From the room', pick: (r) => r.peer, row: (r) => <><b>{r.from_name || 'Anonymous'} · {dShort(r.date)}</b>{r.well && <Pt good tag="Went well">{r.well}</Pt>}{r.improve && <Pt tag="To try">{r.improve}</Pt>}</> },
};

/* every entry of one kind, on a page of its own */
export function ReceivedPage() {
  const { id, kind } = useParams();
  const desk = useDesk();
  const { data, error, loading } = useApi(`/vpe/people/${id}/profile`);
  useEffect(() => { document.querySelector('.scroll')?.scrollTo({ top: 0 }); }, []);
  const K = RECEIVED[kind];
  const back = `/v/members/${id}`;
  if (error || !K) return <Page title="Feedback" back={back}><ErrorMsg error={error || { message: 'Not found' }} /></Page>;
  if (loading) return <Page title="Feedback" wide={desk} back={back}><SkPage plain rows={6} pill={false} /></Page>;
  const items = K.pick(data.received);
  return (
    <Page title="Feedback" wide={desk} back={back}>
      <h1 className="pg sm">{K.title}</h1>
      <ul className="ev-list">
        <li><span className="evi">{I.ppl}<span><b>{data.person.name}</b></span></span><span className="evi">{I.doc}<span>{items.length} {items.length === 1 ? 'entry' : 'entries'}</span></span></li>
      </ul>
      {!items.length && <p className="empty tight">Nothing yet.</p>}
      <div className="recgrid">{items.map((it, i) => <div className="rec-card" key={it.id ?? i}>{K.row(it)}</div>)}</div>
    </Page>
  );
}

/* ───────── one member: what they have delivered, the roles they have done, the feedback they have given ───────── */
/* a row of columns that scrolls sideways, with arrows when there is more than fits */
function Strip({ children }) {
  const ref = useRef(null);
  const [can, setCan] = useState({ l: false, r: false });
  const upd = () => { const e = ref.current; if (e) setCan({ l: e.scrollLeft > 4, r: e.scrollLeft + e.clientWidth < e.scrollWidth - 4 }); };
  useEffect(() => { upd(); const e = ref.current; if (!e || !window.ResizeObserver) return undefined; const ro = new ResizeObserver(upd); ro.observe(e); return () => ro.disconnect(); });
  const go = (d) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.9, behavior: 'smooth' });
  return (
    <div className="strip">
      {can.l && <button type="button" className="sarr l" onClick={() => go(-1)} aria-label="Scroll left">{I.back}</button>}
      <div className="pairs" ref={ref} onScroll={upd}>{children}</div>
      {can.r && <button type="button" className="sarr r" onClick={() => go(1)} aria-label="Scroll right">{I.chev}</button>}
    </div>
  );
}

/* a status as plain text with a small dot, not a pill */
function Status({ kind, children }) { return <span className={'stt ' + kind}><i />{children}</span>; }

/* a long list shows the first few rows, then a button for the rest */
function Fold({ items, n = 5, label = 'items', children }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, n);
  return (
    <>
      <div className="plist2">{shown.map(children)}</div>
      {items.length > n && <button type="button" className="fold-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length} ${label}`}</button>}
    </>
  );
}

/* WhatsApp wants the number with its country code, so a local number starting with 0 opens the contact chooser instead */
const waTo = (phone, msg) => {
  const raw = (phone || '').trim(), digits = raw.replace(/[^\d]/g, '');
  return `https://wa.me/${digits.length >= 10 && !raw.startsWith('0') ? digits : ''}?text=${encodeURIComponent(msg)}`;
};
const inviteText = (name, club, link) => `Hi ${name.split(' ')[0]}, I have set up Brekkie for ${club}, where you will find your roles, feedback and progress. Tap to choose your password and you are in: ${link}`;
const resetText = (name, link) => `Hi ${name.split(' ')[0]}, here is your Brekkie password reset link. It works for 24 hours: ${link}`;

/* the VPE sends one invite, or a password reset, on WhatsApp */
function InviteModal({ person, mode, club, onClose, onDone }) {
  const toast = useToast();
  const base = useBaseUrl();
  const [link, setLink] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const go = mode === 'invite' ? api('/vpe/invites', { method: 'POST', body: { ids: [person.id] } }).then((r) => { if (!r[0]) throw new Error('This member already has an account'); return r[0].token; }) : api(`/vpe/people/${person.id}/reset`, { method: 'POST' }).then((r) => r.token);
    go.then((t) => setLink(`${base}/reset/${t}`), (e) => setErr(e.message));
  }, [person.id, base, mode]);
  const msg = link && (mode === 'invite' ? inviteText(person.name, club, link) : resetText(person.name, link));
  const first = person.name.split(' ')[0];
  return (
    <Modal title={mode === 'invite' ? `Invite ${first}` : 'Reset password'} onClose={onClose}>
      {err && <p className="err">{err}</p>}
      {!err && !link && <SkRows n={2} pill={false} />}
      {link && (
        <>
          <p style={{ color: 'var(--mute)', margin: '4px 0 12px' }}>{mode === 'invite' ? `Send ${first} this message. They tap the link, choose a password and they are in. It works for a week.` : `Send ${first} this link. It works for 24 hours and lets them choose a new password.`}</p>
          <div className="iv-msg">{msg}</div>
          <div className="rs-btns">
            <a className="btn wa" href={waTo(person.phone, msg)} target="_blank" rel="noreferrer" onClick={() => onDone && onDone()}>Send on WhatsApp</a>
            <Btn kind="ghost" onClick={async () => toast((await copyText(msg)) ? 'Message copied' : 'Copy failed')}>Copy message</Btn>
          </div>
          {!person.phone && <p className="fine" style={{ marginTop: 10 }}>No phone number saved, so WhatsApp will ask you to choose the contact.</p>}
        </>
      )}
    </Modal>
  );
}

/* invite everyone who has not signed up yet: one draft per member, opened one tap at a time */
export function BulkInvite({ people, club, onClose, onDone }) {
  const base = useBaseUrl();
  const [links, setLinks] = useState(null);
  const [sent, setSent] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => { api('/vpe/invites', { method: 'POST', body: { ids: people.map((p) => p.id) } }).then((r) => setLinks(Object.fromEntries(r.map((x) => [x.id, `${base}/reset/${x.token}`]))), (e) => setErr(e.message)); }, []); // eslint-disable-line
  const next = people.find((p) => !sent[p.id]);
  const left = people.filter((p) => !sent[p.id]).length;
  return (
    <Modal title="Send invites" onClose={() => { onDone(); onClose(); }} wide>
      <p style={{ color: 'var(--mute)', margin: '4px 0 12px' }}>WhatsApp opens one chat at a time. Tap Send on each row: the message is already written, you just press send in WhatsApp. {left ? `${left} to go.` : 'All done.'}</p>
      {err && <p className="err">{err}</p>}
      {!err && !links && <SkRows n={4} pill />}
      {links && (
        <div className="iv-list">
          {people.filter((p) => links[p.id]).map((p) => (
            <div key={p.id} className={'iv-row' + (next?.id === p.id ? ' now' : '') + (sent[p.id] ? ' sent' : '')}>
              <Avatar name={p.name} />
              <span><b>{p.name}</b><small>{p.phone || 'No phone saved'}{p.acct === 'invited' && !sent[p.id] ? ' · invited before' : ''}</small></span>
              {sent[p.id]
                ? <span className="iv-ok">{I.check} Sent</span>
                : <a className={'btn sm' + (next?.id === p.id ? '' : ' ghost')} href={waTo(p.phone, inviteText(p.name, club, links[p.id]))} target="_blank" rel="noreferrer" onClick={() => setSent((x) => ({ ...x, [p.id]: true }))}>Send</a>}
            </div>
          ))}
        </div>
      )}
      <div className="rs-btns"><Btn onClick={() => { onDone(); onClose(); }}>{left ? 'Finish later' : 'Done'}</Btn></div>
    </Modal>
  );
}

/* edit a member's details from their settings menu */
function EditPerson({ person, onClose, onSaved }) {
  const [f, setF] = useState({ name: person.name, email: person.email || '', phone: person.phone || '', credential: person.credential || '' });
  const [pd, setPd] = useState({ path_name: person.path_name || '', levels_done: Math.max(0, (person.path_level || 1) - 1) });
  const [pdTouched, setPdTouched] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await api(`/vpe/people/${person.id}`, { method: 'PATCH', body: pdTouched && person.kind !== 'guest' ? { ...f, ...pd } : f }); onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Edit details" onClose={onClose}>
      <label className="fl">Full name</label><input className="inp" autoComplete="off" name="edit-name" data-bwignore="true" value={f.name} onChange={set('name')} />
      <label className="fl">Email</label><input className="inp" type="email" autoComplete="off" name="edit-email" data-bwignore="true" value={f.email} onChange={set('email')} placeholder="name@mail.com" />
      <label className="fl">Phone</label><input className="inp" type="tel" autoComplete="off" name="edit-phone" data-bwignore="true" value={f.phone} onChange={set('phone')} placeholder="+263 7…" maxLength={30} />
      <label className="fl">Toastmasters title on the agenda</label><input className="inp" value={f.credential} onChange={set('credential')} placeholder="TM, DTM, ACB…" maxLength={20} />
      {person.kind !== 'guest' && <>
        <label className="fl">Pathways path and current level</label>
        <PathDone path={pd.path_name} done={pd.levels_done} onChange={(v) => { setPd(v); setPdTouched(true); }} />
        <p className="fine" style={{ margin: '6px 0 0' }}>Levels before this one are logged as finished before Brekkie. Projects done at meetings count on their own.</p>
      </>}
      {err && <p className="err">{err}</p>}
      <div className="row-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy || f.name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</Btn></div>
    </Modal>
  );
}

/* removing keeps everything they delivered and received; they just lose access and leave the lists */
function RemovePerson({ person, onClose }) {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api(`/vpe/people/${person.id}`, { method: 'PATCH', body: { status: 'inactive' } }); toast(`${person.name} removed`); nav(person.kind === 'guest' ? '/v/members' : '/v/members', { replace: true }); } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Remove ${person.name}?`} onClose={onClose}>
      <p style={{ color: 'var(--mute)', margin: '6px 0 0' }}>They lose access and disappear from your lists. Their evaluations and past roles stay in the club's records.</p>
      <div className="row-btns"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={go} disabled={busy} style={{ background: '#B3261E', borderColor: '#B3261E' }}>{busy ? 'Removing…' : 'Remove'}</Btn></div>
    </Modal>
  );
}

export function VpePerson() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/vpe/people/${id}/profile`);
  const [viewing, setViewing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { if (!menu) return undefined; const f = () => setMenu(false); window.addEventListener('click', f); return () => window.removeEventListener('click', f); }, [menu]);
  const sess = useApi('/session');
  if (loading) return <Page title="Members" wide back="/v/members"><SkPage plain rows={6} stats={3} pill={false} /></Page>;
  if (error) return <Page title="Members" wide back="/v/members"><ErrorMsg error={error} /></Page>;
  const { person: p, projects, roles, given, received } = data;
  const visitor = p.kind === 'guest';
  const rolesDone = roles.filter((r) => !r.upcoming);
  const save = (k, cur) => (e) => { const v = e.target.value.trim(); if (v !== (cur || '')) api(`/vpe/people/${p.id}`, { method: 'PATCH', body: { [k]: v } }).then(() => { toast('Saved'); reload(); }).catch((x) => { toast(x.message); e.target.value = cur || ''; }); };
  const FB = ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'evaluator', 'general_evaluator'];
  const d = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });

  return (
    <Page title="Members" wide back="/v/members">
      <div className="phero">
        <Avatar name={p.name} size={84} tone={visitor ? 'gray' : undefined} />
        <div className="pi">
          <p className="reyebrow" style={{ margin: 0 }}>{visitor ? 'Visitor, temporary access' : p.is_vpe ? 'VPE' : 'Member'}</p>
          <h1 className="rtitle" style={{ fontSize: 40, margin: '2px 0 6px' }}>{p.name}</h1>
          <div className="pmeta">
            <span>{p.email || 'No email'}</span>
            <span>{p.phone || 'No phone'}</span>
            <span>Agenda title: {p.credential || 'none'}</span>
          </div>
        </div>
        <div className="pset">
          {!visitor && <Status kind={p.has_pw ? 'ok' : p.invited_at ? 'up' : 'fin'}>{p.has_pw ? 'Signed in' : p.invited_at ? 'Invited' : 'Not invited yet'}</Status>}
          <button type="button" className="ibtn pset-b" onClick={(e) => { e.stopPropagation(); setMenu(!menu); }} aria-label="Settings" aria-expanded={menu}>{I.more}</button>
          {menu && (
            <div className="rmenu pset-m" role="menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setEditing(true); }}>Edit details</button>
              {!visitor && <button type="button" role="menuitem" onClick={() => { setMenu(false); setResetting(p.has_pw ? 'reset' : 'invite'); }} disabled={!p.has_pw && false}>{p.has_pw ? 'Send reset link' : p.invited_at ? 'Resend invite' : 'Send invite'}</button>}
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); setRemoving(true); }}>Remove {visitor ? 'visitor' : 'member'}</button>
            </div>)}
        </div>
      </div>
      {editing && <EditPerson person={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Saved'); reload(); }} />}
      {removing && <RemovePerson person={p} onClose={() => setRemoving(false)} />}
      {resetting && <InviteModal person={p} mode={resetting} club={sess.data?.club || 'our club'} onClose={() => setResetting(null)} onDone={reload} />}
      {visitor && (
        <div className="banner"><b>Temporary status.</b> {p.temp_until ? `Access runs until ${longDate(p.temp_until)}. ` : ''}Everything they record is already stored under Champions.
          <div style={{ marginTop: 10 }}><Btn sm onClick={async () => { await api(`/vpe/people/${p.id}`, { method: 'PATCH', body: { convert: true } }); toast(`${p.name} is now a member`); reload(); }}>Make a member</Btn></div></div>)}

      {!visitor && <PathCard person={p} initial={data.path} />}

      <div className="pstats three">
        <div><small>Speeches</small><b>{projects.length}</b><span>delivered and evaluated</span></div>
        <div><small>Roles</small><b>{rolesDone.length}</b><span>done at past meetings</span></div>
        <div><small>Feedback given</small><b>{given.length}</b><span>role sheets submitted</span></div>
      </div>

      <div className="pgrid">
        <div className="pcard">
          <div className="lab" style={{ marginTop: 0 }}>Projects delivered<span className="cnt2">{projects.length}</span></div>
          {!projects.length && <p className="empty tight">No speeches yet.</p>}
          <Fold items={projects} n={5} label="projects">{(x) => (
            <Link className="prow2" key={x.id} to={`/v/evaluations/${x.id}`}>
              <span><b>{x.project}</b><small><i className="lvb">L{x.level}</i>“{x.title}” · {d(x.date)} · {x.by}</small></span>{I.chev}
            </Link>
          )}</Fold>

          <div className="lab">Roles<span className="cnt2">{roles.length}</span></div>
          {!roles.length && <p className="empty tight">No roles yet.</p>}
          <Fold items={roles} n={5} label="roles">{(r) => (
            <div className="prow2 static" key={r.id}>
              <span><b>{r.label}</b><small>Meeting {r.number} · {d(r.date)}</small></span>
              {r.upcoming ? <Status kind="up">Upcoming</Status> : FB.includes(r.role_key) ? (r.submitted_at ? <Status kind="ok">Submitted</Status> : <Status kind="late">Not submitted</Status>) : <Status kind="fin">Done</Status>}
            </div>
          )}</Fold>
        </div>

        <div className="pcard">
          <div className="lab" style={{ marginTop: 0 }}>Feedback they have given<span className="cnt2">{given.length}</span></div>
          {!given.length && <p className="empty tight">Nothing submitted yet.</p>}
          <Fold items={given} n={5} label="sheets">{(g) => (
            <button type="button" className="prow2" key={g.id} onClick={() => nav(`/v/sheets/${g.id}`)}>
              <span><b>{g.label}</b><small>Meeting {g.number} · {d(g.date)} · {g.summary}</small></span>{I.chev}
            </button>
          )}</Fold>

          <div className="lab">Feedback they have received</div>
          {!(received.gram.length || received.fill.length || received.time.length || received.roleFeedback.length || received.peer.length) && <p className="empty tight">Nothing yet. Their evaluations are under Projects delivered.</p>}
          {Object.entries(RECEIVED).map(([k, K]) => <Rec key={k} title={K.title} count={K.pick(received).length} to={`/v/members/${id}/received/${k}`} />)}
        </div>
      </div>
      {viewing && <SubmissionViewer id={viewing} list={given.map((g) => ({ id: g.id, label: g.label, person: p.name, submitted_at: g.submitted_at }))} onGo={setViewing} onClose={() => setViewing(null)} remind={() => '#'} />}
    </Page>
  );
}
