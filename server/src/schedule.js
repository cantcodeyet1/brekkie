// The club meets on the 2nd and 4th Friday of every month. Meeting No. 9 is Friday 13 November 2026, so
// counting back, No. 1 was Friday 10 July 2026. This builds the calendar and lines the database up with it.
import crypto from 'node:crypto';
import { initDb, q, tx } from './db.js';

const SERIES_START = '2026-07-01';   // first month of the series (No. 1 is the 2nd Friday of July 2026)
const SERIES_END = '2027-06-30';
const iso = (d) => d.toISOString().slice(0, 10);
const token = () => crypto.randomBytes(15).toString('base64url');

/** All 2nd and 4th Fridays between two ISO dates, inclusive. */
export function clubFridays(from, to) {
  const out = [], end = new Date(to + 'T12:00:00');
  for (let d = new Date(from + 'T12:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 5) continue;
    const nth = Math.ceil(d.getDate() / 7);
    if (nth === 2 || nth === 4) out.push(iso(d));
  }
  return out;
}
export const buildSchedule = () => clubFridays(SERIES_START, SERIES_END).map((date, i) => ({ number: i + 1, date }));

/** The next 2nd or 4th Friday strictly after a date. Used when the VPE adds a meeting. */
export function nextClubDate(afterIso) {
  const d = new Date(afterIso + 'T12:00:00');
  for (let i = 0; i < 60; i++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 5 && [2, 4].includes(Math.ceil(d.getDate() / 7))) return iso(d);
  }
  d.setDate(d.getDate() + 14); return iso(d);
}

const ROLE_DEFS = [
  ['toastmaster', 'Toastmaster of the Day'], ['grammarian', 'Grammarian'], ['ah_counter', 'Ah Counter'], ['timer', 'Timer'],
  ['topicsmaster', 'Topicsmaster'], ['speaker', 'Speaker 1'], ['speaker', 'Speaker 2'], ['speaker', 'Speaker 3'],
  ['general_evaluator', 'General Evaluator'], ['evaluator', 'Speech Evaluator 1'], ['evaluator', 'Speech Evaluator 2'], ['evaluator', 'Speech Evaluator 3'],
];
const THEME_FIELDS = ['theme', 'theme_quote', 'theme_quote_by', 'word', 'pos', 'pron', 'meaning', 'example', 'synonyms'];

/** Renumber the demo meetings onto the real calendar, then make sure every meeting up to 30 June exists. Safe to run twice. */
export async function applySchedule() {
  const sched = buildSchedule();
  const nov13 = sched.find((s) => s.date === '2026-11-13');
  if (nov13?.number !== 9) throw new Error(`Calendar check failed: 13 Nov 2026 should be No. 9 but is No. ${nov13?.number}`);
  return tx(async (t) => {
    const [club] = await t('select id from clubs order by id limit 1');
    if (!club) return { created: 0 };
    // the demo set was numbered 139 to 147; they become 4 to 12 (past meetings 4 to 8, the next meeting is 9)
    const moved = await t('update meetings set number = number - 135 where club_id=$1 and number >= 139 returning number', [club.id]);
    // the club's real Oct 23 theme and word belonged to the "next meeting" of the demo; give them to No. 8
    if (moved.length) {
      const [a] = await t('select * from meetings where club_id=$1 and number=8', [club.id]);
      const [b] = await t('select * from meetings where club_id=$1 and number=9', [club.id]);
      if (a && b && b.theme === 'Boundless Learning') {
        for (const [from, to] of [[b, a], [a, b]]) await t(`update meetings set ${THEME_FIELDS.map((f, i) => `${f}=$${i + 1}`).join(', ')} where id=$${THEME_FIELDS.length + 1}`, [...THEME_FIELDS.map((f) => from[f]), to.id]);
      }
    }
    for (const s of sched) await t('update meetings set date=$1 where club_id=$2 and number=$3', [s.date, club.id, s.number]);
    const have = new Set((await t('select number from meetings where club_id=$1', [club.id])).map((r) => r.number));
    let created = 0;
    for (const s of sched.filter((x) => !have.has(x.number))) {
      const [m] = await t('insert into meetings(club_id,number,date,feedback_code) values ($1,$2,$3,$4) returning id', [club.id, s.number, s.date, token().slice(0, 10)]);
      for (let i = 0; i < ROLE_DEFS.length; i++) await t('insert into meeting_roles(meeting_id,role_key,label,position,token) values ($1,$2,$3,$4,$5)', [m.id, ROLE_DEFS[i][0], ROLE_DEFS[i][1], i, token()]);
      const roles = await t('select id, label from meeting_roles where meeting_id=$1', [m.id]);
      for (const n of [1, 2, 3]) await t('update meeting_roles set target_role_id=$1 where meeting_id=$2 and label=$3', [roles.find((r) => r.label === `Speaker ${n}`).id, m.id, `Speech Evaluator ${n}`]);
      created++;
    }
    return { created, total: sched.length };
  });
}

if (process.argv[1] && process.argv[1].endsWith('schedule.js')) {
  await initDb();
  const r = await applySchedule();
  const rows = await q(`select number, to_char(date,'Dy DD Mon YYYY') as d from meetings order by number`);
  console.log(`Schedule applied. Created ${r.created} meetings, ${rows.length} in total.`);
  console.log(rows.map((m) => `${m.number}: ${m.d}`).join('\n'));
  process.exit(0);
}
