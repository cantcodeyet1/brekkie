import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, tx } from './db.js';
import { seedIfEmpty } from './seed.js';
import { loadHist, progressFor, summary } from './progress.js';
import { buildDocx, defaultAgenda, diffAgenda, loadContext, mergeAgenda } from './agenda.js';
import { docxToPdf, pdfAvailable } from './pdf.js';
import { nextClubDate } from './schedule.js';
import { checkPw, cleanPattern, describePattern, generateMeetings, hashPw, joinCode, normEmail, nextPatternDate, pwProblem, validEmail } from './club.js';
import { validWord, wordDetails } from './words.js';
import { ensurePathways } from './pathways.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = process.env.DEMO_MODE !== 'false';
const app = express();
app.use(cors());
// health answers before start-up finishes and says whether the database is reachable (never the connection string)
app.get('/api/health', (_req, res) => ready.then(() => res.json({ ok: true }), (e) => res.status(503).json({ ok: false, db: String(e.code || e.name || 'error'), why: String(e.message || '').replace(/postgres(ql)?:\/\/\S+/gi, '').slice(0, 120) })));
app.use((_req, _res, next) => { ready.then(() => next(), next); });
app.use(express.json({ limit: '1mb' }));

const token = () => crypto.randomBytes(15).toString('base64url');
const EVAL_RESOURCES = JSON.parse(fs.readFileSync(new URL('../data/evaluation-resources.json', import.meta.url), 'utf8'));
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const FEEDBACK_KEYS = ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'general_evaluator', 'evaluator'];
const ROLE_DEFS = [
  ['toastmaster', 'Toastmaster'], ['grammarian', 'Grammarian'], ['ah_counter', 'Ah Counter'], ['timer', 'Timer'],
  ['topicsmaster', 'Topicsmaster'], ['speaker', 'Speaker 1'], ['speaker', 'Speaker 2'], ['speaker', 'Speaker 3'],
  ['general_evaluator', 'General Evaluator'], ['evaluator', 'Speech Evaluator 1'], ['evaluator', 'Speech Evaluator 2'], ['evaluator', 'Speech Evaluator 3'],
];
const DATE = (c) => `to_char(${c},'YYYY-MM-DD')`;

/* ───────── auth: a token belongs to a person (member / VPE) or to one role at one meeting ───────── */
app.use(wrap(async (req, _res, next) => {
  const t = req.header('x-token');
  if (!t) return next();
  const [p] = await q('select * from people where token=$1 and status<>$2', [t, 'inactive']);
  if (p) { req.person = p; return next(); }
  const [r] = await q(`select r.*, m.club_id, m.number as meeting_number, ${DATE('m.date')} as meeting_date
    from meeting_roles r join meetings m on m.id=r.meeting_id where r.token=$1`, [t]);
  if (r) {
    const [pp] = r.person_id ? await q('select * from people where id=$1', [r.person_id]) : [];
    if (pp && pp.status === 'inactive') return next();
    req.role = r; req.rolePerson = pp;
  }
  next();
}));
const needPerson = (req, res, next) => (req.person ? next() : bad(res, 'Sign in required', 401));
const needVpe = (req, res, next) => (req.person?.is_vpe ? next() : bad(res, 'VPE only', 403));
const needRole = (req, res, next) => (req.role ? next() : bad(res, 'This link is not valid', 401));
const clubOf = (req) => req.person?.club_id ?? req.role?.club_id;
const pub = (p) => p && { id: p.id, name: p.name, kind: p.kind, status: p.status, email: p.email, is_vpe: p.is_vpe };

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/session', wrap(async (req, res) => {
  if (req.person) { const [c] = await q('select name from clubs where id=$1', [req.person.club_id]); return res.json({ type: req.person.is_vpe ? 'vpe' : 'member', person: pub(req.person), club: c?.name }); }
  if (req.role) return res.json({ type: 'role', role: { key: req.role.role_key, label: req.role.label }, person: pub(req.rolePerson) });
  res.status(401).json({ error: 'No valid link' });
}));

/* ───────── accounts: email and password, a club code to join, and a wizard to start a club ───────── */
const tries = new Map();   // slows down password guessing: 10 tries per email per 15 minutes
const tooMany = (key) => { const now = Date.now(), hits = (tries.get(key) || []).filter((t) => now - t < 900000); hits.push(now); tries.set(key, hits); return hits.length > 10; };
const sessionFor = (p) => ({ token: p.token, type: p.is_vpe ? 'vpe' : 'member' });

app.get('/api/clubs/lookup', wrap(async (req, res) => {
  const [c] = await q('select name from clubs where join_code=$1', [String(req.query.code || '').trim().toUpperCase()]);
  c ? res.json({ name: c.name }) : bad(res, 'We could not find a club with that code', 404);
}));

app.post('/api/auth/signin', wrap(async (req, res) => {
  const email = normEmail(req.body.email), pw = String(req.body.password || '');
  if (!email || !pw) return bad(res, 'Enter your email and password');
  if (tooMany(email)) return bad(res, 'Too many tries. Wait a few minutes and try again.', 429);
  const rows = await q(`select p.*, c.name as club_name from people p join clubs c on c.id=p.club_id where lower(p.email)=$1 and p.password_hash is not null and p.status<>'inactive'`, [email]);
  const ok = rows.filter((r) => checkPw(pw, r.password_hash));
  if (!ok.length) return bad(res, 'That email and password do not match', 401);
  if (ok.length === 1) return res.json(sessionFor(ok[0]));
  res.json({ choose: ok.map((r) => ({ club: r.club_name, ...sessionFor(r) })) });
}));

app.post('/api/auth/join', wrap(async (req, res) => {
  const [club] = await q('select id, name from clubs where join_code=$1', [String(req.body.code || '').trim().toUpperCase()]);
  if (!club) return bad(res, 'We could not find a club with that code', 404);
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' '), email = normEmail(req.body.email);
  if (name.length < 2 || name.length > 80) return bad(res, 'Enter your name');
  if (!validEmail(email)) return bad(res, 'Enter a valid email address');
  const bp = pwProblem(req.body.password); if (bp) return bad(res, bp);
  const [dup] = await q('select 1 as x from people where club_id=$1 and lower(email)=$2', [club.id, email]);
  if (dup) return bad(res, 'That email already has an account in this club. Sign in, or ask your VPE for your link.', 409);
  const [p] = await q(`insert into people(club_id,name,email,kind,status,token,created_via,credential,password_hash) values ($1,$2,$3,'member','active',$4,'join','',$5) returning *`, [club.id, name, email, token(), hashPw(req.body.password)]);
  res.json(sessionFor(p));
}));

