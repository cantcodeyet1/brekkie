// Fills Toastmasters International's own role scripts and logs with what the role player recorded, so the
// download is the official form. Anything that does not fit its box goes on a plain continuation page (no logo).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const FORMS = path.join(here, '..', 'templates', 'roles');
const INK = rgb(0.07, 0.1, 0.16), MAROON = rgb(0.47, 0.14, 0.2), BLUE = rgb(0, 0.255, 0.396), GREY = rgb(0.45, 0.47, 0.5);

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const longDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const clean = (t) => String(t ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ').replace(/[^\x20-\x7e\xa0-\xff\n]/g, '').trim();

/* the pen: writes onto the pages of the official form, collecting whatever does not fit */
class Pen {
  constructor(doc, font, bold, meta) { this.doc = doc; this.font = font; this.bold = bold; this.meta = meta; this.over = []; this.pages = doc.getPages(); }
  page(i) { return this.pages[i]; }
  // y values below are measured from the top of the page, like the form's own drawing
  text(pi, str, x, baseline, { size = 10, font = this.font, color = INK } = {}) {
    const p = this.page(pi); p.drawText(clean(str), { x, y: p.getHeight() - baseline, size, font, color });
  }
  width(str, size, font = this.font) { return font.widthOfTextAtSize(clean(str), size); }
  // one line in a box: shrinks to fit, and reports false if even the smallest size is too wide
  line(pi, str, x0, x1, baseline, { size = 10, min = 6.5, align = 'left', font = this.font, color = INK } = {}) {
    str = clean(str); if (!str) return true;
    let s = size; while (s > min && this.width(str, s, font) > x1 - x0 - 3) s -= 0.5;
    const w = this.width(str, s, font), fit = w <= x1 - x0 - 3;
    const x = align === 'center' ? x0 + (x1 - x0 - Math.min(w, x1 - x0)) / 2 : x0 + 3;
    this.text(pi, fit ? str : this.cut(str, s, x1 - x0 - 6, font) + '...', x, baseline, { size: s, font, color });
    return fit;
  }
  cut(str, s, w, font) { let t = str; while (t.length > 1 && this.width(t + '...', s, font) > w) t = t.slice(0, -1); return t; }
  wrap(str, widthFor, size, font = this.font) {
    const words = clean(str).split(/\s+/).filter(Boolean), lines = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (this.width(test, size, font) <= widthFor(lines.length)) cur = test; else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur); return lines;
  }
  // wrap into one or two lines inside a row of the table (row height top..bottom); false if it needs more room
  cellText(pi, str, x0, x1, top, bottom, opts = {}) {
    str = clean(str); if (!str) return true;
    const h = bottom - top, size = opts.size || 9;
    if (this.width(str, size) <= x1 - x0 - 6) { this.text(pi, str, x0 + 3, top + h / 2 + size * 0.34, { size, color: opts.color }); return true; }
    if (h >= 20) {
      const s2 = 7, lines = this.wrap(str, () => x1 - x0 - 6, s2);
      if (lines.length <= 2) { lines.forEach((l, i) => this.text(pi, l, x0 + 3, lines.length === 1 ? top + h / 2 + s2 * 0.35 : top + h / 2 + (i === 0 ? -1.5 : s2 - 0.5), { size: s2, color: opts.color })); return true; }
    }
    this.line(pi, str, x0, x1, top + h / 2 + size * 0.34, { size, min: 6.5, color: opts.color });
    return false;
  }
  note(heading, body) { if (clean(body)) this.over.push({ heading, body: clean(body) }); }
  tick(pi, x, baseline, ok) {
    const p = this.page(pi), H = p.getHeight(), y = H - baseline;
    if (ok) { p.drawLine({ start: { x: x + 1.5, y: y + 4 }, end: { x: x + 4, y: y + 1.2 }, thickness: 1.3, color: INK }); p.drawLine({ start: { x: x + 4, y: y + 1.2 }, end: { x: x + 9, y: y + 8 }, thickness: 1.3, color: INK }); }
    else { p.drawLine({ start: { x: x + 1.5, y: y + 1.5 }, end: { x: x + 8, y: y + 8 }, thickness: 1.2, color: MAROON }); p.drawLine({ start: { x: x + 1.5, y: y + 8 }, end: { x: x + 8, y: y + 1.5 }, thickness: 1.2, color: MAROON }); }
  }

  // continuation pages: plain, no logo
  async finish(title) {
    if (!this.over.length) return;
    const M = 54, W = 595.28, H = 841.89, size = 10.5, lead = 14.5;
    let page = null, y = 0, n = 0;
    const fresh = () => {
      page = this.doc.addPage([W, H]); n++; y = H - 64;
      page.drawText(clean(`${title} (continued)`), { x: M, y, size: 17, font: this.bold, color: BLUE });
      y -= 18; page.drawText(clean(`${this.meta.name}  -  ${this.meta.club}  -  Meeting ${this.meta.number}, ${longDate(this.meta.date)}`), { x: M, y, size: 9.5, font: this.font, color: GREY });
      y -= 12; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.8, 0.82, 0.85) }); y -= 24;
    };
    fresh();
    for (const { heading, body } of this.over) {
      if (y < 110) fresh();
      page.drawText(clean(heading), { x: M, y, size: 11, font: this.bold, color: INK }); y -= lead + 2;
      for (const para of body.split('\n')) {
        for (const l of this.wrap(para, () => W - 2 * M, size)) { if (y < 70) fresh(); page.drawText(l, { x: M, y, size, font: this.font, color: INK }); y -= lead; }
      }
      y -= 12;
    }
  }
}

