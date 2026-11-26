/* Result & answer review for one quiz */
(async () => {
  const { requireAuth, api, html, setHTML, icon, fmt, $, $$ } = QM;

  const user = await requireAuth({ role: 'user' });
  await QMShell.mount({ active: 'analytics', user });

  const params = new URLSearchParams(location.search);
  const quizId = params.get('quizId');
  const justSubmitted = params.get('just') === '1';
  const main = $('#main');

  const fail = (title, text) => setHTML(main, html`
    <div class="empty"><div class="empty-icon">${icon('alert')}</div><h3>${title}</h3><p>${text}</p>
    <a class="btn btn-primary" href="student-dashboard.html">Back to dashboard</a></div>`);

  if (!quizId || !/^[a-f0-9]{24}$/i.test(quizId)) { fail('Invalid link', 'This result link is not valid.'); return; }

  let r;
  try {
    r = (await api(`/quizzes/${quizId}/result`)).data;
  } catch (err) {
    fail(err.status === 404 ? 'No result yet' : 'Could not load result', err.message);
    return;
  }
  document.title = `${r.quizTitle} · Result | QuizMUJ`;
  if (justSubmitted) history.replaceState(null, '', `student-result.html?quizId=${quizId}`);

  const LETTERS = 'ABCDEF';
  const SUBMISSION_NOTE = {
    timeout: 'Submitted automatically when time ran out.',
    forced: 'Submitted when the examiner ended the exam.',
    auto: 'Finalised automatically after the deadline using your saved answers.'
  };

  if (r.quizType === 'google_form') {
    setHTML(main, html`
      <section class="card card-pad card-accent reveal" style="max-width:640px;margin:2rem auto;text-align:center">
        <div class="empty-icon" style="margin:0 auto 1rem">${icon('check-circle')}</div>
        <h1>${r.quizTitle}</h1>
        <p class="muted mt-1">You marked this external form as submitted on ${fmt.dateTime(r.submittedAt)}. Scores for external forms are managed by your instructor.</p>
        <a class="btn btn-primary mt-3" href="student-dashboard.html">Back to dashboard</a>
      </section>`);
    return;
  }

  const verdict = r.passed ? { cls: 'badge-good', ic: 'check', text: 'Passed' } : { cls: 'badge-critical', ic: 'x', text: 'Not passed' };
  setHTML(main, html`
    <a class="btn btn-ghost btn-sm mb-2" href="student-dashboard.html">${icon('arrow-left', 'icon-sm')}Dashboard</a>
    <section class="card result-hero card-accent reveal">
      <div style="position:relative;z-index:1">
        <span class="eyebrow">${justSubmitted ? 'Exam submitted' : 'Your result'}</span>
        <h1>${r.quizTitle}</h1>
        <p class="muted small">Submitted ${fmt.dateTime(r.submittedAt)}${SUBMISSION_NOTE[r.submissionType] ? ` · ${SUBMISSION_NOTE[r.submissionType]}` : ''}</p>
        <div class="hero-figure">
          <span class="value">${fmt.pct(r.percentage, 1)}</span>
          <span class="points">${r.score} / ${r.totalPossibleScore} points</span>
          <span class="badge ${verdict.cls}">${icon(verdict.ic, 'icon-sm')}${verdict.text}</span>
        </div>
        <div class="pass-meter" role="meter" aria-label="Score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.percentage}">
          <div class="meter"><span data-w="${r.percentage}"></span></div>
          <div class="pass-mark" style="left:${r.passPercentage}%"><span>Pass ${r.passPercentage}%</span></div>
        </div>
        <div class="row mt-3 wrap">
          <span class="xp-chip">${icon('zap', 'icon-sm')}+${fmt.number(r.xpEarned)} XP</span>
          <a class="btn btn-secondary btn-sm" href="student-leaderboard.html">${icon('award', 'icon-sm')}Leaderboard</a>
          <a class="btn btn-secondary btn-sm" href="student-analytics.html">${icon('chart', 'icon-sm')}Analytics</a>
        </div>
      </div>
      <div class="hero-side">
        <div>
          <div class="viz-title mb-1">Answer breakdown</div>
          <div id="breakdown"></div>
        </div>
        <div class="mini-stats">
          <div><span>Time taken</span><strong>${fmt.duration(r.timeSpentSeconds)}</strong></div>
          <div><span>Answered</span><strong>${r.totalQuestions - r.unansweredCount}/${r.totalQuestions}</strong></div>
          <div><span>Violations</span><strong class="${r.violations > 3 ? 'text-critical' : ''}">${r.violations}</strong></div>
        </div>
      </div>
    </section>

    <div class="review-head">
      <div><h2>Answer review</h2><p class="muted small" id="reviewSub"></p></div>
      <div class="segmented" role="group" aria-label="Filter questions" id="reviewFilter"></div>
    </div>
    <div id="revealNote"></div>
    <div class="review-list" id="reviewList"></div>`);

  QMCharts.segmented($('#breakdown'), [
    { label: 'Correct', value: r.correctCount, cls: 'seg-good', swatch: 'good' },
    { label: 'Incorrect', value: r.incorrectCount, cls: 'seg-critical', swatch: 'critical' },
    { label: 'Unanswered', value: r.unansweredCount, cls: 'seg-neutral', swatch: 'viz-neutral' }
  ]);
  requestAnimationFrame(() => $$('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; }));

  // ---- Review ------------------------------------------------------------------------------------
  let filter = 'all';
  const review = r.review || [];
  if (r.reveal) {
    $('#reviewSub').textContent = 'Correct answers and explanations for every question.';
    setHTML($('#reviewFilter'), [['all', 'All'], ['wrong', 'Incorrect'], ['right', 'Correct'], ['skipped', 'Unanswered']]
      .map(([k, l]) => html`<button type="button" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`));
  } else {
    $('#reviewFilter').hidden = true;
    $('#reviewSub').textContent = 'Your submitted answers.';
    setHTML($('#revealNote'), html`<div class="callout mb-2">${icon('lock')}<div>${r.revealPolicy === 'never'
      ? 'Your instructor has chosen not to reveal correct answers for this quiz.'
      : html`Correct answers and explanations unlock when the quiz closes on <strong>${fmt.dateTime(r.revealAt)}</strong>, so classmates still taking it can’t see them.`}</div></div>`);
  }

  const renderReview = () => {
    const items = review.filter((x) => {
      if (filter === 'wrong') return x.selectedOption && !x.isCorrect;
      if (filter === 'right') return x.isCorrect;
      if (filter === 'skipped') return !x.selectedOption;
      return true;
    });
    if (!items.length) {
      setHTML($('#reviewList'), html`<div class="card"><div class="empty"><div class="empty-icon">${icon('check-circle')}</div><h3>Nothing here</h3><p>No questions match this filter.</p></div></div>`);
      return;
    }
    setHTML($('#reviewList'), items.map((x) => {
      const status = !r.reveal ? (x.selectedOption ? ['badge-outline', 'minus', 'Answered'] : ['', 'minus', 'Unanswered'])
        : x.isCorrect ? ['badge-good', 'check', 'Correct'] : x.selectedOption ? ['badge-critical', 'x', 'Incorrect'] : ['', 'minus', 'Unanswered'];
      return html`
        <article class="card review-item">
          <div class="rq-top">
            <div><span class="rq-num">Question ${x.index}</span><h3>${x.questionText}</h3></div>
            <span class="badge ${status[0]}">${icon(status[1], 'icon-sm')}${status[2]}</span>
          </div>
          <div class="r-options">${x.options.map((o, i) => {
            const mine = o === x.selectedOption;
            const correct = r.reveal && o === x.correctAnswer;
            const cls = correct ? 'correct' : (r.reveal && mine ? 'wrong' : (mine ? 'mine' : ''));
            const tag = correct && mine ? html`<span class="tag">${icon('check', 'icon-sm')}Your answer · correct</span>`
              : correct ? html`<span class="tag">${icon('check', 'icon-sm')}Correct answer</span>`
                : mine ? html`<span class="tag">${r.reveal ? icon('x', 'icon-sm') : ''}Your answer</span>` : '';
            return html`<div class="r-opt ${cls}"><span class="key">${LETTERS[i]}</span><span>${o}</span>${tag}</div>`;
          })}</div>
          ${r.reveal && x.explanation ? html`<div class="explain">${icon('info', 'icon-sm')}<div><strong>Explanation.</strong> ${x.explanation}</div></div>` : ''}
          <div class="rq-meta">${x.timeSpentSeconds ? html`<span>${icon('clock', 'icon-sm')} ${fmt.duration(x.timeSpentSeconds)} on this question</span>` : ''}${r.reveal && x.tags && x.tags.length ? html`<span>${icon('hash', 'icon-sm')} ${x.tags.join(', ')}</span>` : ''}</div>
        </article>`;
    }));
  };
  $('#reviewFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    $$('#reviewFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderReview();
  });
  renderReview();

  // ---- Celebrate a pass (respects reduced motion) ----------------------------------------------------
  if (justSubmitted && r.passed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const canvas = $('#confetti');
    const ctx = canvas.getContext('2d');
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const colors = ['#ff7900', '#ffb15c', '#0aac23', '#fbb315', '#ffffff', '#6cb6ff'];
    const parts = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 13 - 4,
      s: Math.random() * 6 + 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)]
    }));
    const start = performance.now();
    const frame = (t) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach((p) => {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - (t - start) / 3200);
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (t - start < 3200) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(frame);
  }
})();
