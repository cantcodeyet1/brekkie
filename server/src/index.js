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
import { readAgendaTemplate } from './agendaRead.js';
import { checkDocx, fillDocx } from './agendaDocx.js';
import { EXTRAS, STD_BLOCKS, buildDocx, defaultAgenda, diffAgenda, loadContext, mergeAgenda, pickConfig } from './agenda.js';
import { agendaFits, renderAgendaPdf } from './agendaPdf.js';
import { buildRoleReport, hasOfficialReport } from './roleReport.js';
import { EVAL_FORMS, fillEvalForm, formFile } from './evalForm.js';
import { nextClubDate } from './schedule.js';
import { checkPw, cleanPattern, describePattern, generateMeetings, hashPw, joinCode, normEmail, nextPatternDate, pwProblem, validEmail } from './club.js';
import { validWord, wordDetails } from './words.js';
import { ensurePathways } from './pathways.js';
import { applyFormText } from './formtext.js';
import { forecastMember, goalsFrom, programYear } from './dcp.js';
import { LEVELS, ROLES, appliesTo, itemLabel, layOver, slotsFor, validItem } from './enhancements.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The demo picker lists every member's sign-in token, so it must never exist on a real database: it is off whenever DATABASE_URL is set
// (production), whatever DEMO_MODE says, and otherwise (local PGlite) on unless DEMO_MODE=false.
const DEMO = !process.env.DATABASE_URL && process.env.DEMO_MODE !== 'false';
const app = express();
app.use(cors());
// health answers before start-up finishes and says whether the database is reachable (never the connection string)
app.get('/api/health', (_req, res) => boot().then(() => res.json({ ok: true }), (e) => res.status(503).json({ ok: false, db: String(e.code || e.name || 'error'), why: String(e.message || '').replace(/postgres(ql)?:\/\/\S+/gi, '').slice(0, 120) })));
app.use((_req, _res, next) => { boot().then(() => next(), next); });
app.use(['/api/agenda-template', '/api/vpe/club/agenda-template', '/api/clubs'], express.json({ limit: '6mb' }));   // an agenda file arrives as base64
app.use(express.json({ limit: '1mb' }));
app.use('/api/eval-forms', express.static(EVAL_FORMS, { index: false, maxAge: '1d' }));   // the blank official forms

/* a few plain counters for the super admin page: how the server has done since it started */
const STARTED = Date.now();
const traffic = { total: 0, e4: 0, e5: 0, ms: 0, slow: 0, recent: [] };
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api') || req.path.startsWith('/api/admin') || req.path === '/api/health') return;
    const ms = Date.now() - t0;
    traffic.total++; traffic.ms += ms; if (ms > 1500) traffic.slow++;
    if (res.statusCode >= 500) { traffic.e5++; traffic.recent.unshift({ at: new Date().toISOString(), status: res.statusCode, path: req.path.replace(/[A-Za-z0-9_-]{20,}/g, ':token'), ms }); traffic.recent.length = Math.min(traffic.recent.length, 15); }
    else if (res.statusCode >= 400) traffic.e4++;
  });
  next();
});

const token = () => crypto.randomBytes(15).toString('base64url');
const EVAL_RESOURCES = JSON.parse(fs.readFileSync(new URL('../data/evaluation-resources.json', import.meta.url), 'utf8'));
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const FEEDBACK_KEYS = ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'general_evaluator', 'evaluator'];
const ROLE_DEFS = [
  ['toastmaster', 'Toastmaster of the Day'], ['grammarian', 'Grammarian'], ['ah_counter', 'Ah Counter'], ['timer', 'Timer'],
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
// the platform owner: a flag in the database that nothing in the app can set (see schema.sql), and only with a password
const isSuper = (p) => !!p?.is_super && !!p.password_hash;
const needSuper = (req, res, next) => (isSuper(req.person) ? next() : bad(res, 'Not found', 404));
const needRole = (req, res, next) => (req.role ? next() : bad(res, 'This link is not valid', 401));
const clubOf = (req) => req.person?.club_id ?? req.role?.club_id;
const pub = (p) => p && { id: p.id, name: p.name, kind: p.kind, status: p.status, email: p.email, is_vpe: p.is_vpe, is_tm: p.is_tm !== false };

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/session', wrap(async (req, res) => {
  if (req.person) { const [c] = await q('select name from clubs where id=$1', [req.person.club_id]); return res.json({ type: req.person.is_vpe ? 'vpe' : 'member', person: pub(req.person), club: c?.name, super: isSuper(req.person) }); }
  if (req.role) return res.json({ type: 'role', role: { key: req.role.role_key, label: req.role.label }, person: pub(req.rolePerson) });
  res.status(401).json({ error: 'No valid link' });
}));

/* ───────── accounts: email and password, a club code to join, and a wizard to start a club ───────── */
// Slows down password guessing. The count lives in the database, not in memory: a hosted function runs as many separate
// copies, and a counter in one copy's memory would not stop someone spread across them.
const LOGIN_WINDOW = "interval '15 minutes'";
const tooMany = async (key, max) => ((await q(`select count(*)::int as n from login_failures where key=$1 and at > now() - ${LOGIN_WINDOW}`, [key]))[0].n >= max);
const noteFailure = async (...keys) => { for (const k of keys) await q('insert into login_failures(key) values ($1)', [k]); if (Math.random() < 0.02) await q(`delete from login_failures where at < now() - interval '1 day'`); };
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 64);
const newPw = (v) => (typeof v === 'string' ? v.trim() : v);
const sessionFor = (p) => ({ token: p.token, type: p.is_vpe ? 'vpe' : 'member' });

app.post('/api/auth/signin', wrap(async (req, res) => {
  const email = normEmail(req.body.email), pw = String(req.body.password || '');
  if (!email || !pw) return bad(res, 'Enter your email and password');
  const ipKey = 'ip:' + clientIp(req), emailKey = 'email:' + email;
  if ((await tooMany(emailKey, 10)) || (await tooMany(ipKey, 40))) return bad(res, 'Too many tries. Wait a few minutes and try again.', 429);
  const rows = await q(`select p.*, c.name as club_name from people p join clubs c on c.id=p.club_id where lower(p.email)=$1 and p.password_hash is not null and p.status<>'inactive'`, [email]);
  // exactly as typed first; then without a space at either end, which phone keyboards add after a suggested word
  const ok = rows.filter((r) => checkPw(pw, r.password_hash) || (pw !== pw.trim() && checkPw(pw.trim(), r.password_hash)));
  if (!ok.length) { await noteFailure(emailKey, ipKey); return bad(res, 'That email and password do not match', 401); }
  await q('update people set last_login_at=now() where id = any($1)', [ok.map((r) => r.id)]);
  if (ok.length === 1) return res.json(sessionFor(ok[0]));
  res.json({ choose: ok.map((r) => ({ club: r.club_name, ...sessionFor(r) })) });
}));

/* invites and password resets: there is no email, so the VPE sends a link on WhatsApp.
   An invite lasts a week and retires the member's old personal link at once; a reset lasts a day. */
app.post('/api/vpe/people/:id/reset', needPerson, needVpe, wrap(async (req, res) => {
  const t = token();
  const r = await q(`update people set reset_token=$1, reset_expires=now() + interval '1 day' where id=$2 and club_id=$3 and kind='member' and status<>'inactive' returning id`, [t, req.params.id, req.person.club_id]);
  r.length ? res.json({ token: t }) : bad(res, 'Not found', 404);
}));
app.post('/api/vpe/invites', needPerson, needVpe, wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
  const out = [];
  for (const id of ids) {
    const t = token();
    const [p] = await q(`update people set reset_token=$1, reset_expires=now() + interval '7 days', invited_at=now(), token=case when password_hash is null then $4 else token end where id=$2 and club_id=$3 and kind='member' and status<>'inactive' and password_hash is null and id<>$5 returning id`, [t, id, req.person.club_id, token(), req.person.id]);
    if (p) out.push({ id: p.id, token: t });
  }
  res.json(out);
}));
app.get('/api/auth/reset/:token', wrap(async (req, res) => {
  const [p] = await q(`select p.name, p.email, (p.password_hash is null) as invited, c.name as club from people p join clubs c on c.id=p.club_id where p.reset_token=$1 and p.reset_expires > now() and p.status<>'inactive'`, [req.params.token]);
  p ? res.json(p) : bad(res, 'This link has expired. Ask your VPE for a new one.', 404);
}));
app.post('/api/auth/reset', wrap(async (req, res) => {
  const bp = pwProblem(newPw(req.body.password)); if (bp) return bad(res, bp);
  const [p] = await q(`update people set password_hash=$1, reset_token=null, reset_expires=null, token=$3, last_login_at=now() where reset_token=$2 and reset_expires > now() and status<>'inactive' returning *`, [hashPw(newPw(req.body.password)), String(req.body.token || ''), token()]);
  p ? res.json(sessionFor(p)) : bad(res, 'This link has expired. Ask your VPE for a new one.', 404);
}));


/* Adds a member to a club, or brings an existing one (same email or same name) up to date. `run` is q or a transaction's query.
   A member can arrive with the path they are on and how many levels of it they have already finished. */
const PATH_LEVELS = 5;
/* `thisYear` is how many of the finished levels (the latest ones) were earned in the current program year; they are dated today
   so they count towards this year's goals. Left out, each level keeps the date it already had. */
async function setLevelsDone(run, personId, path, done, thisYear) {
  const was = new Map((await run(`select level, ${DATE('done_on')} as d from member_levels where person_id=$1 and path=$2`, [personId, path])).map((x) => [x.level, x.d]));
  await run('delete from member_levels where person_id=$1', [personId]);
  const n = Math.max(0, Math.min(PATH_LEVELS, Number(done) || 0));
  const ty = thisYear === undefined || thisYear === null || thisYear === '' ? null : Math.max(0, Math.min(n, Number(thisYear) || 0));
  for (let l = 1; l <= n; l++) {
    const credit = ty === null ? !!was.get(l) : l > n - ty;
    await run(`insert into member_levels(person_id, path, level, done_on) values ($1,$2,$3, case when $4::boolean then coalesce($5::date, current_date) end) on conflict do nothing`, [personId, path, l, credit, ty === null ? was.get(l) || null : null]);
  }
  await run('update people set path_name=$1, path_level=$2 where id=$3', [path, Math.min(PATH_LEVELS, n + 1), personId]);
}
async function upsertMember(run, clubId, m) {
  const name = String(m.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 2) return { skipped: 'no name' };
  const email = normEmail(m.email); if (email && !validEmail(email)) return { skipped: 'bad email', name };
  const cred = String(m.credential || '').trim().slice(0, 20), phone = String(m.phone || '').trim().slice(0, 30) || null;
  let [p] = email ? await run('select * from people where club_id=$1 and lower(email)=$2', [clubId, email]) : [];
  if (!p) [p] = await run(`select * from people where club_id=$1 and lower(name)=lower($2) and kind='member' and status<>'inactive'`, [clubId, name]);
  let made = false;
  if (p) await run('update people set phone=coalesce($1, phone), credential=case when $2<>\'\' then $2 else credential end, credential_manual=case when $2<>\'\' then $4 else credential_manual end where id=$3', [phone, cred, p.id, !isPathCode(cred) && cred !== 'TM']);
  else { [p] = await run(`insert into people(club_id,name,email,kind,status,token,created_via,credential,phone) values ($1,$2,$3,'member','active',$4,'vpe',$5,$6) returning *`, [clubId, name, email || null, token(), cred, phone]); made = true; if (cred) await run('update people set credential_manual=$2 where id=$1', [p.id, !isPathCode(cred) && cred !== 'TM']); }
  const path = String(m.path_name || '').trim();
  if (path && (await run('select 1 as x from path_projects where path=$1 limit 1', [path])).length) await setLevelsDone(run, p.id, path, m.levels_done, m.levels_this_year);
  return { id: p.id, name: p.name, made };
}

const cleanNum = (v) => String(v || '').replace(/\D/g, '');
app.get('/api/clubs/number/:n', wrap(async (req, res) => {
  const [c] = await q('select name from clubs where tm_number=$1', [cleanNum(req.params.n)]);
  res.json({ taken: !!c });
}));


