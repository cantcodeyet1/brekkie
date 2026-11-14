// Read-side maths: everything a member (or the VPE) sees about someone's history.
import { q } from './db.js';

const D = (c) => `to_char(${c},'YYYY-MM-DD')`;
const CRIT = ['Clarity', 'Vocal Variety', 'Eye Contact', 'Gestures', 'Audience Awareness', 'Comfort Level', 'Interest'];

/** approvedOnly: what a member sees, which is only feedback the VPE has approved */
export async function loadHist(clubId, approvedOnly = false) {
  const ok = approvedOnly ? " and r.review_status='approved'" : '';
  const [evals, fill, time, gram, rolefb, peer] = await Promise.all([
    q(`select e.id, e.speaker_id as pid, e.title, e.ratings, e.comments, e.excelled, e.work, e.challenge, e.seconds, m.number, ${D('m.date')} as date,
         p.name as project, coalesce(e.path_level, p.level) as level, coalesce(e.path_name, p.path) as path, ev.name as by
       from evaluations e join meetings m on m.id=e.meeting_id join projects p on p.id=e.project_id
       join meeting_roles r on r.id=e.role_id left join people ev on ev.id=r.person_id where m.club_id=$1${ok} order by m.date`, [clubId]),
    q(`select f.subject_id as pid, f.counts, f.comment, m.number, ${D('m.date')} as date, gp.name as by
       from filler_counts f join meetings m on m.id=f.meeting_id join meeting_roles r on r.id=f.role_id left join people gp on gp.id=r.person_id
       where m.club_id=$1${ok} order by m.date`, [clubId]),
    q(`select t.subject_id as pid, t.seconds, t.kind, t.label, t.green, t.yellow, t.red, t.comment, pr.name as project, m.number, ${D('m.date')} as date, tp.name as by
       from timings t join meetings m on m.id=t.meeting_id join meeting_roles r on r.id=t.role_id left join people tp on tp.id=r.person_id
       left join projects pr on pr.id=t.project_id where m.club_id=$1 and t.seconds is not null${ok} order by m.date`, [clubId]),
    q(`select g.subject_id as pid, g.used_word, g.word_uses, g.liked, g.improper, g.suggestion, m.word, m.number, ${D('m.date')} as date, gp.name as by
       from gram_notes g join meetings m on m.id=g.meeting_id join meeting_roles r on r.id=g.role_id left join people gp on gp.id=r.person_id
       where m.club_id=$1${ok} order by m.date`, [clubId]),
    q(`select tr.person_id as pid, rf.well, rf.improve, tr.label as role, m.number, ${D('m.date')} as date, ap.name as by
       from role_feedback rf join meeting_roles tr on tr.id=rf.target_role_id join meetings m on m.id=rf.meeting_id
       join meeting_roles ar on ar.id=rf.author_role_id left join people ap on ap.id=ar.person_id
       where m.club_id=$1 and tr.person_id is not null${approvedOnly ? " and ar.review_status='approved'" : ''} order by m.date`, [clubId]),
    q(`select p.to_person_id as pid, p.id, p.from_name, p.well, p.improve, m.number, ${D('m.date')} as date
       from peer_feedback p join meetings m on m.id=p.meeting_id where m.club_id=$1 and not p.hidden order by m.date`, [clubId]),
  ]);
  return { evals, fill, time, gram, rolefb, peer };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const total = (c) => Object.values(c || {}).reduce((a, b) => a + (+b || 0), 0);

export function progressFor(pid, hist) {
  const evals = hist.evals.filter((r) => r.pid === pid);
  const fill = hist.fill.filter((r) => r.pid === pid);
  const time = hist.time.filter((r) => r.pid === pid);
  const gram = hist.gram.filter((r) => r.pid === pid).sort((a, b) => b.date.localeCompare(a.date));
  const n = evals.length;
  const avgs = CRIT.map((_, k) => mean(evals.map((e) => e.ratings[k] || 0).filter(Boolean)));
  const order = avgs.map((_, k) => k).sort((a, b) => avgs[a] - avgs[b]);
  const focus = n ? order.slice(0, 3).filter((k) => avgs[k] > 0 && avgs[k] < 4) : [];
  const over = time.filter((t) => t.kind === 'Speaker' && t.seconds >= t.red).length;
  const speakerTimes = time.filter((t) => t.kind === 'Speaker').length;
  const stats = {
    speeches: n, level: n ? Math.max(...evals.map((e) => e.level)) : 0, avg: n ? mean(avgs.filter(Boolean)) : 0,
    focus: focus.map((k) => CRIT[k]), fillers_first: fill[0] ? total(fill[0].counts) : null, fillers_last: fill.length ? total(fill.at(-1).counts) : null,
    over, timed: speakerTimes,
  };
  return { stats, criteria: CRIT, avgs, focus, evals: [...evals].reverse(), fillers: fill, timing: [...time].reverse(), gram,
    roleFeedback: hist.rolefb.filter((r) => r.pid === pid).reverse(), peer: hist.peer.filter((r) => r.pid === pid).reverse() };
}

export function summary(pid, hist) {
  const by = (rows) => rows.filter((r) => r.pid === pid).sort((a, b) => b.date.localeCompare(a.date));
  const g = by(hist.gram), a = by(hist.fill), t = by(hist.time), e = by(hist.evals);
  return {
    gram: { count: g.length, latest: g[0] && { date: g[0].date, by: g[0].by } },
    ah: { count: a.length, latest: a[0] && { date: a[0].date, by: a[0].by } },
    time: { count: t.length, latest: t[0] && { date: t[0].date, by: t[0].by } },
    evals: { count: e.length, latest: e[0] },
    room: { count: hist.peer.filter((r) => r.pid === pid).length },
  };
}
