// The agenda as a PDF, drawn directly, so it needs no Word, no LibreOffice and no outside service.
// The club's page (banner, mission, officers, QR code) comes from agenda-base-N.pdf, which is the Word template with
// everything that changes from meeting to meeting removed (made by scripts/make-agenda-base.mjs). This file draws the
// date, theme, role takers, word of the day and the running order on top of it, in the template's own type and colours.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { planOf } from './agenda.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BLUE = rgb(0, 0.255, 0.396), MAROON = rgb(0.467, 0.141, 0.196), GREY = rgb(0.4, 0.4, 0.4), DARK = rgb(0.263, 0.263, 0.263), BLACK = rgb(0, 0, 0), BAND = rgb(0.953, 0.953, 0.953);
const X = { time: 183.5, title: 227.5, min: 416, who: 455, right: 566.5, c1: 221.5, sp: 225.7, pj: 326.1, ev: 467.3 };
const TOP = 644.9, ROW = 17.5, TOPIC = 10.4, SUB = 10.45, LINE = 10.35;
// where each blank page ends: the lowest a baseline may sit above the banner (the banner moves down on each page)
const FLOOR = [248, 168, 88];

// written out in full so the host sees every file this needs
const BASE_FILES = [path.join(here, '..', 'templates', 'agenda-base-0.pdf'), path.join(here, '..', 'templates', 'agenda-base-1.pdf'), path.join(here, '..', 'templates', 'agenda-base-2.pdf')];
const bases = [];
const baseBytes = async (n) => (bases[n] ||= await fs.readFile(BASE_FILES[n]));

async function fontsOf(pdf) {
  return { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold), i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique) };
}
/** keep only what the standard fonts can print: accents are dropped, anything else becomes a question mark */
const safe = (font, s) => String(s ?? '').normalize('NFC').split('').map((c) => {
  if (c === '\n' || c === '\t') return ' ';
  try { font.encodeText(c); return c; } catch { /* try without the accent */ }
  const d = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
  try { font.encodeText(d); return d; } catch { return '?'; }
}).join('');
const width = (font, size, s) => font.widthOfTextAtSize(safe(font, s), size);
/** one line cut to a width, with an ellipsis when it does not fit */
function fit(font, size, s, max) {
  let t = safe(font, s);
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
/** a person's name over at most two lines at its own size, never cut short with an ellipsis unless even two lines are not enough */
function nameLines(font, size, name, max, maxLines = 2) {
  let rest = safe(font, name).replace(/\s+/g, ' ').trim();
  const lines = [], w = (t) => font.widthOfTextAtSize(t, size);
  while (rest && lines.length < maxLines) {
    if (w(rest) <= max) { lines.push(rest); rest = ''; break; }
    let n = rest.length; while (n > 1 && w(rest.slice(0, n)) > max) n--;
    // break before a space or after a hyphen when there is one; a single word wider than the box is cut where it runs out
    let cut = -1;
    for (let i = n; i >= 1; i--) if (rest[i] === ' ' || rest[i - 1] === '-') { cut = i; break; }
    if (cut < 1) cut = n;
    lines.push(rest.slice(0, cut).trimEnd()); rest = rest.slice(cut).trimStart();
  }
  if (rest) lines[lines.length - 1] = fit(font, size, `${lines[lines.length - 1]} ${rest}`, max);
  return lines;
}

/** words broken into lines of at most `max` points; the first line may be narrower (`first`), and lines past `limit` are cut */
function wrap(font, size, s, max, { first = max, limit = 99 } = {}) {
  const words = safe(font, s).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const room = lines.length ? max : first, next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= room || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > limit) { lines.length = limit; lines[limit - 1] = fit(font, size, lines[limit - 1] + ' …', max); }
  return lines;
}

