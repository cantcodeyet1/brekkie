// Makes the blank pages the PDF agenda is drawn on (server/templates/agenda-base-N.pdf).
// Each is the club's Word template with everything that changes from meeting to meeting taken out, and a gap where the
// running order goes. N = 0, 1, 2 give a gap that is taller each time (the banner at the bottom moves down with it).
// Needs Microsoft Word or LibreOffice on this computer (see docx-to-pdf.mjs). Run after changing templates/agenda.docx:
//   node server/scripts/make-agenda-base.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocx } from '../src/agenda.js';
import { docxToPdf } from './docx-to-pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const ag = { blocks: [], speeches: [], roles: {}, next_meeting: '2026-01-01', reports: { items: [] } };
const ctx = { m: { date: '2026-01-01', theme: '', word: '' } };
const EXTRA = [0, 80, 160];                    // points the banner moves down for each variant

async function bannerY(pdf) {
  const doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const t = tc.items.find((x) => x.str.startsWith('CALLING ALL'));
  await doc.destroy();
  return t ? t.transform[5] : null;
}
let h0 = 340, y0 = null;
for (const [n, extra] of EXTRA.entries()) {
  let h = n === 0 ? h0 : h0 + extra, pdf, y;
  for (let k = 0; k < 4; k++) {
    pdf = await docxToPdf(await buildDocx(ag, ctx, { base: h }));
    y = await bannerY(pdf);
    const want = y0 === null ? 211.5 : y0 - extra;
    if (y === null || Math.abs(y - want) < 0.6) break;
    h += y - want;                              // too high on the page (y larger) needs more gap
  }
  if (n === 0) { y0 = y; h0 = h; }
  await fs.writeFile(path.join(here, '..', 'templates', `agenda-base-${n}.pdf`), pdf);
  console.log(`base ${n}: gap ${h.toFixed(1)}pt, banner text at y=${y?.toFixed(1)}`);
}
