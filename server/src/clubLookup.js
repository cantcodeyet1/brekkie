// Looks a club up by its Toastmasters number on toastmasters.org's public Find a Club page, so a club only has to type its number:
// the name, area, division, district, meeting time and venue come from there. Only that one address is ever fetched, and only
// digits go into it. Anything that goes wrong just means "not found": the caller lets the club type the details instead.
const cache = new Map();   // number -> { at, club }
const TTL = 6 * 3600 * 1000;

const clean = (s) => String(s || '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

/** what the page says, or null when it is not a club page */
export function parseClubPage(html) {
  const text = clean(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const m = /Club Number:\s*(\d+)\s*,?\s*(\d+)\s*,?\s*Area\s*([A-Z]+)\s*0*(\d+)/i.exec(text);
  if (!m) return null;
  const title = clean((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1]).replace(/^Toastmasters International\s*-?\s*/i, '');
  const meets = clean((/Meeting Times:\s*(.*?)\s*(?:Phone:|Location:|Membership Restriction:)/i.exec(text) || [])[1]);
  const venue = clean((/Location:\s*(.*?)\s*(?:Membership Restriction:|Online Attendance|Get directions)/i.exec(text) || [])[1]).replace(/\s*,\s*/g, ', ').replace(/(, )+$/, '');
  const district = m[2], division = m[3].toUpperCase(), area = Number(m[4]);
  return { number: m[1], name: title, district, division, area, region: `Area ${area}, Division ${division}, District ${district}`, meets, venue };
}

export async function lookupClub(num, fetchImpl = fetch) {
  const n = String(num || '').replace(/\D/g, '');
  if (n.length < 3 || n.length > 8) return null;
  const hit = cache.get(n);
  if (hit && Date.now() - hit.at < TTL) return hit.club;
  const id = n.padStart(8, '0');
  let club = null;
  try {
    const r = await fetchImpl(`https://www.toastmasters.org/Find-a-Club/${id}-${id}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Brekkie)' }, signal: AbortSignal.timeout(8000) });
    if (r.ok) club = parseClubPage(await r.text());
  } catch { club = null; }
  if (club) cache.set(n, { at: Date.now(), club });
  return club;
}
