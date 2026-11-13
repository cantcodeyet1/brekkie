// Distinguished Club Program, goals 1 to 6 (education awards), and a forecast of when each will be met.
// A member's level award is earned when the level is finished. One award per level per member counts each program year.
// The goal definitions are the only place the numbers live, so they are easy to change if Toastmasters changes them.
export const GOALS = [
  { n: 1, levels: [1], from: 1, to: 4, label: '4 Level 1 awards' },
  { n: 2, levels: [2], from: 1, to: 2, label: '2 Level 2 awards' },
  { n: 3, levels: [2], from: 3, to: 4, label: '2 more Level 2 awards' },
  { n: 4, levels: [3], from: 1, to: 2, label: '2 Level 3 awards' },
  { n: 5, levels: [4, 5], from: 1, to: 1, label: '1 Level 4 or 5 award' },
  { n: 6, levels: [4, 5], from: 2, to: 2, label: '1 more Level 4 or 5 award' },
];
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(s + 'T12:00:00Z');

/** The program year runs 1 July to 30 June. */
export function programYear(today) {
  const t = parse(today), y = t.getUTCMonth() >= 6 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
  return { start: `${y}-07-01`, end: `${y + 1}-06-30`, label: `${y}-${String(y + 1).slice(2)}`, days_left: Math.max(0, Math.round((parse(`${y + 1}-06-30`) - t) / DAY)) };
}

/** One member, level by level. A level is 'done' (earned, with its date), 'earlier' (earned before this program year),
    'forecast' (every project left in it is scheduled, so it completes on the last of those dates) 'overdue' (something scheduled has passed without being marked done, so it drops out of the forecast) or 'open' (some project
    is not scheduled yet, so there is no date). `items` lists the level's projects with their own state and date. */
export function forecastMember(prog, { year, today }) {
  const out = {};
  for (const l of prog.levels || []) {
    const items = l.projects.map((p) => (p.done
      ? { id: p.id, name: p.name, code: p.code, length: p.length, kind: p.kind, state: 'done', date: p.done.date, source: p.done.source, meeting: p.done.meeting, venue: p.done.venue || '' }
      : p.sched ? { id: p.id, name: p.name, code: p.code, length: p.length, kind: p.kind, state: p.sched.date < today ? 'due' : 'sched', date: p.sched.date, venue: p.sched.venue || '', plan: p.sched.plan || null }
      : { id: p.id, name: p.name, code: p.code, length: p.length, kind: p.kind, state: 'open' }));
    for (let i = 0; i < (l.to_pick || 0); i++) items.push({ id: null, name: 'Choose an elective', code: '', state: 'pick' });
    // the level's meeting roles and Education Series presentation count too: it is not finished until they are
    for (const s of l.enh?.items || []) for (let i = 0; i < s.need; i++) {
      const en = s.entries[i];
      const base = { id: null, code: '', kind: 'enh', enh_kind: s.kind };
      items.push(en?.done ? { ...base, name: en.label, enh_id: en.id, state: 'done', date: en.date, venue: en.venue || '' }
        : en ? { ...base, name: en.label, enh_id: en.id, state: (en.date || '9') < today ? 'due' : 'sched', date: en.date, venue: en.venue || '' }
        : s.state === 'done' ? { ...base, name: s.label, state: 'done', date: null, source: 'prior' }
        : { ...base, name: s.label, state: 'open' });
    }
    const rq = l.enh?.applies ? l.enh : { total: 0, done: 0 };
    // projects and the level's roles and presentations are all counted: a level is not finished until every one is
    const total = l.required_total + (l.choose || 0) + rq.total, done = l.required_done + Math.min(l.choose || 0, l.electives_done) + rq.done;
    const e = { state: null, total, done, requirements: rq.total, requirements_done: rq.done, items, unscheduled: items.filter((x) => x.state === 'open' || x.state === 'pick').length, due: items.filter((x) => x.state === 'due').length };
    if (l.complete) {
      e.date = items.filter((x) => x.state === 'done' && x.date).map((x) => x.date).sort().at(-1) || null;
      // a level finished before Brekkie has no date: it counts as earned earlier, not in this program year
      e.state = !e.date || e.date < year.start ? 'earlier' : 'done';
    } else if (l.level === (prog.current ?? 0) || (l.level > (prog.current ?? 0) && items.some((x) => x.state === 'sched' || x.state === 'due'))) {
      // the level they are on is always a prospect. A level further up only shows once something in it is scheduled,
      // so the dashboard lists real prospects: nobody appears on Level 3 before they have finished Level 2.
      // something was scheduled, its date passed and it was never marked done: the level cannot be forecast until the VPE confirms or reschedules it
      e.state = e.due ? 'overdue' : e.unscheduled ? 'open' : 'forecast';
      if (e.state === 'forecast') e.date = items.filter((x) => x.state === 'sched' || x.state === 'due').map((x) => x.date).sort().at(-1);
    }
    if (e.state) out[l.level] = e;
  }
  return { levels: out };
}

/** The six goals from every member's forecast. */
export function goalsFrom(members, year) {
  return GOALS.map((g) => {
    // every (member, level) award that could count this program year, earliest first, finished ones before forecast ones
    const pool = [];
    for (const m of members) for (const lv of g.levels) {
      const e = m.levels[lv];
      if (e && (e.state === 'done' || e.state === 'forecast')) pool.push({ id: m.id, name: m.name, level: lv, state: e.state, date: e.date });
    }
    pool.sort((a, b) => (a.state === b.state ? a.date.localeCompare(b.date) : a.state === 'done' ? -1 : 1));
    // one award per member towards the pool of a goal: members who finish two levels of the pool still count once per level
    const mine = pool.slice(g.from - 1, g.to);
    const need = g.to - g.from + 1;
    const done = mine.filter((x) => x.state === 'done').length;
    const complete = mine.length === need && done === need;
    const forecast = mine.length === need ? mine.at(-1).date : null;
    // members whose level for this goal is held up by something scheduled that was never confirmed
    const overdue = [];
    for (const m of members) for (const lv of g.levels) if (m.levels[lv]?.state === 'overdue') overdue.push({ id: m.id, name: m.name, level: lv, due: m.levels[lv].due });
    const status = complete ? 'done' : mine.length < need ? 'short' : forecast > year.end ? 'late' : 'on';
    return { n: g.n, label: g.label, need, have: done, status, date: forecast, people: mine, short_by: need - mine.length, overdue };
  });
}
