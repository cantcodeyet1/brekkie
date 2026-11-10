// Loads the Pathways V6 catalog (server/data/pathways.json, parsed from the club's PathwaysV6.pdf) into the database:
// every project once in `projects`, and which paths and levels it appears in via `path_projects`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, tx } from './db.js';
import { applyFormText } from './formtext.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'data', 'pathways.json');
const HOME_PATH = 'Presentation Mastery';       // where a project that appears in several paths is shown first
const KEEP_FORM_TEXT = new Set(['Evaluation and Feedback']);   // its evaluator notes come from the club's real evaluation form

const lengthOf = (sp) => (sp ? { text: `${sp.min}–${sp.max} minutes`, g: sp.min * 60, y: Math.round(((sp.min + sp.max) / 2) * 60), r: sp.max * 60 } : { text: '5–7 minutes', g: 300, y: 360, r: 420 });

export async function importPathways() {
  const cat = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  // where each project lives first
  const home = {};
  for (const p of cat.paths) for (const lv of p.levels) for (const n of [...lv.required, ...lv.electives]) {
    const cur = home[n];
    if (!cur || (p.name === HOME_PATH && cur.path !== HOME_PATH)) home[n] = { path: p.name, level: lv.level };
  }
  await tx(async (t) => {
    // the demo used a project name that is not in V6; the nearest real one is Understanding Vocal Variety
    await t(`update projects set name='Understanding Vocal Variety' where name='Introduction to Vocal Variety' and not exists (select 1 from projects where name='Understanding Vocal Variety')`);
    const ids = {};
    for (const [name, info] of Object.entries(cat.projects)) {
      const len = lengthOf(info.speech), h = home[name] || { path: HOME_PATH, level: 1 };
      const [ex] = await t('select id from projects where name=$1', [name]);
      const purpose = JSON.stringify(info.purpose ? [info.purpose] : []), about = JSON.stringify(info.includes || []);
      if (ex) {
        const keep = KEEP_FORM_TEXT.has(name);
        await t('update projects set level=$1, path=$2, length_text=$3, green=$4, yellow=$5, red=$6, overview=$7, description=$8 where id=$9', [h.level, h.path, len.text, len.g, len.y, len.r, info.overview, info.description, ex.id]);
        if (!keep) await t('update projects set purpose=$1, notes=$2, about=$3, form_title=$4 where id=$5', [purpose, info.overview, about, name, ex.id]);
        ids[name] = ex.id;
      } else {
        const [r] = await t('insert into projects(name,level,path,form_title,length_text,green,yellow,red,purpose,notes,about,overview,description) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id',
          [name, h.level, h.path, name, len.text, len.g, len.y, len.r, purpose, info.overview, about, info.overview, info.description]);
        ids[name] = r.id;
      }
    }
    await t('delete from path_projects');
    for (const p of cat.paths) for (const lv of p.levels) {
      let pos = 0;
      for (const [kind, list] of [['required', lv.required], ['elective', lv.electives]]) for (const n of list) {
        if (!ids[n]) continue;
        await t('insert into path_projects(path,level,level_title,kind,pos,choose,project_id) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing', [p.name, lv.level, lv.title, kind, ++pos, lv.choose || 0, ids[n]]);
      }
    }
  });
  await backfillPaths();
  await applyFormText();
  const [c] = await q('select count(*)::int as projects, (select count(distinct path)::int from path_projects) as paths from projects');
  return c;
}

/** Speakers and evaluations created before paths existed get their project's home path and level. */
export async function backfillPaths() {
  const homes = await q(`select distinct on (project_id) project_id, path, level from path_projects order by project_id, (path = $1) desc, path, level`, [HOME_PATH]);
  for (const h of homes) {
    await q('update meeting_roles set path_name=$1, path_level=$2 where project_id=$3 and path_name is null', [h.path, h.level, h.project_id]);
    await q('update evaluations set path_name=$1, path_level=$2 where project_id=$3 and path_name is null', [h.path, h.level, h.project_id]);
  }
}

export async function ensurePathways() {
  if (!fs.existsSync(FILE)) return;
  // load on first start, and again whenever the catalog file gains a project the database does not have yet
  const names = Object.keys(JSON.parse(fs.readFileSync(FILE, 'utf8')).projects);
  const [r] = await q('select count(*)::int as n, (select count(*)::int from projects where name = any($1)) as have from path_projects', [names]);
  if (!r.n || r.have < names.length) { const c = await importPathways(); console.log(`Loaded the Pathways catalog: ${c.projects} projects in ${c.paths} paths.`); }
}

if (process.argv[1] && process.argv[1].endsWith('pathways.js')) {
  await initDb();
  const c = await importPathways();
  console.log(`Pathways catalog loaded: ${c.projects} projects in ${c.paths} paths.`);
  process.exit(0);
}