/* ───────── the running order, as a list of things to draw ───────── */
function programme(plan, F, k) {
  const ops = [], T = (s, x, y, font, size, color, max) => ops.push({ s: max ? fit(font, size, s, max) : safe(font, s), x, y, font, size, color });
  // a name on one line, or on up to three when it is long: returns how many lines it took
  const N = (s, x, y, font, size, color, max, lead = LINE) => { const ls = nameLines(font, size, s, max, 3); ls.forEach((l, i) => ops.push({ s: l, x, y: y - i * lead, font, size, color })); return ls.length; };
  let y = TOP, low = TOP;
  const note = (yy) => { low = Math.min(low, yy); };
  const item = (b) => {
    T(b.time, X.time, y, F.b, 10, BLUE);
    T(b.title, X.title, y, F.b, 10, MAROON, X.min - X.title - 6);
    if (b.min) T(b.min, X.min, y, F.r, 10, BLACK);
    const own = b.owner ? N(b.owner, X.who, y, F.b, 10, BLACK, X.right - X.who - 2) : 0;
    note(y);
    if (b.topic) { T(b.topic, X.title, y - TOPIC * k, F.i, 9, GREY, X.min - X.title - 6); note(y - TOPIC * k); y -= TOPIC * k; }
    if (own > 1) { note(y - LINE * k * (own - 1)); y -= LINE * k * (own - 1) * (b.topic ? 0.5 : 1); }
    y -= ROW * k;
  };
  const reports = (b) => {
    T(b.time, X.time, y, F.b, 10, BLUE);
    T(b.title, X.title, y, F.b, 10, MAROON, X.min - X.title - 6);
    if (b.min) T(b.min, X.min, y, F.r, 10, BLACK);
    const own = b.owner ? N(b.owner, X.who, y, F.b, 10, BLACK, X.right - X.who - 2) : 0;
    plan.reports.items.forEach((it, i) => { const yy = y - SUB * k * (i + 1); T(it.role, X.title, yy, F.r, 9, BLACK, 170); T(it.min, X.min, yy, F.i, 9, BLACK); note(yy); });
    y -= (ROW + SUB * plan.reports.items.length + (own > 1 ? LINE * (own - 1) : 0)) * k;
  };
  const each = (list) => list.forEach((b) => (b.type === 'reports' ? reports(b) : item(b)));
  each(plan.before);
  if (plan.speeches) {
    if (plan.before.length) y -= 16.6 * k;
    T('Prepared Speeches', (X.c1 + X.right) / 2 - width(F.b, 9, 'Prepared Speeches') / 2, y, F.b, 9, MAROON);
    const hy = y - 13;
    ops.push({ rect: true, x: X.c1, y: hy - 3.5, w: X.right - X.c1, h: 12.5, color: BLUE });
    T('Speaker', X.sp, hy, F.b, 9, rgb(1, 1, 1)); T('Project Details', X.pj, hy, F.b, 9, rgb(1, 1, 1)); T('Evaluator', X.ev, hy, F.b, 9, rgb(1, 1, 1));
    let ty = hy - 16.3;
    plan.speeches.forEach((s, i) => {
      const proj = [{ s: s.project_line, f: F.i }];
      if (s.project_name) wrap(F.r, 9, s.project_name, X.ev - X.pj - 6, { limit: 2 }).forEach((l) => proj.push({ s: l, f: F.r }));
      if (s.title) wrap(F.b, 9, `“${String(s.title).replace(/^[“"]|[”"]$/g, '')}”`, X.ev - X.pj - 6, { limit: 2 }).forEach((l) => proj.push({ s: l, f: F.b }));
      if (s.length) proj.push({ s: s.length, f: F.r });
      const rowH = Math.max(46.4, proj.length * LINE + 5) * Math.max(k, 0.85);
      if (i % 2) ops.push({ rect: true, x: X.c1, y: ty + 11.3 - rowH, w: X.right - X.c1, h: rowH, color: BAND });
      T(s.time, X.time, ty, F.b, 10, BLUE);
      N(s.name, X.sp, ty + 1, F.r, 9, BLACK, X.pj - X.sp - 4);
      proj.forEach((p, j) => T(p.s, X.pj, ty + 1 - j * LINE, p.f, 9, BLACK, X.ev - X.pj - 4));
      N(s.evaluator, X.ev, ty + 1, F.r, 9, BLACK, X.right - X.ev - 3);
      note(ty + 1 - (proj.length - 1) * LINE);
      ty -= rowH;
    });
    y = plan.speeches.length ? ty - 5.1 * k : ty - 25;
  }
  each(plan.after);
  return { ops, bottom: low - 4 };
}

