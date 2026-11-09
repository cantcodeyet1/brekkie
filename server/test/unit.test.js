import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPattern, patternDates, nextPatternDate, describePattern, hashPw, checkPw, pwProblem, validEmail, normEmail, joinCode, token, ROLE_DEFS } from '../src/club.js';
import { programYear, GOALS } from '../src/dcp.js';
import { clubFridays, buildSchedule, nextClubDate } from '../src/schedule.js';
import { validWord, respell } from '../src/words.js';
import { hasOfficialReport, REPORT_TITLES } from '../src/roleReport.js';

test('cleanPattern accepts a good weekly pattern', () => {
  const r = cleanPattern({ day: 5, mode: 'weekly', start: '2026-07-10', time: '07:00', place: ' Hall ' });
  assert.deepEqual(r.pattern, { day: 5, mode: 'weekly', weeks: [], time: '07:00', place: 'Hall', start: '2026-07-10' });
});
test('cleanPattern rejects missing or bad fields', () => {
  assert.match(cleanPattern({}).error, /day of the week/);
  assert.match(cleanPattern({ day: 9, mode: 'weekly', start: '2026-07-10' }).error, /day of the week/);
  assert.match(cleanPattern({ day: 1, mode: 'daily', start: '2026-07-10' }).error, /how often/);
  assert.match(cleanPattern({ day: 1, mode: 'monthly', weeks: [], start: '2026-07-10' }).error, /weeks/);
  assert.match(cleanPattern({ day: 1, mode: 'weekly', start: 'soon' }).error, /first meeting/);
});
test('cleanPattern dedupes and sorts monthly weeks and drops out-of-range ones', () => {
  const r = cleanPattern({ day: 5, mode: 'monthly', weeks: [4, 2, 2, 9, 0], start: '2026-07-10' });
  assert.deepEqual(r.pattern.weeks, [2, 4]);
});
test('cleanPattern ignores a malformed time', () => {
  assert.equal(cleanPattern({ day: 5, mode: 'weekly', start: '2026-07-10', time: '7am' }).pattern.time, '');
});
test('patternDates: weekly gives every Friday', () => {
  const d = patternDates({ day: 5, mode: 'weekly', weeks: [], start: '2026-07-03' }, '2026-07-01', '2026-07-31');
  assert.deepEqual(d, ['2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31']);
});
test('patternDates: fortnightly counts from the start date', () => {
  const d = patternDates({ day: 5, mode: 'fortnightly', weeks: [], start: '2026-07-03' }, '2026-07-01', '2026-07-31');
  assert.deepEqual(d, ['2026-07-03', '2026-07-17', '2026-07-31']);
});
test('patternDates: monthly 2nd and 4th, and "last" (5)', () => {
  const p = { day: 5, mode: 'monthly', weeks: [2, 4], start: '2026-07-01' };
  assert.deepEqual(patternDates(p, '2026-07-01', '2026-07-31'), ['2026-07-10', '2026-07-24']);
  assert.deepEqual(patternDates({ ...p, weeks: [5] }, '2026-07-01', '2026-07-31'), ['2026-07-31']);
});
test('nextPatternDate is strictly after the date', () => {
  const p = { day: 5, mode: 'weekly', weeks: [], start: '2026-07-03' };
  assert.equal(nextPatternDate(p, '2026-07-10'), '2026-07-17');
  assert.equal(nextPatternDate(p, '2026-07-09'), '2026-07-10');
});
test('describePattern reads naturally', () => {
  assert.equal(describePattern(null), '');
  assert.equal(describePattern({ day: 5, mode: 'weekly', weeks: [], time: '07:00', place: 'Hall' }), 'Every Friday at 07:00, Hall');
  assert.equal(describePattern({ day: 5, mode: 'fortnightly', weeks: [] }), 'Every other Friday');
  assert.match(describePattern({ day: 5, mode: 'monthly', weeks: [2, 5] }), /2nd and last Friday/);
});

