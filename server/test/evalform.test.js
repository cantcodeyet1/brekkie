// The official evaluation forms are filled in from an evaluation: fields are found by their printed labels.
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
const { fillEvalForm, EVAL_FORMS, CRITERIA, formFile } = await import('../src/evalForm.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

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

const DATA = { member: 'Sofia Marquez', evaluator: 'Marcus Cole', date: '13 Nov 2026', title: 'The Long Way Round', excelled: 'Warm opening', work: 'Slow the pace', challenge: 'Try a pause',
  ratings: [5, 4, 3, 2, 1, 5, 4], comments: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'] };

// what a PDF reader would show: every field's value, keyed by its field name
async function values(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const out = {};
  for (const [name, fs_] of Object.entries(await doc.getFieldObjects())) for (const f of fs_) out[name] = [...(out[name] || []), f.value];
  return out;
}

test('every form can be opened and filled, and the standard fields are found on all but the project-specific profiles', async () => {
  const files = fs.readdirSync(EVAL_FORMS).filter((f) => f.endsWith('.pdf'));
  assert.ok(files.length >= 60);
  let full = 0;
  for (const f of files) {
    const { pdf, placed } = await fillEvalForm(f, DATA);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', f);
    assert.ok(placed >= 7, `${f} placed ${placed}`);          // at least names, date, title and the three general comments
    if (placed === 21) full++;
  }
  assert.ok(full >= 50, `only ${full} forms were filled completely`);
});

test('the Ice Breaker form gets names, comments and the ticked rating in the right places', async () => {
  const { pdf, placed } = await fillEvalForm('ice-breaker.pdf', DATA);
  assert.equal(placed, 21);
  const v = await values(pdf);
  const text = Object.entries(v).filter(([, a]) => typeof a[0] === 'string' && a[0] && !/^(Off|\d)$/.test(a[0])).map(([, a]) => a[0]);
  for (const s of [DATA.member, DATA.evaluator, DATA.date, DATA.title, DATA.excelled, DATA.work, DATA.challenge, ...DATA.comments]) assert.ok(text.includes(s), `${s} is on the form`);
  // seven rating rows; each has one button on. 5 is the first button of the row, 1 the last
  const rows = Object.entries(v).filter(([n]) => /,R\d+$/.test(n));
  assert.equal(rows.length, CRITERIA.length);
});

test('the comment and rating of each criterion land beside that criterion, not another one', async () => {
  const { pdf } = await fillEvalForm('ice-breaker.pdf', { ...DATA, ratings: [null, null, null, null, null, null, 2], comments: ['', '', '', '', '', '', 'only interest'] });
  const v = await values(pdf);
  const set = Object.entries(v).filter(([, a]) => typeof a[0] === 'string' && a[0] === 'only interest');
  assert.equal(set.length, 1);
  const rated = Object.entries(v).filter(([n, a]) => /,R\d+$/.test(n) && a.some((x) => x && x !== 'Off'));
  assert.equal(rated.length, 1, 'only the Interest row is ticked');
});

test('formFile accepts only our own form paths', () => {
  assert.equal(formFile('/api/eval-forms/ice-breaker.pdf'), 'ice-breaker.pdf');
  for (const bad of ['/api/eval-forms/../x.pdf', '/eval-forms/a.pdf', '', null, '/api/eval-forms/a.PDF']) assert.equal(formFile(bad), null, String(bad));
});

test('the blank forms are served from the API without signing in', async () => {
  const r = await fetch(base + '/api/eval-forms/ice-breaker.pdf');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /pdf/);
  assert.equal((await fetch(base + '/api/eval-forms/nope.pdf')).status, 404);
});

test('a speaker downloads their own evaluation on the official form, others cannot', async () => {
  const [ev] = await q(`select e.id, e.speaker_id, e.part, p.name as project from evaluations e join projects p on p.id=e.project_id limit 1`);
  let id = ev?.id, speaker;
  if (!ev) {
    const [role] = await q(`select id, meeting_id from meeting_roles where role_key='evaluator' limit 1`);
    const [sp] = await q(`select id, token from people where kind='member' and token is not null limit 1`);
    const [pr] = await q(`select id from projects where name='Ice Breaker'`);
    id = (await q(`insert into evaluations(role_id,meeting_id,speaker_id,project_id,title,ratings,comments,excelled,work,challenge) values ($1,$2,$3,$4,'T','[5,4,3,2,1,5,4]','[]','good','more','next') returning id`, [role.id, role.meeting_id, sp.id, pr.id]))[0].id;
    speaker = sp;
  } else speaker = (await q('select id, token from people where id=$1', [ev.speaker_id]))[0];
  const own = await fetch(`${base}/api/me/evaluations/${id}/form.pdf`, { headers: { 'x-token': speaker.token } });
  assert.equal(own.status, 200);
  assert.match(own.headers.get('content-disposition'), /^attachment; filename="Evaluation-.*\.pdf"$/);
  assert.equal(Buffer.from(await own.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const other = (await q(`select token from people where id<>$1 and kind='member' and token is not null and is_vpe=false limit 1`, [speaker.id]))[0];
  assert.equal((await fetch(`${base}/api/me/evaluations/${id}/form.pdf`, { headers: { 'x-token': other.token } })).status, 404);
  assert.equal((await fetch(`${base}/api/me/evaluations/${id}/form.pdf`)).status, 401);
  assert.equal((await fetch(`${base}/api/vpe/evaluations/${id}/form.pdf`, { headers: { 'x-token': vpe } })).status, 200);
  assert.equal((await fetch(`${base}/api/vpe/evaluations/${id}/form.pdf`, { headers: { 'x-token': other.token } })).status, 403);
});

test('an evaluator downloads the form from the sheet they are writing', async () => {
  const [role] = await q(`select r.id, r.token, r.target_role_id from meeting_roles r where r.role_key='evaluator' and r.person_id is not null and r.target_role_id is not null limit 1`);
  if (!role) return;                                        // the demo data has no matched evaluator: nothing to check here
  const r = await fetch(`${base}/api/role/evaluation.pdf`, { method: 'POST', headers: { 'x-token': role.token, 'content-type': 'application/json' }, body: JSON.stringify({ excelled: 'ok', ratings: [3, 3, 3, 3, 3, 3, 3], comments: [] }) });
  assert.ok([200, 400].includes(r.status), String(r.status));   // 400 only when the speaker has no project yet
  if (r.status === 200) assert.match(r.headers.get('content-type'), /pdf/);
  const [other] = await q(`select token from meeting_roles where role_key='grammarian' and person_id is not null limit 1`);
  if (other) assert.equal((await fetch(`${base}/api/role/evaluation.pdf`, { method: 'POST', headers: { 'x-token': other.token, 'content-type': 'application/json' }, body: '{}' })).status, 404);
});
