import { JoinAsk } from './Role.jsx';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { getToken, useApi } from '../api.js';
import { CARDTXT, CRIT, DEFAULT_FILLERS, LEVELN, cap, cardOf, fmtDate, longDate, mean, mmss, sum } from '../data.js';
import { EvalSheet, printEval } from '../EvalSheet.jsx';
import { SubmissionViewer } from './Vpe.jsx';
import { api } from '../api.js';
import { Btn, Chip, ErrorMsg, Foot, I, Page, SkPage, SkRows, useDesk, useToast } from '../ui.jsx';

/* The member area is three big, plainly named places: Home, Meetings, Speeches. */
export const MEMBER_NAV = [];   // no menu: Home is the only hub, every other page has a Back button

const FUNC = {
  gram: { name: 'Grammar notes', lede: 'What the Grammarian noticed in your speaking, and whether you used the word of the day.' },
  ah: { name: 'Filler words', lede: 'Ums, ahs and other filler words counted by the Ah Counter during your speeches.' },
  time: { name: 'Timing', lede: 'How long you spoke, against the green, yellow and red cards.' },
};
const thr = (r) => [r.green, r.yellow, r.red];
const ITEM_TEXT = { speech: 'Speech evaluation', grammar: 'Grammar notes', fillers: 'Filler words', timing: 'Timing', room: 'Comments from the room', role: 'Feedback on your role' };
const shortDate = (iso) => fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });

/* the member area follows the Brekkie feel: grey page, one white card, hairline rows */
function MPage({ eyebrow, title, sub, root, back, backTitle = 'Home', children }) {
  return (
    <Page root={root} title={backTitle} back={back} wide full>
      <div className="rpage mb"><div className="mb-in">
        <div className="rhead"><div><p className="reyebrow">{eyebrow}</p><h1 className="rtitle">{title}</h1>{sub && <p className="rsub">{sub}</p>}</div></div>
        {children}
      </div></div>
    </Page>
  );
}
const MSk = ({ back, backTitle = 'Home', root, rows = 5, stats = 0 }) => (
  <Page root={root} title={backTitle} back={back} wide full>
    <div className="mb"><div className="mb-in"><SkPage plain rows={rows} stats={stats} pill={false} /></div></div>
  </Page>
);
function Tile({ to, title, sub, n, onClick }) {
  const body = (<><span className="tt"><b>{title}</b>{sub && <span>{sub}</span>}</span>{n !== undefined && <span className="bn">{n}</span>}<span className="tc">{I.chev}</span></>);
  return to ? <Link className="mb-row" to={to}>{body}</Link> : <button type="button" className="mb-row" onClick={onClick}>{body}</button>;
}
const Sect = ({ title, hint, children }) => <section className="mb-sec"><div className="mb-lab">{title}</div>{hint && <p className="mb-hint">{hint}</p>}{children}</section>;

