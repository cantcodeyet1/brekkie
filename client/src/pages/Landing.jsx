import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { Btn, Loading, Seg, Wordmark } from '../ui.jsx';

/* feedback drifting up the hero: sample lines only, never real members' notes */
const NOTES = [
  ['Grammarian', 'Loved “assiduous”. Used it three times, naturally.', 'G'],
  ['Evaluator', 'Your opening story pulled everyone in.', 'E'],
  ['Timer', 'Landed in the green at 6 minutes 10.', 'T'],
  ['Ah Counter', 'Down from nine ums to two. Well done.', 'A'],
  ['Topicsmaster', 'Great pause before the punchline.', 'T'],
  ['General Evaluator', 'Try a bigger gesture on your key point.', 'G'],
];

function Hero({ children }) {
  return (
    <section className="land-hero">
      <Wordmark className="wm-light" />
      {children}
      <div className="notes" aria-hidden="true">
        {NOTES.map(([who, text, ch], i) => (
          <div className="note" key={who + i} style={{ '--i': i }}>
            <i>{ch}</i><div><b>{who}</b><span>{text}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Landing({ force }) {
  const nav = useNavigate();
  const { code: urlCode } = useParams();
  const [tab, setTab] = useState(urlCode ? 'join' : 'in');
  const [checking, setChecking] = useState(true);
  const [demo, setDemo] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', code: (urlCode || '').toUpperCase() });
  const [club, setClub] = useState(null);       // the club a join code belongs to
  const [choose, setChoose] = useState(null);   // the same email and password in more than one club
  const [paste, setPaste] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr(''); };

  const finish = (s) => { setToken(s.token); nav(s.type === 'vpe' ? '/v' : '/m', { replace: true }); };
  const enterLink = async (raw) => {
    const t = raw.trim().split(/[/?#]/).filter(Boolean).pop();
    if (!t) return;
    try {
      const s = await api('/session', { token: t });
      if (s.type === 'role') { nav(`/r/${t}`); return; }
      setToken(t); nav(s.type === 'vpe' ? '/v' : '/m', { replace: true });
    } catch { setErr('That link did not work. Ask your VPE for a new one.'); }
  };

  useEffect(() => {
    (async () => {
      if (!force) { try { const s = await api('/session'); nav(s.type === 'vpe' ? '/v' : '/m', { replace: true }); return; } catch { setToken(null); } }
      try { setDemo(await api('/dev/accounts')); } catch { /* demo mode off */ }
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const c = f.code.trim();
    if (tab !== 'join' || c.length < 6) { setClub(null); return undefined; }
    let live = true;
    api(`/clubs/lookup?code=${encodeURIComponent(c)}`).then((r) => live && setClub(r.name), () => live && setClub(false));
    return () => { live = false; };
  }, [f.code, tab]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = tab === 'in'
        ? await api('/auth/signin', { method: 'POST', body: { email: f.email, password: f.password } })
        : await api('/auth/join', { method: 'POST', body: { code: f.code, name: f.name, email: f.email, password: f.password } });
      if (r.choose) setChoose(r.choose); else finish(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (checking) return <Loading />;
  const ready = tab === 'in' ? f.email.trim() && f.password : f.code.trim().length >= 6 && club && f.name.trim().length > 1 && f.email.trim() && f.password.length >= 8;
  return (
    <div className="land">
      <Hero>
        <h1>Feedback is the <span>breakfast</span> of Champions.</h1>
        <p className="sub">Role players write it. Members read it. The VPE runs the club from one calm place.</p>
      </Hero>
      <section className="land-panel">
        <div className="panel-in">
          {choose ? (
            <>
              <h2>Which club?</h2>
              <p className="lede">Your email is in more than one club.</p>
              <div className="clubs">{choose.map((c) => <button type="button" key={c.token} onClick={() => finish(c)}>{c.club}<small>{c.type === 'vpe' ? 'VPE' : 'Member'}</small></button>)}</div>
            </>
          ) : (
            <>
              <h2>{tab === 'in' ? 'Welcome back.' : 'Join your club.'}</h2>
              <Seg className="auth-tabs" value={tab} onChange={(v) => { setTab(v); setErr(''); }} options={[['in', 'Sign in'], ['join', 'Join a club']]} />
              {tab === 'join' && (
                <>
                  <label className="fl" htmlFor="l-code">Club code</label>
                  <input id="l-code" className="inp code-in" value={f.code} onChange={(e) => { setF({ ...f, code: e.target.value.toUpperCase() }); setErr(''); }} placeholder="From your VPE" autoCapitalize="characters" spellCheck="false" maxLength={12} />
                  {club && <p className="okline">{club}</p>}
                  {club === false && <p className="err">We could not find that club.</p>}
                  <label className="fl" htmlFor="l-name">Your name</label>
                  <input id="l-name" className="inp" value={f.name} onChange={set('name')} autoComplete="name" placeholder="Your full name" />
                </>
              )}
              <label className="fl" htmlFor="l-email">Email</label>
              <input id="l-email" className="inp" type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" />
              <label className="fl" htmlFor="l-pw">Password</label>
              <input id="l-pw" className="inp" type="password" value={f.password} onChange={set('password')} autoComplete={tab === 'in' ? 'current-password' : 'new-password'} placeholder={tab === 'in' ? 'Your password' : 'At least 8 characters'} onKeyDown={(e) => e.key === 'Enter' && ready && submit()} />
              {err && <p className="err">{err}</p>}
              <div style={{ marginTop: 18 }}><Btn onClick={submit} disabled={!ready || busy}>{busy ? 'One moment…' : tab === 'in' ? 'Sign in' : 'Join and sign in'}</Btn></div>
            </>
          )}

          <div className="alt">
            <Link to="/start/club" className="alt-card"><b>Starting a club?</b><span>Set it up in a few minutes</span>{`→`}</Link>
            <details className="linkbox">
              <summary>Have a personal link?</summary>
              <div className="paste">
                <input className="inp" value={paste} onChange={(e) => { setPaste(e.target.value); setErr(''); }} onKeyDown={(e) => e.key === 'Enter' && enterLink(paste)} placeholder="Paste your link" aria-label="Your sign-in link" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
                <Btn kind="ghost" onClick={() => enterLink(paste)} disabled={!paste.trim()}>Open</Btn>
              </div>
            </details>
          </div>

          {demo && (
            <div className="demo">
              <div className="lab">Demo: sign in as</div>
              <div className="demo-grid">
                {demo.people.map((p) => <button key={p.id} onClick={() => enterLink(p.token)}>{p.name}<small>{p.is_vpe ? 'VPE' : 'Member'}</small></button>)}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
