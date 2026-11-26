/* Quiz builder: create / edit / duplicate native quizzes */
(async () => {
  const { requireAuth, api, html, setHTML, icon, fmt, toast, openModal, confirmDialog, setLoading, debounce, bindTargeting, targetLabel, $, $$ } = QM;

  await requireAuth({ role: 'admin' });
  const main = $('#main');
  const params = new URLSearchParams(location.search);
  const editId = params.get('id');
  const dupId = params.get('duplicate');
  const mode = editId ? 'edit' : dupId ? 'duplicate' : 'create';
  const DRAFT_KEY = 'quizmuj_quiz_draft';
  let ctx = {};
  try { ctx = JSON.parse(sessionStorage.getItem('quizmuj_admin_context') || 'null') || {}; } catch (e) { ctx = {}; }

  // ---- Load source quiz (edit / duplicate) --------------------------------------------------
  let source = null;
  let attempts = 0;
  try {
    if (editId || dupId) {
      source = (await api(`/quizzes/${editId || dupId}`)).data;
      if (source.type !== 'native') {
        QM.flash('External forms are edited from the Quizzes list.', 'info');
        location.replace('admin.html#quizzes');
        return;
      }
    }
    if (editId) {
      const entry = (await api('/quizzes')).data.find((q) => q._id === editId);
      attempts = entry ? entry.submissions + entry.inProgress : 0;
    }
  } catch (err) {
    setHTML(main, html`<div class="empty"><div class="empty-icon">${icon('alert')}</div><h3>Couldn’t load the quiz</h3><p>${err.message}</p><a class="btn btn-primary" href="admin.html#quizzes">Back to quizzes</a></div>`);
    return;
  }
  const locked = mode === 'edit' && attempts > 0;

  // ---- State ---------------------------------------------------------------------------------------
  let uid = 0;
  const mkQ = (q = {}) => {
    const options = q.options && q.options.length ? q.options.slice() : ['', '', '', ''];
    return {
      key: ++uid,
      questionText: q.questionText || '',
      options,
      correct: q.correctAnswer !== undefined ? Math.max(0, options.indexOf(q.correctAnswer)) : (q.correct || 0),
      tags: Array.isArray(q.tags) ? q.tags.join(', ') : (q.tags || ''),
      explanation: q.explanation || '',
      showExtra: Boolean(q.explanation || (q.tags && q.tags.length))
    };
  };
  const now = new Date();
  now.setSeconds(0, 0);
  const ctxStart = ctx.defaultStart && new Date(ctx.defaultStart) > now ? new Date(ctx.defaultStart) : now;
  const state = {
    title: '',
    description: '',
    startTime: ctxStart,
    endTime: new Date(ctxStart.getTime() + 7 * 24 * 3600 * 1000),
    timeLimit: Number(ctx.defaultDuration) || 30,
    pointsPerQuestion: 1,
    passPercentage: 40,
    shuffleQuestions: false,
    shuffleOptions: false,
    answerReveal: 'after_end',
    isActive: true,
    targets: {
      targetProgram: ctx.targetProgram || 'All',
      targetBranch: ctx.targetBranch || 'All',
      targetBatchYear: ctx.targetBatchYear || 'All',
      targetSemester: ctx.targetSemester || 'All',
      targetSection: ctx.targetSection || 'All'
    },
    questions: [mkQ()]
  };
  if (source) {
    Object.assign(state, {
      title: mode === 'duplicate' ? `Copy of ${source.title}`.slice(0, 100) : source.title,
      description: source.description || '',
      timeLimit: source.timeLimit,
      pointsPerQuestion: source.pointsPerQuestion,
      passPercentage: source.passPercentage ?? 40,
      shuffleQuestions: Boolean(source.shuffleQuestions),
      shuffleOptions: Boolean(source.shuffleOptions),
      answerReveal: source.answerReveal || 'after_end',
      isActive: mode === 'duplicate' ? true : source.isActive,
      targets: {
        targetProgram: source.targetProgram, targetBranch: source.targetBranch, targetBatchYear: source.targetBatchYear,
        targetSemester: source.targetSemester, targetSection: source.targetSection
      },
      questions: source.questions.map(mkQ)
    });
    if (mode === 'edit') {
      state.startTime = new Date(source.startTime);
      state.endTime = new Date(source.endTime);
    }
  } else if (ctx.subjectName) {
    state.title = `${ctx.subjectName} – `;
  }

  // Offer to restore an unsaved draft (new quizzes only)
  if (mode === 'create') {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
    if (draft && draft.state && draft.state.questions) {
      const restore = await confirmDialog({
        title: 'Restore your unsaved draft?',
        message: `You were working on “${draft.state.title || 'Untitled quiz'}” (${draft.state.questions.length} question${draft.state.questions.length === 1 ? '' : 's'}) — last saved ${fmt.relative(draft.savedAt)}.`,
        confirmText: 'Restore draft',
        cancelText: 'Start fresh',
        icon: 'save',
        dismissible: false // Esc/backdrop must not silently discard the draft
      });
      if (restore) {
        Object.assign(state, draft.state, {
          startTime: new Date(draft.state.startTime),
          endTime: new Date(draft.state.endTime),
          questions: draft.state.questions.map((q) => mkQ(q))
        });
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  }

  // ---- Layout ------------------------------------------------------------------------------------------
  const HEAD = {
    create: ['New quiz', 'Create a quiz', 'Write questions, schedule the window and choose exactly who can take it.'],
    edit: ['Editing', 'Edit quiz', 'Changes apply immediately for students. Running attempts adopt the new window and time limit.'],
    duplicate: ['Duplicate', 'Duplicate quiz', 'A fresh copy with no attempts — adjust anything before publishing.']
  }[mode];
  document.title = `${HEAD[1]} | QuizMUJ`;

  setHTML(main, html`
    <div class="page-head">
      <div><span class="eyebrow">${HEAD[0]}</span><h1>${HEAD[1]}</h1><p>${HEAD[2]}</p></div>
    </div>
    <div class="builder">
      <div class="builder-main">
        <section class="card">
          <div class="card-head"><h2><span class="step-num">1</span>Details</h2></div>
          <div class="card-body stack">
            <div class="field"><label class="label" for="fTitle">Title <span class="counter" id="titleCount"></span></label><input class="input" id="fTitle" maxlength="100" placeholder="e.g. Database Management Systems – Midterm"><span class="field-error"></span></div>
            <div class="field"><label class="label" for="fDesc">Instructions <span class="counter" id="descCount"></span></label><textarea class="textarea" id="fDesc" maxlength="500" rows="3" placeholder="Shown to students before they start, e.g. syllabus covered and allowed materials."></textarea></div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2><span class="step-num">2</span>Schedule &amp; rules</h2></div>
          <div class="card-body stack">
            <div class="form-grid">
              <div class="field"><label class="label" for="fStart">Opens</label><input class="input" type="datetime-local" id="fStart"><span class="field-error"></span></div>
              <div class="field"><label class="label" for="fEnd">Closes</label><input class="input" type="datetime-local" id="fEnd"><span class="field-error"></span></div>
              <div class="field"><label class="label" for="fLimit">Time limit <span class="opt">minutes</span></label><input class="input" type="number" id="fLimit" min="1" max="600"><span class="field-error"></span></div>
              <div class="field"><label class="label" for="fPoints">Points per question</label><input class="input" type="number" id="fPoints" min="1" max="100"><span class="field-error"></span></div>
              <div class="field"><label class="label" for="fPass">Pass mark <span class="opt">%</span></label><input class="input" type="number" id="fPass" min="0" max="100"><span class="field-error"></span></div>
              <div class="field"><label class="label" for="fReveal">Show correct answers</label>
                <select class="select" id="fReveal">
                  <option value="after_end">After the quiz closes (recommended)</option>
                  <option value="immediately">Immediately after submitting</option>
                  <option value="never">Never</option>
                </select></div>
            </div>
            <div class="switch-row">
              <label class="switch"><input type="checkbox" id="fShuffleQ"><span class="track"></span><span class="switch-text"><strong>Shuffle questions</strong><span>Each student gets a different order</span></span></label>
              <label class="switch"><input type="checkbox" id="fShuffleO"><span class="track"></span><span class="switch-text"><strong>Shuffle options</strong><span>Randomise answer order</span></span></label>
              <label class="switch"><input type="checkbox" id="fActive"><span class="track"></span><span class="switch-text"><strong>Visible to students</strong><span>Turn off to save as hidden</span></span></label>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2><span class="step-num">3</span>Audience</h2><span class="badge badge-brand badge-wrap" id="audienceBadge"></span></div>
          <div class="card-body">
            <div class="target-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem">
              <select class="select" id="tProgram" aria-label="Program"></select>
              <select class="select" id="tBranch" aria-label="Branch"></select>
              <select class="select" id="tBatch" aria-label="Batch"></select>
              <select class="select" id="tSemester" aria-label="Semester"></select>
              <select class="select" id="tSection" aria-label="Section"></select>
            </div>
            <p class="hint mt-1">Only students whose profile matches every selected field will see this quiz. “All” matches everyone.</p>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2><span class="step-num">4</span>Questions <span class="badge" id="qCountBadge"></span></h2>
            <div class="q-actions">
              <button class="btn btn-secondary btn-sm" type="button" id="fromBank" ${locked ? 'disabled' : ''}>${icon('database', 'icon-sm')}From bank</button>
              <button class="btn btn-secondary btn-sm" type="button" id="fromCsv" ${locked ? 'disabled' : ''}>${icon('upload', 'icon-sm')}Import CSV</button>
              <input type="file" id="csvInput" accept=".csv,text/csv" hidden>
            </div>
          </div>
          <div class="card-body">
            ${locked ? html`<div class="callout warning locked-note">${icon('lock')}<div><strong>Questions are locked.</strong> ${attempts} student${attempts === 1 ? ' has' : 's have'} already attempted this quiz, so changing questions would make results inconsistent. You can still edit the details, schedule and audience — or <a href="create-quiz.html?duplicate=${editId}">duplicate it</a> to change questions.</div></div>` : ''}
            <div class="q-list" id="qList"></div>
            ${locked ? '' : html`<button class="btn btn-secondary btn-block mt-2" type="button" id="addQ">${icon('plus', 'icon-sm')}Add question</button>`}
          </div>
        </section>
      </div>

      <aside class="summary">
        <section class="card">
          <div class="card-head"><h2>${icon('list')}Summary</h2></div>
          <div class="card-body"><dl class="kv" id="summaryKv"></dl></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>${icon('check-circle')}Ready to publish?</h2></div>
          <div class="card-body stack">
            <ul class="checklist" id="checklist"></ul>
            <button class="btn btn-primary btn-lg btn-block" type="button" id="saveBtn">${mode === 'edit' ? 'Save changes' : 'Publish quiz'}</button>
            ${mode === 'create' ? html`<button class="btn btn-ghost btn-block" type="button" id="discardBtn">Discard draft</button>` : ''}
          </div>
        </section>
      </aside>
    </div>`);

  // ---- Bind basic fields ----------------------------------------------------------------------------------
  const f = {
    title: $('#fTitle'), desc: $('#fDesc'), start: $('#fStart'), end: $('#fEnd'), limit: $('#fLimit'), points: $('#fPoints'),
    pass: $('#fPass'), reveal: $('#fReveal'), shuffleQ: $('#fShuffleQ'), shuffleO: $('#fShuffleO'), active: $('#fActive')
  };
  f.title.value = state.title;
  f.desc.value = state.description;
  f.start.value = fmt.toInputValue(state.startTime);
  f.end.value = fmt.toInputValue(state.endTime);
  f.limit.value = state.timeLimit;
  f.points.value = state.pointsPerQuestion;
  f.pass.value = state.passPercentage;
  f.reveal.value = state.answerReveal;
  f.shuffleQ.checked = state.shuffleQuestions;
  f.shuffleO.checked = state.shuffleOptions;
  f.active.checked = state.isActive;

  const fieldErr = (input, msg) => {
    const field = input.closest('.field');
    field.classList.toggle('has-error', Boolean(msg));
    const e = field.querySelector('.field-error');
    if (e) e.textContent = msg || '';
  };

  const targeting = await bindTargeting({
    program: $('#tProgram'), branch: $('#tBranch'), batchYear: $('#tBatch'), semester: $('#tSemester'), section: $('#tSection')
  }, state.targets);

  // ---- Draft autosave ----------------------------------------------------------------------------------------
  const saveDraft = debounce(() => {
    if (mode !== 'create') return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), state: { ...state, questions: state.questions.map(({ key, ...q }) => q) } }));
      $('#draftStatus').textContent = `Draft saved · ${fmt.time(new Date())}`;
    } catch (e) { /* storage full */ }
  }, 700);

  const readFields = () => {
    state.title = f.title.value;
    state.description = f.desc.value;
    state.startTime = new Date(f.start.value);
    state.endTime = new Date(f.end.value);
    state.timeLimit = Number(f.limit.value);
    state.pointsPerQuestion = Number(f.points.value);
    state.passPercentage = Number(f.pass.value);
    state.answerReveal = f.reveal.value;
    state.shuffleQuestions = f.shuffleQ.checked;
    state.shuffleOptions = f.shuffleO.checked;
    state.isActive = f.active.checked;
    state.targets = targeting.value();
  };

  // ---- Questions -------------------------------------------------------------------------------------------------
  const LETTERS = 'ABCDEF';
  const questionError = (q) => {
    if (!q.questionText.trim()) return 'Enter the question text';
    const filled = q.options.map((o) => o.trim()).filter(Boolean);
    if (filled.length < 2) return 'Add at least two options';
    if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) return 'Options must be unique';
    if (!(q.options[q.correct] || '').trim()) return 'Select which option is correct';
    return null;
  };

  const cardHtml = (q, i) => html`
    <div class="q-card ${locked ? 'locked' : ''}" data-key="${q.key}">
      <div class="q-card-head">
        <strong>Question ${i + 1}</strong>
        ${locked ? '' : html`<div class="q-tools">
          <button class="btn btn-ghost btn-sm btn-icon" type="button" data-tool="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('chevron-up', 'icon-sm')}</button>
          <button class="btn btn-ghost btn-sm btn-icon" type="button" data-tool="down" aria-label="Move down" ${i === state.questions.length - 1 ? 'disabled' : ''}>${icon('chevron-down', 'icon-sm')}</button>
          <button class="btn btn-ghost btn-sm btn-icon" type="button" data-tool="dup" aria-label="Duplicate question">${icon('copy', 'icon-sm')}</button>
          <button class="btn btn-ghost btn-sm btn-icon" type="button" data-tool="del" aria-label="Delete question" ${state.questions.length === 1 ? 'disabled' : ''}>${icon('trash', 'icon-sm')}</button>
        </div>`}
      </div>
      <textarea class="textarea" rows="2" data-f="questionText" maxlength="2000" placeholder="Type the question…" aria-label="Question ${i + 1} text">${q.questionText}</textarea>
      <div class="opt-list">${q.options.map((o, oi) => html`
        <div class="opt-row ${oi === q.correct ? 'is-correct' : ''}">
          <input type="radio" name="correct-${q.key}" data-correct="${oi}" ${oi === q.correct ? 'checked' : ''} aria-label="Mark option ${LETTERS[oi]} as correct">
          <span class="letter">${LETTERS[oi]}</span>
          <input class="input" data-opt="${oi}" value="${o}" maxlength="500" placeholder="Option ${LETTERS[oi]}" aria-label="Option ${LETTERS[oi]}">
          ${locked ? html`<span></span>` : html`<button class="btn btn-ghost btn-sm btn-icon" type="button" data-rmopt="${oi}" aria-label="Remove option ${LETTERS[oi]}" ${q.options.length <= 2 ? 'disabled' : ''}>${icon('x', 'icon-sm')}</button>`}
        </div>`)}
      </div>
      <div class="row-between">
        ${locked ? html`<span></span>` : html`<button class="link-btn small" type="button" data-addopt ${q.options.length >= 6 ? 'disabled' : ''}>+ Add option</button>`}
        <button class="link-btn small" type="button" data-extra>${q.showExtra ? 'Hide' : 'Add'} tags &amp; explanation</button>
      </div>
      <div class="q-extra" ${q.showExtra ? '' : 'hidden'}>
        <input class="input" data-f="tags" value="${q.tags}" placeholder="Tags, e.g. joins, sql" aria-label="Tags">
        <input class="input" data-f="explanation" value="${q.explanation}" maxlength="2000" placeholder="Explanation shown after answers are revealed" aria-label="Explanation">
      </div>
      <div class="q-error" hidden></div>
      ${locked ? '' : html`<p class="hint mt-1">Select the radio button next to the correct answer.</p>`}
    </div>`;

  const renderQuestions = () => {
    setHTML($('#qList'), state.questions.map((q, i) => cardHtml(q, i)));
    updateSummary();
  };
  const cardOf = (el) => {
    const card = el.closest('[data-key]');
    return card ? { card, q: state.questions.find((x) => String(x.key) === card.dataset.key) } : {};
  };
  let dirty = false;
  const changed = () => { dirty = true; updateSummary(); saveDraft(); };
  // New quizzes autosave as drafts; edits warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (dirty && mode !== 'create') { e.preventDefault(); e.returnValue = ''; }
  });

  $('#qList').addEventListener('input', (e) => {
    const { card, q } = cardOf(e.target);
    if (!q) return;
    if (e.target.dataset.f) q[e.target.dataset.f] = e.target.value;
    if (e.target.dataset.opt !== undefined) q.options[Number(e.target.dataset.opt)] = e.target.value;
    card.classList.remove('has-error');
    card.querySelector('.q-error').hidden = true;
    changed();
  });
  $('#qList').addEventListener('change', (e) => {
    if (e.target.dataset.correct === undefined) return;
    const { card, q } = cardOf(e.target);
    q.correct = Number(e.target.dataset.correct);
    $$('.opt-row', card).forEach((r, i) => r.classList.toggle('is-correct', i === q.correct));
    changed();
  });
  $('#qList').addEventListener('click', (e) => {
    const { card, q } = cardOf(e.target);
    if (!q) return;
    const idx = state.questions.indexOf(q);
    const tool = e.target.closest('[data-tool]');
    const rm = e.target.closest('[data-rmopt]');
    if (e.target.closest('[data-extra]')) {
      q.showExtra = !q.showExtra;
      card.querySelector('.q-extra').hidden = !q.showExtra;
      e.target.closest('[data-extra]').textContent = `${q.showExtra ? 'Hide' : 'Add'} tags & explanation`;
      return;
    }
    if (locked) return;
    if (e.target.closest('[data-addopt]')) {
      if (q.options.length >= 6) return;
      q.options.push('');
      renderQuestions();
      $(`[data-key="${q.key}"] [data-opt="${q.options.length - 1}"]`).focus();
      changed();
      return;
    }
    if (rm) {
      const oi = Number(rm.dataset.rmopt);
      q.options.splice(oi, 1);
      if (q.correct === oi) q.correct = 0;
      else if (q.correct > oi) q.correct--;
      renderQuestions();
      changed();
      return;
    }
    if (tool) {
      const t = tool.dataset.tool;
      if (t === 'up' && idx > 0) [state.questions[idx - 1], state.questions[idx]] = [state.questions[idx], state.questions[idx - 1]];
      if (t === 'down' && idx < state.questions.length - 1) [state.questions[idx + 1], state.questions[idx]] = [state.questions[idx], state.questions[idx + 1]];
      if (t === 'dup') state.questions.splice(idx + 1, 0, mkQ({ ...q, key: undefined, tags: q.tags }));
      if (t === 'del') {
        if (state.questions.length === 1) return;
        state.questions.splice(idx, 1);
      }
      renderQuestions();
      changed();
    }
  });

  const addQuestion = () => {
    state.questions.push(mkQ());
    renderQuestions();
    const last = $$('.q-card').pop();
    last.querySelector('textarea').focus();
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    changed();
  };
  if (!locked) $('#addQ').addEventListener('click', addQuestion);

  // Replace the untouched starter question when importing
  const appendQuestions = (list) => {
    const blank = state.questions.length === 1 && !state.questions[0].questionText.trim() && state.questions[0].options.every((o) => !o.trim());
    if (blank) state.questions = [];
    const existing = new Set(state.questions.map((q) => q.questionText.trim().toLowerCase()));
    let added = 0;
    list.forEach((q) => {
      if (existing.has(q.questionText.trim().toLowerCase())) return;
      existing.add(q.questionText.trim().toLowerCase());
      state.questions.push(mkQ(q));
      added++;
    });
    if (!state.questions.length) state.questions.push(mkQ());
    renderQuestions();
    changed();
    return added;
  };

  // ---- Question bank picker ------------------------------------------------------------------------------------
  if (!locked) $('#fromBank').addEventListener('click', async () => {
    const picked = new Map();
    const m = openModal({
      title: 'Add from question bank',
      size: 'lg',
      iconName: 'database',
      body: html`<div class="row wrap"><div class="input-wrap grow">${icon('search')}<input class="input" type="search" id="bkSearch" placeholder="Search questions" aria-label="Search questions"></div><select class="select" id="bkTag" style="width:auto" aria-label="Tag"><option value="">All tags</option></select></div><div class="bank-pick" id="bkList"></div>`,
      footer: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="bkAdd" disabled>Add selected</button>`
    });
    const load = async () => {
      const qs = new URLSearchParams({ limit: 50 });
      if ($('#bkSearch').value.trim()) qs.set('search', $('#bkSearch').value.trim());
      if ($('#bkTag').value) qs.set('tag', $('#bkTag').value);
      try {
        const r = await api(`/admin/questions?${qs}`);
        if (!document.body.contains(m.el)) return; // picker closed while loading
        const tagSel = $('#bkTag');
        if (tagSel.options.length === 1) setHTML(tagSel, html`<option value="">All tags</option>${r.tags.map((t) => html`<option value="${t}">#${t}</option>`)}`);
        setHTML($('#bkList'), r.data.length ? r.data.map((q) => html`
          <label><input type="checkbox" data-id="${q._id}" ${picked.has(q._id) ? 'checked' : ''}><span><strong>${q.questionText}</strong><small>${q.options.length} options · answer: ${q.correctAnswer}${q.tags.length ? ` · #${q.tags.join(' #')}` : ''}</small></span></label>`)
          : html`<div class="empty"><div class="empty-icon">${icon('database')}</div><h3>No questions found</h3><p>Import questions from the console’s Question bank, or write them here directly.</p></div>`);
        $$('#bkList input').forEach((cb) => cb.addEventListener('change', () => {
          const q = r.data.find((x) => x._id === cb.dataset.id);
          if (cb.checked) picked.set(q._id, q); else picked.delete(q._id);
          $('#bkAdd').disabled = !picked.size;
          $('#bkAdd').textContent = picked.size ? `Add ${picked.size} question${picked.size === 1 ? '' : 's'}` : 'Add selected';
        }));
      } catch (err) { setHTML($('#bkList'), html`<p class="text-critical">${err.message}</p>`); }
    };
    $('#bkSearch').addEventListener('input', debounce(load, 250));
    $('#bkTag').addEventListener('change', load);
    $('#bkAdd').addEventListener('click', () => {
      const added = appendQuestions([...picked.values()]);
      m.close();
      toast(`${added} question${added === 1 ? '' : 's'} added from the bank.`, { type: 'success' });
    });
    load();
  });

  // ---- CSV import straight into the quiz -------------------------------------------------------------------------
  if (!locked) {
    $('#fromCsv').addEventListener('click', () => $('#csvInput').click());
    $('#csvInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const btn = $('#fromCsv');
      setLoading(btn, true);
      try {
        const r = await api('/admin/questions/bulk?saveToBank=false', { method: 'POST', body: fd });
        const added = appendQuestions(r.questions);
        toast(`${added} question${added === 1 ? '' : 's'} imported${r.skipped.length ? `, ${r.skipped.length} row${r.skipped.length === 1 ? '' : 's'} skipped (e.g. row ${r.skipped[0].row}: ${r.skipped[0].reason})` : ''}.`, { type: r.skipped.length ? 'warning' : 'success', timeout: 7000 });
      } catch (err) {
        toast(err.message, { type: 'error', timeout: 7000 });
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ---- Summary & checklist ------------------------------------------------------------------------------------------
  const validWindow = () => !Number.isNaN(state.startTime.getTime()) && !Number.isNaN(state.endTime.getTime()) && state.endTime > state.startTime;
  function updateSummary() {
    readFields();
    $('#titleCount').textContent = `${state.title.length}/100`;
    $('#descCount').textContent = `${state.description.length}/500`;
    const n = state.questions.length;
    $('#qCountBadge').textContent = `${n}`;
    $('#audienceBadge').textContent = targetLabel(state.targets);
    const windowMin = validWindow() ? (state.endTime - state.startTime) / 60000 : 0;
    setHTML($('#summaryKv'), html`
      <dt>Questions</dt><dd>${n}</dd>
      <dt>Total points</dt><dd>${n * (state.pointsPerQuestion || 0)}</dd>
      <dt>Time limit</dt><dd>${state.timeLimit || '—'} min</dd>
      <dt>Opens</dt><dd>${validWindow() ? fmt.dateTime(state.startTime) : '—'}</dd>
      <dt>Closes</dt><dd>${validWindow() ? fmt.dateTime(state.endTime) : '—'}</dd>
      <dt>Audience</dt><dd>${targetLabel(state.targets)}</dd>
      <dt>Answers shown</dt><dd>${{ after_end: 'After close', immediately: 'Immediately', never: 'Never' }[state.answerReveal]}</dd>
      <dt>Visibility</dt><dd>${state.isActive ? 'Visible' : 'Hidden'}</dd>`);
    const complete = state.questions.filter((q) => !questionError(q)).length;
    const checks = [
      [state.title.trim().length > 0, 'Title added'],
      [validWindow(), 'Closing time is after opening time'],
      [validWindow() && state.endTime > new Date(), 'Window hasn’t already ended'],
      [state.timeLimit >= 1 && state.timeLimit <= 600, 'Time limit between 1 and 600 min'],
      [!validWindow() || windowMin >= state.timeLimit || windowMin === 0, windowMin && windowMin < state.timeLimit ? `Window (${Math.round(windowMin)} min) is shorter than the time limit` : 'Window fits the time limit'],
      [complete === n && n > 0, `${complete}/${n} questions complete`]
    ];
    setHTML($('#checklist'), checks.map(([ok, label]) => html`<li class="${ok ? 'ok' : ''}">${icon(ok ? 'check-circle' : 'alert')}${label}</li>`));
  }

  Object.values(f).forEach((el) => el.addEventListener('input', () => { fieldErr(el, ''); changed(); }));
  Object.values(f).forEach((el) => el.addEventListener('change', changed));
  ['#tProgram', '#tBranch', '#tBatch', '#tSemester', '#tSection'].forEach((s) => $(s).addEventListener('change', changed));
  renderQuestions();

  // ---- Save ----------------------------------------------------------------------------------------------------------
  const validate = () => {
    readFields();
    let firstBad = null;
    const mark = (el, msg) => { fieldErr(el, msg); if (msg && !firstBad) firstBad = el; };
    mark(f.title, state.title.trim() ? '' : 'Give your quiz a title');
    mark(f.end, validWindow() ? '' : 'Closing time must be after opening time');
    if (validWindow() && state.endTime <= new Date() && mode !== 'edit') mark(f.end, 'This window has already ended — pick a future closing time');
    mark(f.limit, state.timeLimit >= 1 && state.timeLimit <= 600 ? '' : 'Between 1 and 600 minutes');
    mark(f.points, state.pointsPerQuestion >= 1 && state.pointsPerQuestion <= 100 ? '' : 'Between 1 and 100');
    mark(f.pass, state.passPercentage >= 0 && state.passPercentage <= 100 ? '' : 'Between 0 and 100');
    if (!locked) {
      state.questions.forEach((q) => {
        const err = questionError(q);
        const card = $(`[data-key="${q.key}"]`);
        card.classList.toggle('has-error', Boolean(err));
        const box = card.querySelector('.q-error');
        box.hidden = !err;
        box.textContent = err || '';
        if (err && !firstBad) firstBad = card;
      });
    }
    if (firstBad) {
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (firstBad.focus) setTimeout(() => firstBad.focus({ preventScroll: true }), 300);
      return false;
    }
    return true;
  };

  const payload = () => {
    const body = {
      type: 'native',
      title: state.title.trim(),
      description: state.description.trim(),
      startTime: state.startTime.toISOString(),
      endTime: state.endTime.toISOString(),
      timeLimit: state.timeLimit,
      pointsPerQuestion: state.pointsPerQuestion,
      passPercentage: state.passPercentage,
      answerReveal: state.answerReveal,
      shuffleQuestions: state.shuffleQuestions,
      shuffleOptions: state.shuffleOptions,
      isActive: state.isActive,
      ...state.targets
    };
    if (!locked) {
      body.questions = state.questions.map((q) => ({
        questionText: q.questionText.trim(),
        options: q.options.map((o) => o.trim()).filter(Boolean),
        correctAnswer: q.options[q.correct].trim(),
        tags: q.tags.split(',').map((t) => t.trim()).filter(Boolean),
        explanation: q.explanation.trim()
      }));
    }
    return body;
  };

  $('#saveBtn').addEventListener('click', async () => {
    if (!validate()) { toast('Fix the highlighted fields first.', { type: 'warning' }); return; }
    const btn = $('#saveBtn');
    setLoading(btn, true);
    try {
      if (mode === 'edit') await api(`/quizzes/${editId}`, { method: 'PUT', body: payload() });
      else await api('/quizzes', { method: 'POST', body: payload() });
      localStorage.removeItem(DRAFT_KEY);
      QM.flash(mode === 'edit' ? 'Quiz updated.' : (state.isActive ? 'Quiz published — matching students were notified.' : 'Quiz saved as hidden.'), 'success');
      dirty = false;
      location.href = 'admin.html#quizzes';
    } catch (err) {
      setLoading(btn, false);
      toast(err.message, { type: 'error', title: 'Could not save the quiz', timeout: 8000 });
    }
  });

  const discard = $('#discardBtn');
  if (discard) discard.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Discard this draft?', message: 'Everything you entered will be cleared.', confirmText: 'Discard', danger: true, icon: 'trash' }))) return;
    localStorage.removeItem(DRAFT_KEY);
    location.href = 'create-quiz.html';
  });
})();
