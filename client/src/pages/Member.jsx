import { JoinAsk } from './Role.jsx';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useApi } from '../api.js';
import { CARDTXT, CRIT, DEFAULT_FILLERS, LEVELN, cap, cardOf, fmtDate, longDate, mean, mmss, sum } from '../data.js';
import { EvalSheet, printEval } from '../EvalSheet.jsx';
import { SubmissionViewer } from './Vpe.jsx';
import { Btn, Chip, ErrorMsg, Foot, I, Loading, Page, useDesk } from '../ui.jsx';

/* The member area is three big, plainly named places: Home, Meetings, Speeches. */
export const MEMBER_NAV = [];

const FUNC = {
  gram: { name: 'Grammar notes', lede: 'What the Grammarian noticed in your speaking, and whether you used the word of the day.' },
  ah: { name: 'Filler words', lede: 'Ums, ahs and other filler words counted by the Ah Counter during your speeches.' },
  time: { name: 'Timing', lede: 'How long you spoke, against the green, yellow and red cards.' },
};
const thr = (r) => [r.green, r.yellow, r.red];
const ITEM_TEXT = { speech: 'Speech evaluation', grammar: 'Grammar notes', fillers: 'Filler words', timing: 'Timing', room: 'Comments from the room', role: 'Feedback on your role' };
const shortDate = (iso) => fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });

function Tile({ to, title, sub, n, tone = '', icon }) {
  return (
    <Link className={'tile ' + tone} to={to}>
      {icon && <span className="ti">{icon}</span>}
      <span className="tt"><b>{title}</b>{sub && <span>{sub}</span>}</span>
      {n !== undefined && <span className="bn">{n}</span>}
      <span className="tc">{I.chev}</span>
    </Link>
  );
}
const Sect = ({ title, hint, children }) => <section className="sect"><h2>{title}</h2>{hint && <p className="hint">{hint}</p>}{children}</section>;

/* ───────── Home ───────── */
export function MemberHome() {
  const { data: d, error, loading } = useApi('/me/overview');
  if (loading) return <Page root narrow><Loading /></Page>;
  if (error) return <Page root narrow><ErrorMsg error={error} /></Page>;
  const first = d.person.name.split(' ')[0];
  const day = (iso) => new Date(iso + 'T12:00:00');
  return (
    <Page root narrow>
      <h1 className="hello">Hi {first}</h1>
      {d.person.kind === 'guest' && <div style={{ margin: '4px 0 18px' }}><JoinAsk data={{ me: d.person }} endpoint="/me/join-request" /></div>}

      {d.upcoming.map((u) => {
        const dt = day(u.date), act = !['toastmaster', 'speaker'].includes(u.role_key);
        const body = (
          <>
            <span className="calbox"><small>{dt.toLocaleDateString('en-GB', { month: 'short' })}</small><b>{dt.getDate()}</b></span>
            <span className="tt"><b>You are {/\d$/.test(u.label) ? '' : /^[AEIOU]/.test(u.label) ? 'an ' : 'a '}{u.label}</b><span>{fmtDate(u.date, { weekday: 'long' })}, meeting {u.number}{act ? '. Tap for your script and sheet.' : '.'}</span></span>
            {act && <span className="tc">{I.chev}</span>}
          </>
        );
        return act ? <Link key={u.token} className="notice" to={`/r/${u.token}`}>{body}</Link> : <div key={u.token} className="notice">{body}</div>;
      })}

      <p className="lede" style={{ fontSize: 17, marginTop: 0 }}>Tap one to see the feedback people have given you.</p>

      <Sect title="By speech or by meeting">
        <div className="tiles two">
          <Tile tone="hero" to="/m/speeches" title="Speech feedback" sub="What your evaluators said about each speech you gave" n={d.evals.count} />
          <Tile tone="hero" to="/m/meetings" title="Feedback by meeting" sub="Everything from one evening, all in one place" n={d.meetings} />
        </div>
      </Sect>

      <Sect title="Or by who gave it">
        <div className="tiles three">
          <Tile to="/m/role/gram" title="Grammar notes" sub="From the Grammarian" n={d.gram.count} />
          <Tile to="/m/role/ah" title="Filler words" sub="From the Ah Counter" n={d.ah.count} />
          <Tile to="/m/role/time" title="Timing" sub="From the Timer" n={d.time.count} />
        </div>
      </Sect>

      {d.given > 0 && (
        <Sect title="Feedback you have given">
          <div className="tiles"><Tile to="/m/given" title="Your role sheets" sub="The notes you wrote as Grammarian, Evaluator and more" n={d.given} /></div>
        </Sect>
      )}
    </Page>
  );
}