const SEE = 'continued on the last page';

/* ───────── Grammarian ───────── */
function grammarian(pen, { meeting: m, name, sheet }) {
  const rows = (sheet.rows || []).filter((r) => r.name);
  const cnt = (r) => r.uses || (r.used ? 1 : 0);
  pen.line(0, m.word, 212.1, 380.6, 254.5, { size: 11, font: pen.bold });
  const meaning = pen.wrap(m.meaning || '', (i) => (i === 0 ? 118 : 510) - 4, 9);
  meaning.slice(0, 2).forEach((l, i) => pen.text(0, l, i === 0 ? 452 : 60, i === 0 ? 253 : 271.5, { size: 9 }));
  if (meaning.length > 2) pen.note('Meaning of the word (continued)', meaning.slice(2).join(' '));
  const ex = pen.wrap(m.example || '', (i) => (i === 0 ? 352 : 510) - 4, 9);
  ex.slice(0, 2).forEach((l, i) => pen.text(0, l, i === 0 ? 217 : 60, i === 0 ? 308.5 : 327, { size: 9 }));
  if (ex.length > 2) pen.note('Example (continued)', ex.slice(2).join(' '));
  pen.line(0, longDate(m.date), 281.5, 354.4, 419, { size: 9.5 });
  pen.line(0, m.word, 444.3, 573.1, 419, { size: 9.5, font: pen.bold });

  const used = rows.filter((r) => cnt(r) > 0), cols = [[36.1, 216], [216, 396], [396, 576]];
  const total = used.reduce((a, r) => a + cnt(r), 0);
  used.forEach((r, i) => {
    if (i >= 30) return;
    const row = Math.floor(i / 3), c = cols[i % 3], top = 456.7 + row * 22.5;
    pen.cellText(0, `${r.name}${cnt(r) > 1 ? `  (${cnt(r)} times)` : ''}`, c[0], c[1], top, top + 22.5);
  });
  if (used.length > 30) pen.note('Used the word of the day (continued)', used.slice(30).map((r) => `${r.name}${cnt(r) > 1 ? ` (${cnt(r)} times)` : ''}`).join(', '));
  if (used.length) pen.text(0, `Used ${total} ${total === 1 ? 'time' : 'times'} in all`, 36.1, 700, { size: 9, color: GREY });

  const bad = rows.filter((r) => r.improper || r.suggestion), liked = rows.filter((r) => r.liked);
  bad.forEach((r, i) => {
    const top = 113.4 + Math.min(i, 9) * 22.5;
    if (i >= 10) { pen.note(`Improper use: ${r.name}`, `${r.improper || ''}${r.suggestion ? `\nSuggestion: ${r.suggestion}` : ''}`); return; }
    const a = pen.cellText(1, r.name, 36.1, 216, top, top + 22.5), b = pen.cellText(1, r.improper, 216, 396, top, top + 22.5, { color: MAROON }), c = pen.cellText(1, r.suggestion, 396, 576, top, top + 22.5);
    if (!a || !b || !c) pen.note(`Improper use: ${r.name}`, `${r.improper || ''}${r.suggestion ? `\nSuggestion: ${r.suggestion}` : ''}`);
  });
  liked.forEach((r, i) => {
    const top = 402.1 + Math.min(i, 9) * 22.5;
    if (i >= 10) { pen.note(`Liked: ${r.name}`, r.liked); return; }
    pen.cellText(1, r.name, 36.1, 216, top, top + 22.5);
    if (!pen.cellText(1, r.liked, 216, 576, top, top + 22.5)) pen.note(`Liked: ${r.name}`, r.liked);
  });
}

