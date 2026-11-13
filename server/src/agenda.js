// Agenda builder. Fills the club's own Word template (server/templates/agenda.docx), so the output keeps
// the club's layout, mission, officers and banner exactly as designed. Only the meeting-specific parts change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { q } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(here, '..', 'templates', 'agenda.docx');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ───────── the running order ─────────
   A meeting agenda is an ordered list of blocks. The prepared speeches are one block (a row per speaker, added
   from the roster). Everything else is an item with a title, a length, an owner and, optionally, a fixed start time.
   Times are worked out from the start time, so moving or removing a block moves everything after it. */
export const STD_BLOCKS = [
  { id: 'call', type: 'item', title: 'Meeting Called To Order', min: 1, owner: 'SAA' },
  { id: 'welcome', type: 'item', title: 'Welcome', min: 5, owner: 'Chairperson' },
  { id: 'toast', type: 'item', title: 'Toast', min: 5, owner: 'TMOD' },
  { id: 'intro', type: 'item', title: 'Introduction of Role Takers', min: 5, owner: 'General Evaluator' },
  { id: 'speeches', type: 'speeches', title: 'Prepared Speeches' },
  { id: 'topics', type: 'item', title: 'Table Topics', min: 20, owner: 'Table Topics Master' },
  { id: 'evals', type: 'item', title: 'Speech Evaluations', min: 10, owner: 'General Evaluator' },
  { id: 'reports', type: 'reports', title: 'Top Table Reports', min: 10, owner: 'General Evaluator' },
  { id: 'tmod', type: 'item', title: 'TMOD Final Remarks', min: 5, owner: 'TMOD' },
  { id: 'business', type: 'item', title: 'Club Business', min: 5, owner: 'Chairperson' },
  { id: 'adjourn', type: 'item', title: 'Meeting Adjourned', min: 0, owner: '' },
];
/** things the VPE can add that are not already in the order (the standard blocks come back by name) */
export const EXTRAS = [
  { kind: 'educational', label: 'Educational', block: { type: 'item', title: 'Educational Session', min: 15, owner: '', topic: '' } },
  { kind: 'break', label: 'Break', block: { type: 'item', title: 'Break', min: 5, owner: '' } },
  { kind: 'custom', label: 'Your own item', block: { type: 'item', title: '', min: 5, owner: '' } },
];
const REPORTS = [['Grammarian', 3], ['Ah Counter', 1], ['Timer', 1], ['General Evaluator', 3]];
const TYPES = new Set(['item', 'speeches', 'reports']);
const DEFAULTS = { start: '1800', buffer: 3, gap: 1, chair: '', end: '' };
const toMin = (t) => (+String(t).slice(0, 2)) * 60 + (+String(t).slice(2));
const hhmm = (start, plus = 0) => {
  const s = String(start || '1800').replace(':', '').padStart(4, '0');
  const t = toMin(s) + plus;
  return String(Math.floor(t / 60) % 24).padStart(2, '0') + String(((t % 60) + 60) % 60).padStart(2, '0');
};
const okTime = (t) => /^([01]\d|2[0-3])[0-5]\d$/.test(String(t || ''));
const withCred = (name, cred) => (name ? (cred ? `${name}, ${cred}` : name) : '');
const lengthText = (t) => String(t || '').replace(/–/g, ' - ').replace(/\s*minutes?/i, ' min').replace(/\s+/g, ' ').trim();
/** the longest a speech may run, in minutes, from text such as "5 - 7 min" or "10 – 12 minutes" */
export const maxMinutes = (t) => { const n = (String(t || '').match(/\d+/g) || []).map(Number); return n.length ? Math.max(...n) : 7; };
const num = (v, lo, hi, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
const clone = (x) => JSON.parse(JSON.stringify(x));

export async function loadContext(meetingId, clubId) {
  const [m] = await q(`select id, number, to_char(date,'YYYY-MM-DD') as date, theme, theme_quote, theme_quote_by, word, pos, pron, meaning, example, synonyms, origin, agenda, feedback_code
    from meetings where id=$1 and club_id=$2`, [meetingId, clubId]);
  if (!m) return null;
  const roles = await q(`select r.id, r.role_key, r.label, r.position, r.target_role_id, r.speech_title, p.name, p.credential, pr.name as project, r.path_name as path, r.path_level as level, (select pp.pos from path_projects pp where pp.path=r.path_name and pp.level=r.path_level and pp.project_id=r.project_id) as pos, (select pp.kind from path_projects pp where pp.path=r.path_name and pp.level=r.path_level and pp.project_id=r.project_id) as pkind, pr.length_text
    from meeting_roles r left join people p on p.id=r.person_id left join projects pr on pr.id=r.project_id where r.meeting_id=$1 order by r.position`, [m.id]);
  const [next] = await q(`select to_char(date,'YYYY-MM-DD') as date from meetings where club_id=$1 and number > $2 order by number limit 1`, [clubId, m.number]);
  const [club] = await q('select name, agenda_default, tm_number, agenda_profile from clubs where id=$1', [clubId]);
  let standard = {};
  try { standard = club?.agenda_default ? JSON.parse(club.agenda_default) : {}; } catch { standard = {}; }
  return { m, roles, next: next?.date || null, standard, clubNumber: club?.tm_number || '', clubName: club?.name || '', profile: club?.agenda_profile || null };
}

/** one block, cleaned up: unknown fields are dropped and every value is kept to a sensible size */
export function cleanBlock(b) {
  if (!b || typeof b !== 'object' || !TYPES.has(b.type)) return null;
  const id = String(b.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (!id) return null;
  const out = { id, type: b.type, title: String(b.title ?? '').slice(0, 80) };
  if (b.type !== 'speeches') {
    out.min = num(b.min, 0, 180, 5);
    out.owner = String(b.owner ?? '').slice(0, 60);
    if (b.topic) out.topic = String(b.topic).slice(0, 140);
    if (okTime(b.at)) out.at = String(b.at);
  }
  return out;
}
/** a whole running order: at most one speeches block and one reports block, no repeated ids, at most 30 blocks */
export function cleanBlocks(list) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const b = cleanBlock(raw);
    if (!b || seen.has(b.id) || (b.type !== 'item' && out.some((x) => x.type === b.type))) continue;
    seen.add(b.id); out.push(b);
    if (out.length >= 30) break;
  }
  return out;
}
const blocksKey = (list) => JSON.stringify(cleanBlocks(list));

