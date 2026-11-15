import { useCallback, useEffect, useState } from 'react';

const KEY = 'brekkie_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { cache.clear(); try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

// the last answer for each address, so moving between tabs shows the page at once and refreshes it behind the scenes
const cache = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(path, { method, body, token }) {
  const t = token ?? getToken();
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(t ? { 'x-token': t } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw Object.assign(new Error(e.error || res.statusText), { status: res.status });
  }
  return res.json();
}

export async function api(path, { method = 'GET', body, token } = {}) {
  // Reading is safe to repeat: a server that was asleep, or a dropped connection, usually answers on the second or third go.
  // Anything that changes data is sent once.
  const tries = method === 'GET' ? 3 : 1;
  for (let i = 1; ; i++) {
    try { return await once(path, { method, body, token }); }
    catch (e) { if (i >= tries || (e.status && e.status < 500)) throw e; await wait(500 * i); }
  }
}

export function useApi(path, { token } = {}) {
  const key = `${token ?? getToken() ?? ''}|${path}`;
  const [state, setState] = useState(() => (cache.has(key) ? { data: cache.get(key), error: null, loading: false } : { data: null, error: null, loading: true }));
  const load = useCallback(async () => {
    try { const data = await api(path, { token }); cache.set(key, data); setState({ data, error: null, loading: false }); }
    catch (error) { setState((s) => (s.data && !error.status ? s : { data: null, error, loading: false })); }
  }, [path, token, key]);
  useEffect(() => { setState(cache.has(key) ? { data: cache.get(key), error: null, loading: false } : { data: null, error: null, loading: true }); load(); }, [load, key]);
  return { ...state, reload: load, setData: (data) => { cache.set(key, data); setState((s) => ({ ...s, data })); } };
}
