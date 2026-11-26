/* Faculty console: quizzes, results analytics, attempt forensics, external forms */
(() => {
  const { api, html, setHTML, icon, fmt, toast, openModal, confirmDialog, setLoading, initials, debounce, bindTargeting, downloadBlob, targetLabel, statusBadge, $, $$ } = QM;
  const A = window.QMAdmin;

  // ---- Shared actions ------------------------------------------------------------------------
  A.forceEnd = async (quizId, title) => {
    const ok = await confirmDialog({
      title: `Force end “${title}”?`,
      message: 'The quiz window closes immediately and every running attempt is submitted with the answers saved so far. This cannot be undone.',
      confirmText: 'Force end now',
      danger: true,
      icon: 'stop'
    });
    if (!ok) return false;
    try {
      const r = await api(`/admin/quizzes/${quizId}/force-end`, { method: 'POST' });
      toast(`${r.data.runningAttempts} running attempt${r.data.runningAttempts === 1 ? '' : 's'} are being submitted.`, { type: 'success', title: 'Exam ended' });
      A.emit('quizzes', { quizId });
      return true;
    } catch (err) {
      toast(err.message, { type: 'error' });
      return false;
    }
  };

  const exportCsv = async (quizId, title) => {
    try {
      const res = await api(`/admin/results/${quizId}/csv`, { raw: true });
      const blob = await res.blob();
      downloadBlob(blob, `${title.replace(/[^a-z0-9]+/gi, '_')}_Results.csv`);
      toast('CSV downloaded.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: err.status === 404 ? 'warning' : 'error' });
    }
  };

  const typeLabel = (q) => (q.type === 'google_form'
    ? html`<span class="type-pill">${icon('link', 'icon-sm')}External form</span>`
    : html`<span class="type-pill">${icon('file', 'icon-sm')}${q.questionCount} Q · ${q.timeLimit} min</span>`);

  // ---- Question preview --------------------------------------------------------------------------
  const preview = async (quizId) => {
    const q = (await api(`/quizzes/${quizId}`)).data;
    openModal({
      title: q.title,
      description: `${q.questions.length} questions · ${q.timeLimit} min · ${q.pointsPerQuestion} pt each · ${targetLabel(q)}`,
      size: 'lg',
      body: q.questions.map((x, i) => html`
        <div class="preview-q">
          <h4>${i + 1}. ${x.questionText}</h4>
          <ol type="A">${x.options.map((o) => html`<li class="${o === x.correctAnswer ? 'correct' : ''}">${o}${o === x.correctAnswer ? ' ✓' : ''}</li>`)}</ol>
          ${x.explanation ? html`<p class="small muted mt-1">${icon('info', 'icon-sm')} ${x.explanation}</p>` : ''}
          ${x.tags && x.tags.length ? html`<div class="chip-list mt-1">${x.tags.map((t) => html`<span class="badge">#${t}</span>`)}</div>` : ''}
        </div>`),
      footer: html`<a class="btn btn-secondary" href="create-quiz.html?duplicate=${q._id}">${icon('copy', 'icon-sm')}Duplicate</a><a class="btn btn-primary" href="create-quiz.html?id=${q._id}">${icon('edit', 'icon-sm')}Edit quiz</a>`
    });
  };

  // ---- External form modal (create & edit) ----------------------------------------------------------
  A.openEmbedModal = async (existing = null) => {
    const ctx = A.context() || {};
    const start = existing ? new Date(existing.startTime) : (ctx.defaultStart && new Date(ctx.defaultStart) > new Date() ? new Date(ctx.defaultStart) : new Date());
    const end = existing ? new Date(existing.endTime) : new Date(start.getTime() + 24 * 3600 * 1000);
    const m = openModal({
      title: existing ? 'Edit external form' : 'Embed an external form',
      description: 'Google Forms and Microsoft Forms open inside QuizMUJ, and completion is tracked per student.',
      iconName: 'link',
      size: 'lg',
      body: html`
        <form id="embedForm" class="stack" novalidate>
          <div class="field"><label class="label" for="emTitle">Title</label><input class="input" id="emTitle" maxlength="100" required placeholder="e.g. DBMS feedback form" value="${existing ? existing.title : (ctx.subjectName ? `${ctx.subjectName} — form` : '')}"><span class="field-error"></span></div>
          <div class="field"><label class="label" for="emUrl">Form URL</label><input class="input" id="emUrl" type="url" required placeholder="https://docs.google.com/forms/…" value="${existing ? existing.googleFormUrl : ''}"><span class="field-error"></span><span class="hint">Use the link from the form’s “Send” dialog. It must start with https://</span></div>
          <div class="form-grid">
            <div class="field"><label class="label" for="emStart">Opens</label><input class="input" id="emStart" type="datetime-local" value="${fmt.toInputValue(start)}"></div>
            <div class="field"><label class="label" for="emEnd">Closes</label><input class="input" id="emEnd" type="datetime-local" value="${fmt.toInputValue(end)}"><span class="field-error"></span></div>
          </div>
          <div><div class="label mb-1">Who should see it?</div>
            <div class="target-grid">
              <select class="select" id="emProgram" aria-label="Program"></select>
              <select class="select" id="emBranch" aria-label="Branch"></select>
              <select class="select" id="emBatch" aria-label="Batch"></select>
              <select class="select" id="emSemester" aria-label="Semester"></select>
              <select class="select" id="emSection" aria-label="Section"></select>
            </div>
          </div>
        </form>`,
      footer: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="emSave">${existing ? 'Save changes' : 'Publish form'}</button>`
    });
    const q$ = (sel) => m.el.querySelector(sel);
    const targeting = await bindTargeting({
      program: $('#emProgram'), branch: $('#emBranch'), batchYear: $('#emBatch'), semester: $('#emSemester'), section: $('#emSection')
    }, existing || ctx);
    if (!document.body.contains(m.el)) return; // closed while loading
    const err = (id, msg) => { const f = $(id).closest('.field'); f.classList.toggle('has-error', Boolean(msg)); f.querySelector('.field-error').textContent = msg || ''; };
    q$('#emSave').addEventListener('click', async () => {
      const title = q$('#emTitle').value.trim();
      const url = q$('#emUrl').value.trim();
      const s = new Date(q$('#emStart').value);
      const e = new Date(q$('#emEnd').value);
      let ok = true;
      err('#emTitle', title ? '' : 'Give the form a title'); if (!title) ok = false;
      if (!/^https?:\/\/\S+$/i.test(url)) { err('#emUrl', 'Enter a valid https:// link'); ok = false; } else err('#emUrl', '');
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) { err('#emEnd', 'Closing time must be after opening time'); ok = false; } else err('#emEnd', '');
      if (!ok) return;
      const btn = q$('#emSave');
      setLoading(btn, true);
      try {
        const payload = { title, googleFormUrl: url, ...targeting.value() };
        if (existing) await api(`/quizzes/${existing._id}`, { method: 'PUT', body: { ...payload, startTime: s.toISOString(), endTime: e.toISOString() } });
        else await api('/admin/quizzes/external', { method: 'POST', body: { ...payload, scheduledTime: s.toISOString(), endTime: e.toISOString() } });
        m.close();
        toast(existing ? 'Form updated.' : 'Form published — matching students were notified.', { type: 'success' });
        A.emit('quizzes', {});
      } catch (ex) {
        setLoading(btn, false);
        toast(ex.message, { type: 'error' });
      }
    });
  };

  // ---- Attempt forensics -------------------------------------------------------------------------------
  const AUDIT = {
    tab_switch: ['bad', 'Switched tab / minimised'],
    window_blur: ['bad', 'Left the exam window'],
    full_screen_exit: ['bad', 'Exited full screen'],
    copy_attempt: ['warn', 'Tried to copy content'],
    focus_restored: ['ok', 'Returned to the exam'],
    network_disconnect: ['warn', 'Connection lost'],
    fast_answer: ['bad', 'Suspiciously fast answers'],
    late_submission: ['warn', 'Late submission'],
    force_submitted: ['warn', 'Force-submitted by examiner'],
    auto_submitted: ['warn', 'Auto-submitted after deadline'],
    mouse_leave: ['warn', 'Cursor left the exam']
  };
  A.openAttempt = async (resultId, { onReset } = {}) => {
    let d;
    try { d = (await api(`/admin/results/${resultId}`)).data; } catch (err) { toast(err.message, { type: 'error' }); return; }
    const s = d.student;
    const events = [
      d.startedAt && { cls: 'ok', label: 'Started the exam', time: d.startedAt },
      ...d.auditLog.map((a) => ({ cls: (AUDIT[a.action] || ['', a.action])[0], label: (AUDIT[a.action] || ['', a.action])[1], details: a.details, time: a.timestamp })),
      d.submittedAt && { cls: 'ok', label: `Submitted (${d.submissionType})`, time: d.submittedAt }
    ].filter(Boolean).sort((a, b) => new Date(a.time) - new Date(b.time));
    const m = openModal({
      title: s.name,
      description: `${s.email}${s.program ? ` · ${fmt.cohort(s)}` : ''}`,
      size: 'lg',
      body: html`
        <div class="res-kpis">
          <div class="res-kpi"><span>Score</span><strong>${d.quiz.type === 'native' ? fmt.pct(d.percentage, 1) : '—'}</strong><small>${d.quiz.type === 'native' ? `${d.score}/${d.totalPossibleScore} pts` : 'External form'}</small></div>
          <div class="res-kpi"><span>Status</span><strong style="font-size:1rem">${d.status === 'submitted' ? 'Submitted' : 'In progress'}</strong><small>${d.submittedAt ? fmt.dateTime(d.submittedAt) : `Deadline ${fmt.time(d.deadline)}`}</small></div>
          <div class="res-kpi"><span>Time taken</span><strong>${fmt.duration(d.timeSpentSeconds)}</strong></div>
          <div class="res-kpi"><span>Violations</span><strong class="${d.violations > 3 ? 'text-critical' : ''}">${d.violations}</strong></div>
        </div>
        ${d.isFlagged ? html`<div class="callout critical mb-2">${icon('flag')}<div><strong>Flagged for review.</strong> ${d.flagReasons.join(' · ')}</div></div>` : html`<div class="callout good mb-2">${icon('shield')}<div>No integrity flags on this attempt.</div></div>`}
        <h3 class="mb-1" style="font-size:.95rem">Proctoring timeline</h3>
        ${events.length ? html`<ul class="timeline mb-2">${events.map((e) => html`<li class="${e.cls}"><time>${fmt.dateTime(e.time)}</time><strong>${e.label}</strong>${e.details ? html` — <span class="muted">${e.details}</span>` : ''}</li>`)}</ul>` : html`<p class="muted small mb-2">No events recorded.</p>`}
        ${d.review.length ? html`<h3 class="mb-1 mt-3" style="font-size:.95rem">Answers</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>#</th><th>Question</th><th>Answer</th><th class="num">Time</th></tr></thead>
            <tbody>${d.review.map((r) => html`<tr>
              <td>${r.index}</td>
              <td style="max-width:360px">${r.questionText}<br><span class="xsmall subtle">Correct: ${r.correctAnswer}</span></td>
              <td>${r.selectedOption ? html`<span class="badge ${r.isCorrect ? 'badge-good' : 'badge-critical'}">${icon(r.isCorrect ? 'check' : 'x', 'icon-sm')}${r.selectedOption}</span>` : html`<span class="badge">Unanswered</span>`}</td>
              <td class="num">${fmt.duration(r.timeSpentSeconds)}</td></tr>`)}</tbody>
          </table></div>` : ''}`,
      footer: html`<button class="btn btn-danger-soft" type="button" id="resetAttempt">${icon('rotate', 'icon-sm')}Reset attempt</button><button class="btn btn-primary" type="button" data-close>Done</button>`
    });
    $('#resetAttempt').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: `Reset ${s.name}'s attempt?`, message: 'Their answers and score for this quiz are deleted and they can take it again (if the quiz is still open).', confirmText: 'Reset attempt', danger: true, icon: 'rotate' });
      if (!ok) return;
      try {
        await api(`/admin/results/${resultId}`, { method: 'DELETE' });
        toast('Attempt reset — the student can retake the quiz.', { type: 'success' });
        m.close();
        if (onReset) onReset();
        A.emit('results', {});
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
  };

  // ---- Results analytics modal ----------------------------------------------------------------------
  A.openResults = async (quizId) => {
    const m = openModal({ title: 'Results', size: 'xl', body: html`<div class="page-loader" style="min-height:300px"><div class="loader-ring"></div></div>` });
    const q$ = (sel) => m.bodyEl.querySelector(sel); // scoped: the modal may close while loading
    const load = async () => {
      let d;
      try { d = (await api(`/admin/quizzes/${quizId}/results`)).data; } catch (err) { setHTML(m.bodyEl, html`<div class="empty"><h3>Couldn’t load results</h3><p>${err.message}</p></div>`); return; }
      if (!document.body.contains(m.el)) return;
      const q = d.quiz;
      const s = d.summary;
      m.el.querySelector('.modal-head h2').textContent = q.title;
      const native = q.type === 'native';
      setHTML(m.bodyEl, html`
        <div class="row-between wrap mb-2">
          <div class="row wrap">${statusBadge(q.status)}<span class="small muted">${targetLabel(q)} · ${fmt.dateTime(q.startTime)} – ${fmt.dateTime(q.endTime)}</span></div>
          <div class="row">
            ${q.status === 'live' ? html`<button class="btn btn-danger-soft btn-sm" type="button" id="resForce">${icon('stop', 'icon-sm')}Force end</button>` : ''}
            <button class="btn btn-secondary btn-sm" type="button" id="resCsv">${icon('download', 'icon-sm')}Export CSV</button>
          </div>
        </div>
        <div class="res-kpis">
          <div class="res-kpi"><span>Submissions</span><strong>${s.submissions}</strong><small>${s.eligible ? `${fmt.pct(s.participationRate, 1)} of ${s.eligible} eligible` : 'No eligible students'}</small></div>
          ${native ? html`
          <div class="res-kpi"><span>Average</span><strong>${s.averagePercentage === null ? '—' : fmt.pct(s.averagePercentage, 1)}</strong><small>Median ${s.median === null ? '—' : fmt.pct(s.median, 1)}</small></div>
          <div class="res-kpi"><span>Highest</span><strong>${s.highest === null ? '—' : fmt.pct(s.highest, 1)}</strong><small>Lowest ${s.lowest === null ? '—' : fmt.pct(s.lowest, 1)}</small></div>
          <div class="res-kpi"><span>Pass rate</span><strong>${s.passRate === null ? '—' : fmt.pct(s.passRate, 1)}</strong><small>Pass mark ${q.passPercentage}%</small></div>
          <div class="res-kpi"><span>Flagged</span><strong class="${s.flagged ? 'text-critical' : ''}">${s.flagged}</strong><small>Integrity review</small></div>
          <div class="res-kpi"><span>Avg. time</span><strong>${s.avgTimeSeconds === null ? '—' : fmt.duration(s.avgTimeSeconds)}</strong><small>of ${q.timeLimit} min</small></div>` : ''}
          <div class="res-kpi"><span>In progress</span><strong>${s.inProgress}</strong><small>Right now</small></div>
        </div>
        ${native && s.submissions ? html`
        <div class="res-charts">
          <div class="res-panel"><div id="distChart"></div></div>
          <div class="res-panel">
            <div class="viz-head"><div><div class="viz-title">Question difficulty</div><div class="viz-sub">Share of students who answered correctly — hardest first</div></div></div>
            <div class="q-diff" id="qDiff"></div>
          </div>
        </div>` : ''}
        <div class="row-between wrap mb-1"><h3 style="font-size:1rem">Students</h3>
          <div class="input-wrap" style="max-width:260px;width:100%">${icon('search')}<input class="input" type="search" id="resSearch" placeholder="Search students" aria-label="Search students"></div></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Student</th><th>Status</th>${native ? html`<th class="num">Score</th><th>Result</th>` : ''}<th class="num">Time</th><th>Integrity</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="resRows"></tbody>
        </table></div>`);

      if (native && s.submissions) {
        QMCharts.columns(q$('#distChart'), {
          title: 'Score distribution',
          subtitle: 'Number of students per score band (%)',
          data: d.distribution.map((b) => ({ label: b.range.split('–')[0], value: b.count, range: b.range })),
          tooltipLabel: (x) => `${x.range}%`,
          categoryName: 'Score band',
          valueName: 'Students',
          height: 230
        });
        QMCharts.meterList(q$('#qDiff'), d.questionStats
          .slice()
          .sort((a, b) => (a.correctRate ?? 0) - (b.correctRate ?? 0))
          .map((x) => ({
            name: `Q${x.index}. ${x.questionText}`,
            sub: x.mostCommonWrong ? `Most common wrong: “${x.mostCommonWrong.option}” (${x.mostCommonWrong.count})` : `${x.correct}/${s.submissions} correct`,
            value: x.correctRate || 0,
            figure: fmt.pct(x.correctRate || 0, 0)
          })));
      }

      const rowsFor = (term) => d.results.filter((r) => !term || `${r.student.name} ${r.student.email}`.toLowerCase().includes(term));
      const drawRows = (term = '') => {
        const rows = rowsFor(term);
        setHTML(q$('#resRows'), rows.length ? rows.map((r) => html`
          <tr class="is-clickable" data-attempt="${r.resultId}">
            <td><div class="cell-user"><span class="avatar avatar-sm">${initials(r.student.name)}</span><div><strong>${r.student.name}</strong><span>${r.student.email}</span></div></div></td>
            <td>${r.status === 'submitted' ? html`<span class="badge badge-good">${icon('check', 'icon-sm')}${r.submissionType === 'manual' || r.submissionType === 'external' ? 'Submitted' : r.submissionType}</span>` : html`<span class="badge badge-warning badge-live">In progress</span>`}</td>
            ${native ? html`<td class="num">${r.percentage === null ? '—' : html`<strong>${fmt.pct(r.percentage, 1)}</strong><br><span class="xsmall subtle">${r.score}/${r.totalPossibleScore}</span>`}</td>
              <td>${r.passed === null ? '—' : html`<span class="badge ${r.passed ? 'badge-good' : 'badge-critical'}">${r.passed ? 'Pass' : 'Fail'}</span>`}</td>` : ''}
            <td class="num">${fmt.duration(r.timeSpentSeconds)}</td>
            <td>${r.isFlagged ? html`<span class="badge badge-critical" title="${r.flagReasons.join(' · ')}">${icon('flag', 'icon-sm')}Flagged</span>` : r.violations ? html`<span class="badge badge-warning">${r.violations} violation${r.violations === 1 ? '' : 's'}</span>` : html`<span class="badge badge-good">${icon('shield', 'icon-sm')}Clean</span>`}</td>
            <td class="actions"><button class="btn btn-ghost btn-sm" type="button">Details ${icon('chevron-right', 'icon-sm')}</button></td>
          </tr>`) : A.emptyRow(7, 'users', term ? 'No matching students' : 'No attempts yet', term ? '' : 'Students who start or submit this quiz appear here.'));
      };
      drawRows();
      q$('#resSearch').addEventListener('input', debounce((e) => drawRows(e.target.value.trim().toLowerCase()), 150));
      q$('#resRows').addEventListener('click', (e) => {
        const row = e.target.closest('[data-attempt]');
        if (row) A.openAttempt(row.dataset.attempt, { onReset: load });
      });
      q$('#resCsv').addEventListener('click', () => exportCsv(quizId, q.title));
      const force = q$('#resForce');
      if (force) force.addEventListener('click', async () => { if (await A.forceEnd(quizId, q.title)) setTimeout(load, 800); });
    };
    await load();
    // Keep the open results view live
    const refresh = debounce(load, 1000);
    A.on('results', (p) => {
      if (!p || !p.quizId || p.quizId === String(quizId)) refresh();
    }, m.el); // skipped automatically once the modal is closed
  };

  // ---- Quizzes view ----------------------------------------------------------------------------------
  A.register('quizzes', {
    title: 'Quizzes',
    async render(el) {
      let quizzes = (await api('/quizzes')).data;
      let status = 'all';
      let type = 'all';
      let term = '';
      setHTML(el, html`
        <div class="view-head">
          <div><h2>All quizzes</h2><p>Create, schedule and analyse every quiz. Click a row to open its results.</p></div>
          <div class="row wrap">
            <button class="btn btn-secondary" type="button" id="qEmbed">${icon('link', 'icon-sm')}Embed form</button>
            <a class="btn btn-primary" href="create-quiz.html">${icon('plus', 'icon-sm')}New quiz</a>
          </div>
        </div>
        <section class="card">
          <div class="toolbar">
            <div class="input-wrap">${icon('search')}<input class="input" type="search" id="qSearch" placeholder="Search quizzes" aria-label="Search quizzes"></div>
            <div class="segmented" role="group" aria-label="Status" id="qStatus">
              ${[['all', 'All'], ['live', 'Live'], ['scheduled', 'Scheduled'], ['ended', 'Ended'], ['inactive', 'Hidden']].map(([k, l]) => html`<button type="button" data-s="${k}" aria-pressed="${k === 'all'}">${l}</button>`)}
            </div>
            <select class="select" id="qType" aria-label="Type"><option value="all">All types</option><option value="native">Native exams</option><option value="google_form">External forms</option></select>
          </div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Quiz</th><th>Status</th><th>Window</th><th>Audience</th><th class="num">Submissions</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="qRows"></tbody>
          </table></div>
        </section>`);

      const draw = () => {
        const list = quizzes.filter((q) => (status === 'all' || q.status === status)
          && (type === 'all' || q.type === type)
          && (!term || q.title.toLowerCase().includes(term)));
        setHTML($('#qRows'), list.length ? list.map((q) => html`
          <tr class="is-clickable" data-row="${q._id}">
            <td><div class="quiz-title-cell"><strong>${q.title}</strong><span>${typeLabel(q)}</span></div></td>
            <td>${statusBadge(q.status)}</td>
            <td class="small nowrap">${fmt.dateTime(q.startTime)}<br><span class="subtle">→ ${fmt.dateTime(q.endTime)}</span></td>
            <td class="small">${targetLabel(q)}</td>
            <td class="num"><strong>${q.submissions}</strong>${q.inProgress ? html`<br><span class="xsmall text-warning">${q.inProgress} in progress</span>` : ''}</td>
            <td class="actions">${A.actionMenu([
              { action: 'results', id: q._id, icon: 'chart', label: 'Results & analytics' },
              q.type === 'native' && { action: 'preview', id: q._id, icon: 'eye', label: 'Preview questions' },
              { action: 'edit', id: q._id, icon: 'edit', label: 'Edit' },
              q.type === 'native' && { action: 'duplicate', id: q._id, icon: 'copy', label: 'Duplicate' },
              { action: 'toggle', id: q._id, icon: q.isActive ? 'eye-off' : 'eye', label: q.isActive ? 'Hide from students' : 'Publish to students' },
              { action: 'csv', id: q._id, icon: 'download', label: 'Export CSV' },
              q.status === 'live' && { action: 'force', id: q._id, icon: 'stop', label: 'Force end now', danger: true },
              '-',
              { action: 'delete', id: q._id, icon: 'trash', label: 'Delete', danger: true }
            ])}</td>
          </tr>`) : A.emptyRow(6, 'file', quizzes.length ? 'No quizzes match these filters' : 'No quizzes yet', quizzes.length ? 'Try a different status or search.' : 'Create your first quiz or embed an external form.'));
      };
      draw();

      const reload = async () => {
        if (!$('#qRows')) return; // navigated away
        quizzes = (await api('/quizzes')).data;
        if ($('#qRows')) draw();
      };
      $('#qSearch').addEventListener('input', debounce((e) => { term = e.target.value.trim().toLowerCase(); draw(); }, 150));
      $('#qStatus').addEventListener('click', (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        status = b.dataset.s;
        $$('#qStatus button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        draw();
      });
      $('#qType').addEventListener('change', (e) => { type = e.target.value; draw(); });
      $('#qEmbed').addEventListener('click', () => A.openEmbedModal());

      $('#qRows').addEventListener('click', async (e) => {
        if (e.target.closest('[data-menu]')) return;
        const actionBtn = e.target.closest('[data-action]');
        const row = e.target.closest('[data-row]');
        if (!actionBtn) { if (row && !e.target.closest('.action-menu')) A.openResults(row.dataset.row); return; }
        const id = actionBtn.dataset.id;
        const q = quizzes.find((x) => x._id === id);
        const act = actionBtn.dataset.action;
        try {
          if (act === 'results') A.openResults(id);
          if (act === 'preview') await preview(id);
          if (act === 'edit') { if (q.type === 'google_form') A.openEmbedModal(q); else location.href = `create-quiz.html?id=${id}`; }
          if (act === 'duplicate') location.href = `create-quiz.html?duplicate=${id}`;
          if (act === 'csv') exportCsv(id, q.title);
          if (act === 'force') { if (await A.forceEnd(id, q.title)) reload(); }
          if (act === 'toggle') {
            await api(`/quizzes/${id}`, { method: 'PUT', body: { isActive: !q.isActive } });
            toast(q.isActive ? 'Quiz hidden from students.' : 'Quiz published — matching students were notified.', { type: 'success' });
            reload();
          }
          if (act === 'delete') {
            const ok = await confirmDialog({
              title: `Delete “${q.title}”?`,
              message: q.submissions || q.inProgress
                ? `This permanently deletes the quiz and ${q.submissions + q.inProgress} student attempt${q.submissions + q.inProgress === 1 ? '' : 's'}, including scores. Consider hiding it instead.`
                : 'This permanently deletes the quiz.',
              confirmText: 'Delete quiz', danger: true, icon: 'trash'
            });
            if (!ok) return;
            await api(`/quizzes/${id}`, { method: 'DELETE' });
            toast('Quiz deleted.', { type: 'success' });
            reload();
          }
        } catch (err) { toast(err.message, { type: 'error' }); }
      });

      A.on('quizzes', debounce(reload, 400), el);
      A.on('results', debounce(reload, 1500), el);
    }
  });
})();
