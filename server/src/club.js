// Clubs: the meeting pattern (when a club meets), creating meetings from it, join codes and passwords.
import crypto from 'node:crypto';

const iso = (d) => d.toISOString().slice(0, 10);
const day = (s) => new Date(s + 'T12:00:00');
export const token = () => crypto.randomBytes(15).toString('base64url');

export const ROLE_DEFS = [
  ['toastmaster', 'Toastmaster of the Day'], ['grammarian', 'Grammarian'], ['ah_counter', 'Ah Counter'], ['timer', 'Timer'],
  ['topicsmaster', 'Topicsmaster'], ['speaker', 'Speaker 1'], ['speaker', 'Speaker 2'], ['speaker', 'Speaker 3'],
  ['general_evaluator', 'General Evaluator'], ['evaluator', 'Speech Evaluator 1'], ['evaluator', 'Speech Evaluator 2'], ['evaluator', 'Speech Evaluator 3'],
];

/* ───────── the meeting pattern ─────────
   { day: 0-6 (Sunday = 0), mode: 'weekly' | 'fortnightly' | 'monthly', weeks: [1..5] (monthly; 5 means the last one),
     time: 'HH:MM', place: '', start: 'YYYY-MM-DD' (the first meeting; fortnightly counts from it) } */
const MODES = ['weekly', 'fortnightly', 'monthly'];
export function cleanPattern(p = {}) {
  const d = Number.isInteger(+p.day) && +p.day >= 0 && +p.day <= 6 ? +p.day : null;
  if (d === null) return { error: 'Choose the day of the week your club meets' };
  const mode = MODES.includes(p.mode) ? p.mode : null;
  if (!mode) return { error: 'Choose how often your club meets' };
  const weeks = mode === 'monthly' ? [...new Set((Array.isArray(p.weeks) ? p.weeks : []).map(Number).filter((n) => n >= 1 && n <= 5))].sort() : [];
  if (mode === 'monthly' && !weeks.length) return { error: 'Choose which weeks of the month you meet' };
  const start = /^\d{4}-\d{2}-\d{2}$/.test(p.start || '') ? p.start : null;
  if (!start) return { error: 'Choose the date of your first meeting' };
  const time = /^\d{2}:\d{2}$/.test(p.time || '') ? p.time : '';
  return { pattern: { day: d, mode, weeks, time, place: String(p.place || '').trim().slice(0, 120), start } };
}

const isLastOfMonth = (d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n.getMonth() !== d.getMonth(); };
function matches(pat, d) {
  if (d.getDay() !== pat.day) return false;
  if (pat.mode === 'weekly') return true;
  if (pat.mode === 'fortnightly') return Math.round((d - day(pat.start)) / 86400000 / 7) % 2 === 0;
  const nth = Math.ceil(d.getDate() / 7);
  return pat.weeks.includes(nth) || (pat.weeks.includes(5) && isLastOfMonth(d));
}
/** Every meeting date from `from` to `to`, inclusive. */
export function patternDates(pat, from, to) {
  const out = [], end = day(to);
  for (let d = day(from); d <= end; d.setDate(d.getDate() + 1)) if (matches(pat, d)) out.push(iso(d));
  return out;
}
/** The next meeting date strictly after a date (null if the pattern never lands within two years). */
export function nextPatternDate(pat, after) {
  const d = day(after);
  for (let i = 0; i < 800; i++) { d.setDate(d.getDate() + 1); if (matches(pat, d)) return iso(d); }
  return null;
}
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: 'last' };
export function describePattern(p) {
  if (!p) return '';
  const when = p.mode === 'weekly' ? `Every ${NAMES[p.day]}` : p.mode === 'fortnightly' ? `Every other ${NAMES[p.day]}` : `The ${p.weeks.map((w) => ORD[w]).join(' and ')} ${NAMES[p.day]} of each month`;
  return `${when}${p.time ? ` at ${p.time}` : ''}${p.place ? `, ${p.place}` : ''}`;
}

/** Insert one meeting with its twelve role slots. Speech evaluators point at their speaker. */
export async function createMeeting(t, clubId, number, date) {
  const [m] = await t('insert into meetings(club_id,number,date,feedback_code) values ($1,$2,$3,$4) returning id, number', [clubId, number, date, token().slice(0, 10)]);
  for (let i = 0; i < ROLE_DEFS.length; i++) await t('insert into meeting_roles(meeting_id,role_key,label,position,token) values ($1,$2,$3,$4,$5)', [m.id, ROLE_DEFS[i][0], ROLE_DEFS[i][1], i, token()]);
  const roles = await t('select id, label from meeting_roles where meeting_id=$1', [m.id]);
  for (const n of [1, 2, 3]) await t('update meeting_roles set target_role_id=$1 where meeting_id=$2 and label=$3', [roles.find((r) => r.label === `Speaker ${n}`).id, m.id, `Speech Evaluator ${n}`]);
  return m;
}
/** Create the club's meetings for the next `months` months, numbering on from the last one (or from `firstNumber`). */
export async function generateMeetings(t, club, { months = 12, firstNumber = 1 } = {}) {
  const pat = club.pattern; if (!pat) return 0;
  const [last] = await t(`select number, to_char(date,'YYYY-MM-DD') as date from meetings where club_id=$1 order by number desc limit 1`, [club.id]);
  const from = last ? iso(new Date(day(last.date).getTime() + 86400000)) : pat.start;
  const to = new Date(); to.setMonth(to.getMonth() + months);
  let n = last ? last.number + 1 : firstNumber, made = 0;
  for (const date of patternDates(pat, from < pat.start ? pat.start : from, iso(to))) { await createMeeting(t, club.id, n++, date); made++; }
  return made;
}

/* ───────── join codes and passwords ───────── */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
export const joinCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
export const normEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 120);
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`; }
export function checkPw(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(String(pw), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const pwProblem = (pw) => (typeof pw !== 'string' || pw.length < 8 ? 'Use at least 8 characters for your password' : pw.length > 100 ? 'That password is too long' : '');
