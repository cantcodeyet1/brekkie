import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setToken, useApi } from '../api.js';
import { fmtDate } from '../data.js';
import { Btn, I, Modal, Page, Shell, useToast } from '../ui.jsx';

const ROLE_NAMES = { grammarian: 'Grammarian', ah_counter: 'Ah Counter', timer: 'Timer', topicsmaster: 'Topicsmaster', evaluator: 'Speech Evaluator', general_evaluator: 'General Evaluator' };
const short = (d) => (d ? fmtDate(d, { day: 'numeric', month: 'short' }) : 'Never');

function up(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

const Stat = ({ label, value, sub, tone }) => (
  <div className={'ad-stat' + (tone ? ' ' + tone : '')}><small>{label}</small><b>{value}</b>{sub && <span>{sub}</span>}</div>
);
const Card = ({ title, sub, right, children }) => (
  <section className="mb-card ad-card">
    <div className="ad-h"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{right}</div>
    {children}
  </section>
);

function Bars({ rows, label, color }) {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <ul className="ad-bars">
      {rows.map(([k, n]) => <li key={k}><span>{label(k)}</span><i><u style={{ width: `${Math.max(2, (n / max) * 100)}%`, background: color }} /></i><b>{n}</b></li>)}
    </ul>
  );
}

/* the link for someone who is stuck, ready to copy or open in WhatsApp */
function LinkModal({ r, onClose }) {
  const toast = useToast();
  const url = `${window.location.origin}/reset/${r.token}`;
  const first = r.name.split(' ')[0];
  const msg = r.kind === 'invite'
    ? `Hi ${first}, here is your link to join Brekkie. Open it and choose a password: ${url}\nIt works for ${r.days} days.`
    : `Hi ${first}, here is a link to choose a new Brekkie password: ${url}\nIt works for ${r.days} days.`;
  const phone = String(r.phone || '').replace(/\D/g, '');
  return (
    <Modal title={r.kind === 'invite' ? 'Invite link ready' : 'Reset link ready'} onClose={onClose}>
      <p style={{ color: 'var(--mute)', fontSize: 14.5, margin: '6px 0 10px' }}>For {r.name}. It works for {r.days} days{r.kind === 'invite' ? ', and their old personal link stops working' : ''}. Anyone with it can sign in as them, so send it only to them.</p>
      <div className="ad-link">{url}</div>
      <div className="row-btns">
        <Btn kind="ghost" onClick={async () => { try { await navigator.clipboard.writeText(msg); toast('Message copied'); } catch { toast('Copy failed'); } }}>{I.copy} Copy message</Btn>
        {phone
          ? <a className="btn wa" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer" href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`}>{I.send} Open WhatsApp</a>
          : <Btn onClick={onClose}>Done</Btn>}
      </div>
      {!phone && <p className="fine" style={{ margin: '10px 0 0' }}>They have no phone number on file, so copy the message and send it another way.</p>}
    </Modal>
  );
}

