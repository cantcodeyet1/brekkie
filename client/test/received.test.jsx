import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReceivedPage } from '../src/pages/Vpe.jsx';
import { DeskProvider, ToastProvider } from '../src/ui.jsx';

const profile = (received = {}) => ({
  person: { id: 7, name: 'Sam Speaker' },
  received: { gram: [], fill: [], time: [], roleFeedback: [], peer: [], ...received },
});

function mockApi(body, status = 200) {
  globalThis.fetch = vi.fn(async () => ({ ok: status < 400, status, statusText: 'x', json: async () => body }));
}
function show(kind) {
  return render(
    <MemoryRouter initialEntries={[`/v/members/7/received/${kind}`]}>
      <DeskProvider><ToastProvider>
        <Routes><Route path="/v/members/:id/received/:kind" element={<ReceivedPage />} /></Routes>
      </ToastProvider></DeskProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.setItem('brekkie_token', 'tok'); });

describe('ReceivedPage', () => {
  it('lists filler words as chips with a total, most used first, and no PDF', async () => {
    mockApi(profile({ fill: [{ id: 1, date: '2026-04-17', by: 'Devon Park', counts: { ah: 2, so: 4, um: 0 }, comment: 'Fewer than last time.' }] }));
    const { container } = show('fill');
    expect(await screen.findByRole('heading', { name: 'Filler words' })).toBeTruthy();
    const chips = [...container.querySelectorAll('.fchip')].map((c) => c.textContent);
    expect(chips).toEqual(['So4', 'Ah2', 'Total6']);          // sorted, zero counts left out, total last
    expect(screen.getByText('Fewer than last time.')).toBeTruthy();
    expect(screen.getByText(/17 Apr · Devon Park/)).toBeTruthy();
    expect(container.querySelector('iframe, embed, object')).toBeNull();
    expect(screen.getByText('1 entry')).toBeTruthy();
  });

  it('marks good points green and improvements red for the General Evaluator', async () => {
    mockApi(profile({ roleFeedback: [{ id: 1, role: 'Speaker 1', date: '2026-04-17', well: 'Great stride', improve: 'Start from the lectern edge' }] }));
    const { container } = show('general');
    await screen.findByRole('heading', { name: 'From the General Evaluator' });
    expect(container.querySelector('.pt.good').textContent).toBe('Great stride');
    expect(container.querySelector('.pt.bad').textContent).toBe('Start from the lectern edge');
    // no wording tags in front of the text: the colour carries the meaning
    expect(container.querySelector('.pt em')).toBeNull();
  });

  it('shows only the sides that were written', async () => {
    mockApi(profile({ peer: [{ id: 1, date: '2026-04-17', from_name: '', well: 'Warm opening', improve: '' }] }));
    const { container } = show('room');
    await screen.findByRole('heading', { name: 'From the room' });
    expect(container.querySelectorAll('.pt.good')).toHaveLength(1);
    expect(container.querySelectorAll('.pt.bad')).toHaveLength(0);
    expect(screen.getByText(/Anonymous/)).toBeTruthy();
  });

  it('grammar notes: liked is green, to-polish is red with the arrow between wrong and better', async () => {
    mockApi(profile({ gram: [{ id: 1, date: '2026-04-17', by: 'Gwen', liked: 'assiduous', improper: 'less people', suggestion: 'fewer people' }] }));
    const { container } = show('gram');
    await screen.findByRole('heading', { name: 'Grammar notes' });
    expect(container.querySelector('.pt.good').textContent).toBe('assiduous');
    expect(container.querySelector('.pt.bad').textContent).toBe('less people → fewer people');
  });

  it('timing shows the card colour dot and the time', async () => {
    mockApi(profile({ time: [{ id: 1, date: '2026-04-17', by: 'Tim', seconds: 395, green: 300, yellow: 360, red: 420, comment: '' }] }));
    const { container } = show('time');
    await screen.findByRole('heading', { name: 'Timing' });
    expect(container.querySelector('.dot.yellow')).toBeTruthy();
    expect(container.textContent).toContain('6:35');
  });

  it('says so when there is nothing yet, and pluralises the count', async () => {
    mockApi(profile());
    show('fill');
    expect(await screen.findByText('Nothing yet.')).toBeTruthy();
    expect(screen.getByText('0 entries')).toBeTruthy();
  });

  it('an unknown kind shows an error, not a crash', async () => {
    mockApi(profile());
    show('nonsense');
    expect(await screen.findByText('Not found')).toBeTruthy();
  });

  it('a failed request shows the server message', async () => {
    mockApi({ error: 'Not found' }, 404);
    show('fill');
    await waitFor(() => expect(screen.getByText('Not found')).toBeTruthy());
  });

  it('asks the API for the right person with the saved token', async () => {
    mockApi(profile());
    show('fill');
    await screen.findByText('Nothing yet.');
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/vpe/people/7/profile');
    expect(init.headers['x-token']).toBe('tok');
  });

  it('renders every entry as a list row', async () => {
    const fill = Array.from({ length: 5 }, (_, i) => ({ id: i, date: '2026-04-1' + i, by: 'X', counts: { ah: i + 1 } }));
    mockApi(profile({ fill }));
    const { container } = show('fill');
    await screen.findByRole('heading', { name: 'Filler words' });
    const list = container.querySelector('.recgrid');
    expect(within(list).getAllByText(/· X/)).toHaveLength(5);
    expect(list.querySelectorAll('.rec-card')).toHaveLength(5);
  });
});