/** The club standard laid over the built-in one; the speeches are filled in from the roster. */
export function defaultAgenda({ m, roles, next, standard = {} }, startTime) {
  const base = { ...DEFAULTS, ...pickConfig(standard) };
  const start = /^\d{4}$/.test(startTime || '') ? startTime : base.start;
  const nameOf = (key) => { const r = roles.find((x) => x.role_key === key); return r?.name ? withCred(r.name, r.credential) : ''; };
  const speeches = roles.filter((r) => r.role_key === 'speaker' && r.name).map((s) => {
    const ev = roles.find((r) => r.role_key === 'evaluator' && r.target_role_id === s.id && r.name);
    return {
      role_id: s.id, time: '', name: withCred(s.name, s.credential),
      project_line: s.project ? `${s.path || 'Presentation Mastery'}${s.level && s.pos ? (s.pkind === 'elective' ? ` (L${s.level} elective)` : ` (L${s.level}P${s.pos})`) : ''}` : 'Project to be confirmed',
      project_name: s.project || '', title: s.speech_title || '', length: s.project ? lengthText(s.length_text) : '', evaluator: ev ? withCred(ev.name, ev.credential) : '',
    };
  });
  const d = next || (() => { const x = new Date(m.date + 'T12:00:00'); x.setDate(x.getDate() + 7); return x.toISOString().slice(0, 10); })();
  const blocks = cleanBlocks(base.blocks?.length ? base.blocks : STD_BLOCKS);
  return {
    start, next_meeting: d, buffer: base.buffer, gap: base.gap, chair: base.chair, end: base.end,
    roles: { tmod: nameOf('toastmaster'), ge: nameOf('general_evaluator'), grammarian: nameOf('grammarian'), ah: nameOf('ah_counter'), timer: nameOf('timer'), ttm: nameOf('topicsmaster') },
    blocks: blocks.length ? blocks : clone(STD_BLOCKS),
    speeches,
    reports: { items: REPORTS.map(([role, min]) => ({ role, min: `${min} min` })) },
  };
}
/** what a club standard may hold: the shape of the running order, not who or when */
export function pickConfig(c = {}) {
  const out = {};
  if (okTime(c.start)) out.start = c.start;
  if (c.buffer !== undefined) out.buffer = num(c.buffer, 0, 20, DEFAULTS.buffer);
  if (c.gap !== undefined) out.gap = num(c.gap, 0, 10, DEFAULTS.gap);
  if (typeof c.chair === 'string') out.chair = c.chair.slice(0, 60);
  if (c.end === '' || okTime(c.end)) out.end = c.end || '';
  const blocks = cleanBlocks(c.blocks).map(({ at, ...r }) => r);
  if (blocks.length) out.blocks = blocks;
  return out;
}