/* ───────── super admin: the platform owner's view across every club (only people flagged is_super) ───────── */
const n0 = (v) => Number(v) || 0;
app.get('/api/admin/overview', needPerson, needSuper, wrap(async (_req, res) => {
  const t0 = Date.now();
  await q('select 1');
  const dbMs = Date.now() - t0;
  const [t] = await q(`select
    (select count(*) from clubs)::int as clubs,
    (select count(*) from clubs where created_at > now() - interval '30 days')::int as clubs_30,
    (select count(*) from people where kind='member' and status<>'inactive')::int as members,
    (select count(*) from people where kind='guest' and status<>'inactive')::int as guests,
    (select count(*) from people where kind='member' and status<>'inactive' and password_hash is not null)::int as accounts,
    (select count(*) from people where kind='member' and status<>'inactive' and password_hash is null and invited_at is not null)::int as invited,
    (select count(*) from people where last_login_at > now() - interval '7 days')::int as login_7,
    (select count(*) from people where last_login_at > now() - interval '30 days')::int as login_30,
    (select count(*) from meetings where date < current_date)::int as meetings_held,
    (select count(*) from meetings where date >= current_date)::int as meetings_ahead,
    (select count(*) from evaluations)::int as evaluations,
    (select count(*) from meeting_roles where submitted_at is not null)::int as sheets,
    (select count(*) from speech_plans)::int as plans,
    (select count(*) from member_projects)::int as projects_logged,
    (select count(*) from member_levels)::int as levels_logged,
    (select count(*) from people where join_requested_at is not null)::int as join_requests`);
  const bySheet = await q(`select role_key, count(*)::int as n from meeting_roles where submitted_at is not null group by role_key order by n desc`);
  const days = await q(`select to_char(d,'YYYY-MM-DD') as day,
      (select count(*) from meeting_roles where submitted_at::date = d::date)::int as sheets,
      (select count(*) from clubs where created_at::date = d::date)::int as clubs,
      (select count(*) from people where last_login_at::date = d::date)::int as logins
    from generate_series(current_date - 13, current_date, interval '1 day') d order by d`);
  const log = await q(`select l.at, l.action, a.name as admin, p.name as person from admin_log l left join people a on a.id=l.admin_id left join people p on p.id=l.person_id order by l.at desc limit 8`);
  const mem = process.memoryUsage();
  res.json({
    system: {
      up_s: Math.round((Date.now() - STARTED) / 1000), started: new Date(STARTED).toISOString(), node: process.version,
      host: process.env.VERCEL ? 'Vercel' : 'Local', region: process.env.VERCEL_REGION || '', commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7), branch: process.env.VERCEL_GIT_COMMIT_REF || '',
      db: process.env.DATABASE_URL ? 'Postgres (Neon)' : 'Embedded (PGlite)', db_ms: dbMs, rss_mb: Math.round(mem.rss / 1048576), heap_mb: Math.round(mem.heapUsed / 1048576),
      requests: traffic.total, errors_4xx: traffic.e4, errors_5xx: traffic.e5, slow: traffic.slow, avg_ms: traffic.total ? Math.round(traffic.ms / traffic.total) : 0, recent_errors: traffic.recent,
    },
    totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, n0(v)])),
    sheets_by_role: bySheet, days, log,
  });
}));
app.get('/api/admin/clubs', needPerson, needSuper, wrap(async (_req, res) => {
  res.json(await q(`select c.id, c.name, c.tm_number, ${DATE('c.created_at')} as created,
      (select count(*) from people p where p.club_id=c.id and p.kind='member' and p.status<>'inactive')::int as members,
      (select count(*) from people p where p.club_id=c.id and p.kind='guest' and p.status<>'inactive')::int as guests,
      (select count(*) from people p where p.club_id=c.id and p.kind='member' and p.status<>'inactive' and p.password_hash is not null)::int as accounts,
      (select count(*) from meetings m where m.club_id=c.id and m.date < current_date)::int as held,
      (select count(*) from evaluations e join meetings m on m.id=e.meeting_id where m.club_id=c.id)::int as speeches,
      (select count(*) from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=c.id and r.submitted_at is not null)::int as sheets,
      (select to_char(max(p.last_login_at),'YYYY-MM-DD') from people p where p.club_id=c.id) as last_login,
      (select name from people p where p.club_id=c.id and p.is_vpe order by p.id limit 1) as vpe,
      (select email from people p where p.club_id=c.id and p.is_vpe order by p.id limit 1) as vpe_email,
      (select phone from people p where p.club_id=c.id and p.is_vpe order by p.id limit 1) as vpe_phone
    from clubs c order by c.created_at desc`));
}));
/* find anyone who is stuck: by name, email, phone or club, or the people who were invited and never got in */
app.get('/api/admin/people', needPerson, needSuper, wrap(async (req, res) => {
  const term = `%${String(req.query.q || '').trim().toLowerCase()}%`, stuck = req.query.stuck === '1';
  const rows = await q(`select p.id, p.name, p.email, p.phone, p.kind, p.is_vpe, c.name as club, ${DATE('p.invited_at')} as invited, ${DATE('p.last_login_at')} as last_login,
      (p.password_hash is not null) as has_pw, (p.reset_token is not null and p.reset_expires > now()) as live_link
    from people p join clubs c on c.id=p.club_id
    where p.status<>'inactive' and p.kind='member'
      and ($1='%%' or lower(p.name) like $1 or lower(coalesce(p.email,'')) like $1 or coalesce(p.phone,'') like $1 or lower(c.name) like $1)
      and (not $2 or (p.password_hash is null and p.invited_at is not null) or (p.password_hash is not null and p.last_login_at is null))
    order by p.invited_at desc nulls last, p.name limit 80`, [term, stuck]);
  res.json(rows.map((p) => ({ ...p, state: p.has_pw ? (p.last_login ? 'active' : 'never') : p.invited ? 'invited' : 'none' })));
}));
/* a sign-in link for someone who is stuck: a reset for a member with a password, a fresh invite for one without */
app.post('/api/admin/people/:id/reset', needPerson, needSuper, wrap(async (req, res) => {
  const [p] = await q(`select * from people where id=$1 and kind='member' and status<>'inactive'`, [req.params.id]);
  if (!p) return bad(res, 'Not found', 404);
  const t = token();
  if (p.password_hash) await q(`update people set reset_token=$1, reset_expires=now() + interval '3 days' where id=$2`, [t, p.id]);
  else await q(`update people set reset_token=$1, reset_expires=now() + interval '7 days', invited_at=now(), token=$3 where id=$2`, [t, p.id, token()]);
  await q('insert into admin_log(admin_id, action, person_id) values ($1,$2,$3)', [req.person.id, p.password_hash ? 'reset link' : 'invite link', p.id]);
  res.json({ token: t, kind: p.password_hash ? 'reset' : 'invite', name: p.name, phone: p.phone, days: p.password_hash ? 3 : 7 });
}));

/* a club's own agenda: read from the file it uploads (nothing is saved here: the VPE reviews it first), then applied */
app.post('/api/agenda-template/read', wrap(async (req, res) => {
  if (limited(req.ip)) return bad(res, 'Too many tries. Wait a minute and try again.', 429);
  const data = String(req.body?.data || '').replace(/^data:[^,]*,/, '');
  if (!data) return bad(res, 'Choose a file');
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 3.2 * 1024 * 1024) return bad(res, 'That file is too big. Use one under 3 MB.');
  const fname = String(req.body?.name || ''), isDocx = /\.docx$/i.test(fname);
  // a Word file is checked for the parts Brekkie can fill (it becomes the club's own template); the club details are read out of it as well
  let template = null;
  if (isDocx) { try { template = await checkDocx(buf); } catch { return bad(res, 'That does not look like a Word file we can open'); } }
  try { res.json({ ...(await readAgendaTemplate(buf, fname)), template }); }
  catch (e) {
    if (template?.usable) return res.json({ club: { name: '', number: '' }, profile: { region: '', mission: '', officers: [] }, blocks: [], start: '', template, note: 'We could not read the club details out of your file this time, but your template works. You can add the details by hand.' });
    bad(res, e.message || 'We could not read that file', e.status || 400);
  }
}));
/** put a reviewed agenda template on a club: its details for the page, and the running order (and start time) every new agenda starts from */
async function applyTemplate(run, clubId, t) {
  if (!t || typeof t !== 'object') return;
  if (t.remove_template) await run('update clubs set agenda_template=null, agenda_template_name=null, agenda_template_checks=null where id=$1', [clubId]);
  // the Word file itself: kept only when it can be filled, so a club never ends up with a template that does nothing
  if (t.file?.data && /\.docx$/i.test(t.file.name || '')) {
    const buf = Buffer.from(String(t.file.data).replace(/^data:[^,]*,/, ''), 'base64');
    if (buf.length > 3.2 * 1024 * 1024) throw Object.assign(new Error('That file is too big. Use one under 3 MB.'), { status: 400 });
    const chk = await checkDocx(buf).catch(() => ({ usable: false }));
    if (!chk.usable) throw Object.assign(new Error('We could not find the running order and role table in that Word file, so it cannot be used as your template.'), { status: 400 });
    await run('update clubs set agenda_template=$1, agenda_template_name=$2, agenda_template_checks=$3 where id=$4', [buf, String(t.file.name).slice(0, 120), JSON.stringify(chk.parts), clubId]);
  }
  const prof = cleanProfile(t.profile);
  if (prof) await run('update clubs set agenda_profile=$1 where id=$2', [JSON.stringify(prof), clubId]);
  const [c] = await run('select agenda_default from clubs where id=$1', [clubId]);
  let cur = {}; try { cur = c?.agenda_default ? JSON.parse(c.agenda_default) : {}; } catch { cur = {}; }
  const next = pickConfig({ ...cur, ...(Array.isArray(t.blocks) && t.blocks.length ? { blocks: t.blocks } : {}), ...(/^\d{4}$/.test(t.start || '') ? { start: t.start } : {}) });
  if (Object.keys(next).length) await run('update clubs set agenda_default=$1 where id=$2', [JSON.stringify(next), clubId]);
}
app.post('/api/vpe/club/agenda-template', needPerson, needVpe, wrap(async (req, res) => {
  await applyTemplate(q, req.person.club_id, req.body);
  res.json({ ok: true });
}));

/* the wizard: a new club, its VPE, and its first year of meetings */
app.post('/api/clubs', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' '), email = normEmail(req.body.email);
  const clubName = String(req.body.club?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 2 || name.length > 80) return bad(res, 'Enter your name');
  if (!validEmail(email)) return bad(res, 'Enter a valid email address');
  const bp = pwProblem(newPw(req.body.password)); if (bp) return bad(res, bp);
  if (clubName.length < 2) return bad(res, 'Enter your club name');
  const tmNum = cleanNum(req.body.club?.number);
  if (tmNum.length < 3 || tmNum.length > 10) return bad(res, 'Enter your Toastmasters club number');
  if ((await q('select 1 as x from clubs where tm_number=$1', [tmNum])).length) return bad(res, 'A club with that number is already on Brekkie. Ask its VPE for the join link.', 409);
  const pc = cleanPattern(req.body.club?.pattern); if (pc.error) return bad(res, pc.error);
  const number = Math.max(1, Math.min(9999, parseInt(req.body.club?.firstNumber, 10) || 1));
  const out = await tx(async (t) => {
    let code; for (let i = 0; i < 8; i++) { code = joinCode(); if (!(await t('select 1 as x from clubs where join_code=$1', [code])).length) break; }
    const [club] = await t('insert into clubs(name,pattern,join_code,tm_number) values ($1,$2,$3,$4) returning id, name, pattern, join_code', [clubName, JSON.stringify(pc.pattern), code, tmNum]);
    const [vpe] = await t(`insert into people(club_id,name,email,kind,status,is_vpe,token,created_via,credential,password_hash) values ($1,$2,$3,'member','active',true,$4,'wizard','TM',$5) returning *`, [club.id, name, email, token(), hashPw(newPw(req.body.password))]);
    const made = await generateMeetings(t, club, { months: 12, firstNumber: number });
    await applyTemplate(t, club.id, req.body.club?.agenda);
    let added = 0;
    for (const m of (Array.isArray(req.body.members) ? req.body.members : []).slice(0, 300)) {
      const r = await upsertMember(t, club.id, m);
      if (r.made) added++;
    }
    return { ...sessionFor(vpe), join_code: club.join_code, meetings: made, members_added: added };
  });
  res.json(out);
}));

/* the signed-in person's account, and their club's details */
app.get('/api/account', needPerson, wrap(async (req, res) => {
  const [c] = await q('select name, join_code, pattern, guest_days, venue, meeting_time, tm_number, agenda_profile, agenda_template_name, agenda_template_checks from clubs where id=$1', [req.person.club_id]);
  res.json({ name: req.person.name, email: req.person.email || '', path_name: req.person.path_name || null, path_level: req.person.path_level ?? null, has_password: !!req.person.password_hash, club: { name: c.name, number: c.tm_number || '', join_code: req.person.is_vpe ? c.join_code : undefined, pattern: c.pattern, pattern_text: describePattern(c.pattern), guest_days: c.guest_days || 30, venue: c.venue || '', meeting_time: c.meeting_time || '', agenda_profile: req.person.is_vpe ? c.agenda_profile || null : undefined, agenda_template: req.person.is_vpe && c.agenda_template_name ? { name: c.agenda_template_name, parts: c.agenda_template_checks || [] } : undefined } });
}));
/* the club at a glance, for the VPE's Club page */
app.get('/api/vpe/club/summary', needPerson, needVpe, wrap(async (req, res) => {
  const club = req.person.club_id;
  const [p] = await q(`select count(*) filter (where kind='member' and status<>'inactive')::int as members, count(*) filter (where kind='guest' and status<>'inactive')::int as guests, count(*) filter (where join_requested_at is not null and kind='guest')::int as wants from people where club_id=$1`, [club]);
  const [m] = await q(`select count(*) filter (where date < current_date)::int as held, count(*) filter (where date >= current_date)::int as ahead from meetings where club_id=$1`, [club]);
  const [n] = await q(`select number, ${DATE('date')} as date from meetings where club_id=$1 and date >= current_date order by date limit 1`, [club]);
  const [s] = await q(`select count(*)::int as speeches from evaluations e join meetings mm on mm.id=e.meeting_id where mm.club_id=$1`, [club]);
  res.json({ ...p, ...m, next: n || null, speeches: s.speeches });
}));
app.put('/api/account', needPerson, wrap(async (req, res) => {
  const email = normEmail(req.body.email), pw = newPw(req.body.password);
  if (!validEmail(email)) return bad(res, 'Enter a valid email address');
  if (req.person.password_hash && pw && !checkPw(String(req.body.current || ''), req.person.password_hash)) return bad(res, 'Your current password is not right', 403);
  const [dup] = await q('select 1 as x from people where club_id=$1 and lower(email)=$2 and id<>$3', [req.person.club_id, email, req.person.id]);
  if (dup) return bad(res, 'Someone in your club already uses that email', 409);
  if (pw || !req.person.password_hash) { const bp = pwProblem(pw); if (bp) return bad(res, bp); }
  await q('update people set email=$1, password_hash=coalesce($2, password_hash) where id=$3', [email, pw ? hashPw(pw) : null, req.person.id]);
  if ('path_name' in req.body) await q('update people set path_name=$1, path_level=$2 where id=$3', [req.body.path_name || null, req.body.path_name ? (Number(req.body.path_level) || null) : null, req.person.id]);
  res.json({ ok: true });
}));
/** a club's own details for its agenda page: area line, mission and up to seven officers. Empty means the club uses the standard page. */
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const officers = (Array.isArray(p.officers) ? p.officers : []).slice(0, 7).map((o) => ({ role: s(o?.role, 40), name: s(o?.name, 60), phone: s(o?.phone, 30) })).filter((o) => o.role);
  const out = { region: s(p.region, 80), mission: s(p.mission, 600), officers };
  return out.region || out.mission || officers.length ? out : null;
}
app.put('/api/vpe/club', needPerson, needVpe, wrap(async (req, res) => {
  const pc = cleanPattern(req.body.pattern); if (pc.error) return bad(res, pc.error);
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const gd = Math.min(180, Math.max(7, parseInt(req.body.guest_days, 10) || 30));
  const [cur] = await q('select venue, meeting_time from clubs where id=$1', [req.person.club_id]);
  const venue = 'venue' in req.body ? String(req.body.venue || '').trim().slice(0, 120) : cur.venue, mtime = 'meeting_time' in req.body ? String(req.body.meeting_time || '').trim().slice(0, 40) : cur.meeting_time;
  // the Toastmasters club number (shown on the agenda): optional here, unique across clubs
  let tm;
  if ('number' in req.body) {
    tm = cleanNum(req.body.number) || null;
    if (tm && (tm.length < 3 || tm.length > 10)) return bad(res, 'A club number has 3 to 10 digits');
    if (tm && (await q('select 1 as x from clubs where tm_number=$1 and id<>$2', [tm, req.person.club_id])).length) return bad(res, 'Another club on Brekkie already uses that number', 409);
  }
  await q("update clubs set pattern=$1, name=coalesce(nullif($2, ''), name), guest_days=$4, venue=$5, meeting_time=$6, tm_number=case when $7::boolean then $8 else tm_number end where id=$3", [JSON.stringify(pc.pattern), name, req.person.club_id, gd, venue, mtime, 'number' in req.body, tm ?? null]);
  if ('agenda_profile' in req.body) await q('update clubs set agenda_profile=$1 where id=$2', [cleanProfile(req.body.agenda_profile) ? JSON.stringify(cleanProfile(req.body.agenda_profile)) : null, req.person.club_id]);
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
  const [cl] = await q('select guest_days from clubs where id=$1', [clubId]);
  const until = new Date((meetingDate ? meetingDate + 'T12:00:00' : Date.now())); until.setDate(until.getDate() + (cl?.guest_days || 30));
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
  const roles = await q(`select id, role_key, label, position, person_id, project_id, part, path_name, path_level, speech_title, target_role_id from meeting_roles where meeting_id=$1 order by position`, [r.meeting_id]);
  const projects = await q('select * from projects order by level, id');
  const [club] = await q('select name from clubs where id=$1', [r.club_id]);
  // a speaker and their evaluator are put in touch: each is told the other's name and contact details, and the speaker gets the
  // evaluation once the evaluator has submitted it
  const contact = 'p.id as person_id, p.name, p.phone, p.email';
  let partners = [], mine = null;
  if (r.role_key === 'speaker') {
    partners = await q(`select r2.id as role_id, r2.label, r2.submitted_at, ${contact} from meeting_roles r2 join people p on p.id=r2.person_id where r2.target_role_id=$1 and r2.meeting_id=$2 and p.club_id=$3 order by r2.position`, [r.id, r.meeting_id, r.club_id]);
    for (const p of partners) if (p.submitted_at) {
      const [e] = await q(`select e.id, e.ratings, e.comments, e.excelled, e.work, e.challenge from evaluations e join meeting_roles r on r.id=e.role_id where e.role_id=$1 and r.review_status='approved'`, [p.role_id]);
      p.evaluation = e || null;
      p.in_review = !e;   // submitted, and waiting for the VPE to approve it
    }
    const [pr] = r.project_id ? await q('select name, level, path from projects where id=$1', [r.project_id]) : [];
    const res0 = pr && EVAL_RESOURCES[pr.name];
    mine = { project: pr?.name || null, level: r.path_level ?? pr?.level ?? null, path: r.path_name ?? pr?.path ?? null, part: r.part, title: r.speech_title,
      form: res0 ? (res0.forms?.[Math.max(0, (r.part || 1) - 1)] || res0.pdf || null) : null };
  } else if (r.role_key === 'evaluator' && r.target_role_id) {
    partners = await q(`select r2.id as role_id, r2.label, r2.speech_title as title, ${contact} from meeting_roles r2 join people p on p.id=r2.person_id where r2.id=$1 and r2.meeting_id=$2 and p.club_id=$3`, [r.target_role_id, r.meeting_id, r.club_id]);
  }
  res.json({
    club: club?.name || '', partners, mine,
    role: { id: r.id, key: r.role_key, label: r.label, submitted_at: r.submitted_at, target_role_id: r.target_role_id },
    me: req.rolePerson && { ...pub(req.rolePerson), join_requested: !!req.rolePerson.join_requested_at }, meeting, people, roles, projects, sheet: r.sheet || {}, evalResources: r.role_key === 'evaluator' ? EVAL_RESOURCES : undefined,
  });
}));

