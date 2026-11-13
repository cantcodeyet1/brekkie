// A club's own Word agenda, used as the template. The uploaded file is kept as it is; for each meeting a copy is made and the
// parts that change from meeting to meeting are found by what they say (the date, "Theme:", the role table, the rows of times
// and minutes, the Speaker / Project Details / Evaluator table, "Meaning:") and replaced. Everything else stays the club's own.
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { STD_BLOCKS, cellsOf, elems, planOf, quiet, rowsOf, runsOf, schedule, setTextNode } from './agenda.js';

const txt = (n) => elems(n, 'w:t').map((t) => t.textContent).join('');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const TIME = /^\s*\d{1,2}:?\d{2}\s*$/;
const paraOf = (n) => { let x = n; while (x && x.nodeName !== 'w:p') x = x.parentNode; return x; };
const allParas = (doc) => elems(doc, 'w:p');
const directParas = (tc) => Array.from(tc.childNodes).filter((n) => n.nodeName === 'w:p');

/** a paragraph's text set while keeping its first run's look; a paragraph with no run gets one */
function put(p, text) {
  const doc = p.ownerDocument;
  let runs = runsOf(p), first = runs.find((r) => elems(r, 'w:t').length) || runs[0];
  if (!first) { first = doc.createElement('w:r'); p.appendChild(first); runs = [first]; }
  runs.forEach((r) => { if (r !== first) elems(r, 'w:t').forEach((t) => setTextNode(t, '')); });
  const ts = elems(first, 'w:t');
  if (ts.length) { setTextNode(ts[0], text); ts.slice(1).forEach((t) => setTextNode(t, '')); }
  else { const t = doc.createElement('w:t'); first.appendChild(t); setTextNode(t, text); }
}
const strip = (n) => { if (n.parentNode) n.parentNode.removeChild(n); };
const fresh = (n) => { const c = n.cloneNode(true); if (c.removeAttribute) c.removeAttribute('w14:paraId'); return c; };

/* ───────── what each part of the page looks like ───────── */
const DATE_RES = [/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b.{0,14}\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}/i, /\b[A-Za-z]{3,9}\.?\s+\d{1,2}(st|nd|rd|th)?\s*,?\s*\d{4}/, /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/];
const looksDate = (s) => s.length < 70 && DATE_RES.some((re) => re.test(s));
const ROLE_LABELS = { tmod: /^(toastmaster|toastmasterofthe?day|tmod)$/, ge: /^generalevaluator$/, grammarian: /^grammarian$/, ah: /^ahcounter$/, timer: /^timer$/, ttm: /^(tabletopicsmaster|topicsmaster|tabletopics)$/ };

function fillAfterLabel(doc, re, value) {
  const t = elems(doc, 'w:t').find((x) => re.test(x.textContent));
  if (!t) return false;
  const p = paraOf(t), ts = elems(p, 'w:t'), i = ts.indexOf(t);
  const same = /^(\s*[A-Za-z][A-Za-z ]*?\s*:)\s*(\S[\s\S]*)$/.exec(t.textContent);
  if (same) { setTextNode(t, value ? `${same[1]} ${value}` : same[1]); ts.slice(i + 1).forEach((x) => setTextNode(x, '')); return true; }
  let j = i + 1;
  while (j < ts.length && /^\s*:?\s*$/.test(ts[j].textContent)) j++;
  if (j < ts.length) { setTextNode(ts[j], value ? ` ${value}` : ''); ts.slice(j + 1).forEach((x) => setTextNode(x, '')); return true; }
  const ps = allParas(doc); let k = ps.indexOf(p) + 1;
  while (k < ps.length && !txt(ps[k]).trim() && k < ps.indexOf(p) + 4) k++;
  if (k < ps.length && txt(ps[k]).trim()) { put(ps[k], value); return true; }
  return false;
}

