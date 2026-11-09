import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { Btn, SkRows } from '../ui.jsx';
import { Hero, PwPair, pwGood } from './Landing.jsx';

/* the page a VPE's reset link opens: choose a new password and you are signed in */
export default function Reset() {
  const { token } = useParams();
  const nav = useNavigate();
  const [who, setWho] = useState(null);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [dead, setDead] = useState(false);
  useEffect(() => { api(`/auth/reset/${token}`, { token: '' }).then(setWho, (e) => { setDead(true); setErr(e.message); }); }, [token]);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const s = await api('/auth/reset', { method: 'POST', body: { token, password: pw }, token: '' }); setToken(s.token); nav(s.type === 'vpe' ? '/v' : '/m', { replace: true }); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="land">
      <Hero>
        <h1>{who?.invited ? <>Welcome to <span>Brekkie</span>.</> : <>Choose a <span>new</span> password.</>}</h1>
        <p className="sub">{who?.invited ? 'Choose a password and you are in. Your roles, feedback and progress are waiting.' : 'You will be signed in as soon as it is saved.'}</p>
      </Hero>
      <section className="land-panel">
        <div className="panel-in">
          {dead ? (
            <><h2>Link expired</h2><p className="lede">{err}</p></>
          ) : !who ? <SkRows n={2} pill={false} /> : (
            <>
              <h2>Hi {who.name.split(' ')[0]}.</h2>
              <p className="lede">{who.invited ? 'Choose a password for' : 'Set a new password for'} {who.email || 'your account'} at {who.club}.</p>
              <PwPair id="r-pw" value={pw} again={again} onChange={(e) => { setPw(e.target.value); setErr(''); }} onAgain={(e) => { setAgain(e.target.value); setErr(''); }} onEnter={() => pwGood(pw, again) && submit()} />
              {err && <p className="err">{err}</p>}
              <div style={{ marginTop: 18 }}><Btn onClick={submit} disabled={!pwGood(pw, again) || busy}>{busy ? 'One moment…' : who?.invited ? 'Join Brekkie' : 'Save and sign in'}</Btn></div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