/* ───────── what you wrote for other people ───────── */
export function Given() {
  const { data, error, loading } = useApi('/me/given');
  const [open, setOpen] = useState(null);
  if (loading) return <Page title="Home" narrow back="/m"><Loading /></Page>;
  if (error) return <Page title="Home" narrow back="/m"><ErrorMsg error={error} /></Page>;
  return (
    <Page title="Home" narrow back="/m">
      <h1 className="hello" style={{ fontSize: 30 }}>Feedback you have given</h1>
      <p className="lede">The notes you wrote when you had a role. Tap one to read it again.</p>
      {!data.length && <p className="lede">Nothing yet. When you submit a role sheet, it appears here.</p>}
      <div className="tiles">
        {data.map((g) => (
          <button type="button" key={g.id} className="tile col" style={{ textAlign: 'left', width: '100%' }} onClick={() => setOpen(g.id)}>
            <span className="tt"><b>{g.label}</b><span>{shortDate(g.date)} · Meeting {g.number}</span><span>{g.summary}</span></span>
            <span className="tc">{I.chev}</span>
          </button>
        ))}
      </div>
      {open && <SubmissionViewer mine id={open} list={data.map((g) => ({ id: g.id, label: g.label, submitted_at: g.submitted_at }))} onGo={setOpen} onClose={() => setOpen(null)} remind={() => '#'} />}
    </Page>
  );
}

