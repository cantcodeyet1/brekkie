import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useNavigate } from 'react-router-dom';

/* ───────── icons ───────── */
const Ic = ({ d, w = 20, s = 1.8, children }) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={s} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children || <path d={d} />}</svg>
);
export const I = {
  back: <Ic w={22} s={2} d="M15 5l-7 7 7 7" />, chev: <Ic w={18} s={2} d="M9 5l7 7-7 7" />, down: <Ic w={16} s={2} d="M6 9l6 6 6-6" />,
  plus: <Ic w={18} s={2} d="M12 5v14M5 12h14" />, minus: <Ic w={16} s={2.2} d="M5 12h14" />, close: <Ic w={14} s={2} d="M6 6l12 12M18 6L6 18" />,
  check: <Ic w={17} s={2.4} d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: <Ic w={17}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></Ic>,
  eye: <Ic w={22} s={1.8}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Ic>,
  eyeoff: <Ic w={22} s={1.8}><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6A17 17 0 002 12s3.6 7 10 7a9.8 9.8 0 004.4-1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></Ic>,
  dl: <Ic w={19} s={2} d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />, send: <Ic w={17} d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />,
  home: <Ic d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z" />,
  doc: <Ic><path d="M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Ic>,
  cal: <Ic><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></Ic>,
  ppl: <Ic><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3.2 3.2 0 010 5.6M18.5 14.8c1.6.8 2.5 2.4 2.5 5.2" /></Ic>,
  mic: <Ic><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></Ic>,
  hash: <Ic d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16" />,
  clock: <Ic><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Ic>,
  search: <Ic w={16} s={2}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Ic>,
  out: <Ic d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9" />,
};

/* ───────── layout state ───────── */
const DeskCtx = createContext(false);
export const useDesk = () => useContext(DeskCtx);
export function DeskProvider({ children }) {
  const mq = '(min-width: 900px)';
  const [d, setD] = useState(() => window.matchMedia(mq).matches);
  useEffect(() => { const m = window.matchMedia(mq); const f = () => setD(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return <DeskCtx.Provider value={d}>{children}</DeskCtx.Provider>;
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('');
  const t = useRef();
  const show = useCallback((m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2200); }, []);
  return <ToastCtx.Provider value={show}>{children}<div className={'toast fixed' + (msg ? ' on' : '')} role="status">{msg}</div></ToastCtx.Provider>;
}

/* ───────── page chrome ───────── */
const ShellCtx = createContext({ nav: [], who: '', onSignOut: null });
export const Wordmark = ({ className = '' }) => <Link to="/start" className={'wm ' + className} aria-label="Brekkie home">Brekkie<i /></Link>;

export function Shell({ nav, who, sub, tag, onSignOut, onAccount, noSide, bare, topNav, children }) {
  const desk = useDesk();
  return (
    <ShellCtx.Provider value={{ nav, who, sub, onSignOut, onAccount, bare }}>
      <div className={'app' + (desk ? ' desk' : '') + (topNav ? ' topnav-app' : '')}>
        {desk && topNav && (
          <header className="topnav">
            <Wordmark />
            <nav>{nav.filter((n) => n.to).map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>{n.icon}{n.label}</NavLink>)}</nav>
            {who && <span className="who"><b>{who}</b>{onAccount && <button type="button" className="lnk" onClick={onAccount}>Account</button>}{onSignOut && <button type="button" className="lnk" onClick={onSignOut}>Sign out</button>}</span>}
          </header>
        )}
        <div className="screen">
          {desk && !noSide && !topNav && (
            <aside className="side">
              <Wordmark />
              {nav.map((it, i) => it.label && !it.to
                ? <div className="sl" key={i}>{it.label}</div>
                : <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'on' : '')} style={{ textDecoration: 'none' }}>{it.icon}{it.label}</NavLink>)}
              <div className="me">
                <div className="me-id"><Avatar name={who} size={38} tone="gold" /><span><b>{who}</b></span>{tag && <em className="role-tag">{tag}</em>}</div>
                {sub && <div className="clubpill" title={sub}>{sub}</div>}
                <div className="me-act">
                  {onAccount && <button type="button" onClick={onAccount}>Account</button>}
                  {onSignOut && <button type="button" onClick={onSignOut}>{I.out}Sign out</button>}
                </div>
              </div>
            </aside>
          )}
          {children}
        </div>
      </div>
    </ShellCtx.Provider>
  );
}

