// The configurable agenda: running order, calculated times, the club standard and the PDF drawn on the club page.
process.env.VERCEL = '1';
process.env.PGLITE_DIR = 'memory://';
process.env.DEMO_MODE = 'true';
delete process.env.DATABASE_URL;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { default: app, ready } = await import('../src/index.js');
const { q } = await import('../src/db.js');
const A = await import('../src/agenda.js');
const { renderAgendaPdf, agendaFits } = await import('../src/agendaPdf.js');

let server, base, vpe, member, meeting;
before(async () => {
  await ready;
  server = http.createServer(app);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  const demo = await (await fetch(base + '/api/dev/accounts')).json();
  vpe = demo.people.find((p) => p.is_vpe).token;
  member = demo.people.find((p) => !p.is_vpe && p.kind === 'member').token;
  [meeting] = await q(`select m.id, m.club_id from meetings m join meeting_roles r on r.meeting_id=m.id where r.role_key='speaker' and r.person_id is not null limit 1`);
});
after(() => server?.close());

const call = async (method, path, token, body) => {
  const r = await fetch(base + path, { method, headers: { ...(token ? { 'x-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch { /* binary */ }
  return { status: r.status, json, buf, type: r.headers.get('content-type') };
};
const ctxOf = () => A.loadContext(meeting.id, meeting.club_id);

test('the longest time of a speech decides its slot, with the same buffer after each', () => {
  assert.equal(A.maxMinutes('5 - 7 min'), 7);
  assert.equal(A.maxMinutes('10 – 12 minutes'), 12);
  assert.equal(A.maxMinutes(''), 7);
  const ag = { start: '1800', buffer: 3, gap: 1, blocks: [{ id: 'speeches', type: 'speeches', title: 'x' }, { id: 'a', type: 'item', title: 'A', min: 5, owner: '' }], speeches: [{ role_id: 1, length: '5 - 7 min' }, { role_id: 2, length: '10 - 12 min' }, { role_id: 3, length: '5 - 7 min' }] };
  A.schedule(ag);
  assert.deepEqual(ag.speeches.map((s) => s.time), ['1800', '1810', '1825']);   // 7+3, 12+3, 7+3
  assert.equal(ag.blocks[1].time, '1835');                                       // the next item follows the last speech
  ag.buffer = 0; A.schedule(ag);
  assert.deepEqual(ag.speeches.map((s) => s.time), ['1800', '1807', '1819']);
});

test('items, a gap between them and a fixed time work out the running order', () => {
  const ag = { start: '1800', buffer: 3, gap: 2, blocks: [{ id: 'a', type: 'item', title: 'A', min: 5 }, { id: 'b', type: 'item', title: 'B', min: 10 }, { id: 'c', type: 'item', title: 'C', min: 5, at: '1900' }, { id: 'd', type: 'item', title: 'D', min: 0 }], speeches: [], end: '1915' };
  A.schedule(ag);
  assert.deepEqual(ag.blocks.map((b) => b.time), ['1800', '1807', '1900', '1907']);
  assert.equal(ag.ends, '1907'); assert.equal(ag.over, -8);
});

test('blocks are cleaned: unknown types, repeats and oversized lists are dropped', () => {
  const out = A.cleanBlocks([{ id: 'a', type: 'item', title: 'x'.repeat(500), min: 9999, owner: 5 }, { id: 'a', type: 'item', title: 'repeat' }, { id: 'b', type: 'evil' }, { type: 'item' }, { id: 's1', type: 'speeches' }, { id: 's2', type: 'speeches' }, { id: 'r', type: 'reports', title: 'R', min: 3, at: 'nope' }, null, 7]);
  assert.deepEqual(out.map((b) => b.id), ['a', 's1', 'r']);
  assert.equal(out[0].title.length, 80); assert.equal(out[0].min, 180);
  assert.equal(out[2].at, undefined);
  assert.equal(A.cleanBlocks(Array.from({ length: 80 }, (_, i) => ({ id: 'i' + i, type: 'item', title: 'x', min: 1 }))).length, 30);
});

test('removing Table Topics and adding an educational session moves everything after it', async () => {
  const first = await call('GET', `/api/vpe/meetings/${meeting.id}/agenda`, vpe);
  assert.equal(first.status, 200);
  const ag = first.json.agenda, ids = ag.blocks.map((b) => b.id);
  assert.ok(ids.includes('topics') && ids.includes('speeches'));
  const evalsBefore = ag.blocks.find((b) => b.id === 'evals').time;
  const blocks = ag.blocks.filter((b) => b.id !== 'topics');
  blocks.splice(blocks.findIndex((b) => b.id === 'evals'), 0, { id: 'edu-1', type: 'item', title: 'Educational Session', min: 15, owner: 'A Guest', topic: 'Kind feedback' });
  const put = await call('PUT', `/api/vpe/meetings/${meeting.id}/agenda`, vpe, { ...ag, blocks, chair: 'Pat Chair' });
  assert.equal(put.status, 200);
  const after = (await call('GET', `/api/vpe/meetings/${meeting.id}/agenda`, vpe)).json.agenda;
  assert.deepEqual(after.blocks.map((b) => b.id), blocks.map((b) => b.id));
  assert.equal(after.blocks.find((b) => b.id === 'edu-1').topic, 'Kind feedback');
  assert.equal(after.chair, 'Pat Chair');
  assert.notEqual(after.blocks.find((b) => b.id === 'evals').time, evalsBefore);
  // times are never stored: only the order and what was typed
  const [row] = await q('select agenda from meetings where id=$1', [meeting.id]);
  assert.ok(!JSON.stringify(row.agenda).includes('"time"'));
  // and a reset goes back to the standard layout
  const reset = await call('POST', `/api/vpe/meetings/${meeting.id}/agenda/reset`, vpe, { what: 'all' });
  assert.ok(reset.json.agenda.blocks.some((b) => b.id === 'topics'));
});

test('the club standard is what other agendas start from, until it is cleared', async () => {
  const ag = (await call('GET', `/api/vpe/meetings/${meeting.id}/agenda`, vpe)).json.agenda;
  const blocks = ag.blocks.filter((b) => b.id !== 'topics');
  assert.equal((await call('PUT', '/api/vpe/agenda-standard', vpe, { ...ag, blocks, buffer: 5, chair: 'Standing Chair' })).status, 200);
  const [other] = await q('select id from meetings where club_id=$1 and id<>$2 limit 1', [meeting.club_id, meeting.id]);
  const got = (await call('GET', `/api/vpe/meetings/${other.id}/agenda`, vpe)).json;
  assert.ok(got.standard);
  assert.ok(!got.agenda.blocks.some((b) => b.id === 'topics'));
  assert.equal(got.agenda.buffer, 5); assert.equal(got.agenda.chair, 'Standing Chair');
  assert.equal((await call('PUT', '/api/vpe/agenda-standard', member, { buffer: 9 })).status, 403);
  assert.equal((await call('DELETE', '/api/vpe/agenda-standard', vpe)).status, 200);
  const back = (await call('GET', `/api/vpe/meetings/${other.id}/agenda`, vpe)).json;
  assert.ok(back.agenda.blocks.some((b) => b.id === 'topics')); assert.equal(back.agenda.buffer, 3);
});

test('an agenda saved in the older format (rows by position) still reads', async () => {
  const ctx = await ctxOf(); const def = A.defaultAgenda(ctx);
  const ag = A.mergeAgenda(def, { start: '1830', opening: [{ time: '1830', title: 'Opening Words', min: '2 min', owner: 'SAA' }], closing: [{ min: '15 min' }] });
  assert.equal(ag.blocks[0].title, 'Opening Words'); assert.equal(ag.blocks[0].min, 2);
  assert.equal(ag.blocks.find((b) => b.id === 'topics').min, 15);
  assert.equal(ag.start, '1830');
});

test('the PDF is drawn on the club page for any running order, and says when it will not fit', async () => {
  const ctx = await ctxOf(); const def = A.defaultAgenda(ctx);
  const r = await call('GET', `/api/vpe/meetings/${meeting.id}/agenda.pdf`, vpe);
  assert.equal(r.status, 200); assert.match(r.type, /pdf/); assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-');
  const extra = Array.from({ length: 14 }, (_, i) => ({ id: 'x' + i, type: 'item', title: 'Extra item ' + i, min: 3, owner: 'Someone', topic: 'A note' }));
  const many = A.mergeAgenda(def, { blocks: [...def.blocks, ...extra].slice(0, 30) });
  const pdf = await renderAgendaPdf(many, ctx);
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
  assert.equal(await agendaFits(def, ctx), true);
  assert.equal(await agendaFits(many, ctx), false);
  // names with accents and symbols the standard fonts lack must not break it
  const odd = A.mergeAgenda(def, { chair: 'Zoë Ñandú ṭ 😀', speeches: Object.fromEntries(def.speeches.map((s) => [s.role_id, { title: 'Ünï “quoted” ṭ', evaluator: 'Ã Ž' }])) });
  assert.equal(Buffer.from(await renderAgendaPdf(odd, ctx)).subarray(0, 5).toString(), '%PDF-');
});

test('Word and PDF downloads work for a member, a role link and the VPE, and not for outsiders', async () => {
  for (const ext of ['docx', 'pdf']) {
    assert.equal((await call('GET', `/api/me/meetings/${meeting.id}/agenda.${ext}`, member)).status, 200);
    assert.equal((await call('GET', `/api/vpe/meetings/${meeting.id}/agenda.${ext}`, member)).status, 403);
    assert.equal((await call('GET', `/api/me/meetings/${meeting.id}/agenda.${ext}`)).status, 401);
  }
  const named = await fetch(`${base}/api/vpe/meetings/${meeting.id}/agenda.pdf`, { headers: { 'x-token': vpe } });
  assert.match(named.headers.get('content-disposition'), /filename="Champions Toastmasters Agenda \d\d\.\d\d\.\d\d\.pdf"/);
  const [role] = await q(`select r.token from meeting_roles r where r.person_id is not null and r.token is not null and r.meeting_id=$1 limit 1`, [meeting.id]);
  assert.equal((await call('GET', '/api/role/agenda.pdf', role.token)).status, 200);
});

test('the Word file follows the running order: an educational session in, no speeches table when there are none', async () => {
  const JSZip = (await import('jszip')).default;
  const ctx = await ctxOf(); const def = A.defaultAgenda(ctx);
  const blocks = def.blocks.filter((b) => b.id !== 'topics'); blocks.splice(blocks.findIndex((b) => b.id === 'evals'), 0, { id: 'edu', type: 'item', title: 'Educational Session', min: 15, owner: 'Tanaka', topic: 'Listening' });
  const ag = A.mergeAgenda(def, { blocks });
  const xml = await (await JSZip.loadAsync(await A.buildDocx(ag, ctx))).file('word/document.xml').async('string');
  assert.ok(xml.includes('Educational Session') && xml.includes('Listening') && xml.includes('Tanaka'));
  assert.ok(!xml.includes('>Table Topics<'));
  const noSpeeches = A.mergeAgenda(def, { blocks: blocks.filter((b) => b.type !== 'speeches') });
  const x2 = await (await JSZip.loadAsync(await A.buildDocx(noSpeeches, ctx))).file('word/document.xml').async('string');
  assert.ok(!x2.includes('Project Details'));
});

test('the club number is set in the club settings, shown on the agenda, and unique', async () => {
  const club = (await call('GET', '/api/account', vpe)).json.club;
  const put = (b) => call('PUT', '/api/vpe/club', vpe, { name: club.name, pattern: club.pattern || { day: 3, mode: 'weekly', start: '2026-01-07' }, guest_days: club.guest_days, ...b });
  assert.equal((await put({ number: '12' })).status, 400);
  assert.equal((await put({ number: '55 66-77' })).status, 200);
  assert.equal((await call('GET', '/api/account', vpe)).json.club.number, '556677');
  const JSZip = (await import('jszip')).default;
  const ctx = await ctxOf();
  assert.equal(ctx.clubNumber, '556677');
  const xml = await (await JSZip.loadAsync(await A.buildDocx(A.defaultAgenda(ctx), ctx))).file('word/document.xml').async('string');
  assert.ok(xml.includes('Club Number: 556677') && !xml.includes('04647453'));
  assert.equal(Buffer.from(await renderAgendaPdf(A.defaultAgenda(ctx), ctx)).subarray(0, 5).toString(), '%PDF-');
  const [other] = await q('select id from clubs where id<>$1 limit 1', [meeting.club_id]);
  if (other) { await q('update clubs set tm_number=$1 where id=$2', ['998877', other.id]); assert.equal((await put({ number: '998877' })).status, 409); await q('update clubs set tm_number=null where id=$1', [other.id]); }
  assert.equal((await put({ number: '' })).status, 200);
  assert.equal((await call('GET', '/api/account', vpe)).json.club.number, '');
  assert.equal((await put({})).status, 200, 'saving without a number leaves it alone');
});
