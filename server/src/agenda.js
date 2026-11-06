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

/* ───────── defaults: what the template shows, driven by the meeting ───────── */
const OPENING = [['Meeting Called To Order', 1, 'SAA', 0], ['Welcome', 5, 'Chairperson', 1], ['Toast', 5, 'TMOD', 5], ['Introduction of Role Takers', 5, 'General Evaluator', 10]];
// closing offsets (minutes after the last speech slot) copied from the template: 1840, 1900, 1910, 1920, 1925, 1930
const CLOSING = [['Table Topics', 10, 'Table Topics Master', 0], ['Speech Evaluations', 10, 'General Evaluator', 20], ['Top Table Reports', 10, 'General Evaluator', 30, 'reports'], ['TMOD Final Remarks', 5, 'TMOD', 40], ['Club Business', 5, 'Chairperson', 45], ['Meeting Adjourned', null, '', 50]];
const REPORTS = [['Grammarian', 3], ['Ah Counter', 1], ['Timer', 1], ['General Evaluator', 3]];
const SPEECH_SLOT = 10;           // minutes per prepared speech in the running order
const SPEECHES_START = 20;        // minutes after the start of the meeting
const hhmm = (start, plus) => {
  const s = String(start || '1800').replace(':', '').padStart(4, '0');
  const t = (+s.slice(0, 2)) * 60 + (+s.slice(2)) + plus;
  return String(Math.floor(t / 60) % 24).padStart(2, '0') + String(t % 60).padStart(2, '0');
};
const withCred = (name, cred) => (name ? (cred ? `${name}, ${cred}` : name) : '');
const lengthText = (t) => String(t || '').replace(/–/g, ' - ').replace(/\s*minutes?/i, ' min').replace(/\s+/g, ' ').trim();

export async function loadContext(meetingId, clubId) {
  const [m] = await q(`select id, number, to_char(date,'YYYY-MM-DD') as date, theme, theme_quote, theme_quote_by, word, pos, pron, meaning, example, synonyms, origin, agenda, feedback_code
    from meetings where id=$1 and club_id=$2`, [meetingId, clubId]);
  if (!m) return null;
  const roles = await q(`select r.id, r.role_key, r.label, r.position, r.target_role_id, r.speech_title, p.name, p.credential, pr.name as project, r.path_name as path, r.path_level as level, (select pp.pos from path_projects pp where pp.path=r.path_name and pp.level=r.path_level and pp.project_id=r.project_id) as pos, (select pp.kind from path_projects pp where pp.path=r.path_name and pp.level=r.path_level and pp.project_id=r.project_id) as pkind, pr.length_text
    from meeting_roles r left join people p on p.id=r.person_id left join projects pr on pr.id=r.project_id where r.meeting_id=$1 order by r.position`, [m.id]);
  const [next] = await q(`select to_char(date,'YYYY-MM-DD') as date from meetings where club_id=$1 and number > $2 order by number limit 1`, [clubId, m.number]);
  return { m, roles, next: next?.date || null };
}

export function defaultAgenda({ m, roles, next }, startTime) {
  const start = /^\d{4}$/.test(startTime || '') ? startTime : '1800';
  const nameOf = (key) => { const r = roles.find((x) => x.role_key === key); return r?.name ? withCred(r.name, r.credential) : ''; };
  const speakers = roles.filter((r) => r.role_key === 'speaker' && r.name);
  const speeches = speakers.map((s, i) => {
    const ev = roles.find((r) => r.role_key === 'evaluator' && r.target_role_id === s.id && r.name);
    return {
      role_id: s.id, time: hhmm(start, SPEECHES_START + i * SPEECH_SLOT), name: withCred(s.name, s.credential),
      project_line: s.project ? `${s.path || 'Presentation Mastery'}${s.level && s.pos ? (s.pkind === 'elective' ? ` (L${s.level} elective)` : ` (L${s.level}P${s.pos})`) : ''}` : 'Project to be confirmed',
      project_name: s.project || '', title: s.speech_title || '', length: s.project ? lengthText(s.length_text) : '', evaluator: ev ? withCred(ev.name, ev.credential) : '',
    };
  });
  const base = SPEECHES_START + SPEECH_SLOT * Math.max(speeches.length, 1);
  const d = next || (() => { const x = new Date(m.date + 'T12:00:00'); x.setDate(x.getDate() + 7); return x.toISOString().slice(0, 10); })();
  return {
    start, next_meeting: d,
    roles: { tmod: nameOf('toastmaster'), ge: nameOf('general_evaluator'), grammarian: nameOf('grammarian'), ah: nameOf('ah_counter'), timer: nameOf('timer'), ttm: nameOf('topicsmaster') },
    opening: OPENING.map(([title, min, owner, off]) => ({ time: hhmm(start, off), title, min: `${min} min`, owner })),
    speeches,
    closing: CLOSING.map(([title, min, owner, off, kind]) => ({ time: hhmm(start, base + off), title, min: min === null ? '' : `${min} min`, owner, ...(kind ? { kind } : {}) })),
    reports: { total: '10 min', items: REPORTS.map(([role, min]) => ({ role, min: `${min} min` })) },
  };
}