/** fills a copy of the club's Word file for one meeting. `found` says which parts of the page were recognised. */
export async function fillDocx(buf, ag, ctx) {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('That is not a Word file');
  const xml = (await file.async('string')).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');   // text boxes are stored twice
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const plan = planOf(ag, ctx), found = {};
  const step = (key, fn) => { try { found[key] = !!fn(); } catch (e) { found[key] = false; } };
  const paras = allParas(doc);

  step('club_number', () => {
    const t = elems(doc, 'w:t').find((x) => /^\s*Club Number\s*:/i.test(x.textContent));
    if (t && ctx.clubNumber) setTextNode(t, `Club Number: ${ctx.clubNumber}`);
    return !!t;
  });

  const nextAt = paras.findIndex((p) => /next\s+meeting/i.test(txt(p)));
  step('date', () => {
    const p = paras.find((x, i) => (nextAt < 0 || i < nextAt) && looksDate(txt(x).trim()) && !/club number|theme|quotation/i.test(txt(x)));
    if (p) put(p, `${plan.date} `);
    return !!p;
  });

  // "Theme:" and "Quotation:" with their text, in one paragraph or two. A label that says both words is the theme the first time, the quotation the second.
  step('theme', () => {
    let seenBoth = false, themeDone = false;
    for (const r of elems(doc, 'w:r')) {
      const tr = txt(r).trim(), t0 = elems(r, 'w:t')[0];
      if (!t0) continue;
      const inline = /^\s*(Theme|Quotation|Quote)\s*:\s*(\S[\s\S]*)$/i.exec(t0.textContent);
      const label = !inline && tr.length <= 24 && /:\s*$/.test(tr) && /(theme|quotation|quote)/i.test(tr);
      if (!inline && !label) continue;
      const word = (inline ? inline[1] : tr).toLowerCase();
      const hasT = /theme/.test(word), hasQ = /quot/.test(word);
      const kind = hasT && hasQ ? (seenBoth ? 'quote' : 'theme') : hasQ ? 'quote' : 'theme';
      if (hasT && hasQ) seenBoth = true;
      const value = kind === 'theme' ? plan.theme : plan.quote, name = kind === 'theme' ? 'Theme:' : 'Quotation:';
      if (inline) { setTextNode(t0, value ? `${name} ${value}` : ''); if (kind === 'theme') themeDone = true; continue; }
      const p = paraOf(r), rs = runsOf(p), vr = rs.slice(rs.indexOf(r) + 1).find((x) => txt(x).trim());
      if (!vr) continue;
      setTextNode(t0, value ? name : ''); elems(r, 'w:t').slice(1).forEach((x) => setTextNode(x, ''));
      const vt = elems(vr, 'w:t'); setTextNode(vt[0], value ? ` ${value}` : ''); vt.slice(1).forEach((x) => setTextNode(x, ''));
      if (kind === 'theme') themeDone = true;
    }
    return themeDone;
  });

  step('next_meeting', () => {
    if (nextAt < 0) return false;
    for (let i = nextAt; i < Math.min(paras.length, nextAt + 5); i++) {
      const p = paras[i], s = txt(p);
      if (!/[A-Za-z]{3,9}\s*\d{1,2}|\d{1,2}\s*[A-Za-z]{3,9}/.test(s.replace(/next\s+meeting\s+date\s*:?/i, '')) || !/\d{4}/.test(s)) continue;
      const n = plan.next, rs = runsOf(p).filter((r) => elems(r, 'w:t').length && txt(r).trim());
      if (rs.length >= 3 && /^(st|nd|rd|th)$/i.test(txt(rs[1]).trim())) {
        setTextNode(elems(rs[0], 'w:t')[0], `${n.month} ${n.day}`); setTextNode(elems(rs[1], 'w:t')[0], n.ord); setTextNode(elems(rs[2], 'w:t')[0], `, ${n.year}`);
      } else {
        const lab = /next\s+meeting\s+date\s*:?\s*/i.exec(s);
        put(p, `${lab ? lab[0] : ''}${n.month} ${n.day}, ${n.year}`);
      }
      return true;
    }
    return false;
  });

  // the word of the day: the word (and its "(adj.)" and pronunciation) sit before "Meaning"; the rest follow their labels
  step('word', () => {
    const w = plan.word, m = ctx.m;
    const mt = elems(doc, 'w:t').find((x) => /^\s*Meaning\b/i.test(x.textContent));
    if (!mt) return false;
    const pm = paraOf(mt);
    let ts = elems(pm, 'w:t').slice(0, elems(pm, 'w:t').indexOf(mt)).filter((x) => x.textContent.trim());
    if (!ts.length) {
      const ps = allParas(doc); let k = ps.indexOf(pm) - 1;
      while (k >= 0 && !txt(ps[k]).trim()) k--;
      if (k >= 0 && !/word\s+of\s+the\s+day/i.test(txt(ps[k]))) ts = elems(ps[k], 'w:t').filter((x) => x.textContent.trim());
    }
    if (ts.length) {
      const cased = (s) => (/^[^a-z]*$/.test(ts[0].textContent) ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));
      setTextNode(ts[0], w ? cased(m.word) : '');
      let posDone = false;
      ts.slice(1).forEach((t) => {
        if (/^\(.*\)$/.test(t.textContent.trim()) && !posDone) { posDone = true; setTextNode(t, w?.pos || ''); }
        else setTextNode(t, w?.pron ? `${w.pron} ` : '');
      });
    }
    fillAfterLabel(doc, /^\s*Meaning\b/i, m.word ? m.meaning || '' : '');
    fillAfterLabel(doc, /^\s*Example\b/i, m.word ? m.example || '' : '');
    fillAfterLabel(doc, /^\s*Synonyms?\b/i, m.word ? m.synonyms || '' : '');
    fillAfterLabel(doc, /^\s*Origin\b/i, m.word ? m.origin || '' : '');
    return true;
  });

  // the role table: a label cell and the cell after it
  step('roles', () => {
    let n = 0; const valueParas = [];
    for (const tr of elems(doc, 'w:tr')) {
      const cells = cellsOf(tr);
      if (cells.length < 2 || TIME.test(txt(cells[0]))) continue;
      cells.forEach((c, i) => {
        const key = Object.keys(ROLE_LABELS).find((k) => ROLE_LABELS[k].test(norm(txt(c))));
        if (!key || !cells[i + 1] || txt(c).length > 40) return;
        const p = Array.from(cells[i + 1].getElementsByTagName('w:p'))[0]; if (!p) return;
        put(p, ag.roles?.[key] || ''); n++; valueParas.push(p);
      });
    }
    // the template shrinks long names by hand: give every name the first one's type so they read evenly
    const model = valueParas.length ? runsOf(valueParas[0]).find((r) => elems(r, 'w:t').length) : null, mpr = model && elems(model, 'w:rPr').find((x) => x.parentNode === model);
    if (mpr) valueParas.slice(1).forEach((p) => { const run = runsOf(p).find((r) => elems(r, 'w:t').length); if (!run) return; elems(run, 'w:rPr').filter((x) => x.parentNode === run).forEach(strip); run.insertBefore(mpr.cloneNode(true), run.firstChild); });
    return n >= 2;
  });

  // the running order
  const tables = elems(doc, 'w:tbl');
  const cellTexts = (tr) => cellsOf(tr).map((c) => txt(c).trim());
  const isItem = (tr) => { const c = cellTexts(tr); return c.length >= 3 && TIME.test(c[0]); };
  const speechTbl = tables.find((t) => rowsOf(t).some((tr) => { const c = cellTexts(tr).map(norm); return c.some((x) => x === 'speaker') && c.some((x) => x.startsWith('project')) && c.some((x) => x === 'evaluator'); }));
  const itemTbls = tables.filter((t) => t !== speechTbl && rowsOf(t).filter(isItem).length >= 2 && !rowsOf(t).some((tr) => cellsOf(tr).some((c) => elems(c, 'w:tbl').length)));
  const order = [...tables];
  const sIdx = speechTbl ? order.indexOf(speechTbl) : -1;
  const beforeT = itemTbls.find((t) => sIdx < 0 || order.indexOf(t) < sIdx), afterT = sIdx >= 0 ? itemTbls.find((t) => order.indexOf(t) > sIdx) : null;

  const col = (tr) => {
    const c = cellTexts(tr), time = c.findIndex((x) => TIME.test(x));
    let min = c.findIndex((x) => /\bmins?\b/i.test(x));
    if (min < 0) min = c.length >= 4 ? 2 : -1;
    const title = c.findIndex((x, i) => i !== time && i !== min && x), owner = c.findIndex((x, i) => i > min && i !== title && x);
    return { time: Math.max(time, 0), title: title < 0 ? 1 : title, min, owner: owner < 0 ? c.length - 1 : owner };
  };
  const models = [beforeT, afterT].filter(Boolean).flatMap((t) => rowsOf(t).filter(isItem));
  const plainModel = models.find((tr) => cellsOf(tr).every((c) => directParas(c).length <= 1)) || models[0];
  const reportModel = models.find((tr) => cellsOf(tr).some((c) => directParas(c).length > 1) && /report/i.test(txt(tr)));
  const sub = (tr, i) => { const c = cellsOf(tr)[i]; return c ? directParas(c) : []; };

  const fillItem = (it) => {
    if (!plainModel) return null;
    const tr = fresh(plainModel), c = cellsOf(tr), k = col(plainModel);
    const set = (i, v) => { if (c[i]) { const p = directParas(c[i])[0]; if (p) put(p, v); } };
    set(k.time, it.time || ''); set(k.title, it.title || ''); if (k.min >= 0) set(k.min, it.min || ''); set(k.owner, it.owner || '');
    if (it.topic && c[k.title]) { const tp = directParas(c[k.title])[0], n = fresh(tp); put(n, it.topic); quiet(n); tp.parentNode.insertBefore(n, tp.nextSibling); }
    return tr;
  };
  const fillReports = (it) => {
    if (!reportModel) return fillItem(it);
    const tr = fresh(reportModel), c = cellsOf(tr), k = col(reportModel), items = ag.reports.items;
    const lines = (cell, first, rest) => {
      let ps = directParas(cell); if (!ps.length) return;
      const ts = elems(ps[0], 'w:t').filter((t) => t.textContent.trim());
      if (ts.length >= 2) { setTextNode(ts[0], first); setTextNode(ts[1], rest[0] ?? ''); ts.slice(2).forEach((t) => setTextNode(t, '')); rest = rest.slice(1); }
      else put(ps[0], first);
      ps = ps.slice(1);
      while (ps.length < rest.length) { const n = fresh(ps.at(-1) || directParas(cell)[0]); (ps.at(-1) || directParas(cell)[0]).parentNode.insertBefore(n, (ps.at(-1) || directParas(cell)[0]).nextSibling); ps.push(n); }
      ps.forEach((p, i) => (i < rest.length ? put(p, rest[i]) : strip(p)));
    };
    put(directParas(c[k.time])[0], it.time || '');
    lines(c[k.title], it.title || 'Top Table Reports', items.map((x) => x.role));
    if (k.min >= 0) lines(c[k.min], it.min || '', items.map((x) => x.min));
    if (c[k.owner]) put(directParas(c[k.owner])[0], it.owner || '');
    return tr;
  };
  const rebuild = (tbl, list) => {
    if (!tbl) return;
    const old = rowsOf(tbl).filter(isItem), anchor = old[0];
    list.forEach((it) => { const tr = it.type === 'reports' ? fillReports(it) : fillItem(it); if (tr) tbl.insertBefore(tr, anchor); });
    old.forEach(strip);
  };
  step('running_order', () => {
    if (!beforeT || !plainModel) return false;
    const everything = [...plan.before, ...(plan.speeches ? [] : []), ...plan.after];
    if (speechTbl && afterT) { rebuild(beforeT, plan.before); rebuild(afterT, plan.after); }
    else if (speechTbl) { rebuild(beforeT, plan.before); }
    else rebuild(beforeT, everything);
    return true;
  });

  step('speeches', () => {
    if (!speechTbl) return false;
    const rows = rowsOf(speechTbl), hi = rows.findIndex((tr) => cellTexts(tr).map(norm).includes('speaker'));
    const data = rows.slice(hi + 1).filter((tr) => cellsOf(tr).length >= 3);
    if (!data.length) return false;
    const head = cellTexts(rows[hi]).map(norm);
    const sp = head.findIndex((x) => x === 'speaker'), pj = head.findIndex((x) => x.startsWith('project')), ev = head.findIndex((x) => x === 'evaluator');
    const tm = cellTexts(data[0]).findIndex((x) => TIME.test(x));
    const list = plan.speeches?.length ? plan.speeches : [{ time: '', name: '', project_line: '', project_name: '', title: '', length: '', evaluator: '' }];
    const models = data.slice(0, 2).map(fresh);
    list.forEach((s, idx) => {
      const tr = fresh(models[idx % models.length]), c = cellsOf(tr);
      const set = (i, v) => { if (i >= 0 && c[i]) { const p = directParas(c[i])[0]; if (p) put(p, v); } };
      set(tm < 0 ? 0 : tm, s.time || ''); set(sp, s.name || ''); set(ev, s.evaluator || '');
      if (pj >= 0 && c[pj]) {
        const rest = [s.title ? `“${String(s.title).replace(/^[“"]|[”"]$/g, '')}”` : '', s.length].filter(Boolean);
        let ps = directParas(c[pj]);
        const ts = elems(ps[0], 'w:t').filter((t) => t.textContent.trim());
        let lines;
        if (ts.length >= 2) {
          // the first paragraph holds the project line and the project name; the title and length are its last paragraphs
          setTextNode(ts[0], s.project_line || ''); setTextNode(ts[1], s.project_name || ''); ts.slice(2).forEach((t) => setTextNode(t, ''));
          const tail = ps.slice(1);
          while (tail.length > rest.length) strip(tail.splice(Math.max(0, tail.length - rest.length - 1), 1)[0]);
          while (tail.length < rest.length) { const last = tail.at(-1) || ps[0], n = fresh(last); last.parentNode.insertBefore(n, last.nextSibling); tail.push(n); }
          tail.forEach((p, i) => put(p, rest[i]));
          lines = null;
        } else lines = [s.project_line, s.project_name, ...rest].filter(Boolean);
        if (lines) {
          while (ps.length < lines.length) { const last = ps.at(-1), n = fresh(last); last.parentNode.insertBefore(n, last.nextSibling); ps.push(n); }
          ps.forEach((p, i) => (i < lines.length ? put(p, lines[i]) : i === 0 ? put(p, '') : strip(p)));
        }
      }
      speechTbl.appendChild(tr);
    });
    data.forEach(strip);
    return true;
  });

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
  zip.file('word/document.xml', out);
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), found, text: out.replace(/<[^>]+>/g, ' ') };
}

