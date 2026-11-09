import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import { DeskProvider, ToastProvider } from '../src/ui.jsx';

// answers by URL: { '/api/session': [status, body], ... }
function mockRoutes(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const key = Object.keys(routes).find((k) => String(url).startsWith(k));
    const [status, body] = key ? routes[key] : [404, { error: 'Not found' }];
    return { ok: status < 400, status, statusText: 'x', json: async () => body };
  });
}
const at = (path) => render(
  <MemoryRouter initialEntries={[path]}><DeskProvider><ToastProvider><App /></ToastProvider></DeskProvider></MemoryRouter>,
);
const vpeSession = { type: 'vpe', person: { id: 1, name: 'Devon Park', is_vpe: true }, club: 'Champions Toastmasters Club', super: false };
const memberSession = { type: 'member', person: { id: 2, name: 'Demo Member' }, club: 'Champions Toastmasters Club', super: false };

beforeEach(() => localStorage.clear());

describe('routing and access', () => {
  it('shows the sign-in page to a stranger', async () => {
    mockRoutes({ '/api/session': [401, { error: 'No valid link' }], '/api/dev/accounts': [404, {}] });
    at('/');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('sends a stranger away from VPE and member areas', async () => {
    mockRoutes({ '/api/session': [401, { error: 'No valid link' }], '/api/dev/accounts': [404, {}], '/api/account': [401, {}] });
    localStorage.setItem('brekkie_token', 'stale');
    at('/v/members/5/received/fill');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('keeps a member out of the VPE area', async () => {
    mockRoutes({ '/api/session': [200, memberSession], '/api/account': [200, {}], '/api/me/': [500, { error: 'stub' }], '/api/vpe': [403, { error: 'VPE only' }] });
    localStorage.setItem('brekkie_token', 'member-token');
    at('/v/members/5/received/fill');
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => String(u).startsWith('/api/me/'))).toBe(true));
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).startsWith('/api/vpe/people/5/profile'))).toBe(false);
  });

  it('gives the VPE a way to their member page, and Super admin only when flagged', async () => {
    mockRoutes({ '/api/session': [200, vpeSession], '/api/account': [200, {}], '/api/vpe/people': [200, []] });
    localStorage.setItem('brekkie_token', 'vpe-token');
    const { container, unmount } = at('/v/members');
    await waitFor(() => expect(container.querySelector('.me-views')).toBeTruthy());
    const links = [...container.querySelectorAll('.me-views a')].map((a) => a.textContent);
    expect(links).toContain('My member page');
    expect(links).not.toContain('Super admin');
    unmount();

    mockRoutes({ '/api/session': [200, { ...vpeSession, super: true }], '/api/account': [200, {}], '/api/vpe/people': [200, []] });
    const again = at('/v/members');
    await waitFor(() => expect(again.container.querySelector('.me-views')).toBeTruthy());
    expect([...again.container.querySelectorAll('.me-views a')].map((a) => a.textContent)).toEqual(['Super admin', 'My member page']);
  });

  it('unknown paths fall back to the landing page', async () => {
    mockRoutes({ '/api/session': [401, {}], '/api/dev/accounts': [404, {}] });
    at('/no/such/page');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});
