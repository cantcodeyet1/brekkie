import { useCallback, useEffect, useState } from 'react';

const KEY = 'brekkie_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

export async function api(path, { method = 'GET', body, token } = {}) {
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

export function useApi(path, { token } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    try { const data = await api(path, { token }); setState({ data, error: null, loading: false }); }
    catch (error) { setState({ data: null, error, loading: false }); }
  }, [path, token]);
  useEffect(() => { setState({ data: null, error: null, loading: true }); load(); }, [load]);
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}
