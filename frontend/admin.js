/* =====================================================================================
   Faculty console shell: routing, realtime, Overview and Live monitor views.
   Other views register themselves from admin-quizzes.js and admin-manage.js.
   ===================================================================================== */
(() => {
  const { requireAuth, api, html, setHTML, icon, fmt, toast, initials, theme, logout, connectSocket, debounce, $, $$ } = QM;

  // ---- Shared admin namespace ----------------------------------------------------------
  const handlers = new Map();      // event -> Set(fn) for the active view
  const views = {};
  const state = { user: null, socket: null, live: [], alerts: [], online: 0, stats: null };

  const QMAdmin = {
    state,
    views,
    register: (id, view) => { views[id] = view; },
    // `scope` = the element the subscriber renders into; detached scopes are skipped, so a
    // view (or modal) that has been replaced can never react to events again.
    on(evt, fn, scope) {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt).add({ fn, scope });
    },
    emit(evt, payload) {
      (handlers.get(evt) || []).forEach(({ fn, scope }) => {
        if (scope && !scope.isConnected) return;
        try { fn(payload); } catch (e) { console.error(e); }
      });
    },
    context() {
      try { return JSON.parse(sessionStorage.getItem('quizmuj_admin_context') || 'null'); } catch (e) { return null; }
    },
    navigate(id) { if (location.hash !== `#${id}`) location.hash = id; else render(); },
    // Kebab action menu (handled by a single delegated listener below)
    actionMenu: (items) => html`
      <div class="action-menu">
        <button class="btn btn-ghost btn-sm btn-icon" type="button" data-menu aria-label="More actions" aria-haspopup="true" aria-expanded="false">${icon('more')}</button>
        <div class="popover" role="menu">${items.filter(Boolean).map((it) => (it === '-' ? html`<div class="menu-sep"></div>`
          : html`<button class="menu-item ${it.danger ? 'danger' : ''}" type="button" role="menuitem" data-action="${it.action}" data-id="${it.id}">${icon(it.icon)}${it.label}</button>`))}</div>
      </div>`,
    emptyRow: (cols, iconName, title, text) => html`<tr><td colspan="${cols}"><div class="empty"><div class="empty-icon">${icon(iconName)}</div><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}</div></td></tr>`,
    pager: (el, { page, pages, total, label = 'items' }, onChange) => {
      if (!el) return;
      setHTML(el, html`<span class="small subtle">${total} ${label}</span>
        <div class="row" style="gap:.4rem">
          <button class="btn btn-secondary btn-sm" type="button" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="small muted">Page ${page} of ${pages}</span>
          <button class="btn btn-secondary btn-sm" type="button" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
        </div>`);
      el.onclick = (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) onChange(Number(b.dataset.p)); };
    },
    quizStatusBadge: QM.statusBadge
  };
  window.QMAdmin = QMAdmin;

  // Delegated kebab menus
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-menu]');
    $$('.action-menu .popover.open').forEach((p) => {
      if (!trigger || p.previousElementSibling !== trigger) {
        p.classList.remove('open');
        p.previousElementSibling.setAttribute('aria-expanded', 'false');
      }
    });
    if (trigger) {
      const pop = trigger.nextElementSibling;
      const open = !pop.classList.contains('open');
      pop.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      // Flip upwards near the bottom of the viewport
      const rect = trigger.getBoundingClientRect();
      pop.style.top = rect.bottom > innerHeight - 320 ? 'auto' : '';
      pop.style.bottom = rect.bottom > innerHeight - 320 ? 'calc(100% + 6px)' : '';
      e.stopPropagation();
    } else if (e.target.closest('.action-menu .menu-item')) {
      const pop = e.target.closest('.popover');
      pop.classList.remove('open');
    }
  });

  // ---- Navigation --------------------------------------------------------------------------
  const NAV = [
    { id: 'overview', label: 'Overview', icon: 'activity' },
    { id: 'quizzes', label: 'Quizzes', icon: 'file' },
    { id: 'live', label: 'Live monitor', icon: 'monitor', count: true },
    { section: 'Content' },
    { id: 'bank', label: 'Question bank', icon: 'database' },
    { id: 'announcements', label: 'Announcements', icon: 'megaphone' },
    { section: 'People' },
    { id: 'students', label: 'Students & admins', icon: 'users' },
    { id: 'settings', label: 'Settings', icon: 'sliders' }
  ];

  const renderNav = () => {
    setHTML($('#sideNav'), NAV.map((n) => (n.section
      ? html`<div class="side-section">${n.section}</div>`
      : html`<a class="side-link" href="#${n.id}" data-nav="${n.id}">${icon(n.icon)}${n.label}${n.count ? html`<span class="count" id="liveCount" hidden>0</span>` : ''}</a>`)));
  };

  const renderContextCard = () => {
    const c = QMAdmin.context();
    setHTML($('#contextCard'), c
      ? html`<strong>Session context</strong>${QM.targetLabel(c)}${c.subjectName ? html`<br>${c.subjectName}` : ''}<br><a href="admin-wizard.html">Change context</a>`
      : html`<strong>No session context</strong>Pre-fill targeting for new quizzes.<br><a href="admin-wizard.html">Set up context</a>`);
  };

  const updateLiveBadge = () => {
    const el = $('#liveCount');
    if (!el) return;
    el.hidden = !state.live.length;
    el.textContent = state.live.length;
  };

  let currentView = null;
  const render = async () => {
    const id = (location.hash || '#overview').slice(1);
    const view = views[id] ? id : 'overview';
    handlers.clear();
    currentView = view;
    $$('.side-link').forEach((a) => {
      const on = a.dataset.nav === view;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const v = views[view];
    $('#viewTitle').textContent = v.title;
    document.title = `${v.title} · Faculty console | QuizMUJ`;
    closeSidebar();
    // A fresh root per navigation: listeners die with it, and a slow render of a view the
    // admin already left writes into a detached node instead of over the current view.
    const host = $('#view');
    const container = document.createElement('div');
    container.className = 'view-root';
    host.replaceChildren(container);
    setHTML(container, html`<div class="page-loader"><div class="loader-ring"></div></div>`);
    try {
      await v.render(container);
    } catch (err) {
      if (!container.isConnected) return;
      setHTML(container, html`<div class="empty"><div class="empty-icon">${icon('alert')}</div><h3>Couldn’t load ${v.title.toLowerCase()}</h3><p>${err.message}</p><button class="btn btn-secondary" type="button" data-retry>${icon('refresh', 'icon-sm')}Retry</button></div>`);
      container.querySelector('[data-retry]').addEventListener('click', render);
    }
    if (!container.isConnected) return;
    host.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  };

  const openSidebar = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
  const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };

  // ---- Overview view -------------------------------------------------------------------------
  QMAdmin.register('overview', {
    title: 'Overview',
    async render(el) {
      const data = (await api('/admin/stats')).data;
      state.stats = data;
      // Full name: faculty names often start with a title ("Dr. Meera Kapoor"), so a first-word greeting reads wrong
      const who = state.user.name;
      setHTML(el, html`
        <div class="view-head">
          <div><span class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span><h2 style="font-size:1.6rem;margin-top:.35rem">${fmt.greeting()}, ${who}</h2><p>Here’s what’s happening across QuizMUJ right now.</p></div>
          <div class="row wrap">
            <button class="btn btn-secondary" type="button" data-quick="announce">${icon('megaphone', 'icon-sm')}Broadcast</button>
            <button class="btn btn-secondary" type="button" data-quick="embed">${icon('link', 'icon-sm')}Embed form</button>
            <a class="btn btn-primary" href="create-quiz.html">${icon('plus', 'icon-sm')}New quiz</a>
          </div>
        </div>
        <section class="stats" id="ovStats"></section>
        <div class="ov-grid mt-3">
          <section class="card card-pad"><div id="activityChart"></div></section>
          <section class="card">
            <div class="card-head"><h2>${icon('monitor')}Live exam room</h2><a class="small" href="#live">Open monitor</a></div>
            <div class="card-body" id="ovLive"></div>
          </section>
        </div>
        <section class="card mt-3">
          <div class="card-head"><h2>${icon('inbox')}Latest submissions</h2><a class="small" href="#quizzes">All quizzes</a></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Student</th><th>Quiz</th><th class="num">Score</th><th>Integrity</th><th class="num">Submitted</th></tr></thead>
            <tbody id="ovRecent"></tbody>
          </table></div>
        </section>`);

      const drawStats = () => {
        const d = state.stats;
        const tiles = [
          { label: 'Students', value: fmt.compact(d.students.total), meta: html`<span class="delta-good">+${d.students.newThisWeek}</span> this week · ${fmt.number(d.students.verified)} verified`, ic: 'users' },
          { label: 'Live quizzes', value: d.quizzes.live, meta: `${d.quizzes.scheduled} scheduled · ${d.quizzes.total} total`, ic: 'play' },
          { label: 'Submissions', value: fmt.compact(d.submissions.total), meta: d.submissions.flagged ? html`<span class="delta-bad">${d.submissions.flagged} flagged</span> for review` : 'No integrity flags', ic: 'check-circle' },
          { label: 'Average score', value: d.submissions.averagePercentage === null ? '—' : fmt.pct(d.submissions.averagePercentage, 1), meta: 'Across native quizzes', ic: 'target' },
          { label: 'Online now', value: state.online, meta: `${state.live.length} taking an exam`, ic: 'wifi' }
        ];
        setHTML($('#ovStats'), tiles.map((t) => html`
          <div class="card stat"><div class="stat-top"><span class="stat-label">${t.label}</span><span class="stat-icon">${icon(t.ic)}</span></div>
          <div class="stat-value">${t.value}</div><div class="stat-meta">${t.meta}</div></div>`));
      };
      state.online = data.students.online;
      drawStats();

      QMCharts.columns($('#activityChart'), {
        title: 'Submissions',
        subtitle: 'Per day, last 14 days',
        data: data.activity.map((a) => ({ label: fmt.dateShort(`${a.date}T12:00:00`), value: a.submissions, date: a.date })),
        tooltipLabel: (d) => new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
        categoryName: 'Day',
        valueName: 'Submissions',
        labelLast: true
      });

      const drawLive = () => {
        const byQuiz = {};
        state.live.forEach((t) => { byQuiz[t.quizTitle] = (byQuiz[t.quizTitle] || 0) + 1; });
        const alerts = state.alerts.slice(0, 4);
        setHTML($('#ovLive'), html`
          <div class="row-between mb-2"><div><div class="stat-value">${state.live.length}</div><div class="small subtle">student${state.live.length === 1 ? '' : 's'} in an exam right now</div></div>
          <span class="badge ${state.live.length ? 'badge-critical badge-live' : ''}">${state.live.length ? 'Live' : 'Idle'}</span></div>
          ${Object.keys(byQuiz).length ? html`<div class="chip-list mb-2">${Object.entries(byQuiz).map(([t, n]) => html`<span class="badge badge-outline">${t} · ${n}</span>`)}</div>` : ''}
          <div class="small subtle mb-1">Recent proctoring alerts</div>
          ${alerts.length ? alerts.map((a) => html`<div class="row" style="gap:.6rem;padding:.4rem 0"><span class="dot ${a.type === 'focus_restored' ? 'dot-good' : 'dot-critical'}"></span><span class="small grow">${a.message}</span><span class="xsmall subtle nowrap">${fmt.time(a.timestamp)}</span></div>`)
            : html`<p class="small muted">No alerts this session.</p>`}`);
      };
      drawLive();

      setHTML($('#ovRecent'), data.recentSubmissions.length ? data.recentSubmissions.map((r) => html`
        <tr class="is-clickable" data-attempt="${r.resultId}">
          <td><div class="cell-user"><span class="avatar avatar-sm">${initials(r.student)}</span><div><strong>${r.student}</strong><span>${r.email}</span></div></div></td>
          <td>${r.quizTitle}</td>
          <td class="num">${r.percentage === null ? html`<span class="badge">External</span>` : html`<strong>${fmt.pct(r.percentage, 1)}</strong>`}</td>
          <td>${r.isFlagged ? html`<span class="badge badge-critical">${icon('flag', 'icon-sm')}Flagged</span>` : html`<span class="badge badge-good">${icon('shield', 'icon-sm')}Clean</span>`}</td>
          <td class="num small">${fmt.relative(r.submittedAt)}</td>
        </tr>`) : QMAdmin.emptyRow(5, 'inbox', 'No submissions yet', 'Results appear here the moment students submit.'));
      $('#ovRecent').addEventListener('click', (e) => {
        const row = e.target.closest('[data-attempt]');
        if (row && QMAdmin.openAttempt) QMAdmin.openAttempt(row.dataset.attempt);
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-quick]');
        if (!b) return;
        if (b.dataset.quick === 'embed' && QMAdmin.openEmbedModal) QMAdmin.openEmbedModal();
        if (b.dataset.quick === 'announce' && QMAdmin.openAnnouncementModal) QMAdmin.openAnnouncementModal();
      });

      const refresh = debounce(async () => {
        if (!$('#ovStats')) return; // navigated away
        try { state.stats = (await api('/admin/stats')).data; if ($('#ovStats')) drawStats(); } catch (e) { /* keep previous */ }
      }, 1200);
      QMAdmin.on('live', () => { drawLive(); drawStats(); }, el);
      QMAdmin.on('alert', drawLive, el);
      QMAdmin.on('presence', drawStats, el);
      QMAdmin.on('results', refresh, el);
      QMAdmin.on('quizzes', refresh, el);
    }
  });

  // ---- Live monitor view ------------------------------------------------------------------------
  const ALERT_ICON = { tab_switch: 'eye-off', window_blur: 'eye-off', full_screen_exit: 'maximize', copy_attempt: 'copy', focus_restored: 'eye', mouse_leave: 'eye-off' };
  QMAdmin.register('live', {
    title: 'Live monitor',
    async render(el) {
      state.live = (await api('/admin/live')).data;
      updateLiveBadge();
      setHTML(el, html`
        <div class="view-head">
          <div><h2>Live exam room</h2><p>Everyone currently inside an exam, updated in real time. Identities come from verified accounts.</p></div>
          <div class="row wrap" id="forceButtons"></div>
        </div>
        <div class="live-grid">
          <section class="card">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Student</th><th>Quiz</th><th>Progress</th><th class="num">Time left</th><th>Status</th></tr></thead>
              <tbody id="liveRows"></tbody>
            </table></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('shield')}Security feed</h2><button class="btn btn-ghost btn-sm" type="button" id="clearAlerts">Clear</button></div>
            <div class="alert-feed" id="alertFeed"></div>
          </section>
        </div>`);

      const STATUS = {
        active: ['dot-good', 'Active'],
        away: ['dot-critical', 'Away from exam'],
        offline: ['dot-warning', 'Disconnected']
      };
      const drawRows = () => {
        const rows = state.live;
        setHTML($('#liveRows'), rows.length ? rows.map((t) => {
          const [dot, label] = STATUS[t.status] || STATUS.active;
          const pct = t.total ? Math.round((t.answered / t.total) * 100) : 0;
          return html`<tr>
            <td><div class="cell-user"><span class="avatar avatar-sm">${initials(t.name)}</span><div><strong>${t.name}</strong><span>${t.email}</span><span>${t.cohort}</span></div></div></td>
            <td>${t.quizTitle}</td>
            <td><div class="taker-progress"><small>${t.answered}/${t.total} answered</small><div class="meter meter-sm"><span style="width:${pct}%"></span></div></div></td>
            <td class="num" data-deadline="${new Date(t.deadline).getTime()}">${fmt.clock(Math.max(0, (new Date(t.deadline).getTime() - Date.now()) / 1000))}</td>
            <td><div class="status-cell"><span class="status-chip"><span class="dot ${dot}"></span>${label}</span>
              ${t.violations ? html`<span class="badge ${t.violations > 3 ? 'badge-critical' : 'badge-warning'}">${icon('alert', 'icon-sm')}${t.violations} violation${t.violations === 1 ? '' : 's'}</span>` : html`<span class="badge badge-good">${icon('shield', 'icon-sm')}No violations</span>`}</div></td>
          </tr>`;
        }) : QMAdmin.emptyRow(5, 'monitor', 'No one is taking an exam', 'When students start a quiz they appear here instantly.'));

        const quizzes = {};
        rows.forEach((t) => { quizzes[t.quizId] = t.quizTitle; });
        setHTML($('#forceButtons'), Object.entries(quizzes).map(([id, title]) => html`<button class="btn btn-danger-soft" type="button" data-force="${id}" data-title="${title}">${icon('stop', 'icon-sm')}Force end “${title}”</button>`));
      };
      const drawAlerts = () => {
        setHTML($('#alertFeed'), state.alerts.length ? state.alerts.slice(0, 100).map((a) => html`
          <div class="alert-item ${a.type === 'focus_restored' ? 'restored' : a.type === 'copy_attempt' ? 'copy' : ''}">
            <span class="a-icon">${icon(ALERT_ICON[a.type] || 'alert', 'icon-sm')}</span>
            <div class="grow"><p><strong>${a.name}</strong> ${a.message.replace(a.name, '').trim()}</p><small>${a.quizTitle} · ${fmt.time(a.timestamp)}${a.type !== 'focus_restored' && a.type !== 'copy_attempt' ? ` · violation #${a.violations}` : ''}</small></div>
          </div>`) : html`<div class="empty"><div class="empty-icon">${icon('shield')}</div><h3>All quiet</h3><p>Tab switches, full-screen exits and copy attempts will stream in here.</p></div>`);
      };
      drawRows();
      drawAlerts();

      $('#forceButtons').addEventListener('click', (e) => {
        const b = e.target.closest('[data-force]');
        if (b && QMAdmin.forceEnd) QMAdmin.forceEnd(b.dataset.force, b.dataset.title);
      });
      $('#clearAlerts').addEventListener('click', () => { state.alerts = []; drawAlerts(); });

      const tick = setInterval(() => {
        if (!document.body.contains(el) || currentView !== 'live') { clearInterval(tick); return; }
        $$('[data-deadline]', el).forEach((c) => { c.textContent = fmt.clock(Math.max(0, (Number(c.dataset.deadline) - Date.now()) / 1000)); });
      }, 1000);
      QMAdmin.on('live', drawRows, el);
      QMAdmin.on('alert', drawAlerts, el);
    }
  });

  // ---- Boot ------------------------------------------------------------------------------------------
  const boot = async () => {
    const user = await requireAuth({ role: 'admin' });
    state.user = user;
    QM.showDemoBanner(user);
    renderNav();
    renderContextCard();
    $('#sideName').textContent = user.name;
    $('#sideEmail').textContent = user.email;
    $('#sideAvatar').textContent = initials(user.name);
    setHTML($('#topNewQuiz'), html`${icon('plus', 'icon-sm')}<span>New quiz</span>`);
    setHTML($('#menuBtn'), icon('menu'));
    setHTML($('#logoutBtn'), icon('logout'));
    const syncTheme = () => setHTML($('#themeBtn'), icon(theme.get() === 'dark' ? 'sun' : 'moon'));
    syncTheme();
    $('#themeBtn').addEventListener('click', () => { theme.toggle(); syncTheme(); });
    $('#logoutBtn').addEventListener('click', logout);
    $('#menuBtn').addEventListener('click', openSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    window.addEventListener('hashchange', render);

    // Realtime
    const socket = await connectSocket();
    state.socket = socket;
    const conn = $('#connStatus');
    const setConn = (on) => { conn.classList.toggle('on', on); conn.lastElementChild.textContent = on ? 'Live' : 'Reconnecting…'; };
    if (socket) {
      setConn(socket.connected);
      socket.on('connect', () => setConn(true));
      socket.on('disconnect', () => setConn(false));
      socket.on('live:update', (list) => { state.live = list; updateLiveBadge(); QMAdmin.emit('live', list); });
      socket.on('presence', (p) => { state.online = p.onlineStudents; QMAdmin.emit('presence', p); });
      let lastToast = 0;
      socket.on('live:alert', (a) => {
        state.alerts.unshift(a);
        state.alerts = state.alerts.slice(0, 200);
        QMAdmin.emit('alert', a);
        if (a.type !== 'focus_restored' && a.type !== 'copy_attempt' && Date.now() - lastToast > 4000 && currentView !== 'live') {
          lastToast = Date.now();
          toast(`${a.message} · ${a.quizTitle}`, { type: 'error', title: `Proctoring alert · violation #${a.violations}` });
        }
      });
      socket.on('results:new', (p) => QMAdmin.emit('results', p));
      socket.on('quizzes:changed', (p) => QMAdmin.emit('quizzes', p));
    } else {
      setConn(false);
    }
    render();
  };

  document.addEventListener('DOMContentLoaded', () => {
    boot().catch((err) => {
      setHTML($('#view'), html`<div class="empty"><div class="empty-icon">${icon('alert')}</div><h3>Couldn’t start the console</h3><p>${err.message}</p></div>`);
    });
  });
})();
