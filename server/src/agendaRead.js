// Reading a club's own agenda (a Word file or a PDF) into what Brekkie needs: the club's details and its running order.
// The text is pulled out here, then an AI model (Groq, with the same key the word of the day uses) turns it into JSON.
// Nothing is saved from this file: the VPE reviews what was read first.
import JSZip from 'jszip';
import { STD_BLOCKS, cleanBlocks } from './agenda.js';

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const MAX_TEXT = 14000;
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** the words in a Word file, one line per paragraph and cells of a table side by side */
async function docxText(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).sort();
  if (!names.includes('word/document.xml')) throw new Error('That is not a Word file');
  let out = '';
  for (const n of names) {
    let x = await zip.file(n).async('string');
    x = x.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');          // text boxes are stored twice
    x = x.replace(/<\/w:p>\s*<\/w:tc>/g, ' | ').replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<[^>]+>/g, '');
    out += decode(x) + '\n';
  }
  return out;
}
/** the words in a PDF, line by line (items at about the same height are one line) */
async function pdfText(buf) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  let out = '';
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items.filter((i) => i.str.trim());
    const lines = [];
    for (const it of items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
      const y = it.transform[5], line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (line) line.parts.push(it); else lines.push({ y, parts: [it] });
    }
    for (const l of lines) {
      // letters set one by one come out as separate items: join them when they nearly touch, and split words at a real gap
      let line = '', end = null;
      for (const i of l.parts.sort((a, b) => a.transform[4] - b.transform[4])) {
        const h = Math.abs(i.transform[3]) || 10, gap = end === null ? 0 : i.transform[4] - end;
        line += (end === null ? '' : gap > h * 1.4 ? '  ' : gap > h * 0.22 ? ' ' : '') + i.str.trim();
        end = i.transform[4] + (i.width || 0);
      }
      out += line + '\n';
    }
  }
  await doc.destroy();
  return out;
}
export async function fileText(buf, name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  const text = ext === 'docx' ? await docxText(buf) : ext === 'pdf' ? await pdfText(buf) : null;
  if (text === null) throw new Error('Choose a Word file (.docx) or a PDF');
  const t = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length < 40) throw new Error('There is no text in that file to read. A scanned picture will not work: use the Word file or a PDF saved from it.');
  return t.slice(0, MAX_TEXT);
}

const PROMPT = (text) => `Below is the text of a Toastmasters club's meeting agenda (the text of a Word file or PDF, so tables and columns may be jumbled).
Pick out the club's fixed details and the usual running order. Reply with only a JSON object:
{
 "club": { "name": "club name", "number": "digits only", "region": "like Area 4, Division C, District 129", "mission": "the club mission, in one paragraph" },
 "officers": [ { "role": "President", "name": "full name", "phone": "phone number as written" } ],
 "start": "meeting start time as HHMM, for example 1800",
 "running_order": [ { "title": "Welcome", "minutes": 5, "owner": "Chairperson" } ]
}
Rules:
- Never invent anything. Use "" for a text you cannot find, and leave minutes out when none is given.
- officers are the club's executive committee (President, VP Education, VP Membership, VP Public Relations, Secretary, Treasurer, Sergeant-At-Arms), in that order. At most 7.
- running_order lists the fixed items of the meeting in order, such as Meeting Called To Order, Welcome, Toast, Prepared Speeches, Table Topics, Speech Evaluations, Top Table Reports, Club Business, Meeting Adjourned. "owner" is who runs the item as written (SAA, Chairperson, TMOD, General Evaluator, Table Topics Master).
- Ignore everything that belongs to one meeting only: the date, theme, quotation, word of the day, the names in the role table, the speakers and their projects, the next meeting date, adverts, QR codes and conference banners.

AGENDA TEXT:
${text}`;

async function askGroq(text) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(40000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, temperature: 0, max_tokens: 3000, reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: PROMPT(text) }] }),
  });
  if (!res.ok) throw new Error(`The reader returned ${res.status}`);
  const out = (await res.json()).choices?.[0]?.message?.content || '';
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const STD_KEYS = STD_BLOCKS.map((b) => [b.id, norm(b.title), b]);
/** the model's running order laid over our standard ids, so what is recognised keeps its behaviour (speeches, reports) */
export function toBlocks(list) {
  const used = new Set(), out = [];
  let n = 0;
  for (const it of Array.isArray(list) ? list : []) {
    const title = String(it?.title || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (!title) continue;
    const k = norm(title);
    const std = STD_KEYS.find(([id, t]) => !used.has(id) && k.length >= 4 && (t === k || t.includes(k) || k.includes(t) || (id === 'speeches' && k.includes('speech') && !k.includes('eval')) || (id === 'intro' && k.includes('introduc')) || (id === 'evals' && k.includes('evaluation')) || (id === 'reports' && k.includes('report')) || (id === 'topics' && k.includes('topic'))));
    const min = Number.isFinite(+it.minutes) && it.minutes !== null && it.minutes !== '' ? Math.max(0, Math.min(180, Math.round(+it.minutes))) : null;
    const owner = String(it.owner || '').trim().slice(0, 60);
    if (std) {
      used.add(std[0]);
      out.push(std[0] === 'speeches' ? { id: 'speeches', type: 'speeches', title: 'Prepared Speeches' } : { ...std[2], title: std[2].title, min: min ?? std[2].min, owner: owner || std[2].owner });
    } else out.push({ id: `item-${++n}`, type: 'item', title, min: min ?? 5, owner });
  }
  // the speeches are always part of an agenda: after the introductions if the file did not say
  if (out.length && !used.has('speeches')) { const at = out.findIndex((b) => b.id === 'intro'); out.splice(at >= 0 ? at + 1 : Math.min(4, out.length), 0, { id: 'speeches', type: 'speeches', title: 'Prepared Speeches' }); }
  const blocks = cleanBlocks(out);
  return blocks.length >= 4 ? blocks : [];
}

/** a profile in the shape clubs.agenda_profile keeps */
export function toProfile(r) {
  const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const officers = (Array.isArray(r?.officers) ? r.officers : []).slice(0, 7).map((o) => ({ role: s(o?.role, 40), name: s(o?.name, 60), phone: s(o?.phone, 30) })).filter((o) => o.role);
  return { region: s(r?.club?.region, 80), mission: s(r?.club?.mission, 600), officers };
}

/** the whole thing: a file in, what was found out (nothing saved) */
export async function readAgendaTemplate(buf, name) {
  if (!process.env.GROQ_API_KEY) throw Object.assign(new Error('Reading agendas is not switched on for this server yet. You can fill in your details by hand.'), { status: 503 });
  const text = await fileText(buf, name);
  let r;
  try { r = await askGroq(text); } catch (e) { console.error('Agenda read failed:', e.message); throw Object.assign(new Error('We could not read that agenda this time. Try again, or fill in your details by hand.'), { status: 502 }); }
  const startRaw = String(r.start || '').replace(/\D/g, '').padStart(4, '0');
  return {
    club: { name: String(r?.club?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80), number: String(r?.club?.number || '').replace(/\D/g, '').slice(0, 10) },
    profile: toProfile(r),
    blocks: toBlocks(r.running_order),
    start: /^([01]\d|2[0-3])[0-5]\d$/.test(startRaw) ? startRaw : '',
  };
}
