// Theme toggle: "brightfield" (light) and "fluorescence" (dark).
// The inline script in <head> sets the initial theme before first paint.
(function () {
  'use strict';

  const root = document.documentElement;
  const button = document.querySelector('.theme-toggle');
  const label = button && button.querySelector('.theme-toggle__label');
  const NAMES = { light: 'brightfield', dark: 'fluorescence' };

  function savedTheme() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }

  function apply(theme, persist) {
    root.dataset.theme = theme;
    if (label) label.textContent = NAMES[theme];
    if (button) {
      const next = theme === 'dark' ? 'light' : 'dark';
      button.setAttribute('aria-label', 'Switch to ' + next + ' theme (' + NAMES[next] + ')');
    }
    if (persist) {
      try { localStorage.setItem('theme', theme); } catch (e) { /* storage unavailable; theme still applies */ }
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }

  apply(root.dataset.theme === 'dark' ? 'dark' : 'light', false);

  if (button) {
    button.addEventListener('click', function () {
      apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });
  }

  // Follow the OS setting until the visitor picks a theme themselves.
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  if (query.addEventListener) {
    query.addEventListener('change', function (event) {
      if (!savedTheme()) apply(event.matches ? 'dark' : 'light', false);
    });
  }

  // Assemble the email address in the browser so it never appears in the
  // HTML for scrapers. Without JavaScript the button falls back to LinkedIn.
  const email = document.getElementById('email-link');
  if (email && email.dataset.user && email.dataset.domain) {
    const address = email.dataset.user + '@' + email.dataset.domain;
    email.href = 'mailto:' + address;
    email.textContent = address;
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