/* the role player's notes on Toastmasters International's own script and log (extra detail goes on a plain last page) */
app.post('/api/role/report.pdf', needRole, wrap(async (req, res) => {
  const r = req.role;
  if (!hasOfficialReport(r.role_key)) return bad(res, 'There is no official form for this role', 404);
  const [meeting] = await q(`select id, number, ${DATE('date')} as date, theme, word, meaning, example from meetings where id=$1`, [r.meeting_id]);
  const people = await q(`select id,name from people where club_id=$1`, [r.club_id]);
  const roles = await q('select id, role_key, label, person_id from meeting_roles where meeting_id=$1', [r.meeting_id]);
  const projects = await q('select id, green, yellow, red from projects');
  const [club] = await q('select name from clubs where id=$1', [r.club_id]);
  const sheet = req.body && typeof req.body === 'object' && Object.keys(req.body).length ? req.body : (r.sheet || {});
  const pdf = await buildRoleReport(r.role_key, { meeting, people, roles, projects, sheet, club: club?.name || '', name: req.rolePerson?.name || '' });
  const d = new Date(meeting.date + 'T12:00:00');
  const name = `${r.label.replace(/\s+/g, '-')}-${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}.pdf`;
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' });
  res.send(pdf);
}));

/* a guest says they would like to join the club; the VPE sees it and makes them a member */
const joinRequest = wrap(async (req, res) => {
  const p = req.person || req.rolePerson;
  if (!p) return bad(res, 'Not found', 404);
  if (p.kind !== 'guest') return res.json({ ok: true, member: true });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email && !validEmail(email)) return bad(res, 'Enter a valid email address');
  await q(`update people set join_requested_at=coalesce(join_requested_at, now()), email=coalesce(nullif($2, ''), email) where id=$1`, [p.id, email]);
  res.json({ ok: true });
});
app.post('/api/role/join-request', needRole, joinRequest);
app.post('/api/me/join-request', needPerson, joinRequest);
app.put('/api/role/sheet', needRole, wrap(async (req, res) => {
  await saveSheet(req.role, req.body || {});
  // changing something already approved sends it back to the VPE
  if (req.role.review_status === 'approved' && JSON.stringify(req.body || {}) !== JSON.stringify(req.role.sheet || {})) await q(`update meeting_roles set review_status='pending' where id=$1`, [req.role.id]);
  res.json({ ok: true, saved_at: new Date().toISOString() });
}));
app.post('/api/role/submit', needRole, wrap(async (req, res) => {
  if (req.body && Object.keys(req.body).length) await saveSheet(req.role, req.body);
  await q(`update meeting_roles set submitted_at=now(), review_status='pending' where id=$1`, [req.role.id]);   // the VPE reviews it before anyone it is about can see it
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
        const uses = Math.max(0, parseInt(r.uses, 10) || (r.used ? 1 : 0));
        if (!uses && !r.liked && !r.improper && !r.suggestion) continue;
        await t('insert into gram_notes(role_id,meeting_id,subject_id,used_word,word_uses,liked,improper,suggestion) values ($1,$2,$3,$4,$5,$6,$7,$8)',
          [rid, mid, r.subject_id, uses > 0, uses, r.liked || '', r.improper || '', r.suggestion || '']);
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
          const [pr] = r.project_id ? await t('select id,green,yellow,red,parts from projects where id=$1', [r.project_id]) : [];
          const pt = pr?.parts?.[(parseInt(r.part, 10) || 1) - 1];   // a part can have its own length
          g = pr ? [pt?.green ?? pr.green, pt?.yellow ?? pr.yellow, pt?.red ?? pr.red] : [300, 360, 420]; pid = pr?.id ?? null;
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
      const [tr] = role.target_role_id ? await t('select person_id, project_id, part, speech_title, path_name, path_level from meeting_roles where id=$1 and meeting_id=$2', [role.target_role_id, mid]) : [];
      const ratings = (sheet.ratings || []).map((v) => Math.max(0, Math.min(5, +v || 0)));
      const any = ratings.some(Boolean) || sheet.excelled || sheet.work || sheet.challenge;
      if (tr?.person_id && tr.project_id && any) {
        await t('insert into evaluations(role_id,meeting_id,speaker_id,project_id,title,ratings,comments,excelled,work,challenge,seconds,path_name,path_level,part) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          [rid, mid, tr.person_id, tr.project_id, tr.speech_title || '', JSON.stringify(ratings), JSON.stringify(sheet.comments || []), sheet.excelled || '', sheet.work || '', sheet.challenge || '', num(sheet.seconds), tr.path_name || null, tr.path_level ?? null, tr.part || 1]);
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
  const me = req.person, hist = await loadHist(me.club_id, true);
  const prog = progressFor(me.id, hist);
  const meetings = await myMeetings(me, hist);
  const up = await q(`select r.label, r.role_key, r.token, r.submitted_at, r.part, pr.name as project, m.id as meeting_id, m.number, ${DATE('m.date')} as date
    from meeting_roles r join meetings m on m.id=r.meeting_id left join projects pr on pr.id=r.project_id where r.person_id=$1 and m.date >= current_date order by m.date, r.position limit 3`, [me.id]);
  // a speaker gets the official evaluation form for the project (and part) they are giving
  for (const u of up) {
    const f = u.role_key === 'speaker' && u.project ? EVAL_RESOURCES[u.project] : null;
    u.form = f ? (f.forms?.length ? f.forms[Math.min(Math.max(u.part || 1, 1), f.forms.length) - 1] : f.pdf || null) : null;
  }
  let focus = null;
  if (prog.focus.length) {
    const k = prog.focus[0]; let c = null;
    for (const e of prog.evals) if (e.comments?.[k] && e.ratings[k] && e.ratings[k] <= 3) { c = e.comments[k]; break; }
    focus = { name: prog.criteria[k], avg: prog.avgs[k], comment: c, work: prog.evals[0]?.work || '', by: prog.evals[0]?.by };
  }
  const [nextMeeting] = await q(`select id, number, ${DATE('date')} as date from meetings where club_id=$1 and date >= current_date order by date limit 1`, [me.club_id]);
  res.json({ next_meeting: nextMeeting || null, path: me.kind === 'guest' ? null : await pathProgress(me), person: { ...pub(me), join_requested: !!me.join_requested_at }, ...summary(me.id, hist), focus, latest: meetings[0] || null, upcoming: up, meetings: meetings.length, given: (await givenFor(me.id)).length });
}));
app.get('/api/me/given', needPerson, wrap(async (req, res) => res.json(await givenFor(req.person.id))));
app.get('/api/me/given/:id', needPerson, wrap(async (req, res, next) => {
  const [r] = await q('select 1 as ok from meeting_roles where id=$1 and person_id=$2 and submitted_at is not null', [req.params.id, req.person.id]);
  if (!r) return bad(res, 'Not found', 404);
  next();
}), (req, res, next) => submissionHandler(req, res, next));
app.get('/api/me/meetings', needPerson, wrap(async (req, res) => res.json(await myMeetings(req.person, await loadHist(req.person.club_id, true)))));
app.get('/api/me/meetings/:number', needPerson, wrap(async (req, res) => {
  const me = req.person, n = +req.params.number;
  const [m] = await q(`select id, number, ${DATE('date')} as date, theme, word from meetings where club_id=$1 and number=$2`, [me.club_id, n]);
  if (!m) return bad(res, 'Not found', 404);
  const hist = await loadHist(me.club_id, true);
  const mine = (rows) => rows.filter((r) => r.pid === me.id && r.number === n);
  const roles = await q('select id, label, role_key from meeting_roles where meeting_id=$1 and person_id=$2 order by position', [m.id, me.id]);
  const roleFb = await q(`select rf.well, rf.improve, tr.label as role, ap.name as by from role_feedback rf join meeting_roles tr on tr.id=rf.target_role_id
    join meeting_roles ar on ar.id=rf.author_role_id left join people ap on ap.id=ar.person_id where rf.meeting_id=$1 and tr.person_id=$2 and ar.review_status='approved'`, [m.id, me.id]);
  const peer = await q('select from_name, well, improve from peer_feedback where meeting_id=$1 and to_person_id=$2 and not hidden order by id', [m.id, me.id]);
  res.json({ meeting: m, roles, roleFeedback: roleFb, peer, speech: mine(hist.evals)[0] || null, gram: mine(hist.gram), ah: mine(hist.fill), time: mine(hist.time) });
}));
app.get('/api/me/room', needPerson, wrap(async (req, res) => {
  const hist = await loadHist(req.person.club_id, true);
  res.json(hist.peer.filter((r) => r.pid === req.person.id).sort((a, b) => b.date.localeCompare(a.date)));
}));

app.get('/api/me/history/:key', needPerson, wrap(async (req, res) => {
  const k = { gram: 'gram', ah: 'fill', time: 'time' }[req.params.key];
  if (!k) return bad(res, 'Unknown history', 404);
  const hist = await loadHist(req.person.club_id, true);
  res.json(hist[k].filter((r) => r.pid === req.person.id).sort((a, b) => b.date.localeCompare(a.date)));
}));
app.get('/api/me/evaluations', needPerson, wrap(async (req, res) => {
  const hist = await loadHist(req.person.club_id, true);
  res.json(hist.evals.filter((r) => r.pid === req.person.id).sort((a, b) => b.date.localeCompare(a.date)));
}));
app.get('/api/me/evaluations/:id', needPerson, wrap(async (req, res) => evalDetail(req, res, req.person.id)));
app.get('/api/vpe/evaluations/:id', needPerson, needVpe, wrap(async (req, res) => evalDetail(req, res, null)));
// an evaluation written onto the official form for its project (and part)
const longDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
async function sendEvalForm(res, { project, part, data, fileName }) {
  const file = formFile(EVAL_RESOURCES[project]?.forms?.[Math.max(0, (part || 1) - 1)] || EVAL_RESOURCES[project]?.pdf);
  if (!file) return bad(res, 'There is no official form for this project', 404);
  const { pdf } = await fillEvalForm(file, data);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' });
  res.send(pdf);
}
const formName = (who, date) => `Evaluation-${who.replace(/[^A-Za-z0-9]+/g, '-')}-${date}.pdf`;
app.post('/api/role/evaluation.pdf', needRole, wrap(async (req, res) => {
  const r = req.role;
  if (r.role_key !== 'evaluator') return bad(res, 'Only a Speech Evaluator has an evaluation form', 404);
  const [t] = r.target_role_id ? await q(`select r.speech_title, r.part, r.project_id, p.name as speaker, pr.name as project from meeting_roles r left join people p on p.id=r.person_id left join projects pr on pr.id=r.project_id where r.id=$1 and r.meeting_id=$2`, [r.target_role_id, r.meeting_id]) : [];
  if (!t?.project) return bad(res, 'You need a speaker and a project before the form can be filled in', 400);
  const [m] = await q(`select ${DATE('date')} as date from meetings where id=$1`, [r.meeting_id]);
  const sh = req.body && typeof req.body === 'object' && Object.keys(req.body).length ? req.body : (r.sheet || {});
  await sendEvalForm(res, { project: t.project, part: t.part, fileName: formName(t.speaker || 'speaker', m.date),
    data: { member: t.speaker, evaluator: req.rolePerson?.name, date: longDate(m.date), title: t.speech_title, excelled: sh.excelled, work: sh.work, challenge: sh.challenge, ratings: sh.ratings, comments: sh.comments } });
}));
// a speaker, from their own link, downloads what their evaluator wrote on the official form (once the evaluator has submitted it)
app.get('/api/role/received-evaluation.pdf', needRole, wrap(async (req, res) => {
  const r = req.role;
  if (r.role_key !== 'speaker') return bad(res, 'Only a speaker receives an evaluation', 404);
  const [e] = await q(`select e.*, ${DATE('m.date')} as date, p.name as project, sp.name as member, ev.name as by
    from evaluations e join meeting_roles er on er.id=e.role_id join meetings m on m.id=e.meeting_id join projects p on p.id=e.project_id
    join people sp on sp.id=e.speaker_id left join people ev on ev.id=er.person_id
    where er.target_role_id=$1 and er.meeting_id=$2 and er.submitted_at is not null and er.review_status='approved' order by e.id limit 1`, [r.id, r.meeting_id]);
  if (!e) return bad(res, 'Your evaluation is not in yet', 404);
  await sendEvalForm(res, { project: e.project, part: e.part, fileName: formName(e.member, e.date),
    data: { member: e.member, evaluator: e.by, date: longDate(e.date), title: e.title, excelled: e.excelled, work: e.work, challenge: e.challenge, ratings: e.ratings, comments: e.comments } });
}));
async function evalFormFor(req, res, onlyMe) {
  const [e] = await q(`select e.*, ${DATE('m.date')} as date, m.club_id, p.name as project, sp.name as member, ev.name as by, r.review_status
    from evaluations e join meetings m on m.id=e.meeting_id join projects p on p.id=e.project_id join people sp on sp.id=e.speaker_id
    join meeting_roles r on r.id=e.role_id left join people ev on ev.id=r.person_id where e.id=$1`, [req.params.id]);
  if (!e || e.club_id !== req.person.club_id || (onlyMe && (e.speaker_id !== onlyMe || e.review_status !== 'approved'))) return bad(res, 'Not found', 404);
  await sendEvalForm(res, { project: e.project, part: e.part, fileName: formName(e.member, e.date),
    data: { member: e.member, evaluator: e.by, date: longDate(e.date), title: e.title, excelled: e.excelled, work: e.work, challenge: e.challenge, ratings: e.ratings, comments: e.comments } });
}
app.get('/api/me/evaluations/:id/form.pdf', needPerson, wrap((req, res) => evalFormFor(req, res, req.person.id)));
app.get('/api/vpe/evaluations/:id/form.pdf', needPerson, needVpe, wrap((req, res) => evalFormFor(req, res, null)));
async function evalDetail(req, res, onlyMe) {
  const [e] = await q(`select e.*, ${DATE('m.date')} as date, m.number, m.club_id, p.name as project, coalesce(e.path_level, p.level) as level, coalesce(e.path_name, p.path) as path, p.form_title, p.length_text, p.purpose, p.notes, p.about, p.green, p.yellow, p.red,
      sp.name as member, ev.name as by, r.review_status
    from evaluations e join meetings m on m.id=e.meeting_id join projects p on p.id=e.project_id join people sp on sp.id=e.speaker_id
    join meeting_roles r on r.id=e.role_id left join people ev on ev.id=r.person_id where e.id=$1`, [req.params.id]);
  if (!e || e.club_id !== req.person.club_id || (onlyMe && (e.speaker_id !== onlyMe || e.review_status !== 'approved'))) return bad(res, 'Not found', 404);
  res.json(e);
}

/* ───────── VPE ───────── */
app.get('/api/evaluation-resources', needPerson, (_req, res) => res.json(EVAL_RESOURCES));
app.get('/api/projects', needPerson, wrap(async (_req, res) => res.json(await q('select * from projects order by level, id'))));

app.get('/api/pathways', needPerson, wrap(async (_req, res) => {
  const rows = await q(`select pp.path, pp.level, pp.level_title, pp.kind, pp.pos, pp.choose, p.id, p.name, p.length_text, p.parts
    from path_projects pp join projects p on p.id=pp.project_id order by pp.path, pp.level, pp.pos`);
  const paths = [];
  for (const r of rows) {
    let p = paths.find((x) => x.name === r.path); if (!p) paths.push(p = { name: r.path, levels: [] });
    let lv = p.levels.find((x) => x.level === r.level); if (!lv) p.levels.push(lv = { level: r.level, title: r.level_title, choose: r.choose, projects: [] });
    lv.projects.push({ id: r.id, name: r.name, kind: r.kind, pos: r.pos, code: r.kind === 'required' ? `L${r.level}P${r.pos}` : '', length: r.length_text, parts: (r.parts || []).length > 1 ? r.parts.map((x) => ({ n: x.n, label: x.label, kind: x.kind, length: x.length_text })) : undefined });
  }
  res.json({ paths });
}));

app.get('/api/vpe/meetings', needPerson, needVpe, wrap(async (req, res) => {
  const rows = await q(`select m.id, m.number, ${DATE('m.date')} as date, m.theme, m.word, m.pos, m.meaning, m.feedback_code,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id and r.person_id is not null) as roles_filled,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id) as roles_total,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id and r.person_id is not null and r.role_key = any($2)) as fb_total,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id and r.submitted_at is not null) as fb_in,
      (select count(*)::int from meeting_roles r where r.meeting_id=m.id and r.review_status='pending') as fb_review
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

/* remove a meeting date (a holiday, say) and close the gap: every later meeting moves up one number */
app.delete('/api/vpe/meetings/:id', needPerson, needVpe, wrap(async (req, res) => {
  const [m] = await q('select id, number from meetings where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  const [used] = await q(`select (select count(*) from meeting_roles where meeting_id=$1 and submitted_at is not null)::int as sheets, (select count(*) from evaluations where meeting_id=$1)::int as evals, (select count(*) from peer_feedback where meeting_id=$1)::int as room`, [m.id]);
  if (used.sheets || used.evals || used.room) return bad(res, 'This meeting already has feedback or submitted sheets, so it cannot be removed.');
  await tx(async (t) => {
    await t('delete from meetings where id=$1', [m.id]);
    await t('update meetings set number = -(number - 1) where club_id=$1 and number > $2', [req.person.club_id, m.number]);
    await t('update meetings set number = -number where club_id=$1 and number < 0', [req.person.club_id]);
  });
  res.json({ ok: true, number: m.number });
}));

// wipe what the role players submitted for one meeting (sheets, and the notes, counts, timings, evaluations and role feedback built from them), e.g. after a test run. Room comments are left alone.
app.post('/api/vpe/meetings/:id/reset-feedback', needPerson, needVpe, wrap(async (req, res) => {
  const [m] = await q('select id, number from meetings where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  let sheets = 0;
  await tx(async (t) => {
    sheets = (await t(`select count(*)::int as n from meeting_roles where meeting_id=$1 and (submitted_at is not null or sheet <> '{}'::jsonb)`, [m.id]))[0].n;
    for (const tbl of ['gram_notes', 'filler_counts', 'timings', 'evaluations', 'role_feedback']) await t(`delete from ${tbl} where meeting_id=$1`, [m.id]);
    await t(`update meeting_roles set sheet='{}'::jsonb, submitted_at=null, review_status=null where meeting_id=$1`, [m.id]);
  });
  res.json({ ok: true, number: m.number, sheets });
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
  const roles = await q(`select r.id, r.role_key, r.label, r.position, r.person_id, r.project_id, r.part, r.path_name, r.path_level, r.speech_title, r.target_role_id, r.token, r.submitted_at, r.review_status,
      p.name as person, p.kind as person_kind, p.status as person_status
    from meeting_roles r left join people p on p.id=r.person_id where r.meeting_id=$1 order by r.position`, [m.id]);
  const [next] = await nextMeeting(req.person.club_id);
  const [fc] = await q('select feedback_code from meetings where id=$1', [m.id]);
  const peer = await q('select p.id, p.from_name, p.well, p.improve, p.hidden, t.name as to_name from peer_feedback p join people t on t.id=p.to_person_id where p.meeting_id=$1 order by p.id desc', [m.id]);
  const gefb = await q(`select rf.id, rf.well, rf.improve, tr.label as role, tp.name as to_name from role_feedback rf join meeting_roles tr on tr.id=rf.target_role_id left join people tp on tp.id=tr.person_id where rf.meeting_id=$1 order by tr.position`, [m.id]);
  const exco = await q('select id, from_name, well, improve, hidden from exco_feedback where meeting_id=$1 order by id desc', [m.id]);
  res.json({ exco, meeting: { ...m, feedback_code: fc.feedback_code, status: !next || m.number < next.number ? 'Done' : m.number === next.number ? 'Next' : 'Planned' }, roles, peer, roleFeedback: gefb });
}));
app.patch('/api/vpe/exco/:id', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q('update exco_feedback set hidden=$1 where id=$2 and meeting_id in (select id from meetings where club_id=$3) returning id', [!!req.body.hidden, req.params.id, req.person.club_id]);
  r.length ? res.json({ ok: true }) : bad(res, 'Not found', 404);
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
  const roles = await q(`select r.id, r.meeting_id, r.role_key, r.label, r.position, r.person_id, r.project_id, r.part, r.path_name, r.path_level, r.speech_title, r.target_role_id, r.submitted_at, p.name as person, p.kind as person_kind
    from meeting_roles r join meetings m on m.id=r.meeting_id left join people p on p.id=r.person_id
    where m.club_id=$1 and m.number >= $2 and m.number < $3 order by r.position`, [club, from, from + count]);
  const index = await q(`select number, ${DATE('date')} as date, theme from meetings where club_id=$1 order by number`, [club]);
  res.json({
    from, count, lo, hi, next: next?.number ?? null, has_earlier: from > lo, has_later: from + count - 1 < hi,
    index: index.map((m) => ({ ...m, status: !next || m.number < next.number ? 'Done' : m.number === next.number ? 'Next' : 'Planned' })),
    meetings: meetings.map((m) => ({ ...m, status: !next || m.number < next.number ? 'Done' : m.number === next.number ? 'Next' : 'Planned', roles: roles.filter((r) => r.meeting_id === m.id) })),
  });
}));

// a new speaker or evaluator row at the end of its group on a meeting
const addSlot = (meetingId, key) => tx(async (t) => {
  const same = await t('select id, position from meeting_roles where meeting_id=$1 and role_key=$2 order by position', [meetingId, key]);
  const n = same.length + 1, pos = (same.at(-1)?.position ?? 99) + 1;
  await t('update meeting_roles set position = position + 1 where meeting_id=$1 and position >= $2', [meetingId, pos]);
  const label = key === 'speaker' ? `Speaker ${n}` : `Speech Evaluator ${n}`;
  let target = null;
  if (key === 'evaluator') target = (await t(`select id from meeting_roles where meeting_id=$1 and role_key='speaker' and label=$2`, [meetingId, `Speaker ${n}`]))[0]?.id ?? null;
  const [r] = await t('insert into meeting_roles(meeting_id,role_key,label,position,target_role_id,token) values ($1,$2,$3,$4,$5,$6) returning id, label', [meetingId, key, label, pos, target, token()]);
  if (key === 'speaker') await t(`update meeting_roles set target_role_id=$1 where meeting_id=$2 and role_key='evaluator' and label=$3 and target_role_id is null`, [r.id, meetingId, `Speech Evaluator ${n}`]);
  return r;
});
// add a speaker or evaluator row to a meeting (the roster adds it to every meeting on screen)
app.post('/api/vpe/meetings/:id/roles', needPerson, needVpe, wrap(async (req, res) => {
  const key = req.body?.role_key;
  if (!['speaker', 'evaluator'].includes(key)) return bad(res, 'Only speaker and evaluator rows can be added');
  const [m] = await q('select id from meetings where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!m) return bad(res, 'Not found', 404);
  res.json(await addSlot(m.id, key));
}));
app.delete('/api/vpe/roles/:id', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q(`delete from meeting_roles where id=$1 and role_key in ('speaker','evaluator') and submitted_at is null
    and meeting_id in (select id from meetings where club_id=$2) returning id`, [req.params.id, req.person.club_id]);
  r.length ? res.json({ ok: true }) : bad(res, 'Only a speaker or evaluator row that has not submitted yet can be removed', 400);
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
  await syncCredentials(req.person.club_id);
  const ctx = await loadContext(req.params.id, req.person.club_id);
  if (!ctx) { bad(res, 'Not found', 404); return null; }
  const def = defaultAgenda(ctx, startOverride ?? ctx.m.agenda?.start);
  return { ctx, def, merged: mergeAgenda(def, ctx.m.agenda || {}) };
}
const agendaBody = async (a) => ({
  meeting: { id: a.ctx.m.id, number: a.ctx.m.number, date: a.ctx.m.date, theme: a.ctx.m.theme, theme_quote: a.ctx.m.theme_quote, theme_quote_by: a.ctx.m.theme_quote_by, word: a.ctx.m.word },
  agenda: a.merged, edited: Object.keys(a.ctx.m.agenda || {}).length > 0, standard: Object.keys(a.ctx.standard || {}).length > 0,
  extras: EXTRAS, catalog: STD_BLOCKS, fits: await agendaFits(a.merged, a.ctx),
});
app.get('/api/vpe/meetings/:id/agenda', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res); if (!a) return;
  res.json(await agendaBody(a));
}));
app.put('/api/vpe/meetings/:id/agenda', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res, req.body?.start); if (!a) return;
  const saved = diffAgenda(a.def, req.body || {});
  await q('update meetings set agenda=$1 where id=$2', [JSON.stringify(saved), req.params.id]);
  a.ctx.m.agenda = saved; a.merged = mergeAgenda(a.def, saved);
  res.json({ ok: true, agenda: a.merged, fits: await agendaFits(a.merged, a.ctx) });
}));
app.post('/api/vpe/meetings/:id/agenda/reset', needPerson, needVpe, wrap(async (req, res) => {
  const a = await agendaFor(req, res); if (!a) return;
  let saved = {};
  if (req.body?.what === 'times') {
    saved = JSON.parse(JSON.stringify(a.ctx.m.agenda || {}));
    if (saved.blocks) saved.blocks = saved.blocks.map(({ at, ...r }) => r);
  }
  await q('update meetings set agenda=$1 where id=$2', [JSON.stringify(saved), req.params.id]);
  const a2 = await agendaFor(req, res);
  res.json(await agendaBody(a2));
}));
/* the club standard: the running order, lengths and chairperson every new agenda starts from */
app.put('/api/vpe/agenda-standard', needPerson, needVpe, wrap(async (req, res) => {
  await q('update clubs set agenda_default=$1 where id=$2', [JSON.stringify(pickConfig(req.body || {})), req.person.club_id]);
  res.json({ ok: true });
}));
app.delete('/api/vpe/agenda-standard', needPerson, needVpe, wrap(async (req, res) => {
  await q('update clubs set agenda_default=null where id=$1', [req.person.club_id]);
  res.json({ ok: true });
}));
const fileDate = (d) => { const x = new Date(d + 'T12:00:00'); return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getFullYear()).slice(-2)}`; };
const sendAgenda = (ext) => async (req, res) => {
  const a = await agendaFor(req, res); if (!a) return;
  const pdf = ext === 'pdf';
  // a club that uploaded its own Word agenda gets that file filled in; others get the standard page
  const [own] = pdf ? [] : await q('select agenda_template from clubs where id=$1', [req.person.club_id]);
  const buf = pdf ? await renderAgendaPdf(a.merged, a.ctx) : own?.agenda_template ? (await fillDocx(Buffer.from(own.agenda_template), a.merged, a.ctx)).buffer : await buildDocx(a.merged, a.ctx);
  const [club] = await q('select name from clubs where id=$1', [req.person.club_id]);
  const title = `${String(club?.name || '').replace(/\s+club$/i, '').trim()} Agenda ${fileDate(a.ctx.m.date)}`.trim();
  const plain = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .()-]/g, '').trim() || 'Agenda';
  res.set({ 'Content-Type': pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `${req.query.inline ? 'inline' : 'attachment'}; filename="${plain}.${ext}"; filename*=UTF-8''${encodeURIComponent(title)}.${ext}`, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Cache-Control': 'no-store' });
  res.send(Buffer.from(buf));
};
for (const ext of ['docx', 'pdf']) {
  app.get(`/api/vpe/meetings/:id/agenda.${ext}`, needPerson, needVpe, wrap(sendAgenda(ext)));
  /* a role link can fetch the agenda of its own meeting (Toastmaster and speakers have no sheet, only the agenda) */
  app.get(`/api/role/agenda.${ext}`, needRole, wrap((req, res) => { req.params.id = req.role.meeting_id; req.person = { club_id: req.role.club_id }; return sendAgenda(ext)(req, res); }));
  /* any member or guest can download the agenda of a meeting in their club */
  app.get(`/api/me/meetings/:id/agenda.${ext}`, needPerson, wrap(sendAgenda(ext)));
}
/* ───────── word of the day: fill in the details ───────── */
app.post('/api/vpe/word-details', needPerson, needVpe, wrap(async (req, res) => {
  const { word, theme, quote } = req.body || {};
  if (!validWord(word)) return bad(res, 'Type a single word first');
  try { res.json(await wordDetails({ word, theme: String(theme || '').slice(0, 120), quote: String(quote || '').slice(0, 300) })); }
  catch (e) { bad(res, [404, 502].includes(e.status) ? e.message : 'Could not look that word up just now. Try again, or type the details in.', e.status || 502); }
}));

/* ───────── review: nothing a role player submits reaches the member it is about until the VPE approves it ───────── */
app.post('/api/vpe/roles/:id/review', needPerson, needVpe, wrap(async (req, res) => {
  const to = req.body?.approved === false ? 'pending' : 'approved';
  const r = await q(`update meeting_roles set review_status=$1 where id=$2 and submitted_at is not null and meeting_id in (select id from meetings where club_id=$3) returning id`, [to, req.params.id, req.person.club_id]);
  if (!r.length) return bad(res, 'Not found', 404);
  res.json({ ok: true, review_status: to });
}));
app.post('/api/vpe/meetings/:id/approve-all', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q(`update meeting_roles set review_status='approved' where meeting_id=$1 and review_status='pending' and meeting_id in (select id from meetings where club_id=$2) returning id`, [req.params.id, req.person.club_id]);
  res.json({ ok: true, approved: r.length });
}));

/* ───────── what a role player submitted, for the VPE to read through ───────── */
const submissionHandler = wrap(async (req, res) => {
  const [r] = await q(`select r.id, r.role_key, r.label, r.sheet, r.submitted_at, r.review_status, r.meeting_id, m.club_id, m.number, ${DATE('m.date')} as date, p.name as person
    from meeting_roles r join meetings m on m.id=r.meeting_id left join people p on p.id=r.person_id where r.id=$1 and m.club_id=$2`, [req.params.id, req.person.club_id]);
  if (!r) return bad(res, 'Not found', 404);
  const people = await q('select id, name from people where club_id=$1', [r.club_id]);
  const nm = (id) => people.find((x) => x.id === id)?.name || 'Someone';
  const sheet = r.sheet || {};
  const out = { role: { id: r.id, key: r.role_key, label: r.label, person: r.person, submitted_at: r.submitted_at, review_status: r.review_status, meeting: r.number, date: r.date } };
  if (r.role_key === 'grammarian') out.rows = (await q('select s.name, g.used_word as used, g.word_uses as uses, g.liked, g.improper, g.suggestion from gram_notes g join people s on s.id=g.subject_id where g.role_id=$1 order by g.id', [r.id]));
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

/* the official Toastmasters form for a submitted sheet, filled in, to sit beside what was written (VPE: any sheet in the club; member: their own) */
const sheetReport = (own) => wrap(async (req, res) => {
  const args = [req.params.id, req.person.club_id]; if (own) args.push(req.person.id);
  const [r] = await q(`select r.id, r.role_key, r.label, r.sheet, r.meeting_id, p.name as person from meeting_roles r join meetings m on m.id=r.meeting_id left join people p on p.id=r.person_id
    where r.id=$1 and m.club_id=$2${own ? ' and r.person_id=$3 and r.submitted_at is not null' : ''}`, args);
  if (!r || !hasOfficialReport(r.role_key)) return bad(res, 'Not found', 404);
  const [meeting] = await q(`select id, number, ${DATE('date')} as date, theme, word, meaning, example from meetings where id=$1`, [r.meeting_id]);
  const people = await q('select id,name from people where club_id=$1', [req.person.club_id]);
  const roles = await q('select id, role_key, label, person_id from meeting_roles where meeting_id=$1', [r.meeting_id]);
  const projects = await q('select id, green, yellow, red from projects');
  const [club] = await q('select name from clubs where id=$1', [req.person.club_id]);
  const pdf = await buildRoleReport(r.role_key, { meeting, people, roles, projects, sheet: r.sheet || {}, club: club?.name || '', name: r.person || '' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.label.replace(/\s+/g, '-')}.pdf"` });
  res.send(pdf);
});
app.get('/api/vpe/roles/:id/report.pdf', needPerson, needVpe, sheetReport(false));
app.get('/api/me/given/:id/report.pdf', needPerson, sheetReport(true));

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
  if ('project_id' in b) { next.project_id = b.project_id || null; if (!('part' in b)) next.part = 1; }
  if ('part' in b) next.part = Math.max(1, Math.min(9, parseInt(b.part, 10) || 1));
  if ('path_name' in b) next.path_name = b.path_name || null;
  if ('path_level' in b) next.path_level = b.path_level ?? null;
  if ('project_id' in b && !b.project_id) { next.path_name = 'path_name' in b ? next.path_name : r.path_name; }
  if ('speech_title' in b) next.speech_title = String(b.speech_title || '');
  if ('target_role_id' in b) {
    // an evaluator is paired with a speaker of the same meeting, never with a role of another meeting (or another club)
    if (b.target_role_id) { const [tr] = await q('select id from meeting_roles where id=$1 and meeting_id=$2 and id<>$3', [b.target_role_id, r.meeting_id, r.id]); if (!tr) return bad(res, 'Unknown role'); }
    next.target_role_id = b.target_role_id || null;
  }
  // a speaker slot starts from the member's own path, level and next project, and stays editable
  if (r.role_key === 'speaker' && next.person_id && next.person_id !== r.person_id && !('path_name' in b) && !('project_id' in b)) {
    const [pp] = await q('select * from people where id=$1', [next.person_id]);
    if (pp?.path_name) {
      const pr = await pathProgress(pp), nx = pr.next && pr.next.part_kind !== 'evaluator' ? pr.next : null;
      next.path_name = pp.path_name; next.path_level = pr.current; next.project_id = nx?.id ?? null; next.part = nx?.part ?? 1;
    }
  }
  // an evaluator slot can carry the member's own "serve as an evaluator" part of a project, so submitting it finishes that part
  if (r.role_key === 'evaluator' && next.person_id && next.person_id !== r.person_id && !('project_id' in b)) {
    const [pp] = await q('select * from people where id=$1', [next.person_id]);
    const nx = pp?.path_name ? (await pathProgress(pp)).next : null;
    if (nx?.part_kind === 'evaluator') { next.project_id = nx.id; next.part = nx.part; next.path_name = pp.path_name; next.path_level = nx.level; }
    else if (r.project_id && !('project_id' in b)) { next.project_id = null; next.part = 1; }
  }
  // a speech slot takes a speech part, an evaluator slot only the evaluator part of a project
  if (next.project_id && (r.role_key === 'speaker' || r.role_key === 'evaluator')) {
    const [pj] = await q('select parts from projects where id=$1', [next.project_id]);
    if (!pj) return bad(res, 'Unknown project');
    const kind = (pj.parts || [])[(next.part || 1) - 1]?.kind || 'speech';
    if (r.role_key === 'speaker' && kind === 'evaluator') return bad(res, 'That part is given from an evaluator slot, not a speech slot');
    if (r.role_key === 'evaluator' && kind !== 'evaluator') return bad(res, 'An evaluator slot only carries the evaluator part of a project');
  }
  // a new person gets a fresh link, so the previous person's link stops working
  const tk = next.person_id !== r.person_id ? token() : r.token;
  await q('update meeting_roles set person_id=$1, project_id=$2, speech_title=$3, target_role_id=$4, token=$5, path_name=$6, path_level=$7, part=$9 where id=$8',
    [next.person_id, next.project_id, next.speech_title, next.target_role_id, tk, next.path_name ?? null, next.path_level ?? null, r.id, next.project_id ? next.part ?? 1 : 1]);
  // a role put on the roster counts towards the member's level requirements, and one taken off stops counting
  if (r.role_key !== 'speaker' && next.person_id !== r.person_id) await syncEnh(r, next.person_id);
  // what the VPE sets on a speaker slot is remembered for next time
  if (r.role_key === 'speaker' && next.person_id && ('path_name' in b || 'path_level' in b) && next.path_name) await q('update people set path_name=$1, path_level=$2 where id=$3', [next.path_name, next.path_level ?? null, next.person_id]);
  res.json({ ok: true, token: tk, path_name: next.path_name ?? null, path_level: next.path_level ?? null, project_id: next.project_id, part: next.project_id ? next.part ?? 1 : 1 });
}));
app.post('/api/vpe/roles/:id/regenerate', needPerson, needVpe, wrap(async (req, res) => {
  const tk = token();
  const r = await q('update meeting_roles set token=$1 where id=$2 and meeting_id in (select id from meetings where club_id=$3) returning id', [tk, req.params.id, req.person.club_id]);
  r.length ? res.json({ token: tk }) : bad(res, 'Not found', 404);
}));

/* Where a member is on their path: the catalog level by level, what is finished (marked by the VPE, or an evaluated
   speech), the level they are on and the project to give them next. */
/** the two letters Toastmasters uses for each path: Presentation Mastery is PM, so a finished Level 3 reads PM3 */
const PATH_CODES = { 'Dynamic Leadership': 'DL', 'Engaging Humor': 'EH', 'Motivational Strategies': 'MS', 'Persuasive Influence': 'PI', 'Presentation Mastery': 'PM', 'Visionary Communication': 'VC',
  'Effective Coaching': 'EC', 'Innovative Planning': 'IP', 'Leadership Development': 'LD', 'Strategic Relationships': 'SR', 'Team Collaboration': 'TC' };
const isPathCode = (c) => /^[A-Z]{2}[1-5]$/.test(c || '');
/** keep the agenda title in step with the last completed level, for a member whose title the VPE has not typed in */
async function syncCredentials(club) {
  for (const p of await q(`select * from people where club_id=$1 and kind='member' and path_name is not null and credential_manual=false`, [club])) await pathProgress(p);
}
async function pathProgress(person) {
  const path = person.path_name;
  if (!path) return { path: null, levels: [], current: null, next: null, level_complete: false };
  const rows = await q(`select pp.level, pp.level_title, pp.kind, pp.pos, pp.choose, p.id, p.name, p.length_text, p.parts
    from path_projects pp join projects p on p.id=pp.project_id where pp.path=$1 order by pp.level, pp.pos`, [path]);
  // finished: an evaluated speech, a part the VPE marked finished, or an evaluator slot served (the "evaluator" part). Keyed project:part.
  const K = (pid, part) => `${pid}:${part || 1}`;
  const done = new Map();
  for (const e of await q(`select e.project_id, e.part, ${DATE('m.date')} as date, m.number from evaluations e join meetings m on m.id=e.meeting_id where e.speaker_id=$1 order by m.date`, [person.id])) if (!done.has(K(e.project_id, e.part))) done.set(K(e.project_id, e.part), { date: e.date, source: 'evaluation', meeting: e.number });
  for (const m of await q(`select project_id, part, ${DATE('done_at')} as date, venue from member_projects where person_id=$1`, [person.id])) if (!done.has(K(m.project_id, m.part))) done.set(K(m.project_id, m.part), { date: m.date, source: 'manual', venue: m.venue });
  for (const e of await q(`select r.project_id, r.part, ${DATE('m.date')} as date, m.number from meeting_roles r join meetings m on m.id=r.meeting_id where r.person_id=$1 and r.role_key='evaluator' and r.project_id is not null and r.submitted_at is not null`, [person.id])) if (!done.has(K(e.project_id, e.part))) done.set(K(e.project_id, e.part), { date: e.date, source: 'evaluation', meeting: e.number });
  const picked = new Set((await q('select project_id from member_electives where person_id=$1', [person.id])).map((x) => x.project_id));
  // when each part is scheduled: a slot on a coming meeting, or a speech the member planned (here or elsewhere)
  const sched = new Map();
  const when = [
    ...(await q(`select r.project_id, r.part, ${DATE('m.date')} as date, '' as venue, null::int as plan, r.id as role from meeting_roles r join meetings m on m.id=r.meeting_id where r.person_id=$1 and r.project_id is not null`, [person.id])),
    ...(await q(`select project_id, part, ${DATE('date')} as date, venue, id as plan, null::int as role from speech_plans where person_id=$1 and project_id is not null and not done`, [person.id])),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const now = new Date().toISOString().slice(0, 10);
  for (const w of when.filter((x) => x.date >= now)) if (!sched.has(K(w.project_id, w.part))) sched.set(K(w.project_id, w.part), { date: w.date, venue: w.venue, plan: w.plan, role: w.role });
  for (const w of when.filter((x) => x.date < now).reverse()) if (!sched.has(K(w.project_id, w.part))) sched.set(K(w.project_id, w.part), { date: w.date, venue: w.venue, plan: w.plan, role: w.role });
  const prior = new Map((await q(`select level, ${DATE('done_on')} as d from member_levels where person_id=$1 and path=$2`, [person.id, path])).map((x) => [x.level, x.d]));
  // roles and Education Series presentations, by level. One that is linked to a roster slot counts as done once that slot has submitted.
  const enhRows = appliesTo(path) ? await q(`select e.id, e.level, e.kind, e.item, ${DATE('e.date')} as date, e.venue, e.role_id, (e.done or r.submitted_at is not null) as done
    from member_enh e left join meeting_roles r on r.id=e.role_id where e.person_id=$1 order by e.date, e.id`, [person.id]) : [];
  const levels = [];
  for (const r of rows) {
    let lv = levels.find((x) => x.level === r.level); if (!lv) levels.push(lv = { level: r.level, title: r.level_title, choose: r.choose, all: [] });
    // a project is its parts: one for most, two or three for the rest. It is finished when every part is, and scheduled when every part left is.
    const defs = (r.parts || []).length ? r.parts : [{ n: 1, label: '', kind: 'speech' }];
    const pts = defs.map((d) => ({ n: d.n, label: d.label, kind: d.kind, length: d.length_text || r.length_text, done: done.get(K(r.id, d.n)) || null, sched: sched.get(K(r.id, d.n)) || null }));
    const left = pts.filter((x) => !x.done), last = (xs) => xs.filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1) || xs.at(-1);
    const doneAll = !left.length ? (pts.length === 1 ? pts[0].done : { ...last(pts.map((x) => x.done)), parts: pts.length }) : null;
    const schedAll = left.length && left.every((x) => x.sched) ? (left.length === 1 ? left[0].sched : last(left.map((x) => x.sched))) : null;
    const nextPart = left[0] || null;
    lv.all.push({ id: r.id, name: r.name, kind: r.kind, pos: r.pos, code: r.kind === 'required' ? `L${r.level}P${r.pos}` : '', length: r.length_text, done: doneAll, sched: schedAll, parts: pts.length > 1 ? pts : undefined, next_part: nextPart?.n ?? null, next_part_kind: nextPart?.kind ?? null });
  }
  for (const lv of levels) {
    // a level shows its required projects and only the electives the member has chosen (or already finished), not the whole list
    const req = lv.all.filter((p) => p.kind === 'required'), el = lv.all.filter((p) => p.kind === 'elective');
    const sel = el.filter((p) => p.done || picked.has(p.id));
    lv.prior = prior.has(lv.level);
    // a level finished before Brekkie: its required projects count as done (no dates are known) and no electives are left to pick
    // (or it is dated, when the VPE said it was earned this program year, so it counts towards that year)
    if (lv.prior) { const on = prior.get(lv.level) || null; for (const p of req) { if (!p.done) p.done = { date: on, source: 'prior' }; for (const x of p.parts || []) if (!x.done) x.done = { date: on, source: 'prior' }; } }
    lv.projects = [...req, ...sel];
    lv.options = el.filter((p) => !sel.includes(p)).map((p) => ({ id: p.id, name: p.name, length: p.length }));
    lv.to_pick = lv.prior ? 0 : Math.max(0, (lv.choose || 0) - sel.length);
    lv.required_total = req.length; lv.required_done = req.filter((p) => p.done).length;
    lv.electives_done = lv.prior ? Math.max(el.filter((p) => p.done).length, lv.choose || 0) : el.filter((p) => p.done).length;
    lv.enh = layOver(path, lv.level, enhRows.filter((x) => x.level === lv.level), lv.prior || enhRows.some((x) => x.level === lv.level && x.kind === 'waive'));
    lv.projects_complete = lv.prior || (lv.required_done === lv.required_total && lv.electives_done >= (lv.choose || 0));
    lv.complete = lv.projects_complete && lv.enh.complete;
    delete lv.all;
  }
  const first = levels.find((l) => !l.complete) || levels[levels.length - 1];
  // where they are follows what they have finished: the first level that is not complete. The level the VPE chose only
  // counts before any project is done (a new member who starts partway up the path).
  const started = levels.some((l) => l.projects.some((p) => p.done));
  const current = started ? (levels.find((l) => !l.complete)?.level ?? levels[levels.length - 1]?.level ?? null)
    : levels.some((l) => l.level === person.path_level) ? person.path_level : first?.level ?? null;
  const cl = levels.find((l) => l.level === current);
  let next = null;
  if (cl) {
    const n = cl.projects.find((p) => p.kind === 'required' && !p.done) || (cl.electives_done < (cl.choose || 0) ? cl.projects.find((p) => p.kind === 'elective' && !p.done) : null);
    if (n) next = { id: n.id, name: n.name, code: n.code, kind: n.kind, level: cl.level, part: n.next_part || 1, part_kind: n.next_part_kind || 'speech', parts: n.parts?.length || 1 };
  }
  // the agenda title: the path and the highest level finished, or TM before any. Only for a row that says it is automatic.
  if (person.credential_manual === false && person.id) {
    const top = levels.filter((l) => l.complete).map((l) => l.level).sort((a, b) => b - a)[0];
    const want = top && PATH_CODES[path] ? `${PATH_CODES[path]}${top}` : 'TM';
    if (want !== (person.credential || '')) { await q('update people set credential=$1 where id=$2', [want, person.id]); person.credential = want; }
  }
  return { path, levels, current, next, level_complete: !!cl?.complete, has_next_level: levels.some((l) => l.level > current) };
}
app.post('/api/vpe/people/:id/electives', needPerson, needVpe, wrap(async (req, res) => {
  const [p] = await q('select * from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!p) return bad(res, 'Not found', 404);
  const pid = Number(req.body.project_id);
  const [pp] = await q(`select level, choose from path_projects where path=$1 and project_id=$2 and kind='elective'`, [p.path_name, pid]);
  if (!pp) return bad(res, 'That is not an elective on their path');
  if (req.body.on === false) {
    const [done] = await q('select 1 as x from evaluations where speaker_id=$1 and project_id=$2 union select 1 from member_projects where person_id=$1 and project_id=$2', [p.id, pid]);
    if (done) return bad(res, 'That elective is already finished, so it stays', 409);
    await q('delete from member_electives where person_id=$1 and project_id=$2', [p.id, pid]);
  } else {
    const cur = (await pathProgress(p)).levels.find((l) => l.level === pp.level);
    if (cur && cur.to_pick < 1) return bad(res, `They already have ${pp.choose} electives for this level. Remove one first.`, 409);
    await q('insert into member_electives(person_id, project_id) values ($1,$2) on conflict do nothing', [p.id, pid]);
  }
  res.json(await pathProgress(p));
}));
app.get('/api/vpe/people/:id/path', needPerson, needVpe, wrap(async (req, res) => {
  const [p] = await q('select * from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!p) return bad(res, 'Not found', 404);
  res.json(await pathProgress(p));
}));
app.get('/api/me/path', needPerson, wrap(async (req, res) => res.json(await pathProgress(req.person))));

/* ───────── roster placement: scheduling someone at this club on a meeting date puts them on that meeting's roster ───────── */
async function placeRole(clubId, personId, date, key) {
  const [m] = await q('select id, number from meetings where club_id=$1 and date=$2', [clubId, date]);
  if (!m) return { status: 'no_meeting' };
  const rows = await q(`select r.id, r.label, r.person_id, p.name as by from meeting_roles r left join people p on p.id=r.person_id where r.meeting_id=$1 and r.role_key=$2 order by r.position`, [m.id, key]);
  const mine = rows.find((r) => r.person_id === personId);
  if (mine) return { status: 'placed', role_id: mine.id, label: mine.label, meeting: m.number };
  let free = rows.find((r) => !r.person_id);
  if (!free && key === 'evaluator') free = await addSlot(m.id, 'evaluator');
  if (!free) return { status: 'taken', label: rows[0]?.label, by: rows[0]?.by, meeting: m.number };
  await q('update meeting_roles set person_id=$1, token=$2 where id=$3', [personId, token(), free.id]);
  return { status: 'placed', role_id: free.id, label: free.label, meeting: m.number };
}
/** a speech at this club on a meeting date takes a free speaker slot (one is added when all are taken) */
async function placeSpeech(club, person, date, { project_id, part, title }) {
  const [m] = await q('select id, number from meetings where club_id=$1 and date=$2', [club, date]);
  if (!m) return null;
  // the "serve as an evaluator" part of a project is given from an evaluator slot, not a speech slot
  let key = 'speaker';
  if (project_id) {
    const [pj] = await q('select parts from projects where id=$1', [project_id]);
    if ((pj?.parts || [])[(part || 1) - 1]?.kind === 'evaluator') key = 'evaluator';
  }
  const rows = await q(`select id, label, person_id, project_id, part from meeting_roles where meeting_id=$1 and role_key=$2 order by position`, [m.id, key]);
  const dup = rows.find((r) => r.person_id === person.id && r.project_id === (project_id || null) && r.part === (part || 1));
  if (dup) return { meeting: m.number, label: dup.label };
  const free = rows.find((r) => !r.person_id) || await addSlot(m.id, key);
  let lvl = null;
  if (project_id && person.path_name) lvl = (await q('select level from path_projects where path=$1 and project_id=$2', [person.path_name, project_id]))[0]?.level ?? null;
  await q('update meeting_roles set person_id=$1, project_id=$2, part=$3, speech_title=$4, path_name=$5, path_level=$6, token=$7 where id=$8',
    [person.id, project_id || null, project_id ? part || 1 : 1, key === 'evaluator' ? '' : title || '', project_id ? person.path_name : null, lvl, token(), free.id]);
  // an evaluator slot also counts towards the level's Evaluator requirement
  if (key === 'evaluator') await syncEnh({ id: free.id, role_key: 'evaluator' }, person.id);
  return { meeting: m.number, label: free.label };
}
/** someone put on (or taken off) a roster role: the plan for the previous person goes, and the new person gets one if their level still asks for the role */
async function syncEnh(role, personId) {
  await q('delete from member_enh where role_id=$1 and not done', [role.id]);
  const item = Object.keys(ROLES).find((k) => ROLES[k].slot === role.role_key);
  if (!personId || !item) return;
  const [p] = await q('select * from people where id=$1', [personId]);
  if (!appliesTo(p?.path_name)) return;
  const prog = await pathProgress(p), lv = prog.levels.find((l) => l.level === prog.current);
  if (!lv?.enh?.applies || lv.enh.waived) return;
  if (!lv.enh.items.some((i) => i.kind === 'role' && i.options.some((o) => o.key === item) && i.entries.length < i.need)) return;
  const [m] = await q(`select ${DATE('m.date')} as d, m.club_id from meetings m join meeting_roles r on r.meeting_id=m.id where r.id=$1`, [role.id]);
  await q('insert into member_enh(club_id, person_id, level, kind, item, date, role_id) values ($1,$2,$3,$4,$5,$6,$7)', [m.club_id, p.id, prog.current, 'role', item, m.d, role.id]);
}
/* the Evaluator requirement and the "serve as an evaluator" part of a project are one thing done once: scheduling, ticking off or undoing either does the other */
async function evalPartOf(p, level, want) {
  const lv = (await pathProgress(p)).levels.find((l) => l.level === level);
  for (const pr of lv?.projects || []) for (const pt of pr.parts || []) {
    if (pt.kind !== 'evaluator') continue;
    if (want === 'open' ? !pt.done && !pt.sched : want === 'notdone' ? !pt.done : pt.done?.source === 'manual') return { project_id: pr.id, part: pt.n };
  }
  return null;
}
/** a project's evaluator part was scheduled elsewhere, marked done or undone: the level's Evaluator requirement follows */
async function pairEnh(p, pid, part, { date, venue = '', done = false, undo = false }) {
  if (!appliesTo(p.path_name)) return;
  const [pj] = await q('select parts from projects where id=$1', [pid]);
  if ((pj?.parts || [])[(part || 1) - 1]?.kind !== 'evaluator') return;
  const [pp] = await q('select level from path_projects where path=$1 and project_id=$2', [p.path_name, pid]);
  if (!pp) return;
  const mine = await q(`select id, done, role_id from member_enh where person_id=$1 and level=$2 and kind='role' and item='evaluator' order by date desc, id desc`, [p.id, pp.level]);
  if (undo) { const e = mine.find((x) => x.done && !x.role_id); if (e) await q('update member_enh set done=false where id=$1', [e.id]); return; }
  const planned = mine.find((x) => !x.done);
  if (planned) { if (done) await q('update member_enh set done=true where id=$1', [planned.id]); return; }
  const lv = (await pathProgress(p)).levels.find((l) => l.level === pp.level);
  if (!lv?.enh?.applies || lv.enh.waived || !lv.enh.items.some((i) => i.kind === 'role' && i.options.some((o) => o.key === 'evaluator') && i.entries.length < i.need)) return;
  await q('insert into member_enh(club_id, person_id, level, kind, item, date, venue, done) values ($1,$2,$3,$4,$5,$6,$7,$8)', [p.club_id, p.id, pp.level, 'role', 'evaluator', date || new Date().toISOString().slice(0, 10), venue, done]);
}
/** the Evaluator requirement was scheduled or ticked off: the level's open evaluator part follows */
async function pairPart(p, level, { date, venue = '', roleId = null, done = false, undo = false, plan = true }) {
  if (undo) {
    const ev = await evalPartOf(p, level, 'manual');
    if (ev) { await q('delete from member_projects where person_id=$1 and project_id=$2 and part=$3', [p.id, ev.project_id, ev.part]); await q('update speech_plans set done=false where person_id=$1 and project_id=$2 and part=$3', [p.id, ev.project_id, ev.part]); }
    return;
  }
  const ev = await evalPartOf(p, level, done ? 'notdone' : 'open');
  if (!ev) return;
  if (done) {
    await q('insert into member_projects(person_id, project_id, part, done_at, venue) values ($1,$2,$3,$4::date,$5) on conflict (person_id, project_id, part) do update set done_at=excluded.done_at', [p.id, ev.project_id, ev.part, date, venue]);
    await q('update speech_plans set done=true where person_id=$1 and project_id=$2 and part=$3', [p.id, ev.project_id, ev.part]);
  } else if (roleId) {
    const [r] = await q('select path_level from path_projects where path=$1 and project_id=$2', [p.path_name, ev.project_id]);
    await q('update meeting_roles set project_id=$1, part=$2, path_name=$3, path_level=$4 where id=$5', [ev.project_id, ev.part, p.path_name, r?.level ?? level, roleId]);
  } else if (plan) await q('insert into speech_plans(club_id, person_id, project_id, title, date, venue, part) values ($1,$2,$3,$4,$5,$6,$7)', [p.club_id, p.id, ev.project_id, '', date, venue, ev.part]);
}
const unplace = (roleId, personId) => (roleId ? q('update meeting_roles set person_id=null, token=$3 where id=$1 and person_id=$2 and submitted_at is null', [roleId, personId, token()]) : null);

/* ───────── Pathways enhancements: roles and Education Series presentations a level asks for ───────── */
async function enhPerson(req, res) {
  const [p] = await q('select * from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!p) { bad(res, 'Not found', 404); return null; }
  if (!appliesTo(p.path_name)) { bad(res, 'Requirements apply to the six current paths only'); return null; }
  return p;
}
/* plan a role or presentation (here or at another club), or record one already done */
app.post('/api/vpe/people/:id/enh', needPerson, needVpe, wrap(async (req, res) => {
  const p = await enhPerson(req, res); if (!p) return;
  const b = req.body || {}, kind = b.kind === 'series' ? 'series' : 'role', level = parseInt(b.level, 10), item = String(b.item || '');
  const venue = String(b.venue || '').trim().slice(0, 80), done = !!b.done;
  if (!LEVELS[level] || !validItem(p.path_name, level, kind, item)) return bad(res, 'That is not one of the requirements for this level');
  const when = cleanDate(b.date) || (done ? new Date().toISOString().slice(0, 10) : null);
  if (!when) return bad(res, 'Choose a date');
  let roster = null;
  if (kind === 'role' && !venue && ROLES[item].slot) roster = await placeRole(p.club_id, p.id, when, ROLES[item].slot);
  const [row] = await q('insert into member_enh(club_id, person_id, level, kind, item, date, venue, done, role_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id', [p.club_id, p.id, level, kind, item, when, venue, done, roster?.role_id || null]);
  if (kind === 'role' && item === 'evaluator') await pairPart(p, level, { date: when, venue, roleId: roster?.role_id || null, done, plan: roster?.status !== 'taken' });
  res.json({ ok: true, id: row.id, roster });
}));
async function enhRow(req, res) {
  const [e] = await q(`select *, ${DATE('date')} as d from member_enh where id=$1 and club_id=$2`, [req.params.id, req.person.club_id]);
  if (!e) bad(res, 'Not found', 404);
  return e;
}
app.patch('/api/vpe/enh/:id', needPerson, needVpe, wrap(async (req, res) => {
  const e = await enhRow(req, res); if (!e) return;
  const b = req.body || {};
  const date = 'date' in b ? cleanDate(b.date) : null; if ('date' in b && !date) return bad(res, 'Choose a date');
  const venue = 'venue' in b ? String(b.venue || '').trim().slice(0, 80) : e.venue;
  let roleId = e.role_id, roster = null;
  if (e.kind === 'role' && ROLES[e.item]?.slot && ('date' in b || 'venue' in b) && !e.done) {
    await unplace(e.role_id, e.person_id); roleId = null;
    if (!venue) { roster = await placeRole(e.club_id, e.person_id, date || e.d, ROLES[e.item].slot); roleId = roster.role_id || null; }
  }
  await q('update member_enh set date=coalesce($2,date), venue=$3, role_id=$4 where id=$1', [e.id, date, venue, roleId]);
  res.json({ ok: true, roster });
}));
app.delete('/api/vpe/enh/:id', needPerson, needVpe, wrap(async (req, res) => {
  const e = await enhRow(req, res); if (!e) return;
  if (!e.done) await unplace(e.role_id, e.person_id);
  await q('delete from member_enh where id=$1', [e.id]);
  res.json({ ok: true });
}));
app.post('/api/vpe/enh/:id/complete', needPerson, needVpe, wrap(async (req, res) => {
  const e = await enhRow(req, res); if (!e) return;
  const on = req.body?.done !== false;
  await q('update member_enh set done=$2 where id=$1', [e.id, on]);
  if (e.kind === 'role' && e.item === 'evaluator') {
    const [p] = await q('select * from people where id=$1', [e.person_id]);
    await pairPart(p, e.level, { date: e.d, venue: e.venue, done: on, undo: !on });
  }
  res.json({ ok: true });
}));
/* a level's requirements were already met before Brekkie: they all count, without listing each one */
app.post('/api/vpe/people/:id/enh/waive', needPerson, needVpe, wrap(async (req, res) => {
  const p = await enhPerson(req, res); if (!p) return;
  const level = parseInt(req.body?.level, 10);
  if (!LEVELS[level]) return bad(res, 'Unknown level');
  await q(`delete from member_enh where person_id=$1 and level=$2 and kind='waive'`, [p.id, level]);
  if (req.body?.on !== false) await q(`insert into member_enh(club_id, person_id, level, kind, done) values ($1,$2,$3,'waive',true)`, [p.club_id, p.id, level]);
  res.json({ ok: true });
}));
/* ───────── Dashboard: the first six DCP goals, a forecast per member, and upcoming speeches ───────── */
const cleanDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);
async function planRows(club, where = '', args = []) {
  return q(`select s.id, s.person_id, p.name as person, s.project_id, pr.name as project, s.title, ${DATE('s.date')} as date, s.venue, s.done,
      pp.level, case when pp.kind='required' then 'L'||pp.level||'P'||pp.pos end as code, p.path_name as path, pr.length_text as length,
      s.part, jsonb_array_length(pr.parts)::int as nparts, pr.parts->(s.part-1)->>'label' as part_label
    from speech_plans s join people p on p.id=s.person_id left join projects pr on pr.id=s.project_id
    left join path_projects pp on pp.project_id=s.project_id and pp.path=p.path_name
    where s.club_id=$1 ${where} order by s.date, s.id`, [club, ...args]);
}
/* planned roles and Education Series presentations, shaped like speeches so the calendar and dashboard can list them */
async function enhRows(club, where = '', args = []) {
  const rows = await q(`select e.id, e.person_id, p.name as person, p.path_name as path, e.level, e.kind, e.item, ${DATE('e.date')} as date, e.venue, (e.done or r.submitted_at is not null) as done
    from member_enh e join people p on p.id=e.person_id left join meeting_roles r on r.id=e.role_id
    where e.club_id=$1 and e.kind<>'waive'
      and not (e.item='evaluator' and exists (select 1 from speech_plans sp join projects pj on pj.id=sp.project_id where sp.person_id=e.person_id and sp.date=e.date and pj.parts->(sp.part-1)->>'kind'='evaluator'))
      ${where} order by e.date, e.id`, [club, ...args]);
  return rows.map((e) => ({ kind: 'enh', key: `e${e.id}`, id: e.id, person_id: e.person_id, person: e.person, project: itemLabel(e.kind, e.item), enh_kind: e.kind, level: e.level, path: e.path, title: '', date: e.date, venue: e.venue, done: e.done }));
}
app.get('/api/vpe/dashboard', needPerson, needVpe, wrap(async (req, res) => {
  const club = req.person.club_id, today = new Date().toISOString().slice(0, 10);
  const cur = programYear(today), curStart = Number(cur.start.slice(0, 4));
  const ys = Number(req.query.year) >= 2000 && Number(req.query.year) <= 2100 ? Number(req.query.year) : curStart;
  const year = { ...programYear(`${ys}-07-01`), current: ys === curStart, days_left: ys === curStart ? cur.days_left : 0 };
  year.elapsed = ys === curStart ? Math.min(1, Math.max(0, 1 - cur.days_left / 365)) : ys < curStart ? 1 : 0;
  const years = [curStart + 1, curStart, curStart - 1].map((y) => ({ value: y, label: `${y}-${String(y + 1).slice(2)}` }));
  const people = await q(`select * from people where club_id=$1 and kind='member' and status='active' order by name`, [club]);
  const roles = await q(`select r.person_id, r.speech_title, ${DATE('m.date')} as date, m.number, pr.name as project from meeting_roles r join meetings m on m.id=r.meeting_id
    left join projects pr on pr.id=r.project_id where m.club_id=$1 and r.role_key='speaker' and r.person_id is not null and m.date >= current_date order by m.date`, [club]);
  const plans = await planRows(club, 'and s.date >= current_date and not s.done');
  const progs = await Promise.all(people.map((p) => pathProgress(p)));
  const members = people.map((p, i) => ({ id: p.id, name: p.name, path: progs[i].path, current: progs[i].current, ...(progs[i].path ? forecastMember(progs[i], { year, today }) : { levels: {} }) }));
  const goals = goalsFrom(members.filter((m) => m.path), year);
  const upcoming = [
    ...roles.map((r) => ({ kind: 'club', person_id: r.person_id, person: people.find((p) => p.id === r.person_id)?.name, project: r.project, title: r.speech_title, date: r.date, venue: '', meeting: r.number })),
    ...plans.map((s) => ({ kind: 'plan', id: s.id, person_id: s.person_id, person: s.person, project: s.project, title: s.title, date: s.date, venue: s.venue })),
    ...(await enhRows(club, 'and e.date >= current_date and not (e.done or r.submitted_at is not null)')),
  ].filter((u) => u.person).sort((a, b) => a.date.localeCompare(b.date));
  const past = await planRows(club, 'and s.date < current_date and not s.done');
  res.json({ today, year, years, goals, members, upcoming, past });
}));
/* everything dated in a range: meetings, speaker slots on them, and speeches planned here or at other clubs */
app.get('/api/vpe/calendar', needPerson, needVpe, wrap(async (req, res) => {
  const club = req.person.club_id, from = cleanDate(req.query.from), to = cleanDate(req.query.to);
  if (!from || !to) return bad(res, 'from and to are required');
  const meetings = await q(`select id, number, ${DATE('date')} as date, theme from meetings where club_id=$1 and date between $2 and $3 order by date`, [club, from, to]);
  const roles = await q(`select r.id, r.person_id, p.name as person, r.speech_title as title, r.project_id, pr.name as project, ${DATE('m.date')} as date, m.number, m.id as meeting_id, pr.length_text as length, r.part, jsonb_array_length(pr.parts)::int as nparts, pr.parts->(r.part-1)->>'label' as part_label,
      coalesce(r.path_name, p.path_name) as path, pp.level, case when pp.kind='required' then 'L'||pp.level||'P'||pp.pos end as code,
      (exists (select 1 from evaluations e where e.meeting_id=r.meeting_id and e.speaker_id=r.person_id) or exists (select 1 from member_projects mp where mp.person_id=r.person_id and mp.project_id=r.project_id and mp.part=r.part)) as done
    from meeting_roles r join meetings m on m.id=r.meeting_id join people p on p.id=r.person_id left join projects pr on pr.id=r.project_id
    left join path_projects pp on pp.project_id=r.project_id and pp.path=coalesce(r.path_name, p.path_name)
    where m.club_id=$1 and r.role_key='speaker' and m.date between $2 and $3 order by m.date`, [club, from, to]);
  const plans = await planRows(club, 'and s.date between $2 and $3', [from, to]);
  const pending = [...await planRows(club, 'and s.date < current_date and not s.done'), ...await enhRows(club, 'and e.date < current_date and not (e.done or r.submitted_at is not null)')];
  const enhs = await enhRows(club, 'and e.date between $2 and $3', [from, to]);
  res.json({
    today: new Date().toISOString().slice(0, 10), meetings, pending,
    speeches: [
      ...roles.map((r) => ({ kind: 'club', key: `r${r.id}`, id: r.id, person_id: r.person_id, person: r.person, project_id: r.project_id, project: r.project, code: r.code, level: r.level, path: r.path, length: r.length, title: r.title, date: r.date, venue: '', meeting: r.number, meeting_id: r.meeting_id, done: !!r.done, part: r.part, nparts: r.nparts, part_label: r.part_label })),
      ...enhs,
      ...plans.map((s) => ({ kind: 'plan', key: `p${s.id}`, id: s.id, person_id: s.person_id, person: s.person, project_id: s.project_id, project: s.project, code: s.code, level: s.level, path: s.path, length: s.length, title: s.title, date: s.date, venue: s.venue, done: s.done, part: s.part, nparts: s.nparts, part_label: s.part_label })),
    ],
  });
}));
app.get('/api/me/plans', needPerson, wrap(async (req, res) => res.json(await planRows(req.person.club_id, 'and s.person_id=$2 and not s.done and s.date >= current_date - 30', [req.person.id]))));
async function addPlan(req, res, person) {
  const date = cleanDate(req.body.date); if (!date) return bad(res, 'Choose a date');
  const pid = req.body.project_id ? Number(req.body.project_id) : null;
  if (pid && !(await q('select 1 as x from projects where id=$1', [pid])).length) return bad(res, 'Unknown project');
  const venue = String(req.body.venue || '').trim().slice(0, 80), title = String(req.body.title || '').trim().slice(0, 120);
  // an elective they have not picked yet becomes one of their electives, as long as the level still has room for it
  if (pid && person.path_name) {
    const [el] = await q(`select level, choose from path_projects where path=$1 and project_id=$2 and kind='elective'`, [person.path_name, pid]);
    const [have] = el ? await q('select 1 as x from member_electives where person_id=$1 and project_id=$2', [person.id, pid]) : [];
    if (el && !have) {
      const lv = (await pathProgress(person)).levels.find((l) => l.level === el.level);
      if (lv && !lv.projects.some((x) => x.id === pid) && lv.to_pick < 1) return bad(res, `They already have ${el.choose} electives for Level ${el.level}. Pick one of those, or remove one first.`, 409);
      await q('insert into member_electives(person_id, project_id) values ($1,$2) on conflict do nothing', [person.id, pid]);
    }
  }
  const part = Math.max(1, Math.min(9, parseInt(req.body.part, 10) || 1));
  // at this club on a meeting date: they go on that meeting's roster as a speaker, and the slot is the schedule
  if (!venue) {
    const roster = await placeSpeech(person.club_id, person, date, { project_id: pid, part, title });
    if (roster) return res.json({ ok: true, roster });
  }
  await q('insert into speech_plans(club_id, person_id, project_id, title, date, venue, part) values ($1,$2,$3,$4,$5,$6,$7)', [person.club_id, person.id, pid, title, date, venue, pid ? part : 1]);
  if (pid) await pairEnh(person, pid, part, { date, venue });
  res.json({ ok: true });
}
app.post('/api/me/plans', needPerson, needVpe, wrap(async (req, res) => addPlan(req, res, req.person)));
app.post('/api/vpe/people/:id/plans', needPerson, needVpe, wrap(async (req, res) => {
  const [p] = await q('select * from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  p ? addPlan(req, res, p) : bad(res, 'Not found', 404);
}));
app.delete('/api/me/plans/:id', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q(`delete from speech_plans where id=$1 and club_id=$2 and (person_id=$3 or $4) returning id`, [req.params.id, req.person.club_id, req.person.id, !!req.person.is_vpe]);
  r.length ? res.json({ ok: true }) : bad(res, 'Not found', 404);
}));
/* change a planned speech: any of date, project, title, venue. A VPE can change anyone's, a member their own. */
app.patch('/api/me/plans/:id', needPerson, needVpe, wrap(async (req, res) => {
  const [s] = await q('select * from speech_plans where id=$1 and club_id=$2 and (person_id=$3 or $4)', [req.params.id, req.person.club_id, req.person.id, !!req.person.is_vpe]);
  if (!s) return bad(res, 'Not found', 404);
  if (s.done) return bad(res, 'Undo done before changing this speech');
  const b = req.body || {};
  const date = 'date' in b ? cleanDate(b.date) : null; if ('date' in b && !date) return bad(res, 'Choose a date');
  let pid = s.project_id;
  if ('project_id' in b) {
    pid = b.project_id ? Number(b.project_id) : null;
    if (pid && !(await q('select 1 as x from projects where id=$1', [pid])).length) return bad(res, 'Unknown project');
  }
  const venue = 'venue' in b ? String(b.venue || '').trim().slice(0, 80) : s.venue;
  const title = 'title' in b ? String(b.title || '').trim().slice(0, 120) : s.title;
  const part = 'part' in b ? Math.max(1, Math.min(9, parseInt(b.part, 10) || 1)) : ('project_id' in b ? 1 : s.part);
  await q('update speech_plans set date=coalesce($2,date), project_id=$3, venue=$4, title=$5, part=$6 where id=$1', [s.id, date, pid, venue, title, pid ? part : 1]);
  // moved to a meeting date at this club: they go on that meeting's roster, and the slot replaces the plan
  if (!venue) {
    const [pp] = await q('select * from people where id=$1', [s.person_id]);
    const on = date || (await q(`select ${DATE('date')} as d from speech_plans where id=$1`, [s.id]))[0].d;
    const roster = await placeSpeech(s.club_id, pp, on, { project_id: pid, part: pid ? part : 1, title });
    if (roster) { await q('delete from speech_plans where id=$1', [s.id]); return res.json({ ok: true, roster }); }
  }
  res.json({ ok: true });
}));
/* a planned speech that has happened: the project is marked done on its date, and the plan goes away */
app.post('/api/vpe/plans/:id/complete', needPerson, needVpe, wrap(async (req, res) => {
  const [s] = await q(`select s.*, ${DATE('s.date')} as d from speech_plans s where s.id=$1 and s.club_id=$2`, [req.params.id, req.person.club_id]);
  if (!s) return bad(res, 'Not found', 404);
  const [p] = await q('select * from people where id=$1', [s.person_id]);
  const nx = s.project_id ? null : (await pathProgress(p)).next, pid = s.project_id || nx?.id, part = s.project_id ? s.part : nx?.part || 1;
  if (pid) await q('insert into member_projects(person_id, project_id, part, done_at) values ($1,$2,$3,$4::date) on conflict (person_id, project_id, part) do update set done_at=excluded.done_at', [p.id, pid, part, s.d]);
  await q('update speech_plans set done=true where id=$1', [s.id]);
  if (pid) await pairEnh(p, pid, part, { date: s.d, venue: s.venue, done: true });
  res.json({ ok: true, marked: !!pid });
}));

app.post('/api/vpe/people/:id/projects', needPerson, needVpe, wrap(async (req, res) => {
  const [p] = await q('select * from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!p) return bad(res, 'Not found', 404);
  const pid = Number(req.body.project_id);
  const [proj] = await q('select id, parts from projects where id=$1', [pid]);
  if (!proj) return bad(res, 'Unknown project');
  // a whole project, or one part of it ({ part: 2 }); without a part every part is marked
  const all = Array.from({ length: Math.max(1, (proj.parts || []).length) }, (_, i) => i + 1);
  const only = Number.isInteger(+req.body.part) && +req.body.part >= 1 ? [Math.min(+req.body.part, all.length)] : all;
  if (req.body.done === false) {
    const [ev] = await q('select 1 as x from evaluations where speaker_id=$1 and project_id=$2 and part = any($3)', [p.id, pid, only]);
    if (ev) return bad(res, 'This one was delivered and evaluated at a meeting, so it stays done', 409);
    await q('delete from member_projects where person_id=$1 and project_id=$2 and part = any($3)', [p.id, pid, only]);
    await q('update speech_plans set done=false where person_id=$1 and project_id=$2 and part = any($3)', [p.id, pid, only]);
    for (const part of only) await pairEnh(p, pid, part, { undo: true });
  } else {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : null;
    // a speech given at another club keeps the club's name: from the plan that was scheduled, or typed in when marking it done
    const [pl] = await q('select venue from speech_plans where person_id=$1 and project_id=$2 order by date limit 1', [p.id, pid]);
    const venue = String(req.body.venue ?? pl?.venue ?? '').trim().slice(0, 80);
    for (const part of only) await q('insert into member_projects(person_id, project_id, part, done_at, venue) values ($1,$2,$3,coalesce($4::date, current_date),$5) on conflict (person_id, project_id, part) do update set done_at=excluded.done_at, venue=excluded.venue', [p.id, pid, part, d, venue]);
    await q('update speech_plans set done=true where person_id=$1 and project_id=$2 and part = any($3)', [p.id, pid, only]);
    for (const part of only) await pairEnh(p, pid, part, { date: d, venue, done: true });
  }
  res.json(await pathProgress(p));
}));

app.get('/api/vpe/people', needPerson, needVpe, wrap(async (req, res) => {
  const club = req.person.club_id;
  await syncCredentials(club);
  const people = await q(`select id,name,email,credential,credential_manual,path_name,path_level,join_requested_at,kind,status,is_vpe,is_tm,case when kind='guest' then token end as token,phone,(password_hash is not null) as has_pw,invited_at,last_login_at,created_via,${DATE('temp_until')} as temp_until, ${DATE('created_at')} as added from people where club_id=$1 order by name`, [club]);
  // plain counts that can be checked by hand
  const counts = async (sql) => Object.fromEntries((await q(sql, [club])).map((r) => [r.pid, r.n]));
  const speeches = await counts(`select e.speaker_id as pid, count(*)::int as n from evaluations e join meetings m on m.id=e.meeting_id where m.club_id=$1 group by e.speaker_id`);
  const assigned = await counts(`select r.person_id as pid, count(*)::int as n from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=$1 and r.person_id is not null group by r.person_id`);
  const done = await counts(`select r.person_id as pid, count(*)::int as n from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=$1 and r.person_id is not null and m.date < current_date group by r.person_id`);
  const given = await counts(`select r.person_id as pid, count(*)::int as n from meeting_roles r join meetings m on m.id=r.meeting_id where m.club_id=$1 and r.person_id is not null and r.submitted_at is not null group by r.person_id`);
  // levels logged as finished this program year, so the edit form can show them
  const ys = programYear(new Date().toISOString().slice(0, 10)).start;
  const levelsYear = Object.fromEntries((await q(`select ml.person_id as pid, count(*)::int as n from member_levels ml join people p on p.id=ml.person_id where p.club_id=$1 and ml.done_on >= $2::date group by ml.person_id`, [club, ys])).map((r) => [r.pid, r.n]));
  const levelsLogged = Object.fromEntries((await q(`select ml.person_id as pid, count(*)::int as n from member_levels ml join people p on p.id=ml.person_id where p.club_id=$1 group by ml.person_id`, [club])).map((r) => [r.pid, r.n]));
  res.json(people.map((p) => ({ ...p, levels_this_year: levelsYear[p.id] || 0, levels_done: levelsLogged[p.id] || 0, acct: p.has_pw ? 'active' : p.invited_at ? 'invited' : 'none', roles_played: assigned[p.id] || 0, speeches: speeches[p.id] || 0, roles_done: done[p.id] || 0, feedback_given: given[p.id] || 0 })));
}));
app.post('/api/vpe/people', needPerson, needVpe, wrap(async (req, res) => {
  const { name, email, kind } = req.body, cred = String(req.body.credential || '').trim().slice(0, 20), phone = String(req.body.phone || '').trim().slice(0, 30) || null;
  if (kind === 'guest') { const g = await guestFor(req.person.club_id, name, email, 'vpe'); if (!g) return bad(res, 'Enter a name'); if (cred) await q('update people set credential=$1 where id=$2', [cred, g.id]); if (phone) await q('update people set phone=$1 where id=$2', [phone, g.id]); return res.json(g); }
  const clean = String(name || '').trim();
  if (clean.length < 2) return bad(res, 'Enter a name');
  const [p] = await q(`insert into people(club_id,name,email,kind,status,token,created_via,credential,phone) values ($1,$2,$3,'member','active',$4,'vpe',$5,$6) returning *`, [req.person.club_id, clean, email || null, token(), cred, phone]);
  if (cred) await q('update people set credential_manual=$2 where id=$1', [p.id, !isPathCode(cred) && cred !== 'TM']);
  if (req.body.path_name) await upsertMember(q, req.person.club_id, { name: clean, email, path_name: req.body.path_name, levels_done: req.body.levels_done, levels_this_year: req.body.levels_this_year });
  res.json(pub(p));
}));
/* which rows of a file are already in the club (by email, then name), with what Brekkie holds for them, so the VPE can choose to update */
app.post('/api/vpe/people/import/match', needPerson, needVpe, wrap(async (req, res) => {
  const club = req.person.club_id, ys = programYear(new Date().toISOString().slice(0, 10)).start;
  const out = [];
  for (const m of (Array.isArray(req.body.members) ? req.body.members : []).slice(0, 300)) {
    const name = String(m.name || '').trim().replace(/\s+/g, ' '), email = normEmail(m.email);
    let [p] = email ? await q('select * from people where club_id=$1 and lower(email)=$2', [club, email]) : [];
    if (!p) [p] = await q(`select * from people where club_id=$1 and lower(name)=lower($2) and kind='member' and status<>'inactive'`, [club, name]);
    if (!p) { out.push(null); continue; }
    const [lv] = await q('select count(*)::int as n, count(*) filter (where done_on >= $2::date)::int as y from member_levels where person_id=$1', [p.id, ys]);
    out.push({ id: p.id, name: p.name, phone: p.phone, credential: p.credential, path_name: p.path_name, path_level: p.path_level, levels_done: lv.n, levels_this_year: lv.y });
  }
  res.json(out);
}));
/* the roster, in one go: from the Toastmasters Club Central export, with each member's path and finished levels */
app.post('/api/vpe/people/import', needPerson, needVpe, wrap(async (req, res) => {
  let added = 0, updated = 0; const skipped = [];
  for (const m of (Array.isArray(req.body.members) ? req.body.members : []).slice(0, 300)) {
    const r = await upsertMember(q, req.person.club_id, m);
    if (r.skipped) skipped.push(`${r.name || 'A row'}: ${r.skipped}`); else r.made ? added++ : updated++;
  }
  res.json({ added, updated, skipped });
}));
app.patch('/api/vpe/people/:id', needPerson, needVpe, wrap(async (req, res) => {
  const [p] = await q('select * from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]);
  if (!p) return bad(res, 'Not found', 404);
  const b = req.body;
  let { name, email, kind, status, credential, phone } = p;
  if ('phone' in b) phone = String(b.phone || '').trim().slice(0, 30) || null;
  let manual = p.credential_manual;
  // typing a title of their own keeps it; clearing it hands it back to the last completed level. Re-sending what is already there changes nothing.
  if ('credential' in b) { credential = String(b.credential || '').trim().slice(0, 20); if (credential !== (p.credential || '')) manual = credential !== ''; }
  if (typeof b.name === 'string' && b.name.trim().length > 1) name = b.name.trim();
  if ('email' in b) {
    const e = normEmail(b.email);
    if (e && !validEmail(e)) return bad(res, 'Enter a valid email address');
    if (e) { const [dup] = await q('select 1 as x from people where club_id=$1 and lower(email)=$2 and id<>$3', [req.person.club_id, e, p.id]); if (dup) return bad(res, 'Someone in the club already uses that email', 409); }
    email = e || null;
  }
  if ('path_name' in b) await q('update people set path_name=$1, path_level=$2 where id=$3', [b.path_name || null, b.path_name ? (Number(b.path_level) || null) : null, p.id]);
  if ('levels_done' in b && (b.path_name || p.path_name)) await setLevelsDone(q, p.id, b.path_name || p.path_name, b.levels_done, b.levels_this_year);
  if (typeof b.is_tm === 'boolean') await q('update people set is_tm=$1 where id=$2', [b.is_tm, p.id]);
  if (b.convert) { kind = 'member'; status = 'active'; }
  else if (['active', 'temporary', 'inactive'].includes(b.status)) status = b.status === 'active' && kind === 'guest' ? 'temporary' : b.status;
  await q(`update people set name=$1,email=$2,kind=$3,status=$4,credential=$7,phone=$8,credential_manual=$9,join_requested_at = case when $5 then null else join_requested_at end, converted_at = case when $5 then now() else converted_at end, temp_until = case when $5 then null else temp_until end where id=$6`, [name, email, kind, status, !!b.convert, p.id, credential, phone, !!manual]);
  res.json({ ok: true });
}));
app.post('/api/vpe/people/:id/extend', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q(`update people set temp_until = coalesce(temp_until, current_date) + (select coalesce(guest_days, 30) from clubs where id=$2), status='temporary' where id=$1 and club_id=$2 and kind='guest' returning id`, [req.params.id, req.person.club_id]);
  r.length ? res.json({ ok: true }) : bad(res, 'Not found', 404);
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
  await syncCredentials(club);
  const [p] = await q(`select id,name,email,phone,credential,credential_manual,path_name,path_level,kind,status,is_vpe,is_tm,case when kind='guest' then token end as token,(password_hash is not null) as has_pw,invited_at,${DATE('temp_until')} as temp_until from people where id=$1 and club_id=$2`, [req.params.id, club]);
  if (!p) return bad(res, 'Not found', 404);
  const hist = await loadHist(club);
  const projects = hist.evals.filter((e) => e.pid === p.id).reverse().map((e) => ({ id: e.id, title: e.title, project: e.project, path: e.path, level: e.level, date: e.date, number: e.number, by: e.by, work: e.work }));
  const roles = await q(`select r.id, r.label, r.role_key, r.submitted_at, m.id as meeting_id, m.number, ${DATE('m.date')} as date, (m.date >= current_date) as upcoming
    from meeting_roles r join meetings m on m.id=r.meeting_id where r.person_id=$1 order by m.date desc, r.position`, [p.id]);
  const given = await givenFor(p.id);
  const mine = (rows) => rows.filter((r) => r.pid === p.id);
  res.json({
    person: p, journal_count: (await q('select count(*)::int as n from member_notes where person_id=$1', [p.id]))[0].n, projects, roles, given, path: p.kind === 'guest' ? null : await pathProgress(p),
    received: {
      gram: mine(hist.gram).reverse(), fill: mine(hist.fill).reverse(), time: mine(hist.time).reverse(),
      roleFeedback: mine(hist.rolefb).reverse(), peer: mine(hist.peer).reverse(),
    },
  });
}));

/* the VPE's private journal on a member: dated notes from conversations, written in markdown */
const noteRow = (n) => ({ id: n.id, body: n.body, date: n.d, created_at: n.created_at });
const NOTE_COLS = `n.id, n.body, ${DATE('n.noted_on')} as d, n.created_at`;
const ownMember = async (req) => (await q('select id from people where id=$1 and club_id=$2', [req.params.id, req.person.club_id]))[0];
app.get('/api/vpe/people/:id/journal', needPerson, needVpe, wrap(async (req, res) => {
  if (!(await ownMember(req))) return bad(res, 'Not found', 404);
  res.json((await q(`select ${NOTE_COLS} from member_notes n where n.person_id=$1 and n.club_id=$2 order by n.noted_on desc, n.id desc`, [req.params.id, req.person.club_id])).map(noteRow));
}));
const noteFields = (b, cur = {}) => {
  const body = 'body' in b ? String(b.body || '').trim().slice(0, 8000) : cur.body;
  const date = 'date' in b ? b.date : cur.date;
  if (!body) return { error: 'Write a note first' };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Enter a valid date' };
  return { body, date: date || null };
};
app.post('/api/vpe/people/:id/journal', needPerson, needVpe, wrap(async (req, res) => {
  if (!(await ownMember(req))) return bad(res, 'Not found', 404);
  const f = noteFields(req.body); if (f.error) return bad(res, f.error);
  const [n] = await q(`insert into member_notes(club_id, person_id, body, noted_on, created_by) values ($1,$2,$3,coalesce($4::date, current_date),$5) returning id, body, ${DATE('noted_on')} as d, created_at`, [req.person.club_id, req.params.id, f.body, f.date, req.person.id]);
  res.json(noteRow(n));
}));
app.patch('/api/vpe/journal/:id', needPerson, needVpe, wrap(async (req, res) => {
  const [cur] = await q(`select ${NOTE_COLS} from member_notes n where n.id=$1 and n.club_id=$2`, [req.params.id, req.person.club_id]);
  if (!cur) return bad(res, 'Not found', 404);
  const f = noteFields(req.body, { body: cur.body, date: cur.d }); if (f.error) return bad(res, f.error);
  await q('update member_notes set body=$2, noted_on=coalesce($3::date, noted_on), updated_at=now() where id=$1', [cur.id, f.body, f.date]);
  res.json({ ok: true });
}));
app.delete('/api/vpe/journal/:id', needPerson, needVpe, wrap(async (req, res) => {
  const r = await q('delete from member_notes where id=$1 and club_id=$2 returning id', [req.params.id, req.person.club_id]);
  r.length ? res.json({ ok: true }) : bad(res, 'Not found', 404);
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
    if (it.to_exco) { await q('insert into exco_feedback(meeting_id,from_name,well,improve) values ($1,$2,$3,$4)', [m.id, from, well, improve]); n++; continue; }
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
app.use((err, _req, res, _next) => { if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(err.status || 400).json({ error: err.type === 'entity.too.large' ? 'That is too large' : 'That request was not valid JSON' }); if (err.status >= 400 && err.status < 500 && err.expose !== false && err.message) return res.status(err.status).json({ error: err.message }); console.error(err); res.status(500).json({ error: 'Something went wrong' }); });

// Start-up work (schema, pathways, demo data). A hosted function waits on `ready` before it answers.
// A failed start (a dropped connection, say) is not remembered: the next request tries again instead of
// leaving a warm function broken until it is recycled.
let booting = null;
const boot = () => (booting ||= startUp().catch((e) => { booting = null; throw e; }));
async function startUp() {
  const kind = await initDb();
  await ensurePathways();
  await applyFormText();
  for (const c of await q('select id from clubs where join_code is null')) await q('update clubs set join_code=$1 where id=$2', [joinCode(), c.id]);
  if (DEMO && (await seedIfEmpty())) console.log('Empty database: loaded demo data for Champions Toastmasters Club.');
  return kind;
}
export const ready = boot();
ready.catch((e) => console.error('Start-up failed, will retry on the next request:', e.message));
export default app;

// On a normal server, listen. On Vercel the function in api/index.js handles requests instead.
if (!process.env.VERCEL) {
  const kind = await ready;
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`Brekkie API on http://localhost:${port} (${kind})`));
}
