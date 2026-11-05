import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, setToken, useApi } from './api.js';
import { Btn, Loading, Shell, Wordmark } from './ui.jsx';
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
        {!demo && <p className="lede">Open the link your VPE sent you to get started.</p>}
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
