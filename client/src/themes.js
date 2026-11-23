// The colours a club can choose for its side bar, from the Toastmasters brand palette. Each is three stops of one gradient, darkest
// first. `light` ones are pale, so the side bar's text turns dark. `blue` is Brekkie's own and the default.
export const THEMES = [
  { key: 'blue', name: 'Loyal Blue', c: ['#00263d', '#004165', '#0a5a85'] },
  { key: 'maroon', name: 'Rich Maroon', c: ['#3B0104', '#781327', '#a02d45'] },
  { key: 'yellow', name: 'Happy Yellow', c: ['#E4CC4C', '#F2DF74', '#F9F0B4'], light: true },
  { key: 'grey', name: 'Cool Gray', c: ['#A9B2B1', '#C9CFCE', '#F5F5F5'], light: true },
  { key: 'black', name: 'Black', c: ['#000000', '#1c1c1c', '#3d3d3d'] },
];
const byKey = (k) => THEMES.find((t) => t.key === k) || THEMES[0];
/** the CSS variables the side bar reads */
export const themeVars = (key) => { const [d, m, l] = byKey(key).c; return { '--sd': d, '--sm': m, '--sl': l }; };
/** a small gradient for a swatch */
export const themeGradient = (key) => { const [d, m, l] = byKey(key).c; return `linear-gradient(135deg, ${d} 0%, ${m} 55%, ${l} 100%)`; };
export const isLight = (key) => !!byKey(key).light;