/* ───────── Meetings ───────── */
export function Meetings() {
  const { data, error, loading } = useApi('/me/meetings');
  if (loading) return <Page title="Home" narrow back="/m"><Loading /></Page>;
  if (error) return <Page title="Home" narrow back="/m"><ErrorMsg error={error} /></Page>;
  return (
    <Page title="Home" narrow back="/m">
      <h1 className="hello" style={{ fontSize: 30 }}>Feedback by meeting</h1>
      <p className="lede">Pick an evening to see everything people said about you that night.</p>
      {!data.length && <p className="lede">Nothing yet. After your first meeting, it appears here.</p>}
      <div className="tiles">
        {data.map((m) => (
          <Link key={m.id} className="tile col" to={`/m/meetings/${m.number}`}>
            <span className="tt"><b>{shortDate(m.date)}</b><span>Meeting {m.number}{m.theme ? ` · ${m.theme}` : ''}</span>
              <span className="chips">{m.roles.map((r) => <Chip key={r} kind="on">{r}</Chip>)}{m.items.filter((i) => i !== 'role').map((i) => <Chip key={i}>{ITEM_TEXT[i]}</Chip>)}</span></span>
            <span className="tc">{I.chev}</span>
          </Link>
        ))}
      </div>
    </Page>
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
  if (loading) return <Page title="Feedback by meeting" narrow back="/m/meetings"><Loading /></Page>;
  if (error) return <Page title="Feedback by meeting" narrow back="/m/meetings"><ErrorMsg error={error} /></Page>;
  const sp = d.speech, avg = sp ? mean(sp.ratings.filter(Boolean)) : 0;
  const nothing = !sp && !d.gram.length && !d.ah.length && !d.time.length && !d.peer.length && !d.roleFeedback.length;
  return (
    <Page title="Feedback by meeting" narrow back="/m/meetings">
      <h1 className="hello" style={{ fontSize: 30 }}>{shortDate(d.meeting.date)}</h1>
      <p className="lede">{d.meeting.theme ? `Theme: ${d.meeting.theme}. ` : ''}{d.roles.length ? `You were ${d.roles.map((r) => r.label).join(' and ')}.` : 'You were in the audience.'}</p>
      {nothing && <p className="lede">No notes about you from this meeting yet.</p>}

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
              <Chip kind={g.used_word ? 'ok' : ''}>{g.used_word && I.check}Word “{g.word}” {g.used_word ? 'used' : 'not used'}</Chip>
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
    </Page>
  );
}

/* ───────── Speeches (evaluations), grouped by Pathways path and level ───────── */
export function Evaluations() {
  const { data, error, loading } = useApi('/me/evaluations');
  if (loading) return <Page title="Home" narrow back="/m"><Loading /></Page>;
  if (error) return <Page title="Home" narrow back="/m"><ErrorMsg error={error} /></Page>;
  const paths = {};
  data.forEach((e) => { ((paths[e.path || 'Other'] ??= {})[e.level] ??= []).push(e); });
  return (
    <Page title="Home" narrow back="/m">
      <h1 className="hello" style={{ fontSize: 30 }}>Speech feedback</h1>
      <p className="lede">What your evaluators said about each speech, grouped by path and level. Open one to read it or download it as a PDF.</p>
      {!data.length && <p className="lede">No speeches yet. Your first one will appear here.</p>}
      {Object.entries(paths).map(([path, levels]) => (
        <Sect key={path} title={path} hint={`${Object.values(levels).flat().length} ${Object.values(levels).flat().length === 1 ? 'speech' : 'speeches'} so far`}>
          {Object.keys(levels).sort((a, b) => a - b).map((lv) => (
            <div key={lv}>
              <div className="lvl">Level {lv}</div>
              <div className="tiles">
                {levels[lv].map((e) => (
                  <Link key={e.id} className="tile col" to={`/m/speeches/${e.id}`}>
                    <span className="tt"><b>{e.project}</b><span>“{e.title}” · {longDate(e.date)}</span><span>Evaluated by {e.by}</span></span>
                    <span className="bn" title="Average out of 5">{mean(e.ratings.filter(Boolean)).toFixed(1)}</span><span className="tc">{I.chev}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </Sect>
      ))}
    </Page>
  );
}

/* ───────── look back at one kind of note ───────── */
export function FuncHistory() {
  const { key } = useParams();
  const F = FUNC[key];
  const { data, error, loading } = useApi(`/me/history/${key}`);
  if (!F) return <Page title="Home" narrow back="/m"><ErrorMsg error={{ message: 'Not found' }} /></Page>;
  if (loading) return <Page title="Home" narrow back="/m"><Loading /></Page>;
  if (error) return <Page title="Home" narrow back="/m"><ErrorMsg error={error} /></Page>;
  const trend = key === 'ah' && data.length > 1 && [...data].reverse().map((r) => sum(r.counts)).join(' → ');
  return (
    <Page title="Home" narrow back="/m">
      <h1 className="hello" style={{ fontSize: 30 }}>{F.name}</h1><p className="lede">{F.lede}</p>
      {trend && <div className="focus plain" style={{ marginTop: 0 }}><small>Fillers per speech, oldest to newest</small><h2 style={{ fontSize: 24 }}>{trend}</h2></div>}
      {!data.length && <p className="lede">Nothing here yet.</p>}
      <div className="tiles">
        {data.map((r, i) => (
          <div className="say" key={i}>
            <div className="ent-h"><b>{longDate(r.date)}</b><Link className="lnk" to={`/m/meetings/${r.number}`}>Meeting {r.number}</Link></div>
            <div className="who">From {r.by}</div>
            {key === 'gram' && <>
              <Chip kind={r.used_word ? 'ok' : ''}>{r.used_word && I.check}Word “{r.word}” {r.used_word ? 'used' : 'not used'}</Chip>
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
    </Page>
  );
}

/* ───────── everything the room wrote ───────── */
export function Room() {
  const { data, error, loading } = useApi('/me/room');
  if (loading) return <Page title="Home" narrow back="/m"><Loading /></Page>;
  if (error) return <Page title="Home" narrow back="/m"><ErrorMsg error={error} /></Page>;
  return (
    <Page title="Home" narrow back="/m">
      <h1 className="hello" style={{ fontSize: 30 }}>From the audience</h1>
      <p className="lede">Written by people who were at your meetings.</p>
      {!data.length && <p className="lede">Nothing yet. After a meeting, anyone can scan the QR code and write to you.</p>}
      <div className="tiles">{data.map((p) => <div key={p.id}><div className="when">{longDate(p.date)} · Meeting {p.number}</div><Quote well={p.well} improve={p.improve} by={p.from_name} /></div>)}</div>
    </Page>
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
  if (loading) return <Page title={vpe ? 'Evaluation' : 'Speech feedback'} back={back}><Loading /></Page>;
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