/** Saved meeting changes over the default. The older format (opening and closing rows by position) still reads. */
export function mergeAgenda(def, saved = {}) {
  const out = clone(def);
  for (const k of ['start', 'next_meeting']) if (saved[k]) out[k] = saved[k];
  if (saved.buffer !== undefined) out.buffer = num(saved.buffer, 0, 20, out.buffer);
  if (saved.gap !== undefined) out.gap = num(saved.gap, 0, 10, out.gap);
  if (typeof saved.chair === 'string') out.chair = saved.chair.slice(0, 60);
  if (saved.end !== undefined) out.end = okTime(saved.end) ? saved.end : '';
  const blocks = cleanBlocks(saved.blocks);
  if (blocks.length) out.blocks = blocks;
  else {
    const ids = { opening: ['call', 'welcome', 'toast', 'intro'], closing: ['topics', 'evals', 'reports', 'tmod', 'business', 'adjourn'] };
    for (const k of ['opening', 'closing']) (saved[k] || []).forEach((it, i) => {
      const b = out.blocks.find((x) => x.id === ids[k][i]); if (!b || !it) return;
      if (it.title) b.title = String(it.title).slice(0, 80);
      if (it.owner !== undefined) b.owner = String(it.owner).slice(0, 60);
      if (it.min) b.min = parseInt(it.min, 10) || b.min;
    });
  }
  if (saved.reports?.items) saved.reports.items.forEach((it, i) => { if (it && out.reports.items[i] && it.min) Object.assign(out.reports.items[i], { min: it.min }); });
  if (saved.speeches) out.speeches.forEach((s) => { if (saved.speeches[s.role_id]) { const { time, ...rest } = saved.speeches[s.role_id]; Object.assign(s, rest); } });
  return schedule(out);
}

export function diffAgenda(def, edited) {
  const saved = {};
  for (const k of ['start', 'next_meeting']) if (edited[k] && edited[k] !== def[k]) saved[k] = edited[k];
  if (edited.buffer !== undefined && num(edited.buffer, 0, 20, def.buffer) !== def.buffer) saved.buffer = num(edited.buffer, 0, 20, def.buffer);
  if (edited.gap !== undefined && num(edited.gap, 0, 10, def.gap) !== def.gap) saved.gap = num(edited.gap, 0, 10, def.gap);
  if (typeof edited.chair === 'string' && edited.chair !== def.chair) saved.chair = edited.chair.slice(0, 60);
  if (edited.end !== undefined && (okTime(edited.end) ? edited.end : '') !== def.end) saved.end = okTime(edited.end) ? edited.end : '';
  if (Array.isArray(edited.blocks) && blocksKey(edited.blocks) !== blocksKey(def.blocks)) saved.blocks = cleanBlocks(edited.blocks);
  const ri = (edited.reports?.items || []).map((it, i) => (it && def.reports.items[i] && String(it.min) !== def.reports.items[i].min ? { min: String(it.min).slice(0, 12) } : {}));
  if (ri.some((x) => Object.keys(x).length)) saved.reports = { items: ri };
  const sp = {};
  for (const s of edited.speeches || []) {
    const d = def.speeches.find((x) => x.role_id === s.role_id); if (!d) continue;
    const ch = Object.fromEntries(Object.entries(s).filter(([f, v]) => ['name', 'project_line', 'project_name', 'title', 'length', 'evaluator'].includes(f) && String(v ?? '') !== String(d[f] ?? '')).map(([f, v]) => [f, String(v ?? '').slice(0, 140)]));
    if (Object.keys(ch).length) sp[s.role_id] = ch;
  }
  if (Object.keys(sp).length) saved.speeches = sp;
  return saved;
}

