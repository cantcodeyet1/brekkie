// Club isolation: two clubs share one database. Nothing one club's people can do, with any token or any id, may read or change the other's data.
process.env.VERCEL = '1';
process.env.PGLITE_DIR = 'memory://';
process.env.DEMO_MODE = 'true';
delete process.env.DATABASE_URL;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { default: app, ready } = await import('../src/index.js');
const { q } = await import('../src/db.js');

let server, base;
const A = {}, B = {};
// words that exist only in club B: if one shows up in a response to club A, data has leaked
const SECRETS = ['ZZBravoMember', 'ZZBravoTheme', 'ZZBravoTitle', 'zzbravo-member@leak.test', 'zzbravo-vpe@leak.test', 'ZZBravoClub', '+263700000999', 'ZZBravoNote', 'ZZBravoWell'];

async function call(method, path, { token, body } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { 'x-token': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, buf };
}
const pattern = { day: 5, mode: 'weekly', start: new Date().toISOString().slice(0, 10), time: '07:00' };
async function mkClub(tag, number, names) {
  const r = await call('POST', '/api/clubs', { body: { name: names.vpe, email: `${names.email}`, password: 'secret-pass-1', club: { name: names.club, number, firstNumber: 1, pattern } } });
  assert.equal(r.status, 200, r.text);
  return r.json.token;
}

before(async () => {
  await ready;
  server = http.createServer(app);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;

  A.vpe = await mkClub('A', '70001', { vpe: 'Alpha Vpe', email: 'alpha-vpe@ok.test', club: 'Alpha Club' });
  B.vpe = await mkClub('B', '70002', { vpe: 'ZZBravoMember Vpe', email: 'zzbravo-vpe@leak.test', club: 'ZZBravoClub' });

  // club B gets a member, a theme, an assigned speaker role with a title, a plan, an evaluation, peer feedback
  const m = await call('POST', '/api/vpe/people', { token: B.vpe, body: { name: 'ZZBravoMember', email: 'zzbravo-member@leak.test', phone: '+263700000999' } });
  assert.equal(m.status, 200, m.text);
  B.person = m.json.id;
  B.memberToken = (await q('select token from people where id=$1', [B.person]))[0].token;
  B.meeting = (await call('GET', '/api/vpe/meetings', { token: B.vpe })).json.find(() => true);
  const list = (await call('GET', '/api/vpe/meetings', { token: B.vpe })).json;
  B.meeting = (Array.isArray(list) ? list : list.meetings)[0];
  await call('PATCH', `/api/vpe/meetings/${B.meeting.id}`, { token: B.vpe, body: { theme: 'ZZBravoTheme' } });
  const md = (await call('GET', `/api/vpe/meetings/${B.meeting.id}`, { token: B.vpe })).json;
  B.speakerRole = md.roles.find((r) => r.role_key === 'speaker');
  B.evalRole = md.roles.find((r) => r.role_key === 'evaluator');
  B.grammarian = md.roles.find((r) => r.role_key === 'grammarian');
  await call('PATCH', `/api/vpe/roles/${B.speakerRole.id}`, { token: B.vpe, body: { person_id: B.person, speech_title: 'ZZBravoTitle' } });
  await call('PATCH', `/api/vpe/roles/${B.grammarian.id}`, { token: B.vpe, body: { person_id: B.person } });
  B.roleToken = (await q('select token from meeting_roles where id=$1', [B.grammarian.id]))[0].token;
  B.feedbackCode = (await q('select feedback_code from meetings where id=$1', [B.meeting.id]))[0].feedback_code;
  const [proj] = await q(`select id from projects where name='Ice Breaker'`);
  B.plan = (await q(`insert into speech_plans(club_id, person_id, project_id, title, date) values ((select club_id from people where id=$1), $1, $2, 'ZZBravoTitle', '2030-02-01') returning id`, [B.person, proj.id]))[0].id;
  B.evaluation = (await q(`insert into evaluations(role_id, meeting_id, speaker_id, project_id, title, ratings, comments, excelled, work, challenge) values ($1,$2,$3,$4,'ZZBravoTitle','[5,5,5,5,5,5,5]','[]','ZZBravoNote','ZZBravoNote','ZZBravoNote') returning id`, [B.evalRole.id, B.meeting.id, B.person, proj.id]))[0].id;
  B.peer = (await q(`insert into peer_feedback(meeting_id, to_person_id, from_name, well, improve) values ($1,$2,'someone','ZZBravoWell','ZZBravoWell') returning id`, [B.meeting.id, B.person]))[0].id;
  B.resetToken = 'zzbravo-reset-token-0123456789';
  await q(`update people set reset_token=$1, reset_expires=now() + interval '1 day' where id=$2`, [B.resetToken, B.person]);
  SECRETS.push(B.memberToken, B.roleToken, B.vpe, B.feedbackCode, B.resetToken);

  // club A: a member, and a role holder
  const am = await call('POST', '/api/vpe/people', { token: A.vpe, body: { name: 'Alpha Member', email: 'alpha-member@ok.test' } });
  A.person = am.json.id;
  A.memberToken = (await q('select token from people where id=$1', [A.person]))[0].token;
  const alist = (await call('GET', '/api/vpe/meetings', { token: A.vpe })).json;
  A.meeting = (Array.isArray(alist) ? alist : alist.meetings)[0];
  const amd = (await call('GET', `/api/vpe/meetings/${A.meeting.id}`, { token: A.vpe })).json;
  A.role = amd.roles.find((r) => r.role_key === 'grammarian');
  A.speaker = amd.roles.find((r) => r.role_key === 'speaker');
  await call('PATCH', `/api/vpe/roles/${A.role.id}`, { token: A.vpe, body: { person_id: A.person } });
  A.roleToken = (await q('select token from meeting_roles where id=$1', [A.role.id]))[0].token;
  A.guest = (await call('POST', '/api/vpe/people', { token: A.vpe, body: { name: 'Alpha Visitor', kind: 'guest' } })).json;
});
after(() => server?.close());

