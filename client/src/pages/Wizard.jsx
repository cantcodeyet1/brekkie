import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { Btn, DatePick, I, Select, Seg, Wordmark, copyText, useToast } from '../ui.jsx';

/* ───────── the meeting pattern: when a club meets ───────── */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: DAYS[d] }));
const WEEKS = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [5, 'Last']];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (s) => new Date(s + 'T12:00:00');

/** The same rule the server uses, so the wizard can show the dates it will create. */
export function datesFor(p, from, count) {
  if (!p || p.day == null || !p.start) return [];
  const out = [], d = at(from);
  for (let i = 0; i < 800 && out.length < count; i++, d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== p.day) continue;
    const nth = Math.ceil(d.getDate() / 7), n = new Date(d); n.setDate(n.getDate() + 7);
    const last = n.getMonth() !== d.getMonth();
    const ok = p.mode === 'weekly' || (p.mode === 'fortnightly' && Math.round((d - at(p.start)) / 604800000) % 2 === 0)
      || (p.mode === 'monthly' && (p.weeks.includes(nth) || (p.weeks.includes(5) && last)));
    if (ok) out.push(iso(d));
  }
  return out;
}
export const firstMatch = (p) => datesFor({ ...p, start: iso(new Date()) }, iso(new Date()), 1)[0] || firstOn(p.day);
export const firstOn = (day, from = iso(new Date())) => { const d = at(from); for (let i = 0; i < 8 && d.getDay() !== day; i++) d.setDate(d.getDate() + 1); return iso(d); };
export const fmtDate = (s) => at(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function PatternFields({ value: p, onChange }) {
  const set = (patch) => onChange({ ...p, ...patch });
  const toggleWeek = (w) => set({ weeks: p.weeks.includes(w) ? p.weeks.filter((x) => x !== w) : [...p.weeks, w].sort() });
  return (
    <>
      <label className="fl">Which day do you meet?</label>
      <Select value={p.day} onChange={(v) => set({ day: v, start: firstOn(v, p.start && at(p.start) > new Date() ? p.start : iso(new Date())) })} options={DAY_OPTIONS} placeholder="Choose a day" />
      <label className="fl">How often?</label>
      <Seg value={p.mode} onChange={(v) => set({ mode: v, weeks: v === 'monthly' && !p.weeks.length ? [2, 4] : p.weeks })} options={[['weekly', 'Every week'], ['fortnightly', 'Every 2 weeks'], ['monthly', 'Certain weeks']]} />
      {p.mode === 'monthly' && (
        <>
          <label className="fl">Which weeks of the month?</label>
          <div className="chips" role="group" aria-label="Weeks of the month">
            {WEEKS.map(([w, l]) => <button type="button" key={w} className={'wk' + (p.weeks.includes(w) ? ' on' : '')} aria-pressed={p.weeks.includes(w)} onClick={() => toggleWeek(w)}>{l}</button>)}
          </div>
        </>
      )}
      <div className="two">
        <div><label className="fl" htmlFor="pt-time">Start time</label><input id="pt-time" className="inp" type="time" value={p.time} onChange={(e) => set({ time: e.target.value })} /></div>
        <div><label className="fl" htmlFor="pt-place">Where? (optional)</label><input id="pt-place" className="inp" value={p.place} onChange={(e) => set({ place: e.target.value })} placeholder="Venue or online" /></div>
      </div>
    </>
  );
}
export const newPattern = () => ({ day: 5, mode: 'monthly', weeks: [2, 4], time: '18:00', place: '', start: firstOn(5) });

/* ───────── the wizard ───────── */
const STEPS = ['You', 'Your club', 'When you meet', 'First meeting'];

export default function Wizard() {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [me, setMe] = useState({ name: '', email: '', password: '' });
  const [club, setClub] = useState('');
  const [pat, setPat] = useState(newPattern);
  const [num, setNum] = useState(1);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const preview = useMemo(() => datesFor(pat, pat.start, 6), [pat]);
  const startOk = !!pat.start && datesFor(pat, pat.start, 1)[0] === pat.start;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(me.email.trim());
  const can = [
    me.name.trim().length > 1 && emailOk && me.password.length >= 8,
    club.trim().length > 1,
    pat.day != null && (pat.mode !== 'monthly' || pat.weeks.length > 0),
    startOk && num >= 1,
  ];
  const next = () => { setErr(''); if (!can[step]) return; if (step === 2) setPat((p) => ({ ...p, start: firstMatch(p) })); setStep(step + 1); };
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/clubs', { method: 'POST', body: { name: me.name, email: me.email, password: me.password, club: { name: club, pattern: pat, firstNumber: num } } });
      setToken(r.token); setDone(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const link = done ? `${window.location.origin}/join/${done.join_code}` : '';
  return (
    <div className="land wiz">
      <section className="land-hero">
        <Wordmark className="wm-light" />
        <h1>Let us get your club <span>started</span>.</h1>
        <ol className="steps" aria-label="Progress">
          {STEPS.map((s, i) => <li key={s} className={done || i < step ? 'is-done' : i === step ? 'is-now' : ''}><i>{done || i < step ? I.check : i + 1}</i>{s}</li>)}
        </ol>
      </section>
      <section className="land-panel">
        {done ? (
          <div className="panel-in">
            <div className="tick">{I.check}</div>
            <h2>{club} is ready.</h2>
            <p className="lede">We created your next {done.meetings} meetings. Share this code so members can join.</p>
            <div className="code" aria-label="Club code">{done.join_code}</div>
            <div className="row2">
              <Btn kind="ghost" onClick={async () => toast((await copyText(link)) ? 'Invite link copied' : link)}>{I.copy} Copy invite link</Btn>
              <Btn onClick={() => nav('/v', { replace: true })}>Open Brekkie</Btn>
            </div>
            <p className="fine">Members tap the invite link, make an account in seconds, and land in your club. You can find this code again under Club.</p>
          </div>
        ) : (
          <div className="panel-in">
            <p className="kick">Step {step + 1} of {STEPS.length}</p>
            {step === 0 && (
              <>
                <h2>First, you.</h2>
                <p className="lede">You will be the VPE. Your email and password are how you sign in.</p>
                <label className="fl" htmlFor="w-name">Your name</label>
                <input id="w-name" className="inp" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} autoComplete="name" placeholder="Your full name" />
                <label className="fl" htmlFor="w-email">Email</label>
                <input id="w-email" className="inp" type="email" value={me.email} onChange={(e) => setMe({ ...me, email: e.target.value })} autoComplete="email" placeholder="you@example.com" />
                <label className="fl" htmlFor="w-pw">Password</label>
                <input id="w-pw" className="inp" type="password" value={me.password} onChange={(e) => setMe({ ...me, password: e.target.value })} autoComplete="new-password" placeholder="At least 8 characters" onKeyDown={(e) => e.key === 'Enter' && next()} />
              </>
            )}
            {step === 1 && (
              <>
                <h2>Name your club.</h2>
                <p className="lede">This is what members see when they join.</p>
                <label className="fl" htmlFor="w-club">Club name</label>
                <input id="w-club" className="inp" value={club} onChange={(e) => setClub(e.target.value)} placeholder="e.g. Champions Toastmasters Club" onKeyDown={(e) => e.key === 'Enter' && next()} />
              </>
            )}
            {step === 2 && (
              <>
                <h2>When do you meet?</h2>
                <p className="lede">Brekkie will create your meetings from this, so the roster fills itself.</p>
                <PatternFields value={pat} onChange={setPat} />
              </>
            )}
            {step === 3 && (
              <>
                <h2>Your first meeting.</h2>
                <p className="lede">Pick the date of the next meeting. We will plan a year from there.</p>
                <div className="two">
                  <div><label className="fl" htmlFor="w-date">Date</label><DatePick id="w-date" value={pat.start} onChange={(v) => setPat({ ...pat, start: v })} /></div>
                  <div><label className="fl" htmlFor="w-num">Meeting number</label><input id="w-num" className="inp" type="number" min="1" value={num} onChange={(e) => setNum(Math.max(1, parseInt(e.target.value, 10) || 1))} /></div>
                </div>
                {!startOk && pat.start && <p className="err">That date does not fit your pattern. Pick a {DAYS[pat.day]}{pat.mode === 'monthly' ? ' in one of your chosen weeks' : ''}.</p>}
                {startOk && (
                  <div className="prev"><small>Your first meetings</small><div>{preview.map((d, i) => <span key={d}>{i === 0 ? `No. ${num}  ` : ''}{fmtDate(d)}</span>)}</div></div>
                )}
              </>
            )}
            {err && <p className="err">{err}</p>}
            <div className="row2 wnav">
              {step > 0 ? <Btn kind="ghost" onClick={() => { setErr(''); setStep(step - 1); }}>Back</Btn> : <Link className="lnk" to="/start">Already have an account?</Link>}
              {step < STEPS.length - 1 ? <Btn onClick={next} disabled={!can[step]}>Continue</Btn> : <Btn onClick={create} disabled={!can[step] || busy}>{busy ? 'Creating…' : 'Create my club'}</Btn>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
