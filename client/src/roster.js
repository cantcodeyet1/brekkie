/* Reading the Toastmasters "Club Membership" export (Club Central → Club Roster → Export).
   The export says only Yes or No for "Pathways Enrolled", but its Credentials column carries the path and the last
   level finished, as a short code: PM3 is Presentation Mastery, Level 3 finished. */

export const PATH_CODES = {
  PM: 'Presentation Mastery', EH: 'Engaging Humor', DL: 'Dynamic Leadership', MS: 'Motivational Strategies',
  TC: 'Team Collaboration', LD: 'Leadership Development', SR: 'Strategic Relationships', PI: 'Persuasive Influence',
  VC: 'Visionary Communication', EC: 'Effective Coaching', IP: 'Innovative Planning',
};
export const PATH_NAMES = Object.values(PATH_CODES).sort();

/* a small, careful CSV reader: quoted cells, commas and line breaks inside quotes, a BOM, blank lines */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim());
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

/* a phone number as WhatsApp wants it: +country and digits. Zimbabwe numbers written 077… become +26377… */
export function cleanPhone(raw) {
  let v = String(raw || '').trim(); if (!v) return '';
  const plus = v.startsWith('+');
  let d = v.replace(/\D/g, '');
  if (!d) return '';
  if (!plus && d.startsWith('00')) d = d.slice(2);
  else if (!plus && d.startsWith('0') && d.length === 10) d = '263' + d.slice(1);
  return '+' + d;
}

/* every path code in a Credentials cell, best guess first: the furthest level not yet completed, else the first */
export function pathFromCredentials(cred) {
  const found = [];
  for (const t of String(cred || '').toUpperCase().split(/[\s,;/]+/)) {
    const m = /^([A-Z]{2})([1-5])$/.exec(t);
    if (m && PATH_CODES[m[1]]) found.push({ path_name: PATH_CODES[m[1]], levels_done: Number(m[2]) });
  }
  if (!found.length) return null;
  return found.filter((f) => f.levels_done < 5).sort((a, b) => b.levels_done - a.levels_done)[0] || found[0];
}

const val = (r, ...keys) => { for (const k of keys) if (r[k]) return r[k]; return ''; };

/* the export's rows as people to import, each with a guessed path and levels finished that the VPE can correct */
export function fromClubCentral(csv) {
  const out = [];
  for (const r of parseCsv(csv)) {
    const name = val(r, 'Name').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const credential = val(r, 'Credentials');
    const guess = pathFromCredentials(credential);
    out.push({
      key: val(r, 'Customer ID') || name,
      on: true,
      name,
      email: val(r, 'Email', 'Secondary Email').toLowerCase(),
      phone: cleanPhone(val(r, 'Mobile Phone', 'Additional Phone', 'Home Phone')),
      credential,
      position: val(r, 'Current Position'),
      enrolled: /^y/i.test(val(r, 'Pathways Enrolled')),
      path_name: guess?.path_name || '',
      levels_done: guess?.levels_done ?? 0,
      guessed: !!guess,
    });
  }
  return out;
}

/* what the server takes */
export const toMembers = (rows) => rows.filter((r) => r.on).map((r) => ({
  name: r.name, email: r.email, phone: r.phone, credential: r.credential,
  path_name: r.path_name || '', levels_done: r.path_name ? Number(r.levels_done) || 0 : 0,
  levels_this_year: r.path_name ? Math.min(Number(r.levels_this_year) || 0, Number(r.levels_done) || 0) : 0,
}));
