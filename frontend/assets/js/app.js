/* =====================================================================================
   QuizMUJ core client library (window.QM)
   Loaded synchronously in <head> on every page so the theme applies before first paint.
   ===================================================================================== */
(function () {
  'use strict';

  // ---- Theme (applied immediately – no flash) ---------------------------------------
  const THEME_KEY = 'theme';
  const root = document.documentElement;
  const applyTheme = (t) => root.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  applyTheme(localStorage.getItem(THEME_KEY));

  const theme = {
    get: () => root.getAttribute('data-theme'),
    set(t) {
      applyTheme(t);
      localStorage.setItem(THEME_KEY, theme.get());
      window.dispatchEvent(new CustomEvent('qm:themechange', { detail: theme.get() }));
    },
    toggle() { theme.set(theme.get() === 'dark' ? 'light' : 'dark'); }
  };

  // ---- Config -----------------------------------------------------------------------
  // Same-origin when served by the API (npm start) or behind the nginx proxy (docker).
  // Static dev servers (VS Code Live Server etc.) talk to the API on :5001.
  const API_ORIGIN = (() => {
    if (window.QUIZMUJ_API_ORIGIN) return window.QUIZMUJ_API_ORIGIN.replace(/\/$/, '');
    const { protocol, hostname, port } = window.location;
    if (protocol === 'file:') return 'http://localhost:5001';
    if (['5500', '5501', '5502', '5173', '3000', '8000'].includes(port)) return `${protocol}//${hostname}:5001`;
    return window.location.origin;
  })();
  const API_BASE = `${API_ORIGIN}/api/v1`;

  // ---- HTML escaping & safe templating ----------------------------------------------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

  class SafeHtml {
    constructor(s) { this.value = s; }
    toString() { return this.value; }
  }
  const raw = (s) => new SafeHtml(String(s ?? ''));
  const renderValue = (v) => {
    if (v instanceof SafeHtml) return v.value;
    if (Array.isArray(v)) return v.map(renderValue).join('');
    if (v === null || v === undefined || v === false) return '';
    return escapeHtml(v);
  };
  // Tagged template: every interpolation is escaped unless wrapped with raw()/html``
  const html = (strings, ...values) =>
    raw(strings.reduce((out, str, i) => out + str + (i < values.length ? renderValue(values[i]) : ''), ''));
  // Null-safe: async re-renders may resolve after their view was replaced
  const setHTML = (el, content) => { if (el) el.innerHTML = renderValue(content); return el; };

  // ---- DOM helpers --------------------------------------------------------------------
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const debounce = (fn, ms = 250) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';
  const setLoading = (btn, loading) => {
    if (!btn) return;
    if (!btn.querySelector('.spinner')) btn.insertAdjacentHTML('beforeend', '<span class="spinner" aria-hidden="true"></span>');
    btn.classList.toggle('is-loading', loading);
    btn.disabled = loading;
    btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  };
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---- Icons (Feather icon set, MIT) ---------------------------------------------------
  const ICONS = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>',
    'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    trending: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
    'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
    'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    'wifi-off': '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    stop: '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    rotate: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
    'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
    key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'
  };
  const icon = (name, cls = '') => raw(
    `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.info}</svg>`
  );

  // ---- Session ------------------------------------------------------------------------
  const TOKEN_KEY = 'quizmuj_token';
  const USER_KEY = 'quizmuj_user';
  const decodeJwt = (token) => {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(atob(payload).split('').map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`).join('')));
    } catch (e) {
      return null;
    }
  };
  const session = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    get user() {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
    },
    set(token, user) {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    setUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)); },
    clear() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem('quizmuj_admin_context');
      sessionStorage.removeItem('quizmuj_admin_context_skipped');
    },
    isValid() {
      const t = session.token;
      if (!t) return false;
      const p = decodeJwt(t);
      return Boolean(p && (!p.exp || p.exp * 1000 > Date.now() + 5000));
    }
  };

  // ---- Navigation -----------------------------------------------------------------------
  const currentPage = () => (window.location.pathname.split('/').pop() || 'index.html') + window.location.search;
  const safeNext = (next) => (next && /^[a-z0-9-]+\.html(\?[\w=&%.-]*)?$/i.test(next) ? next : null);
  const homeFor = (user) => {
    if (!user) return 'login.html';
    if (user.role === 'admin') return 'admin.html';
    return user.profileComplete ? 'student-dashboard.html' : 'profile-setup.html';
  };
  const flash = (message, type = 'info') => sessionStorage.setItem('quizmuj_flash', JSON.stringify({ message, type }));
  const consumeFlash = () => {
    const f = sessionStorage.getItem('quizmuj_flash');
    if (!f) return null;
    sessionStorage.removeItem('quizmuj_flash');
    try { return JSON.parse(f); } catch (e) { return null; }
  };
  let redirecting = false;
  const redirectToLogin = (message) => {
    if (redirecting) return;
    redirecting = true;
    session.clear();
    if (message) flash(message, 'warning');
    const next = currentPage();
    const isAuthPage = /^(login|register|index)\.html/.test(next);
    window.location.replace(`login.html${isAuthPage ? '' : `?next=${encodeURIComponent(next)}`}`);
  };
  const logout = async () => {
    const ok = await confirmDialog({ title: 'Sign out?', message: 'You will need to sign in again to access QuizMUJ.', confirmText: 'Sign out', icon: 'logout' });
    if (!ok) return;
    session.clear();
    flash('You have been signed out.', 'success');
    window.location.href = 'login.html';
  };

  // ---- API client -----------------------------------------------------------------------
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data || {};
    }
  }

  const api = async (path, { method = 'GET', body, auth = true, raw: rawResponse = false, signal, on401 = 'redirect' } = {}) => {
    const headers = {};
    if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
        signal
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError('Cannot reach the QuizMUJ server. Check your connection and try again.', 0);
    }

    if (res.status === 401 && auth && on401 === 'redirect') {
      let msg = 'Your session has ended. Please sign in again.';
      try { msg = (await res.clone().json()).error || msg; } catch (e) { /* ignore */ }
      redirectToLogin(msg);
      throw new ApiError(msg, 401);
    }

    if (rawResponse) {
      if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch (e) { /* ignore */ }
        throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
      }
      return res;
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
    }
    return data;
  };

  // ---- Guards -----------------------------------------------------------------------------
  const pending = () => new Promise(() => {});
  /**
   * Ensures a valid session (and role). Resolves with the fresh user from /auth/me.
   * Students without an academic profile are routed to profile setup.
   */
  const requireAuth = async ({ role, allowIncompleteProfile = false } = {}) => {
    if (!session.isValid()) {
      redirectToLogin(session.token ? 'Your session has expired. Please sign in again.' : 'Please sign in to continue.');
      return pending();
    }
    const cached = session.user;
    if (role && cached && cached.role !== role) {
      window.location.replace(homeFor(cached));
      return pending();
    }
    let user;
    try {
      user = (await api('/auth/me')).data;
      session.setUser(user);
    } catch (err) {
      if (err.status === 403) {
        redirectToLogin(err.message);
        return pending();
      }
      if (err.status === 0 && cached) {
        toast('You appear to be offline. Some data may be out of date.', { type: 'warning' });
        user = cached;
      } else {
        throw err;
      }
    }
    if (role && user.role !== role) {
      window.location.replace(homeFor(user));
      return pending();
    }
    if (user.role === 'user' && !user.profileComplete && !allowIncompleteProfile) {
      window.location.replace('profile-setup.html');
      return pending();
    }
    return user;
  };

  // ---- Toasts -------------------------------------------------------------------------------
  const TOAST_ICONS = { success: 'check-circle', error: 'x-circle', warning: 'alert', info: 'info', brand: 'megaphone' };
  const toast = (message, { type = 'info', title, timeout = 4800 } = {}) => {
    let stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    setHTML(el, html`
      <div class="toast-icon">${icon(TOAST_ICONS[type] || 'info', 'icon-sm')}</div>
      <div class="toast-body">${title ? html`<strong>${title}</strong>` : ''}<p>${message}</p></div>
      <button class="toast-close" type="button" aria-label="Dismiss">${icon('x', 'icon-sm')}</button>`);
    const close = () => {
      if (el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 260);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    stack.appendChild(el);
    while (stack.children.length > 4) stack.firstElementChild.remove();
    if (timeout) setTimeout(close, timeout);
    return { close };
  };

  // ---- Modals -------------------------------------------------------------------------------
  let modalDepth = 0;
  const modalStack = []; // only the topmost modal reacts to the keyboard
  const openModal = ({ title, description, body = '', footer = '', size = '', dismissible = true, onClose, iconName, iconTone } = {}) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
    setHTML(backdrop, html`
      <div class="modal ${size ? `modal-${size}` : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="modal-head">
          <div>
            ${iconName ? html`<div class="modal-icon ${iconTone || ''}">${icon(iconName)}</div>` : ''}
            <h2 id="${titleId}">${title}</h2>
            ${description ? html`<p>${description}</p>` : ''}
          </div>
          ${dismissible ? html`<button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button>` : ''}
        </div>
        <div class="modal-body"></div>
        ${footer ? html`<div class="modal-foot"></div>` : ''}
      </div>`);
    const bodyEl = backdrop.querySelector('.modal-body');
    const footEl = backdrop.querySelector('.modal-foot');
    if (body instanceof Node) bodyEl.appendChild(body); else setHTML(bodyEl, body);
    if (footEl) { if (footer instanceof Node) footEl.appendChild(footer); else setHTML(footEl, footer); }

    const previouslyFocused = document.activeElement;
    let closed = false;
    const close = (result) => {
      if (closed) return;
      closed = true;
      backdrop.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      const idx = modalStack.indexOf(backdrop);
      if (idx >= 0) modalStack.splice(idx, 1);
      setTimeout(() => {
        backdrop.remove();
        modalDepth--;
        if (!modalDepth) document.body.classList.remove('modal-open');
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      }, 200);
      if (onClose) onClose(result);
    };
    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== backdrop) return; // a modal is stacked above us
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', backdrop)
          .filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissible) close(); });
    $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', () => close()));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    modalStack.push(backdrop);
    modalDepth++;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      const first = backdrop.querySelector('[autofocus], .modal-body input, .modal-body select, .modal-body textarea, .modal-foot .btn-primary, .modal-foot .btn-danger, .modal-foot button');
      if (first) first.focus();
    });
    return { el: backdrop, bodyEl, footEl, close };
  };

  // Resolves true (confirm) / false (cancel or dismiss). With dismissible:false the user must choose.
  const confirmDialog = ({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, icon: iconName, dismissible = true } = {}) =>
    new Promise((resolve) => {
      const m = openModal({
        title,
        dismissible,
        iconName: iconName || (danger ? 'alert' : 'help'),
        iconTone: danger ? 'danger' : '',
        body: message ? html`<p class="muted">${message}</p>` : '',
        footer: html`<button class="btn btn-secondary" type="button" data-cancel>${cancelText}</button>
                     <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok>${confirmText}</button>`,
        onClose: (r) => resolve(r === true)
      });
      m.footEl.querySelector('[data-cancel]').addEventListener('click', () => m.close(false));
      m.footEl.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
      setTimeout(() => m.footEl.querySelector('[data-ok]').focus(), 60);
    });

  // ---- Popovers (menus) ---------------------------------------------------------------------
  const bindPopover = (trigger, popover, { onOpen } = {}) => {
    const setOpen = (open) => {
      popover.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (open && onOpen) onOpen();
    };
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !popover.classList.contains('open');
      $$('.popover.open').forEach((p) => { if (p !== popover) p.classList.remove('open'); });
      setOpen(open);
    });
    popover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popover.classList.contains('open')) { setOpen(false); trigger.focus(); } });
    return { close: () => setOpen(false), open: () => setOpen(true) };
  };

  // ---- Formatting -------------------------------------------------------------------------------
  const toDate = (d) => (d instanceof Date ? d : new Date(d));
  const fmt = {
    date: (d) => toDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    dateShort: (d) => toDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    time: (d) => toDate(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    dateTime: (d) => {
      const x = toDate(d);
      const sameYear = x.getFullYear() === new Date().getFullYear();
      return x.toLocaleString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
    },
    number: (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString()),
    compact: (n) => {
      if (n === null || n === undefined) return '—';
      return Math.abs(n) < 10000 ? Number(n).toLocaleString() : Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    },
    pct: (n, digits = 0) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(Number.isInteger(n) ? 0 : digits)}%`),
    duration: (sec) => {
      sec = Math.max(0, Math.round(sec || 0));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h) return `${h}h ${m}m`;
      if (m) return s ? `${m}m ${s}s` : `${m}m`;
      return `${s}s`;
    },
    clock: (sec) => {
      sec = Math.max(0, Math.floor(sec));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const pad = (v) => String(v).padStart(2, '0');
      return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    },
    // "in 2h 15m", "5m ago", "3 days ago"
    relative: (d, now = Date.now()) => {
      const diff = toDate(d).getTime() - now;
      const abs = Math.abs(diff);
      const future = diff > 0;
      const min = Math.round(abs / 60000);
      let text;
      if (abs < 45000) return future ? 'in a few seconds' : 'just now';
      if (min < 60) text = `${min}m`;
      else if (min < 60 * 24) {
        const h = Math.floor(min / 60);
        const m = min % 60;
        text = m && h < 6 ? `${h}h ${m}m` : `${h}h`;
      } else {
        const days = Math.round(min / 1440);
        text = `${days} day${days === 1 ? '' : 's'}`;
      }
      return future ? `in ${text}` : `${text} ago`;
    },
    countdown: (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (d) return `${d}d ${h}h ${m}m`;
      if (h) return `${h}h ${m}m ${String(sec).padStart(2, '0')}s`;
      return `${m}m ${String(sec).padStart(2, '0')}s`;
    },
    toInputValue: (d) => {
      const x = toDate(d);
      const pad = (v) => String(v).padStart(2, '0');
      return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
    },
    greeting: () => {
      const h = new Date().getHours();
      if (h < 5) return 'Burning the midnight oil';
      if (h < 12) return 'Good morning';
      if (h < 17) return 'Good afternoon';
      return 'Good evening';
    },
    cohort: (u) => [u.program, u.branch, u.batchYear, u.semester, u.section && `Section ${u.section}`].filter(Boolean).join(' · ')
  };

  const targetLabel = (q) => {
    const parts = [];
    if (q.targetProgram && q.targetProgram !== 'All') parts.push(q.targetProgram);
    if (q.targetBranch && q.targetBranch !== 'All') parts.push(q.targetBranch);
    if (q.targetBatchYear && q.targetBatchYear !== 'All') parts.push(q.targetBatchYear);
    if (q.targetSemester && q.targetSemester !== 'All') parts.push(q.targetSemester.replace('Semester ', 'Sem '));
    if (q.targetSection && q.targetSection !== 'All') parts.push(`Sec ${q.targetSection}`);
    return parts.length ? parts.join(' · ') : 'All students';
  };

  const STATUS_BADGE = {
    live: ['badge-critical badge-live', 'Live'],
    scheduled: ['badge-info', 'Scheduled'],
    ended: ['', 'Ended'],
    inactive: ['badge-outline', 'Hidden']
  };
  const statusBadge = (status) => {
    const [cls, label] = STATUS_BADGE[status] || ['', status];
    return html`<span class="badge ${cls}">${label}</span>`;
  };

  // ---- Public app config (email domain, tiers, showcase demo logins) ----------------------------
  let configPromise = null;
  const config = () => {
    if (!configPromise) {
      configPromise = api('/meta/config', { auth: false })
        .then((r) => r.data)
        .catch((e) => { configPromise = null; throw e; });
    }
    return configPromise;
  };
  const isDemoEmail = (email) => /^demo\./i.test(String(email || ''));
  // Slim notice shown to visitors using the shared demo accounts of a public showcase
  const showDemoBanner = async (user) => {
    if (!user || !isDemoEmail(user.email)) return;
    try {
      const c = await config();
      if (!c.showcase) return;
      const bar = document.createElement('div');
      bar.className = 'demo-banner';
      setHTML(bar, html`${icon('info', 'icon-sm')}<span>You’re exploring the <strong>public demo</strong> as ${user.role === 'admin' ? 'faculty' : 'a student'}. Everyone shares these accounts and the data resets automatically.</span>`);
      document.body.prepend(bar);
    } catch (e) { /* offline – skip the banner */ }
  };

  // ---- Academic catalog ------------------------------------------------------------------------
  let catalogPromise = null;
  const academics = () => {
    if (!catalogPromise) {
      const cached = sessionStorage.getItem('quizmuj_catalog');
      if (cached) {
        try {
          const { at, data } = JSON.parse(cached);
          if (Date.now() - at < 3600 * 1000) catalogPromise = Promise.resolve(data);
        } catch (e) { /* ignore */ }
      }
      if (!catalogPromise) {
        catalogPromise = api('/meta/academics', { auth: false }).then((r) => {
          sessionStorage.setItem('quizmuj_catalog', JSON.stringify({ at: Date.now(), data: r.data }));
          return r.data;
        }).catch((e) => { catalogPromise = null; throw e; });
      }
    }
    return catalogPromise;
  };
  const fillSelect = (select, values, { placeholder, allLabel, selected, labels } = {}) => {
    const opts = [];
    if (placeholder) opts.push(html`<option value="" disabled ${selected ? '' : 'selected'}>${placeholder}</option>`);
    if (allLabel) opts.push(html`<option value="All">${allLabel}</option>`);
    values.forEach((v) => opts.push(html`<option value="${v}">${labels ? labels(v) : v}</option>`));
    setHTML(select, opts);
    if (selected !== undefined && selected !== null) {
      select.value = selected;
      if (select.value !== String(selected) && allLabel) select.value = 'All';
    }
  };
  /**
   * Wires five cascading targeting selects (Program → Branch/Batch/Semester).
   * `ids` maps field → select element. Each field supports 'All'.
   */
  const bindTargeting = async (els, initial = {}) => {
    const catalog = await academics();
    const programs = Object.keys(catalog.programs);
    const unionOf = (key) => Array.from(new Set(programs.flatMap((p) => catalog.programs[p][key])));
    fillSelect(els.program, programs, { allLabel: 'All programs', selected: initial.targetProgram || 'All' });
    const refresh = (keep = {}) => {
      const p = catalog.programs[els.program.value];
      fillSelect(els.branch, p ? p.branches : unionOf('branches'), { allLabel: 'All branches', selected: keep.targetBranch ?? els.branch.value ?? 'All' });
      fillSelect(els.batchYear, p ? p.batchYears : unionOf('batchYears').sort(), { allLabel: 'All batches', selected: keep.targetBatchYear ?? els.batchYear.value ?? 'All' });
      fillSelect(els.semester, p ? p.semesters : unionOf('semesters').sort((a, b) => parseInt(a.split(' ')[1], 10) - parseInt(b.split(' ')[1], 10)), { allLabel: 'All semesters', selected: keep.targetSemester ?? els.semester.value ?? 'All' });
    };
    fillSelect(els.section, catalog.sections, { allLabel: 'All sections', selected: initial.targetSection || 'All', labels: (s) => `Section ${s}` });
    refresh({
      targetBranch: initial.targetBranch || 'All',
      targetBatchYear: initial.targetBatchYear || 'All',
      targetSemester: initial.targetSemester || 'All'
    });
    els.program.addEventListener('change', () => refresh({}));
    return {
      value: () => ({
        targetProgram: els.program.value || 'All',
        targetBranch: els.branch.value || 'All',
        targetBatchYear: els.batchYear.value || 'All',
        targetSemester: els.semester.value || 'All',
        targetSection: els.section.value || 'All'
      }),
      set: (t) => {
        els.program.value = t.targetProgram || 'All';
        refresh({ targetBranch: t.targetBranch || 'All', targetBatchYear: t.targetBatchYear || 'All', targetSemester: t.targetSemester || 'All' });
        els.section.value = t.targetSection || 'All';
      }
    };
  };

  // ---- Socket.io ----------------------------------------------------------------------------------
  let socketPromise = null;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  const connectSocket = () => {
    if (!socketPromise) {
      socketPromise = (window.io ? Promise.resolve() : loadScript(`${API_ORIGIN}/socket.io/socket.io.min.js`))
        .then(() => {
          const socket = window.io(API_ORIGIN, {
            auth: (cb) => cb({ token: session.token }),
            transports: ['websocket', 'polling'],
            reconnectionDelay: 1000,
            reconnectionDelayMax: 8000
          });
          socket.on('connect_error', (err) => {
            if (err && err.message === 'unauthorized' && !session.isValid()) {
              redirectToLogin('Your session has ended. Please sign in again.');
            }
          });
          return socket;
        })
        .catch((err) => {
          socketPromise = null;
          console.warn('[QuizMUJ] Real-time connection unavailable:', err.message);
          return null;
        });
    }
    return socketPromise;
  };

  // ---- OTP input component ------------------------------------------------------------------------
  const otpInput = (container, { length = 6, onComplete } = {}) => {
    container.classList.add('otp');
    setHTML(container, Array.from({ length }, (_, i) =>
      // No maxlength: OS one-time-code autofill inserts the whole code into the first box
      html`<input type="text" inputmode="numeric" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1}" pattern="[0-9]*">`));
    const inputs = $$('input', container);
    const value = () => inputs.map((i) => i.value).join('');
    const check = () => { if (value().length === length && onComplete) onComplete(value()); };
    const fill = (digits, start = 0) => {
      digits.split('').slice(0, length - start).forEach((d, k) => { inputs[start + k].value = d; });
      const next = Math.min(start + digits.length, length - 1);
      inputs[next].focus();
      check();
    };
    inputs.forEach((input, i) => {
      input.addEventListener('input', (e) => {
        container.classList.remove('has-error');
        // A single keystroke into a filled box replaces it; longer input (paste/OS autofill) is spread out
        if (e.inputType === 'insertText' && e.data) input.value = e.data;
        const digits = input.value.replace(/\D/g, '');
        if (digits.length > 1) { input.value = ''; fill(digits, i); return; }
        input.value = digits;
        if (digits && i < length - 1) inputs[i + 1].focus();
        check();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && i > 0) { inputs[i - 1].focus(); inputs[i - 1].value = ''; e.preventDefault(); }
        if (e.key === 'ArrowLeft' && i > 0) { inputs[i - 1].focus(); e.preventDefault(); }
        if (e.key === 'ArrowRight' && i < length - 1) { inputs[i + 1].focus(); e.preventDefault(); }
      });
      input.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (text) { e.preventDefault(); fill(text, 0); }
      });
      input.addEventListener('focus', () => input.select());
    });
    return {
      value,
      clear() { inputs.forEach((i) => { i.value = ''; }); inputs[0].focus(); },
      focus() { (inputs.find((i) => !i.value) || inputs[length - 1]).focus(); },
      setError(on) { container.classList.toggle('has-error', on); }
    };
  };

  // ---- Password strength --------------------------------------------------------------------------
  const passwordStrength = (pw = '') => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const level = Math.min(4, Math.max(pw ? 1 : 0, score - 1));
    return { score: level, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][level] };
  };
  const validPassword = (pw) => typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  // Same pattern as the server: plain address characters, linear-time
  const validEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v);

  // ---- Footer year & misc bootstrap ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    const syncToggles = () => $$('[data-theme-toggle]').forEach((btn) => {
      setHTML(btn, icon(theme.get() === 'dark' ? 'sun' : 'moon'));
      btn.setAttribute('aria-label', theme.get() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    });
    $$('[data-theme-toggle]').forEach((btn) => btn.addEventListener('click', () => { theme.toggle(); syncToggles(); }));
    syncToggles();
    // Messages queued before a redirect (pages that render their own flash consume it first)
    const pendingFlash = consumeFlash();
    if (pendingFlash) setTimeout(() => toast(pendingFlash.message, { type: pendingFlash.type }), 300);
  });

  window.QM = {
    API_ORIGIN,
    API_BASE,
    ApiError,
    api,
    session,
    requireAuth,
    homeFor,
    safeNext,
    flash,
    consumeFlash,
    redirectToLogin,
    logout,
    theme,
    html,
    raw,
    setHTML,
    escapeHtml,
    icon,
    $,
    $$,
    debounce,
    initials,
    setLoading,
    downloadBlob,
    toast,
    openModal,
    confirmDialog,
    bindPopover,
    fmt,
    targetLabel,
    statusBadge,
    academics,
    config,
    isDemoEmail,
    showDemoBanner,
    fillSelect,
    bindTargeting,
    connectSocket,
    otpInput,
    passwordStrength,
    validPassword,
    validEmail
  };
})();