/* The saved agenda stores only what the VPE changed, so role and speaker changes still flow through. */
export function mergeAgenda(def, saved = {}) {
  const out = JSON.parse(JSON.stringify(def));
  for (const k of ['start', 'next_meeting']) if (saved[k]) out[k] = saved[k];
  for (const k of ['opening', 'closing']) (saved[k] || []).forEach((it, i) => { if (it && out[k][i]) Object.assign(out[k][i], it); });
  if (saved.reports) {
    if (saved.reports.total) out.reports.total = saved.reports.total;
    (saved.reports.items || []).forEach((it, i) => { if (it && out.reports.items[i]) Object.assign(out.reports.items[i], it); });
  }
  if (saved.speeches) out.speeches.forEach((s) => { if (saved.speeches[s.role_id]) Object.assign(s, saved.speeches[s.role_id]); });
  return out;
}

export function diffAgenda(def, edited) {
  const saved = {};
  if (edited.start && edited.start !== '1800') saved.start = edited.start;
  if (edited.next_meeting && edited.next_meeting !== def.next_meeting) saved.next_meeting = edited.next_meeting;
  const arr = (a, b) => b.map((it, i) => Object.fromEntries(Object.entries(it || {}).filter(([f, v]) => a[i] && f !== 'kind' && String(v ?? '') !== String(a[i][f] ?? ''))));
  for (const k of ['opening', 'closing']) { const d = arr(def[k], edited[k] || []); if (d.some((x) => Object.keys(x).length)) saved[k] = d; }
  const rep = {};
  if (edited.reports?.total && edited.reports.total !== def.reports.total) rep.total = edited.reports.total;
  const ri = arr(def.reports.items, edited.reports?.items || []); if (ri.some((x) => Object.keys(x).length)) rep.items = ri;
  if (Object.keys(rep).length) saved.reports = rep;
  const sp = {};
  for (const s of edited.speeches || []) {
    const d = def.speeches.find((x) => x.role_id === s.role_id); if (!d) continue;
    const ch = Object.fromEntries(Object.entries(s).filter(([f, v]) => f !== 'role_id' && String(v ?? '') !== String(d[f] ?? '')));
    if (Object.keys(ch).length) sp[s.role_id] = ch;
  }
  if (Object.keys(sp).length) saved.speeches = sp;
  return saved;
}

/* ───────── fill the template ───────── */
const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const elems = (node, tag) => Array.from(node.getElementsByTagName(tag));

function setTextNode(t, text) {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument.createTextNode(text));
  t.setAttribute('xml:space', 'preserve');
}
function setRunText(run, text) {
  let t = elems(run, 'w:t')[0];
  if (!t) { t = run.ownerDocument.createElement('w:t'); run.appendChild(t); }
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(run.ownerDocument.createTextNode(text));
  t.setAttribute('xml:space', 'preserve');
}
const runsOf = (p) => elems(p, 'w:r');
/** Put `text` in the paragraph's first text run and empty the rest, keeping the first run's formatting. */
function setPara(p, text) {
  const runs = runsOf(p);
  if (!runs.length) return;
  const first = runs.find((r) => elems(r, 'w:t').length) || runs[0];
  runs.forEach((r) => { if (r !== first && elems(r, 'w:t').length) setRunText(r, ''); });
  setRunText(first, text);
}
const cellsOf = (tr) => elems(tr, 'w:tc').filter((tc) => tc.parentNode === tr);
const rowsOf = (tbl) => elems(tbl, 'w:tr').filter((tr) => tr.parentNode === tbl);
const parasOf = (tc) => elems(tc, 'w:p');