// everything of club B's that must not change: a fingerprint of its rows
const fingerprint = async () => JSON.stringify([
  await q(`select * from meetings where club_id=(select club_id from people where id=$1) order by id`, [B.person]),
  await q(`select * from people where club_id=(select club_id from people where id=$1) order by id`, [B.person]),
  await q(`select r.* from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=(select club_id from people where id=$1) order by r.id`, [B.person]),
  await q(`select * from speech_plans where club_id=(select club_id from people where id=$1) order by id`, [B.person]),
  await q('select * from evaluations where speaker_id=$1 order by id', [B.person]),
  await q('select * from peer_feedback where to_person_id=$1 order by id', [B.person]),
  await q('select * from member_projects where person_id=$1 order by 1,2', [B.person]),
  await q('select * from clubs order by id'),
]);

const sub = (s, extra = {}) => s
  .replace('{M}', B.meeting.id).replace('{N}', B.meeting.number).replace('{R}', B.speakerRole.id).replace('{G}', B.grammarian.id).replace('{E}', B.evalRole.id)
  .replace('{P}', B.person).replace('{PL}', B.plan).replace('{EV}', B.evaluation).replace('{PF}', B.peer).replace('{CODE}', B.feedbackCode)
  .replace('{AR}', A.role.id).replace('{AP}', A.person).replace('{AM}', A.meeting.id);

// [method, path, body]. Every one is aimed at club B's ids.
const ATTACKS = [
  ['GET', '/api/vpe/evaluations/{EV}'], ['GET', '/api/vpe/evaluations/{EV}/form.pdf'], ['GET', '/api/me/evaluations/{EV}'], ['GET', '/api/me/evaluations/{EV}/form.pdf'],
  ['DELETE', '/api/vpe/meetings/{M}'], ['POST', '/api/vpe/meetings/{M}/reset-feedback', {}], ['PATCH', '/api/vpe/meetings/{M}', { theme: 'HACKED' }], ['GET', '/api/vpe/meetings/{M}'],
  ['PATCH', '/api/vpe/peer/{PF}', { hidden: true }], ['POST', '/api/vpe/meetings/{M}/roles', { key: 'speaker' }], ['DELETE', '/api/vpe/roles/{R}'],
  ['GET', '/api/vpe/meetings/{M}/agenda'], ['PUT', '/api/vpe/meetings/{M}/agenda', { start: '1900' }], ['POST', '/api/vpe/meetings/{M}/agenda/reset', { what: 'all' }],
  ['GET', '/api/vpe/meetings/{M}/agenda.docx'], ['GET', '/api/vpe/meetings/{M}/agenda.pdf'], ['GET', '/api/me/meetings/{M}/agenda.docx'],
  ['GET', '/api/vpe/roles/{R}/submission'], ['GET', '/api/vpe/roles/{G}/submission'], ['GET', '/api/vpe/roles/{G}/report.pdf'], ['GET', '/api/me/given/{G}'], ['GET', '/api/me/given/{G}/report.pdf'],
  ['PATCH', '/api/vpe/roles/{R}', { person_id: null, speech_title: 'HACKED' }], ['PATCH', '/api/vpe/roles/{G}', { person_id: '{AP}' }], ['POST', '/api/vpe/roles/{R}/regenerate', {}],
  ['POST', '/api/vpe/people/{P}/electives', { project_id: 1 }], ['GET', '/api/vpe/people/{P}/path'], ['POST', '/api/vpe/people/{P}/plans', { title: 'HACKED', date: '2030-03-01', project_id: 1 }],
  ['DELETE', '/api/me/plans/{PL}'], ['PATCH', '/api/me/plans/{PL}', { title: 'HACKED' }], ['POST', '/api/vpe/plans/{PL}/complete', {}],
  ['POST', '/api/vpe/people/{P}/projects', { project_id: 1, done: true }], ['PATCH', '/api/vpe/people/{P}', { name: 'HACKED', is_vpe: true }], ['POST', '/api/vpe/people/{P}/extend', {}],
  ['GET', '/api/vpe/people/{P}/profile'], ['POST', '/api/vpe/people/{P}/reset', {}], ['POST', '/api/admin/people/{P}/reset', {}],
  // B's ids planted into A's own records
  ['PATCH', '/api/vpe/roles/{AR}', { person_id: '{P}' }], ['PATCH', '/api/vpe/roles/{AR}', { target_role_id: '{R}' }], ['PATCH', '/api/vpe/roles/{AR}', { target_role_id: '{E}' }],
  ['POST', '/api/vpe/people/{AP}/plans', { title: 'x', date: '2030-03-01', project_id: 1, person_id: '{P}' }, 'own'],   // on A's own person: may succeed, but must not touch B
];

