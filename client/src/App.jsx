import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, setToken, useApi } from './api.js';
import { Btn, Loading, Shell, Wordmark, copyText } from './ui.jsx';
import { EvaluationDetail, Evaluations, FuncHistory, Given, MEMBER_NAV, MeetingDetail, Meetings, MemberHome, Room } from './pages/Member.jsx';
import Feedback from './pages/Feedback.jsx';
import RoleApp from './pages/Role.jsx';
import Agenda from './pages/Agenda.jsx';
import { VPE_NAV, VpeMeeting, VpePeople, VpePerson } from './pages/Vpe.jsx';
import Roster from './pages/Roster.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SignIn />} />
      <Route path="/start" element={<SignIn force />} />
      <Route path="/s/:token" element={<Enter />} />
      <Route path="/r/:token" element={<RoleApp />} />
      <Route path="/f/:code" element={<Feedback />} />
      <Route path="/m/*" element={<MemberArea />} />
      <Route path="/v/*" element={<VpeArea />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/* a personal link: remember it on this device, then go home */
function Enter() {
  const { token } = useParams();
  const nav = useNavigate();
  useEffect(() => { setToken(token); nav('/', { replace: true }); }, [token, nav]);
  return <Loading />;
}

function useSession() {
  const nav = useNavigate();
  const s = useApi('/session');
  useEffect(() => { if (s.error) nav('/', { replace: true }); }, [s.error, nav]);
  return s;
}
const signOut = (nav) => () => { setToken(null); nav('/'); };

function MemberArea() {
  const nav = useNavigate();
  const { data } = useSession();
  if (!data) return <Loading />;
  return (
    <Shell topNav nav={MEMBER_NAV} who="">
      <Routes>
        <Route index element={<MemberHome />} />
        <Route path="role/:key" element={<FuncHistory />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="given" element={<Given />} />
        <Route path="meetings/:number" element={<MeetingDetail />} />
        <Route path="speeches" element={<Evaluations />} />
        <Route path="speeches/:id" element={<EvaluationDetail />} />
        <Route path="room" element={<Room />} />
        <Route path="evaluations" element={<Navigate to="/m/speeches" replace />} />
      </Routes>
    </Shell>
  );
}

function VpeArea() {
  const nav = useNavigate();
  const { data } = useSession();
  if (!data) return <Loading />;
  if (data.type !== 'vpe') return <Navigate to="/m" replace />;
  return (
    <Shell nav={VPE_NAV} who={data.person.name} sub="VPE · Champions Toastmasters Club" onSignOut={signOut(nav)}>
      <Routes>
        <Route index element={<Roster />} />
        <Route path="meetings/:id" element={<VpeMeeting />} />
        <Route path="meetings/:id/agenda" element={<Agenda />} />
        <Route path="members" element={<VpePeople />} />
        <Route path="people" element={<Navigate to="/v/members" replace />} />
        <Route path="members/:id" element={<VpePerson />} />
        <Route path="evaluations/:id" element={<EvaluationDetail vpe />} />
      </Routes>
    </Shell>
  );
}

/* sign in: paste your link, or (in demo mode) pick who to be */
function SignIn({ force }) {
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState(null);
  const [checking, setChecking] = useState(true);
  const [setup, setSetup] = useState(null);
  const [paste, setPaste] = useState('');

  const enter = async (raw) => {
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
      try { setSetup(await api('/setup/status')); } catch { /* older server */ }
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (checking) return <Loading />;
  return (
    <div className="app" style={{ overflowY: 'auto' }}>
      <div className="signin">
        <Wordmark />
        <h1>Feedback is the <span>breakfast</span> of Champions.</h1>
        <p className="tag">Champions Toastmasters Club</p>
        {setup?.needsSetup && !demo ? <FirstRun hasCode={setup.hasCode} enter={enter} /> : !demo && (
          <>
            <p className="lede">Open the link your VPE sent you, or paste it here.</p>
            <div className="paste">
              <input className="inp" value={paste} onChange={(e) => { setPaste(e.target.value); setErr(''); }} onKeyDown={(e) => e.key === 'Enter' && enter(paste)} placeholder="Paste your link" aria-label="Your sign-in link" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
              <Btn onClick={() => enter(paste)} disabled={!paste.trim()}>Sign in</Btn>
            </div>
          </>
        )}
        {err && <p className="err">{err}</p>}
        {demo && (
          <>
            <div className="lab" style={{ marginTop: 36 }}>Demo: sign in as</div>
            <div className="demo-grid">
              {demo.people.map((p) => <button key={p.id} onClick={() => enter(p.token)}>{p.name}<small>{p.is_vpe ? 'VPE' : 'Member'}</small></button>)}
            </div>
            {demo.roles.length > 0 && <>
              <div className="lab">Demo: open a role link for meeting {demo.meeting?.number}</div>
              <div className="demo-grid">
                {demo.roles.map((r) => <button key={r.token} onClick={() => nav(`/r/${r.token}`)}>{r.label}<small>{r.person}{r.kind === 'guest' ? ' · Guest' : ''}</small></button>)}
              </div></>}
          </>
        )}
      </div>
    </div>
  );
}

/* the very first visit: no VPE exists yet, so the person with the setup code becomes it */
function FirstRun({ hasCode, enter }) {
  const [f, setF] = useState({ name: '', email: '', code: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const go = async () => {
    setBusy(true);
    try { const r = await api('/setup', { method: 'POST', body: f }); setLink(`${window.location.origin}/s/${r.token}`); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (link) {
    return (
      <div className="firstrun">
        <div className="lab" style={{ marginTop: 30 }}>You are the VPE</div>
        <p className="lede">This link is your sign-in. Save it somewhere safe, like your notes. Anyone with it can act as you.</p>
        <input className="inp" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Your VPE link" />
        <div className="paste" style={{ marginTop: 12 }}>
          <Btn kind="ghost" onClick={() => copyText(link)}>Copy link</Btn>
          <Btn onClick={() => enter(link)}>Open Brekkie</Btn>
        </div>
      </div>
    );
  }
  return (
    <div className="firstrun">
      <div className="lab" style={{ marginTop: 30 }}>Set up your club</div>
      <p className="lede">No VPE yet. Start here and you will be the VPE.</p>
      {!hasCode && <p className="err">Setup is switched off. Add a SETUP_CODE where the app is hosted, then reload.</p>}
      <label className="fl" htmlFor="su-name">Your name</label>
      <input id="su-name" className="inp" value={f.name} onChange={set('name')} placeholder="Your full name" autoComplete="name" />
      <label className="fl" htmlFor="su-email">Email (optional)</label>
      <input id="su-email" className="inp" type="email" value={f.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" />
      <label className="fl" htmlFor="su-code">Setup code</label>
      <input id="su-code" className="inp" type="password" value={f.code} onChange={set('code')} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder="From your host settings" autoComplete="off" />
      {err && <p className="err">{err}</p>}
      <div style={{ marginTop: 16 }}><Btn onClick={go} disabled={busy || !hasCode || f.name.trim().length < 2 || !f.code}>{busy ? 'Setting up…' : 'Start as VPE'}</Btn></div>
    </div>
  );
}
