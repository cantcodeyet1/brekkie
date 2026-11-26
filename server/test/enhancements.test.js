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

test('VPE committee: a member can be added and removed, the club keeps one VPE, and the role can be handed over', async () => {
  const demo = await (await fetch(base + '/api/dev/accounts')).json();
  const me = demo.people.find((p) => p.is_vpe);
  const meId = me.id;
  try {
    assert.equal((await call('POST', `/api/vpe/people/${pid}/committee`, { on: true })).status, 200);
    assert.equal((await q('select is_vpe from people where id=$1', [pid]))[0].is_vpe, true);
    // a committee member has the VPE's access, but cannot hand VPE access to anyone
    const theirs = demo.people.find((x) => x.id === pid).token;
    const asCommittee = await fetch(base + `/api/vpe/people/${meId}/committee`, { method: 'POST', headers: { 'x-token': theirs, 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) });
    assert.equal(asCommittee.status, 403);
    assert.equal((await fetch(base + '/api/vpe/meetings', { headers: { 'x-token': theirs } })).status < 400, true);
    assert.equal((await call('POST', `/api/vpe/people/${pid}/committee`, { on: false })).status, 200);
    // the only VPE cannot be taken off
    const only = await call('POST', `/api/vpe/people/${meId}/committee`, { on: false });
    assert.equal(only.status, 409);
    // handing over: the other member becomes the VPE and the old one steps down
    assert.equal((await call('POST', '/api/vpe/transfer', { to: pid })).status, 200);
    const rows = await q('select id, is_vpe from people where id in ($1,$2)', [meId, pid]);
    assert.equal(rows.find((r) => r.id === pid).is_vpe, true);
    assert.equal(rows.find((r) => r.id === meId).is_vpe, false);
    assert.equal((await call('POST', `/api/vpe/people/${pid}/committee`, { on: true })).status, 403, 'a member without the role cannot change it');
  } finally { await q('update people set is_vpe=(id=$1) where id in ($1,$2)', [meId, pid]); }
});

test('one login at two clubs: signing in links them, and the switcher lists both', async () => {
  const { hashPw } = await import('../src/club.js');
  const [c2] = await q(`insert into clubs(name) values ('Switch Test Club') returning id`);
  const h = hashPw('Switch-Test-1');
  const [a] = await q(`insert into people(club_id,name,email,kind,status,is_vpe,token,password_hash) values (1,'Switcher One','switcher@example.com','member','active',true,'tok-sw-a',$1) returning id`, [h]);
  const [b] = await q(`insert into people(club_id,name,email,kind,status,is_vpe,token,password_hash) values ($1,'Switcher Two','switcher@example.com','member','active',false,'tok-sw-b',$2) returning id`, [c2.id, hashPw('Switch-Test-1')]);
  try {
    const si = await (await fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'switcher@example.com', password: 'Switch-Test-1' }) })).json();
    assert.equal(si.choose.length, 2);
    const list = await (await fetch(base + '/api/me/clubs', { headers: { 'x-token': 'tok-sw-a' } })).json();
    assert.deepEqual(list.clubs.map((c) => c.club).sort(), ['Champions Toastmasters Club', 'Switch Test Club']);
    assert.equal(list.clubs.find((c) => c.current).type, 'vpe');
    assert.equal(list.clubs.find((c) => !c.current).type, 'member');
    // someone who is in one club sees no switcher
    const solo = await (await fetch(base + '/api/me/clubs', { headers: { 'x-token': vpe } })).json();
    assert.deepEqual(solo.clubs, []);
  } finally { await q('delete from people where id in ($1,$2)', [a.id, b.id]); await q('delete from clubs where id=$1', [c2.id]); }
});

