import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, getToken, setToken, useApi } from './api.js';
import { Loading, Shell } from './ui.jsx';
import { EvaluationDetail, Evaluations, FuncHistory, Given, MEMBER_NAV, MeetingDetail, Meetings, MemberHome, Room } from './pages/Member.jsx';
import Feedback from './pages/Feedback.jsx';
import RoleApp from './pages/Role.jsx';
import Agenda from './pages/Agenda.jsx';
import { VPE_NAV, VpeMeeting, VpePeople, VpePerson } from './pages/Vpe.jsx';
import Roster from './pages/Roster.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Calendar from './pages/Calendar.jsx';
import Landing from './pages/Landing.jsx';
import Wizard from './pages/Wizard.jsx';
import Reset from './pages/Reset.jsx';
import Club, { AccountModal } from './pages/Club.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/start" element={<Landing force />} />
      <Route path="/start/club" element={<Wizard />} />
      <Route path="/reset/:token" element={<Reset />} />
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

/* The last session seen on this device, so the page frame (menu, name) can draw at once while the session is confirmed.
   It is only used for the frame; the server answer still decides who may be here. */
const CACHE = 'brekkie_session';
const readCache = () => { try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); return c && c.t === getToken() ? c.d : null; } catch { return null; } };
function useSession() {
  const nav = useNavigate();
  const s = useApi('/session');
  useEffect(() => { if (s.error) nav('/', { replace: true }); }, [s.error, nav]);
  useEffect(() => { if (s.data) { try { localStorage.setItem(CACHE, JSON.stringify({ t: getToken(), d: s.data })); } catch { /* storage blocked */ } } }, [s.data]);
  const [cached] = useState(readCache);
  return { ...s, data: s.data || (s.error ? null : cached) };
}
const signOut = (nav) => () => { setToken(null); nav('/'); };

function MemberArea() {
  const nav = useNavigate();
  const [acct, setAcct] = useState(false);
  const { data } = useSession();
  if (!data) return <Loading />;
  return (
    <Shell topNav nav={MEMBER_NAV} who={data.person.name} onSignOut={signOut(nav)} onAccount={() => setAcct(true)}>
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
      {acct && <AccountModal onClose={() => setAcct(false)} />}
    </Shell>
  );
}

function VpeArea() {
  const nav = useNavigate();
  const [acct, setAcct] = useState(false);
  const { data } = useSession();
  if (!data) return <Loading />;
  if (data.type !== 'vpe') return <Navigate to="/m" replace />;
  return (
    <Shell nav={VPE_NAV} who={data.person.name} tag="VPE" sub={data.club || 'Your club'} onSignOut={signOut(nav)} onAccount={() => setAcct(true)}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="roster" element={<Roster />} />
        <Route path="meetings/:id" element={<VpeMeeting />} />
        <Route path="meetings/:id/agenda" element={<Agenda />} />
        <Route path="members" element={<VpePeople />} />
        <Route path="club" element={<Club />} />
        <Route path="people" element={<Navigate to="/v/members" replace />} />
        <Route path="members/:id" element={<VpePerson />} />
        <Route path="evaluations/:id" element={<EvaluationDetail vpe />} />
      </Routes>
      {acct && <AccountModal onClose={() => setAcct(false)} />}
    </Shell>
  );
}