/* One screen. `root` pages show the brand bar and (on phones) the bottom nav; others show a back button. */
export function Page({ title, root, wide, narrow, full, foot, back, onBack, children }) {
  const desk = useDesk();
  const { nav, who, onSignOut, onAccount, bare } = useContext(ShellCtx);
  const go = useNavigate();
  const topBar = !root ? <div className="top"><button className="back" onClick={() => (onBack ? onBack() : back ? go(back) : go(-1))} aria-label="Back">{I.back}</button><span className="ttl" onClick={() => (onBack ? onBack() : back ? go(back) : go(-1))} style={{ cursor: 'pointer' }}>{title}</span>{!desk && <span style={{ marginLeft: 'auto', paddingRight: 10 }}><Wordmark /></span>}</div> : null;
  return (
    <div className="main">
      {bare && desk && <div className="hdr-r"><Wordmark /><span style={{ fontSize: 13, color: 'var(--mute)' }}>Champions Toastmasters Club</span></div>}
      {bare && !desk && root && <div className="brand"><Wordmark /><span className="who">Champions Toastmasters Club</span></div>}
      {!root && !desk && topBar}
      {root && !desk && !bare && <div className="brand"><Wordmark /><span className="who"><b>{who}</b>{onAccount && <button className="lnk" style={{ marginLeft: 10 }} onClick={onAccount}>Account</button>}{onSignOut && <button className="lnk" style={{ marginLeft: 10 }} onClick={onSignOut}>Sign out</button>}</span></div>}
      <div className="scroll"><div className={'in' + (wide ? ' wide' : '') + (narrow ? ' narrow' : '') + (full ? ' full' : '')}>{desk && topBar}{children}</div></div>
      {foot}
      {root && !desk && nav.some((n) => n.to && !n.desktopOnly) && (
        <nav className="nav">
          {nav.filter((n) => n.to && !n.desktopOnly).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')} style={{ textDecoration: 'none', flex: 1, textAlign: 'center' }}>{n.icon}{n.short || n.label}</NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

export const Foot = ({ children, col }) => <div className={'foot' + (col ? ' col' : '')}>{children}</div>;
export const Btn = ({ kind = '', sm, children, ...p }) => <button type="button" className={`btn ${kind} ${sm ? 'sm' : ''}`} {...p}>{children}</button>;
export const Chip = ({ kind = '', children, ...p }) => <span className={'chip ' + kind} {...p}>{children}</span>;
/* a calm shimmering outline of a page, tall enough that the card around it does not jump when the content arrives */
export const Loading = () => (
  <div className="skel" role="status" aria-label="Loading">
    <i className="h" /><i className="p" /><i className="p s" />
    <div className="g"><i /><i /><i /></div>
    <div className="g"><i /><i /><i /></div>
  </div>
);
export const ErrorMsg = ({ error }) => <p className="err" style={{ marginTop: 24 }}>{error?.message || 'Something went wrong'}</p>;
export const Meter = ({ v }) => <span className="meter"><i className={v < 3 ? 'lo' : v < 4 ? 'mid' : 'hi'} style={{ width: `${(v / 5) * 100}%` }} /></span>;

export function Seg({ value, onChange, options, className = '', style }) {
  return (
    <div className={'seg ' + className} role="tablist" style={style}>
      {options.map(([v, l]) => <button type="button" key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Modal({ title, children, onClose, wide }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}><h3>{title}</h3>{children}</div>
    </div>, document.body);
}

/* ───────── brand dropdown ─────────
   Replaces every native <select>. White card, hairline border, Loyal Blue selection with a Happy Yellow marker,
   type-to-search on long lists, full keyboard support. */
/* the small yellow G that marks a visitor, used everywhere except the agenda */
export const GBadge = () => <span className="gb" title="Visitor" aria-label="Visitor">V</span>;

export function Select({ value, onChange, options, placeholder = 'Select', sm, disabled, searchable, addLabel, onAdd, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const [qy, setQy] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(), pop = useRef();
  const showSearch = searchable ?? options.length > 8;
  const list = useMemo(() => options.filter((o) => !qy || o.label.toLowerCase().includes(qy.toLowerCase())), [options, qy]);
  const items = [...list, ...(onAdd ? [{ value: '__add', label: addLabel || '+ Add new…', add: true }] : [])];
  const cur = options.find((o) => String(o.value) === String(value));

  const openIt = () => {
    if (disabled) return;
    const r = btn.current.getBoundingClientRect(), below = window.innerHeight - r.bottom - 14, above = r.top - 14;
    const want = Math.min(320, (options.length + 1) * 40 + 16 + (showSearch ? 48 : 0));
    const up = below < want && above > below;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8)), width: Math.max(r.width, 220), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), maxHeight: Math.max(150, Math.min(320, up ? above : below)) });
    setQy(''); setHi(Math.max(0, options.findIndex((o) => String(o.value) === String(value)))); setOpen(true);
  };
  const close = useCallback((refocus) => { setOpen(false); if (refocus) btn.current?.focus(); }, []);
  const pick = (o) => { close(true); if (o.add) onAdd?.(); else onChange(o.value); };

  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) close(false); };
    const away = (e) => { if (!pop.current?.contains(e.target)) close(false); };
    document.addEventListener('mousedown', down); window.addEventListener('resize', away); window.addEventListener('scroll', away, true);
    (pop.current?.querySelector('input') || pop.current)?.focus({ preventScroll: true });
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); };
  }, [open, close]);
  useEffect(() => { pop.current?.querySelector('.hi')?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);

  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(items.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0); } else if (e.key === 'End') { e.preventDefault(); setHi(items.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); items[hi] && pick(items[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
  };
  const id = useRef('sel' + Math.random().toString(36).slice(2, 7)).current;

  return (
    <div className={'sel ' + className}>
      <button type="button" ref={btn} className={'inp selbtn' + (sm ? ' sm' : '') + (cur ? '' : ' todo')} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => (open ? close(false) : openIt())}
        onKeyDown={(e) => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openIt(); } }}>
        <span className="v">{cur ? <><span className="nm">{cur.label}</span>{cur.guest && <GBadge />}</> : <span className="sph">{placeholder}</span>}</span>{I.down}
      </button>
      {open && createPortal(
        <div ref={pop} className="sel-pop" style={pos} role="listbox" id={id} tabIndex={-1} onKeyDown={key}>
          {showSearch && <input className="sel-q" placeholder="Search" value={qy} onChange={(e) => { setQy(e.target.value); setHi(0); }} aria-label="Search options" />}
          {!items.length && <div className="sel-empty">No matches</div>}
          {items.map((o, i) => (
            <div key={String(o.value)} role="option" aria-selected={!o.add && String(o.value) === String(value)}
              className={'sel-opt' + (i === hi ? ' hi' : '') + (!o.add && String(o.value) === String(value) ? ' on' : '') + (o.add ? ' add' : '')}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              <span className="t">{o.label}{o.guest && <GBadge />}{o.sub && <small>{o.sub}</small>}</span>
            </div>
          ))}
        </div>, document.body)}
    </div>
  );
}

