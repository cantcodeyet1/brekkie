import { describe, expect, it } from 'vitest';
import { parseMd } from '../src/md.jsx';

describe('note markdown', () => {
  it('reads headings, quotes, lists and paragraphs', () => {
    const b = parseMd('# Why\nShe joined for her sister\n\n> "I want to be calm"\n> on stage\n\n- pace\n- eye contact');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'q', 'ul']);
    expect(b[0]).toMatchObject({ n: 1, text: 'Why' });
    expect(b[2].lines).toHaveLength(2);
    expect(b[3].items).toEqual(['pace', 'eye contact']);
  });
  it('leaves other text as plain paragraphs', () => {
    expect(parseMd('#nospace\n**bold** text')).toEqual([{ t: 'p', lines: ['#nospace', '**bold** text'] }]);
  });
});