function Stuck() {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(true);
  const [qd, setQd] = useState('');
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(0);
  const toast = useToast();
  useEffect(() => { const t = setTimeout(() => setQd(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, reload } = useApi(`/admin/people?stuck=${only ? 1 : 0}&q=${encodeURIComponent(qd)}`);
  const make = async (p) => {
    setBusy(p.id);
    try { setLink(await api(`/admin/people/${p.id}/reset`, { method: 'POST', body: {} })); reload(); } catch (e) { toast(e.message); } finally { setBusy(0); }
  };
  const STATE = { invited: ['Invited, not in yet', 'wait'], never: ['Has a password, never signed in', 'wait'], active: ['Active', 'ok'], none: ['Not invited', ''] };
  return (
    <Card title="People who are stuck" sub="Find anyone, and make them a fresh link to send on WhatsApp.">
      <div className="ad-tools">
        <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, email, phone or club" aria-label="Search people" />
        <button type="button" className={'ad-chip' + (only ? ' on' : '')} onClick={() => setOnly(!only)} aria-pressed={only}>{only ? I.check : null} Stuck only</button>
      </div>
      {error && <p className="err" style={{ margin: '0 28px 14px' }}>{error.message}</p>}
      {data && !data.length && <p className="mb-empty">{only ? 'Nobody is stuck right now.' : 'Nobody matches that.'}</p>}
      <ul className="ad-list">
        {(data || []).map((p) => {
          const [lab, tone] = STATE[p.state];
          return (
            <li key={p.id}>
              <span className="ad-who"><b>{p.name}{p.is_vpe ? ' · VPE' : ''}</b><small>{p.club} · {p.email || 'no email'}{p.phone ? ` · ${p.phone}` : ''}</small></span>
              <span className={'ad-pill ' + tone}>{lab}{p.state === 'invited' && p.invited ? ` ${short(p.invited)}` : ''}</span>
              <Btn sm kind={p.state === 'invited' || p.state === 'never' ? '' : 'ghost'} onClick={() => make(p)} disabled={busy === p.id}>{busy === p.id ? 'Making…' : p.has_pw ? 'Reset link' : 'Invite link'}</Btn>
            </li>
          );
        })}
      </ul>
      {link && <LinkModal r={link} onClose={() => setLink(null)} />}
    </Card>
  );
}

function Clubs() {
  const { data } = useApi('/admin/clubs');
  return (
    <Card title="Enrolled clubs" sub={data ? `${data.length} ${data.length === 1 ? 'club' : 'clubs'} on Brekkie` : ''}>
      <ul className="ad-list">
        {(data || []).map((c) => (
          <li key={c.id} className="ad-club">
            <span className="ad-who"><b>{c.name}</b><small>Club {c.tm_number || 'number not set'} · started {short(c.created)} · VPE {c.vpe || 'none'}{c.vpe_email ? ` (${c.vpe_email})` : ''}</small></span>
            <span className="ad-nums">
              <span><b>{c.members}</b><small>members</small></span>
              <span><b>{c.accounts}</b><small>signed up</small></span>
              <span><b>{c.held}</b><small>meetings</small></span>
              <span><b>{c.speeches}</b><small>speeches</small></span>
              <span><b>{c.sheets}</b><small>sheets</small></span>
              <span><b>{short(c.last_login)}</b><small>last in</small></span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const ADMIN_NAV = [
  { to: '/admin', end: true, label: 'Overview', icon: I.chart },
  { to: '/admin/clubs', label: 'Clubs', icon: I.home },
  { to: '/admin/people', label: 'Stuck', icon: I.ppl },
];

function AdminPage({ title, sub, children }) {
  return (
    <Page root wide full>
      <div className="rpage mb"><div className="mb-in ad-in">
        <div className="rhead"><div>
          <p className="reyebrow">Platform</p>
          <h1 className="rtitle">{title}</h1>
          <p className="rsub">{sub}</p>
        </div></div>
        <div className="mb-stack">{children}</div>
      </div></div>
    </Page>
  );
}

function Overview() {
  const nav = useNavigate();
  const { data: d, error, reload } = useApi('/admin/overview');
  useEffect(() => { if (error) nav('/', { replace: true }); }, [error, nav]);
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t); }, [reload]);
  const s = d?.system, t = d?.totals;
  const healthy = s && s.errors_5xx === 0 && s.db_ms < 1500;
  const days = d?.days || [];
  const maxDay = Math.max(...days.map((x) => x.sheets), 1);
  return (
    <AdminPage title="Overview" sub="How Brekkie is running and who is using it.">
      {!d ? <div className="mb-card"><p className="mb-empty">Loading…</p></div> : (
        <>
          <Card title="System" sub={s.host === 'Vercel' ? 'On Vercel, each server instance starts and stops by itself, so uptime is for the instance that answered.' : 'Running on this computer.'}
                right={<span className={'ad-pill ' + (healthy ? 'ok' : 'bad')}>{healthy ? 'All good' : 'Needs a look'}</span>}>
                <div className="ad-stats">
                  <Stat label="Database" value={`${s.db_ms} ms`} sub={s.db} tone={s.db_ms < 1500 ? '' : 'bad'} />
                  <Stat label="Uptime" value={up(s.up_s)} sub={`since ${new Date(s.started).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`} />
                  <Stat label="Requests" value={s.requests} sub={`${s.avg_ms} ms average, ${s.slow} slow`} />
                  <Stat label="Errors" value={s.errors_5xx} sub={`${s.errors_4xx} rejected (4xx)`} tone={s.errors_5xx ? 'bad' : ''} />
                  <Stat label="Memory" value={`${s.rss_mb} MB`} sub={`${s.heap_mb} MB in use`} />
                  <Stat label="Build" value={s.commit || s.host} sub={[s.branch, s.region, s.node].filter(Boolean).join(' · ')} />
                </div>
                {s.recent_errors.length > 0 && (
                  <div className="ad-errs"><small>Recent server errors</small>
                    {s.recent_errors.map((e, i) => <div key={i}><span>{new Date(e.at).toLocaleTimeString('en-GB')}</span><b>{e.status}</b><code>{e.path}</code><em>{e.ms} ms</em></div>)}
                  </div>
                )}
              </Card>

              <Card title="Usage" sub="Everything across all clubs.">
                <div className="ad-stats">
                  <Stat label="Clubs" value={t.clubs} sub={`${t.clubs_30} new in 30 days`} />
                  <Stat label="Members" value={t.members} sub={`${t.guests} visitors`} />
                  <Stat label="Signed up" value={t.accounts} sub={`${t.invited} invited, not in yet`} />
                  <Stat label="Active" value={t.login_7} sub={`this week · ${t.login_30} this month`} />
                  <Stat label="Meetings" value={t.meetings_held} sub={`${t.meetings_ahead} ahead`} />
                  <Stat label="Speeches evaluated" value={t.evaluations} />
                </div>
              </Card>

              <div className="ad-two">
                <Card title="What gets used" sub="Notes handed in, by role.">
                  {d.sheets_by_role.length ? <Bars rows={d.sheets_by_role.map((r) => [r.role_key, r.n])} label={(k) => ROLE_NAMES[k] || k} color="var(--blue)" /> : <p className="mb-empty">No sheets handed in yet.</p>}
                  <div className="ad-mini">
                    <span><b>{t.sheets}</b> role sheets</span><span><b>{t.plans}</b> speeches planned</span>
                    <span><b>{t.projects_logged}</b> projects logged</span><span><b>{t.levels_logged}</b> levels logged</span><span><b>{t.join_requests}</b> join requests</span>
                  </div>
                </Card>
                <Card title="Last 14 days" sub="Role sheets handed in each day.">
                  <div className="fc-bars ad-days" role="img" aria-label="Role sheets per day, last 14 days">
                    {days.map((x, i) => (
                      <div key={x.day} className={'fc-c' + (i === days.length - 1 ? ' now' : '')} title={`${short(x.day)}: ${x.sheets} sheets, ${x.logins} sign-ins, ${x.clubs} new clubs`}>
                        <em>{x.sheets || ''}</em><i style={{ height: `${Math.max(4, (x.sheets / maxDay) * 100)}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="fc-ax" style={{ padding: '0 28px 20px' }}><span>{short(days[0]?.day)}</span><span>Today</span></div>
                </Card>
              </div>


              {d.log.length > 0 && (
                <Card title="Recent admin actions" sub="Every link made from this page is recorded.">
                  <ul className="ad-list">{d.log.map((l, i) => <li key={i}><span className="ad-who"><b>{l.action} for {l.person || 'someone'}</b><small>by {l.admin || 'admin'} · {new Date(l.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span></li>)}</ul>
                </Card>
              )}

        </>
      )}
    </AdminPage>
  );
}

export default function Admin() {
  const nav = useNavigate();
  const { data: me } = useApi('/session');
  useEffect(() => { if (me && !me.super) nav('/', { replace: true }); }, [me, nav]);
  const home = me?.type === 'vpe' ? '/v' : '/m';
  return (
    <Shell nav={[...ADMIN_NAV, { to: home, label: 'Back to Brekkie', icon: I.back }]} who={me?.person?.name || 'Admin'} tag="ADMIN" sub="Platform" onSignOut={() => { setToken(null); nav('/'); }}>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="clubs" element={<AdminPage title="Clubs" sub="Every club enrolled on Brekkie."><Clubs /></AdminPage>} />
        <Route path="people" element={<AdminPage title="People who are stuck" sub="Find anyone, and make them a fresh link to send on WhatsApp."><Stuck /></AdminPage>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}