const asVpe = () => A.vpe, asMember = () => A.memberToken, asRole = () => A.roleToken;
const readOnlyLeaks = (res, what) => { for (const s of SECRETS) assert.ok(!res.text.includes(s) && !res.buf.toString('latin1').includes(s), `${what} leaked "${s}"`); };

test('club A can read or change nothing of club B by id, with a VPE token, a member token or a role link', async () => {
  const before = await fingerprint();
  for (const [token, who] of [[asVpe(), 'A vpe'], [asMember(), 'A member'], [asRole(), 'A role link'], [undefined, 'no token']]) {
    for (const [method, path, body, own] of ATTACKS) {
      const p = sub(path);
      const b = body && JSON.parse(sub(JSON.stringify(body)).replace(/"(\d+)"/g, '$1'));
      const r = await call(method, p, { token, body: b });
      assert.ok(own || r.status !== 200, `${who}: ${method} ${p} answered 200: ${r.text.slice(0, 200)}`);
      assert.ok(r.status < 500, `${who}: ${method} ${p} crashed (${r.status}): ${r.text.slice(0, 200)}`);
      readOnlyLeaks(r, `${who}: ${method} ${p}`);
    }
  }
  assert.equal(await fingerprint(), before, 'club B data was changed');
});

test('a meeting number is looked up inside the caller own club only', async () => {
  const mine = await q('select id from meetings where club_id=(select club_id from people where id=$1) and number=$2', [A.person, B.meeting.number]);
  const r = await call('GET', `/api/me/meetings/${B.meeting.number}`, { token: A.memberToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.meeting.id, mine[0].id, 'must be club A own meeting with that number');
  assert.notEqual(r.json.meeting.id, B.meeting.id);
});

test('every list a club A user can open holds nothing of club B', async () => {
  const LISTS = ['/api/session', '/api/account', '/api/vpe/club/summary', '/api/vpe/meetings', '/api/vpe/roster', '/api/vpe/people', '/api/vpe/dashboard', '/api/vpe/calendar', '/api/vpe/network',
    '/api/me/overview', '/api/me/given', '/api/me/meetings', '/api/me/room', '/api/me/history/gram', '/api/me/history/ah', '/api/me/history/time', '/api/me/evaluations', '/api/me/path', '/api/me/plans',
    '/api/projects', '/api/pathways', '/api/evaluation-resources', '/api/role', '/api/role/agenda.docx', '/api/vpe/meetings/{AM}', '/api/vpe/meetings/{AM}/agenda', '/api/vpe/people/{AP}/profile'];
  for (const [token, who] of [[A.vpe, 'A vpe'], [A.memberToken, 'A member'], [A.roleToken, 'A role link']]) {
    for (const p of LISTS) readOnlyLeaks(await call('GET', sub(p), { token }), `${who}: GET ${p}`);
  }
  // the public ones
  // (/api/dev/accounts is the local demo picker: the next test makes sure it cannot exist in production)
  for (const p of ['/api/health', '/api/clubs/number/70002']) readOnlyLeaks(await call('GET', p), `public GET ${p}`);
});

test('the demo account picker never lists real members: it is off whenever a real database is configured', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /const DEMO = [^\n]*DATABASE_URL/, 'DEMO must be tied to there being no DATABASE_URL');
});

