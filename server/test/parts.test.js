// Projects made of several parts (two speeches, or two speeches and an evaluation): the form text, scheduling and completion by part.
process.env.VERCEL = '1';
process.env.PGLITE_DIR = 'memory://';
process.env.DEMO_MODE = 'true';
delete process.env.DATABASE_URL;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

const { default: app, ready } = await import('../src/index.js');
const { q } = await import('../src/db.js');

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

async function call(method, path, { token, body } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { 'x-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const get = (p, token) => call('GET', p, { token });

const PARTS = JSON.parse(fs.readFileSync(new URL('../data/project-parts.json', import.meta.url), 'utf8'));
async function newMember(name, path = 'Dynamic Leadership') {
  const r = await call('POST', '/api/vpe/people', { token: vpe, body: { name, path_name: path, levels_done: 0 } });
  assert.equal(r.status, 200, r.text);
  return (await q('select id, token from people where id=$1', [r.json.id]))[0];
}
const proj = async (name) => (await q('select * from projects where name=$1', [name]))[0];
const pathOf = async (id) => (await get(`/api/vpe/people/${id}/path`, vpe)).json;
const find = (path, name) => path.levels.flatMap((l) => l.projects).find((p) => p.name === name);
const EF = 'Evaluation and Feedback';
const EARLIER = ['Ice Breaker', 'Writing a Speech with Purpose', 'Introduction to Vocal Variety and Body Language'];
const finishEarlier = async (m) => { for (const n of EARLIER) await call('POST', `/api/vpe/people/${m.id}/projects`, { token: vpe, body: { project_id: (await proj(n)).id, done: true } }); };

test('form text and parts are loaded into the projects table', async () => {
  const ef = await proj(EF);
  assert.deepEqual(ef.parts.map((x) => x.label), ['First Speech', 'Second Speech', 'Evaluator Speech']);
  assert.deepEqual(ef.parts.map((x) => x.kind), ['speech', 'speech', 'evaluator']);
  assert.equal(ef.parts[2].length_text, '2–3 minutes');
  assert.equal(ef.parts[2].green, 120); assert.equal(ef.parts[2].red, 180);
  assert.match(ef.purpose[0], /purpose of this project/i);
  assert.equal(ef.overview, '', 'the old catalog overview no longer replaces the form notes');
  assert.equal((await proj('High Performance Leadership')).parts.length, 2);
  const ib = await proj('Ice Breaker');
  assert.deepEqual(ib.parts, []);
  assert.match(ib.notes, /first speech in Toastmasters/);
  assert.equal(ib.length_text, '4–6 minutes');
});

test('every project in the extracted form data exists, and its parts match the forms in the resources', async () => {
  const res = (await get('/api/evaluation-resources', member)).json;
  for (const [name, f] of Object.entries(PARTS)) {
    const p = await proj(name);
    assert.ok(p, name + ' is a project');
    assert.ok(f.purpose.length, name + ' has a purpose');
    assert.ok(f.notes, name + ' has notes');
    assert.equal(p.parts.length, f.parts?.length || 0, name);
    if (f.parts) assert.deepEqual(f.parts.map((x) => x.form), res[name].forms, name + ' forms line up with parts');
  }
});

test('a project counts as done only when every part is done', async () => {
  const m = await newMember('Parts Tester One');
  const ef = await proj(EF);
  let p = find(await pathOf(m.id), EF);
  assert.equal(p.parts.length, 3); assert.equal(p.done, null); assert.equal(p.next_part, 1);
  const mark = (body) => call('POST', `/api/vpe/people/${m.id}/projects`, { token: vpe, body: { project_id: ef.id, ...body } });
  await mark({ done: true, part: 1 });
  p = find(await pathOf(m.id), EF);
  assert.ok(p.parts[0].done); assert.equal(p.parts[1].done, null); assert.equal(p.done, null, 'one part is not the project'); assert.equal(p.next_part, 2);
  await mark({ done: true, part: 2 });
  await mark({ done: true, part: 3 });
  p = find(await pathOf(m.id), EF);
  assert.ok(p.done, 'all three parts done'); assert.equal(p.next_part, null);
  await mark({ done: false, part: 2 });
  assert.equal(find(await pathOf(m.id), EF).done, null, 'undoing one part reopens the project');
  await mark({ done: false });
  assert.ok(find(await pathOf(m.id), EF).parts.every((x) => !x.done), 'no part number means every part');
  await mark({ done: true });
  assert.ok(find(await pathOf(m.id), EF).done, 'marking without a part finishes every part');
});

test('a single-part project is unchanged: done in one go', async () => {
  const m = await newMember('Parts Tester Two');
  assert.equal(find(await pathOf(m.id), 'Ice Breaker').parts, undefined);
  await call('POST', `/api/vpe/people/${m.id}/projects`, { token: vpe, body: { project_id: (await proj('Ice Breaker')).id, done: true } });
  assert.ok(find(await pathOf(m.id), 'Ice Breaker').done);
});

test('scheduling is by part: a project is scheduled once every part left is', async () => {
  const m = await newMember('Parts Tester Three');
  const ef = await proj(EF);
  const plan = (part, date) => call('POST', `/api/vpe/people/${m.id}/plans`, { token: vpe, body: { project_id: ef.id, part, date, title: 'x' } });
  assert.equal((await plan(1, '2027-03-05')).status, 200);
  let p = find(await pathOf(m.id), EF);
  assert.ok(p.parts[0].sched); assert.equal(p.parts[1].sched, null); assert.equal(p.sched, null, 'not every part is scheduled yet');
  assert.equal((await plan(2, '2027-04-02')).status, 200);
  assert.equal((await plan(3, '2027-05-07')).status, 200);
  p = find(await pathOf(m.id), EF);
  assert.ok(p.sched, 'every part is scheduled');
  assert.equal(p.sched.date, '2027-05-07', 'the project finishes when its last part does');
  assert.equal(p.next_part, 1);
  const cal = (await get('/api/vpe/calendar?from=2027-01-01&to=2027-12-31', vpe)).json;
  const mine = cal.speeches.filter((x) => x.person_id === m.id).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(mine.map((x) => [x.part, x.part_label]), [[1, 'First Speech'], [2, 'Second Speech'], [3, 'Evaluator Speech']]);
  assert.equal(mine[0].nparts, 3);
  const first = (await q('select id from speech_plans where person_id=$1 and part=1', [m.id]))[0];
  assert.equal((await call('POST', `/api/vpe/plans/${first.id}/complete`, { token: vpe })).status, 200);
  p = find(await pathOf(m.id), EF);
  assert.ok(p.parts[0].done); assert.equal(p.parts[1].done, null); assert.equal(p.done, null, 'completing a plan finishes that part only');
  const second = (await q('select id from speech_plans where person_id=$1 and part=2', [m.id]))[0];
  assert.equal((await call('PATCH', `/api/me/plans/${second.id}`, { token: vpe, body: { part: 3 } })).status, 200);
  assert.equal((await q('select part from speech_plans where id=$1', [second.id]))[0].part, 3);
});

test('a speaker slot carries the part, and the next undone part is suggested', async () => {
  const m = await newMember('Parts Tester Four');
  const ef = await proj(EF);
  await call('POST', `/api/vpe/people/${m.id}/projects`, { token: vpe, body: { project_id: ef.id, done: true, part: 1 } });
  await finishEarlier(m);
  const nx = (await pathOf(m.id)).next;
  assert.equal(nx.name, EF); assert.equal(nx.part, 2); assert.equal(nx.part_kind, 'speech');
  const [slot] = await q(`select r.id, r.meeting_id from meeting_roles r join meetings m on m.id=r.meeting_id where r.role_key='speaker' and r.person_id is null and m.date > current_date order by m.date limit 1`);
  const set = await call('PATCH', `/api/vpe/roles/${slot.id}`, { token: vpe, body: { person_id: m.id } });
  assert.equal(set.status, 200);
  assert.equal(set.json.project_id, ef.id); assert.equal(set.json.part, 2);
  assert.equal((await call('PATCH', `/api/vpe/roles/${slot.id}`, { token: vpe, body: { part: 1 } })).json.part, 1);
  const det = await get(`/api/vpe/meetings/${slot.meeting_id}`, vpe);
  assert.equal(det.json.roles.find((r) => r.id === slot.id).part, 1);
  assert.equal((await call('PATCH', `/api/vpe/roles/${slot.id}`, { token: vpe, body: { part: 99 } })).json.part, 9, 'parts are bounded');
  await call('PATCH', `/api/vpe/roles/${slot.id}`, { token: vpe, body: { part: 2 } });
  assert.ok(find(await pathOf(m.id), EF).parts[1].sched, 'the slot schedules that part');
});

test('the evaluator part is served in an evaluator slot, and submitting that slot finishes the part', async () => {
  const m = await newMember('Parts Tester Five');
  const ef = await proj(EF);
  for (const part of [1, 2]) await call('POST', `/api/vpe/people/${m.id}/projects`, { token: vpe, body: { project_id: ef.id, done: true, part } });
  await finishEarlier(m);
  const nx = (await pathOf(m.id)).next;
  assert.equal(nx.part, 3); assert.equal(nx.part_kind, 'evaluator');
  const [slot] = await q(`select r.id from meeting_roles r join meetings m on m.id=r.meeting_id where r.role_key='evaluator' and r.person_id is null and m.date > current_date order by m.date limit 1`);
  const set = await call('PATCH', `/api/vpe/roles/${slot.id}`, { token: vpe, body: { person_id: m.id } });
  assert.equal(set.json.project_id, ef.id); assert.equal(set.json.part, 3, 'the evaluator slot carries their own evaluator part');
  assert.ok(find(await pathOf(m.id), EF).parts[2].sched);
  assert.equal(find(await pathOf(m.id), EF).done, null);
  const [sp] = await q(`select r.id from meeting_roles r join meetings m on m.id=r.meeting_id where r.role_key='speaker' and r.person_id is null and m.date > current_date order by m.date desc limit 1`);
  assert.equal((await call('PATCH', `/api/vpe/roles/${sp.id}`, { token: vpe, body: { person_id: m.id } })).json.project_id, null, 'no speech slot for an evaluator part');
  const [tk] = await q('select token from meeting_roles where id=$1', [slot.id]);
  assert.equal((await call('POST', '/api/role/submit', { token: tk.token, body: {} })).status, 200);
  const done = find(await pathOf(m.id), EF);
  assert.ok(done.parts[2].done, 'submitting the evaluator slot finished the evaluator part');
  assert.ok(done.done, 'and with the speeches done, so is the project');
});

test('an evaluation remembers which part was evaluated, and the evaluator sees that part', async () => {
  const [ev] = await q(`select r.id, r.token, r.target_role_id from meeting_roles r where r.role_key='evaluator' and r.target_role_id is not null and r.person_id is not null limit 1`);
  const ef = await proj(EF);
  await q('update meeting_roles set project_id=$1, part=2 where id=$2', [ef.id, ev.target_role_id]);
  const role = await get('/api/role', ev.token);
  assert.equal(role.json.roles.find((r) => r.id === ev.target_role_id).part, 2, 'the evaluator sees the speaker part');
  assert.equal(role.json.projects.find((p) => p.id === ef.id).parts[1].label, 'Second Speech');
  assert.equal((await call('PUT', '/api/role/sheet', { token: ev.token, body: { ratings: [4, 4, 4, 4, 4, 4, 4], excelled: 'x' } })).status, 200);
  assert.equal((await call('POST', '/api/role/submit', { token: ev.token, body: {} })).status, 200);
  const [e] = await q('select part, project_id from evaluations where role_id=$1', [ev.id]);
  assert.equal(e.part, 2); assert.equal(e.project_id, ef.id);
});

test('timing thresholds follow the part: the evaluator speech is 2 to 3 minutes', async () => {
  const [tm] = await q(`select r.token, r.meeting_id from meeting_roles r where r.role_key='timer' and r.person_id is not null limit 1`);
  const [sp] = await q(`select r.person_id from meeting_roles r where r.meeting_id=$1 and r.role_key='speaker' and r.person_id is not null limit 1`, [tm.meeting_id]);
  const ef = await proj(EF);
  const rows = [{ subject_id: sp.person_id, label: 'Speaker 1', kind: 'Speaker', project_id: ef.id, part: 3, seconds: 150, fixed: true }];
  assert.equal((await call('POST', '/api/role/submit', { token: tm.token, body: { rows } })).status, 200);
  const [t] = await q('select green, yellow, red from timings where subject_id=$1 and project_id=$2 order by id desc limit 1', [sp.person_id, ef.id]);
  assert.deepEqual([t.green, t.yellow, t.red], [120, 150, 180]);
});

test('the pathways catalog lists parts for multi-part projects only', async () => {
  const all = (await get('/api/pathways', member)).json.paths.flatMap((p) => p.levels.flatMap((l) => l.projects));
  assert.equal(all.find((p) => p.name === EF).parts.length, 3);
  assert.equal(all.find((p) => p.name === 'Ice Breaker').parts, undefined);
});

test('existing finished marks carry over when a project becomes several parts', async () => {
  // simulate a database from before parts existed: a manual finish with only part 1, and the project without parts
  const m = await newMember('Parts Tester Six');
  const ef = await proj(EF);
  await q('delete from member_projects where person_id=$1', [m.id]);
  await q('update projects set parts=$1 where id=$2', ['[]', ef.id]);
  await q('insert into member_projects(person_id, project_id, part) values ($1,$2,1)', [m.id, ef.id]);
  const { applyFormText } = await import('../src/formtext.js');
  await applyFormText();
  const parts = await q('select part from member_projects where person_id=$1 and project_id=$2 order by part', [m.id, ef.id]);
  assert.deepEqual(parts.map((x) => x.part), [1, 2, 3], 'someone already finished is finished in every part');
  const again = await q('select count(*)::int as n from member_projects where person_id=$1', [m.id]);
  await applyFormText();
  assert.equal((await q('select count(*)::int as n from member_projects where person_id=$1', [m.id]))[0].n, again[0].n, 'running it again changes nothing');
});

test('the VPE can reset the submitted feedback of a meeting, and only the VPE', async () => {
  const [mt] = await q('select id, club_id from meetings order by date desc limit 1');
  const [role] = await q(`select id from meeting_roles where meeting_id=$1 and role_key='grammarian'`, [mt.id]);
  const [pp] = await q('select id from people where club_id=$1 limit 1', [mt.club_id]);
  await q(`update meeting_roles set sheet='{"x":1}'::jsonb, submitted_at=now() where id=$1`, [role.id]);
  await q(`insert into gram_notes(role_id,meeting_id,subject_id,used_word,word_uses,liked,improper,suggestion) values ($1,$2,$3,true,1,'','','')`, [role.id, mt.id, pp.id]);
  assert.equal((await call('POST', `/api/vpe/meetings/${mt.id}/reset-feedback`, { token: member })).status, 403 );
  assert.equal((await call('POST', `/api/vpe/meetings/${mt.id}/reset-feedback`)).status, 401);
  const r = await call('POST', `/api/vpe/meetings/${mt.id}/reset-feedback`, { token: vpe });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.sheets >= 1);
  const [after] = await q('select sheet, submitted_at from meeting_roles where id=$1', [role.id]);
  assert.deepEqual(after.sheet, {}); assert.equal(after.submitted_at, null);
  assert.equal((await q('select 1 from gram_notes where meeting_id=$1', [mt.id])).length, 0);
  assert.equal((await call('POST', '/api/vpe/meetings/999999/reset-feedback', { token: vpe })).status, 404);
});