/* A date picker in the Brekkie look (the browser's own calendar cannot be styled). Value is YYYY-MM-DD. */
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function DatePick({ value, onChange, sm, bare, label, id, placeholder = 'Pick a date', className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [shown, setShown] = useState(() => (value ? new Date(value + 'T12:00:00') : new Date()));
  const btn = useRef(), pop = useRef();
  const cur = value ? new Date(value + 'T12:00:00') : null;
  const today = isoOf(new Date());
  const openIt = () => {
    const r = btn.current.getBoundingClientRect(), w = 304, h = 372;
    const up = window.innerHeight - r.bottom < h && r.top > window.innerHeight - r.bottom;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    setShown(cur ? new Date(cur) : new Date()); setOpen(true);
  };
  const close = useCallback((refocus) => { setOpen(false); if (refocus) btn.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) close(false); };
    const away = (e) => { if (!pop.current?.contains(e.target)) close(false); };
    const esc = (e) => { if (e.key === 'Escape') close(true); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', esc); window.addEventListener('resize', away); window.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); };
  }, [open, close]);
  const y = shown.getFullYear(), m = shown.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;                 // Monday first
  const days = Array.from({ length: 42 }, (_, i) => new Date(y, m, 1 - lead + i));
  const step = (n) => setShown(new Date(y, m + n, 1));
  const pick = (d) => { onChange(isoOf(d)); close(true); };
  const text = cur ? cur.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : null;
  return (
    <div className={'sel dp ' + className}>
      <button type="button" id={id} ref={btn} className={(bare ? 'dpbare' : 'inp selbtn' + (sm ? ' sm' : '')) + (cur ? '' : ' todo')} aria-haspopup="dialog" aria-expanded={open} aria-label={label}
        onClick={() => (open ? close(false) : openIt())}>
        <span className="v">{text ? <span className="nm">{text}</span> : <span className="sph">{placeholder}</span>}</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
      </button>
      {open && createPortal(
        <div ref={pop} className="dp-pop" style={pos} role="dialog" aria-label="Choose a date">
          <div className="dp-h">
            <button type="button" className="dp-n" onClick={() => step(-1)} aria-label="Previous month">{I.back}</button>
            <b>{MONTHS[m]} {y}</b>
            <button type="button" className="dp-n" onClick={() => step(1)} aria-label="Next month">{I.chev}</button>
          </div>
          <div className="dp-g dp-w">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d}>{d}</span>)}</div>
          <div className="dp-g">
            {days.map((d) => {
              const iso = isoOf(d);
              return <button type="button" key={iso} className={'dp-d' + (d.getMonth() !== m ? ' out' : '') + (iso === value ? ' on' : '') + (iso === today ? ' today' : '')} onClick={() => pick(d)} aria-label={d.toDateString()} aria-pressed={iso === value}>{d.getDate()}</button>;
            })}
          </div>
          <div className="dp-f"><button type="button" onClick={() => pick(new Date())}>Today</button></div>
        </div>, document.body)}
    </div>
  );
}

