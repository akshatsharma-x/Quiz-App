/* Student dashboard: stats, cohort quizzes with live state, recent results, realtime updates */
(async () => {
  const { requireAuth, api, html, setHTML, icon, fmt, toast, debounce, $, $$ } = QM;

  const user = await requireAuth({ role: 'user' });
  const { socket } = await QMShell.mount({ active: 'dashboard', user });

  let quizzes = [];
  let clockOffset = 0;
  let filter = 'all';
  const now = () => Date.now() + clockOffset;

  // ---- Header ------------------------------------------------------------------------------
  const first = user.name.split(' ')[0];
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  setHTML($('#greeting'), html`${fmt.greeting()}, <span>${first}</span>`);
  setHTML($('#cohortChips'), [user.program, user.branch, user.batchYear, user.semester, `Section ${user.section}`]
    .map((c) => html`<span class="badge badge-outline">${c}</span>`));

  // ---- Overview (stats, tier, recent results) ------------------------------------------------
  const renderOverview = (o) => {
    const s = o.stats;
    const tier = s.tier;
    setHTML($('#tierCard'), html`
      <div class="tier-top">
        <div class="tier-name">
          <span class="tier-gem" style="color:${tier.color}">${icon('award')}</span>
          <div><strong>${tier.name} tier</strong><span>${tier.next ? `${fmt.number(tier.next.xpNeeded)} XP to ${tier.next.name}` : 'Highest tier reached'}</span></div>
        </div>
        <div class="tier-xp">${fmt.compact(s.xp)}<small>XP</small></div>
      </div>
      <div class="meter" role="meter" aria-label="Progress to next tier" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${tier.progress}"><span data-w="${tier.progress}"></span></div>
      <div class="tier-foot">
        <span class="streak">${icon('zap', 'icon-sm')}${s.streak ? `${s.streak}-day streak` : 'Start a streak today'}</span>
        <span>${tier.next ? `${tier.progress}% to ${tier.next.name}` : 'Legend status'}</span>
      </div>`);

    const tiles = [
      { label: 'Total XP', value: fmt.compact(s.xp), meta: `${tier.name} tier`, ic: 'zap' },
      { label: 'Global rank', value: s.rank ? `#${s.rank}` : '—', meta: s.rank ? `of ${fmt.number(s.rankedStudents)} ranked students` : 'Finish a quiz to get ranked', ic: 'award' },
      { label: 'Quizzes completed', value: fmt.number(s.quizzesTaken), meta: s.quizzesTaken ? `${s.passed} passed` : 'None yet', ic: 'check-circle' },
      { label: 'Average score', value: s.avgPercentage === null ? '—' : fmt.pct(s.avgPercentage, 1), meta: s.bestPercentage === null ? 'No scored quizzes yet' : `Best ${fmt.pct(s.bestPercentage, 1)}`, ic: 'target' },
      { label: 'Day streak', value: `${s.streak}`, unit: s.streak === 1 ? 'day' : 'days', meta: s.streak ? 'Keep it going tomorrow' : 'Take a quiz to begin', ic: 'activity' }
    ];
    setHTML($('#stats'), tiles.map((t, i) => html`
      <div class="card stat reveal" style="--d:${i * 0.04}s">
        <div class="stat-top"><span class="stat-label">${t.label}</span><span class="stat-icon">${icon(t.ic)}</span></div>
        <div class="stat-value">${t.value}${t.unit ? html`<small>${t.unit}</small>` : ''}</div>
        <div class="stat-meta">${t.meta}</div>
      </div>`));

    const recent = o.recentResults;
    setHTML($('#recentResults'), recent.length
      ? recent.map((r) => html`
        <div class="result-item">
          <div>
            ${r.quizType === 'google_form' || !r.quizId
              ? html`<span class="truncate" style="font-weight:650">${r.quizTitle}</span>`
              : html`<a href="student-result.html?quizId=${r.quizId}">${r.quizTitle}</a>`}
            <small>${fmt.dateTime(r.submittedAt)}${r.quizType === 'google_form' ? ' · External form' : ` · ${r.score}/${r.totalPossibleScore} pts`}</small>
          </div>
          <div class="row" style="gap:.5rem">
            ${r.quizType === 'google_form'
              ? html`<span class="badge badge-good">${icon('check', 'icon-sm')}Submitted</span>`
              : html`<span class="pct">${fmt.pct(r.percentage, 1)}</span><span class="badge ${r.passed ? 'badge-good' : 'badge-critical'}">${icon(r.passed ? 'check' : 'x', 'icon-sm')}${r.passed ? 'Pass' : 'Fail'}</span>`}
          </div>
          ${r.quizType === 'google_form' ? '' : html`<div class="meter meter-sm"><span data-w="${r.percentage}"></span></div>`}
        </div>`)
      : html`<div class="empty" style="padding:1.5rem .5rem"><div class="empty-icon">${icon('trending')}</div><h3>No results yet</h3><p>Your scores will appear here after your first quiz.</p></div>`);

    requestAnimationFrame(() => $$('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; }));
  };

  const loadOverview = async () => {
    try {
      renderOverview((await api('/student/overview')).data);
    } catch (err) {
      toast(err.message, { type: 'error', title: 'Could not load your stats' });
    }
  };

  // ---- Quizzes ---------------------------------------------------------------------------------
  const stateOf = (q) => {
    const t = now();
    if (q.attempt && q.attempt.status === 'submitted') return 'done';
    if (t < new Date(q.startTime).getTime()) return 'scheduled';
    if (t > new Date(q.endTime).getTime()) return 'ended';
    if (q.attempt && q.attempt.status === 'in_progress') return 'progress';
    return 'live';
  };

  const countdown = (target, prefix) => html`<span data-countdown="${new Date(target).getTime()}" data-prefix="${prefix}">${prefix} ${fmt.countdown(new Date(target).getTime() - now())}</span>`;

  const quizRow = (q) => {
    const st = stateOf(q);
    const external = q.type === 'google_form';
    const meta = [];
    if (!external) {
      meta.push(html`<span>${icon('help')}${q.questionCount} question${q.questionCount === 1 ? '' : 's'}</span>`);
      meta.push(html`<span>${icon('clock')}${q.timeLimit} min</span>`);
    } else {
      meta.push(html`<span>${icon('external')}External form</span>`);
    }
    meta.push(html`<span>${icon('calendar')}${fmt.dateTime(q.startTime)} – ${fmt.dateTime(q.endTime)}</span>`);

    let badge = '';
    let side = '';
    const examHref = external ? `external-quiz.html?quizId=${q._id}` : `student-exam.html?quizId=${q._id}`;
    if (st === 'live') {
      badge = html`<span class="badge badge-critical badge-live">Live</span>`;
      side = html`<a class="btn btn-primary" href="${examHref}">${icon(external ? 'external' : 'play', 'icon-sm')}${external ? 'Open form' : 'Start quiz'}</a>
                  <span class="when">${countdown(q.endTime, 'Closes in')}</span>`;
    } else if (st === 'progress') {
      badge = html`<span class="badge badge-warning">${icon('clock', 'icon-sm')}In progress</span>`;
      side = html`<a class="btn btn-primary" href="${examHref}">${icon('play', 'icon-sm')}Resume</a>
                  <span class="when">${countdown(q.attempt.deadline, 'Time left')}</span>`;
    } else if (st === 'scheduled') {
      badge = html`<span class="badge badge-info">Upcoming</span>`;
      side = html`<button class="btn btn-secondary" type="button" disabled>${icon('lock', 'icon-sm')}Not open yet</button>
                  <span class="when">${countdown(q.startTime, 'Opens in')}</span>`;
    } else if (st === 'done') {
      badge = html`<span class="badge badge-good">${icon('check', 'icon-sm')}Completed</span>`;
      side = external
        ? html`<span class="when">Submitted ${fmt.relative(q.attempt.submittedAt)}</span>`
        : html`<span class="score-chip">${q.attempt.score}/${q.attempt.totalPossibleScore}</span>
               <a class="btn btn-secondary btn-sm" href="student-result.html?quizId=${q._id}">View result</a>`;
    } else {
      badge = html`<span class="badge">Closed</span>`;
      side = html`<span class="when">Closed ${fmt.relative(q.endTime)}</span>`;
    }
    const iconName = { live: 'play', progress: 'clock', scheduled: 'calendar', done: 'check-circle', ended: 'lock' }[st];
    return html`
      <div class="quiz-row is-${st}" data-quiz="${q._id}">
        <div class="quiz-icon">${icon(external && st !== 'done' ? 'link' : iconName)}</div>
        <div class="quiz-main">
          <h3>${q.title} ${badge}</h3>
          ${q.description ? html`<p class="desc" title="${q.description}">${q.description}</p>` : ''}
          <div class="quiz-meta">${meta}</div>
        </div>
        <div class="quiz-side">${side}</div>
      </div>`;
  };

  const ORDER = { progress: 0, live: 1, scheduled: 2, done: 3, ended: 4 };
  const EMPTY = {
    all: ['You’re all caught up', 'No quizzes are scheduled for your cohort right now. New quizzes appear here instantly.'],
    live: ['Nothing live right now', 'Live quizzes you can start will show up here.'],
    scheduled: ['No upcoming quizzes', 'When faculty schedule a quiz for your cohort, you’ll see it here.'],
    done: ['Nothing completed yet', 'Quizzes you submit this term show up here.']
  };

  const renderQuizzes = () => {
    const list = quizzes
      .map((q) => ({ q, st: stateOf(q) }))
      .filter(({ st }) => st !== 'ended')
      .filter(({ st }) => filter === 'all' || (filter === 'live' ? (st === 'live' || st === 'progress') : filter === 'done' ? st === 'done' : st === filter))
      .sort((a, b) => ORDER[a.st] - ORDER[b.st] || new Date(a.q.startTime) - new Date(b.q.startTime));

    if (!list.length) {
      const [title, text] = EMPTY[filter];
      setHTML($('#quizList'), html`<div class="empty"><div class="empty-icon">${icon(filter === 'done' ? 'check-circle' : 'inbox')}</div><h3>${title}</h3><p>${text}</p></div>`);
    } else {
      setHTML($('#quizList'), list.map(({ q }) => quizRow(q)));
    }

    const states = quizzes.map(stateOf);
    const live = states.filter((s) => s === 'live' || s === 'progress').length;
    const next = quizzes.filter((q) => stateOf(q) === 'scheduled').sort((a, b) => new Date(a.startTime) - new Date(b.startTime))[0];
    $('#welcomeLine').textContent = live
      ? `You have ${live} quiz${live === 1 ? '' : 'zes'} open right now. Good luck!`
      : next ? `Your next quiz, “${next.title}”, opens ${fmt.relative(new Date(next.startTime).getTime(), now())}.`
        : 'You’re all caught up — no quizzes pending for your cohort.';
  };

  const loadQuizzes = async () => {
    try {
      const r = await api('/student/my-quizzes');
      if (r.profileIncomplete) { location.replace('profile-setup.html'); return; }
      clockOffset = new Date(r.serverNow).getTime() - Date.now();
      quizzes = r.data;
      renderQuizzes();
    } catch (err) {
      setHTML($('#quizList'), html`<div class="empty"><div class="empty-icon">${icon('wifi-off')}</div><h3>Couldn’t load quizzes</h3><p>${err.message}</p><button class="btn btn-secondary" id="retryQuizzes">${icon('refresh', 'icon-sm')}Retry</button></div>`);
      const retry = $('#retryQuizzes');
      if (retry) retry.addEventListener('click', loadQuizzes);
    }
  };

  $('#quizFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    $$('#quizFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderQuizzes();
  });

  // Live countdowns; re-render when a quiz opens or closes
  let lastStates = '';
  setInterval(() => {
    $$('[data-countdown]').forEach((el) => {
      el.textContent = `${el.dataset.prefix} ${fmt.countdown(Number(el.dataset.countdown) - now())}`;
    });
    const states = quizzes.map(stateOf).join();
    if (states !== lastStates) {
      if (lastStates) renderQuizzes();
      lastStates = states;
    }
  }, 1000);

  await Promise.all([loadOverview(), loadQuizzes()]);
  lastStates = quizzes.map(stateOf).join();

  // ---- Realtime -----------------------------------------------------------------------------------
  if (socket) {
    const refreshQuizzes = debounce(loadQuizzes, 400);
    const refreshOverview = debounce(loadOverview, 1500);
    socket.on('quiz:new', (q) => {
      if (!quizzes.some((x) => x._id === q._id)) quizzes.push({ ...q, attempt: null });
      renderQuizzes();
      toast(`“${q.title}” ${new Date(q.startTime).getTime() > now() ? `opens ${fmt.relative(q.startTime)}` : 'is live now'}.`, { type: 'brand', title: 'New quiz published' });
    });
    socket.on('quiz:updated', refreshQuizzes);
    socket.on('quiz:deleted', ({ _id }) => { quizzes = quizzes.filter((q) => q._id !== _id); renderQuizzes(); });
    socket.on('leaderboard:update', refreshOverview);
    socket.on('connect', refreshQuizzes); // catch up after reconnecting
  }
})();
