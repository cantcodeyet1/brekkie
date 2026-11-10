import { describe, it, expect } from 'vitest';
import { secs, mmss, cardOf, cap, sum, mean, fmtDate, longDate, evalFormUrl } from '../src/data.js';
import { parseCsv, cleanPhone, pathFromCredentials, fromClubCentral, toMembers, PATH_CODES } from '../src/roster.js';

describe('time helpers', () => {
  it('secs parses m:ss and rejects junk', () => {
    expect(secs('5:30')).toBe(330);
    expect(secs(' 0:05 ')).toBe(5);
    for (const bad of ['', null, undefined, 'abc', '5', '5:300']) expect(secs(bad)).toBeNull();
  });
  it('mmss formats seconds', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(65)).toBe('1:05');
    expect(mmss(600)).toBe('10:00');
  });
  it('cardOf picks the timing card', () => {
    const lim = [300, 360, 420];
    expect(cardOf(null, lim)).toBeNull();
    expect(cardOf(200, lim)).toBe('under');
    expect(cardOf(300, lim)).toBe('green');
    expect(cardOf(360, lim)).toBe('yellow');
    expect(cardOf(420, lim)).toBe('red');
    expect(cardOf(900, lim)).toBe('red');
  });
});

describe('small helpers', () => {
  it('cap capitalises the first letter', () => { expect(cap('um')).toBe('Um'); expect(cap('')).toBe(''); });
  it('sum totals counts, optionally by key, ignoring junk', () => {
    expect(sum({ ah: 2, um: 3 })).toBe(5);
    expect(sum({ ah: 2, um: 3 }, ['ah'])).toBe(2);
    expect(sum({ ah: '4', um: 'x' })).toBe(4);
    expect(sum(null)).toBe(0);
  });
  it('mean averages and survives an empty list', () => { expect(mean([2, 4])).toBe(3); expect(mean([])).toBe(0); });
  it('dates format in en-GB without commas', () => {
    expect(fmtDate('2026-11-13', { day: 'numeric', month: 'short' })).toBe('13 Nov');
    expect(longDate('2026-11-13')).toBe('13 Nov 2026');
    expect(fmtDate('2026-11-13')).toBe('Fri 13 Nov');
  });
});

describe('roster import', () => {
  it('parseCsv handles quotes, embedded commas and newlines, BOM and blank lines', () => {
    const rows = parseCsv('﻿Name,Note\r\n"Doe, Jane","said ""hi""\nthere"\r\n\r\nSam,ok\n');
    expect(rows).toEqual([{ Name: 'Doe, Jane', Note: 'said "hi"\nthere' }, { Name: 'Sam', Note: 'ok' }]);
    expect(parseCsv('')).toEqual([]);
  });
  it('cleanPhone turns local Zimbabwe numbers into +263 and keeps international ones', () => {
    expect(cleanPhone('0771234567')).toBe('+263771234567');
    expect(cleanPhone('+44 7700 900123')).toBe('+447700900123');
    expect(cleanPhone('00263771234567')).toBe('+263771234567');
    expect(cleanPhone('')).toBe('');
    expect(cleanPhone('abc')).toBe('');
  });
  it('pathFromCredentials reads PM3 style codes', () => {
    expect(pathFromCredentials('DTM PM3')).toEqual({ path_name: PATH_CODES.PM, levels_done: 3 });
    expect(pathFromCredentials('PM2, EH4')).toEqual({ path_name: PATH_CODES.EH, levels_done: 4 });
    expect(pathFromCredentials('PM5 EH2').path_name).toBe(PATH_CODES.EH);
    expect(pathFromCredentials('ZZ3')).toBeNull();
    expect(pathFromCredentials('')).toBeNull();
  });
  it('fromClubCentral builds import rows and toMembers keeps only those switched on', () => {
    const csv = 'Customer ID,Name,Email,Mobile Phone,Credentials,Pathways Enrolled\n1,Ann  Lee,ANN@X.COM,0771234567,PM2,Yes\n2,,x@y.com,,,No\n3,Bob,,,,No';
    const rows = fromClubCentral(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Ann Lee', email: 'ann@x.com', phone: '+263771234567', path_name: PATH_CODES.PM, levels_done: 2, enrolled: true, guessed: true });
    expect(rows[1]).toMatchObject({ name: 'Bob', guessed: false, enrolled: false });
    rows[1].on = false;
    expect(toMembers(rows).map((m) => m.name)).toEqual(['Ann Lee']);
  });
});

describe('evalFormUrl', () => {
  const one = { page: 'https://x/page', pdf: '/eval-forms/a.pdf', forms: ['/eval-forms/a.pdf'] };
  const two = { page: 'https://x/page', pdf: '/eval-forms/b.pdf', forms: ['/eval-forms/b.pdf', '/eval-forms/b-2.pdf'] };
  it('uses our own copy', () => expect(evalFormUrl(one, 1)).toBe('/eval-forms/a.pdf'));
  it('picks the form for the speech being evaluated', () => {
    expect(evalFormUrl(two, 1)).toBe('/eval-forms/b.pdf');
    expect(evalFormUrl(two, 2)).toBe('/eval-forms/b-2.pdf');
  });
  it('defaults to the first form and clamps out-of-range speech numbers', () => {
    expect(evalFormUrl(two)).toBe('/eval-forms/b.pdf');
    expect(evalFormUrl(two, 0)).toBe('/eval-forms/b.pdf');
    expect(evalFormUrl(two, 9)).toBe('/eval-forms/b-2.pdf');
    expect(evalFormUrl(one, 3)).toBe('/eval-forms/a.pdf');
  });
  it('falls back to the Toastmasters page, and to nothing', () => {
    expect(evalFormUrl({ page: 'https://x/page', pdf: null }, 1)).toBe('https://x/page');
    expect(evalFormUrl(undefined, 1)).toBeNull();
    expect(evalFormUrl({}, 1)).toBeNull();
  });
});
