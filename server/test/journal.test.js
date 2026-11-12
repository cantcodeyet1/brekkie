// The member journal, and importing a roster into a club that already has people.
process.env.VERCEL = '1';
process.env.PGLITE_DIR = 'memory://';
process.env.DEMO_MODE = 'true';
delete process.env.DATABASE_URL;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { default: app, ready } = await import('../src/index.js');

let server, base, vpe, member, memberId;
before(async () => {
  await ready;
  server = http.createServer(app);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  const demo = await (await fetch(base + '/api/dev/accounts')).json();
  vpe = demo.people.find((p) => p.is_vpe).token;
  const m = demo.people.find((p) => !p.is_vpe && p.kind === 'member');
  member = m.token; memberId = m.id;
});
after(() => server?.close());

async function call(method, path, { token, body } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { 'x-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

test('journal notes are dated, editable, and private to the VPE', async () => {
  const add = await call('POST', `/api/vpe/people/${memberId}/journal`, { token: vpe, body: { body: '# Why\nJoined to speak at her brother\'s wedding', date: '2026-10-02' } });
  assert.equal(add.status, 200, add.text);
  assert.equal(add.json.date, '2026-10-02');
  await call('POST', `/api/vpe/people/${memberId}/journal`, { token: vpe, body: { body: 'Pace when nervous' } });
  assert.equal((await call('POST', `/api/vpe/people/${memberId}/journal`, { token: vpe, body: { body: '   ' } })).status, 400);
  const list = (await call('GET', `/api/vpe/people/${memberId}/journal`, { token: vpe })).json;
  assert.equal(list.length, 2);
  assert.equal(list[0].body, 'Pace when nervous', 'newest first (today is after 2 Oct)');
  assert.equal((await call('PATCH', `/api/vpe/journal/${add.json.id}`, { token: vpe, body: { body: 'Edited' } })).status, 200);
  assert.equal((await call('GET', `/api/vpe/people/${memberId}/journal`, { token: vpe })).json.find((n) => n.id === add.json.id).body, 'Edited');
  assert.equal((await call('GET', `/api/vpe/people/${memberId}/journal`, { token: member })).status, 403, 'a member cannot read the journal');
  assert.equal((await call('GET', `/api/vpe/people/${memberId}/profile`, { token: vpe })).json.journal_count, 2);
  assert.equal((await call('DELETE', `/api/vpe/journal/${add.json.id}`, { token: vpe })).status, 200);
  assert.equal((await call('GET', `/api/vpe/people/${memberId}/journal`, { token: vpe })).json.length, 1);
});

test('importing: people already in the club are matched, and levels can be credited to this program year', async () => {
  const made = await call('POST', '/api/vpe/people', { token: vpe, body: { name: 'Catch Up Person', email: 'catchup@example.com', path_name: 'Dynamic Leadership', levels_done: 0 } });
  assert.equal(made.status, 200, made.text);
  const match = await call('POST', '/api/vpe/people/import/match', { token: vpe, body: { members: [{ name: 'Catch Up Person', email: '' }, { name: 'Someone Brand New', email: 'new@example.com' }, { name: 'x', email: 'catchup@example.com' }] } });
  assert.equal(match.json[0].id, made.json.id, 'matched by name');
  assert.equal(match.json[1], null);
  assert.equal(match.json[2].id, made.json.id, 'matched by email');
  const up = await call('POST', '/api/vpe/people/import', { token: vpe, body: { members: [{ name: 'Catch Up Person', email: 'catchup@example.com', path_name: 'Dynamic Leadership', levels_done: 3, levels_this_year: 1 }] } });
  assert.deepEqual([up.json.added, up.json.updated], [0, 1]);
  const prog = (await call('GET', `/api/vpe/people/${made.json.id}/path`, { token: vpe })).json;
  assert.deepEqual(prog.levels.slice(0, 3).map((l) => l.complete), [true, true, true]);
  const stamp = (n) => prog.levels[n].projects.find((p) => p.kind === 'required').done;
  assert.equal(stamp(0).date, null, 'level 1 was earned before this year');
  assert.ok(stamp(2).date, 'level 3 is dated, so it counts this year');
  const list = (await call('GET', '/api/vpe/people', { token: vpe })).json.find((p) => p.id === made.json.id);
  assert.equal(list.levels_this_year, 1);
  // saving again without the year keeps the dates already given
  await call('PATCH', `/api/vpe/people/${made.json.id}`, { token: vpe, body: { path_name: 'Dynamic Leadership', levels_done: 3 } });
  assert.equal((await call('GET', '/api/vpe/people', { token: vpe })).json.find((p) => p.id === made.json.id).levels_this_year, 1);
});