/* the wizard: a new club, its VPE, and its first year of meetings */
app.post('/api/clubs', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' '), email = normEmail(req.body.email);
  const clubName = String(req.body.club?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 2 || name.length > 80) return bad(res, 'Enter your name');
  if (!validEmail(email)) return bad(res, 'Enter a valid email address');
  const bp = pwProblem(req.body.password); if (bp) return bad(res, bp);
  if (clubName.length < 2) return bad(res, 'Enter your club name');
  const pc = cleanPattern(req.body.club?.pattern); if (pc.error) return bad(res, pc.error);
  const number = Math.max(1, Math.min(9999, parseInt(req.body.club?.firstNumber, 10) || 1));
  const out = await tx(async (t) => {
    let code; for (let i = 0; i < 8; i++) { code = joinCode(); if (!(await t('select 1 as x from clubs where join_code=$1', [code])).length) break; }
    const [club] = await t('insert into clubs(name,pattern,join_code) values ($1,$2,$3) returning id, name, pattern, join_code', [clubName, JSON.stringify(pc.pattern), code]);
    const [vpe] = await t(`insert into people(club_id,name,email,kind,status,is_vpe,token,created_via,credential,password_hash) values ($1,$2,$3,'member','active',true,$4,'wizard','TM',$5) returning *`, [club.id, name, email, token(), hashPw(req.body.password)]);
    const made = await generateMeetings(t, club, { months: 12, firstNumber: number });
    return { ...sessionFor(vpe), join_code: club.join_code, meetings: made };
  });
  res.json(out);
}));

/* the signed-in person's account, and their club's details */
app.get('/api/account', needPerson, wrap(async (req, res) => {
  const [c] = await q('select name, join_code, pattern from clubs where id=$1', [req.person.club_id]);
  res.json({ name: req.person.name, email: req.person.email || '', has_password: !!req.person.password_hash, club: { name: c.name, join_code: req.person.is_vpe ? c.join_code : undefined, pattern: c.pattern, pattern_text: describePattern(c.pattern) } });
}));
app.put('/api/account', needPerson, wrap(async (req, res) => {
  const email = normEmail(req.body.email), pw = req.body.password;
  if (!validEmail(email)) return bad(res, 'Enter a valid email address');
  if (req.person.password_hash && pw && !checkPw(String(req.body.current || ''), req.person.password_hash)) return bad(res, 'Your current password is not right', 403);
  const [dup] = await q('select 1 as x from people where club_id=$1 and lower(email)=$2 and id<>$3', [req.person.club_id, email, req.person.id]);
  if (dup) return bad(res, 'Someone in your club already uses that email', 409);
  if (pw || !req.person.password_hash) { const bp = pwProblem(pw); if (bp) return bad(res, bp); }
  await q('update people set email=$1, password_hash=coalesce($2, password_hash) where id=$3', [email, pw ? hashPw(pw) : null, req.person.id]);
  res.json({ ok: true });
}));
app.put('/api/vpe/club', needPerson, needVpe, wrap(async (req, res) => {
  const pc = cleanPattern(req.body.pattern); if (pc.error) return bad(res, pc.error);
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  await q("update clubs set pattern=$1, name=coalesce(nullif($2, ''), name) where id=$3", [JSON.stringify(pc.pattern), name, req.person.club_id]);
  res.json({ ok: true });
}));
app.post('/api/vpe/club/meetings', needPerson, needVpe, wrap(async (req, res) => {
  const made = await tx(async (t) => {
    const [club] = await t('select id, pattern from clubs where id=$1', [req.person.club_id]);
    if (!club.pattern) return -1;
    return generateMeetings(t, club, { months: 12, firstNumber: Math.max(1, parseInt(req.body.firstNumber, 10) || 1) });
  });
  made < 0 ? bad(res, 'Set your meeting pattern first') : res.json({ made });
}));

/* demo picker: lists who you can sign in as. Off when DEMO_MODE=false. */
app.get('/api/dev/accounts', wrap(async (_req, res) => {
  if (!DEMO) return bad(res, 'Not available', 404);
  const people = await q(`select id,name,kind,status,is_vpe,token from people where kind='member' and status<>'inactive' order by is_vpe desc, name`);
  const [next] = await nextMeeting(1);
  const roles = next ? await q(`select r.label, r.role_key, r.token, p.name as person, p.kind from meeting_roles r join people p on p.id=r.person_id where r.meeting_id=$1 and r.role_key = any($2) order by r.position`, [next.id, FEEDBACK_KEYS]) : [];
  res.json({ people, meeting: next && { number: next.number, date: next.date }, roles });
}));

/* ───────── helpers ───────── */
async function nextMeeting(clubId) {
  // the next meeting is the first one dated today or later; if every meeting is in the past there is none
  return q(`select m.id, m.number, ${DATE('m.date')} as date from meetings m where m.club_id=$1 and m.date >= current_date order by m.date limit 1`, [clubId]);
}
async function guestFor(clubId, name, email, via, meetingDate) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80) return null;
  const [ex] = await q('select * from people where club_id=$1 and lower(name)=lower($2)', [clubId, clean]);
  if (ex) {
    if (ex.status === 'inactive') await q(`update people set status=$2 where id=$1`, [ex.id, ex.kind === 'guest' ? 'temporary' : 'active']);
    return { ...pub(ex), existing: true };
  }
  const until = new Date((meetingDate ? meetingDate + 'T12:00:00' : Date.now())); until.setDate(until.getDate() + 30);
  const [g] = await q(`insert into people(club_id,name,email,kind,status,token,created_via,temp_until) values ($1,$2,$3,'guest','temporary',$4,$5,$6) returning *`,
    [clubId, clean, email || null, token(), via, until.toISOString().slice(0, 10)]);
  return pub(g);
}

app.post('/api/people/guest', wrap(async (req, res) => {
  if (!req.person?.is_vpe && !req.role) return bad(res, 'Not allowed', 403);
  const g = await guestFor(clubOf(req), req.body.name, req.body.email, req.role ? 'role_sheet' : 'vpe', req.role?.meeting_date);
  if (!g) return bad(res, 'Enter a name');
  res.json(g);
}));

/* ───────── role player (link only) ───────── */
app.get('/api/role', needRole, wrap(async (req, res) => {
  const r = req.role;
  const [meeting] = await q(`select id, number, ${DATE('date')} as date, theme, word, pos, pron, meaning, example, synonyms, origin from meetings where id=$1`, [r.meeting_id]);
  const people = await q(`select id,name,kind,status from people where club_id=$1 and status<>'inactive' order by name`, [r.club_id]);
  const roles = await q(`select id, role_key, label, position, person_id, project_id, path_name, path_level, speech_title, target_role_id from meeting_roles where meeting_id=$1 order by position`, [r.meeting_id]);
  const projects = await q('select * from projects order by level, id');
  res.json({
    role: { id: r.id, key: r.role_key, label: r.label, submitted_at: r.submitted_at, target_role_id: r.target_role_id },
    me: pub(req.rolePerson), meeting, people, roles, projects, sheet: r.sheet || {}, evalResources: r.role_key === 'evaluator' ? EVAL_RESOURCES : undefined,
  });
}));

