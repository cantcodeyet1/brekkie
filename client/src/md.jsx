/* a small, safe subset of markdown for notes: # headings, > quotes, - lists, **bold**, *italic*. Nothing is ever injected as HTML. */
export function parseMd(text) {
  const blocks = [];
  let para = null, list = null, quote = null;
  const flush = () => { para = null; list = null; quote = null; };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); blocks.push({ t: 'h', n: m[1].length, text: m[2] }); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { para = null; list = null; if (!quote) blocks.push(quote = { t: 'q', lines: [] }); quote.lines.push(m[1]); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { para = null; quote = null; if (!list) blocks.push(list = { t: 'ul', items: [] }); list.items.push(m[1]); continue; }
    list = null; quote = null;
    if (!para) blocks.push(para = { t: 'p', lines: [] });
    para.lines.push(line);
  }
  return blocks;
}

/* **bold** and *italic* inside a line */
export function inline(s) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={k++}>{inline(m[1])}</strong> : <em key={k++}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const lines = (ls) => ls.map((l, i) => <span key={i}>{i > 0 && <br />}{inline(l)}</span>);

export function Md({ text }) {
  return (
    <div className="md">
      {parseMd(text).map((b, i) => {
        if (b.t === 'h') { const H = `h${b.n + 2}`; return <H key={i}>{inline(b.text)}</H>; }
        if (b.t === 'q') return <blockquote key={i}>{lines(b.lines)}</blockquote>;
        if (b.t === 'ul') return <ul key={i}>{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>;
        return <p key={i}>{lines(b.lines)}</p>;
      })}
    </div>
  );
}
