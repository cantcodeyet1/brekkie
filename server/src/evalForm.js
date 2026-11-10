// Fills Toastmasters International's own evaluation forms (server/templates/eval-forms) with an evaluator's notes.
// The forms are fillable PDFs, but they are also encrypted (empty password), which pdf-lib cannot open, so the fields
// are filled with pdf.js and saved back as an incremental update. Fields are found by where they sit next to the
// printed labels, because the field names in the files are just numbers. Project-specific criteria that are not
// among the seven standard ones are left blank for the evaluator to finish in any PDF reader.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EVAL_FORMS = path.join(here, '..', 'templates', 'eval-forms');
export const CRITERIA = ['Clarity', 'Vocal Variety', 'Eye Contact', 'Gestures', 'Audience Awareness', 'Comfort Level', 'Interest'];

let pdfjs;
const lib = async () => (pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs'));

const norm = (s) => s.replace(/\s+/g, ' ').replace(/:$/, '').trim().toLowerCase();

/** the file name of an evaluation form from a "/api/eval-forms/x.pdf" style path, or null when it is not one of ours */
export function formFile(url) {
  const m = /^\/api\/eval-forms\/([a-z0-9-]+\.pdf)$/.exec(url || '');
  return m ? m[1] : null;
}

/**
 * data: { member, evaluator, date, title, excelled, work, challenge, ratings: [1-5 | null] x7, comments: [string] x7 }
 * returns the filled PDF as a Buffer, and how many fields it could place
 */
export async function fillEvalForm(file, data) {
  const { getDocument } = await lib();
  const src = new Uint8Array(await fs.readFile(path.join(EVAL_FORMS, file)));
  const doc = await getDocument({ data: src, verbosity: 0, isEvalSupported: false }).promise;
  const store = doc.annotationStorage;
  let placed = 0;
  const put = (a, value) => { store.setValue(a.id, { value }); placed++; };
  const done = new Set();                                   // a label that appears on several pages is only filled once

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const widgets = (await page.getAnnotations()).filter((a) => a.subtype === 'Widget');
    const texts = (await page.getTextContent()).items.filter((t) => t.str.trim()).map((t) => ({ s: t.str.trim(), x: t.transform[4], y: t.transform[5] }));
    const boxes = widgets.filter((a) => a.fieldType === 'Tx' && !a.readOnly).map((a) => ({ a, x1: a.rect[0], y1: a.rect[1], x2: a.rect[2], y2: a.rect[3] }));
    const label = (re) => texts.find((t) => re.test(norm(t.s)));

    // the one-line fields to the right of "Member Name", "Date", ...
    const inline = (key, re, value) => {
      if (!value || done.has(key)) return;
      const l = label(re); if (!l) return;
      const f = boxes.filter((b) => b.y1 - 3 <= l.y && l.y <= b.y2 + 3 && b.x1 > l.x).sort((p, q) => p.x1 - q.x1)[0];
      if (f) { put(f.a, String(value)); done.add(key); }
    };
    inline('member', /^member name$/, data.member);
    inline('date', /^date$/, data.date);
    inline('evaluator', /^evaluator$/, data.evaluator);
    inline('title', /^speech title$/, data.title);

    // the three large comment boxes under "You excelled at:" and so on
    const below = (key, re, value) => {
      if (!value || done.has(key)) return;
      const l = label(re); if (!l) return;
      const f = boxes.filter((b) => b.y2 <= l.y + 6 && l.y - b.y2 < 60 && b.y2 - b.y1 > 28 && Math.abs(b.x1 - l.x) < 30).sort((p, q) => q.y2 - p.y2)[0];
      if (f) { put(f.a, String(value)); done.add(key); }
    };
    below('excelled', /^you excelled at$/, data.excelled);
    below('work', /^you may want to work on$/, data.work);
    below('challenge', /^to challenge yourself$/, data.challenge);

    // one row per criterion: five radio buttons (5 Exemplary to 1 Developing, left to right) and a comment line under them
    const groups = new Map();
    for (const a of widgets) if (a.radioButton) (groups.get(a.fieldName) || groups.set(a.fieldName, []).get(a.fieldName)).push(a);
    for (const btns of groups.values()) {
      const top = Math.max(...btns.map((b) => b.rect[3])), bottom = Math.min(...btns.map((b) => b.rect[1]));
      const lab = texts.filter((t) => t.y > top && t.y - top < 40 && t.x < 60 && t.s.endsWith(':')).sort((p, q) => p.y - q.y)[0];
      const i = lab ? CRITERIA.findIndex((c) => c.toLowerCase() === norm(lab.s)) : -1;
      if (i < 0 || done.has('c' + i)) continue;
      const rating = data.ratings?.[i];
      if (rating >= 1 && rating <= 5) {
        const ordered = [...btns].sort((p, q) => p.rect[0] - q.rect[0]);
        ordered.forEach((b, k) => store.setValue(b.id, { value: k === 5 - rating }));
        placed++;
      }
      const note = data.comments?.[i];
      if (note) {
        const f = boxes.filter((b) => b.y2 <= bottom + 4 && bottom - b.y2 < 70).sort((p, q) => q.y2 - p.y2)[0];
        if (f) put(f.a, String(note));
      }
      done.add('c' + i);
    }
  }
  const out = await doc.saveDocument();
  await doc.destroy();
  return { pdf: Buffer.from(out), placed };
}