/* ───────── checking a file at upload ───────── */
const SAMPLE_CTX = { clubNumber: '7654321', m: { date: '2031-03-04', theme: 'SAMPLETHEME', theme_quote: 'SAMPLEQUOTE', theme_quote_by: '', word: 'Samplewordx', pos: 'noun', pron: 'SAMP-pron', meaning: 'SAMPLEMEANING', example: 'SAMPLEEXAMPLE', synonyms: 'SAMPLESYNONYMS', origin: '' } };
const sampleAgenda = () => schedule({
  start: '1800', buffer: 3, gap: 1, chair: '', end: '', next_meeting: '2031-03-18',
  roles: { tmod: 'SAMPLETMOD', ge: 'SAMPLEGE', grammarian: 'SAMPLEGRAM', ah: 'SAMPLEAH', timer: 'SAMPLETIMER', ttm: 'SAMPLETTM' },
  blocks: JSON.parse(JSON.stringify(STD_BLOCKS)),
  speeches: [{ role_id: 1, name: 'SAMPLESPEAKERA', project_line: 'Presentation Mastery (L1P1)', project_name: 'SAMPLEPROJECTA', title: 'SAMPLETITLEA', length: '5 - 7 min', evaluator: 'SAMPLEEVALA' },
    { role_id: 2, name: 'SAMPLESPEAKERB', project_line: 'Presentation Mastery (L1P2)', project_name: 'SAMPLEPROJECTB', title: 'SAMPLETITLEB', length: '5 - 7 min', evaluator: 'SAMPLEEVALB' }],
  reports: { items: [{ role: 'Grammarian', min: '3 min' }, { role: 'Ah Counter', min: '1 min' }, { role: 'Timer', min: '1 min' }, { role: 'General Evaluator', min: '3 min' }] },
});
/** which parts of the file Brekkie can fill: the file is filled with made-up values and each one is looked for in the result */
export async function checkDocx(buf) {
  const { found, text } = await fillDocx(buf, sampleAgenda(), SAMPLE_CTX);
  const has = (s) => text.includes(s);
  const parts = [
    ['date', 'Meeting date', has('4 March 2031')], ['theme', 'Theme', has('SAMPLETHEME')], ['quote', 'Quotation', has('SAMPLEQUOTE')],
    ['next', 'Next meeting date', has('March 18')], ['word', 'Word of the day', has('SAMPLEMEANING') && has('SAMPLEEXAMPLE') && has('SAMPLESYNONYMS')],
    ['roles', 'Role takers', ['SAMPLETMOD', 'SAMPLEGE', 'SAMPLEGRAM', 'SAMPLEAH', 'SAMPLETIMER', 'SAMPLETTM'].every(has)],
    ['order', 'Running order', has('Meeting Called To Order') && has('Meeting Adjourned') && found.running_order],
    ['speeches', 'Prepared speeches', has('SAMPLESPEAKERA') && has('SAMPLEEVALB') && has('SAMPLETITLEB')],
  ].map(([key, label, ok]) => ({ key, label, found: !!ok }));
  // a club number is optional, so it is not listed as missing
  return { parts, usable: parts.filter((p) => p.found).length >= 4 && parts.find((p) => p.key === 'order').found && parts.find((p) => p.key === 'roles').found, club_number: has('7654321') };
}