app.put('/api/role/sheet', needRole, wrap(async (req, res) => {
  await saveSheet(req.role, req.body || {});
  res.json({ ok: true, saved_at: new Date().toISOString() });
}));
app.post('/api/role/submit', needRole, wrap(async (req, res) => {
  if (req.body && Object.keys(req.body).length) await saveSheet(req.role, req.body);
  await q('update meeting_roles set submitted_at=now() where id=$1', [req.role.id]);
  res.json({ ok: true });
}));

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : Math.round(+v));
async function saveSheet(role, sheet) {
  const rid = role.id, mid = role.meeting_id, club = role.club_id;
  await tx(async (t) => {
    await t('update meeting_roles set sheet=$1 where id=$2', [JSON.stringify(sheet), rid]);
    const ok = async (id) => id && (await t('select 1 from people where id=$1 and club_id=$2', [id, club])).length;
    if (role.role_key === 'grammarian') {
      await t('delete from gram_notes where role_id=$1', [rid]);
      for (const r of sheet.rows || []) {
        if (!(await ok(r.subject_id))) continue;
        if (!r.used && !r.liked && !r.improper && !r.suggestion) continue;
        await t('insert into gram_notes(role_id,meeting_id,subject_id,used_word,liked,improper,suggestion) values ($1,$2,$3,$4,$5,$6,$7)',
          [rid, mid, r.subject_id, !!r.used, r.liked || '', r.improper || '', r.suggestion || '']);
      }
    } else if (role.role_key === 'ah_counter') {
      await t('delete from filler_counts where role_id=$1', [rid]);
      for (const r of sheet.rows || []) {
        if (!(await ok(r.subject_id))) continue;
        const counts = Object.fromEntries(Object.entries(r.counts || {}).filter(([, v]) => +v > 0).map(([k, v]) => [k, +v]));
        if (!Object.keys(counts).length && !r.comment) continue;
        await t('insert into filler_counts(role_id,meeting_id,subject_id,counts,comment) values ($1,$2,$3,$4,$5)', [rid, mid, r.subject_id, JSON.stringify(counts), r.comment || '']);
      }
    } else if (role.role_key === 'timer') {
      await t('delete from timings where role_id=$1', [rid]);
      for (const r of sheet.rows || []) {
        if (!(await ok(r.subject_id))) continue;
        const sec = num(r.seconds);
        if (sec === null && !r.comment) continue;
        let g = [60, 90, 120], pid = null;
        if (r.kind === 'Speaker') {
          const [pr] = r.project_id ? await t('select id,green,yellow,red from projects where id=$1', [r.project_id]) : [];
          g = pr ? [pr.green, pr.yellow, pr.red] : [300, 360, 420]; pid = pr?.id ?? null;
        } else if (r.kind === 'Evaluator') g = [120, 150, 180];
        else if (r.kind === 'Other') { const mn = num(r.min_s) || 60, mx = num(r.max_s) || 120; g = [mn, Math.round((mn + mx) / 2), mx]; }
        await t('insert into timings(role_id,meeting_id,subject_id,kind,label,seconds,green,yellow,red,project_id,comment) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [rid, mid, r.subject_id, r.kind || 'Other', r.label || '', sec, g[0], g[1], g[2], pid, r.comment || '']);
      }
    } else if (role.role_key === 'general_evaluator') {
      await t('delete from role_feedback where author_role_id=$1', [rid]);
      for (const c of sheet.comments || []) {
        if (!(c.well || c.improve)) continue;
        const [tr] = await t('select id from meeting_roles where id=$1 and meeting_id=$2 and person_id is not null', [c.role_id, mid]);
        if (tr) await t('insert into role_feedback(meeting_id,author_role_id,target_role_id,well,improve) values ($1,$2,$3,$4,$5)', [mid, rid, tr.id, String(c.well || '').slice(0, 2000), String(c.improve || '').slice(0, 2000)]);
      }
    } else if (role.role_key === 'evaluator') {
      await t('delete from evaluations where role_id=$1', [rid]);
      const [tr] = role.target_role_id ? await t('select person_id, project_id, speech_title, path_name, path_level from meeting_roles where id=$1', [role.target_role_id]) : [];
      const ratings = (sheet.ratings || []).map((v) => Math.max(0, Math.min(5, +v || 0)));
      const any = ratings.some(Boolean) || sheet.excelled || sheet.work || sheet.challenge;
      if (tr?.person_id && tr.project_id && any) {
        await t('insert into evaluations(role_id,meeting_id,speaker_id,project_id,title,ratings,comments,excelled,work,challenge,seconds,path_name,path_level) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [rid, mid, tr.person_id, tr.project_id, tr.speech_title || '', JSON.stringify(ratings), JSON.stringify(sheet.comments || []), sheet.excelled || '', sheet.work || '', sheet.challenge || '', num(sheet.seconds), tr.path_name || null, tr.path_level ?? null]);
      }
    }
  });
}

/* ───────── member ───────── */
async function myMeetings(me, hist) {
  const rows = await q(`select m.id, m.number, ${DATE('m.date')} as date, m.theme,
      coalesce((select json_agg(r.label order by r.position) from meeting_roles r where r.meeting_id=m.id and r.person_id=$2), '[]'::json) as roles,
      (select count(*)::int from peer_feedback p where p.meeting_id=m.id and p.to_person_id=$2 and not p.hidden) as room
    from meetings m where m.club_id=$1 and m.date < current_date order by m.date desc`, [me.club_id, me.id]);
  const roleFb = hist.rolefb.filter((r) => r.pid === me.id);
  return rows.map((m) => {
    const has = (a) => a.some((r) => r.pid === me.id && r.number === m.number);
    const items = [has(hist.evals) && 'speech', has(hist.gram) && 'grammar', has(hist.fill) && 'fillers', has(hist.time) && 'timing', m.room && 'room', roleFb.some((r) => r.number === m.number) && 'role'].filter(Boolean);
    return { ...m, roles: m.roles || [], items };
  }).filter((m) => m.items.length || m.roles.length);
}

app.get('/api/me/overview', needPerson, wrap(async (req, res) => {
  const me = req.person, hist = await loadHist(me.club_id);
  const prog = progressFor(me.id, hist);
  const meetings = await myMeetings(me, hist);
  const up = await q(`select r.label, r.role_key, r.token, r.submitted_at, m.number, ${DATE('m.date')} as date
    from meeting_roles r join meetings m on m.id=r.meeting_id where r.person_id=$1 and m.date >= current_date order by m.date, r.position limit 3`, [me.id]);
  let focus = null;
  if (prog.focus.length) {
    const k = prog.focus[0]; let c = null;
    for (const e of prog.evals) if (e.comments?.[k] && e.ratings[k] && e.ratings[k] <= 3) { c = e.comments[k]; break; }
    focus = { name: prog.criteria[k], avg: prog.avgs[k], comment: c, work: prog.evals[0]?.work || '', by: prog.evals[0]?.by };
  }
  res.json({ person: pub(me), ...summary(me.id, hist), focus, latest: meetings[0] || null, upcoming: up, meetings: meetings.length, given: (await givenFor(me.id)).length });
}));
app.get('/api/me/given', needPerson, wrap(async (req, res) => res.json(await givenFor(req.person.id))));
app.get('/api/me/given/:id', needPerson, wrap(async (req, res, next) => {
  const [r] = await q('select 1 as ok from meeting_roles where id=$1 and person_id=$2 and submitted_at is not null', [req.params.id, req.person.id]);
  if (!r) return bad(res, 'Not found', 404);
  next();
}), (req, res, next) => submissionHandler(req, res, next));
app.get('/api/me/meetings', needPerson, wrap(async (req, res) => res.json(await myMeetings(req.person, await loadHist(req.person.club_id)))));
app.get('/api/me/meetings/:number', needPerson, wrap(async (req, res) => {
  const me = req.person, n = +req.params.number;
  const [m] = await q(`select id, number, ${DATE('date')} as date, theme, word from meetings where club_id=$1 and number=$2`, [me.club_id, n]);
  if (!m) return bad(res, 'Not found', 404);
  const hist = await loadHist(me.club_id);
  const mine = (rows) => rows.filter((r) => r.pid === me.id && r.number === n);
  const roles = await q('select id, label, role_key from meeting_roles where meeting_id=$1 and person_id=$2 order by position', [m.id, me.id]);
  const roleFb = await q(`select rf.well, rf.improve, tr.label as role, ap.name as by from role_feedback rf join meeting_roles tr on tr.id=rf.target_role_id
    join meeting_roles ar on ar.id=rf.author_role_id left join people ap on ap.id=ar.person_id where rf.meeting_id=$1 and tr.person_id=$2`, [m.id, me.id]);
  const peer = await q('select from_name, well, improve from peer_feedback where meeting_id=$1 and to_person_id=$2 and not hidden order by id', [m.id, me.id]);
  res.json({ meeting: m, roles, roleFeedback: roleFb, peer, speech: mine(hist.evals)[0] || null, gram: mine(hist.gram), ah: mine(hist.fill), time: mine(hist.time) });
}));
app.get('/api/me/room', needPerson, wrap(async (req, res) => {
  const hist = await loadHist(req.person.club_id);
  res.json(hist.peer.filter((r) => r.pid === req.person.id).sort((a, b) => b.date.localeCompare(a.date)));
}));

app.get('/api/me/history/:key', needPerson, wrap(async (req, res) => {
  const k = { gram: 'gram', ah: 'fill', time: 'time' }[req.params.key];
  if (!k) return bad(res, 'Unknown history', 404);
  const hist = await loadHist(req.person.club_id);
  res.json(hist[k].filter((r) => r.pid === req.person.id).sort((a, b) => b.date.localeCompare(a.date)));
}));
app.get('/api/me/evaluations', needPerson, wrap(async (req, res) => {
  const hist = await loadHist(req.person.club_id);
  res.json(hist.evals.filter((r) => r.pid === req.person.id).sort((a, b) => b.date.localeCompare(a.date)));
}));
app.get('/api/me/evaluations/:id', needPerson, wrap(async (req, res) => evalDetail(req, res, req.person.id)));
app.get('/api/vpe/evaluations/:id', needPerson, needVpe, wrap(async (req, res) => evalDetail(req, res, null)));
async function evalDetail(req, res, onlyMe) {
  const [e] = await q(`select e.*, ${DATE('m.date')} as date, m.number, m.club_id, p.name as project, coalesce(e.path_level, p.level) as level, coalesce(e.path_name, p.path) as path, p.form_title, p.length_text, p.purpose, p.notes, p.about, p.green, p.yellow, p.red,
      sp.name as member, ev.name as by
    from evaluations e join meetings m on m.id=e.meeting_id join projects p on p.id=e.project_id join people sp on sp.id=e.speaker_id
    join meeting_roles r on r.id=e.role_id left join people ev on ev.id=r.person_id where e.id=$1`, [req.params.id]);
  if (!e || e.club_id !== req.person.club_id || (onlyMe && e.speaker_id !== onlyMe)) return bad(res, 'Not found', 404);
  res.json(e);
}

/* ───────── VPE ───────── */
app.get('/api/evaluation-resources', needPerson, (_req, res) => res.json(EVAL_RESOURCES));
app.get('/api/projects', needPerson, wrap(async (_req, res) => res.json(await q('select * from projects order by level, id'))));

app.get('/api/pathways', needPerson, wrap(async (_req, res) => {
  const rows = await q(`select pp.path, pp.level, pp.level_title, pp.kind, pp.pos, pp.choose, p.id, p.name, p.length_text
    from path_projects pp join projects p on p.id=pp.project_id order by pp.path, pp.level, pp.pos`);
  const paths = [];
  for (const r of rows) {
    let p = paths.find((x) => x.name === r.path); if (!p) paths.push(p = { name: r.path, levels: [] });
    let lv = p.levels.find((x) => x.level === r.level); if (!lv) p.levels.push(lv = { level: r.level, title: r.level_title, choose: r.choose, projects: [] });
    lv.projects.push({ id: r.id, name: r.name, kind: r.kind, pos: r.pos, code: r.kind === 'required' ? `L${r.level}P${r.pos}` : '', length: r.length_text });
  }
  res.json({ paths });
}));

app.get('/api/vpe/meetings', needPerson, needVpe, wrap(async (req, res) => {
  const rows = await q(`select m.id, m.number, ${DATE('m.date')} as date, m.theme, m.word, m.pos, m.meaning,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id and r.person_id is not null) as roles_filled,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id) as roles_total,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id and r.person_id is not null and r.role_key = any($2)) as fb_total,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id and r.submitted_at is not null) as fb_in
    from meetings m where m.club_id=$1 order by m.number desc`, [req.person.club_id, FEEDBACK_KEYS]);
  const [next] = await nextMeeting(req.person.club_id);
  res.json(rows.map((m) => ({ ...m, status: !next || m.number < next.number ? 'Done' : m.number === next.number ? 'Next' : 'Planned' })));
}));

app.post('/api/vpe/meetings', needPerson, needVpe, wrap(async (req, res) => {
  const out = await tx(async (t) => {
    const [last] = await t(`select number, ${DATE('date')} as date from meetings where club_id=$1 order by number desc limit 1`, [req.person.club_id]);
    const [club] = await t('select pattern from clubs where id=$1', [req.person.club_id]);
    const from = last ? last.date : new Date().toISOString().slice(0, 10);
    const date = (club?.pattern && nextPatternDate(club.pattern, from)) || nextClubDate(from);
    const [m] = await t('insert into meetings(club_id,number,date,feedback_code) values ($1,$2,$3,$4) returning id, number', [req.person.club_id, (last?.number || 0) + 1, date, token().slice(0, 10)]);
    for (let i = 0; i < ROLE_DEFS.length; i++) await t('insert into meeting_roles(meeting_id,role_key,label,position,token) values ($1,$2,$3,$4,$5)', [m.id, ROLE_DEFS[i][0], ROLE_DEFS[i][1], i, token()]);
    return m;
  });
  res.json(out);
}));

const MEETING_FIELDS = ['date', 'theme', 'theme_quote', 'theme_quote_by', 'word', 'pos', 'pron', 'meaning', 'example', 'synonyms', 'origin', 'attendance'];
app.patch('/api/vpe/meetings/:id', needPerson, needVpe, wrap(async (req, res) => {
  const sets = [], vals = [];
  for (const f of MEETING_FIELDS) if (f in req.body) { const v = req.body[f]; vals.push(f === 'attendance' ? (v === '' || v == null || Number.isNaN(parseInt(v, 10)) ? null : Math.max(0, parseInt(v, 10))) : (v ?? '')); sets.push(`${f}=$${vals.length}`); }
  if (!sets.length) return bad(res, 'Nothing to update');
  vals.push(req.params.id, req.person.club_id);
  const r = await q(`update meetings set ${sets.join(',')} where id=$${vals.length - 1} and club_id=$${vals.length} returning id`, vals);
  r.length ? res.json({ ok: true }) : bad(res, 'Not found', 404);
}));

app.get('/api/vpe/meetings/:id', needPerson, needVpe, wrap(async (req, res) => {
  const [m] = await q(`select id, number, ${DATE('date')} as date, theme, theme_quote, theme_quote_by, word, pos, pron, meaning, example, synonyms, origin from meetings where id=$1 and club_id=$2`, [req.params.id, req.person.club_id]);
  if (!m) return bad(res, 'Not found', 404);
  const roles = await q(`select r.id, r.role_key, r.label, r.position, r.person_id, r.project_id, r.path_name, r.path_level, r.speech_title, r.target_role_id, r.token, r.submitted_at,
      p.name as person, p.kind as person_kind, p.status as person_status
    from meeting_roles r left join people p on p.id=r.person_id where r.meeting_id=$1 order by r.position`, [m.id]);
  const [next] = await nextMeeting(req.person.club_id);
  const [fc] = await q('select feedback_code from meetings where id=$1', [m.id]);
  const peer = await q('select p.id, p.from_name, p.well, p.improve, p.hidden, t.name as to_name from peer_feedback p join people t on t.id=p.to_person_id where p.meeting_id=$1 order by p.id desc', [m.id]);
  const gefb = await q(`select rf.id, rf.well, rf.improve, tr.label as role, tp.name as to_name from role_feedback rf join meeting_roles tr on tr.id=rf.target_role_id left join people tp on tp.id=tr.person_id where rf.meeting_id=$1 order by tr.position`, [m.id]);
  res.json({ meeting: { ...m, feedback_code: fc.feedback_code, status: !next || m.number < next.number ? 'Done' : m.number === next.number ? 'Next' : 'Planned' }, roles, peer, roleFeedback: gefb });
}));
app.patch('/api/vpe/peer/:id', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q('update peer_feedback set hidden=$1 where id=$2 and meeting_id in (select id from meetings where club_id=$3) returning id', [!!req.body.hidden, req.params.id, req.person.club_id]);
  r.length ? res.json({ ok: true }) : bad(res, 'Not found', 404);
}));
/* ───────── roster: the whole quarter in one grid ───────── */
app.get('/api/vpe/roster', needPerson, wrap(async (req, res) => {
  if (!req.person.is_vpe) return bad(res, 'VPE only', 403);
  const club = req.person.club_id;
  const [next] = await nextMeeting(club);
  const [lim] = await q('select min(number)::int as lo, max(number)::int as hi from meetings where club_id=$1', [club]);
  const count = Math.min(8, Math.max(1, parseInt(req.query.count, 10) || 6));
  const lo = lim.lo ?? 1, hi = lim.hi ?? 1;
  let from = parseInt(req.query.from, 10);
  if (Number.isNaN(from)) from = next?.number ?? Math.max(lo, hi - count + 1);
  from = Math.min(Math.max(lo, from), Math.max(lo, hi - count + 1));
  const meetings = await q(`select m.id, m.number, ${DATE('m.date')} as date, m.theme, m.theme_quote, m.theme_quote_by, m.word, m.pos, m.pron, m.meaning, m.example, m.synonyms, m.origin, m.attendance
    from meetings m where m.club_id=$1 and m.number >= $2 and m.number < $3 order by m.number`, [club, from, from + count]);
  const roles = await q(`select r.id, r.meeting_id, r.role_key, r.label, r.position, r.person_id, r.project_id, r.path_name, r.path_level, r.speech_title, r.target_role_id, r.submitted_at, p.name as person, p.kind as person_kind
    from meeting_roles r join meetings m on m.id=r.meeting_id left join people p on p.id=r.person_id
    where m.club_id=$1 and m.number >= $2 and m.number < $3 order by r.position`, [club, from, from + count]);
  const index = await q(`select number, ${DATE('date')} as date, theme from meetings where club_id=$1 order by number`, [club]);
  res.json({
    from, count, lo, hi, next: next?.number ?? null, has_earlier: from > lo, has_later: from + count - 1 < hi,
    index: index.map((m) => ({ ...m, status: !next || m.number < next.number ? 'Done' : m.number === next.number ? 'Next' : 'Planned' })),
    meetings: meetings.map((m) => ({ ...m, status: !next || m.number < next.number ? 'Done' : m.number === next.number ? 'Next' : 'Planned', roles: roles.filter((r) => r.meeting_id === m.id) })),
  });
}));