/* A person picker that can also add a visitor on the spot. Visitors are stored under the club (temporary status). */
export function PersonSelect({ value, onChange, people, onAddGuest, placeholder = 'Who is this about?', sm, exclude = [], allowClear }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const opts = [...(allowClear && value ? [{ value: '__none', label: 'Unassigned' }] : []), ...[...people].filter((p) => !exclude.includes(p.id)).sort((a, b) => (a.kind === 'guest') - (b.kind === 'guest') || a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name, guest: p.kind === 'guest' }))];
  const add = async () => {
    if (name.trim().length < 2) { setErr('Enter a name'); return; }
    setBusy(true); setErr('');
    try { const g = await onAddGuest(name.trim()); onChange(g.id); setAdding(false); setName(''); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <Select value={value} onChange={(v) => onChange(v === '__none' ? null : v)} options={opts} placeholder={placeholder} sm={sm} searchable={opts.length > 8}
        onAdd={onAddGuest ? () => setAdding(true) : undefined} addLabel="+ Add a visitor" />
      {adding && (
        <div className="addname">
          <input className="inp" autoFocus placeholder="Full name of the visitor" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Visitor name" />
          <Btn sm onClick={add} disabled={busy}>Add</Btn>
          <button type="button" className="x" onClick={() => { setAdding(false); setErr(''); }} aria-label="Cancel">{I.close}</button>
        </div>
      )}
      {adding && <p className="s" style={{ margin: '6px 2px 0', fontSize: 13, color: 'var(--mute)' }}>Visitors get temporary access. Their notes still count as Champions data.</p>}
      {err && <p className="err">{err}</p>}
    </>
  );
}