test('passwords hash, verify and never store plain text', () => {
  const h = hashPw('hunter22');
  assert.ok(!h.includes('hunter22'));
  assert.equal(checkPw('hunter22', h), true);
  assert.equal(checkPw('hunter23', h), false);
  assert.notEqual(hashPw('hunter22'), h, 'salted');
  assert.equal(checkPw('x', null), false);
  assert.equal(checkPw('x', 'garbage'), false);
});
test('pwProblem enforces length', () => {
  assert.ok(pwProblem('abc'));
  assert.ok(pwProblem(undefined));
  assert.ok(pwProblem('x'.repeat(101)));
  assert.equal(pwProblem('abcdef'), '');
});
test('email helpers', () => {
  assert.equal(normEmail('  Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(normEmail(null), '');
  assert.equal(validEmail('a@b.co'), true);
  for (const e of ['a@b', 'a b@c.com', '@b.com', 'a@.com', '']) assert.equal(validEmail(e), false, e);
});
test('joinCode and token are random and well-formed', () => {
  assert.match(joinCode(), /^[A-Z0-9]{6}$/);
  assert.notEqual(joinCode(), joinCode());
  assert.match(token(), /^[A-Za-z0-9_-]{20}$/);
  assert.notEqual(token(), token());
});
test('ROLE_DEFS has the twelve standard roles', () => {
  assert.equal(ROLE_DEFS.length, 12);
  assert.equal(ROLE_DEFS.filter(([k]) => k === 'speaker').length, 3);
});

test('programYear runs 1 July to 30 June', () => {
  const a = programYear('2026-11-09');
  assert.equal(a.start, '2026-07-01'); assert.equal(a.end, '2027-06-30'); assert.equal(a.label, '2026-27');
  assert.equal(programYear('2027-03-01').start, '2026-07-01');
  assert.equal(programYear('2027-07-01').start, '2027-07-01');
  assert.equal(programYear('2027-06-30').days_left, 0);
  assert.ok(a.days_left > 200);
});
test('DCP goals are numbered 1 to 6', () => assert.deepEqual(GOALS.map((g) => g.n), [1, 2, 3, 4, 5, 6]));

test('clubFridays only returns 2nd and 4th Fridays', () => {
  assert.deepEqual(clubFridays('2026-07-01', '2026-07-31'), ['2026-07-10', '2026-07-24']);
});
test('buildSchedule numbers meetings from 1, ascending, all Fridays', () => {
  const s = buildSchedule();
  assert.equal(s[0].number, 1); assert.equal(s[0].date, '2026-07-10');
  assert.equal(s.find((m) => m.number === 9).date, '2026-11-13');
  for (let i = 1; i < s.length; i++) assert.ok(s[i].date > s[i - 1].date);
  for (const m of s) assert.equal(new Date(m.date + 'T12:00:00').getDay(), 5);
});
test('nextClubDate skips to the next 2nd or 4th Friday', () => {
  assert.equal(nextClubDate('2026-07-10'), '2026-07-24');
  assert.equal(nextClubDate('2026-07-24'), '2026-08-14');
});

test('validWord', () => {
  for (const w of ['assiduous', "o'clock", 'well-known', 'Ab']) assert.equal(validWord(w), true, w);
  for (const w of ['', 'a', '1abc', 'drop table;', null, 'x'.repeat(50)]) assert.equal(validWord(w), false, String(w));
});
test('respell handles empty input', () => { assert.equal(respell(''), ''); assert.equal(respell(null), ''); });
test('respell capitalises the stressed syllable', () => {
  const r = respell('HH AH0 L OW1');
  assert.match(r, /[A-Z]/);
});

test('official report forms exist for the right roles only', () => {
  for (const k of ['grammarian', 'ah_counter', 'timer', 'topicsmaster', 'general_evaluator']) { assert.equal(hasOfficialReport(k), true, k); assert.ok(REPORT_TITLES[k]); }
  for (const k of ['speaker', 'evaluator', 'toastmaster']) assert.equal(hasOfficialReport(k), false, k);
});
