// An A4 page with one big QR code for a meeting's from-the-room feedback link.
//   node server/scripts/feedback-poster.mjs <link> "<small line, e.g. Champions Toastmasters Club, 13 November 2026>" <out.pdf>
import fs from 'node:fs';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const [url, when = '', out = 'feedback-poster.pdf'] = process.argv.slice(2);
if (!/^https?:\/\//.test(url || '')) { console.error('Give the feedback link first'); process.exit(1); }
const pdf = await PDFDocument.create();
const page = pdf.addPage([595.28, 841.89]);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold), reg = await pdf.embedFont(StandardFonts.Helvetica);
const BLUE = rgb(0, 0.255, 0.396), GREY = rgb(0.35, 0.35, 0.35);
const centre = (s, y, size, font, color) => page.drawText(s, { x: (595.28 - font.widthOfTextAtSize(s, size)) / 2, y, size, font, color });

centre('Got some feedback?', 742, 54, bold, BLUE);
centre('Let us know.', 682, 54, bold, BLUE);

const qr = QRCode.create(url, { errorCorrectionLevel: 'M' }), n = qr.modules.size, quiet = 2;
const box = 430, cell = box / (n + quiet * 2), x0 = (595.28 - box) / 2, y0 = 640 - box;
page.drawRectangle({ x: x0, y: y0, width: box, height: box, color: rgb(1, 1, 1) });
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
  if (qr.modules.get(r, c)) page.drawRectangle({ x: x0 + (c + quiet) * cell, y: y0 + box - (r + quiet + 1) * cell, width: cell + 0.2, height: cell + 0.2, color: BLUE });
}
centre('Scan with your phone camera', y0 - 40, 24, bold, GREY);
if (when) centre(when, y0 - 76, 20, reg, GREY);
centre(url, 44, 11, reg, GREY);
pdf.setTitle('Room feedback');
fs.writeFileSync(out, await pdf.save());
console.log('wrote', out);
