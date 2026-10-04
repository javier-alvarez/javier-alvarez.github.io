// Small helpers shared by mosaic.js and figures.js.
(function () {
  'use strict';

  const warned = new Set();

  // "#rgb" or "#rrggbb" to [r, g, b]. Anything else is logged once and drawn grey.
  function rgb(value) {
    const text = String(value).trim();
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (!match) {
      if (!warned.has(text)) {
        warned.add(text);
        console.warn('site: expected a hex colour, got "' + text + '"; drawing it grey');
      }
      return [128, 128, 128];
    }
    let hex = match[1];
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(c, alpha) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + alpha + ')';
  }

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  // mulberry32: small, fast, deterministic.
  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Call `fn` when the element's width changes. Mobile browsers fire resize
  // while scrolling (the URL bar moves), which changes only the height.
  function onWidthChange(el, fn) {
    let width = Math.round(el.getBoundingClientRect().width);
    let timer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        const next = Math.round(el.getBoundingClientRect().width);
        if (next && next !== width) { width = next; fn(next); }
      }, 150);
    });
  }

  window.SiteLib = { rgb: rgb, rgba: rgba, mix: mix, seeded: seeded, cssVar: cssVar, onWidthChange: onWidthChange };
})();