/* ───────── Ah-Counter ───────── */
function ahCounter(pen, { sheet }) {
  const fillers = sheet.fillers || [], official = ['ah', 'um', 'er', 'well', 'so', 'like', 'but', 'repeats'];
  const colX = [171.4, 216.4, 261.4, 306.4, 351.4, 396.4, 441.4, 486.4]; // Ah ... Repeats; Other is 531.4 to 576.4
  const rows = (sheet.rows || []).filter((r) => r.name);
  rows.forEach((r, i) => {
    const top = 371.7 + i * 17;
    if (i >= 20) { pen.note(`Count: ${r.name}`, fillers.map((f) => `${f.l} ${r.counts?.[f.k] || 0}`).join(', ')); return; }
    pen.line(0, r.name, 36.2, 171.4, top + 12, { size: 9.5 });
    official.forEach((k, j) => { const n = r.counts?.[k] || 0; if (n) pen.line(0, String(n), colX[j], colX[j] + 45, top + 12, { size: 10, align: 'center' }); });
    const custom = fillers.filter((f) => !official.includes(f.k) && f.k !== 'other' && (r.counts?.[f.k] || 0) > 0);
    const total = (r.counts?.other || 0) + custom.reduce((n, f) => n + r.counts[f.k], 0);
    if (total) pen.line(0, String(total), 531.4, 576.4, top + 12, { size: 10, align: 'center' });
    if (custom.length) pen.note(`Other words counted for ${r.name}`, [r.counts?.other ? `Other ${r.counts.other}` : '', ...custom.map((f) => `${f.l} ${r.counts[f.k]}`)].filter(Boolean).join(', '));
  });
  rows.filter((r) => r.comment).forEach((r) => pen.note(`Comment for ${r.name}`, r.comment));
}

/* ───────── Timer ───────── */
const within = (r, thr) => r.seconds != null && r.seconds >= thr[0] && r.seconds <= thr[2] + 30;
function timer(pen, { meeting: m, sheet, projects }) {
  const rows = (sheet.rows || []).filter((r) => r.name && r.seconds != null);
  const thrOf = (r) => r.kind === 'Speaker' ? (() => { const p = projects.find((x) => x.id === r.project_id); return p ? [p.green, p.yellow, p.red] : [300, 360, 420]; })()
    : r.kind === 'Evaluator' ? [120, 150, 180] : r.kind === 'Other' ? [r.min_s || 60, Math.round(((r.min_s || 60) + (r.max_s || 120)) / 2), r.max_s || 120] : [60, 90, 120];
  pen.line(0, longDate(m.date), 424.2, 564.1, 611, { size: 9.5 });
  const tt = rows.filter((r) => r.kind === 'Table Topics' || (r.kind !== 'Speaker' && r.kind !== 'Evaluator'));
  const sp = rows.filter((r) => r.kind === 'Speaker'), ev = rows.filter((r) => r.kind === 'Evaluator');
  const yn = (r) => (within(r, thrOf(r)) ? 'Yes' : 'No');
  tt.forEach((r, i) => {
    if (i >= 20) { pen.note(`Timing: ${r.name}`, `${mmss(r.seconds)}  within time: ${yn(r)}`); return; }
    const pi = i < 6 ? 0 : 1, top = i < 6 ? 666 + i * 17 : 74.2 + (i - 6) * 17;
    pen.line(pi, r.name + (r.kind === 'Other' ? ` (${r.label || 'Other'})` : ''), 27.8, 353.4, top + 12, { size: 9.5 });
    pen.line(pi, mmss(r.seconds), 353.4, 460.1, top + 12, { size: 10, align: 'center' });
    pen.line(pi, yn(r), 460.1, 566.8, top + 12, { size: 10, align: 'center', color: yn(r) === 'Yes' ? INK : MAROON });
  });
  sp.forEach((r, i) => {
    const thr = thrOf(r);
    if (i >= 5) { pen.note(`Prepared speech: ${r.name}`, `Requirement ${mmss(thr[0])} to ${mmss(thr[2])}, actual ${mmss(r.seconds)}, within time: ${yn(r)}`); return; }
    const top = 384.4 + i * 17;
    pen.line(1, r.name, 27.8, 247.2, top + 12, { size: 9.5 });
    pen.line(1, `${mmss(thr[0])} - ${mmss(thr[2])}`, 247.2, 353.4, top + 12, { size: 9, align: 'center' });
    pen.line(1, mmss(r.seconds), 353.4, 460.1, top + 12, { size: 10, align: 'center' });
    pen.line(1, yn(r), 460.1, 566.8, top + 12, { size: 10, align: 'center', color: yn(r) === 'Yes' ? INK : MAROON });
  });
  ev.forEach((r, i) => {
    if (i >= 5) { pen.note(`Evaluation: ${r.name}`, `Actual ${mmss(r.seconds)}, within time: ${yn(r)}`); return; }
    const top = 527.7 + i * 17;
    pen.line(1, r.name, 27.8, 353.4, top + 12, { size: 9.5 });
    pen.line(1, mmss(r.seconds), 353.4, 460.1, top + 12, { size: 10, align: 'center' });
    pen.line(1, yn(r), 460.1, 566.8, top + 12, { size: 10, align: 'center', color: yn(r) === 'Yes' ? INK : MAROON });
  });
  (sheet.rows || []).filter((r) => r.name && r.comment).forEach((r) => pen.note(`Comment for ${r.name}`, r.comment));
}

