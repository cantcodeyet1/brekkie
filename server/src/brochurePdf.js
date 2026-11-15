// The take-home page that goes behind the agenda: what Toastmasters is, the Pathways and their levels, who else is in it,
// what it costs and how to join. Drawn directly (no Word, no outside service) on the same banner as the agenda, so the two
// pages read as one handout. Everything club-specific comes in through `ctx` (see SAMPLE below for the shape).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const BANNER_FILE = path.join(here, '..', 'templates', 'agenda-plain-0.pdf');   // the Toastmasters banner and logo, without any club details
const PW = 594.96, PH = 842.04, LX = 12.2, RX0 = 183.5, RX1 = 566.5;
const c = (hex) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const BLUE = c('#004165'), MAROON = c('#772432'), YELLOW = c('#F2DF74'), INK = c('#2B2F33'), GREY = c('#5B6168'), SOFT = c('#F2F4F6'), LINE = c('#D5DADF'), WHITE = c('#FFFFFF'), SKY = c('#CFE0EA');

export const PATHS = [
  ['DL', 'Dynamic Leadership', 'Build strategic leadership and conflict resolution skills.'],
  ['EH', 'Engaging Humor', 'Build interpersonal communication, leadership and coaching skills.'],
  ['MS', 'Motivational Strategies', 'Build public speaking and speech writing skills.'],
  ['PI', 'Persuasive Influence', 'Build creative project management and communication skills.'],
  ['PM', 'Presentation Mastery', 'Build communication and leadership skills.'],
  ['VC', 'Visionary Communication', 'Build motivational leadership and communication skills.'],
];
export const LEVELS = [
  ['Mastering Fundamentals', 'The basics of speaking'],
  ['Learning Your Style', 'Find your own voice'],
  ['Increasing Knowledge', 'Widen your toolkit'],
  ['Building Skills', 'Lead and help others grow'],
  ['Demonstrating Expertise', 'Show what you have learned'],
];
const STATS = [['100+', 'Years'], ['265K+', 'Members'], ['13,700+', 'Clubs'], ['150', 'Countries']];
// Toastmasters' own press releases (2019 and 2020) name these four among the companies with clubs
const GLOBAL = ['Google', 'Microsoft', 'Amazon', 'IBM'];
const ZIM = ['CBZ', 'Cimas', 'BancABC'];

const GAINS = ['Leadership you can use everywhere', 'Friends and a global professional network', 'Learning at your own pace', 'Feedback that uplifts', 'Confidence for every room', 'Certificates for every level'];

/** what a club can set; anything left out falls back to these (the Champions figures) */
export const SAMPLE = {
  clubName: 'Champions Toastmasters Club', clubNumber: '04647453', region: 'Area 2, Division C, District 129',
  meets: 'Every 2nd and 4th Friday', where: '',
  fees: { dues: 72, joining: 25, months: 6, pay: [['Visa', false], ['Cash', true], ['EcoCash', true]], note: 'Cash and EcoCash payments carry a small extra to cover bank charges. Ask us for the amount.', renewal: 'Your first period depends on our renewal cycle, so the amount at joining can differ a little. Ask us.' },
  contact: { role: 'VP Public Relations', name: 'Seedwell Mpande', phone: '+263 77 354 3615' },
};

