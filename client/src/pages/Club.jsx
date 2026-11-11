import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { Avatar, Btn, ErrorMsg, I, SkPage, SkRows, Modal, Page, PathPick, Select, copyText, useToast } from '../ui.jsx';
import { PwPair, pwGood } from './Landing.jsx';
import { BulkInvite } from './Vpe.jsx';
import { PatternFields, datesFor, fmtDate, newPattern } from './Wizard.jsx';

/* ───────── the VPE's club page: at a glance, invite, meeting pattern, visitor access ───────── */
export default function Club() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/account');
  const sum = useApi('/vpe/club/summary');
  const [pat, setPat] = useState(null);
  const [name, setName] = useState('');
  const [tm, setTm] = useState('');
  const [gd, setGd] = useState(30);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [num, setNum] = useState(1);
  const ppl = useApi('/vpe/people');
  const sess = useApi('/session');
  const [bulk, setBulk] = useState(false);
  useEffect(() => { if (data) { setPat(data.club.pattern || newPattern()); setName(data.club.name); setTm(data.club.number || ''); setGd(data.club.guest_days || 30); } }, [data]);
  if (loading || !pat) return <Page title="Club" root wide full><SkPage stats={3} rows={4} pill={false} /></Page>;
  if (error) return <Page title="Club" root wide full><ErrorMsg error={error} /></Page>;

  const body = () => ({ name, number: tm, pattern: pat, guest_days: gd });
  const save = async () => {
    setBusy('save'); setErr('');
    try { await api('/vpe/club', { method: 'PUT', body: body() }); toast('Saved'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const make = async () => {
    setBusy('make'); setErr('');
    try { await api('/vpe/club', { method: 'PUT', body: body() }); const r = await api('/vpe/club/meetings', { method: 'POST', body: { firstNumber: num } }); toast(r.made ? `Created ${r.made} meetings` : 'You already have meetings for the next year'); reload(); sum.reload && sum.reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const sm = sum.data;
  const stat = (n, l, sub) => <div className="cl-st"><small>{l}</small><b>{n ?? '-'}</b><span>{sub}</span></div>;
  return (
    <Page title="Club" root wide full>
      <div className="rpage">
        <div className="rhead">
          <div>
            <p className="reyebrow">Your club</p>
            <h1 className="rtitle">{data.club.name}</h1>
            <p className="rsub">{data.club.pattern_text ? `${data.club.pattern_text}. ` : ''}Invite members, set your meeting pattern and choose how long visitors keep access.</p>
          </div>
        </div>

        <div className="cl-card">
          <div className="cl-stats">
            {stat(sm?.members, 'Members', 'In the club')}
            {stat(sm?.guests, 'Visitors', 'With access now')}
            {stat(sm?.ahead, 'Meetings', 'Still to come')}
            {stat(sm?.speeches, 'Speeches', 'Evaluated so far')}
          </div>

          <section className="cl-sec">
            <div className="cl-l"><h2>Invite members</h2><p>Members join by invite, sent on WhatsApp. Each invite lets one person choose a password and sign in. You can also invite one person from their profile.</p></div>
            <div className="cl-r">
              {(() => {
                const todo = (ppl.data || []).filter((p) => p.kind === 'member' && p.status !== 'inactive' && p.acct !== 'active' && p.id !== sess.data?.person?.id);
                const active = (ppl.data || []).filter((p) => p.kind === 'member' && p.acct === 'active').length;
                return (
                  <>
                    <p className="fine" style={{ margin: '0 0 12px' }}>{ppl.data ? `${active} signed in, ${todo.filter((p) => p.acct === 'invited').length} invited, ${todo.filter((p) => p.acct !== 'invited').length} not invited yet.` : 'Loading…'}</p>
                    <div className="cl-btns"><Btn onClick={() => setBulk(true)} disabled={!todo.length}>{todo.length ? `Send invites (${todo.length})` : 'Everyone is invited'}</Btn></div>
                    {bulk && <BulkInvite people={todo} club={data.club.name} onClose={() => setBulk(false)} onDone={ppl.reload} />}
                  </>
                );
              })()}
            </div>
          </section>

          <section className="cl-sec">
            <div className="cl-l"><h2>Visitors</h2><p>Visitors get a personal link when they are put in a role. They keep access for this long, and you can extend it from the Members page.</p></div>
            <div className="cl-r">
              <label className="fl" htmlFor="c-gd">Visitor access</label>
              <div className="cl-gd"><Select value={gd} onChange={(v) => setGd(Number(v))} options={[[7, '1 week'], [14, '2 weeks'], [30, '30 days'], [60, '60 days'], [90, '90 days']].map(([value, label]) => ({ value, label }))} /></div>
              <div className="cl-btns"><Btn onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save settings'}</Btn></div>
            </div>
          </section>

          <section className="cl-sec">
            <div className="cl-l"><h2>When you meet</h2><p>Your pattern decides which meeting dates Brekkie creates. Existing meetings are never changed.</p></div>
            <div className="cl-r">
              <label className="fl" htmlFor="c-name">Club name</label>
              <input id="c-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="fl" htmlFor="c-tm">Club number <i>(shown on the agenda)</i></label>
              <input id="c-tm" className="inp cl-num" inputMode="numeric" maxLength={10} placeholder="e.g. 04647453" value={tm} onChange={(e) => setTm(e.target.value.replace(/\D/g, ''))} />
              <PatternFields value={pat} onChange={setPat} />
              <div className="cl-prev"><small>Next meetings</small><div>{datesFor(pat, new Date().toISOString().slice(0, 10) > pat.start ? new Date().toISOString().slice(0, 10) : pat.start, 6).map((d) => <span key={d}>{fmtDate(d)}</span>)}</div></div>
              {sm?.next && <p className="fine">Next up: meeting {sm.next.number}, {fmtDate(sm.next.date)}.</p>}
              <label className="fl" htmlFor="c-num">Number of your first meeting <i>(only used if you have none yet)</i></label>
              <input id="c-num" className="inp cl-num" type="number" min="1" value={num} onChange={(e) => setNum(Math.max(1, parseInt(e.target.value, 10) || 1))} />
              {err && <p className="err">{err}</p>}
              <div className="cl-btns">
                <Btn kind="ghost" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save pattern'}</Btn>
                <Btn onClick={make} disabled={busy === 'make'}>{busy === 'make' ? 'Creating…' : 'Create the next 12 months of meetings'}</Btn>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}

/* ───────── your account: email and password ───────── */
export function AccountModal({ account: data, onClose, onSignOut, showPath = false, admin = false, portal = false, vpe = false }) {
  const toast = useToast();
  const cat = useApi('/pathways');
  const [f, setF] = useState({ email: '', current: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF((x) => ({ ...x, email: data.email, path_name: data.path_name, path_level: data.path_level })); }, [data]);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api('/account', { method: 'PUT', body: f }); toast(data.has_password || f.password ? 'Account saved' : 'Saved'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Your account" onClose={onClose}>
      {!data ? <div className="ac-sk"><SkRows n={4} pill={false} /></div> : (
        <div className="ac ac-in">
          <div className="ac-me">
            <Avatar name={data.name || ''} size={52} />
            <div><b>{data.name}</b><span>{data.club?.name}</span></div>
          </div>

          <section className="ac-sec">
            <h3>Sign in</h3>
            <label className="fl" htmlFor="a-email">Email</label>
            <input id="a-email" className="inp" type="email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} autoComplete="email" />
            {data.has_password && <><label className="fl" htmlFor="a-cur">Current password <i>(only to change it)</i></label><input id="a-cur" className="inp" type="password" value={f.current} onChange={(e) => setF((s) => ({ ...s, current: e.target.value }))} autoComplete="current-password" /></>}
            {data.has_password ? <p className="fl" style={{ marginBottom: 0 }}>New password <i>(optional)</i></p> : null}
            <PwPair id="a-pw" value={f.password} again={f.again || ''} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} onAgain={(e) => setF((s) => ({ ...s, again: e.target.value }))} />
            <p className="ac-note">{data.has_password ? 'Leave the password boxes empty to keep your current one.' : 'Add a password so you can sign in with your email.'}</p>
          </section>

          {showPath && <section className="ac-sec">
            <h3>Your Pathways path</h3>
            <PathPick catalog={cat.data?.paths || []} pathName={f.path_name} level={f.path_level} onChange={(v) => setF((x) => ({ ...x, ...v }))} />
            <p className="ac-note">Fills in your path and level when you are down to speak. You can still change it for any speech.</p>
          </section>}

          {portal && <Link to="/m" className="ac-admin" onClick={onClose}>{I.home} My member page</Link>}
          {vpe && <Link to="/v" className="ac-admin" onClick={onClose}>{I.back} Back to the VPE view</Link>}
          {admin && <Link to="/admin" className="ac-admin" onClick={onClose}>{I.chart} Open the super admin page</Link>}
          {onSignOut && <button type="button" className="ac-out" onClick={onSignOut}>{I.out} Sign out</button>}

          {err && <p className="err">{err}</p>}
          <div className="row2"><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy || !f.email.trim() || (!data.has_password && !pwGood(f.password, f.again || '')) || (data.has_password && !!f.password && !pwGood(f.password, f.again || ''))}>{busy ? 'Saving…' : 'Save'}</Btn></div>
        </div>
      )}
    </Modal>
  );
}
