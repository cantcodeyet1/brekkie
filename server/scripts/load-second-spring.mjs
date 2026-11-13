// Loads Second Spring Toastmasters Club from its own agenda (Agenda Second Spring.pdf, meeting of 10 November 2026)
// into the local database: the club's details, its officers and members, and that meeting with its role takers.
// Run with the API stopped (the local database is a single-process file store):  node server/scripts/load-second-spring.mjs
process.env.VERCEL = '1';
process.env.DEMO_MODE = 'true';
import http from 'node:http';
import crypto from 'node:crypto';

const { default: app, ready } = await import('../src/index.js');
const { q } = await import('../src/db.js');
await ready;
const server = http.createServer(app);
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
async function call(method, path, body, tok) {
  const r = await fetch(base + path, { method, headers: { ...(tok ? { 'x-token': tok } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return json;
}

if ((await q(`select 1 as x from clubs where tm_number='28676885'`)).length) { console.log('Second Spring is already loaded'); process.exit(0); }

const PEOPLE = [
  ['Miriam Sibanda', 'TM', '+263 719553263'], ['Felistas Chikaura', 'TM', '+263 773053499'], ['Martha Mpakula', 'DTM', '+263 788961921'],
  ['Joselyn Matizanhau', 'DTM', '+263 777224933'], ['Thandiwe Sithole', 'TM', '+263 772421467'], ['Memory Janyure-Nenguwo', 'TM', '+263 772938949'],
  ['Zorodzai Machekanyanga', 'TM', '+263 773780077'], ['Nyasha Ann Marie Chiwuta', 'TM', ''], ['Thandazani Mahubaba', 'TM', ''],
  ['Nkululeko Gondo', 'TM', ''], ['Tiro Molebatsi', 'TM', ''],
];
const made = await call('POST', '/api/clubs', {
  name: 'Miriam Sibanda', email: 'vpe@secondspring.example.com', password: crypto.randomBytes(9).toString('base64url') + 'a1',
  club: { name: 'Second Spring Toastmasters Club', number: '28676885', firstNumber: 1, pattern: { day: 2, mode: 'fortnightly', weeks: [], time: '18:00', place: '', start: '2026-11-10' } },
  members: PEOPLE.slice(1).map(([name, credential, phone]) => ({ name, credential, phone })),
});
const club = (await q(`select id from clubs where tm_number='28676885'`))[0].id;
await q(`update people set phone=$1, credential='TM', credential_manual=false where club_id=$2 and name='Miriam Sibanda'`, ['+263 719553263', club]);
const vpe = (await q(`select token from people where club_id=$1 and is_vpe`, [club]))[0].token;
const id = async (name) => (await q('select id from people where club_id=$1 and name=$2', [club, name]))[0].id;

// the club's own details for the agenda page
await call('PUT', '/api/vpe/club', {
  pattern: { day: 2, mode: 'fortnightly', weeks: [], time: '18:00', place: '', start: '2026-11-10' }, name: 'Second Spring Toastmasters Club', number: '28676885',
  agenda_profile: {
    region: 'Area 4, Division C, District 129',
    mission: 'We provide a supportive and positive learning experience in which members are empowered to develop communication and leadership skills, resulting in greater self confidence and personal growth.',
    officers: [['President', 'Felistas Chikaura'], ['VP Education', 'Miriam Sibanda'], ['VP Membership', 'Martha Mpakula'], ['VP Public Relations', 'Joselyn Matizanhau'],
      ['Secretary', 'Thandiwe Sithole'], ['Treasurer', 'Memory Janyure-Nenguwo'], ['Sergeant-At-Arms', 'Zorodzai Machekanyanga']].map(([role, name]) => ({ role, name, phone: PEOPLE.find((p) => p[0] === name)[2] })),
  },
}, vpe);
// their running order: the standard one, with Table Topics at 10 minutes
const { STD_BLOCKS } = await import('../src/agenda.js');
await call('PUT', '/api/vpe/agenda-standard', { start: '1800', blocks: STD_BLOCKS.map((b) => (b.id === 'topics' ? { ...b, min: 10 } : b)) }, vpe);

// paths: Joselyn is on Visionary Communication (Level 3), Tiro on Presentation Mastery (Level 4)
await q(`update people set path_name='Visionary Communication', path_level=3 where id=$1`, [await id('Joselyn Matizanhau')]);
await q(`update people set path_name='Presentation Mastery', path_level=4 where id=$1`, [await id('Tiro Molebatsi')]);
const proj = async (name) => (await q('select id from projects where name=$1', [name]))[0]?.id;

// the 10 November meeting
const [m] = await q(`select id from meetings where club_id=$1 and date='2026-11-10'`, [club]);
await call('PATCH', `/api/vpe/meetings/${m.id}`, { theme: 'The Heat is On', theme_quote: 'Amazing women don’t get hot flushes, they get power surges!', word: 'Effulgent', pos: 'adj.', meaning: 'Radiant, splendorous, glow, shining', example: 'She looks effulgent even as a Meno Queen', synonyms: 'Radiant, glowing' }, vpe);
const slots = await q(`select id, role_key, label from meeting_roles where meeting_id=$1 order by position`, [m.id]);
const slot = (label) => slots.find((s) => s.label === label).id;
const put = async (label, who, extra = {}) => call('PATCH', `/api/vpe/roles/${slot(label)}`, { person_id: await id(who), ...extra }, vpe);
await put('Toastmaster of the Day', 'Nyasha Ann Marie Chiwuta'); await put('General Evaluator', 'Joselyn Matizanhau'); await put('Grammarian', 'Thandazani Mahubaba');
await put('Ah Counter', 'Thandiwe Sithole'); await put('Timer', 'Nkululeko Gondo'); await put('Topicsmaster', 'Felistas Chikaura');
await put('Speaker 1', 'Joselyn Matizanhau', { path_name: 'Visionary Communication', path_level: 3, project_id: await proj('Develop a Communication Plan'), part: 1, speech_title: 'Le projet sur la France.' });
await put('Speaker 2', 'Tiro Molebatsi', { path_name: 'Presentation Mastery', path_level: 4, project_id: await proj('Managing a Difficult Audience'), part: 1, speech_title: 'We all start somewhere.' });
await put('Speech Evaluator 1', 'Miriam Sibanda', { target_role_id: slot('Speaker 1') }); await put('Speech Evaluator 2', 'Martha Mpakula', { target_role_id: slot('Speaker 2') });
const joselyn = (await q('select token from people where id=$1', [await id('Joselyn Matizanhau')]))[0].token;
console.log(JSON.stringify({ club, meeting: m.id, vpe, joselyn, meetings: made.meetings, members: made.members_added }));
process.exit(0);