/* ───────── drawing helpers ───────── */
const Y = (top) => PH - top;
function kit(page, F) {
  const safe = (font, s) => String(s ?? '').normalize('NFC').split('').map((ch) => { try { font.encodeText(ch); return ch; } catch { const d = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); try { font.encodeText(d); return d; } catch { return '?'; } } }).join('');
  const w = (font, size, s) => font.widthOfTextAtSize(safe(font, s), size);
  const text = (s, x, top, font, size, color, o = {}) => { const t = safe(font, s); if (t) page.drawText(t, { x, y: Y(top), font, size, color, ...(o.spacing ? { characterSpacing: o.spacing } : {}) }); return w(font, size, s); };
  const centre = (s, cx, top, font, size, color, o) => text(s, cx - w(font, size, s) / 2, top, font, size, color, o);
  const right = (s, rx, top, font, size, color) => text(s, rx - w(font, size, s), top, font, size, color);
  const lines = (s, font, size, max) => { const out = []; let cur = ''; for (const word of safe(font, s).split(/\s+/).filter(Boolean)) { const next = cur ? `${cur} ${word}` : word; if (w(font, size, next) <= max || !cur) cur = next; else { out.push(cur); cur = word; } } if (cur) out.push(cur); return out; };
  /** wrapped text; returns the top-coordinate of the line after the last one */
  const para = (s, x, top, max, font, size, color, lead = size * 1.32) => { const ls = lines(s, font, size, max); ls.forEach((l, i) => text(l, x, top + i * lead, font, size, color)); return top + ls.length * lead; };
  const rect = (x, top, wd, ht, color) => page.drawRectangle({ x, y: Y(top + ht), width: wd, height: ht, color });
  const rr = (x, top, wd, ht, r, color, border, bw = 0.8) => { r = Math.min(r, ht / 2, wd / 2); page.drawSvgPath(`M ${r} 0 H ${wd - r} A ${r} ${r} 0 0 1 ${wd} ${r} V ${ht - r} A ${r} ${r} 0 0 1 ${wd - r} ${ht} H ${r} A ${r} ${r} 0 0 1 0 ${ht - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`, { x, y: Y(top), ...(color ? { color } : {}), ...(border ? { borderColor: border, borderWidth: bw } : {}) }); };
  const circle = (cx, top, r, color) => page.drawCircle({ x: cx, y: Y(top), size: r, color });
  return { w, text, centre, right, lines, para, rect, rr, circle };
}
/** a section heading in the style of the web brochure: a maroon bar, then capitals */
const heading = (k, F, label, x, top) => { k.rect(x, top - 10, 2.6, 13, MAROON); k.text(label.toUpperCase(), x + 8, top, F.b, 10.5, MAROON, { spacing: 0.3 }); };

