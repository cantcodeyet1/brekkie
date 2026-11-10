// The official evaluation forms (client/public/eval-forms) hold each project's purpose, the notes for the evaluator and, for a
// project made of several parts, one set of those per part. server/scripts/extract-eval-forms.py reads the forms into
// server/data/project-parts.json; this copies that onto the projects table. Safe to run on every start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'project-parts.json');

/** green / yellow / red seconds for a speech of min..max minutes (the same rule the catalog uses) */
export const limits = (min, max) => ({ green: min * 60, yellow: Math.round(((min + max) / 2) * 60), red: max * 60 });
export const lengthText = (min, max) => `${min}–${max} minutes`;

export async function applyFormText() {
  if (!fs.existsSync(FILE)) return 0;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let n = 0;
  for (const [name, f] of Object.entries(data)) {
    const [p] = await q('select id, parts from projects where name=$1', [name]);
    if (!p) continue;
    const parts = (f.parts || []).map((x) => ({
      n: x.n, label: x.label, kind: x.kind, form: x.form, purpose: x.purpose, notes: x.notes, about: x.about,
      length_text: x.min ? lengthText(x.min, x.max) : x.length_text, ...(x.min ? limits(x.min, x.max) : {}),
    }));
    const first = f.parts?.[0] || f;
    await q('update projects set purpose=$1, notes=$2, about=$3, overview=$4, parts=$5 where id=$6',
      [JSON.stringify(f.purpose || []), first.notes || '', JSON.stringify(first.about || []), '', JSON.stringify(parts), p.id]);
    const len = f.parts ? f.parts[0] : f;
    if (len.min) { const l = limits(len.min, len.max); await q('update projects set length_text=$1, green=$2, yellow=$3, red=$4 where id=$5', [lengthText(len.min, len.max), l.green, l.yellow, l.red, p.id]); }
    // a project that has just become several parts: anyone already marked finished is finished in every part
    if (parts.length > 1 && !(p.parts || []).length) {
      for (const x of parts) await q('insert into member_projects(person_id, project_id, part, done_at, venue) select person_id, project_id, $2, done_at, venue from member_projects where project_id=$1 and part=1 on conflict do nothing', [p.id, x.n]);
    }
    n++;
  }
  return n;
}