/* the word-of-the-day card */
export function Wcard({ m }) {
  if (!m?.word) return <div className="wcard"><p style={{ color: 'var(--mute)', margin: 0 }}>No word set yet.</p></div>;
  return (
    <div className="wcard">
      <h3>{m.word} {m.pos && <i>({m.pos})</i>}</h3>
      <div className="pr">{m.pron}</div>
      <p><b>Meaning:</b> {m.meaning}</p>
      {m.example && <p className="ex">Example: {m.example}</p>}
      <p><b>Synonyms:</b><br /><span className="syn">{m.synonyms}</span></p>
      {m.origin && <p><b>Origin:</b> {m.origin}</p>}
    </div>
  );
}

export function useDebouncedSave(fn, deps, ms = 800, skipFirst = true) {
  const first = useRef(true);
  useEffect(() => {
    if (skipFirst && first.current) { first.current = false; return; }
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const copyText = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };

/* Path, then level, then project, from the Pathways catalog. Each choice narrows the next, and a half-finished
   choice is remembered. onChange receives { project_id, path_name, path_level }. */
export function ProjectPicker({ catalog, value, pathName, level, onChange }) {
  const [path, setPath] = useState(pathName || '');
  const [lv, setLv] = useState(level ?? '');
  useEffect(() => { setPath(pathName || ''); setLv(level ?? ''); }, [pathName, level]);
  const P = catalog.find((p) => p.name === path);
  const L = P?.levels.find((l) => l.level === lv);
  const req = L?.projects.filter((p) => p.kind === 'required') || [], opt = L?.projects.filter((p) => p.kind === 'elective') || [];
  return (
    <div className="ppick">
      <Select sm value={path} placeholder="Path" searchable={false} options={catalog.map((p) => ({ value: p.name, label: p.name }))}
        onChange={(v) => { setPath(v); setLv(''); onChange({ project_id: null, path_name: v, path_level: null }); }} />
      <div className="two">
        <Select sm value={lv} placeholder="Level" disabled={!P} options={(P?.levels || []).map((l) => ({ value: l.level, label: `Level ${l.level}`, sub: l.title }))}
          onChange={(v) => { setLv(v); onChange({ project_id: null, path_name: path, path_level: v }); }} />
        <Select sm value={value} placeholder="Project" disabled={!L} searchable={(L?.projects.length || 0) > 8}
          options={[...req.map((p) => ({ value: p.id, label: `${p.code} ${p.name}`, sub: 'Required' })), ...opt.map((p) => ({ value: p.id, label: p.name, sub: L.choose ? `Elective, choose ${L.choose}` : 'Elective' }))]}
          onChange={(v) => onChange({ project_id: v, path_name: path, path_level: lv })} />
      </div>
    </div>
  );
}

/* Just the path and level, for a member's own profile. onChange receives { path_name, path_level }. */
export function PathPick({ catalog, pathName, level, onChange }) {
  const P = catalog.find((p) => p.name === pathName);
  return (
    <div className="ppick">
      <Select sm value={pathName || ''} placeholder="Path" searchable={false} options={[...(pathName ? [{ value: '__none', label: 'No path set' }] : []), ...catalog.map((p) => ({ value: p.name, label: p.name }))]}
        onChange={(v) => onChange(v === '__none' ? { path_name: null, path_level: null } : { path_name: v, path_level: v === pathName ? level ?? null : null })} />
      <Select sm value={level ?? ''} placeholder="Level" disabled={!P} options={(P?.levels || []).map((l) => ({ value: l.level, label: `Level ${l.level}`, sub: l.title }))}
        onChange={(v) => onChange({ path_name: pathName, path_level: v })} />
    </div>
  );
}

/* A person's initials on a brand-coloured circle. The colour follows the name, so it is the same everywhere. */
const TONES = ['blue', 'maroon', 'gold'];
export function Avatar({ name = '', size = 40, tone }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const t = tone || TONES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];
  return <span className={'av av-' + t} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">{initials}</span>;
}
