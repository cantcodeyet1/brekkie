import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { Btn, Loading, Seg, Wordmark } from '../ui.jsx';
import { HeroText } from './AuthFrame.jsx';
import { VPE_WHATSAPP } from './Role.jsx';

export const PW_MIN = 6;
export const pwGood = (pw, again) => pw.length >= PW_MIN && pw === again;

/* a new password, typed twice, with a live check */
export function PwPair({ id, value, again, onChange, onAgain, onEnter, autoFocus }) {
  const long = value.length >= PW_MIN, same = !!again && value === again;
  return (
    <>
      <label className="fl" htmlFor={id}>Password</label>
      <PwInput id={id} value={value} onChange={onChange} autoComplete="new-password" placeholder={`At least ${PW_MIN} characters`} />
      <label className="fl" htmlFor={id + '2'}>Confirm password</label>
      <PwInput id={id + '2'} value={again} onChange={onAgain} autoComplete="new-password" placeholder="Type it again" onKeyDown={(e) => e.key === 'Enter' && onEnter && onEnter()} />
      {(value || again) && (
        <ul className="pwcheck">
          <li className={long ? 'ok' : ''}><i>{long ? '✓' : ''}</i>At least {PW_MIN} characters</li>
          <li className={same ? 'ok' : again ? 'bad' : ''}><i>{same ? '✓' : again ? '!' : ''}</i>{again && !same ? 'Passwords do not match' : 'Passwords match'}</li>
        </ul>
      )}
    </>
  );
}

/* a password box with a show and hide switch */
export function PwInput({ id, value, onChange, onKeyDown, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pwbox">
      <input id={id} className="inp" type={show ? 'text' : 'password'} value={value} onChange={onChange} onKeyDown={onKeyDown} autoComplete={autoComplete} placeholder={placeholder} />
      <button type="button" className="pwtog" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
        {show
          ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-2.6 3.3M6.6 7.6A14.5 14.5 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.3 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" /><circle cx="12" cy="12" r="3" /></svg>}
      </button>
    </div>
  );
}

/* feedback drifting up the hero: sample lines only, never real members' notes */
const NOTES = [
  ['Grammarian', 'Loved “assiduous”. Used it three times, naturally.', 'G'],
  ['Evaluator', 'Your opening story pulled everyone in.', 'E'],
  ['Timer', 'Landed in the green at 6 minutes 10.', 'T'],
  ['Ah Counter', 'Down from nine ums to two. Well done.', 'A'],
  ['Topicsmaster', 'Great pause before the punchline.', 'T'],
  ['General Evaluator', 'Try a bigger gesture on your key point.', 'G'],
];

export function Hero({ children }) {
  return (
    <section className="land-hero">
      <Wordmark className="wm-light" />
      {children}
      <div className="notes" aria-hidden="true">
        {NOTES.map(([who, text, ch], i) => (
          <div className="lnote" key={who + i} style={{ '--i': i }}>
            <i>{ch}</i><div><b>{who}</b><span>{text}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

let LANDING_SEEN = null; // demo accounts from the first visit, so switching Sign in / Sign up does not reload

export default function Landing({ force }) {
  const nav = useNavigate();
  const [tab, setTab] = useState('in');
  const [checking, setChecking] = useState(!(force && LANDING_SEEN));
  const [demo, setDemo] = useState(force && LANDING_SEEN ? LANDING_SEEN.demo : null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', again: '', code: '' });
  const [choose, setChoose] = useState(null);   // the same email and password in more than one club
    const [forgot, setForgot] = useState(false);
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
    if (force && LANDING_SEEN) return undefined;
    (async () => {
      if (!force) { try { const s = await api('/session'); nav(s.type === 'vpe' ? '/v' : '/m', { replace: true }); return; } catch { setToken(null); } }
      let d = null;
      try { d = await api('/dev/accounts'); setDemo(d); } catch { /* demo mode off */ }
      LANDING_SEEN = { demo: d };
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/signin', { method: 'POST', body: { email: f.email, password: f.password } });
      if (r.choose) setChoose(r.choose); else finish(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (checking) return <Loading />;
  const ready = f.email.trim() && f.password;
  return (
    <>
      <HeroText>
        <h1>Feedback is the <span>breakfast</span> of Champions.</h1>
        <p className="sub">Where good meetings turn into better speakers. Rosters, feedback and progress for your Toastmasters club.</p>
        <div className="notes" aria-hidden="true">
          {NOTES.map(([who, text, ch], i) => (
            <div className="lnote" key={who + i} style={{ '--i': i }}>
              <i>{ch}</i><div><b>{who}</b><span>{text}</span></div>
            </div>
          ))}
        </div>
      </HeroText>
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
              <Seg className="auth-tabs" value="in" onChange={(v) => v === 'up' && nav('/start/club')} options={[['in', 'Sign in'], ['up', 'Sign up']]} />
              <h2>Welcome back.</h2>
              <label className="fl" htmlFor="l-email">Email</label>
              <input id="l-email" className="inp" type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" />
              <label className="fl" htmlFor="l-pw">Password</label>
              <PwInput id="l-pw" value={f.password} onChange={set('password')} autoComplete="current-password" placeholder="Your password" onKeyDown={(e) => e.key === 'Enter' && ready && submit()} />
              <button type="button" className="forgot" onClick={() => setForgot(!forgot)} aria-expanded={forgot}>Forgot your password?</button>
              {forgot && (
                <div className="forgot-box">
                  <p>Ask your VPE for a reset link. They send it to you on WhatsApp, and it lets you choose a new password.</p>
                  <a className="btn ghost sm" href={`https://wa.me/${VPE_WHATSAPP}?text=${encodeURIComponent('Hi, I forgot my Brekkie password. Could you send me a reset link?')}`} target="_blank" rel="noreferrer">Message the VPE on WhatsApp</a>
                </div>
              )}
              {err && <p className="err">{err}</p>}
              <div style={{ marginTop: 18 }}><Btn onClick={submit} disabled={!ready || busy}>{busy ? 'One moment…' : 'Sign in'}</Btn></div>
              <p className="fine" style={{ marginTop: 14 }}>New to Brekkie? Your VPE sends you an invite on WhatsApp. Tap it to choose your password.</p>
            </>
          )}

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
    </>
  );
}