export async function renderBrochure(input = {}) {
  const ctx = { ...SAMPLE, ...input, fees: { ...SAMPLE.fees, ...(input.fees || {}) }, contact: { ...SAMPLE.contact, ...(input.contact || {}) } };
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PW, PH]);
  const F = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold), i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique) };
  const k = kit(page, F);

  // the banner and logo, cut from the top of the plain agenda page
  const src = await PDFDocument.load(await fs.readFile(BANNER_FILE));
  const strip = await pdf.embedPage(src.getPage(0), { left: 0, right: PW, bottom: PH - 128, top: PH });
  page.drawPage(strip, { x: 0, y: PH - 128 });
  k.rect(168, 112, PW - 168, 24, WHITE);   // the top edge of the agenda's role table sits just under the banner
  // club name, number and area in the banner, as on the agenda
  let size = 26; while (size > 14 && k.w(F.b, size, ctx.clubName) > 380) size -= 1;
  k.right(ctx.clubName, 581.2, 27.6 + size * 0.0, F.b, size, WHITE);
  if (ctx.clubNumber) k.right(`Club Number: ${ctx.clubNumber}`, 581.2, 43.3, F.b, 11, WHITE);
  if (ctx.region) k.right(ctx.region, 581.2, 56.2, F.b, 11, WHITE);

  /* ───────── right column ───────── */
  const W = RX1 - RX0;
  k.text('Where Leaders Are Made', RX0, 108, F.b, 28, BLUE);
  k.para('Our mission, as Toastmasters International: to empower individuals to become more effective communicators and leaders, one meeting at a time.', RX0, 128, W, F.r, 10.5, GREY, 13.6);

  // the numbers
  const tw = (W - 3 * 2) / 4;
  STATS.forEach(([n, l], i) => {
    const x = RX0 + i * (tw + 2);
    k.rect(x, 158, tw, 58, i % 2 ? MAROON : BLUE);
    k.centre(n, x + tw / 2, 189, F.b, 22, WHITE);
    k.centre(l, x + tw / 2, 205, F.r, 9, WHITE);
  });

  // how a meeting works
  heading(k, F, 'How a meeting works', RX0, 250);
  const steps = [
    ['Speak', 'Give a prepared speech in a friendly room.'],
    ['Think on your feet', 'One or two minutes on a topic you have not seen.'],
    ['Get feedback', 'Every speech gets kind, specific feedback.'],
  ];
  const sw = (W - 2 * 6) / 3;
  steps.forEach(([t, d], i) => {
    const x = RX0 + i * (sw + 6);
    k.rr(x, 262, sw, 58, 6, SOFT, LINE);   // a hairline keeps the card visible on a black and white printer
    k.circle(x + 15, 279, 8, BLUE); k.centre(String(i + 1), x + 15, 282.2, F.b, 9.5, WHITE);
    k.text(t, x + 28, 282.5, F.b, 9.8, BLUE);
    k.para(d, x + 9, 302, sw - 16, F.r, 8.6, GREY, 10.6);
  });

  // what you take home
  heading(k, F, 'What you take home', RX0, 354);
  GAINS.forEach((g, i) => {
    const x = RX0 + (i % 2) * (W / 2), top = 376 + Math.floor(i / 2) * 17;
    let sz = 9.6; while (sz > 8 && k.w(F.r, sz, g) > W / 2 - 14) sz -= 0.2;
    k.rect(x, top - 6.5, 5, 5, MAROON);
    k.text(g, x + 11, top, F.r, sz, INK);
  });

  // in good company
  heading(k, F, 'In good company', RX0, 448);
  k.text('Nearly 60% of Fortune 500 companies have a Toastmasters club. Among them:', RX0, 467, F.r, 9, GREY);
  const gw = W / GLOBAL.length;
  GLOBAL.forEach((n, i) => { const x = RX0 + i * gw; page.drawRectangle({ x, y: Y(496), width: gw, height: 22, borderColor: LINE, borderWidth: 0.7, color: WHITE }); k.centre(n, x + gw / 2, 489.4, F.b, 8.8, BLUE); });
  k.text('And Toastmasters is already at work in Zimbabwean organisations, including:', RX0, 515, F.r, 9, GREY);
  const zw = W / ZIM.length;
  ZIM.forEach((n, i) => { const x = RX0 + i * zw; k.rect(x, 522, zw, 22, BLUE); if (i) k.rect(x, 522, 0.7, 22, SKY); k.centre(n, x + zw / 2, 536.4, F.b, 8.8, WHITE); });

  // come and see
  k.rr(RX0, 566, W, 36, 6, SOFT, LINE);
  k.rect(RX0, 566, 3.2, 36, BLUE);
  k.text('Become a member', RX0 + 14, 581, F.b, 10.2, BLUE);
  k.text(`Come as our guest first. We meet ${ctx.meets.replace(/^Every /, 'every ')}${ctx.where ? ` at ${ctx.where}` : ''}.`, RX0 + 14, 594, F.r, 8.8, GREY);

  /* ───────── left column ───────── */
  const LW = 163;
  k.text('Choose your path', LX, 146, F.b, 12.5, BLUE);
  let top = k.para('Pathways is our learning programme. Choose one of six paths and move at your own pace.', LX, 160, LW, F.r, 8.8, GREY, 11);
  top += 5;
  PATHS.forEach(([code, name, desc]) => {
    k.rr(LX, top - 9.5, 27, 15, 3.5, BLUE);
    k.centre(code, LX + 13.5, top + 1.2, F.b, 8.8, WHITE, { spacing: 0.4 });
    k.text(name, LX + 34, top + 1, F.b, 9.4, BLUE);
    top = k.para(desc, LX + 34, top + 12.5, LW - 34, F.r, 8.3, GREY, 10) + 7.5;
  });

  top += 8;
  k.text('Five levels in every path', LX, top, F.b, 12.5, BLUE);
  top += 17;
  const step = 27;
  page.drawLine({ start: { x: LX + 7.5, y: Y(top + 4) }, end: { x: LX + 7.5, y: Y(top + step * (LEVELS.length - 1) + 4) }, thickness: 1.2, color: SKY });
  LEVELS.forEach(([name, desc], i) => {
    const t = top + i * step;
    k.circle(LX + 7.5, t + 4, 7.5, i === LEVELS.length - 1 ? MAROON : BLUE); k.centre(String(i + 1), LX + 7.5, t + 7, F.b, 8.6, WHITE);
    k.text(name, LX + 22, t + 3, F.b, 9, BLUE);
    k.text(desc, LX + 22, t + 13, F.r, 8, GREY);
  });

  /* ───────── the offer, across the foot of the page ───────── */
  const BT = 622, BH = 190, BX = LX, BW = RX1 - LX;
  const { dues, joining, months = 6, pay, note, renewal } = ctx.fees, total = dues + joining;
  const perMonth = Math.round(dues / months);   // dues only, without the joining fee
  k.rect(BX, BT, BW, BH, BLUE);
  k.text('READY TO TAKE YOUR GROWTH', BX + 20, BT + 32, F.b, 16, WHITE);
  k.text('TO THE NEXT LEVEL?', BX + 20, BT + 51, F.b, 16, WHITE);
  k.text(`About $${perMonth} a month. The price of four Chicken Inn two-piecers and chips.`, BX + 20, BT + 72, F.b, 9.6, YELLOW);

  // the price, as a sum
  const py = BT + 84, ph = 62;
  const tile = (x, wd, big, small, fill, ink, sub, edge) => { k.rr(x, py, wd, ph, 6, fill, edge, 2.4); k.centre(big, x + wd / 2, py + 31, F.b, 25, ink); k.centre(small, x + wd / 2, py + 48, F.r, 8.4, sub); };
  tile(BX + 20, 92, `$${dues}`, 'Membership dues', WHITE, BLUE, GREY);
  k.centre('+', BX + 20 + 92 + 12, py + 34, F.b, 18, SKY);
  tile(BX + 20 + 92 + 24, 92, `$${joining}`, 'Once-off joining fee', WHITE, BLUE, GREY);
  k.centre('=', BX + 20 + 2 * 92 + 24 + 12, py + 34, F.b, 18, SKY);
  tile(BX + 20 + 2 * 92 + 48, 100, `$${total}`, `for ${months} months *`, YELLOW, BLUE, BLUE, WHITE);   // a white edge round the yellow: it still stands out when printed in grey
  k.para(`* ${renewal}`, BX + 20, py + ph + 14, 300, F.i, 7.4, SKY, 9);

  // who to talk to, and how to pay
  const px = BX + 370;
  k.rect(px - 14, BT + 22, 0.8, BH - 44, c('#2F6483'));
  k.text('TALK TO US', px, BT + 36, F.b, 8.5, YELLOW, { spacing: 1.3 });
  k.text(ctx.contact.name, px, BT + 56, F.b, 12.5, WHITE);
  k.text(`${ctx.contact.role}  ·  ${ctx.contact.phone}`, px, BT + 71, F.r, 8.8, SKY);
  k.text('PAY BY', px, BT + 104, F.b, 8.5, YELLOW, { spacing: 1.3 });
  let cx = px;
  pay.forEach(([name, star]) => {
    const label = star ? `${name} **` : name, wd = k.w(F.b, 8.8, label) + 16;
    k.rr(cx, BT + 112, wd, 16, 8, null, WHITE);
    k.centre(label, cx + wd / 2, BT + 123.4, F.b, 8.8, WHITE);
    cx += wd + 5;
  });
  if (pay.some(([, st]) => st)) k.para(`** ${note}`, px, BT + 145, BX + BW - px - 12, F.i, 7.4, SKY, 9);

  pdf.setTitle(`Welcome to ${ctx.clubName}`);
  pdf.setProducer('Brekkie');
  return pdf.save();
}