export async function buildDocx(ag, ctx, opts = {}) {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const P = elems(doc, 'w:p');                 // document-order paragraph index, as in the template
  const T = elems(doc, 'w:tbl');
  const { m } = ctx;

  // heading block
  const d = new Date(m.date + 'T12:00:00');
  setRunText(runsOf(P[8])[0], `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} `);
  const th = runsOf(P[9]);
  setRunText(th[1], ` ${m.theme || ''}`);
  if (m.theme_quote) {
    setRunText(th[3], ` “${m.theme_quote.replace(/^[“"]|[”"]$/g, '')}”${m.theme_quote_by ? ` — ${m.theme_quote_by}` : ''}`);
  } else { setRunText(th[2], ''); setRunText(th[3], ''); }

  // next meeting date (left panel). The "th" is its own superscript run.
  const nd = new Date(ag.next_meeting + 'T12:00:00');
  const nr = runsOf(P[43]);
  setRunText(nr[0], `${MONTHS[nd.getMonth()]} ${nd.getDate()}`); setRunText(nr[1], ordinal(nd.getDate())); setRunText(nr[2], `, ${nd.getFullYear()}`);

  // word of the day
  const wr = runsOf(P[45]);
  setRunText(wr[0], (m.word || '').toUpperCase());
  // this run holds two text nodes with a line break between them: "(adj.)" then the pronunciation
  const wt = elems(wr[2], 'w:t');
  if (wt[0]) setTextNode(wt[0], m.word && m.pos ? `(${m.pos})` : '');
  if (wt[1]) setTextNode(wt[1], m.word ? `${m.pron || ''} ` : '');
  setRunText(wr[7], m.meaning || '');
  setPara(P[47], m.example ? `Example: ${m.example}` : '');
  setPara(P[50], m.synonyms || '');
  // origin of the word, under the synonyms: same label and text styling as them
  if (m.origin) {
    const lab = P[49].cloneNode(true), txt = P[50].cloneNode(true);
    [lab, txt].forEach((n) => { n.removeAttribute('w14:paraId'); });
    setPara(lab, 'Origin:'); setPara(txt, m.origin);
    const cell = P[50].parentNode, after = P[50].nextSibling;
    cell.insertBefore(lab, after); cell.insertBefore(txt, after);
  }

  // roles table (3 rows x 4 cells: label, name, label, name)
  const rr = rowsOf(T[2]).map(cellsOf);
  const R = ag.roles;
  [[0, 1, R.tmod], [0, 3, R.ge], [1, 1, R.grammarian], [1, 3, R.ah], [2, 1, R.timer], [2, 3, R.ttm]].forEach(([r, c, v]) => setPara(parasOf(rr[r][c])[0], v || ''));
  // the template shrinks long names by hand; give every name the same type size so they read evenly
  const modelRun = runsOf(parasOf(rr[0][1])[0])[0], modelPr = elems(modelRun, 'w:rPr')[0];
  if (modelPr) [[0, 3], [1, 1], [1, 3], [2, 1], [2, 3]].forEach(([r, c]) => {
    const run = runsOf(parasOf(rr[r][c])[0]).find((x) => elems(x, 'w:t').length); if (!run) return;
    elems(run, 'w:rPr').filter((x) => x.parentNode === run).forEach((x) => run.removeChild(x));
    run.insertBefore(modelPr.cloneNode(true), run.firstChild);
  });

  // simple programme rows: time, item, duration, who
  const fillRow = (tr, it) => { const c = cellsOf(tr); setPara(parasOf(c[0])[0], it.time || ''); setPara(parasOf(c[1])[0], it.title || ''); setPara(parasOf(c[2])[0], it.min || ''); setPara(parasOf(c[3])[0], it.owner || ''); };
  rowsOf(T[3]).forEach((tr, i) => ag.opening[i] && fillRow(tr, ag.opening[i]));

  // closing programme
  const cr = rowsOf(T[5]);
  ag.closing.forEach((it, i) => {
    const tr = cr[i]; if (!tr) return;
    if (it.kind === 'reports') {
      const c = cellsOf(tr);
      setPara(parasOf(c[0])[0], it.time || '');
      // title paragraph keeps its line break; the role names follow on their own lines
      const tp = parasOf(c[1]); const t0 = runsOf(tp[0]); setRunText(t0[0], it.title || 'Top Table Reports'); setRunText(t0[1], ag.reports.items[0].role);
      [1, 2, 3].forEach((k) => setPara(tp[k], ag.reports.items[k].role));
      const dp = parasOf(c[2]); const d0 = runsOf(dp[0]); setRunText(d0[0], ag.reports.total); setRunText(d0[1], ag.reports.items[0].min);
      [1, 2, 3].forEach((k) => setPara(dp[k], ag.reports.items[k].min));
      setPara(parasOf(c[3])[0], it.owner || '');
    } else fillRow(tr, it);
  });

  // prepared speeches: one row per speaker (the template's second row is the model)
  const sp = T[4], sRows = rowsOf(sp), model = sRows[2].cloneNode(true);
  sRows.slice(1).forEach((tr) => sp.removeChild(tr));
  const list = ag.speeches.length ? ag.speeches : [{ time: '', name: '', project_line: '', project_name: '', title: '', length: '', evaluator: '' }];
  list.forEach((s, idx) => {
    const tr = model.cloneNode(true); sp.appendChild(tr);
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

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
  zip.file('word/document.xml', out);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
