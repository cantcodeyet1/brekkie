// Pathways enhancements: the roles and presentations a level asks for, laid over what a member has done.
process.env.VERCEL = '1';
process.env.PGLITE_DIR = 'memory://';
process.env.DEMO_MODE = 'true';
delete process.env.DATABASE_URL;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { layOver, validItem } from '../src/enhancements.js';

const { default: app, ready } = await import('../src/index.js');
const { q } = await import('../src/db.js');

let server, base, vpe, pid;
before(async () => {
  await ready;
  server = http.createServer(app);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  const demo = await (await fetch(base + '/api/dev/accounts')).json();
  vpe = demo.people.find((p) => p.is_vpe).token;
  pid = demo.people.find((p) => !p.is_vpe && p.kind === 'member').id;
});
after(() => server?.close());

async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'x-token': vpe, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

test('the rules: fixed roles first, "one of" roles take what is left, series are chosen from a list', () => {
  const P = 'Presentation Mastery';
  assert.ok(validItem(P, 1, 'role', 'ah_counter') && !validItem(P, 1, 'role', 'grammarian'));
  assert.ok(!validItem('Effective Coaching', 1, 'role', 'timer'), 'legacy paths carry no requirements');
  // a Timer and an Evaluator and a Table Topics Speaker are all Level 1 needs
  const l1 = layOver(P, 1, [
    { id: 1, kind: 'role', item: 'timer', done: true, date: '2026-01-01' }, { id: 2, kind: 'role', item: 'evaluator', done: true, date: '2026-01-02' },
    { id: 3, kind: 'role', item: 'tt', done: false, date: '2099-01-01' },
  ]);
  assert.equal(l1.total, 3); assert.equal(l1.done, 2); assert.equal(l1.complete, false);
  assert.equal(l1.items.find((i) => i.state === 'sched').entries[0].item, 'tt');
  // Level 2: the Timer may serve the "Toastmaster, Timer or Ah-Counter" line, and a second Timer is spare
  const l2 = layOver(P, 2, [{ id: 1, kind: 'role', item: 'timer', done: true }, { id: 2, kind: 'role', item: 'timer', done: true }]);
  assert.equal(l2.done, 1); assert.equal(l2.spare.length, 1);
  // Level 5: Toastmaster twice
  const l5 = layOver(P, 5, [{ id: 1, kind: 'role', item: 'toastmaster', done: true }, { id: 2, kind: 'role', item: 'toastmaster', done: true }]);
  assert.equal(l5.items.find((i) => i.id === 'b').state, 'done');
  assert.equal(layOver(P, 3, [], true).complete, true, 'waived levels count');
  assert.equal(layOver(P, 4, []).total, 6, 'Level 4: four roles, a Club Series and a Better Speaker presentation');
});

test('scheduling a role at this club on a meeting date puts the member on the roster; ticking off completes it', async () => {
  const set = await call('PATCH', `/api/vpe/people/${pid}`, { path_name: 'Presentation Mastery', path_level: 2 });
  assert.equal(set.status, 200, set.text);
  await q('delete from member_levels where person_id=$1', [pid]);
  const [m] = await q(`select m.id, m.number, to_char(m.date,'YYYY-MM-DD') as d from meetings m join meeting_roles r on r.meeting_id=m.id where r.role_key='grammarian' and r.person_id is null order by m.date desc limit 1`);
  const add = await call('POST', `/api/vpe/people/${pid}/enh`, { level: 2, kind: 'role', item: 'grammarian', date: m.d });
  assert.equal(add.status, 200, add.text);
  assert.equal(add.json.roster.status, 'placed');
  const [slot] = await q(`select person_id from meeting_roles where meeting_id=$1 and role_key='grammarian'`, [m.id]);
  assert.equal(slot.person_id, pid, 'on the agenda roster');
  let path = (await call('GET', `/api/vpe/people/${pid}/path`)).json;
  const lv = path.levels.find((l) => l.level === 2);
  assert.equal(lv.enh.items.find((i) => i.id === 'a').state, 'sched');
  assert.equal(lv.complete, false);
  assert.equal((await call('POST', `/api/vpe/people/${pid}/enh`, { level: 2, kind: 'role', item: 'timer', date: m.d })).status, 200);
  // a taken slot is reported, not overwritten
  const [other] = await q('select id from people where id<>$1 and club_id=(select club_id from people where id=$1) and kind=$2 limit 1', [pid, 'member']);
  await q(`update meeting_roles set person_id=$1 where meeting_id=$2 and role_key='grammarian'`, [other.id, m.id]);
  const clash = await call('POST', `/api/vpe/people/${pid}/enh`, { level: 2, kind: 'role', item: 'grammarian', date: m.d });
  assert.equal(clash.json.roster.status, 'taken');
  await q(`update meeting_roles set person_id=$1 where meeting_id=$2 and role_key='grammarian'`, [pid, m.id]);
  // removing the plan empties the roster slot
  assert.equal((await call('DELETE', `/api/vpe/enh/${clash.json.id}`)).status, 200);
  // invalid items are refused
  assert.equal((await call('POST', `/api/vpe/people/${pid}/enh`, { level: 2, kind: 'role', item: 'tt', date: m.d })).status, 400);
  // tick off, then count a whole level as met earlier
  path = (await call('GET', `/api/vpe/people/${pid}/path`)).json;
  const e = path.levels.find((l) => l.level === 2).enh.items.find((i) => i.id === 'a').entries[0];
  assert.equal((await call('POST', `/api/vpe/enh/${e.id}/complete`, {})).status, 200);
  path = (await call('GET', `/api/vpe/people/${pid}/path`)).json;
  assert.equal(path.levels.find((l) => l.level === 2).enh.items.find((i) => i.id === 'a').state, 'done');
  assert.equal((await call('POST', `/api/vpe/people/${pid}/enh/waive`, { level: 2 })).status, 200);
  assert.equal((await call('GET', `/api/vpe/people/${pid}/path`)).json.levels.find((l) => l.level === 2).enh.waived, true);
});

