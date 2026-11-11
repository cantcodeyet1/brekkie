// The agenda page works out start times as it is edited; it must agree with the server (server/test/agenda.test.js).
import { describe, expect, it } from 'vitest';
import { clock, maxMinutes, schedule, shown, toHhmm } from '../src/pages/agendaTimes.js';

describe('agenda times', () => {
  it('slots a speech by its longest time plus the buffer', () => {
    const ag = schedule({ start: '1800', buffer: 3, gap: 1, blocks: [{ id: 's', type: 'speeches' }, { id: 'a', type: 'item', min: 5 }], speeches: [{ length: '5 - 7 min' }, { length: '10 - 12 min' }, { length: '5 - 7 min' }] });
    expect(ag.speeches.map((s) => s.time)).toEqual(['1800', '1810', '1825']);
    expect(ag.blocks[1].time).toBe('1835');
  });
  it('follows a fixed time and reports how far over a finish time it runs', () => {
    const ag = schedule({ start: '1800', buffer: 3, gap: 2, end: '1900', blocks: [{ id: 'a', type: 'item', min: 5 }, { id: 'b', type: 'item', min: 5, at: '1900' }, { id: 'c', type: 'item', min: 0 }], speeches: [] });
    expect(ag.blocks.map((b) => b.time)).toEqual(['1800', '1900', '1907']);
    expect(ag.ends).toBe('1907'); expect(ag.over).toBe(7);
  });
  it('wraps past midnight and reads and shows times', () => {
    expect(schedule({ start: '2350', gap: 0, blocks: [{ id: 'a', type: 'item', min: 20 }, { id: 'b', type: 'item', min: 0 }], speeches: [] }).blocks[1].time).toBe('0010');
    expect(toHhmm('2460')).toBe(''); expect(toHhmm('1800')).toBe('1800');
    expect(shown('1805')).toBe('18:05'); expect(shown('xx')).toBe('');
    expect(maxMinutes('4 – 6 min')).toBe(6); expect(clock(85)).toBe('1 h 25 min'); expect(clock(40)).toBe('40 min');
  });
});
