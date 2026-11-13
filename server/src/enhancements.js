// Pathways enhancements (Club Officer Guide, October 2025): besides a level's projects, each level asks for meeting roles
// and, from Level 3, an Education Series presentation. A role counts only at the level it was done in. This file is the
// only place the rules live, so it is easy to change if Toastmasters changes them.

/** The six paths that carry the enhancements. Legacy and other paths do not. */
export const ENH_PATHS = ['Dynamic Leadership', 'Engaging Humor', 'Motivational Strategies', 'Persuasive Influence', 'Presentation Mastery', 'Visionary Communication'];

/** role key -> label. `slot` is the roster row the role lives in; the rest are not on the agenda. */
export const ROLES = {
  tt: { label: 'Table Topics Speaker' },
  evaluator: { label: 'Evaluator', slot: 'evaluator' },
  timer: { label: 'Timer', slot: 'timer' },
  ah_counter: { label: 'Ah-Counter', slot: 'ah_counter' },
  grammarian: { label: 'Grammarian', slot: 'grammarian' },
  topicsmaster: { label: 'Topicsmaster', slot: 'topicsmaster' },
  toastmaster: { label: 'Toastmaster', slot: 'toastmaster' },
  general_evaluator: { label: 'General Evaluator', slot: 'general_evaluator' },
  intro_mentor: { label: 'Introductory Mentor' },
  club_mentor: { label: 'Club Mentor' },
  specialized: { label: 'Specialized role' },
};

export const SERIES = {
  club: { label: 'Successful Club Series' },
  better: { label: 'Better Speaker Series' },
  leader: { label: 'Leadership Excellence Series' },
};

const role = (id, options, need = 1, note = '') => ({ id, kind: 'role', options, need, ...(note ? { note } : {}) });
const series = (id, set, titles) => ({ id, kind: 'series', set, options: titles, need: 1 });

const CLUB3 = ['Creating the Best Club Climate', 'Meeting Roles and Responsibilities', 'Keeping the Commitment', 'Going Beyond Our Club'];
const CLUB4 = ['Finding New Members', 'Closing the Sale', 'How to Be a Distinguished Club', 'Toastmasters Educational Program'];
const CLUB5 = ['Moments of Truth', 'Evaluate to Motivate', 'Mentoring'];
const BETTER = ['Beginning Your Speech', 'Concluding Your Speech', 'Controlling Your Fear', 'Impromptu Speaking', 'Selecting Your Topic', 'Know Your Audience', 'Organizing Your Speech', 'Creating an Introduction', 'Preparation and Practice', 'Using Body Language'];
const LEADER = ['Service and Leadership', 'The Leader as a Coach', 'Developing a Mission', 'Motivating People', 'Building a Team', 'Delegate to Empower', 'Resolving Conflict', 'Visionary Leader', 'Values and Leadership', 'Goal Setting and Planning', 'Giving Effective Feedback'];

export const LEVELS = {
  1: [role('a', ['tt']), role('b', ['evaluator']), role('c', ['timer', 'ah_counter'])],
  2: [role('a', ['grammarian']), role('b', ['topicsmaster']), role('c', ['evaluator']), role('d', ['toastmaster', 'timer', 'ah_counter'])],
  3: [role('a', ['toastmaster']), role('b', ['evaluator']), role('c', ['topicsmaster', 'tt', 'intro_mentor']), series('s1', 'club', CLUB3)],
  4: [role('a', ['toastmaster']), role('b', ['general_evaluator']), role('c', ['evaluator']),
    role('d', ['tt', 'topicsmaster', 'specialized', 'toastmaster', 'general_evaluator', 'evaluator'], 1, 'Or repeat a role above'),
    series('s1', 'club', CLUB4), series('s2', 'better', BETTER)],
  5: [role('a', ['general_evaluator'], 2), role('b', ['toastmaster'], 2), role('c', ['evaluator'], 2),
    role('d', ['tt', 'topicsmaster', 'ah_counter', 'timer', 'grammarian', 'club_mentor', 'specialized', 'toastmaster', 'general_evaluator', 'evaluator'], 1, 'Or repeat a role above'),
    series('s1', 'club', CLUB5), series('s2', 'leader', LEADER)],
};

export const appliesTo = (path) => ENH_PATHS.includes(path);
export const slotsFor = (path, level) => (appliesTo(path) ? LEVELS[level] || [] : []);
export const itemLabel = (kind, item) => (kind === 'role' ? ROLES[item]?.label || item : item);

/** Is `item` something the level asks for? */
export const validItem = (path, level, kind, item) => slotsFor(path, level).some((s) => s.kind === kind && s.options.includes(item));

/**
 * Lay a member's recorded roles and presentations over a level's requirements.
 * `entries`: { id, kind, item, date, done, venue, role_id } for that level. A fixed requirement takes its entry first,
 * then the "one of these" requirements take what is left, so a spare Timer is not wasted on the wrong line.
 * Returns the level's items (each with its entries and state) and whether everything is met.
 */
export function layOver(path, level, entries, waived = false) {
  const slots = slotsFor(path, level);
  if (!slots.length) return { applies: false, items: [], done: 0, total: 0, complete: true, scheduled: 0, waived: false };
  const pool = entries.filter((e) => e.kind !== 'waive').map((e) => ({ ...e, used: false }))
    .sort((a, b) => (a.done === b.done ? (a.date || '').localeCompare(b.date || '') : a.done ? -1 : 1));
  const order = [...slots].sort((a, b) => a.options.length - b.options.length || slots.indexOf(a) - slots.indexOf(b));
  const got = new Map();
  for (const s of order) {
    const mine = [];
    for (const e of pool) if (!e.used && e.kind === s.kind && s.options.includes(e.item) && mine.length < s.need) { e.used = true; mine.push(e); }
    got.set(s.id, mine);
  }
  const items = slots.map((s) => {
    const mine = got.get(s.id) || [], done = mine.filter((e) => e.done);
    const state = waived || done.length >= s.need ? 'done' : mine.length >= s.need ? 'sched' : 'open';
    return {
      id: s.id, kind: s.kind, need: s.need, note: s.note || '', set: s.set ? SERIES[s.set].label : '',
      label: s.kind === 'series' ? SERIES[s.set].label : s.options.length > 4 ? 'One more role' : s.options.map((o) => ROLES[o].label).join(' or '),
      options: s.options.map((o) => ({ key: o, label: itemLabel(s.kind, o) })),
      entries: mine.map((e) => ({ id: e.id, item: e.item, label: itemLabel(e.kind, e.item), date: e.date, done: !!e.done, venue: e.venue || '', role_id: e.role_id || null })),
      have: Math.min(s.need, done.length), state,
    };
  });
  const spare = pool.filter((e) => !e.used).map((e) => ({ id: e.id, item: e.item, label: itemLabel(e.kind, e.item), date: e.date, done: !!e.done, venue: e.venue || '' }));
  const total = items.reduce((n, i) => n + i.need, 0), done = items.reduce((n, i) => n + (i.state === 'done' ? i.need : i.have), 0);
  return { applies: true, items, spare, done, total, complete: waived || items.every((i) => i.state === 'done'), scheduled: items.filter((i) => i.state === 'sched').length, waived };
}
