import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClubPage, lookupClub } from '../src/clubLookup.js';

const PAGE = `<html><head><title>Toastmasters International -Champions</title></head><body><h1>Champions</h1>Club meets:<p>Friday,\uFFFD6:00 PM - 8:00 PM</p>Club Number:\n04647453,\uFFFD129,\uFFFDArea\uFFFDC02<br>Charter Date: Apr. 23, 2015 Meeting Times: Friday\uFFFD6:00 PM - 8:00 PM Phone: +263 77 Location: Speciss College   Herbert Chitepo Avenue  Harare,\uFFFD\uFFFD  \uFFFDZimbabwe Membership Restriction: None</body></html>`;

test('reads area, division and district from a Find a Club page', () => {
  const c = parseClubPage(PAGE);
  assert.equal(c.name, 'Champions');
  assert.equal(c.region, 'Area 2, Division C, District 129');
  assert.equal(c.venue, 'Speciss College Herbert Chitepo Avenue Harare, Zimbabwe');
  assert.match(c.meets, /Friday/);
  assert.equal(parseClubPage('<html>nothing here</html>'), null);
});

test('a lookup only asks toastmasters.org, pads the number, and gives null on any failure', async () => {
  const urls = [];
  const ok = await lookupClub('4647453', async (u) => { urls.push(u); return { ok: true, text: async () => PAGE }; });
  assert.equal(ok.region, 'Area 2, Division C, District 129');
  assert.equal(urls[0], 'https://www.toastmasters.org/Find-a-Club/04647453-04647453');
  assert.equal(await lookupClub('9999991', async () => { throw new Error('offline'); }), null);
  assert.equal(await lookupClub('12', async () => { throw new Error('never'); }), null);
});
