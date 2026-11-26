/* Student analytics: KPIs, score trend, topic mastery, mistakes and attempt history */
(async () => {
  const { requireAuth, api, html, setHTML, icon, fmt, toast, debounce, $ } = QM;

  const user = await requireAuth({ role: 'user' });
  await QMShell.mount({ active: 'analytics', user });

  let analytics;
  let history;
  try {
    const [a, h] = await Promise.all([api('/student/analytics'), api('/student/results')]);
    analytics = a.data;
    history = h.data;
  } catch (err) {
    toast(err.message, { type: 'error', title: 'Could not load analytics' });
    return;
  }

  // ---- KPIs ----------------------------------------------------------------------------------------
  const s = analytics.summary;
  const tiles = [
    { label: 'Average score', value: s.avgPercentage === null ? '—' : fmt.pct(s.avgPercentage, 1), meta: `${s.attempts} scored quiz${s.attempts === 1 ? '' : 'zes'}`, ic: 'target' },
    { label: 'Best score', value: s.bestPercentage === null ? '—' : fmt.pct(s.bestPercentage, 1), meta: 'Personal best', ic: 'star' },
    { label: 'XP earned', value: fmt.compact(s.xp), meta: '10 XP per point scored', ic: 'zap' },
    { label: 'Time on exams', value: fmt.duration(s.totalTimeSeconds), meta: 'Across all attempts', ic: 'clock' }
  ];
  setHTML($('#kpis'), tiles.map((t, i) => html`
    <div class="card stat reveal" style="--d:${i * 0.04}s">
      <div class="stat-top"><span class="stat-label">${t.label}</span><span class="stat-icon">${icon(t.ic)}</span></div>
      <div class="stat-value">${t.value}</div>
      <div class="stat-meta">${t.meta}</div>
    </div>`));

  // ---- Score trend ---------------------------------------------------------------------------------
  QMCharts.line($('#trendChart'), {
    title: 'Score trend',
    subtitle: analytics.trend.length
      ? `Percentage scored on your last ${analytics.trend.length} quiz${analytics.trend.length === 1 ? '' : 'zes'}`
      : 'Percentage scored per quiz',
    data: analytics.trend.map((t) => ({ label: fmt.dateShort(t.submittedAt), value: t.percentage, detail: t.quizTitle, full: t })),
    tooltipLabel: (d) => `${d.full.quizTitle} · ${fmt.date(d.full.submittedAt)}`,
    categoryName: 'Quiz',
    valueName: 'Score',
    format: (v) => `${Math.round(v * 10) / 10}%`,
    emptyText: 'Complete a quiz to start your trend line.'
  });

  // ---- Mastery ----------------------------------------------------------------------------------------
  if (analytics.proficiencyMode === 'quizzes') {
    $('#masteryTitle').textContent = 'Accuracy by quiz';
    $('#masterySub').textContent = 'Tag your questions by topic to unlock topic mastery';
  }
  // Tags are stored lowercase: show short ones as acronyms (os → OS, sql → SQL, dbms → DBMS), capitalise the rest
  const topicName = (t) => (t.length <= 3 || /^[^aeiou\s]{4,5}$/i.test(t) ? t.toUpperCase() : t.replace(/^./, (c) => c.toUpperCase()));
  const rows = analytics.proficiency
    .slice()
    .sort((a, b) => b.accuracy - a.accuracy)
    .map((p) => ({
      name: analytics.proficiencyMode === 'tags' ? topicName(p.label) : p.label,
      sub: p.total ? `${p.correct}/${p.total} correct` : '',
      value: p.accuracy,
      figure: fmt.pct(p.accuracy, 1)
    }));
  QMCharts.meterList($('#mastery'), rows, { emptyText: 'Your topic mastery appears once answers for your quizzes are revealed.' });

  // ---- Mistakes ---------------------------------------------------------------------------------------
  const fb = analytics.latestFeedback;
  if (!fb) {
    setHTML($('#feedback'), html`<div class="empty"><div class="empty-icon">${icon('lock')}</div><h3>Nothing to review yet</h3><p>${analytics.pendingReveal
      ? `Answers for your ${analytics.pendingReveal} most recent quiz${analytics.pendingReveal === 1 ? '' : 'zes'} unlock when the quiz window closes.`
      : 'Once you complete a quiz and its answers are revealed, your mistakes show up here.'}</p></div>`);
  } else {
    setHTML($('#feedbackLink'), html`<a class="btn btn-secondary btn-sm" href="student-result.html?quizId=${fb.quizId}">Full review</a>`);
    const intro = html`<p class="muted small mb-2">From <strong>${fb.quizTitle}</strong> · ${fmt.date(fb.submittedAt)} · scored ${fmt.pct(fb.percentage, 1)}${analytics.pendingReveal ? ` · ${analytics.pendingReveal} newer quiz${analytics.pendingReveal === 1 ? '' : 'zes'} still locked` : ''}</p>`;
    setHTML($('#feedback'), fb.mistakes.length
      ? html`${intro}${fb.mistakes.slice(0, 6).map((m) => html`
          <div class="mistake">
            <h4>${m.questionText}</h4>
            <div class="ans-pair">
              <div class="ans wrong">${icon('x', 'icon-sm')}<div><small>Your answer</small>${m.selectedOption || 'Not answered'}</div></div>
              <div class="ans right">${icon('check', 'icon-sm')}<div><small>Correct answer</small>${m.correctAnswer}</div></div>
            </div>
            ${m.explanation ? html`<p class="why">${icon('info', 'icon-sm')} ${m.explanation}</p>` : ''}
          </div>`)}${fb.mistakes.length > 6 ? html`<p class="small subtle mt-2">+${fb.mistakes.length - 6} more in the full review.</p>` : ''}`
      : html`${intro}<div class="callout good">${icon('check-circle')}<div><strong>Flawless!</strong> You didn’t miss a single question in this quiz.</div></div>`);
  }

  // ---- History table -----------------------------------------------------------------------------------
  const PAGE = 8;
  let page = 1;
  let query = '';
  const renderHistory = () => {
    const list = history.filter((h) => h.quizTitle.toLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    page = Math.min(page, pages);
    const slice = list.slice((page - 1) * PAGE, page * PAGE);
    setHTML($('#history'), slice.length ? slice.map((h) => html`
      <tr>
        <td><strong>${h.quizTitle}</strong>${h.quizType === 'google_form' ? html`<br><span class="xsmall subtle">External form</span>` : ''}</td>
        <td class="nowrap">${fmt.dateTime(h.submittedAt)}</td>
        <td class="num">${h.quizType === 'google_form' ? '—' : html`<strong>${fmt.pct(h.percentage, 1)}</strong><br><span class="xsmall subtle">${h.score}/${h.totalPossibleScore} pts</span>`}</td>
        <td>${h.quizType === 'google_form' ? html`<span class="badge badge-good">${icon('check', 'icon-sm')}Submitted</span>`
          : html`<span class="badge ${h.passed ? 'badge-good' : 'badge-critical'}">${icon(h.passed ? 'check' : 'x', 'icon-sm')}${h.passed ? 'Pass' : 'Fail'}</span>`}</td>
        <td class="num">${fmt.duration(h.timeSpentSeconds)}</td>
        <td class="actions">${h.quizId && h.quizType !== 'google_form' ? html`<a class="btn btn-ghost btn-sm" href="student-result.html?quizId=${h.quizId}">Review ${icon('chevron-right', 'icon-sm')}</a>` : ''}</td>
      </tr>`)
      : html`<tr><td colspan="6"><div class="empty"><div class="empty-icon">${icon('inbox')}</div><h3>${query ? 'No matches' : 'No attempts yet'}</h3><p>${query ? 'Try a different search.' : 'Your completed quizzes will be listed here.'}</p></div></td></tr>`);
    $('#pageInfo').textContent = list.length ? `Showing ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, list.length)} of ${list.length}` : '';
    $('#prevPage').disabled = page <= 1;
    $('#nextPage').disabled = page >= pages;
  };
  $('#search').addEventListener('input', debounce((e) => { query = e.target.value.trim().toLowerCase(); page = 1; renderHistory(); }, 150));
  $('#prevPage').addEventListener('click', () => { page--; renderHistory(); });
  $('#nextPage').addEventListener('click', () => { page++; renderHistory(); });
  renderHistory();
})();