/* ───────── Topicsmaster ───────── */
function topicsmaster(pen, { meeting: m, sheet }) {
  pen.line(0, m.theme || '', 142.7, 567.2, 297, { size: 10, font: pen.bold });
  const topics = (sheet.topics || []).map((t) => clean(t)).filter(Boolean);
  if (topics.length && !pen.line(0, topics.join('; '), 61.9, 564.5, 320, { size: 9, min: 6 })) pen.note('Topics', topics.map((t, i) => `${i + 1}. ${t}`).join('\n'));
  (sheet.rows || []).filter((r) => r.name).forEach((r, i) => {
    if (i >= 20) { pen.note(`Speaker: ${r.name}`, r.topic || ''); return; }
    const top = 380 + i * 17;
    pen.line(0, r.name, 27.8, 202.6, top + 12, { size: 9.5 });
    if (!pen.line(0, r.topic || '', 202.6, 567.5, top + 12, { size: 9.5, min: 6.5 })) pen.note(`Topic given to ${r.name}`, r.topic);
  });
}

/* ───────── General Evaluator ───────── */
const GE_BOXES = [
  { pi: 0, ys: [326.9, 349.9, 372.9], notes: [385.3, 408.3] },
  { pi: 0, ys: [473.9, 496.9, 519.9, 542.9], notes: [555.3, 578.3] },
  { pi: 0, ys: [643.9, 666.9, 689.9, 712.9], notes: [725.3, 748.3] },
  { pi: 1, ys: [89, 112, 135, 158, 181, 204, 227, 250, 273], notes: [285.4, 308.4] },
  { pi: 1, ys: [374, 397, 420, 443, 466, 489], notes: [501.4, 524.4] },
];
const GE_NAMES = ['Before the meeting', 'Meeting opening', 'Toastmaster', 'General Evaluator', 'Topicsmaster'];
function generalEvaluator(pen, { sheet, roles, people }) {
  (sheet.sections || []).forEach((s, si) => {
    const box = GE_BOXES[si]; if (!box) return;
    box.ys.forEach((y, qi) => { const a = s.a?.[qi]; if (a === 'y' || a === 'n') pen.tick(box.pi, 28.4, y, a === 'y'); });
    const notes = clean(s.notes);
    if (notes) {
      const first = pen.wrap(notes, () => 490, 9.5);
      if (first[0]) pen.text(box.pi, first[0], 66, box.notes[0] + 9.6, { size: 9.5 });
      const rest = first.slice(1).join(' ');
      if (rest) { const second = pen.wrap(rest, () => 526, 9.5); pen.text(box.pi, second[0], 29, box.notes[1] + 9.6, { size: 9.5 }); if (second.length > 1) pen.note(`${GE_NAMES[si]}: notes (continued)`, second.slice(1).join(' ')); }
    }
  });
  const roleOf = (id) => roles.find((r) => r.id === id), nameOf = (id) => people.find((p) => p.id === roleOf(id)?.person_id)?.name || '';
  for (const c of sheet.comments || []) {
    if (!c.well && !c.improve) continue;
    pen.note(`${nameOf(c.role_id)} (${roleOf(c.role_id)?.label || ''})`, `Went well: ${c.well || '-'}\nTo improve: ${c.improve || '-'}`);
  }
}

const BUILD = { grammarian, ah_counter: ahCounter, timer, topicsmaster, general_evaluator: generalEvaluator };
export const hasOfficialReport = (key) => key in BUILD;
export const REPORT_TITLES = { grammarian: 'Grammarian Script and Log', ah_counter: 'Ah-Counter Script and Log', timer: 'Timer Script and Log', topicsmaster: 'Topicsmaster Script and Log', general_evaluator: 'General Evaluator Checklist' };

export async function buildRoleReport(key, ctx) {
  const doc = await PDFDocument.load(await fs.readFile(path.join(FORMS, key + '.pdf')));
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pen = new Pen(doc, font, bold, { name: ctx.name, club: ctx.club, number: ctx.meeting.number, date: ctx.meeting.date });
  const nm = (id) => ctx.people.find((p) => p.id === id)?.name || '';
  const sheet = { ...ctx.sheet, rows: (ctx.sheet.rows || []).map((r) => ({ ...r, name: nm(r.subject_id) })) };
  BUILD[key](pen, { ...ctx, sheet });
  await pen.finish(REPORT_TITLES[key]);
  doc.setTitle(`${REPORT_TITLES[key]}, meeting ${ctx.meeting.number}`);
  return Buffer.from(await doc.save());
}
