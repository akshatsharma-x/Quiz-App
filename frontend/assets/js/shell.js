/* =====================================================================================
   Student app shell: top navigation, notification centre, user menu, mobile tab bar.
   Usage: const { socket } = await QMShell.mount({ active: 'dashboard', user });
   ===================================================================================== */
(function () {
  'use strict';
  const { html, setHTML, icon, fmt, api, toast, bindPopover, initials, theme, logout, connectSocket, $ } = window.QM;

  const LINKS = [
    { id: 'dashboard', href: 'student-dashboard.html', label: 'Dashboard', icon: 'home' },
    { id: 'analytics', href: 'student-analytics.html', label: 'Analytics', icon: 'chart' },
    { id: 'leaderboard', href: 'student-leaderboard.html', label: 'Leaderboard', icon: 'award' }
  ];

  const PRIORITY_ICON = { info: 'megaphone', important: 'alert', urgent: 'alert' };

  const mount = async ({ active, user }) => {
    const host = document.getElementById('appNav');
    host.className = 'topnav';
    setHTML(host, html`
      <div class="container">
        <a class="brand" href="student-dashboard.html" aria-label="QuizMUJ home">
          <span class="brand-mark" aria-hidden="true">Q</span><span>Quiz<b>MUJ</b></span>
        </a>
        <nav class="nav-links" aria-label="Primary">
          ${LINKS.map((l) => html`<a class="nav-link ${l.id === active ? 'active' : ''}" href="${l.href}" ${l.id === active ? html`aria-current="page"` : ''}>${icon(l.icon)}${l.label}</a>`)}
        </nav>
        <div class="nav-actions">
          <button class="icon-btn" type="button" id="themeBtn" aria-label="Toggle theme" title="Toggle theme">${icon(theme.get() === 'dark' ? 'sun' : 'moon')}</button>
          <div style="position:relative">
            <button class="icon-btn" type="button" id="bellBtn" aria-label="Notifications">${icon('bell')}<span class="count" id="bellCount" hidden>0</span></button>
            <div class="popover notif-panel" id="notifPanel" role="dialog" aria-label="Notifications">
              <header><strong>Notifications</strong><span class="badge" id="notifMeta">Loading…</span></header>
              <div class="notif-list" id="notifList"><div class="empty"><div class="loader-ring" style="margin:auto"></div></div></div>
            </div>
          </div>
          <div style="position:relative">
            <button class="user-chip" type="button" id="userBtn" aria-label="Account menu">
              <span class="avatar avatar-sm">${initials(user.name)}</span><span class="name truncate">${user.name.split(' ')[0]}</span>${icon('chevron-down', 'icon-sm')}
            </button>
            <div class="popover" id="userMenu" role="menu">
              <div class="menu-head"><strong>${user.name}</strong><span>${user.email}</span></div>
              <div class="menu-sep"></div>
              <a class="menu-item" href="profile-setup.html" role="menuitem">${icon('user')}My profile</a>
              <a class="menu-item" href="student-analytics.html" role="menuitem">${icon('chart')}My performance</a>
              <button class="menu-item" type="button" id="menuTheme" role="menuitem">${icon('moon')}Switch theme</button>
              <div class="menu-sep"></div>
              <button class="menu-item danger" type="button" id="menuLogout" role="menuitem">${icon('logout')}Sign out</button>
            </div>
          </div>
        </div>
      </div>`);

    // Mobile tab bar
    const tabbar = document.createElement('nav');
    tabbar.className = 'mobile-tabbar';
    tabbar.setAttribute('aria-label', 'Primary');
    setHTML(tabbar, [...LINKS, { id: 'profile', href: 'profile-setup.html', label: 'Profile', icon: 'user' }]
      .map((l) => html`<a href="${l.href}" class="${l.id === active ? 'active' : ''}">${icon(l.icon)}${l.label}</a>`));
    document.body.appendChild(tabbar);
    document.body.classList.add('has-tabbar');
    QM.showDemoBanner(user);

    const themeBtn = $('#themeBtn');
    const syncThemeIcon = () => setHTML(themeBtn, icon(theme.get() === 'dark' ? 'sun' : 'moon'));
    themeBtn.addEventListener('click', () => { theme.toggle(); syncThemeIcon(); });
    $('#menuTheme').addEventListener('click', () => { theme.toggle(); syncThemeIcon(); });
    $('#menuLogout').addEventListener('click', logout);
    bindPopover($('#userBtn'), $('#userMenu'));

    // ---- Notification centre ----------------------------------------------------------
    const countEl = $('#bellCount');
    const listEl = $('#notifList');
    const metaEl = $('#notifMeta');
    let items = [];
    let unread = 0;

    const setCount = (n) => {
      unread = Math.max(0, n);
      countEl.hidden = unread === 0;
      countEl.textContent = unread > 9 ? '9+' : String(unread);
      $('#bellBtn').setAttribute('aria-label', unread ? `Notifications (${unread} unread)` : 'Notifications');
    };
    const renderList = () => {
      metaEl.textContent = items.length ? `${items.length} recent` : 'All caught up';
      if (!items.length) {
        setHTML(listEl, html`<div class="empty"><div class="empty-icon">${icon('inbox')}</div><h3>No announcements yet</h3><p>Messages from your faculty will appear here.</p></div>`);
        return;
      }
      setHTML(listEl, items.map((a) => html`
        <div class="notif-item ${a.priority || 'info'} ${a.unread ? 'unread' : ''}">
          <div class="notif-icon">${icon(PRIORITY_ICON[a.priority] || 'megaphone', 'icon-sm')}</div>
          <div class="grow">
            <h5>${a.title || 'Announcement'}</h5>
            <p>${a.message}</p>
            <time datetime="${a.createdAt}" title="${fmt.dateTime(a.createdAt)}">${a.author ? `${a.author} · ` : ''}${fmt.relative(a.createdAt)}</time>
          </div>
        </div>`));
    };
    const load = async () => {
      try {
        const r = await api('/student/announcements');
        items = r.data;
        setCount(r.unread);
        renderList();
      } catch (e) {
        setHTML(listEl, html`<div class="empty"><p>Couldn't load notifications.</p></div>`);
      }
    };
    bindPopover($('#bellBtn'), $('#notifPanel'), {
      onOpen: async () => {
        renderList();
        if (unread) {
          setCount(0);
          api('/student/announcements/seen', { method: 'POST' }).catch(() => {});
          setTimeout(() => { items = items.map((a) => ({ ...a, unread: false })); }, 4000);
        }
      }
    });
    load();

    // ---- Real-time ----------------------------------------------------------------------
    const socket = await connectSocket();
    if (socket) {
      socket.on('announcement', (a) => {
        items = [{ ...a, unread: true }, ...items].slice(0, 25);
        setCount(unread + 1);
        renderList();
        toast(a.message, { type: a.priority === 'urgent' ? 'warning' : 'brand', title: a.title || 'Announcement', timeout: 8000 });
      });
    }
    return { socket };
  };

  window.QMShell = { mount };
})();