test('putting someone on a roster role by hand counts for their level; a speech at this club takes a speaker slot', async () => {
  await q('delete from member_enh where person_id=$1', [pid]);
  const [m] = await q(`select m.id, to_char(m.date,'YYYY-MM-DD') as d from meetings m join meeting_roles r on r.meeting_id=m.id where r.role_key='timer' and r.person_id is null order by m.date desc limit 1`);
  const [t] = await q(`select id from meeting_roles where meeting_id=$1 and role_key='timer'`, [m.id]);
  await q('update people set path_level=1 where id=$1', [pid]);
  await q('delete from member_levels where person_id=$1', [pid]);
  assert.equal((await call('PATCH', `/api/vpe/roles/${t.id}`, { person_id: pid })).status, 200);
  let lv = (await call('GET', `/api/vpe/people/${pid}/path`)).json.levels.find((l) => l.level === 1);
  assert.ok(lv.enh.items.some((i) => i.entries.some((x) => x.item === 'timer')), 'the Timer slot shows on Level 1');
  await call('PATCH', `/api/vpe/roles/${t.id}`, { person_id: null });
  lv = (await call('GET', `/api/vpe/people/${pid}/path`)).json.levels.find((l) => l.level === 1);
  assert.ok(!lv.enh.items.some((i) => i.entries.length), 'taken off the roster, it stops counting');
  // a speech at this club on a meeting date
  const [sp] = await q(`select m.id, to_char(m.date,'YYYY-MM-DD') as d from meetings m where exists (select 1 from meeting_roles r where r.meeting_id=m.id and r.role_key='speaker' and r.person_id is null) order by m.date desc limit 1`);
  const plan = await call('POST', `/api/vpe/people/${pid}/plans`, { date: sp.d, title: 'My story' });
  assert.equal(plan.status, 200, plan.text);
  assert.ok(plan.json.roster, 'placed on the roster');
  const [row] = await q(`select speech_title from meeting_roles where meeting_id=$1 and role_key='speaker' and person_id=$2`, [sp.id, pid]);
  assert.equal(row.speech_title, 'My story');
});

test('the agenda title follows the last completed level unless the VPE typed their own', async () => {
  await q('delete from member_enh where person_id=$1', [pid]);
  await q('delete from member_levels where person_id=$1', [pid]);
  await q(`update people set credential='TM', credential_manual=false where id=$1`, [pid]);
  await call('PATCH', `/api/vpe/people/${pid}`, { path_name: 'Presentation Mastery', path_level: 1 });
  const title = async () => (await call('GET', '/api/vpe/people')).json.find((p) => p.id === pid).credential;
  assert.equal(await title(), 'TM', 'nothing finished yet');
  await q(`insert into member_levels(person_id, path, level) values ($1,'Presentation Mastery',1), ($1,'Presentation Mastery',2)`, [pid]);
  assert.equal(await title(), 'PM2', 'the highest completed level');
  await call('PATCH', `/api/vpe/people/${pid}`, { credential: 'DTM' });
  await q(`insert into member_levels(person_id, path, level) values ($1,'Presentation Mastery',3)`, [pid]);
  assert.equal(await title(), 'DTM', 'typed by the VPE, so it stays');
  assert.equal((await call('GET', '/api/vpe/people')).json.find((p) => p.id === pid).credential_manual, true);
  await call('PATCH', `/api/vpe/people/${pid}`, { credential: '' });
  assert.equal(await title(), 'PM3', 'cleared: back to automatic');
  // saving the form with the title unchanged does not freeze it
  await call('PATCH', `/api/vpe/people/${pid}`, { credential: 'PM3', name: 'Edited Name' });
  await q(`insert into member_levels(person_id, path, level) values ($1,'Presentation Mastery',4)`, [pid]);
  assert.equal(await title(), 'PM4');
});

