// Who shows up on which level of the dashboard: only real prospects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastMember } from '../src/dcp.js';

const year = { start: '2026-07-01', end: '2027-06-30' }, today = '2026-11-12';
const proj = (id, extra = {}) => ({ id, name: `P${id}`, kind: 'required', ...extra });
const level = (n, projects, extra = {}) => ({ level: n, projects, required_total: projects.length, required_done: projects.filter((p) => p.done).length, choose: 0, electives_done: 0, to_pick: 0, complete: false, ...extra });
const sched = { date: '2027-01-08', venue: '' };

test('a level shows only for the level they are on, or once something higher is scheduled', () => {
  const prog = {
    current: 1,
    levels: [
      level(1, [proj(1), proj(2)]),
      level(2, [proj(3), proj(4)]),
      level(3, [proj(5, { sched }), proj(6)]),
      level(4, [proj(7, { sched }), proj(8, { sched })]),
    ],
  };
  const f = forecastMember(prog, { year, today }).levels;
  assert.equal(f[1].state, 'open', 'the level they are on is always a prospect');
  assert.equal(f[2], undefined, 'nothing scheduled in level 2, and level 1 is not finished');
  assert.equal(f[3].state, 'open', 'one project scheduled in level 3 puts them on it');
  assert.equal(f[4].state, 'forecast', 'everything in level 4 is scheduled');
});

test('finishing a level moves them up to the next', () => {
  const done = { date: '2026-09-01', source: 'manual' };
  const prog = {
    current: 2,
    levels: [level(1, [proj(1, { done })], { complete: true }), level(2, [proj(2)]), level(3, [proj(3)])],
  };
  const f = forecastMember(prog, { year, today }).levels;
  assert.equal(f[1].state, 'done');
  assert.equal(f[2].state, 'open');
  assert.equal(f[3], undefined);
});

test('something scheduled whose date passed without being marked done makes the level overdue, not a forecast', async () => {
  const { goalsFrom } = await import('../src/dcp.js');
  const past = { date: '2026-10-01', venue: '' };
  const prog = { current: 1, levels: [level(1, [proj(1, { sched: past }), proj(2, { sched })])] };
  const f = forecastMember(prog, { year, today }).levels;
  assert.equal(f[1].state, 'overdue');
  assert.equal(f[1].due, 1);
  const goals = goalsFrom([{ id: 1, name: 'A', levels: f }], { ...year });
  assert.equal(goals[0].have, 0);
  assert.equal(goals[0].overdue.length, 1, 'the goal says who is held up');
  assert.equal(goals[0].status, 'short', 'an overdue level is not counted towards the goal');
});