// add a speaker or evaluator row to a meeting (the roster adds it to every meeting on screen)
app.post('/api/vpe/meetings/:id/roles', needPerson, needVpe, wrap(async (req, res) => {
  const key = req.body?.role_key;
  if (!['speaker', 'evaluator'].includes(key)) return bad(res, 'Only speaker and evaluator rows can be added');
  const [m] = await q('select id from meetings where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!m) return bad(res, 'Not found', 404);
  const out = await tx(async (t) => {
    const same = await t('select id, position from meeting_roles where meeting_id=$1 and role_key=$2 order by position', [m.id, key]);
    const n = same.length + 1, pos = (same.at(-1)?.position ?? 99) + 1;
    await t('update meeting_roles set position = position + 1 where meeting_id=$1 and position >= $2', [m.id, pos]);
    const label = key === 'speaker' ? `Speaker ${n}` : `Speech Evaluator ${n}`;
    let target = null;
    if (key === 'evaluator') target = (await t(`select id from meeting_roles where meeting_id=$1 and role_key='speaker' and label=$2`, [m.id, `Speaker ${n}`]))[0]?.id ?? null;
    const [r] = await t('insert into meeting_roles(meeting_id,role_key,label,position,target_role_id,token) values ($1,$2,$3,$4,$5,$6) returning id', [m.id, key, label, pos, target, token()]);
    if (key === 'speaker') await t(`update meeting_roles set target_role_id=$1 where meeting_id=$2 and role_key='evaluator' and label=$3 and target_role_id is null`, [r.id, m.id, `Speech Evaluator ${n}`]);
    return r;
  });
  res.json(out);
}));
app.delete('/api/vpe/roles/:id', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q(`delete from meeting_roles where id=$1 and role_key in ('speaker','evaluator') and person_id is null and submitted_at is null
    and meeting_id in (select id from meetings where club_id=$2) returning id`, [req.params.id, req.person.club_id]);
  r.length ? res.json({ ok: true }) : bad(res, 'Only an empty speaker or evaluator row can be removed', 400);
}));