test('the evaluator part of a project can be scheduled: it takes an evaluator slot and counts as the Evaluator requirement', async () => {
  await q('delete from member_enh where person_id=$1', [pid]);
  await q('delete from member_levels where person_id=$1', [pid]);
  await call('PATCH', `/api/vpe/people/${pid}`, { path_name: 'Presentation Mastery', path_level: 1 });
  const [pj] = await q(`select p.id from projects p where p.name='Evaluation and Feedback'`);
  const [m] = await q(`select m.id, to_char(m.date,'YYYY-MM-DD') as d from meetings m where exists (select 1 from meeting_roles r where r.meeting_id=m.id and r.role_key='evaluator' and r.person_id is null) order by m.date desc limit 1`);
  const r = await call('POST', `/api/vpe/people/${pid}/plans`, { project_id: pj.id, part: 3, date: m.d });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.roster, 'on an evaluator slot');
  const [slot] = await q(`select role_key, project_id, part from meeting_roles where meeting_id=$1 and person_id=$2 and role_key='evaluator'`, [m.id, pid]);
  assert.equal(slot.project_id, pj.id); assert.equal(slot.part, 3);
  const lv = (await call('GET', `/api/vpe/people/${pid}/path`)).json.levels.find((l) => l.level === 1);
  assert.ok(lv.enh.items.some((i) => i.id === 'b' && i.entries.length === 1), 'the Level 1 Evaluator requirement is scheduled too');
});

test('the Evaluator requirement and the project evaluator part follow each other: schedule, tick off, undo', async () => {
  const reset = async () => { await q('delete from member_enh where person_id=$1', [pid]); await q('delete from member_levels where person_id=$1', [pid]); await q('delete from member_projects where person_id=$1', [pid]); await q('delete from speech_plans where person_id=$1', [pid]); await q('update meeting_roles set person_id=null where person_id=$1', [pid]); };
  await reset();
  await call('PATCH', `/api/vpe/people/${pid}`, { path_name: 'Presentation Mastery', path_level: 1 });
  const [pj] = await q(`select id from projects where name='Evaluation and Feedback'`);
  const lvl = async () => (await call('GET', `/api/vpe/people/${pid}/path`)).json.levels.find((l) => l.level === 1);
  const part = async () => (await lvl()).projects.find((p) => p.id === pj.id).parts[2];
  const ev = async () => (await lvl()).enh.items.find((i) => i.id === 'b');
  // scheduling the requirement elsewhere schedules the project part
  const add = await call('POST', `/api/vpe/people/${pid}/enh`, { level: 1, kind: 'role', item: 'evaluator', date: '2099-03-03', venue: 'Sunrise Toastmasters' });
  assert.equal(add.status, 200, add.text);
  assert.ok((await part()).sched, 'the project part is scheduled too');
  // ticking the requirement off marks the part done, undo reverses it
  assert.equal((await call('POST', `/api/vpe/enh/${add.json.id}/complete`, {})).status, 200);
  assert.ok((await part()).done, 'part done');
  await call('POST', `/api/vpe/enh/${add.json.id}/complete`, { done: false });
  assert.ok(!(await part()).done, 'part undone');
  // marking the part done ticks the requirement
  await call('POST', `/api/vpe/people/${pid}/projects`, { project_id: pj.id, part: 3 });
  assert.equal((await ev()).state, 'done', 'requirement done');
  await call('POST', `/api/vpe/people/${pid}/projects`, { project_id: pj.id, part: 3, done: false });
  assert.notEqual((await ev()).state, 'done', 'requirement undone');
  await reset();
});

test('an Evaluator requirement placed on a meeting roster carries the project part with it', async () => {
  await q('delete from member_enh where person_id=$1', [pid]); await q('delete from member_levels where person_id=$1', [pid]); await q('delete from member_projects where person_id=$1', [pid]); await q('delete from speech_plans where person_id=$1', [pid]);
  await q('update meeting_roles set person_id=null where person_id=$1', [pid]);
  await call('PATCH', `/api/vpe/people/${pid}`, { path_name: 'Presentation Mastery', path_level: 1 });
  const [m] = await q(`select to_char(m.date,'YYYY-MM-DD') as d, m.id from meetings m where exists (select 1 from meeting_roles r where r.meeting_id=m.id and r.role_key='evaluator' and r.person_id is null) order by m.date desc limit 1`);
  assert.equal((await call('POST', `/api/vpe/people/${pid}/enh`, { level: 1, kind: 'role', item: 'evaluator', date: m.d })).status, 200);
  const [slot] = await q(`select project_id, part from meeting_roles where meeting_id=$1 and person_id=$2 and role_key='evaluator'`, [m.id, pid]);
  assert.ok(slot.project_id && slot.part === 3, 'the slot is for the Evaluation and Feedback evaluator part');
  await q('update meeting_roles set person_id=null, project_id=null where meeting_id=$1 and person_id=$2', [m.id, pid]);
  await q('delete from member_enh where person_id=$1', [pid]);
});
