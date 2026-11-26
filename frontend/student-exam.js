/* Proctored exam: lobby → focus mode → submission.
   The server owns the deadline; answers autosave to the server and to this device. */
(async () => {
  const { requireAuth, api, html, setHTML, icon, fmt, toast, openModal, connectSocket, debounce, session, $, $$ } = QM;

  const user = await requireAuth({ role: 'user' });
  const quizId = new URLSearchParams(location.search).get('quizId');

  // ---- State ---------------------------------------------------------------------------------
  let meta = null;               // quiz summary (GET /quizzes/:id)
  let attempt = null;            // POST /start payload
  let questions = [];
  let answers = {};              // questionId -> option text
  let review = {};               // questionId -> true
  let times = {};                // questionId -> seconds spent
  let current = 0;
  let clockOffset = 0;
  let deadline = 0;
  let violations = 0;
  let phase = 'loading';         // lobby | exam | submitting | done
  let changeSeq = 0;             // bumps on every local change …
  let savedSeq = 0;              // … and is acknowledged here once the server has it
  const isDirty = () => changeSeq !== savedSeq;
  let saving = false;
  let saveQueued = false;
  let socket = null;
  let shownAt = null;            // performance.now() when the current question became visible
  let fullscreenEntered = false;
  let lastCopyReport = 0;
  let warnedAt = { five: false, one: false };
  let lobbyTimer = null;

  const now = () => Date.now() + clockOffset;
  const storageKey = () => `quizmuj_exam_${attempt.attemptId}`;
  const q = () => questions[current];
  const answeredCount = () => questions.filter((x) => answers[x._id]).length;
  const LETTERS = 'ABCDEF';

  // ---- Overlay helper ----------------------------------------------------------------------------
  const overlay = ({ iconName = 'info', tone = '', title, text, actions = [] }) => {
    $('#loading').hidden = true;
    setHTML($('#overlayIcon'), iconName === 'spinner' ? html`<div class="loader-ring"></div>` : icon(iconName));
    $('#overlayIcon').className = `overlay-icon ${tone}`;
    $('#overlayTitle').textContent = title;
    $('#overlayText').textContent = text || '';
    const box = $('#overlayActions');
    box.innerHTML = '';
    actions.forEach((a) => {
      const b = document.createElement(a.href ? 'a' : 'button');
      b.className = `btn ${a.primary ? 'btn-primary' : 'btn-secondary'}`;
      b.textContent = a.label;
      if (a.href) b.href = a.href; else { b.type = 'button'; b.addEventListener('click', a.onClick); }
      box.appendChild(b);
    });
    $('#overlay').hidden = false;
  };
  const hideOverlay = () => { $('#overlay').hidden = true; };
  const backAction = { label: 'Back to dashboard', href: 'student-dashboard.html', primary: true };

  if (!quizId || !/^[a-f0-9]{24}$/i.test(quizId)) {
    overlay({ iconName: 'alert', tone: 'warning', title: 'Invalid quiz link', text: 'This link doesn’t point to a quiz. Open your quiz from the dashboard.', actions: [backAction] });
    return;
  }

  // ---- Load quiz summary ---------------------------------------------------------------------------
  try {
    const r = await api(`/quizzes/${quizId}`);
    meta = r.data;
    clockOffset = new Date(r.serverNow).getTime() - Date.now();
  } catch (err) {
    overlay({ iconName: 'alert', tone: 'warning', title: err.status === 404 ? 'Quiz not available' : 'Could not load the quiz', text: err.message, actions: [backAction] });
    return;
  }
  if (meta.type === 'google_form') { location.replace(`external-quiz.html?quizId=${quizId}`); return; }
  if (meta.attempt && meta.attempt.status === 'submitted') { location.replace(`student-result.html?quizId=${quizId}`); return; }
  document.title = `${meta.title} | QuizMUJ`;

  // ---- Lobby ---------------------------------------------------------------------------------------
  const lobbyState = () => {
    if (meta.attempt && meta.attempt.status === 'in_progress') return 'resume';
    const t = now();
    if (!meta.status || meta.status === 'inactive') return 'closed';
    if (t < new Date(meta.startTime).getTime()) return 'scheduled';
    if (t > new Date(meta.endTime).getTime()) return 'closed';
    return 'live';
  };

  const renderLobby = () => {
    phase = 'lobby';
    $('#loading').hidden = true;
    $('#lobby').hidden = false;
    $('#lobbyTitle').textContent = meta.title;
    $('#lobbyDesc').textContent = meta.description || 'Read the rules carefully before you begin.';
    setHTML($('#lobbyFacts'), [
      ['Questions', meta.questionCount],
      ['Time limit', `${meta.timeLimit} min`],
      ['Total points', meta.totalPoints],
      ['Pass mark', `${meta.passPercentage}%`]
    ].map(([k, v]) => html`<div class="fact"><span>${k}</span><strong>${v}</strong></div>`));

    const update = () => {
      const st = lobbyState();
      const agree = $('#agree');
      const start = $('#startBtn');
      let status = '';
      if (st === 'scheduled') {
        status = html`<div class="callout">${icon('calendar')}<div>Opens <strong>${fmt.dateTime(meta.startTime)}</strong> · in <strong>${fmt.countdown(new Date(meta.startTime).getTime() - now())}</strong></div></div>`;
      } else if (st === 'live') {
        const closesIn = new Date(meta.endTime).getTime() - now();
        const effective = Math.min(meta.timeLimit * 60000, closesIn);
        status = html`<div class="callout ${closesIn < meta.timeLimit * 60000 ? 'warning' : 'good'}">${icon(closesIn < meta.timeLimit * 60000 ? 'alert' : 'check-circle')}<div>
          Open now · closes ${fmt.dateTime(meta.endTime)}${closesIn < meta.timeLimit * 60000 ? html`. <strong>The window closes before the full time limit — you’ll have ${fmt.duration(effective / 1000)}.</strong>` : ''}</div></div>`;
      } else if (st === 'resume') {
        const left = new Date(meta.attempt.deadline).getTime() - now();
        status = html`<div class="callout warning">${icon('clock')}<div>You already started this exam. <strong>${left > 0 ? `${fmt.countdown(left)} left` : 'Time is up'}</strong> — your saved answers are waiting.</div></div>`;
      } else {
        status = html`<div class="callout critical">${icon('lock')}<div>This quiz closed on <strong>${fmt.dateTime(meta.endTime)}</strong>.</div></div>`;
      }
      setHTML($('#lobbyStatus'), status);
      $('#agreeWrap').hidden = st === 'closed' || st === 'resume';
      start.hidden = st === 'closed';
      start.textContent = st === 'resume' ? 'Resume exam' : st === 'scheduled' ? 'Not open yet' : 'Start exam';
      start.disabled = !(st === 'resume' || (st === 'live' && agree.checked));
      $('#startHint').hidden = st === 'closed';
    };
    update();
    $('#agree').addEventListener('change', update);
    lobbyTimer = setInterval(update, 1000);

    let starting = false;
    $('#startBtn').addEventListener('click', async () => {
      if (starting || phase !== 'lobby') return; // Enter/Space can re-fire while the request is pending
      starting = true;
      clearInterval(lobbyTimer); // the 1s lobby refresh would re-enable the button mid-request
      const btn = $('#startBtn');
      QM.setLoading(btn, true);
      await enterFullscreen(); // must run inside the click gesture
      try {
        await begin();
      } catch (err) {
        starting = false;
        QM.setLoading(btn, false);
        update();
        lobbyTimer = setInterval(update, 1000);
        exitFullscreen();
        if (err.data && err.data.alreadySubmitted) { location.replace(`student-result.html?quizId=${quizId}`); return; }
        toast(err.message, { type: 'error', title: 'Could not start the exam' });
      }
    });
  };

  // ---- Fullscreen ---------------------------------------------------------------------------------------
  const enterFullscreen = async () => {
    const el = document.documentElement;
    if (!el.requestFullscreen || document.fullscreenElement) return;
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
      fullscreenEntered = true;
    } catch (e) {
      fullscreenEntered = false; // not supported or denied – proctoring continues without it
    }
  };
  const exitFullscreen = () => { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); };

  // ---- Begin attempt ----------------------------------------------------------------------------------------
  const begin = async () => {
    const r = await api(`/quizzes/${quizId}/start`, { method: 'POST' });
    attempt = r.data;
    clockOffset = new Date(attempt.serverNow).getTime() - Date.now();
    deadline = new Date(attempt.deadline).getTime();
    questions = attempt.questions;
    answers = { ...attempt.answers };
    times = { ...attempt.questionTimes };
    violations = attempt.violations || 0;

    // Merge anything this device saved that may not have reached the server yet
    try {
      const local = JSON.parse(localStorage.getItem(storageKey()) || 'null');
      if (local) {
        const valid = new Set(questions.map((x) => x._id));
        Object.entries(local.answers || {}).forEach(([k, v]) => { if (valid.has(k) && answers[k] !== v) { answers[k] = v; changeSeq++; } });
        Object.entries(local.times || {}).forEach(([k, v]) => { if (valid.has(k)) times[k] = Math.max(times[k] || 0, v); });
        review = local.review || {};
        current = Math.min(Math.max(0, local.current || 0), questions.length - 1);
      }
    } catch (e) { /* ignore corrupt cache */ }

    clearInterval(lobbyTimer);
    $('#lobby').hidden = true;
    $('#exam').hidden = false;
    phase = 'exam';
    $('#examTitle').textContent = attempt.quiz.title;
    $('#totalCount').textContent = questions.length;
    buildPalette();
    renderQuestion();
    startTimer();
    startProctoring();
    setInterval(periodicSave, 20000);
    if (isDirty()) saveNow();
  };

  // ---- Rendering --------------------------------------------------------------------------------------------
  const buildPalette = () => {
    setHTML($('#paletteGrid'), questions.map((x, i) => html`<button type="button" class="pal-btn" data-i="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`));
  };

  const updateChrome = () => {
    const answered = answeredCount();
    const reviewCount = questions.filter((x) => review[x._id]).length;
    $('#answeredCount').textContent = answered;
    $('#progressBar').style.width = `${(answered / questions.length) * 100}%`;
    $('#lgAnswered').textContent = answered;
    $('#lgReview').textContent = reviewCount;
    $('#lgEmpty').textContent = questions.length - answered;
    $$('.pal-btn').forEach((b, i) => {
      const id = questions[i]._id;
      b.className = `pal-btn${answers[id] ? ' answered' : ''}${review[id] ? ' review' : ''}${i === current ? ' current' : ''}`;
      b.setAttribute('aria-current', i === current ? 'step' : 'false');
    });
  };

  const renderOptions = () => {
    const item = q();
    setHTML($('#options'), item.options.map((opt, i) => html`
      <button type="button" class="option" role="radio" aria-checked="${answers[item._id] === opt}" data-i="${i}">
        <span class="key">${LETTERS[i]}</span><span class="txt">${opt}</span>
      </button>`));
    $('#clearBtn').hidden = !answers[item._id];
  };

  const renderQuestion = () => {
    const item = q();
    $('#qNum').textContent = `Question ${current + 1} of ${questions.length}`;
    $('#qText').textContent = item.questionText;
    renderOptions();
    const flagged = Boolean(review[item._id]);
    $('#reviewBtn').setAttribute('aria-pressed', String(flagged));
    $('#reviewBtn span').textContent = flagged ? 'Marked for review' : 'Mark for review';
    $('#prevBtn').disabled = current === 0;
    const last = current === questions.length - 1;
    setHTML($('#nextBtn'), last ? html`Review &amp; submit${icon('check', 'icon-sm')}` : html`Next${icon('chevron-right', 'icon-sm')}`);
    updateChrome();
    shownAt = document.hidden ? null : performance.now();
  };

  // ---- Time on question ------------------------------------------------------------------------------------------
  const trackTime = () => {
    if (phase !== 'exam' || shownAt === null || !q()) return;
    const id = q()._id;
    times[id] = Math.round(((times[id] || 0) + (performance.now() - shownAt) / 1000) * 10) / 10;
    shownAt = document.hidden ? null : performance.now();
  };

  const goTo = (i) => {
    if (i < 0 || i >= questions.length || i === current) return;
    trackTime();
    current = i;
    persistLocal();
    renderQuestion();
    $('#questionCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // ---- Answering ----------------------------------------------------------------------------------------------------
  const syncOptionState = () => {
    const item = q();
    $$('#options .option').forEach((b, i) => b.setAttribute('aria-checked', String(answers[item._id] === item.options[i])));
    $('#clearBtn').hidden = !answers[item._id];
  };
  const choose = (index) => {
    const item = q();
    const opt = item.options[index];
    if (opt === undefined) return;
    answers[item._id] = opt;
    changed();
    syncOptionState();
    updateChrome();
  };
  const clearAnswer = () => {
    delete answers[q()._id];
    changed();
    syncOptionState();
    updateChrome();
  };
  const toggleReview = () => {
    trackTime(); // renderQuestion() restarts the per-question clock
    const id = q()._id;
    if (review[id]) delete review[id]; else review[id] = true;
    persistLocal();
    renderQuestion();
  };

  $('#options').addEventListener('click', (e) => {
    const b = e.target.closest('.option');
    if (b) choose(Number(b.dataset.i));
  });
  $('#clearBtn').addEventListener('click', clearAnswer);
  $('#reviewBtn').addEventListener('click', toggleReview);
  $('#prevBtn').addEventListener('click', () => goTo(current - 1));
  $('#nextBtn').addEventListener('click', () => (current === questions.length - 1 ? openSubmitDialog() : goTo(current + 1)));
  $('#paletteGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.pal-btn');
    if (!b) return;
    goTo(Number(b.dataset.i));
    setPalette(false);
  });
  const setPalette = (open) => {
    $('#palette').classList.toggle('open', open);
    $('#paletteToggle').setAttribute('aria-expanded', String(open));
  };
  $('#paletteToggle').addEventListener('click', () => setPalette(!$('#palette').classList.contains('open')));
  $('#paletteClose').addEventListener('click', () => setPalette(false));
  $('#submitBtn').addEventListener('click', () => openSubmitDialog());
  $('#paletteSubmit').addEventListener('click', () => { setPalette(false); openSubmitDialog(); });

  document.addEventListener('keydown', (e) => {
    if (phase !== 'exam' || document.body.classList.contains('modal-open') || !$('#overlay').hidden) return;
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const letter = LETTERS.toLowerCase().indexOf(k);
    if (letter >= 0 && k.length === 1) { choose(letter); e.preventDefault(); return; }
    if (/^[1-6]$/.test(k)) { choose(Number(k) - 1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { if (current < questions.length - 1) goTo(current + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { goTo(current - 1); e.preventDefault(); }
    if (k === 'r') { toggleReview(); e.preventDefault(); }
  });

  // ---- Persistence -----------------------------------------------------------------------------------------------------
  const setSaveStatus = (state, text) => {
    const el = $('#saveStatus');
    el.className = `save-status ${state}`;
    const ic = { saving: 'refresh', saved: 'check', offline: 'wifi-off' }[state] || 'check';
    setHTML(el, html`${icon(ic, 'icon-sm')}<span>${text}</span>`);
  };
  const persistLocal = () => {
    if (!attempt) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ answers, review, times, current, savedAt: Date.now() }));
    } catch (e) { /* storage full – server copy still exists */ }
  };
  const progressPayload = () => ({ answers, questionTimes: times });

  const saveNow = async () => {
    if (phase !== 'exam') return;
    if (saving) { saveQueued = true; return; }
    saving = true;
    trackTime();
    const seq = changeSeq;
    setSaveStatus('saving', 'Saving…');
    try {
      await api(`/quizzes/${quizId}/progress`, { method: 'PUT', body: progressPayload() });
      savedSeq = Math.max(savedSeq, seq);
      if (isDirty()) setSaveStatus('saving', 'Unsaved changes…');
      else setSaveStatus('saved', `All answers saved · ${fmt.time(new Date())}`);
    } catch (err) {
      if (err.status === 403) {
        submit('timeout'); // the server says time is up – finalise now
      } else if (err.status === 404) {
        syncAttempt(); // the attempt was finalised or reset elsewhere
      } else {
        setSaveStatus('offline', 'Offline — answers are saved on this device and will sync automatically');
      }
    } finally {
      saving = false;
      if (saveQueued) { saveQueued = false; saveNow(); }
    }
  };
  const scheduleSave = debounce(saveNow, 1200);
  const periodicSave = () => {
    if (phase !== 'exam') return;
    trackTime();
    persistLocal();
    if (isDirty()) saveNow();
  };
  const changed = () => {
    changeSeq++;
    persistLocal();
    setSaveStatus('saving', 'Unsaved changes…');
    scheduleSave();
    if (socket && socket.connected) socket.emit('exam:progress', { answered: answeredCount(), total: questions.length });
  };

  // Best-effort final save if the tab is closed mid-exam
  window.addEventListener('pagehide', () => {
    if (phase !== 'exam') return;
    trackTime();
    persistLocal();
    try {
      fetch(`${QM.API_BASE}/quizzes/${quizId}/progress`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(progressPayload())
      });
    } catch (e) { /* ignore */ }
  });
  window.addEventListener('beforeunload', (e) => {
    if (phase === 'exam') { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('online', () => { if (phase === 'exam' && isDirty()) saveNow(); });

  // ---- Timer --------------------------------------------------------------------------------------------------------------
  const startTimer = () => {
    const el = $('#timer');
    const text = $('#timerText');
    const tick = () => {
      if (phase !== 'exam') return;
      const left = deadline - now();
      const secs = Math.max(0, Math.ceil(left / 1000));
      text.textContent = fmt.clock(secs);
      el.classList.toggle('warn', secs <= 300 && secs > 60);
      el.classList.toggle('danger', secs <= 60);
      el.setAttribute('aria-label', `Time remaining ${fmt.duration(secs)}`);
      if (secs <= 300 && !warnedAt.five && secs > 60) { warnedAt.five = true; toast('5 minutes remaining.', { type: 'warning', title: 'Time check' }); }
      if (secs <= 60 && !warnedAt.one) { warnedAt.one = true; toast('1 minute left — your answers will be submitted automatically.', { type: 'warning', title: 'Almost done' }); }
      if (left <= 0) submit('timeout');
    };
    tick();
    setInterval(tick, 250);
  };

  // ---- Proctoring ---------------------------------------------------------------------------------------------------------
  const renderViolations = () => {
    const badge = $('#violationBadge');
    badge.hidden = violations === 0;
    badge.className = `badge ${violations > 3 ? 'badge-critical' : 'badge-warning'}`;
    setHTML(badge, html`${icon('alert', 'icon-sm')}${violations} violation${violations === 1 ? '' : 's'}`);
  };
  const report = (type) => {
    if (phase !== 'exam') return;
    if (type !== 'copy_attempt') { violations++; renderViolations(); } // optimistic; offline episodes still count at submit
    if (socket && socket.connected) {
      socket.emit('exam:violation', { type }, (ack) => {
        // The server de-duplicates bursts, so its count is authoritative while connected
        if (ack && ack.ok && typeof ack.violations === 'number') { violations = ack.violations; renderViolations(); }
      });
    }
  };
  let awayModal = null;
  const showAwayWarning = (seconds) => {
    if (awayModal || phase !== 'exam') return;
    awayModal = openModal({
      title: 'You left the exam',
      iconName: 'alert',
      iconTone: 'danger',
      body: html`<p class="muted">You were away for <strong>${fmt.duration(seconds)}</strong>. This has been recorded and reported to your examiner (${violations} violation${violations === 1 ? '' : 's'} so far). More than 3 violations flags your attempt for review.</p>`,
      footer: html`<button class="btn btn-primary" type="button" data-close>I understand — continue</button>`,
      onClose: () => { awayModal = null; }
    });
  };

  let awaySince = null; // start of the current away episode (tab hidden or window blurred)
  const goAway = (type) => {
    if (awaySince || phase !== 'exam') return;
    awaySince = Date.now();
    report(type);
  };
  const comeBack = () => {
    if (!awaySince || phase !== 'exam') return;
    const ms = Date.now() - awaySince;
    awaySince = null;
    if (socket && socket.connected) socket.emit('exam:focus-restored', { durationMs: ms });
    showAwayWarning(ms / 1000);
  };

  // Re-reads the attempt from the server (deadline changes, reconnects, rejected saves)
  const syncAttempt = async () => {
    if (phase !== 'exam') return;
    try {
      const r = await api(`/quizzes/${quizId}`);
      clockOffset = new Date(r.serverNow).getTime() - Date.now();
      const a = r.data.attempt;
      if (!a) { cancelExam('An administrator reset your attempt. You can start the quiz again.'); return; }
      if (a.status === 'submitted') {
        phase = 'done';
        try { localStorage.removeItem(storageKey()); } catch (e) { /* ignore */ }
        exitFullscreen();
        location.replace(`student-result.html?quizId=${quizId}`);
        return;
      }
      if (a.deadline) deadline = new Date(a.deadline).getTime();
    } catch (e) { /* offline – keep the current timer */ }
  };
  const startProctoring = () => {
    renderViolations();
    connectSocket().then((s) => {
      socket = s;
      const status = $('#proctorStatus');
      const setConn = (on) => {
        status.classList.toggle('off', !on);
        status.querySelector('.proctor-text').textContent = on ? 'Proctoring on' : 'Reconnecting…';
      };
      if (!socket) { setConn(false); return; }
      const join = () => socket.emit('exam:join', { quizId }, (ack) => {
        setConn(Boolean(ack && ack.ok));
        if (ack && ack.ok) { violations = Math.max(violations, ack.violations || 0); renderViolations(); socket.emit('exam:progress', { answered: answeredCount(), total: questions.length }); }
      });
      if (socket.connected) join();
      socket.on('connect', () => { join(); syncAttempt(); }); // catch up on anything missed while offline
      socket.on('disconnect', () => setConn(false));
      socket.on('exam:force-submit', (p) => {
        if (p && p.quizId && p.quizId !== quizId) return;
        submit('forced', p && p.message);
      });
      socket.on('exam:cancelled', (p) => {
        if (p && p.quizId && p.quizId !== quizId) return;
        cancelExam(p && p.message);
      });
      socket.on('exam:deadline-changed', async () => {
        const before = deadline;
        await syncAttempt();
        if (phase === 'exam' && deadline !== before) toast('Your exam end time was updated by the examiner.', { type: 'info', title: 'Schedule changed' });
      });
      socket.on('announcement', (a) => toast(a.message, { type: 'brand', title: a.title || 'Announcement', timeout: 9000 }));
    });

    document.addEventListener('visibilitychange', () => {
      if (phase !== 'exam') return;
      if (document.hidden) {
        trackTime();
        shownAt = null;
        persistLocal();
        goAway('tab_switch');
      } else {
        shownAt = performance.now();
        if (document.hasFocus()) comeBack(); // otherwise the focus event below ends the episode
      }
    });
    window.addEventListener('blur', () => {
      setTimeout(() => {
        if (phase === 'exam' && !document.hidden && !document.hasFocus()) goAway('window_blur');
      }, 300);
    });
    window.addEventListener('focus', () => {
      if (!document.hidden) comeBack();
    });
    document.addEventListener('fullscreenchange', () => {
      if (phase !== 'exam' || !fullscreenEntered) return;
      if (!document.fullscreenElement) {
        report('full_screen_exit');
        overlay({
          iconName: 'maximize', tone: 'warning', title: 'Return to full screen',
          text: 'Leaving full screen has been recorded. Return to focus mode to continue your exam.',
          actions: [
            { label: 'Continue without full screen', onClick: () => { fullscreenEntered = false; hideOverlay(); } },
            { label: 'Return to full screen', primary: true, onClick: async () => { await enterFullscreen(); hideOverlay(); } }
          ]
        });
      }
    });
    const blockCopy = (e) => {
      if (phase !== 'exam') return;
      e.preventDefault();
      if (Date.now() - lastCopyReport > 5000) {
        lastCopyReport = Date.now();
        report('copy_attempt');
        toast('Copying exam content is disabled.', { type: 'warning' });
      }
    };
    ['copy', 'cut', 'contextmenu'].forEach((ev) => document.addEventListener(ev, blockCopy));
  };

  // ---- Submission ------------------------------------------------------------------------------------------------------------
  const openSubmitDialog = () => {
    if (phase !== 'exam') return;
    trackTime();
    const unanswered = questions.map((x, i) => (!answers[x._id] ? i : -1)).filter((i) => i >= 0);
    const flagged = questions.map((x, i) => (review[x._id] ? i : -1)).filter((i) => i >= 0);
    const m = openModal({
      title: 'Submit your exam?',
      description: `You have ${fmt.duration(Math.max(0, (deadline - now()) / 1000))} left. You can’t change answers after submitting.`,
      iconName: 'check-circle',
      body: html`
        <div class="summary-grid">
          <div><strong>${answeredCount()}</strong><span>Answered</span></div>
          <div><strong>${unanswered.length}</strong><span>Unanswered</span></div>
          <div><strong>${flagged.length}</strong><span>For review</span></div>
        </div>
        ${unanswered.length ? html`<div class="callout warning">${icon('alert')}<div><strong>${unanswered.length} question${unanswered.length === 1 ? ' is' : 's are'} unanswered.</strong> Unanswered questions score zero.<div class="jump-list">${unanswered.map((i) => html`<button type="button" data-jump="${i}">${i + 1}</button>`)}</div></div></div>` : html`<div class="callout good">${icon('check-circle')}<div>Every question has an answer.</div></div>`}
        ${flagged.length ? html`<div class="mt-2 small muted">Marked for review:<div class="jump-list">${flagged.map((i) => html`<button type="button" data-jump="${i}">${i + 1}</button>`)}</div></div>` : ''}`,
      footer: html`<button class="btn btn-secondary" type="button" data-close>Keep working</button><button class="btn btn-primary" type="button" data-submit>Submit exam</button>`
    });
    m.bodyEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jump]');
      if (b) { m.close(); goTo(Number(b.dataset.jump)); }
    });
    m.footEl.querySelector('[data-submit]').addEventListener('click', () => { m.close(); submit('manual'); });
  };

  const MESSAGES = {
    manual: ['Submitting your exam…', 'Hang tight — scoring your answers.'],
    timeout: ['Time’s up!', 'Your answers are being submitted automatically.'],
    forced: ['Exam ended by your examiner', 'Your answers are being submitted now.']
  };

  const submit = async (type, message, attemptNo = 1) => {
    if (phase !== 'exam' && attemptNo === 1) return;
    trackTime(); // must run while phase is still 'exam'
    phase = 'submitting';
    persistLocal();
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
    document.body.classList.remove('modal-open');
    const [title, text] = MESSAGES[type];
    overlay({ iconName: 'spinner', title, text: message || text });
    try {
      await api(`/quizzes/${quizId}/submit`, {
        method: 'POST',
        body: {
          answers: Object.entries(answers).map(([questionId, selectedOption]) => ({ questionId, selectedOption })),
          questionMetrics: Object.entries(times).map(([questionId, timeSpentSeconds]) => ({ questionId, timeSpentSeconds })),
          violations,
          submissionType: type
        }
      });
      phase = 'done';
      try { localStorage.removeItem(storageKey()); } catch (e) { /* ignore */ }
      exitFullscreen();
      location.replace(`student-result.html?quizId=${quizId}&just=1`);
    } catch (err) {
      if (err.status === 0 || err.status >= 500) {
        const wait = Math.min(30, 3 * attemptNo);
        overlay({
          iconName: 'wifi-off', tone: 'warning', title: 'Connection problem',
          text: `Your answers are safe on this device. Retrying in ${wait}s…`,
          actions: [{ label: 'Retry now', primary: true, onClick: () => { clearTimeout(retryTimer); submit(type, message, attemptNo + 1); } }]
        });
        const retryTimer = setTimeout(() => submit(type, message, attemptNo + 1), wait * 1000);
      } else {
        phase = 'done';
        overlay({ iconName: 'alert', tone: 'danger', title: 'Submission failed', text: err.message, actions: [backAction] });
      }
    }
  };

  const cancelExam = (message) => {
    phase = 'done';
    try { if (attempt) localStorage.removeItem(storageKey()); } catch (e) { /* ignore */ }
    exitFullscreen();
    overlay({
      iconName: 'info', tone: 'warning', title: 'This exam session ended',
      text: message || 'Your examiner cancelled this attempt.',
      actions: [{ label: 'Reload', onClick: () => location.reload() }, backAction]
    });
  };

  renderLobby();
})();