/* ───────── agenda: edits the club's Word template ───────── */
const lanIp = () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('192.168.56.') && !n.address.startsWith('169.254.'));
  return (ips.find((n) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(n.address)) || ips[0])?.address || null;
};
/** The address people scan the QR code with: the club's public address if set, else the one the VPE is using (phones cannot reach "localhost"). */
function publicBase(req) {
  try { if (req.query.base) { const u = new URL(String(req.query.base)); if (/^https?:$/.test(u.protocol)) return u.origin; } } catch { /* fall through */ }
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.get('host') || 'localhost';
  const [name, port] = host.split(':');
  const ip = ['localhost', '127.0.0.1'].includes(name) ? lanIp() : null;
  return `${req.protocol}://${ip || name}${port ? ':' + port : ''}`;
}
async function agendaFor(req, res, startOverride) {
  const ctx = await loadContext(req.params.id, req.person.club_id);
  if (!ctx) { bad(res, 'Not found', 404); return null; }
  const def = defaultAgenda(ctx, startOverride ?? ctx.m.agenda?.start);
  return { ctx, def, merged: mergeAgenda(def, ctx.m.agenda || {}) };
}
app.get('/api/vpe/meetings/:id/agenda', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res); if (!a) return;
  const { m } = a.ctx;
  res.json({ meeting: { id: m.id, number: m.number, date: m.date, theme: m.theme, theme_quote: m.theme_quote, theme_quote_by: m.theme_quote_by, word: m.word }, agenda: a.merged, edited: Object.keys(m.agenda || {}).length > 0 });
}));
app.put('/api/vpe/meetings/:id/agenda', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res, req.body?.start); if (!a) return;
  const saved = diffAgenda(a.def, req.body || {});
  await q('update meetings set agenda=$1 where id=$2', [JSON.stringify(saved), req.params.id]);
  res.json({ ok: true });
}));
app.post('/api/vpe/meetings/:id/agenda/reset', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res); if (!a) return;
  let saved = {};
  if (req.body?.what === 'times') {
    saved = JSON.parse(JSON.stringify(a.ctx.m.agenda || {}));
    for (const k of ['opening', 'closing']) if (saved[k]) saved[k] = saved[k].map((x) => { const { time, ...r } = x || {}; return r; });
    if (saved.speeches) for (const id of Object.keys(saved.speeches)) delete saved.speeches[id].time;
  }
  await q('update meetings set agenda=$1 where id=$2', [JSON.stringify(saved), req.params.id]);
  const a2 = await agendaFor(req, res);
  res.json({ agenda: a2.merged });
}));
app.get('/api/vpe/meetings/:id/agenda.docx', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res); if (!a) return;
  const buf = await buildDocx(a.merged, a.ctx);
  const d = new Date(a.ctx.m.date + 'T12:00:00');
  const name = `Champions Toastmasters Agenda ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.docx`;
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${name}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' });
  res.send(buf);
}));

