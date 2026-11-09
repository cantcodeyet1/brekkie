import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); localStorage.clear(); });

// jsdom has no layout engine, so it reports a desktop-width screen. Give the browser APIs the app touches a harmless stand-in
window.matchMedia ||= (q) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.scrollTo ||= () => {};
Element.prototype.scrollTo ||= () => {};
Element.prototype.scrollIntoView ||= () => {};
globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
