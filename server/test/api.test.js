// API tests: the real Express app against a throwaway in-memory database loaded with the demo data.
process.env.VERCEL = '1';              // do not listen on a port; the tests start their own server
process.env.PGLITE_DIR = 'memory://';  // never touch server/.pglite
process.env.DEMO_MODE = 'true';
delete process.env.DATABASE_URL;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { default: app, ready } = await import('../src/index.js');
const { q } = await import('../src/db.js');
const { hashPw } = await import('../src/club.js');

let server, base, demo, vpe, member;
before(async () => {
  await ready;
  server = http.createServer(app);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  demo = await (await fetch(base + '/api/dev/accounts')).json();
  vpe = demo.people.find((p) => p.is_vpe).token;
  member = demo.people.find((p) => !p.is_vpe && p.kind === 'member').token;
});
after(() => server?.close());

async function call(method, path, { token, body, raw } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { 'x-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const get = (p, token) => call('GET', p, { token });

/* ───────── basics and auth ───────── */
test('health answers', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
});
test('session: no token is 401, bad token is 401', async () => {
  assert.equal((await get('/api/session')).status, 401);
  assert.equal((await get('/api/session', 'nope')).status, 401);
});
test('session: VPE and member are told apart', async () => {
  const v = await get('/api/session', vpe), m = await get('/api/session', member);
  assert.equal(v.json.type, 'vpe'); assert.equal(m.json.type, 'member');
  assert.equal(v.json.super, false);
  assert.ok(v.json.club);
});
test('demo accounts list people and the next meeting roles', async () => {
  assert.ok(demo.people.length > 3);
  assert.ok(demo.people.some((p) => p.is_vpe));
  assert.ok(Array.isArray(demo.roles));
});
test('sign in: validation, wrong password, success, rate limit', async () => {
  assert.equal((await call('POST', '/api/auth/signin', { body: { email: '', password: '' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/signin', { body: { email: 'nobody@example.com', password: 'whatever1' } })).status, 401);
  await q(`update people set email='tester@example.com', password_hash=$1 where token=$2`, [hashPw('goodpass1'), member]);
  const bad = await call('POST', '/api/auth/signin', { body: { email: 'tester@example.com', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/auth/signin', { body: { email: 'TESTER@example.com ', password: 'goodpass1' } });
  assert.equal(ok.status, 200); assert.equal(ok.json.token, member); assert.equal(ok.json.type, 'member');
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/signin', { body: { email: 'spammer@example.com', password: 'x' + i } });
  assert.equal(last.status, 429);
});

test('permissions: members cannot reach VPE routes, strangers get 401', async () => {
  for (const p of ['/api/vpe/people', '/api/vpe/meetings', '/api/vpe/dashboard', '/api/vpe/calendar?from=2026-07-01&to=2027-06-30', '/api/vpe/club/summary']) {
    assert.equal((await get(p, member)).status, 403, p + ' as member');
    assert.equal((await get(p)).status, 401, p + ' as stranger');
    assert.equal((await get(p, vpe)).status, 200, p + ' as vpe');
  }
});
test('super admin routes look like they do not exist for anyone else', async () => {
  for (const t of [vpe, member]) {
    assert.equal((await get('/api/admin/overview', t)).status, 404);
    assert.equal((await get('/api/admin/clubs', t)).status, 404);
  }
  assert.equal((await get('/api/admin/overview')).status, 401, 'no token at all');
  assert.equal((await get('/api/vpe/calendar', vpe)).status, 400, 'calendar needs a range');
});
test('super admin needs the flag AND a password', async () => {
  const [p] = await q('select id from people where token=$1', [vpe]);
  await q('update people set is_super=true, password_hash=null where id=$1', [p.id]);
  assert.equal((await get('/api/admin/overview', vpe)).status, 404, 'flag without a password');
  assert.equal((await get('/api/session', vpe)).json.super, false);
  await q('update people set password_hash=$2 where id=$1', [p.id, hashPw('superpass1')]);
  assert.equal((await get('/api/session', vpe)).json.super, true);
  for (const path of ['/api/admin/overview', '/api/admin/clubs', '/api/admin/people']) assert.equal((await get(path, vpe)).status, 200, path);
  await q('update people set is_super=false where id=$1', [p.id]);
  assert.equal((await get('/api/admin/overview', vpe)).status, 404);
});

/* ───────── accounts: wizard, invites, resets ───────── */
test('club wizard validates, creates a club and signs the VPE in', async () => {
  const good = { name: 'Wiz Ard', email: 'wiz@example.com', password: 'wizpass12', club: { name: 'Test Club', number: '99887', firstNumber: 1, pattern: { day: 5, mode: 'weekly', start: '2026-07-10', time: '07:00' } }, members: [{ name: 'Ann Member', email: 'ann@example.com' }] };
  const post = (b) => call('POST', '/api/clubs', { body: b });
  assert.equal((await post({ ...good, name: 'x' })).status, 400);
  assert.equal((await post({ ...good, email: 'bad' })).status, 400);
  assert.equal((await post({ ...good, password: '123' })).status, 400);
  assert.equal((await post({ ...good, club: { ...good.club, name: '' } })).status, 400);
  assert.equal((await post({ ...good, club: { ...good.club, number: '1' } })).status, 400);
  assert.equal((await post({ ...good, club: { ...good.club, pattern: {} } })).status, 400);
  assert.equal((await call('GET', '/api/clubs/number/99887')).json.taken, false);
  const r = await post(good);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.type, 'vpe'); assert.ok(r.json.join_code); assert.ok(r.json.meetings > 0); assert.equal(r.json.members_added, 1);
  assert.equal((await call('GET', '/api/clubs/number/99887')).json.taken, true);
  assert.equal((await post(good)).status, 409, 'duplicate club number');
  const s = await call('POST', '/api/auth/signin', { body: { email: 'wiz@example.com', password: 'wizpass12' } });
  assert.equal(s.status, 200); assert.equal(s.json.type, 'vpe');
  const mine = await get('/api/vpe/people', r.json.token);
  assert.ok(mine.json.some((p) => p.name === 'Ann Member'));
});
test('invite then set a password via the reset link', async () => {
  const people = (await get('/api/vpe/people', vpe)).json;
  const target = people.find((p) => p.kind === 'member' && !p.is_vpe && p.acct !== 'active');
  assert.ok(target, 'someone without an account');
  const inv = await call('POST', '/api/vpe/invites', { token: vpe, body: { ids: [target.id] } });
  assert.equal(inv.json.length, 1);
  const t = inv.json[0].token;
  assert.equal((await get('/api/auth/reset/' + t)).status, 200);
  assert.equal((await get('/api/auth/reset/not-a-token')).status, 404);
  assert.equal((await call('POST', '/api/auth/reset', { body: { token: t, password: 'abc' } })).status, 400);
  const done = await call('POST', '/api/auth/reset', { body: { token: t, password: 'newpass12' } });
  assert.equal(done.status, 200); assert.equal(done.json.type, 'member');
  assert.equal((await get('/api/auth/reset/' + t)).status, 404, 'the link is single use');
});
test('a member cannot send invites or resets', async () => {
  assert.equal((await call('POST', '/api/vpe/invites', { token: member, body: { ids: [1] } })).status, 403);
  assert.equal((await call('POST', '/api/vpe/people/1/reset', { token: member })).status, 403);
});

/* ───────── role links, sheets and the official PDFs ───────── */
const FORM_ROLES = ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'general_evaluator'];
async function roleToken(key) {
  const [r] = await q(`select r.token from meeting_roles r join meetings m on m.id=r.meeting_id join clubs c on c.id=m.club_id
    where r.role_key=$1 and c.name='Champions Toastmasters Club' and r.person_id is not null order by m.date desc limit 1`, [key]);
  return r?.token;
}
test('role link: invalid is 401, valid loads the meeting and sheet', async () => {
  assert.equal((await get('/api/role', 'bogus')).status, 401);
  const t = await roleToken('grammarian');
  assert.ok(t, 'demo data has a grammarian');
  const r = await get('/api/role', t);
  assert.equal(r.status, 200);
  assert.equal(r.json.role.key, 'grammarian');
  assert.ok(r.json.meeting.number); assert.ok(Array.isArray(r.json.people));
});
test('role report PDF is a real PDF for form roles and 404 otherwise', async () => {
  for (const key of FORM_ROLES) {
    const t = await roleToken(key);
    if (!t) continue;
    const r = await call('POST', '/api/role/report.pdf', { token: t, body: {}, raw: true });
    assert.equal(r.status, 200, key);
    assert.match(r.headers.get('content-type'), /application\/pdf/);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-', key);
    assert.ok(buf.length > 2000, key);
  }
  const sp = await roleToken('speaker');
  assert.equal((await call('POST', '/api/role/report.pdf', { token: sp, body: {} })).status, 404);
  assert.equal((await call('POST', '/api/role/report.pdf', { body: {} })).status, 401);
});

test('sheet save then submit, then the VPE and the member see it', async () => {
  const t = await roleToken('grammarian');
  const roleRow = (await q('select r.id, r.person_id from meeting_roles r where r.token=$1', [t]))[0];
  const sheet = { liked: [], notes: 'test sheet' };
  assert.equal((await call('PUT', '/api/role/sheet', { token: t, body: sheet })).status, 200);
  assert.equal((await get('/api/role', t)).json.sheet.notes, 'test sheet');
  assert.equal((await call('POST', '/api/role/submit', { token: t, body: {} })).status, 200);
  assert.ok((await get('/api/role', t)).json.role.submitted_at);

  // VPE: submission and filled official form, inline
  const sub = await get(`/api/vpe/roles/${roleRow.id}/submission`, vpe);
  assert.equal(sub.status, 200);
  const pdf = await call('GET', `/api/vpe/roles/${roleRow.id}/report.pdf`, { token: vpe, raw: true });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-disposition'), /inline/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await get(`/api/vpe/roles/${roleRow.id}/report.pdf`, member)).status, 403);
  assert.equal((await get(`/api/vpe/roles/${roleRow.id}/report.pdf`)).status, 401);
  assert.equal((await get('/api/vpe/roles/999999/report.pdf', vpe)).status, 404);

  // member: only their own submitted sheets
  const [owner] = await q('select token from people where id=$1', [roleRow.person_id]);
  const own = await call('GET', `/api/me/given/${roleRow.id}/report.pdf`, { token: owner.token, raw: true });
  assert.equal(own.status, 200);
  assert.equal(Buffer.from(await own.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const other = (await q(`select token from people where id<>$1 and club_id=(select club_id from people where id=$1) and status='active' limit 1`, [roleRow.person_id]))[0];
  assert.equal((await get(`/api/me/given/${roleRow.id}/report.pdf`, other.token)).status, 404, 'not their sheet');
  const given = await get('/api/me/given', owner.token);
  assert.ok(given.json.some((g) => g.id === roleRow.id));
  assert.equal((await get(`/api/me/given/${roleRow.id}`, owner.token)).status, 200);
});
test('a speaker sheet has no official form, so the report is 404', async () => {
  const [r] = await q(`select r.id from meeting_roles r where r.role_key='speaker' and r.person_id is not null limit 1`);
  assert.equal((await get(`/api/vpe/roles/${r.id}/report.pdf`, vpe)).status, 404);
});

/* ───────── member pages ───────── */
test('member pages load', async () => {
  for (const p of ['/api/me/overview', '/api/me/given', '/api/me/meetings', '/api/me/room', '/api/me/evaluations', '/api/me/path', '/api/account', '/api/projects', '/api/pathways', '/api/evaluation-resources']) {
    const r = await get(p, member);
    assert.equal(r.status, 200, p);
    assert.equal((await get(p)).status, 401, p + ' needs sign in');
  }
});
test('evaluation detail: member sees own, VPE sees any, unknown is 404', async () => {
  const [ev] = await q('select e.id, p.token from evaluations e join people p on p.id=e.speaker_id order by e.id limit 1');
  assert.ok(ev);
  const mine = await get(`/api/me/evaluations/${ev.id}`, ev.token);
  assert.equal(mine.status, 200);
  assert.equal((await get(`/api/vpe/evaluations/${ev.id}`, vpe)).status, 200);
  assert.equal((await get('/api/vpe/evaluations/999999', vpe)).status, 404);
  assert.equal((await get(`/api/vpe/evaluations/${ev.id}`, member)).status, 403);
});
test('member meeting detail 404s on an unknown number', async () => {
  assert.equal((await get('/api/me/meetings/99999', member)).status, 404);
});

/* ───────── VPE: people, profile and received feedback ───────── */
test('people list marks accounts and counts', async () => {
  const r = await get('/api/vpe/people', vpe);
  assert.ok(r.json.length > 3);
  for (const p of r.json) { assert.ok(['active', 'invited', 'none'].includes(p.acct)); assert.equal(typeof p.roles_played, 'number'); }
});
test('profile returns the five kinds of received feedback', async () => {
  const people = (await get('/api/vpe/people', vpe)).json;
  let checked = 0;
  for (const p of people.filter((x) => x.kind === 'member').slice(0, 5)) {
    const r = await get(`/api/vpe/people/${p.id}/profile`, vpe);
    assert.equal(r.status, 200);
    for (const k of ['gram', 'fill', 'time', 'roleFeedback', 'peer']) assert.ok(Array.isArray(r.json.received[k]), k);
    for (const f of r.json.received.fill) { assert.equal(typeof f.counts, 'object'); assert.ok(f.date); assert.ok('by' in f); }
    for (const t of r.json.received.time) assert.ok('seconds' in t);
    checked++;
  }
  assert.ok(checked);
  assert.equal((await get('/api/vpe/people/999999/profile', vpe)).status, 404);
  assert.equal((await get(`/api/vpe/people/${people[0].id}/profile`, member)).status, 403);
});
test('profile of a person in another club is 404', async () => {
  const w = await call('POST', '/api/clubs', { body: { name: 'Other Vpe', email: 'other@example.com', password: 'otherpass1', club: { name: 'Other Club', number: '55443', pattern: { day: 3, mode: 'weekly', start: '2026-07-01' } } } });
  const [someone] = await q(`select id from people where club_id=(select club_id from people where token=$1) limit 1`, [vpe]);
  assert.equal((await get(`/api/vpe/people/${someone.id}/profile`, w.json.token)).status, 404);
});
test('add a member, a guest, import a roster; duplicates are merged', async () => {
  const a = await call('POST', '/api/vpe/people', { token: vpe, body: { name: 'Zed Newmember', email: 'zed@example.com' } });
  assert.equal(a.status, 200);
  assert.equal((await call('POST', '/api/vpe/people', { token: vpe, body: { name: 'x' } })).status, 400);
  const g = await call('POST', '/api/vpe/people', { token: vpe, body: { name: 'Gus Guest', kind: 'guest' } });
  assert.equal(g.status, 200);
  const imp = await call('POST', '/api/vpe/people/import', { token: vpe, body: { members: [{ name: 'Zed Newmember' }, { name: 'Imported Person', email: 'imp@example.com' }, { name: '' }, { name: 'Bad Email', email: 'nope' }] } });
  assert.equal(imp.json.added, 1); assert.equal(imp.json.updated, 1); assert.equal(imp.json.skipped.length, 2);
  const names = (await get('/api/vpe/people', vpe)).json.map((p) => p.name);
  assert.equal(names.filter((n) => n === 'Zed Newmember').length, 1);
});

/* ───────── room feedback via the QR link ───────── */
test('room feedback: bad code 404, empty 400, valid saved, hideable, shows on profile', async () => {
  assert.equal((await get('/api/f/nopecode')).status, 404);
  assert.equal((await call('POST', '/api/f/nopecode', { body: { items: [] } })).status, 404);
  const [m] = await q(`select id, feedback_code from meetings where feedback_code is not null and club_id=(select club_id from people where token=$1) order by date desc limit 1`, [vpe]);
  const page = await get('/api/f/' + m.feedback_code);
  assert.equal(page.status, 200);
  const target = page.json.agenda[0]?.id ?? page.json.others[0].id;
  assert.equal((await call('POST', '/api/f/' + m.feedback_code, { body: { from_name: 'Pat', items: [{ to_person_id: target, well: '', improve: '' }] } })).status, 400);
  const ok = await call('POST', '/api/f/' + m.feedback_code, { body: { from_name: 'Pat', items: [{ to_person_id: target, well: 'Great energy', improve: 'Slow down' }, { to_person_id: 999999, well: 'ghost' }] } });
  assert.equal(ok.status, 200); assert.equal(ok.json.count, 1, 'unknown people are ignored');
  const prof = await get(`/api/vpe/people/${target}/profile`, vpe);
  const entry = prof.json.received.peer.find((x) => x.well === 'Great energy');
  assert.ok(entry, 'appears in received feedback');
  const det = await get(`/api/vpe/meetings/${m.id}`, vpe);
  const row = det.json.peer.find((x) => x.well === 'Great energy');
  assert.equal((await call('PATCH', `/api/vpe/peer/${row.id}`, { token: vpe, body: { hidden: true } })).status, 200);
  const after = await get(`/api/vpe/people/${target}/profile`, vpe);
  assert.ok(!after.json.received.peer.some((x) => x.well === 'Great energy'), 'hidden feedback is not shown');
  assert.equal((await call('PATCH', '/api/vpe/peer/999999', { token: vpe, body: { hidden: true } })).status, 404);
});
test('room feedback is rate limited', async () => {
  const [m] = await q('select feedback_code from meetings where feedback_code is not null limit 1');
  let last;
  for (let i = 0; i < 14; i++) last = await call('POST', '/api/f/' + m.feedback_code, { body: { items: [] } });
  assert.equal(last.status, 429);
});

/* ───────── guests and join requests ───────── */
test('guests: only VPE or a role link can add one; a guest can ask to join', async () => {
  assert.equal((await call('POST', '/api/people/guest', { token: member, body: { name: 'Nope Guest' } })).status, 403);
  const g = await call('POST', '/api/people/guest', { token: vpe, body: { name: 'Walk In' } });
  assert.equal(g.status, 200); assert.equal(g.json.kind, 'guest');
  const again = await call('POST', '/api/people/guest', { token: vpe, body: { name: 'walk  in' } });
  assert.equal(again.json.id, g.json.id, 'same person, no duplicate'); assert.equal(again.json.existing, true);
  assert.equal((await call('POST', '/api/people/guest', { token: vpe, body: { name: 'x' } })).status, 400);
  const [gt] = await q('select token from people where id=$1', [g.json.id]);
  assert.equal((await call('POST', '/api/me/join-request', { token: gt.token, body: { email: 'bad' } })).status, 400);
  assert.equal((await call('POST', '/api/me/join-request', { token: gt.token, body: { email: 'walk@example.com' } })).status, 200);
  assert.equal((await call('POST', '/api/me/join-request', { token: member, body: {} })).json.member, true);
});

/* ───────── meetings ───────── */
test('VPE meetings: list, add, edit, delete and renumber', async () => {
  const list = (await get('/api/vpe/meetings', vpe)).json;
  assert.ok(list.length > 5);
  assert.ok(list.every((m) => ['Done', 'Next', 'Planned'].includes(m.status)));
  assert.ok(list.filter((m) => m.status === 'Next').length <= 1);
  const add = await call('POST', '/api/vpe/meetings', { token: vpe });
  assert.equal(add.status, 200);
  const after = (await get('/api/vpe/meetings', vpe)).json;
  assert.equal(after.length, list.length + 1);
  assert.equal(after[0].number, list[0].number + 1);
  const d = await get(`/api/vpe/meetings/${add.json.id}`, vpe);
  assert.equal(d.json.roles.length, 12);
  assert.equal((await call('PATCH', `/api/vpe/meetings/${add.json.id}`, { token: vpe, body: { theme: 'Test theme' } })).status, 200);
  assert.equal((await get(`/api/vpe/meetings/${add.json.id}`, vpe)).json.meeting.theme, 'Test theme');
  assert.equal((await call('DELETE', `/api/vpe/meetings/${add.json.id}`, { token: vpe })).status, 200);
  assert.equal((await get(`/api/vpe/meetings/${add.json.id}`, vpe)).status, 404);
  assert.equal((await get('/api/vpe/meetings/999999', vpe)).status, 404);
  assert.equal((await call('POST', '/api/vpe/meetings', { token: member })).status, 403);
});
test('dashboard, calendar and roster respond with data', async () => {
  for (const p of ['/api/vpe/dashboard', '/api/vpe/calendar?from=2026-07-01&to=2027-06-30', '/api/vpe/roster', '/api/vpe/network']) {
    const r = await get(p, vpe);
    assert.equal(r.status, 200, p);
    assert.ok(r.json && typeof r.json === 'object', p);
  }
});

/* ───────── agenda ───────── */
test('agenda downloads as a docx (a zip) for VPE, role and member', async () => {
  const [m] = await q(`select id from meetings where club_id=(select club_id from people where token=$1) order by date desc limit 1`, [vpe]);
  const r = await call('GET', `/api/vpe/meetings/${m.id}/agenda.docx`, { token: vpe, raw: true });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const t = await roleToken('toastmaster');
  if (t) assert.equal((await call('GET', '/api/role/agenda.docx', { token: t, raw: true })).status, 200);
  assert.equal((await get(`/api/vpe/meetings/${m.id}/agenda`, vpe)).status, 200);
  assert.equal((await call('GET', `/api/vpe/meetings/${m.id}/agenda.docx`, { token: member, raw: true })).status, 403);
});

/* ───────── input hardening ───────── */
test('malformed JSON and unknown routes do not crash the server', async () => {
  const r = await fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(r.status, 400);
  assert.equal((await get('/api/health')).status, 200, 'still alive');
  const nf = await fetch(base + '/api/does-not-exist');
  assert.ok([404, 401].includes(nf.status));
});
test('SQL-ish input is treated as data', async () => {
  const r = await call('POST', '/api/auth/signin', { body: { email: "' or 1=1 --", password: "' or 1=1 --" } });
  assert.equal(r.status, 401);
  assert.ok((await q('select count(*)::int as n from people'))[0].n > 3, 'people table intact');
});
test('inactive people cannot use their token', async () => {
  const [p] = await q(`select id, token from people where token=$1`, [member]);
  await q(`update people set status='inactive' where id=$1`, [p.id]);
  assert.equal((await get('/api/session', member)).status, 401);
  await q(`update people set status='active' where id=$1`, [p.id]);
  assert.equal((await get('/api/session', member)).status, 200);
});

/* ───────── evaluation forms ───────── */
import fs from 'node:fs';
const FORMS_DIR = new URL('../../client/public/eval-forms/', import.meta.url);
test('every evaluation form in the data exists on disk, is a PDF, and nothing on disk is orphaned', async () => {
  const r = await get('/api/evaluation-resources', member);
  assert.equal(r.status, 200);
  const used = new Set();
  for (const [name, v] of Object.entries(r.json)) {
    if (!v.forms) continue;
    assert.equal(v.pdf, v.forms[0], name + ': pdf is the first form');
    for (const f of v.forms) {
      assert.match(f, /^\/eval-forms\/[a-z0-9-]+\.pdf$/, name);
      const file = new URL(f.replace('/eval-forms/', ''), FORMS_DIR);
      assert.ok(fs.existsSync(file), `${name}: ${f} is missing`);
      assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), '%PDF-', f);
      used.add(f.replace('/eval-forms/', ''));
    }
  }
  const onDisk = fs.readdirSync(FORMS_DIR).filter((f) => f.endsWith('.pdf'));
  assert.deepEqual(onDisk.filter((f) => !used.has(f)), [], 'PDFs no project points at');
  assert.ok(used.size >= 60);
});
test('multi-speech projects list their forms in speech order', async () => {
  const r = (await get('/api/evaluation-resources', member)).json;
  assert.deepEqual(r['Deliver Social Speeches'].forms, ['/eval-forms/deliver-social-speeches.pdf', '/eval-forms/deliver-social-speeches-2.pdf']);
  assert.equal(r['Evaluation and Feedback'].forms.length, 3);
  assert.match(r['Evaluation and Feedback'].forms[0], /-1\.pdf$/);
});
