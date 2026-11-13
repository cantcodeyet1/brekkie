// Reading a club's own agenda: the text pulled from a file, the model's answer turned into blocks, and applying it.
process.env.VERCEL = '1';
process.env.PGLITE_DIR = 'memory://';
process.env.DEMO_MODE = 'true';
delete process.env.DATABASE_URL;
delete process.env.GROQ_API_KEY;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import JSZip from 'jszip';
import { fileText, toBlocks, toProfile } from '../src/agendaRead.js';

const { default: app, ready } = await import('../src/index.js');
const { q } = await import('../src/db.js');
let server, base, vpe;
before(async () => {
  await ready; server = http.createServer(app); await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  vpe = (await (await fetch(base + '/api/dev/accounts')).json()).people.find((p) => p.is_vpe).token;
});
after(() => server?.close());
const call = async (method, path, body, tok) => {
  const r = await fetch(base + path, { method, headers: { ...(tok ? { 'x-token': tok } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

test('text is pulled out of a Word file, tables and text boxes included, without the duplicate copy', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Second Spring Toastmasters Club</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Welcome</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>5 min</w:t></w:r></w:p></w:tc></w:tr></w:tbl><mc:AlternateContent><mc:Choice><w:p><w:r><w:t>Club Mission: we grow people &amp; speakers</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>Club Mission: we grow people &amp; speakers</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:body></w:document>');
  const t = await fileText(await zip.generateAsync({ type: 'nodebuffer' }), 'agenda.docx');
  assert.match(t, /Second Spring Toastmasters Club/);
  assert.match(t, /Welcome \| 5 min/);
  assert.equal((t.match(/Club Mission/g) || []).length, 1);
  assert.match(t, /people & speakers/);
  await assert.rejects(fileText(Buffer.from('hello'), 'notes.txt'), /Word file/);
});

test('the model running order keeps our ids for what it recognises, and always has the speeches', () => {
  const b = toBlocks([
    { title: 'Meeting Called To Order', minutes: 1, owner: 'SAA' }, { title: 'Welcome', minutes: 5, owner: 'Chairperson' }, { title: 'Toast', minutes: 5, owner: 'TMOD' },
    { title: 'Introduction of Role Takers', minutes: 5, owner: 'General Evaluator' }, { title: 'Table Topics', minutes: 10, owner: 'Topics Master' },
    { title: 'Break', minutes: 10 }, { title: 'Speech Evaluations', minutes: 10, owner: 'General Evaluator' }, { title: 'Meeting Adjourned' },
  ]);
  assert.deepEqual(b.map((x) => x.id), ['call', 'welcome', 'toast', 'intro', 'speeches', 'topics', 'item-1', 'evals', 'adjourn']);
  assert.equal(b.find((x) => x.id === 'topics').min, 10);
  assert.equal(b.find((x) => x.id === 'item-1').title, 'Break');
  assert.deepEqual(toBlocks([{ title: 'Welcome' }]), [], 'too little to count as a running order');
  const p = toProfile({ club: { region: ' Area 4 ', mission: 'We grow' }, officers: [{ role: 'President', name: 'A B', phone: '+1' }, { role: '' }] });
  assert.equal(p.region, 'Area 4'); assert.equal(p.officers.length, 1);
});

test('without a key the reader says so plainly; a reviewed template is applied to the club', async () => {
  const r = await call('POST', '/api/agenda-template/read', { name: 'a.pdf', data: Buffer.from('x').toString('base64') });
  assert.equal(r.status, 503); assert.match(r.json.error, /by hand/);
  const blocks = toBlocks([{ title: 'Call', minutes: 1 }, { title: 'Welcome', minutes: 5 }, { title: 'Toast', minutes: 5 }, { title: 'Table Topics', minutes: 10 }, { title: 'Meeting Adjourned' }]);
  const ap = await call('POST', '/api/vpe/club/agenda-template', { profile: { region: 'Area 9, Division Z', mission: 'We learn', officers: [{ role: 'President', name: 'Pat', phone: '' }] }, blocks, start: '1830' }, vpe);
  assert.equal(ap.status, 200);
  const acc = (await call('GET', '/api/account', null, vpe)).json;
  assert.equal(acc.club.agenda_profile.region, 'Area 9, Division Z');
  const [c] = await q('select agenda_default from clubs where id=(select club_id from people where token=$1)', [vpe]);
  assert.equal(JSON.parse(c.agenda_default).start, '1830');
  assert.ok(JSON.parse(c.agenda_default).blocks.some((x) => x.id === 'speeches'));
});

test('a file goes in and a reviewable profile and running order come out (model stubbed)', async () => {
  const { readAgendaTemplate } = await import('../src/agendaRead.js');
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Second Spring Toastmasters Club, an agenda that is long enough to count as having some text in it.</w:t></w:r></w:p></w:body></w:document>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const answer = { club: { name: 'Second Spring Toastmasters Club', number: '2867 6885', region: 'Area 4, Division C, District 129', mission: 'We grow.' }, officers: [{ role: 'President', name: 'Felistas Chikaura', phone: '+263773053499' }], start: '18:00',
    running_order: [{ title: 'Meeting Called To Order', minutes: 1, owner: 'SAA' }, { title: 'Welcome', minutes: 5, owner: 'Chairperson' }, { title: 'Toast', minutes: 5, owner: 'TMOD' }, { title: 'Prepared Speeches' }, { title: 'Table Topics', minutes: 10, owner: 'Topics Master' }] };
  const real = globalThis.fetch; let sent = '';
  process.env.GROQ_API_KEY = 'test'; globalThis.fetch = async (_u, o) => { sent = JSON.parse(o.body).messages[0].content; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }; };
  try {
    const r = await readAgendaTemplate(buf, 'agenda.docx');
    assert.match(sent, /Second Spring Toastmasters Club, an agenda/);
    assert.equal(r.club.number, '28676885'); assert.equal(r.start, '1800'); assert.equal(r.profile.officers[0].name, 'Felistas Chikaura');
    assert.deepEqual(r.blocks.map((b) => b.id), ['call', 'welcome', 'toast', 'speeches', 'topics']);
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(readAgendaTemplate(buf, 'agenda.docx'), /by hand/);
  } finally { globalThis.fetch = real; delete process.env.GROQ_API_KEY; }
});

test('a club\'s own Word file: checked at upload, kept, and filled for each meeting', async () => {
  const fs = await import('node:fs');
  const { checkDocx, fillDocx } = await import('../src/agendaDocx.js');
  const file = fs.readFileSync(new URL('../templates/agenda.docx', import.meta.url));
  const chk = await checkDocx(file);
  assert.equal(chk.usable, true);
  assert.deepEqual(chk.parts.filter((p) => !p.found).map((p) => p.key), [], 'every part of this template is recognised');
  assert.equal((await checkDocx(Buffer.from(await new JSZip().file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello there, nothing like an agenda</w:t></w:r></w:p></w:body></w:document>').generateAsync({ type: 'nodebuffer' })))).usable, false);
  // save it on the club, then download the Word agenda for a meeting
  const data = file.toString('base64');
  assert.equal((await call('POST', '/api/vpe/club/agenda-template', { file: { name: 'our agenda.docx', data } }, vpe)).status, 200);
  const acc = (await call('GET', '/api/account', null, vpe)).json;
  assert.equal(acc.club.agenda_template.name, 'our agenda.docx');
  const bad = await call('POST', '/api/vpe/club/agenda-template', { file: { name: 'x.docx', data: Buffer.from('not a zip').toString('base64') } }, vpe);
  assert.ok(bad.status >= 400 && bad.status < 500);
  const [m] = await q('select id from meetings where club_id=(select club_id from people where token=$1) order by date limit 1', [vpe]);
  await q(`update meetings set theme='Boundless Test Theme' where id=$1`, [m.id]);
  const r = await fetch(`${base}/api/vpe/meetings/${m.id}/agenda.docx`, { headers: { 'x-token': vpe } });
  assert.equal(r.status, 200);
  const out = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
  assert.match(await out.file('word/document.xml').async('string'), /Boundless Test Theme/);
  const f = await fillDocx(file, { start: '1800', buffer: 3, gap: 1, next_meeting: '2031-03-18', roles: { tmod: 'Zed' }, blocks: [], speeches: [], reports: { items: [] } }, { clubNumber: '1', m: { date: '2031-03-04', theme: 'T' } });
  assert.ok(f.found.date && f.found.roles);
  assert.equal((await call('POST', '/api/vpe/club/agenda-template', { remove_template: true }, vpe)).status, 200);
  assert.equal((await call('GET', '/api/account', null, vpe)).json.club.agenda_template, undefined);
});
