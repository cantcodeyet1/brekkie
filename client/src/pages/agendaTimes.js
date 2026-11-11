// Start times for the agenda page, worked out the same way the server does (server/src/agenda.js), so the page
// updates as items are moved or changed. The server stays the authority: the PDF and Word file use its own sums.
const toMin = (t) => (+String(t).slice(0, 2)) * 60 + (+String(t).slice(2));
export const toHhmm = (t) => (/^([01]\d|2[0-3])[0-5]\d$/.test(String(t || '')) ? String(t) : '');
const at = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + String(((m % 60) + 60) % 60).padStart(2, '0');
/** 1800 shown as 18:00 */
export const shown = (t) => (toHhmm(t) ? `${String(t).slice(0, 2)}:${String(t).slice(2)}` : '');
/** the longest a speech may run, from text such as "5 - 7 min" */
export const maxMinutes = (t) => { const n = (String(t || '').match(/\d+/g) || []).map(Number); return n.length ? Math.max(...n) : 7; };
/** 85 minutes as "1 h 25 min" */
export const clock = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export function schedule(ag) {
  let t = toMin(toHhmm(ag.start) || '1800');
  const gap = Number(ag.gap) || 0, buffer = Number(ag.buffer) || 0;
  const blocks = ag.blocks.map((b) => ({ ...b }));
  const speeches = ag.speeches.map((s) => ({ ...s }));
  for (const b of blocks) {
    if (b.at && toHhmm(b.at)) t = toMin(b.at);
    b.time = at(t);
    if (b.type === 'speeches') for (const s of speeches) { s.time = at(t); t += maxMinutes(s.length) + buffer; } else t += (Number(b.min) || 0) + gap;
  }
  const last = blocks.at(-1);
  const ends = last && last.type !== 'speeches' && !Number(last.min) ? last.time : at(t - gap);
  return { ...ag, blocks, speeches, ends, over: toHhmm(ag.end) ? toMin(ends) - toMin(ag.end) : null };
}