test('starting another club gives a clean, separate club: no members, meetings or tokens shared with the first', async () => {
  const { hashPw } = await import('../src/club.js');
  const h = hashPw('Another-Test-1');
  const [a] = await q(`insert into people(club_id,name,email,kind,status,is_vpe,token,password_hash) values (1,'Starter One','starter@example.com','member','active',true,'tok-start-a',$1) returning id`, [h]);
  const post = (tok, body) => fetch(base + '/api/clubs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tok }, body: JSON.stringify(body) });
  const club = { name: 'Fresh Start Club', number: '8812345', firstNumber: 1, pattern: { day: 3, mode: 'weekly', start: '2026-07-01' } };
  let newClub;
  try {
    const before1 = (await q('select count(*)::int as n from people where club_id=1'))[0].n, meet1 = (await q('select count(*)::int as n from meetings where club_id=1'))[0].n;
    assert.equal((await post('', { another: true, club })).status, 401);                    // signed out: refused
    const r = await post('tok-start-a', { another: true, club });
    assert.equal(r.status, 200);
    const s = await r.json();
    assert.notEqual(s.token, 'tok-start-a');
    [newClub] = await q('select id, tm_number from clubs where tm_number=$1', ['8812345']);
    assert.notEqual(newClub.id, 1);
    // the new club holds only its own VPE and its own meetings
    const ppl = await q('select name, is_vpe, token from people where club_id=$1', [newClub.id]);
    assert.equal(ppl.length, 1); assert.equal(ppl[0].is_vpe, true); assert.equal(ppl[0].name, 'Starter One');
    assert.ok((await q('select count(*)::int as n from meetings where club_id=$1', [newClub.id]))[0].n > 0);
    assert.equal((await q('select count(*)::int as n from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=$1 and r.person_id in (select id from people where club_id<>$1)', [newClub.id]))[0].n, 0);
    // the first club is untouched
    assert.equal((await q('select count(*)::int as n from people where club_id=1'))[0].n, before1);
    assert.equal((await q('select count(*)::int as n from meetings where club_id=1'))[0].n, meet1);
    // the new token sees only the new club
    const mine = await (await fetch(base + '/api/vpe/people', { headers: { 'x-token': s.token } })).json();
    const names = (Array.isArray(mine) ? mine : mine.people || []).map((p) => p.name);
    assert.deepEqual(names, ['Starter One']);
    // both clubs are listed to the owner, from either one
    for (const tok of ['tok-start-a', s.token]) {
      const l = await (await fetch(base + '/api/me/clubs', { headers: { 'x-token': tok } })).json();
      assert.equal(l.clubs.length, 2);
    }
    // a club number already in use is refused, and nothing is created
    assert.equal((await post('tok-start-a', { another: true, club: { ...club, name: 'Copy Club' } })).status, 409);
    assert.equal((await q('select count(*)::int as n from clubs where name=$1', ['Copy Club']))[0].n, 0);
  } finally {
    if (newClub) { await q('delete from meeting_roles where meeting_id in (select id from meetings where club_id=$1)', [newClub.id]); await q('delete from meetings where club_id=$1', [newClub.id]); await q('delete from people where club_id=$1', [newClub.id]); await q('delete from clubs where id=$1', [newClub.id]); }
    await q('delete from people where id=$1', [a.id]);
  }
});

test('the agenda preview draws the club page from the details on screen, saved or not', async () => {
  const r = await fetch(base + '/api/vpe/club/agenda-preview', { method: 'POST', headers: { 'x-token': vpe, 'content-type': 'application/json' }, body: JSON.stringify({ profile: { region: 'Area 9, Division Z, District 1', officers: [{ role: 'President', name: 'Test Person', phone: '' }] } }) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /pdf/);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  assert.equal((await fetch(base + '/api/vpe/club/agenda-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});

test('removing a speaker moves the later speakers and evaluators up, so the numbers have no gaps', async () => {
  const [m] = await q(`select id from meetings where club_id=1 and date >= current_date order by date desc limit 1`);
  const slots = async (key) => q('select id, label, target_role_id from meeting_roles where meeting_id=$1 and role_key=$2 order by position', [m.id, key]);
  await call('POST', `/api/vpe/meetings/${m.id}/roles`, { role_key: 'speaker' });
  await call('POST', `/api/vpe/meetings/${m.id}/roles`, { role_key: 'evaluator' });
  const sp = await slots('speaker'), ev = await slots('evaluator'), n = sp.length;
  assert.ok(n >= 3);
  const gone = sp[1], its = ev.find((e) => e.target_role_id === gone.id) || ev[1];
  await call('DELETE', `/api/vpe/roles/${its.id}`);
  await call('DELETE', `/api/vpe/roles/${gone.id}`);
  const sp2 = await slots('speaker'), ev2 = await slots('evaluator');
  assert.deepEqual(sp2.map((r) => r.label), Array.from({ length: n - 1 }, (_, i) => `Speaker ${i + 1}`));
  assert.deepEqual(ev2.map((r) => r.label), ev2.map((_, i) => `Speech Evaluator ${i + 1}`));
  assert.equal(sp2[1].id, sp[2].id);   // the third speaker is now the second
});

test('the Toastmaster link lists every speaker with contact details, and role sheets get credentials', async () => {
  const [m] = await q(`select m.id from meetings m where m.club_id=1 and m.date >= current_date order by m.date limit 1`);
  const [tm] = await q(`select id, token from meeting_roles where meeting_id=$1 and role_key='toastmaster'`, [m.id]);
  const [sp] = await q(`select id, person_id from meeting_roles where meeting_id=$1 and role_key='speaker' order by position limit 1`, [m.id]);
  const who = sp.person_id || pid;
  await q('update meeting_roles set person_id=$1 where id=$2', [who, sp.id]);
  await q(`update people set phone='+263 77 000 0000' where id=$1`, [who]);
  await q('update meeting_roles set person_id=coalesce(person_id,$1) where id=$2', [pid, tm.id]);
  const d = await (await fetch(base + '/api/role', { headers: { 'x-token': tm.token } })).json();
  assert.ok(d.partners.some((p) => p.person_id === who && p.phone === '+263 77 000 0000' && p.label === 'Speaker 1'));
  assert.ok(d.people.every((p) => 'credential' in p));
});

test('role links and the member page carry their own club and VPE, not a fixed one', async () => {
  const [tm] = await q(`select r.token from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=1 and r.person_id is not null order by m.date desc limit 1`);
  const d = await (await fetch(base + '/api/role', { headers: { 'x-token': tm.token } })).json();
  const [v] = await q(`select name from people where club_id=1 and is_vpe and status<>'inactive' order by committee, id limit 1`);
  assert.equal(d.vpe.name, v.name);
  const o = await (await fetch(base + '/api/me/overview', { headers: { 'x-token': vpe } })).json();
  const [c] = await q('select name from clubs where id=1');
  assert.equal(o.club, c.name);
});

test('project purposes hold only the purpose: no form header text or stray control characters', async () => {
  const rows = await q('select name, purpose, notes, about, parts from projects');
  const bad = [];
  const walk = (v, name) => { if (typeof v === 'string') { if (/[\u0000-\u0008]|Speech Length|Project Purpose/.test(v)) bad.push(name); } else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, name)); };
  for (const r of rows) walk([r.purpose, r.notes, r.about, r.parts], r.name);
  assert.deepEqual(bad, []);
  const [w] = await q(`select purpose from projects where name='Writing a Speech with Purpose'`);
  assert.match(w.purpose[0], /^The purpose of this project/);
});

test('the Champions agenda keeps its banner and QR code, with or without saved club details; other clubs get neither', async () => {
  const { loadContext, defaultAgenda } = await import('../src/agenda.js');
  const { renderAgendaPdf } = await import('../src/agendaPdf.js');
  const [m] = await q('select id from meetings where club_id=1 order by date desc limit 1');
  const ctx = await loadContext(m.id, 1);
  const size = async (over) => (await renderAgendaPdf(defaultAgenda({ ...ctx, ...over }), { ...ctx, ...over, brochure: null })).length;
  const prof = { region: 'Area 2', officers: [] };
  const withBanner = await size({ champions: true, profile: prof }), without = await size({ champions: false, profile: prof });
  assert.ok(withBanner > without + 1000, `${withBanner} v ${without}`);
});