/** Work out every start time. A fixed time ("at") on a block restarts the clock there. */
export function schedule(ag) {
  let t = toMin(okTime(ag.start) ? ag.start : '1800');
  const gap = num(ag.gap, 0, 10, 1), buffer = num(ag.buffer, 0, 20, 3);
  for (const b of ag.blocks) {
    if (b.at && okTime(b.at)) t = toMin(b.at);
    b.time = hhmm('0000', t);
    if (b.type === 'speeches') for (const s of ag.speeches) { s.time = hhmm('0000', t); s.slot = maxMinutes(s.length) + buffer; t += s.slot; }
    else t += (b.min || 0) + gap;
  }
  const last = ag.blocks.at(-1);
  ag.ends = last && last.type !== 'speeches' && !last.min ? last.time : hhmm('0000', t - gap);
  ag.over = okTime(ag.end) ? toMin(ag.ends) - toMin(ag.end) : null;
  return ag;
}

/* ───────── the page as plain data: the Word file and the PDF are both drawn from this ───────── */
export function planOf(ag, ctx) {
  const { m } = ctx, d = new Date(m.date + 'T12:00:00'), nd = new Date(ag.next_meeting + 'T12:00:00');
  const chair = String(ag.chair || '').trim();
  const row = (b) => ({ ...b, min: b.min ? `${b.min} min` : '', owner: b.owner === 'Chairperson' && chair ? chair : b.owner });
  const at = ag.blocks.findIndex((b) => b.type === 'speeches');
  return {
    date: `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    theme: m.theme || '',
    quote: m.theme_quote ? `“${m.theme_quote.replace(/^[“"]|[”"]$/g, '')}”${m.theme_quote_by ? ` - ${m.theme_quote_by}` : ''}` : '',
    next: { month: MONTHS[nd.getMonth()], day: nd.getDate(), ord: ordinal(nd.getDate()), year: nd.getFullYear() },
    word: m.word ? { word: m.word.toUpperCase(), pos: m.pos ? `(${m.pos})` : '', pron: m.pron || '', meaning: m.meaning || '', example: m.example ? `Example: ${m.example}` : '', synonyms: m.synonyms || '', origin: m.origin || '' } : null,
    roles: ag.roles,
    before: (at < 0 ? ag.blocks : ag.blocks.slice(0, at)).map(row),
    speeches: at < 0 ? null : ag.speeches,
    after: at < 0 ? [] : ag.blocks.slice(at + 1).map(row),
    reports: ag.reports,
  };
}

/* ───────── fill the template ───────── */
export const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
export const elems = (node, tag) => Array.from(node.getElementsByTagName(tag));

export function setTextNode(t, text) {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument.createTextNode(text));
  t.setAttribute('xml:space', 'preserve');
}
export function setRunText(run, text) {
  let t = elems(run, 'w:t')[0];
  if (!t) { t = run.ownerDocument.createElement('w:t'); run.appendChild(t); }
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(run.ownerDocument.createTextNode(text));
  t.setAttribute('xml:space', 'preserve');
}
export const runsOf = (p) => elems(p, 'w:r');
/** Put `text` in the paragraph's first text run and empty the rest, keeping the first run's formatting. */
export function setPara(p, text) {
  const runs = runsOf(p);
  if (!runs.length) return;
  const first = runs.find((r) => elems(r, 'w:t').length) || runs[0];
  runs.forEach((r) => { if (r !== first && elems(r, 'w:t').length) setRunText(r, ''); });
  setRunText(first, text);
}
export const cellsOf = (tr) => elems(tr, 'w:tc').filter((tc) => tc.parentNode === tr);
export const rowsOf = (tbl) => elems(tbl, 'w:tr').filter((tr) => tr.parentNode === tbl);
export const parasOf = (tc) => elems(tc, 'w:p');

/** Drop the bold, colour and size from a cloned paragraph so a second line reads as a quieter note under the title. */
export function quiet(p) {
  elems(p, 'w:rPr').forEach((rp) => {
    elems(rp, 'w:b').forEach((x) => rp.removeChild(x));
    elems(rp, 'w:color').forEach((x) => rp.removeChild(x));
    elems(rp, 'w:sz').forEach((x) => x.setAttribute('w:val', '18'));
    if (!elems(rp, 'w:i').length) rp.appendChild(rp.ownerDocument.createElement('w:i'));
  });
}
const blankRuns = (p) => runsOf(p).forEach((r) => elems(r, 'w:t').forEach((t) => setTextNode(t, '')));

/**
 * opts.base: draw the page without anything that changes from meeting to meeting, and leave a gap (in points)
 * where the running order goes. The PDF is drawn on top of that (see agendaPdf.js).
 */
export async function buildDocx(ag, ctx, opts = {}) {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const P = elems(doc, 'w:p');                 // document-order paragraph index, as in the template
  const T = elems(doc, 'w:tbl');
  const plan = planOf(ag, ctx);
  const base = opts.base;

  // the club number in the banner is the club's own (blank when none is set)
  const cn = elems(doc, 'w:t').find((t) => /^Club Number:/.test(t.textContent));
  if (cn && !base) setTextNode(cn, ctx.clubNumber ? `Club Number: ${ctx.clubNumber}` : '');

  // heading block
  const cap = P.find((p) => elems(p, 'w:t').map((t) => t.textContent).join('').trim() === 'Prepared Speeches');
  if (cap && (base || !plan.speeches)) blankRuns(cap);
  setRunText(runsOf(P[8])[0], base ? '' : `${plan.date} `);
  const th = runsOf(P[9]);
  setRunText(th[0], base ? '' : 'Theme:');
  setRunText(th[1], base ? '' : ` ${plan.theme}`);
  setRunText(th[2], base || !plan.quote ? '' : 'Quotation:');
  setRunText(th[3], base || !plan.quote ? '' : ` ${plan.quote}`);

  // next meeting date (left panel). The "th" is its own superscript run.
  const nr = runsOf(P[43]);
  if (base) nr.forEach((r) => elems(r, 'w:t').forEach((t) => setTextNode(t, '')));
  else { setRunText(nr[0], `${plan.next.month} ${plan.next.day}`); setRunText(nr[1], plan.next.ord); setRunText(nr[2], `, ${plan.next.year}`); }

  // word of the day
  if (base) [45, 46, 47, 48, 49, 50].forEach((i) => blankRuns(P[i]));
  else {
    const w = plan.word || { word: '', pos: '', pron: '', meaning: '', example: '', synonyms: '', origin: '' };
    const wr = runsOf(P[45]);
    setRunText(wr[0], w.word);
    // this run holds two text nodes with a line break between them: "(adj.)" then the pronunciation
    const wt = elems(wr[2], 'w:t');
    if (wt[0]) setTextNode(wt[0], w.pos);
    if (wt[1]) setTextNode(wt[1], plan.word ? `${w.pron} ` : '');
    setRunText(wr[7], w.meaning);
    setPara(P[47], w.example);
    setPara(P[50], w.synonyms);
    // origin of the word, under the synonyms: same label and text styling as them
    if (w.origin) {
      const lab = P[49].cloneNode(true), txt = P[50].cloneNode(true);
      [lab, txt].forEach((n) => { n.removeAttribute('w14:paraId'); });
      setPara(lab, 'Origin:'); setPara(txt, w.origin);
      const cell = P[50].parentNode, after = P[50].nextSibling;
      cell.insertBefore(lab, after); cell.insertBefore(txt, after);
    }
  }

  // roles table (3 rows x 4 cells: label, name, label, name)
  const rr = rowsOf(T[2]).map(cellsOf);
  const R = base ? {} : ag.roles;
  [[0, 1, R.tmod], [0, 3, R.ge], [1, 1, R.grammarian], [1, 3, R.ah], [2, 1, R.timer], [2, 3, R.ttm]].forEach(([r, c, v]) => setPara(parasOf(rr[r][c])[0], v || ''));
  // the template shrinks long names by hand; give every name the same type size so they read evenly
  const modelRun = runsOf(parasOf(rr[0][1])[0])[0], modelPr = elems(modelRun, 'w:rPr')[0];
  if (modelPr) [[0, 3], [1, 1], [1, 3], [2, 1], [2, 3]].forEach(([r, c]) => {
    const run = runsOf(parasOf(rr[r][c])[0]).find((x) => elems(x, 'w:t').length); if (!run) return;
    elems(run, 'w:rPr').filter((x) => x.parentNode === run).forEach((x) => run.removeChild(x));
    run.insertBefore(modelPr.cloneNode(true), run.firstChild);
  });

  // the running order: three tables in the template (before the speeches, the speeches, after them)
  const T3 = T[3], T4 = T[4], T5 = T[5];
  const simple = rowsOf(T3)[1].cloneNode(true), reportsRow = rowsOf(T5)[2].cloneNode(true);
  const speechModel = rowsOf(T4)[2].cloneNode(true);
  [simple, reportsRow, speechModel].forEach((r) => elems(r, 'w:trHeight').forEach((h) => h.parentNode.removeChild(h)));
  const fillItem = (it) => {
    const tr = simple.cloneNode(true), c = cellsOf(tr);
    setPara(parasOf(c[0])[0], it.time || ''); setPara(parasOf(c[1])[0], it.title || ''); setPara(parasOf(c[2])[0], it.min || ''); setPara(parasOf(c[3])[0], it.owner || '');
    if (it.topic) { const tp = parasOf(c[1])[0], n = tp.cloneNode(true); setPara(n, it.topic); quiet(n); tp.parentNode.insertBefore(n, tp.nextSibling); }
    return tr;
  };
  const fillReports = (it) => {
    const tr = reportsRow.cloneNode(true), c = cellsOf(tr), items = ag.reports.items;
    setPara(parasOf(c[0])[0], it.time || '');
    // title paragraph keeps its line break; the role names follow on their own lines
    const tp = parasOf(c[1]); const t0 = runsOf(tp[0]); setRunText(t0[0], it.title || 'Top Table Reports'); setRunText(t0[1], items[0].role);
    [1, 2, 3].forEach((k) => setPara(tp[k], items[k].role));
    const dp = parasOf(c[2]); const d0 = runsOf(dp[0]); setRunText(d0[0], it.min || ''); setRunText(d0[1], items[0].min);
    [1, 2, 3].forEach((k) => setPara(dp[k], items[k].min));
    setPara(parasOf(c[3])[0], it.owner || '');
    return tr;
  };
  const fillTable = (tbl, list) => {
    rowsOf(tbl).forEach((tr) => tbl.removeChild(tr));
    list.forEach((it) => tbl.appendChild(it.type === 'reports' ? fillReports(it) : fillItem(it)));
  };
  const drop = (tbl) => tbl.parentNode.removeChild(tbl);

  if (base) {
    // a blank stretch where the running order goes: one empty paragraph of exact height in place of the three tables
    const gap = doc.createElement('w:p');
    const ppr = doc.createElement('w:pPr'), sp = doc.createElement('w:spacing');
    sp.setAttribute('w:before', '0'); sp.setAttribute('w:after', '0'); sp.setAttribute('w:line', String(Math.round(base * 20))); sp.setAttribute('w:lineRule', 'exact');
    ppr.appendChild(sp); gap.appendChild(ppr);
    T3.parentNode.insertBefore(gap, T3);
    [T3, T4, T5].forEach(drop);
  } else {
    if (plan.before.length) fillTable(T3, plan.before); else drop(T3);
    if (plan.after.length) fillTable(T5, plan.after); else drop(T5);
    if (plan.speeches) {
      // prepared speeches: one row per speaker (the template's second row is the model)
      rowsOf(T4).slice(1).forEach((tr) => T4.removeChild(tr));
      const list = plan.speeches.length ? plan.speeches : [{ time: '', name: '', project_line: '', project_name: '', title: '', length: '', evaluator: '' }];
      list.forEach((s, idx) => {
        const tr = speechModel.cloneNode(true); T4.appendChild(tr);
        const c = cellsOf(tr);
        // the model row is the template's grey row; every other row goes back to the template's white
        if (idx % 2 === 0) c.forEach((cell) => elems(cell, 'w:shd').forEach((shd) => { if (shd.getAttribute('w:fill')) shd.setAttribute('w:fill', 'ffffff'); }));
        setPara(parasOf(c[0])[0], s.time || '');
        setPara(parasOf(c[1])[0], s.name || '');
        const pp = parasOf(c[2]); const r0 = runsOf(pp[0]);
        setRunText(r0[0], s.project_line || ''); setRunText(r0[1], s.project_name || '');
        setPara(pp[1], s.title ? `“${String(s.title).replace(/^[“"]|[”"]$/g, '')}”` : '');
        setPara(pp[2], s.length || '');
        setPara(parasOf(c[3])[0], s.evaluator || '');
        // the template gives these paragraphs a negative right indent, which pushes long lines past the cell edge: keep them inside
        [c[1], c[2], c[3]].forEach((cell) => elems(cell, 'w:ind').forEach((ind) => { if (ind.getAttribute('w:right')) ind.setAttribute('w:right', '0'); }));
      });
    } else drop(T4);
  }

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
  zip.file('word/document.xml', out);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