/* ───────── Home ───────── */
/* the card for a meeting: one tap downloads its agenda. A role's card can also carry a link to the script and sheet. */
function AgendaCard({ meetingId, date, title, sub, sheet }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const dt = new Date(date + 'T12:00:00');
  const get = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/me/meetings/${meetingId}/agenda.docx`, { headers: { 'x-token': getToken() } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not get the agenda');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'Agenda.docx';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Agenda downloaded');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mb-card mr-next">
      <span className="calbox"><small>{dt.toLocaleDateString('en-GB', { month: 'short' })}</small><b>{dt.getDate()}</b></span>
      <span className="tt"><b>{title}</b><span>{sub}</span></span>
      <span className="mh-acts">
        <button type="button" className="mh-go" onClick={get} disabled={busy}>{I.dl} {busy ? 'Getting it…' : 'Download the agenda'}</button>
        {sheet && <Link className="mr-sheet" to={sheet}>Open your role sheet</Link>}
      </span>
    </div>
  );
}

export function MemberHome() {
  const { data: d, error, loading } = useApi('/me/overview');
  if (loading) return <MSk root rows={5} />;
  if (error) return <Page root wide full><div className="rpage mb"><div className="mb-in"><ErrorMsg error={error} /></div></div></Page>;
  const first = d.person.name.split(' ')[0];
  const guest = d.person.kind === 'guest';
  const fb = [
    { to: '/m/speeches', icon: I.mic, n: d.evals.count, title: 'My speeches', sub: 'What my evaluators said about each speech' },
    { to: '/m/meetings', icon: I.month, n: d.meetings, title: 'Meeting by meeting', sub: 'Everything from one evening, in one place' },
    { to: '/m/role/gram', icon: I.doc, n: d.gram.count, title: 'Grammar notes', sub: 'From the Grammarian' },
    { to: '/m/role/ah', icon: I.hash, n: d.ah.count, title: 'Ums and ahs', sub: 'Filler words counted for me' },
    { to: '/m/role/time', icon: I.clock, n: d.time.count, title: 'My timing', sub: 'How long I spoke, green to red' },
    ...(d.given > 0 ? [{ to: '/m/given', icon: I.send, n: d.given, title: 'Notes I wrote', sub: 'My role sheets for other people' }] : []),
  ];
  return (
    <MPage root eyebrow="Champions Toastmasters" title={`Hi ${first}`} sub="Your feedback from the club, all in one place.">
      <div className="mb-stack">
        {d.upcoming.map((u) => {
          const act = !['toastmaster', 'speaker'].includes(u.role_key);
          return <AgendaCard key={u.token} meetingId={u.meeting_id} date={u.date}
            title={`You are ${/\d$/.test(u.label) ? '' : /^[AEIOU]/.test(u.label) ? 'an ' : 'a '}${u.label}`}
            sub={`${fmtDate(u.date, { weekday: 'long', day: 'numeric', month: 'long' })}, meeting ${u.number}`}
            sheet={act ? `/r/${u.token}` : null} />;
        })}

        <div className="mb-card">
          <div className="mr-lab">Your feedback</div>
          {fb.map((t) => (
            <Link key={t.to} to={t.to} className="mr-row"><span className="mr-h"><span className="mr-ic">{t.icon}</span><span className="mr-t"><b>{t.title}</b><span>{t.sub}</span></span><span className="mr-r"><em className="mr-n">{t.n}</em></span><span className="mr-go">{I.chev}</span></span></Link>
          ))}
        </div>

        {!d.upcoming.length && d.next_meeting && (
          <p className="mr-foot">Our next meeting is {fmtDate(d.next_meeting.date, { weekday: 'long', day: 'numeric', month: 'long' })}. You do not have a role yet.</p>
        )}
        {guest && <div className="mb-card"><div className="mb-sec"><JoinAsk data={{ me: d.person }} endpoint="/me/join-request" /></div></div>}
      </div>
    </MPage>
  );
}

/* ───────── what you wrote for other people ───────── */
export function Given() {
  const { data, error, loading } = useApi('/me/given');
  const [open, setOpen] = useState(null);
  if (loading) return <MSk back="/m" />;
  if (error) return <MPage eyebrow="Feedback" title="Given" back="/m"><ErrorMsg error={error} /></MPage>;
  return (
    <MPage eyebrow="Feedback" title="Feedback you have given" sub="The notes you wrote when you had a role. Tap one to read it again." back="/m">
      <div className="mb-card">
        {!data.length && <p className="mb-empty">Nothing yet. When you submit a role sheet, it appears here.</p>}
        {data.map((g) => (
          <button type="button" key={g.id} className="mb-row" onClick={() => setOpen(g.id)}>
            <span className="tt"><b>{g.label}</b><span>{shortDate(g.date)} · Meeting {g.number}</span><span>{g.summary}</span></span>
            <span className="tc">{I.chev}</span>
          </button>
        ))}
      </div>
      {open && <SubmissionViewer mine id={open} list={data.map((g) => ({ id: g.id, label: g.label, submitted_at: g.submitted_at }))} onGo={setOpen} onClose={() => setOpen(null)} remind={() => '#'} />}
    </MPage>
  );
}

/* ───────── Meetings ───────── */
export function Meetings() {
  const { data, error, loading } = useApi('/me/meetings');
  if (loading) return <MSk back="/m" />;
  if (error) return <MPage eyebrow="Feedback" title="By meeting" back="/m"><ErrorMsg error={error} /></MPage>;
  return (
    <MPage eyebrow="Feedback" title="Feedback by meeting" sub="Pick an evening to see everything people said about you that night." back="/m">
      <div className="mb-card">
        {!data.length && <p className="mb-empty">Nothing yet. After your first meeting, it appears here.</p>}
        {data.map((m) => (
          <Link key={m.id} className="mb-row" to={`/m/meetings/${m.number}`}>
            <span className="ev-d"><small>{fmtDate(m.date, { month: 'short' })}</small><b>{fmtDate(m.date, { day: 'numeric' })}</b></span>
            <span className="tt"><b>{shortDate(m.date)}</b><span>Meeting {m.number}{m.theme ? ` · ${m.theme}` : ''}</span>
              <span className="chips">{m.roles.map((r) => <Chip key={r} kind="on">{r}</Chip>)}{m.items.filter((i) => i !== 'role').map((i) => <Chip key={i}>{ITEM_TEXT[i]}</Chip>)}</span></span>
            <span className="tc">{I.chev}</span>
          </Link>
        ))}
      </div>
    </MPage>
  );
}

const Quote = ({ well, improve, by }) => (
  <div className="say">
    {by !== undefined && <div className="who">{by || 'Someone in the room'}</div>}
    {well && <div className="note g"><i>Went well</i>{well}</div>}
    {improve && <div className="note m" style={{ marginTop: 8 }}><i>To try next time</i>{improve}</div>}
  </div>
);

export function MeetingDetail() {
  const { number } = useParams();
  const { data: d, error, loading } = useApi(`/me/meetings/${number}`);
  if (loading) return <MSk back="/m/meetings" backTitle="Feedback by meeting" rows={4} />;
  if (error) return <MPage eyebrow="Meeting" title="Feedback" back="/m/meetings" backTitle="Feedback by meeting"><ErrorMsg error={error} /></MPage>;
  const sp = d.speech, avg = sp ? mean(sp.ratings.filter(Boolean)) : 0;
  const nothing = !sp && !d.gram.length && !d.ah.length && !d.time.length && !d.peer.length && !d.roleFeedback.length;
  return (
    <MPage eyebrow={`Meeting ${d.meeting.number ?? number}`} title={shortDate(d.meeting.date)} back="/m/meetings" backTitle="Feedback by meeting"
      sub={`${d.meeting.theme ? `Theme: ${d.meeting.theme}. ` : ''}${d.roles.length ? `You were ${d.roles.map((r) => r.label).join(' and ')}.` : 'You were in the audience.'}`}>
      <div className="mb-card">
      {nothing && <p className="mb-empty">No notes about you from this meeting yet.</p>}

      {sp && (
        <Sect title="Your speech" hint="What your evaluator said about it.">
          <div className="card">
            <div className="ent-h"><b style={{ fontSize: 17 }}>{sp.project}</b><span>{sp.seconds != null && mmss(sp.seconds)}</span></div>
            <div className="by">“{sp.title}” · evaluated by <b>{sp.by}</b></div>
            <div className="score"><b>{avg.toFixed(1)}</b><span>out of 5</span></div>
            <div className="note g"><i>You did well at</i>{sp.excelled}</div>
            <div className="note m" style={{ marginTop: 10 }}><i>To work on</i>{sp.work}</div>
            <div className="note" style={{ marginTop: 10 }}><i>Challenge yourself</i>{sp.challenge}</div>
            <div className="btnrow"><Link className="btn ghost sm" style={{ textDecoration: 'none' }} to={`/m/speeches/${sp.id}`}>See the full evaluation</Link><Btn sm onClick={async () => printEval(await fetch(`/api/me/evaluations/${sp.id}`, { headers: { 'x-token': localStorage.getItem('brekkie_token') } }).then((r) => r.json()))}>{I.dl} Download PDF</Btn></div>
          </div>
        </Sect>
      )}

      {d.peer.length > 0 && (
        <Sect title="What the room said" hint="Written by people who were at the meeting.">
          {d.peer.map((p, i) => <Quote key={i} well={p.well} improve={p.improve} by={p.from_name} />)}
        </Sect>
      )}

      {d.roleFeedback.length > 0 && (
        <Sect title="How you did in your role" hint="From the General Evaluator.">
          {d.roleFeedback.map((r, i) => <Quote key={i} well={r.well} improve={r.improve} by={`${r.role}, from ${r.by || 'the General Evaluator'}`} />)}
        </Sect>
      )}

      {d.gram.length > 0 && (
        <Sect title="Grammar notes" hint="From the Grammarian.">
          {d.gram.map((g, i) => (
            <div className="say" key={i}>
              <div className="who">{g.by}</div>
              <Chip kind={g.used_word ? 'ok' : ''}>{g.used_word && I.check}Word “{g.word}” {g.used_word ? (g.word_uses > 1 ? `used ${g.word_uses} times` : 'used') : 'not used'}</Chip>
              {g.liked && <div className="note g" style={{ marginTop: 8 }}><i>Liked</i>{g.liked}</div>}
              {(g.improper || g.suggestion) && <div className="note m" style={{ marginTop: 8 }}><i>To polish</i>{g.improper}{g.improper && g.suggestion ? ' → ' : ''}{g.suggestion}</div>}
            </div>))}
        </Sect>
      )}

      {d.ah.length > 0 && (
        <Sect title="Filler words" hint="Counted by the Ah Counter. Fewer is better.">
          {d.ah.map((a, i) => (
            <div className="say" key={i}>
              <div className="who">{a.by}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <div className="cnts" style={{ flex: 1 }}>{[...DEFAULT_FILLERS.map((x) => x[0]), ...Object.keys(a.counts).filter((k) => !DEFAULT_FILLERS.some((x) => x[0] === k))].filter((k) => a.counts[k]).map((k) => <div className="cnt" key={k}><small>{cap(k)}</small><b>{a.counts[k]}</b></div>)}</div>
                <div style={{ textAlign: 'right' }}><span className="total">TOTAL</span><div className="big">{sum(a.counts)}</div></div>
              </div>
              {a.comment && <div className="note" style={{ marginTop: 8 }}><i>Comment</i>{a.comment}</div>}
            </div>))}
        </Sect>
      )}

      {d.time.length > 0 && (
        <Sect title="Timing" hint="Green is good. Yellow means wrap up soon. Red means time is up.">
          {d.time.map((t, i) => { const c = cardOf(t.seconds, thr(t)); return (
            <div className="say" key={i}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="big">{mmss(t.seconds)}</div>
                <div style={{ textAlign: 'right', fontSize: 14 }}><span className={'dot ' + c} /> <b>{CARDTXT[c]}</b><br /><span style={{ color: 'var(--mute)' }}>Aim for {mmss(t.green)} to {mmss(t.red)}</span></div>
              </div>
              {t.comment && <div className="note" style={{ marginTop: 8 }}><i>Comment from {t.by}</i>{t.comment}</div>}
            </div>); })}
        </Sect>
      )}
      </div>
    </MPage>
  );
}

/* ───────── Speeches (evaluations), grouped by Pathways path and level ───────── */
export function Evaluations() {
  const { data, error, loading } = useApi('/me/evaluations');
  if (loading) return <MSk back="/m" />;
  if (error) return <MPage eyebrow="Feedback" title="Speeches" back="/m"><ErrorMsg error={error} /></MPage>;
  const paths = {};
  data.forEach((e) => { ((paths[e.path || 'Other'] ??= {})[e.level] ??= []).push(e); });
  return (
    <MPage eyebrow="Feedback" title="Speech feedback" sub="What your evaluators said about each speech, grouped by path and level. Open one to read it or download it as a PDF." back="/m">
      <div className="mb-card">
      {!data.length && <p className="mb-empty">No speeches yet. Your first one will appear here.</p>}
      {Object.entries(paths).map(([path, levels]) => (
        <section key={path} className="mb-path">
          <div className="mb-ph"><small>Path</small><b>{path}</b><span>{Object.values(levels).flat().length} {Object.values(levels).flat().length === 1 ? 'speech' : 'speeches'} so far</span></div>
          {Object.keys(levels).sort((a, b) => a - b).map((lv) => (
            <div key={lv}>
              <div className="mb-lvl"><span>Level {lv}</span><em>{levels[lv].length} {levels[lv].length === 1 ? 'speech' : 'speeches'}</em></div>
              <div>
                {levels[lv].map((e) => (
                  <Link key={e.id} className="mb-row" to={`/m/speeches/${e.id}`}>
                    <span className="ev-d"><small>{fmtDate(e.date, { month: 'short' })}</small><b>{fmtDate(e.date, { day: 'numeric' })}</b></span>
                    <span className="tt"><b>{e.project}</b><span className="ev-ti">“{e.title}”</span><span>Evaluated by {e.by} · {fmtDate(e.date, { year: 'numeric' })}</span></span>
                    {(() => { const m = mean(e.ratings.filter(Boolean)); return <span className={'bn scr ' + (m >= 4 ? 'hi' : m >= 3 ? 'mid' : 'lo')} title="Average out of 5">{m.toFixed(1)}</span>; })()}<span className="tc">{I.chev}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
      </div>
    </MPage>
  );
}

/* fillers per speech as bars, oldest to newest; the latest one is highlighted */
function FillerChart({ pts }) {
  const max = Math.max(...pts.map((x) => x.n), 1);
  const avg = Math.round((pts.reduce((a, x) => a + x.n, 0) / pts.length) * 10) / 10;
  const last = pts[pts.length - 1].n, prev = pts[pts.length - 2].n;
  const trend = last < prev ? 'Down from last time' : last > prev ? 'Up from last time' : 'Same as last time';
  return (
    <div className="mb-trend fc">
      <small>Fillers per speech</small>
      <div className="fc-top"><b>{last}</b><span>latest · {trend.toLowerCase()}</span><span className="fc-avg">Average {avg}</span></div>
      <div className="fc-bars" role="img" aria-label={`Fillers per speech, oldest to newest: ${pts.map((x) => x.n).join(', ')}`}>
        {pts.map((x, i) => (
          <div key={i} className={'fc-c' + (i === pts.length - 1 ? ' now' : '')} title={`${fmtDate(x.date, { day: 'numeric', month: 'short' })}: ${x.n}`}>
            <em>{x.n}</em><i style={{ height: `${Math.max(6, (x.n / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="fc-ax"><span>{fmtDate(pts[0].date, { day: 'numeric', month: 'short' })}</span><span>{fmtDate(pts[pts.length - 1].date, { day: 'numeric', month: 'short' })}</span></div>
    </div>
  );
}

/* ───────── look back at one kind of note ───────── */
export function FuncHistory() {
  const { key } = useParams();
  const F = FUNC[key];
  const { data, error, loading } = useApi(`/me/history/${key}`);
  if (!F) return <MPage eyebrow="Feedback" title="Not found" back="/m"><ErrorMsg error={{ message: 'Not found' }} /></MPage>;
  if (loading) return <MSk back="/m" />;
  if (error) return <MPage eyebrow="Feedback" title={F.name} back="/m"><ErrorMsg error={error} /></MPage>;
  const pts = key === 'ah' && data.length > 1 ? [...data].reverse().map((r) => ({ n: sum(r.counts), date: r.date })) : null;
  return (
    <MPage eyebrow="Feedback" title={F.name} sub={F.lede} back="/m">
      <div className="mb-card">
      {pts && <FillerChart pts={pts} />}
      {!data.length && <p className="mb-empty">Nothing here yet.</p>}
      <div className="mb-list">
        {data.map((r, i) => (
          <div className="say" key={i}>
            <div className="ent-h"><b>{longDate(r.date)}</b><Link className="lnk" to={`/m/meetings/${r.number}`}>Meeting {r.number}</Link></div>
            <div className="who">From {r.by}</div>
            {key === 'gram' && <>
              <Chip kind={r.used_word ? 'ok' : ''}>{r.used_word && I.check}Word “{r.word}” {r.used_word ? (r.word_uses > 1 ? `used ${r.word_uses} times` : 'used') : 'not used'}</Chip>
              {r.liked && <div className="note g" style={{ marginTop: 8 }}><i>Done well</i>{r.liked}</div>}
              {(r.improper || r.suggestion) && <div className="note m" style={{ marginTop: 8 }}><i>To polish</i>{r.improper}{r.improper && r.suggestion ? ' → ' : ''}{r.suggestion}</div>}
            </>}
            {key === 'ah' && <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <div className="cnts" style={{ flex: 1 }}>{[...DEFAULT_FILLERS.map((x) => x[0]), ...Object.keys(r.counts).filter((k) => !DEFAULT_FILLERS.some((x) => x[0] === k))].filter((k) => r.counts[k]).map((k) => <div className="cnt" key={k}><small>{cap(k)}</small><b>{r.counts[k]}</b></div>)}</div>
                <div style={{ textAlign: 'right' }}><span className="total">TOTAL</span><div className="big">{sum(r.counts)}</div></div>
              </div>
              {r.comment && <div className="note" style={{ marginTop: 8 }}><i>Comment</i>{r.comment}</div>}
            </>}
            {key === 'time' && (() => { const c = cardOf(r.seconds, thr(r)); return <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="big">{mmss(r.seconds)}</div>
                <div style={{ textAlign: 'right', fontSize: 14 }}><span className={'dot ' + c} /> <b>{CARDTXT[c]}</b><br /><span style={{ color: 'var(--mute)' }}>Aim for {mmss(r.green)} to {mmss(r.red)}</span></div>
              </div>
              {r.comment && <div className="note" style={{ marginTop: 8 }}><i>Comment</i>{r.comment}</div>}
            </>; })()}
          </div>
        ))}
      </div>
      </div>
    </MPage>
  );
}

/* ───────── everything the room wrote ───────── */
export function Room() {
  const { data, error, loading } = useApi('/me/room');
  if (loading) return <MSk back="/m" />;
  if (error) return <MPage eyebrow="Feedback" title="From the audience" back="/m"><ErrorMsg error={error} /></MPage>;
  return (
    <MPage eyebrow="Feedback" title="From the audience" sub="Written by people who were at your meetings." back="/m">
      <div className="mb-card">
        {!data.length && <p className="mb-empty">Nothing yet. After a meeting, anyone can scan the QR code and write to you.</p>}
        <div className="mb-list">{data.map((p) => <div key={p.id}><div className="when">{longDate(p.date)} · Meeting {p.number}</div><Quote well={p.well} improve={p.improve} by={p.from_name} /></div>)}</div>
      </div>
    </MPage>
  );
}

/* ───────── one full evaluation ───────── */
const ratingList = (e) => (
  <div className="list">
    {CRIT.map(([n], i) => { const v = e.ratings[i] || 0, cl = v >= 4 ? 'hi' : v === 3 ? 'mid' : 'lo'; return (
      <div className="rrow" key={n}>
        <div className="rh"><b>{n}</b><span className="scale">{[1, 2, 3, 4, 5].map((k) => <u key={k} className={k <= v ? cl : ''} />)}</span><span className="v">{v ? `${v} · ${LEVELN[v]}` : 'Not rated'}</span></div>
        {e.comments?.[i] && <p>{e.comments[i]}</p>}
      </div>); })}
  </div>
);

export function EvaluationDetail({ vpe }) {
  const { id } = useParams();
  const desk = useDesk();
  const { data: e, error, loading } = useApi(vpe ? `/vpe/evaluations/${id}` : `/me/evaluations/${id}`);
  const back = vpe ? undefined : '/m/speeches';
  if (loading) return <Page title={vpe ? 'Evaluation' : 'Speech feedback'} back={back}><SkPage plain rows={6} pill={false} /></Page>;
  if (error) return <Page title={vpe ? 'Evaluation' : 'Speech feedback'} back={back}><ErrorMsg error={error} /></Page>;
  const left = (
    <>
      <h1 className="pg sm">{e.form_title}</h1>
      <div className="meta"><span>Level {e.level} · {e.path}</span></div>
      <div className="meta"><span>“<b>{e.title}</b>”</span><span>{longDate(e.date)}</span>{e.seconds != null && <span>Time <b>{mmss(e.seconds)}</b> of {e.length_text.replace(' minutes', ' min')}</span>}</div>
      <div className="meta"><span>Evaluator <b>{e.by}</b></span></div>
      <div className="lab">Ratings</div>{ratingList(e)}
      <div className="lab blue">You excelled at</div><p className="note g" style={{ margin: 0 }}>{e.excelled || 'Nothing recorded'}</p>
      <div className="lab maroon">You may want to work on</div><p className="note m" style={{ margin: 0 }}>{e.work || 'Nothing recorded'}</p>
      <div className="lab">To challenge yourself</div><p className="note" style={{ margin: 0 }}>{e.challenge || 'Nothing recorded'}</p>
    </>
  );
  return (
    <Page title={vpe ? 'Evaluation' : 'Speech feedback'} wide={desk} back={back} foot={<Foot col><Btn onClick={() => printEval(e)}>{I.dl} Download evaluation sheet (PDF)</Btn></Foot>}>
      {desk
        ? <div className="split wide"><div>{left}</div><div className="ref"><div className="pdfwrap"><div style={{ zoom: 0.55 }}><EvalSheet e={e} /></div></div></div></div>
        : left}
    </Page>
  );
}
