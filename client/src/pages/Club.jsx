import { useEffect, useState } from 'react';
import { api, useApi } from '../api.js';
import { Btn, ErrorMsg, I, Loading, Modal, Page, PathPick, copyText, useToast } from '../ui.jsx';
import { PatternFields, datesFor, fmtDate, newPattern } from './Wizard.jsx';

/* ───────── the VPE's club page: join code, meeting pattern, create meetings ───────── */
export default function Club() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/account');
  const [pat, setPat] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [num, setNum] = useState(1);
  useEffect(() => { if (data) { setPat(data.club.pattern || newPattern()); setName(data.club.name); } }, [data]);
  if (loading || !pat) return <Page title="Club" root><Loading /></Page>;
  if (error) return <Page title="Club" root><ErrorMsg error={error} /></Page>;

  const link = `${window.location.origin}/join/${data.club.join_code}`;
  const save = async () => {
    setBusy('save'); setErr('');
    try { await api('/vpe/club', { method: 'PUT', body: { name, pattern: pat } }); toast('Saved'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const make = async () => {
    setBusy('make'); setErr('');
    try { await api('/vpe/club', { method: 'PUT', body: { name, pattern: pat } }); const r = await api('/vpe/club/meetings', { method: 'POST', body: { firstNumber: num } }); toast(r.made ? `Created ${r.made} meetings` : 'You already have meetings for the next year'); reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  return (
    <Page title="Club" root narrow>
      <p className="eyebrow">Your club</p>
      <h1 className="pg">{data.club.name}</h1>
      <h3 className="sec">Invite members</h3>
      <p className="lede">Members join with this code. Send them the link and they only need an email and a password.</p>
      <div className="code" aria-label="Club code">{data.club.join_code}</div>
      <div className="row2"><Btn kind="ghost" onClick={async () => toast((await copyText(link)) ? 'Invite link copied' : link)}>{I.copy} Copy invite link</Btn></div>

      <h3 className="sec">When you meet</h3>
      <label className="fl" htmlFor="c-name">Club name</label>
      <input id="c-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} />
      <PatternFields value={pat} onChange={setPat} />
      <div className="prev"><small>Next meetings</small><div>{datesFor(pat, new Date().toISOString().slice(0, 10) > pat.start ? new Date().toISOString().slice(0, 10) : pat.start, 6).map((d) => <span key={d}>{fmtDate(d)}</span>)}</div></div>
      <label className="fl" htmlFor="c-num">Number of your first meeting (only used if you have no meetings yet)</label>
      <input id="c-num" className="inp" type="number" min="1" value={num} onChange={(e) => setNum(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ maxWidth: 140 }} />
      {err && <p className="err">{err}</p>}
      <div className="row2" style={{ marginTop: 16 }}>
        <Btn kind="ghost" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save pattern'}</Btn>
        <Btn onClick={make} disabled={busy === 'make'}>{busy === 'make' ? 'Creating…' : 'Create the next 12 months of meetings'}</Btn>
      </div>
      <p className="fine">Creating meetings adds any dates that do not exist yet, numbered after your latest meeting. It never changes meetings you already have.</p>
    </Page>
  );
}

/* ───────── your account: email and password ───────── */
export function AccountModal({ onClose }) {
  const toast = useToast();
  const { data } = useApi('/account');
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
      {!data ? <Loading /> : (
        <>
          <p className="lede" style={{ marginTop: 0 }}>{data.has_password ? 'Change your email or password. Your personal link keeps working.' : 'Add a password so you can sign in with your email, not just your link.'}</p>
          <label className="fl" htmlFor="a-email">Email</label>
          <input id="a-email" className="inp" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
          <label className="fl">Your Pathways path</label>
          <PathPick catalog={cat.data?.paths || []} pathName={f.path_name} level={f.path_level} onChange={(v) => setF((x) => ({ ...x, ...v }))} />
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--mute)' }}>Fills in your path and level when you are down to speak. You can still change it for any speech.</p>
          {data.has_password && <><label className="fl" htmlFor="a-cur">Current password (only to change it)</label><input id="a-cur" className="inp" type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" /></>}
          <label className="fl" htmlFor="a-pw">{data.has_password ? 'New password (optional)' : 'Password'}</label>
          <input id="a-pw" className="inp" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" placeholder="At least 8 characters" />
          {err && <p className="err">{err}</p>}
          <div className="row2" style={{ marginTop: 16 }}><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy || !f.email.trim() || (!data.has_password && f.password.length < 8)}>{busy ? 'Saving…' : 'Save'}</Btn></div>
        </>
      )}
    </Modal>
  );
}