/** which blank page and how tightly: the first page the running order fits on, else the longest page squeezed a little */
function choose(plan, F) {
  const full = programme(plan, F, 1), v = FLOOR.findIndex((f) => full.bottom >= f);
  if (v >= 0) return { v, k: 1, p: full, fits: true };
  for (let k = 0.96; k >= 0.8; k -= 0.02) { const p = programme(plan, F, k); if (p.bottom >= FLOOR[2]) return { v: 2, k, p, fits: true }; }
  return { v: 2, k: 0.8, p: programme(plan, F, 0.8), fits: false };
}

/** whether the running order fits on the single page (the page tells the VPE when it does not) */
export async function agendaFits(ag, ctx) {
  const pdf = await PDFDocument.create();
  return choose(planOf(ag, ctx), await fontsOf(pdf)).fits;
}

export async function renderAgendaPdf(ag, ctx) {
  const plan = planOf(ag, ctx);
  const probe = await PDFDocument.create();
  const { v, k } = choose(plan, await fontsOf(probe));
  const pdf = await PDFDocument.load(await baseBytes(v));
  const page = pdf.getPage(0), F = await fontsOf(pdf);
  const p = programme(plan, F, k);               // drawn with this document's own fonts
  const draw = (s, x, y, font, size, color) => { if (s) page.drawText(s, { x, y, font, size, color }); };

  // the club number in the banner: the page has the template's own, so it is covered with the banner blue and drawn again
  page.drawRectangle({ x: 450, y: 796, width: 140, height: 15, color: rgb(0, 63 / 255, 98 / 255) });
  if (ctx.clubNumber) { const cs = safe(F.b, `Club Number: ${ctx.clubNumber}`); draw(cs, 581.2 - width(F.b, 11, cs), 798.6, F.b, 11, rgb(1, 1, 1)); }

  // heading: the date, then the theme and quotation on up to two centred lines
  const cx = 369.5;
  const dateW = width(F.bi, 11, plan.date);
  draw(safe(F.bi, plan.date), cx - dateW / 2, 752.6, F.bi, 11, BLACK);
  // theme on its own line, quotation on its own line (wrapping to a second only when it is long)
  const wrapIt = (label, text, size) => {
    const out = [[]]; let lw = 0;
    const parts = [{ s: label, f: F.b, c: BLUE }, ...(' ' + text).split(/(?<= )/).map((w) => ({ s: w, f: F.i, c: BLACK }))];
    for (const pc of parts) {
      const w = width(pc.f, size, pc.s);
      if (lw + w > 372 && out[out.length - 1].length && pc.f === F.i) { out.push([]); lw = 0; if (!pc.s.trim()) continue; }
      out[out.length - 1].push(pc); lw += w;
    }
    return out;
  };
  let size = 10, lines = [];
  const build = () => { lines = []; if (plan.theme) lines.push(...wrapIt('Theme:', plan.theme, size)); if (plan.quote) lines.push(...wrapIt('Quotation:', plan.quote, size)); };
  build();
  if (lines.length > 2) { size = 8.5; build(); }
  const lead = size === 10 ? 11 : 9, top = size === 10 ? 741 : 742.5;
  lines.slice(0, 3).forEach((ln, i) => {
    let x = cx - ln.reduce((a, pc) => a + width(pc.f, size, pc.s), 0) / 2;
    for (const pc of ln) { draw(safe(pc.f, pc.s), x, top - i * lead, pc.f, size, pc.c); x += width(pc.f, size, pc.s); }
  });

  // the six role takers, each shrunk to fit its box
  const R = plan.roles;
  [[R.tmod, 297.6, 710.5, 80], [R.ge, 479, 710.5, 83], [R.grammarian, 297.6, 693.1, 80], [R.ah, 479, 693.1, 83], [R.timer, 297.6, 675.8, 80], [R.ttm, 479, 675.8, 83]].forEach(([name, x, y, max]) => {
    if (!name) return;
    // 9 pt on one line, or on two when it is long. Only a name too long even for two lines is made a little smaller.
    let size = 9, ls = nameLines(F.r, size, name, max);
    if (ls.length > 1) { size = 7.5; ls = nameLines(F.r, size, name, max); }
    while (size > 6.5 && ls.some((l) => l.endsWith('…'))) { size -= 0.5; ls = nameLines(F.r, size, name, max); }
    if (ls.length === 1) draw(ls[0], x, y, F.r, size, BLACK);
    else {
      // two lines centred in the row with clear space above and below
      const lead = size * 0.95, mid = y + 3.1 - (y < 680 ? 7 : y < 700 ? 3 : 1.5), first = mid - (0.7 * size - lead) / 2;
      ls.forEach((l, i) => draw(l, x, first - i * lead, F.r, size, BLACK));
    }
  });

  // next meeting date, centred in its grey box, with a raised ordinal
  const n = plan.next, a = `${n.month} ${n.day}`, c = `, ${n.year}`;
  const total = width(F.r, 12, a) + width(F.r, 8, n.ord) + width(F.r, 12, c);
  let nx = 99.4 - total / 2;
  draw(a, nx, 219.9, F.r, 12, BLUE); nx += width(F.r, 12, a);
  draw(n.ord, nx, 223.8, F.r, 8, BLUE); nx += width(F.r, 8, n.ord);
  draw(c, nx, 219.9, F.r, 12, BLUE);

  // word of the day, down the left side
  const w = plan.word;
  if (w) {
    const LX = 12.2, MAX = 143;
    let y = 189.3;
    draw(safe(F.b, w.word), LX, y, F.b, 13, BLUE);
    draw(safe(F.i, w.pos), LX + width(F.b, 13, w.word) + 3, y, F.i, 10, GREY);
    if (w.pron) { y -= 12.2; draw(fit(F.i, 10, w.pron, MAX), LX, y, F.i, 10, GREY); }
    if (w.meaning) {
      y -= 23; draw('Meaning:', LX, y, F.b, 10, BLUE);
      const lw = width(F.b, 10, 'Meaning:') + 3;
      const ls = wrap(F.r, 9, w.meaning, MAX, { first: MAX - lw, limit: 6 });
      ls.forEach((l, i) => { draw(l, i ? LX : LX + lw, y, F.r, 9, BLACK); if (i < ls.length - 1) y -= 10.6; });
    }
    if (w.example) { y -= 19.8; wrap(F.b, 8, w.example, MAX, { limit: 4 }).forEach((l, i, all) => { draw(l, LX, y, F.b, 8, BLUE); if (i < all.length - 1) y -= 9.2; }); }
    for (const [label, text] of [['Synonyms:', w.synonyms], ['Origin:', w.origin]]) {
      if (!text) continue;
      y -= 21.4; draw(label, LX, y, F.b, 10, BLUE);
      wrap(F.b, 9, text, MAX, { limit: 4 }).forEach((l) => { y -= 10.5; draw(l, LX, y, F.b, 9, DARK); });
    }
  }

  // the running order
  for (const op of p.ops) {
    if (op.rect) page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color: op.color });
    else if (op.s) page.drawText(op.s, { x: op.x, y: op.y, font: op.font, size: op.size, color: op.color });
  }
  pdf.setTitle(`Agenda, ${plan.date}`);
  pdf.setProducer('Brekkie');
  return pdf.save();
}
