// Word of the day details. With GROQ_API_KEY (or ANTHROPIC_API_KEY) set, an AI writes everything, including an example
// sentence that speaks to the meeting's theme and the word's origin. Without a key it falls back to Wiktionary (meaning,
// part of speech, example) and Datamuse (synonyms, pronunciation), which cannot write a theme-based example.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const timeout = (ms) => AbortSignal.timeout(ms);

export const validWord = (w) => /^[A-Za-z][A-Za-z' -]{1,38}$/.test(String(w || '').trim());

/* ───────── AI (Groq or Claude) ───────── */
const promptFor = (word, theme, quote) => `Prepare the "Word of the Day" for a Toastmasters club meeting.
Word: ${word}
Meeting theme: ${theme || '(none given)'}${quote ? `\nTheme quotation: ${quote}` : ''}

Reply with only a JSON object with these string keys:
- "word": the word, correctly capitalised
- "pos": part of speech as "noun", "verb", "adj." or "adv."
- "pron": a plain-English respelling with the stressed syllable in capitals and hyphens between syllables, like "uh-SIJ-oo-us"
- "meaning": one clear sentence under 20 words
- "example": one natural sentence a speaker might say, under 25 words, that uses the word and clearly connects to the theme${theme ? ` "${theme}"` : ''}
- "synonyms": exactly three, comma separated, each capitalised
- "origin": where the word comes from in one short sentence, like "From Latin assiduus, meaning constantly present"`;

const parse = (text, word) => {
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return { word: clean(json.word) || cap(word), pos: clean(json.pos), pron: clean(json.pron), meaning: clean(json.meaning), example: clean(json.example), synonyms: clean(json.synonyms).split(',').map((x) => cap(x.trim().toLowerCase())).filter(Boolean).join(', '), origin: clean(json.origin) };
};

async function viaGroq(word, theme, quote) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', signal: timeout(25000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, temperature: 0.4, max_tokens: 1500, reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: promptFor(word, theme, quote) }] }),
  });
  if (!res.ok) throw new Error(`Groq returned ${res.status}`);
  return parse((await res.json()).choices?.[0]?.message?.content || '', word);
}

async function viaClaude(word, theme, quote) {
  const prompt = promptFor(word, theme, quote);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: timeout(25000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Claude returned ${res.status}`);
  const text = (await res.json()).content?.map((c) => c.text || '').join('') || '';
  return parse(text, word);
}

/* ───────── free fallback ───────── */
const POS = { n: 'noun', v: 'verb', adj: 'adj.', adv: 'adv.', noun: 'noun', verb: 'verb', adjective: 'adj.', adverb: 'adv.' };
const VOWEL = { AA: 'ah', AE: 'a', AH: 'uh', AO: 'aw', AW: 'ow', AY: 'eye', EH: 'eh', ER: 'er', EY: 'ay', IH: 'ih', IY: 'ee', OW: 'oh', OY: 'oy', UH: 'oo', UW: 'oo' };
const CONS = { B: 'b', CH: 'ch', D: 'd', DH: 'th', F: 'f', G: 'g', HH: 'h', JH: 'j', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ng', P: 'p', R: 'r', S: 's', SH: 'sh', T: 't', TH: 'th', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'zh' };

/** ARPAbet ("AH0 S IH1 D W AH0 S") to a club-style respelling ("uh-SID-wus"). */
export function respell(arpa) {
  const ph = String(arpa || '').trim().split(/\s+/).filter(Boolean);
  const syl = [];            // each: { onset: [], vowel, stress, coda: [] }
  let pending = [];
  for (const p of ph) {
    const base = p.replace(/\d/, ''), stress = /1/.test(p);
    if (VOWEL[base]) { syl.push({ onset: pending, vowel: VOWEL[base] === 'uh' && !stress && syl.length ? 'uh' : VOWEL[base], stress, coda: [] }); pending = []; }
    else if (CONS[base]) pending.push(CONS[base]);
  }
  if (!syl.length) return '';
  // consonants between vowels: one goes forward as the next onset, a cluster splits (first one stays behind)
  const tail = pending; syl.forEach((s, i) => { if (i === 0) return; const on = s.onset; if (on.length > 1) { syl[i - 1].coda.push(...on.slice(0, 1)); s.onset = on.slice(1); } });
  syl.at(-1).coda.push(...tail);
  return syl.map((s) => { const t = s.onset.join('') + (s.vowel === 'ih' && s.coda.length ? 'i' : s.vowel) + s.coda.join(''); return s.stress ? t.toUpperCase() : t; }).join('-');
}

async function viaFree(word) {
  // two tries each; a missing page (404) is an answer, a network failure is not
  const get = async (url) => {
    for (let n = 0; n < 2; n++) {
      try { const r = await fetch(url, { signal: timeout(12000) }); if (r.status === 404) return { missing: true }; if (r.ok) return { data: await r.json() }; } catch { /* try again */ }
      await new Promise((ok) => setTimeout(ok, 500));
    }
    return { failed: true };
  };
  const [wikR, dmR, synR] = await Promise.all([
    get(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word.toLowerCase())}`),
    get(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=rd&max=1`),
    get(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=6`),
  ]);
  if (wikR.failed && dmR.failed) throw Object.assign(new Error('Could not reach the dictionary just now. Try again in a moment, or type the details in yourself.'), { status: 502 });
  const wik = wikR.data, dm = dmR.data, syn = synR.data;
  const entry = wik?.en?.[0];
  const seen = new Set();
  const alternatives = (wik?.en || []).flatMap((e) => (e.definitions || []).map((d) => ({ pos: POS[(e.partOfSpeech || '').toLowerCase()] || '', text: clean(d.definition) })))
    .filter((d) => d.text && d.text.length < 220 && !/^\((obsolete|archaic|rare|dated)/i.test(d.text) && !seen.has(d.text) && seen.add(d.text)).slice(0, 5);
  const def = entry?.definitions?.find((d) => clean(d.definition)) || entry?.definitions?.[0];
  const dmWord = dm?.[0]?.word?.toLowerCase() === word.toLowerCase() ? dm[0] : null;
  const dmDef = dmWord?.defs?.[0]?.split('\t');
  const out = {
    word: cap(word.toLowerCase()),
    pos: POS[(entry?.partOfSpeech || dmDef?.[0] || '').toLowerCase()] || '',
    pron: respell((dmWord?.tags || []).find((t) => t.startsWith('pron:'))?.slice(5) || ''),
    meaning: clean(def?.definition) || clean(dmDef?.[1]) || '',
    example: clean(def?.examples?.[0]) || '',
    synonyms: (syn || []).slice(0, 3).map((s) => cap(s.word)).join(', '),
    alternatives: alternatives.length > 1 ? alternatives : [],
  };
  if (!out.meaning) throw Object.assign(new Error(`Could not find “${word}” in the dictionary. Check the spelling, or type the details in yourself.`), { status: 404 });
  return out;
}

export async function wordDetails({ word, theme, quote }) {
  const w = String(word).trim();
  if (process.env.GROQ_API_KEY) {
    try { return { ...(await viaGroq(w, theme, quote)), source: 'ai' }; } catch (e) { console.error('Groq word lookup failed:', e.message); }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try { return { ...(await viaClaude(w, theme, quote)), source: 'ai' }; } catch (e) { console.error('Claude word lookup failed, using the dictionary:', e.message); }
  }
  const d = await viaFree(w);
  return { ...d, source: 'dictionary', note: d.example ? '' : 'From the dictionary. Add a GROQ_API_KEY to get an example sentence and origin written for your theme.' };
}