app.get('/api/vpe/meetings/:id/agenda.pdf', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res); if (!a) return;
  try {
    const pdf = await docxToPdf(await buildDocx(a.merged, a.ctx));
    const d = new Date(a.ctx.m.date + 'T12:00:00');
    const name = `Champions Toastmasters Agenda ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' });
    res.send(pdf);
  } catch (e) { console.error(e); bad(res, e.status === 501 ? e.message : 'Could not create the PDF. The Word download still works.', e.status || 500); }
}));
/* ───────── word of the day: fill in the details ───────── */
app.post('/api/vpe/word-details', needPerson, needVpe, wrap(async (req, res) => {
  const { word, theme, quote } = req.body || {};
  if (!validWord(word)) return bad(res, 'Type a single word first');
  try { res.json(await wordDetails({ word, theme: String(theme || '').slice(0, 120), quote: String(quote || '').slice(0, 300) })); }
  catch (e) { bad(res, [404, 502].includes(e.status) ? e.message : 'Could not look that word up just now. Try again, or type the details in.', e.status || 502); }
}));

/* ───────── what a role player submitted, for the VPE to read through ───────── */
const submissionHandler = wrap(async (req, res) => {
  const [r] = await q(`select r.id, r.role_key, r.label, r.sheet, r.submitted_at, r.meeting_id, m.club_id, m.number, ${DATE('m.date')} as date, p.name as person
    from meeting_roles r join meetings m on m.id=r.meeting_id left join people p on p.id=r.person_id where r.id=$1 and m.club_id=$2`, [req.params.id, req.person.club_id]);
  if (!r) return bad(res, 'Not found', 404);
  const people = await q('select id, name from people where club_id=$1', [r.club_id]);
  const nm = (id) => people.find((x) => x.id === id)?.name || 'Someone';
  const sheet = r.sheet || {};
  const out = { role: { id: r.id, key: r.role_key, label: r.label, person: r.person, submitted_at: r.submitted_at, meeting: r.number, date: r.date } };
  if (r.role_key === 'grammarian') out.rows = (await q('select s.name, g.used_word as used, g.liked, g.improper, g.suggestion from gram_notes g join people s on s.id=g.subject_id where g.role_id=$1 order by g.id', [r.id]));
  else if (r.role_key === 'ah_counter') out.rows = (await q('select s.name, f.counts, f.comment from filler_counts f join people s on s.id=f.subject_id where f.role_id=$1 order by f.id', [r.id]));
  else if (r.role_key === 'timer') out.rows = (await q(`select s.name, t.label, t.kind, t.seconds, t.green, t.yellow, t.red, t.comment from timings t join people s on s.id=t.subject_id where t.role_id=$1 order by t.id`, [r.id]));
  else if (r.role_key === 'topicsmaster') { out.topics = (Array.isArray(sheet.topics) ? sheet.topics : String(sheet.topics || '').split('\n')).map((x) => String(x).trim()).filter(Boolean); out.rows = (sheet.rows || []).filter((x) => x.subject_id).map((x) => ({ name: nm(x.subject_id), topic: x.topic || '' })); }
  else if (r.role_key === 'evaluator') {
    const [e] = await q(`select e.*, s.name as speaker, pr.name as project, coalesce(e.path_level, pr.level) as level, coalesce(e.path_name, pr.path) as path from evaluations e join people s on s.id=e.speaker_id join projects pr on pr.id=e.project_id where e.role_id=$1`, [r.id]);
    out.evaluation = e || null;
  } else if (r.role_key === 'general_evaluator') {
    out.sections = sheet.sections || [];
    out.comments = await q(`select rf.well, rf.improve, tr.label as role, tp.name as person from role_feedback rf join meeting_roles tr on tr.id=rf.target_role_id left join people tp on tp.id=tr.person_id where rf.author_role_id=$1 order by tr.position`, [r.id]);
  }
  res.json(out);
});
app.get('/api/vpe/roles/:id/submission', needPerson, needVpe, submissionHandler);

app.get('/api/vpe/network', needPerson, needVpe, (_req, res) => {
  // the address phones on the same Wi-Fi can use, so the QR code works when the VPE opened the app on localhost
  const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('192.168.56.') && !n.address.startsWith('169.254.'));
  res.json({ ip: (ips.find((n) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(n.address)) || ips[0])?.address || null });
});

app.patch('/api/vpe/roles/:id', needPerson, needVpe, wrap(async (req, res) => {
  const [r] = await q('select r.* from meeting_roles r join meetings m on m.id=r.meeting_id where r.id=$1 and m.club_id=$2', [req.params.id, req.person.club_id]);
  if (!r) return bad(res, 'Not found', 404);
  const b = req.body, next = { ...r };
  if ('person_id' in b) {
    if (b.person_id) { const [p] = await q(`select id from people where id=$1 and club_id=$2 and status<>'inactive'`, [b.person_id, req.person.club_id]); if (!p) return bad(res, 'Unknown person'); }
    next.person_id = b.person_id || null;
  }
  if ('project_id' in b) next.project_id = b.project_id || null;
  if ('path_name' in b) next.path_name = b.path_name || null;
  if ('path_level' in b) next.path_level = b.path_level ?? null;
  if ('project_id' in b && !b.project_id) { next.path_name = 'path_name' in b ? next.path_name : r.path_name; }
  if ('speech_title' in b) next.speech_title = String(b.speech_title || '');
  if ('target_role_id' in b) next.target_role_id = b.target_role_id || null;
  // a new person gets a fresh link, so the previous person's link stops working
  const tk = next.person_id !== r.person_id ? token() : r.token;
  await q('update meeting_roles set person_id=$1, project_id=$2, speech_title=$3, target_role_id=$4, token=$5, path_name=$6, path_level=$7 where id=$8',
    [next.person_id, next.project_id, next.speech_title, next.target_role_id, tk, next.path_name ?? null, next.path_level ?? null, r.id]);
  res.json({ ok: true, token: tk });
}));
app.post('/api/vpe/roles/:id/regenerate', needPerson, needVpe, wrap(async (req, res) => {
  const tk = token();
  const r = await q('update meeting_roles set token=$1 where id=$2 and meeting_id in (select id from meetings where club_id=$3) returning id', [tk, req.params.id, req.person.club_id]);
  r.length ? res.json({ token: tk }) : bad(res, 'Not found', 404);
}));

app.get('/api/vpe/people', needPerson, needVpe, wrap(async (req, res) => {
  const club = req.person.club_id;
  const people = await q(`select id,name,email,credential,kind,status,is_vpe,token,created_via,${DATE('temp_until')} as temp_until, ${DATE('created_at')} as added from people where club_id=$1 order by name`, [club]);
  // plain counts that can be checked by hand
  const counts = async (sql) => Object.fromEntries((await q(sql, [club])).map((r) => [r.pid, r.n]));
  const speeches = await counts(`select e.speaker_id as pid, count(*)::int as n from evaluations e join meetings m on m.id=e.meeting_id where m.club_id=$1 group by e.speaker_id`);
  const assigned = await counts(`select r.person_id as pid, count(*)::int as n from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=$1 and r.person_id is not null group by r.person_id`);
  const done = await counts(`select r.person_id as pid, count(*)::int as n from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=$1 and r.person_id is not null and m.date < current_date group by r.person_id`);
  const given = await counts(`select r.person_id as pid, count(*)::int as n from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=$1 and r.person_id is not null and r.submitted_at is not null group by r.person_id`);
  res.json(people.map((p) => ({ ...p, roles_played: assigned[p.id] || 0, speeches: speeches[p.id] || 0, roles_done: done[p.id] || 0, feedback_given: given[p.id] || 0 })));
}));
app.post('/api/vpe/people', needPerson, needVpe, wrap(async (req, res) => {
  const { name, email, kind } = req.body, cred = String(req.body.credential || '').trim().slice(0, 20);
  if (kind === 'guest') { const g = await guestFor(req.person.club_id, name, email, 'vpe'); if (!g) return bad(res, 'Enter a name'); if (cred) await q('update people set credential=$1 where id=$2', [cred, g.id]); return res.json(g); }
  const clean = String(name || '').trim();
  if (clean.length < 2) return bad(res, 'Enter a name');
  const [p] = await q(`insert into people(club_id,name,email,kind,status,token,created_via,credential) values ($1,$2,$3,'member','active',$4,'vpe',$5) returning *`, [req.person.club_id, clean, email || null, token(), cred]);
  res.json(pub(p));
}));
app.patch('/api/vpe/people/:id', needPerson, needVpe, wrap(async (req, res) => {
  const [p] = await q('select * from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!p) return bad(res, 'Not found', 404);
  const b = req.body;
  let { name, email, kind, status, credential } = p;
  if ('credential' in b) credential = String(b.credential || '').trim().slice(0, 20);
  if (typeof b.name === 'string' && b.name.trim().length > 1) name = b.name.trim();
  if ('email' in b) email = b.email || null;
  if (b.convert) { kind = 'member'; status = 'active'; }
  else if (['active', 'temporary', 'inactive'].includes(b.status)) status = b.status === 'active' && kind === 'guest' ? 'temporary' : b.status;
  await q(`update people set name=$1,email=$2,kind=$3,status=$4,credential=$7,converted_at = case when $5 then now() else converted_at end, temp_until = case when $5 then null else temp_until end where id=$6`, [name, email, kind, status, !!b.convert, p.id, credential]);
  res.json({ ok: true });
}));
app.post('/api/vpe/people/:id/extend', needPerson, needVpe, wrap(async (req, res) => {
  await q(`update people set temp_until = coalesce(temp_until, current_date) + 30, status='temporary' where id=$1 and club_id=$2 and kind='guest'`, [req.params.id, req.person.club_id]);
  res.json({ ok: true });
}));
/** The role sheets a person has submitted, newest first, with a one-line description of each. */
async function givenFor(pid) {
  const roles = await q(`select r.id, r.label, r.role_key, r.submitted_at, m.number, ${DATE('m.date')} as date
    from meeting_roles r join meetings m on m.id=r.meeting_id where r.person_id=$1 and r.submitted_at is not null order by m.date desc, r.position`, [pid]);
  const p = { id: pid };
  const n = async (sql) => Object.fromEntries((await q(sql, [p.id])).map((r) => [r.rid, r.n]));
  const gram = await n('select g.role_id as rid, count(*)::int as n from gram_notes g join meeting_roles r on r.id=g.role_id where r.person_id=$1 group by g.role_id');
  const fill = await n('select f.role_id as rid, count(*)::int as n from filler_counts f join meeting_roles r on r.id=f.role_id where r.person_id=$1 group by f.role_id');
  const time = await n('select t.role_id as rid, count(*)::int as n from timings t join meeting_roles r on r.id=t.role_id where r.person_id=$1 group by t.role_id');
  const gec = await n('select f.author_role_id as rid, count(*)::int as n from role_feedback f join meeting_roles r on r.id=f.author_role_id where r.person_id=$1 group by f.author_role_id');
  const ev = Object.fromEntries((await q('select e.role_id as rid, s.name as speaker, pr.name as project from evaluations e join people s on s.id=e.speaker_id join projects pr on pr.id=e.project_id join meeting_roles r on r.id=e.role_id where r.person_id=$1', [p.id])).map((r) => [r.rid, r]));
  const pl = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const summary = (r) => ({
    grammarian: gram[r.id] ? pl(gram[r.id], 'person noted', 'people noted') : 'Notes on the word of the day',
    ah_counter: fill[r.id] ? `Filler words counted for ${pl(fill[r.id], 'person', 'people')}` : 'Filler word counts',
    timer: time[r.id] ? pl(time[r.id], 'time recorded', 'times recorded') : 'Timings',
    topicsmaster: 'Topics and who spoke on them',
    evaluator: ev[r.id] ? `Evaluated ${ev[r.id].speaker}: ${ev[r.id].project}` : 'Speech evaluation',
    general_evaluator: gec[r.id] ? `Commented on ${pl(gec[r.id], 'role player', 'role players')}` : 'Meeting checklist',
  }[r.role_key] || '');
  return roles.filter((r) => ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'evaluator', 'general_evaluator'].includes(r.role_key))
    .map((r) => ({ id: r.id, label: r.label, number: r.number, date: r.date, submitted_at: r.submitted_at, summary: summary(r) }));
}

/* one member: what they have delivered, the roles they have done, the feedback they have given and received */
app.get('/api/vpe/people/:id/profile', needPerson, needVpe, wrap(async (req, res) => {
  const club = req.person.club_id;
  const [p] = await q(`select id,name,email,credential,kind,status,is_vpe,token,${DATE('temp_until')} as temp_until from people where id=$1 and club_id=$2`, [req.params.id, club]);
  if (!p) return bad(res, 'Not found', 404);
  const hist = await loadHist(club);
  const projects = hist.evals.filter((e) => e.pid === p.id).reverse().map((e) => ({ id: e.id, title: e.title, project: e.project, path: e.path, level: e.level, date: e.date, number: e.number, by: e.by, work: e.work }));
  const roles = await q(`select r.id, r.label, r.role_key, r.submitted_at, m.id as meeting_id, m.number, ${DATE('m.date')} as date, (m.date >= current_date) as upcoming
    from meeting_roles r join meetings m on m.id=r.meeting_id where r.person_id=$1 order by m.date desc, r.position`, [p.id]);
  const given = await givenFor(p.id);
  const mine = (rows) => rows.filter((r) => r.pid === p.id);
  res.json({
    person: p, projects, roles, given,
    received: {
      gram: mine(hist.gram).reverse(), fill: mine(hist.fill).reverse(), time: mine(hist.time).reverse(),
      roleFeedback: mine(hist.rolefb).reverse(), peer: mine(hist.peer).reverse(),
    },
  });
}));

/* ───────── room feedback: public, reached by the QR code ───────── */
const hits = new Map();
const limited = (ip) => { const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 12; };
app.get('/api/f/:code', wrap(async (req, res) => {
  const [m] = await q(`select id, club_id, number, ${DATE('date')} as date, theme from meetings where feedback_code=$1`, [req.params.code]);
  if (!m) return bad(res, 'This feedback link is not valid', 404);
  const roles = await q(`select r.label, p.id, p.name from meeting_roles r join people p on p.id=r.person_id where r.meeting_id=$1 order by r.position`, [m.id]);
  const agenda = []; for (const r of roles) { const a = agenda.find((x) => x.id === r.id); a ? a.roles.push(r.label) : agenda.push({ id: r.id, name: r.name, roles: [r.label] }); }
  const others = (await q(`select id, name from people where club_id=$1 and status<>'inactive' order by name`, [m.club_id])).filter((p) => !agenda.some((a) => a.id === p.id));
  res.json({ meeting: { number: m.number, date: m.date, theme: m.theme }, agenda, others });
}));
app.post('/api/f/:code', wrap(async (req, res) => {
  if (limited(req.ip)) return bad(res, 'Too many submissions. Try again in a minute.', 429);
  const [m] = await q('select id, club_id from meetings where feedback_code=$1', [req.params.code]);
  if (!m) return bad(res, 'This feedback link is not valid', 404);
  const from = String(req.body.from_name || '').trim().slice(0, 60);
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 25);
  let n = 0;
  for (const it of items) {
    const well = String(it.well || '').trim().slice(0, 1500), improve = String(it.improve || '').trim().slice(0, 1500);
    if (!well && !improve) continue;
    const [p] = await q(`select id from people where id=$1 and club_id=$2 and status<>'inactive'`, [it.to_person_id, m.club_id]);
    if (!p) continue;
    await q('insert into peer_feedback(meeting_id,to_person_id,from_name,well,improve) values ($1,$2,$3,$4,$5)', [m.id, p.id, from, well, improve]); n++;
  }
  n ? res.json({ ok: true, count: n }) : bad(res, 'Write something for at least one person');
}));

/* ───────── serve the built client in production ───────── */
const dist = path.join(here, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong' }); });

// Start-up work (schema, pathways, demo data). A hosted function waits on `ready` before it answers.
export const ready = (async () => {
  const kind = await initDb();
  await ensurePathways();
  for (const c of await q('select id from clubs where join_code is null')) await q('update clubs set join_code=$1 where id=$2', [joinCode(), c.id]);
  if (DEMO && (await seedIfEmpty())) console.log('Empty database: loaded demo data for Champions Toastmasters Club.');
  return kind;
})();
export default app;

// On a normal server, listen. On Vercel the function in api/index.js handles requests instead.
if (!process.env.VERCEL) {
  const kind = await ready;
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`Brekkie API on http://localhost:${port} (${kind})`));
}