test('a feedback link only ever reaches people of its own club', async () => {
  const page = await call('GET', `/api/f/${B.feedbackCode}`);
  assert.equal(page.status, 200);
  const inB = await q(`select id from people where club_id=(select club_id from people where id=$1)`, [B.person]);
  const ids = new Set(inB.map((x) => x.id));
  for (const p of [...page.json.agenda, ...page.json.others]) assert.ok(ids.has(p.id), `person ${p.id} is not in club B`);
  const before = await q('select count(*)::int as n from peer_feedback');
  const r = await call('POST', `/api/f/${B.feedbackCode}`, { body: { from_name: 'x', items: [{ to_person_id: A.person, well: 'planted', improve: '' }] } });
  assert.equal(r.status, 400, 'a person of club A cannot be given feedback through club B\'s link');
  assert.equal((await q('select count(*)::int as n from peer_feedback'))[0].n, before[0].n);
});

test('a role link is read-only for other meetings: it cannot write to, or read, another club\'s sheet', async () => {
  const w = await call('PUT', '/api/role/sheet', { token: A.roleToken, body: { rows: [{ subject_id: B.person, uses: 3 }] } });
  assert.equal(w.status, 200);                                  // its own sheet saves, but ...
  assert.equal((await q('select count(*)::int as n from gram_notes where subject_id=$1', [B.person]))[0].n, 0, 'a note was written about a person of another club');
  const s = await call('POST', '/api/role/submit', { token: A.roleToken, body: { rows: [{ subject_id: B.person, uses: 3 }] } });
  assert.ok(s.status < 500);
  assert.equal((await q('select count(*)::int as n from gram_notes where subject_id=$1', [B.person]))[0].n, 0);
});

test('signing in finds only the right club, and a wrong password never says which part was wrong', async () => {
  const bad1 = await call('POST', '/api/auth/signin', { body: { email: 'zzbravo-vpe@leak.test', password: 'wrong-password' } });
  const bad2 = await call('POST', '/api/auth/signin', { body: { email: 'nobody-at-all@leak.test', password: 'wrong-password' } });
  assert.equal(bad1.status, 401); assert.equal(bad2.status, 401);
  assert.equal(bad1.text, bad2.text, 'a known and an unknown email must look the same');
  const ok = await call('POST', '/api/auth/signin', { body: { email: 'ZZBravo-VPE@leak.test ', password: 'secret-pass-1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.token, B.vpe);
});

test('a person of club B cannot use their token to reach club A either way round', async () => {
  const s = await call('GET', '/api/session', { token: B.vpe });
  assert.equal(s.json.club, 'ZZBravoClub');
  const people = (await call('GET', '/api/vpe/people', { token: B.vpe })).json;
  for (const p of people) assert.ok(!/^Alpha/.test(p.name), 'club B sees an Alpha person: ' + p.name);
  assert.equal((await call('GET', `/api/vpe/meetings/${A.meeting.id}`, { token: B.vpe })).status, 404);
  assert.equal((await call('GET', `/api/vpe/people/${A.person}/profile`, { token: B.vpe })).status, 404);
});

test('sign-in forgives a space at either end of the password, and the throttle is kept in the database', async () => {
  const email = 'alpha-vpe@ok.test';
  const okSpace = await call('POST', '/api/auth/signin', { body: { email, password: '  secret-pass-1 ' } });
  assert.equal(okSpace.status, 200);
  assert.equal(okSpace.json.token, A.vpe);
  const wrong = { email: 'throttle-me@ok.test', password: 'nope-nope' };
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/auth/signin', { body: wrong })).status, 401);
  assert.equal((await call('POST', '/api/auth/signin', { body: wrong })).status, 429, 'the eleventh try is refused');
  const rows = await q(`select count(*)::int as n from login_failures where key='email:throttle-me@ok.test'`);
  assert.equal(rows[0].n, 10, 'failures are stored in the database, not in memory');
  // a refused guess says nothing about whether the right password would have worked
  assert.equal((await call('POST', '/api/auth/signin', { body: { email: 'throttle-me@ok.test', password: 'secret-pass-1' } })).status, 429);
});

test('a password is stored without a space at either end, so it can be typed the same way later', async () => {
  const c = await call('POST', '/api/clubs', { body: { name: 'Space Vpe', email: 'space-vpe@ok.test', password: '  spaced-pass ', club: { name: 'Space Club', number: '70009', firstNumber: 1, pattern } } });
  assert.equal(c.status, 200, c.text);
  assert.equal((await call('POST', '/api/auth/signin', { body: { email: 'space-vpe@ok.test', password: 'spaced-pass' } })).status, 200);
});
