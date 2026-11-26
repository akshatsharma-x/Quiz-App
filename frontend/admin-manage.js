/* Faculty console: question bank, students & admins, announcements, settings */
(() => {
  const { api, html, setHTML, icon, fmt, toast, openModal, confirmDialog, setLoading, initials, debounce, bindTargeting, downloadBlob, targetLabel, session, validPassword, $, $$ } = QM;
  const A = window.QMAdmin;

  const fieldErr = (input, msg) => {
    const f = input.closest('.field');
    f.classList.toggle('has-error', Boolean(msg));
    const e = f.querySelector('.field-error');
    if (e) e.textContent = msg || '';
  };

  // =======================================================================================
  // Question bank
  // =======================================================================================
  const CSV_TEMPLATE = [
    'QuestionText,Option1,Option2,Option3,Option4,CorrectAnswer,Explanation,Tags',
    '"What is the time complexity of binary search?",O(n),O(log n),O(1),O(n log n),B,"The search space halves each step.","algorithms, searching"',
    '"Which SQL clause filters grouped rows?",WHERE,HAVING,ORDER BY,GROUP BY,HAVING,,"dbms, sql"'
  ].join('\n');

  A.openImportModal = ({ saveToBank = true, onDone } = {}) => {
    const m = openModal({
      title: 'Import questions from CSV',
      description: 'Columns: QuestionText, Option1…Option6, CorrectAnswer (option text, a letter A–F or a number 1–6), Explanation, Tags.',
      iconName: 'upload',
      size: 'lg',
      body: html`
        <label class="dropzone" id="dz" tabindex="0">
          <div class="empty-icon" style="margin:0 auto .75rem">${icon('file')}</div>
          <strong id="dzText">Drop a .csv file here or click to browse</strong>
          <p class="small muted mt-1">Up to 2 MB · UTF-8 · first row must be the header</p>
          <input type="file" id="dzInput" accept=".csv,text/csv" hidden>
        </label>
        <div id="dzResult" class="mt-2"></div>`,
      footer: html`<button class="btn btn-ghost" type="button" id="dzTemplate">${icon('download', 'icon-sm')}Download template</button><button class="btn btn-secondary" type="button" data-close>Close</button>`
    });
    const dz = $('#dz');
    const input = $('#dzInput');
    $('#dzTemplate').addEventListener('click', () => downloadBlob(new Blob([CSV_TEMPLATE], { type: 'text/csv' }), 'quizmuj_questions_template.csv'));
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0]); });

    const upload = async (file) => {
      if (!/\.csv$/i.test(file.name)) { toast('Please choose a .csv file.', { type: 'error' }); return; }
      if (file.size > 2 * 1024 * 1024) { toast('That file is larger than 2 MB.', { type: 'error' }); return; }
      $('#dzText').textContent = `Uploading ${file.name}…`;
      setHTML($('#dzResult'), html`<div class="meter"><span style="width:65%"></span></div>`);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await api(`/admin/questions/bulk?saveToBank=${saveToBank}`, { method: 'POST', body: fd });
        $('#dzText').textContent = `${file.name} processed`;
        setHTML($('#dzResult'), html`
          <div class="callout good">${icon('check-circle')}<div><strong>${r.message}</strong></div></div>
          ${r.skipped.length ? html`<div class="callout warning mt-1">${icon('alert')}<div><strong>${r.skipped.length} row${r.skipped.length === 1 ? '' : 's'} skipped</strong><div class="skip-list">${r.skipped.map((s) => html`<div>Row ${s.row}: ${s.reason}</div>`)}</div></div></div>` : ''}`);
        if (onDone) onDone(r.questions);
      } catch (err) {
        $('#dzText').textContent = 'Drop a .csv file here or click to browse';
        const skipped = (err.data && err.data.details && err.data.details.skipped) || [];
        setHTML($('#dzResult'), html`<div class="callout critical">${icon('x-circle')}<div><strong>${err.message}</strong>${skipped.length ? html`<div class="skip-list">${skipped.map((s) => html`<div>Row ${s.row}: ${s.reason}</div>`)}</div>` : ''}</div></div>`);
      } finally {
        input.value = '';
      }
    };
    return m;
  };

  const openQuestionModal = (onSaved) => {
    const m = openModal({
      title: 'Add a question to the bank',
      iconName: 'plus',
      size: 'lg',
      body: html`
        <form class="stack" id="qbForm" novalidate>
          <div class="field"><label class="label" for="qbText">Question</label><textarea class="textarea" id="qbText" maxlength="2000" required></textarea><span class="field-error"></span></div>
          <div class="field"><span class="label">Options <span class="opt">select the correct one</span></span>
            <div class="stack-sm" id="qbOptions">${[0, 1, 2, 3].map((i) => html`<div class="row"><input type="radio" name="qbCorrect" value="${i}" aria-label="Correct option ${i + 1}" ${i === 0 ? 'checked' : ''}><input class="input" data-opt placeholder="Option ${'ABCD'[i]}" maxlength="500"></div>`)}</div>
            <span class="field-error" id="qbOptErr"></span></div>
          <div class="form-grid">
            <div class="field"><label class="label" for="qbTags">Tags <span class="opt">comma separated</span></label><input class="input" id="qbTags" placeholder="e.g. dbms, normalisation"></div>
            <div class="field"><label class="label" for="qbExplain">Explanation <span class="opt">optional</span></label><input class="input" id="qbExplain" maxlength="2000"></div>
          </div>
        </form>`,
      footer: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="qbSave">Save question</button>`
    });
    $('#qbSave').addEventListener('click', async () => {
      const text = $('#qbText').value.trim();
      const rows = $$('#qbOptions .row');
      const options = rows.map((r) => r.querySelector('[data-opt]').value.trim());
      const ci = Number((m.el.querySelector('input[name="qbCorrect"]:checked') || {}).value);
      const filled = options.filter(Boolean);
      fieldErr($('#qbText'), text ? '' : 'Enter the question text');
      let optErr = '';
      if (filled.length < 2) optErr = 'Add at least two options';
      else if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) optErr = 'Options must be unique';
      else if (!options[ci]) optErr = 'The selected correct option is empty';
      $('#qbOptErr').textContent = optErr;
      $('#qbOptErr').closest('.field').classList.toggle('has-error', Boolean(optErr));
      if (!text || optErr) return;
      const btn = $('#qbSave');
      setLoading(btn, true);
      try {
        await api('/admin/questions', {
          method: 'POST',
          body: { questionText: text, options: filled, correctAnswer: options[ci], explanation: $('#qbExplain').value.trim(), tags: $('#qbTags').value.split(',').map((t) => t.trim()).filter(Boolean) }
        });
        m.close();
        toast('Question added to the bank.', { type: 'success' });
        onSaved();
      } catch (err) { setLoading(btn, false); toast(err.message, { type: 'error' }); }
    });
  };

  A.register('bank', {
    title: 'Question bank',
    async render(el) {
      let page = 1;
      let search = '';
      let tag = '';
      setHTML(el, html`
        <div class="view-head">
          <div><h2>Question bank</h2><p>Reusable questions for every quiz. Import from CSV or add them one by one, then pull them into the quiz builder.</p></div>
          <div class="row wrap">
            <button class="btn btn-secondary" type="button" id="bankImport">${icon('upload', 'icon-sm')}Import CSV</button>
            <button class="btn btn-primary" type="button" id="bankAdd">${icon('plus', 'icon-sm')}Add question</button>
          </div>
        </div>
        <section class="card">
          <div class="toolbar">
            <div class="input-wrap">${icon('search')}<input class="input" type="search" id="bankSearch" placeholder="Search question text" aria-label="Search questions"></div>
            <select class="select" id="bankTag" aria-label="Filter by tag"><option value="">All tags</option></select>
          </div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Question</th><th>Correct answer</th><th>Tags</th><th class="num">Added</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="bankRows"></tbody>
          </table></div>
          <div class="card-foot row-between" id="bankPager"></div>
        </section>`);

      const load = async () => {
        const qs = new URLSearchParams({ page, limit: 15 });
        if (search) qs.set('search', search);
        if (tag) qs.set('tag', tag);
        const r = await api(`/admin/questions?${qs}`);
        const sel = $('#bankTag');
        if (!sel) return; // navigated away while loading
        if (!r.data.length && r.total > 0 && page > r.pages) { page = r.pages; return load(); } // e.g. deleted the last row of the last page
        const current = sel.value;
        setHTML(sel, html`<option value="">All tags</option>${r.tags.map((t) => html`<option value="${t}">#${t}</option>`)}`);
        sel.value = current;
        setHTML($('#bankRows'), r.data.length ? r.data.map((q) => html`
          <tr>
            <td><div class="bank-q">${q.questionText}<small>${q.options.length} options${q.explanation ? ' · has explanation' : ''}</small></div></td>
            <td class="small">${q.correctAnswer}</td>
            <td>${q.tags.length ? html`<div class="chip-list">${q.tags.slice(0, 4).map((t) => html`<span class="badge">#${t}</span>`)}</div>` : html`<span class="subtle small">—</span>`}</td>
            <td class="num small">${fmt.date(q.createdAt)}</td>
            <td class="actions"><button class="btn btn-ghost btn-sm" type="button" data-del="${q._id}" aria-label="Delete question">${icon('trash', 'icon-sm')}</button></td>
          </tr>`) : A.emptyRow(5, 'database', search || tag ? 'No questions match' : 'Your question bank is empty', search || tag ? 'Try a different search or tag.' : 'Import a CSV or add questions to reuse them across quizzes.'));
        A.pager($('#bankPager'), { page: r.page, pages: r.pages, total: r.total, label: 'questions' }, (p) => { page = p; load(); });
      };
      await load();

      $('#bankSearch').addEventListener('input', debounce((e) => { search = e.target.value.trim(); page = 1; load(); }, 250));
      $('#bankTag').addEventListener('change', (e) => { tag = e.target.value; page = 1; load(); });
      $('#bankImport').addEventListener('click', () => A.openImportModal({ onDone: () => { page = 1; load(); } }));
      $('#bankAdd').addEventListener('click', () => openQuestionModal(load));
      $('#bankRows').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        if (!(await confirmDialog({ title: 'Delete this question?', message: 'It is removed from the bank. Quizzes that already use it are not affected.', confirmText: 'Delete', danger: true, icon: 'trash' }))) return;
        try { await api(`/admin/questions/${b.dataset.del}`, { method: 'DELETE' }); toast('Question deleted.', { type: 'success' }); load(); }
        catch (err) { toast(err.message, { type: 'error' }); }
      });
    }
  });

  // =======================================================================================
  // Students & admins
  // =======================================================================================
  const openAdminModal = (onSaved) => {
    const m = openModal({
      title: 'Add an administrator',
      description: 'Administrators can create quizzes, see every result and manage students.',
      iconName: 'user-plus',
      body: html`<form class="stack" novalidate>
        <div class="field"><label class="label" for="adName">Full name</label><input class="input" id="adName" maxlength="80"><span class="field-error"></span></div>
        <div class="field"><label class="label" for="adEmail">Email</label><input class="input" id="adEmail" type="email"><span class="field-error"></span></div>
        <div class="field"><label class="label" for="adPass">Temporary password</label><input class="input" id="adPass" type="text" autocomplete="off" placeholder="8+ characters, a letter and a number"><span class="field-error"></span><span class="hint">Share it securely and ask them to change it under Settings.</span></div>
      </form>`,
      footer: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="adSave">Create administrator</button>`
    });
    $('#adSave').addEventListener('click', async () => {
      const name = $('#adName').value.trim();
      const email = $('#adEmail').value.trim().toLowerCase();
      const password = $('#adPass').value;
      fieldErr($('#adName'), name ? '' : 'Enter a name');
      fieldErr($('#adEmail'), QM.validEmail(email) ? '' : 'Enter a valid email');
      fieldErr($('#adPass'), validPassword(password) ? '' : 'Use 8+ characters with a letter and a number');
      if (!name || !QM.validEmail(email) || !validPassword(password)) return;
      const btn = $('#adSave');
      setLoading(btn, true);
      try {
        await api('/admin/admins', { method: 'POST', body: { name, email, password } });
        m.close();
        toast(`${name} is now an administrator.`, { type: 'success' });
        onSaved();
      } catch (err) { setLoading(btn, false); fieldErr($('#adEmail'), err.message); }
    });
  };

  // Cascading program → branch / batch / semester selects (no "All": a real student cohort)
  const bindCohortSelects = async (els, initial = {}) => {
    const catalog = await QM.academics();
    QM.fillSelect(els.program, Object.keys(catalog.programs), { placeholder: 'Program', selected: initial.program });
    const refresh = (keep) => {
      const p = catalog.programs[els.program.value];
      const withCurrent = (list, v) => (v && !list.includes(v) ? [v, ...list] : list);
      if (!p) return;
      if (els.branch) QM.fillSelect(els.branch, els.branchAll ? p.branches : withCurrent(p.branches, keep.branch), { placeholder: 'Branch', allLabel: els.branchAll ? 'All branches' : undefined, selected: keep.branch });
      QM.fillSelect(els.batchYear, withCurrent(p.batchYears, keep.batchYear), { placeholder: 'Batch', selected: keep.batchYear });
      QM.fillSelect(els.semester, p.semesters, { placeholder: 'Semester', selected: keep.semester });
    };
    if (els.section) QM.fillSelect(els.section, catalog.sections, { placeholder: 'Section', selected: initial.section, labels: (x) => `Section ${x}` });
    refresh(initial);
    els.program.addEventListener('change', () => refresh({}));
  };

  const openCohortModal = async (u, onSaved) => {
    const m = openModal({
      title: `Academic profile · ${u.name}`,
      description: 'Students can’t change their cohort themselves once it is set. Corrections made here take effect immediately.',
      iconName: 'book',
      body: html`<div class="form-grid">
        <div class="field"><label class="label" for="cpProgram">Program</label><select class="select" id="cpProgram"></select></div>
        <div class="field"><label class="label" for="cpBranch">Branch</label><select class="select" id="cpBranch"></select></div>
        <div class="field"><label class="label" for="cpBatch">Batch</label><select class="select" id="cpBatch"></select></div>
        <div class="field"><label class="label" for="cpSemester">Semester</label><select class="select" id="cpSemester"></select></div>
        <div class="field span-2"><label class="label" for="cpSection">Section</label><select class="select" id="cpSection"></select></div>
      </div>`,
      footer: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" data-save>Save profile</button>`
    });
    const q$ = (sel) => m.el.querySelector(sel);
    await bindCohortSelects({ program: q$('#cpProgram'), branch: q$('#cpBranch'), batchYear: q$('#cpBatch'), semester: q$('#cpSemester'), section: q$('#cpSection') }, u);
    q$('[data-save]').addEventListener('click', async () => {
      const profile = { program: q$('#cpProgram').value, branch: q$('#cpBranch').value, batchYear: q$('#cpBatch').value, semester: q$('#cpSemester').value, section: q$('#cpSection').value };
      if (Object.values(profile).some((v) => !v)) { toast('Select every field.', { type: 'warning' }); return; }
      const btn = q$('[data-save]');
      setLoading(btn, true);
      try {
        await api(`/admin/users/${u._id}`, { method: 'PATCH', body: { profile } });
        m.close();
        toast(`${u.name}’s profile was updated.`, { type: 'success' });
        onSaved();
      } catch (err) { setLoading(btn, false); toast(err.message, { type: 'error' }); }
    });
  };

  const openPromoteModal = async (onDone) => {
    const m = openModal({
      title: 'Move a batch to a new semester',
      description: 'Updates the semester of every student in the selected program and batch — e.g. at the start of a new term.',
      iconName: 'trending',
      body: html`<div class="form-grid">
        <div class="field"><label class="label" for="pmProgram">Program</label><select class="select" id="pmProgram"></select></div>
        <div class="field"><label class="label" for="pmBranch">Branch</label><select class="select" id="pmBranch"></select></div>
        <div class="field"><label class="label" for="pmBatch">Batch</label><select class="select" id="pmBatch"></select></div>
        <div class="field"><label class="label" for="pmSemester">New semester</label><select class="select" id="pmSemester"></select></div>
      </div>`,
      footer: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" data-go>Update students</button>`
    });
    const q$ = (sel) => m.el.querySelector(sel);
    await bindCohortSelects({ program: q$('#pmProgram'), branch: q$('#pmBranch'), branchAll: true, batchYear: q$('#pmBatch'), semester: q$('#pmSemester') }, { branch: 'All' });
    q$('[data-go]').addEventListener('click', async () => {
      const body = { program: q$('#pmProgram').value, branch: q$('#pmBranch').value || 'All', batchYear: q$('#pmBatch').value, semester: q$('#pmSemester').value };
      if (!body.program || !body.batchYear || !body.semester) { toast('Choose a program, batch and semester.', { type: 'warning' }); return; }
      const ok = await confirmDialog({ title: 'Update semester?', message: `Every ${body.program}${body.branch !== 'All' ? ` ${body.branch}` : ''} student in batch ${body.batchYear} will be moved to ${body.semester}.`, confirmText: 'Update students', icon: 'trending' });
      if (!ok) return;
      try {
        const r = await api('/admin/users/promote', { method: 'POST', body });
        m.close();
        toast(`${r.data.updated} student${r.data.updated === 1 ? '' : 's'} moved to ${body.semester}.`, { type: 'success' });
        onDone();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
  };

  A.register('students', {
    title: 'Students & admins',
    async render(el) {
      let role = 'user';
      let page = 1;
      let search = '';
      let status = '';
      setHTML(el, html`
        <div class="view-head">
          <div><h2>People</h2><p>Every registered account. Suspend misuse, verify stuck sign-ups, or add more faculty administrators.</p></div>
          <div class="row wrap">
            <button class="btn btn-secondary" type="button" id="promoteBatch">${icon('trending', 'icon-sm')}New semester</button>
            <button class="btn btn-primary" type="button" id="addAdmin">${icon('user-plus', 'icon-sm')}Add administrator</button>
          </div>
        </div>
        <section class="card">
          <div class="toolbar">
            <div class="segmented" role="group" aria-label="Account type" id="pRole">
              <button type="button" data-r="user" aria-pressed="true">Students</button>
              <button type="button" data-r="admin" aria-pressed="false">Administrators</button>
            </div>
            <div class="input-wrap">${icon('search')}<input class="input" type="search" id="pSearch" placeholder="Search name or email" aria-label="Search people"></div>
            <select class="select" id="pStatus" aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="unverified">Unverified</option><option value="banned">Suspended</option></select>
          </div>
          <div class="table-wrap"><table class="table">
            <thead id="pHead"></thead>
            <tbody id="pRows"></tbody>
          </table></div>
          <div class="card-foot row-between" id="pPager"></div>
        </section>`);

      const statusBadge = (u) => (u.isBanned ? html`<span class="badge badge-critical">${icon('user-x', 'icon-sm')}Suspended</span>`
        : !u.isVerified ? html`<span class="badge badge-warning">${icon('mail', 'icon-sm')}Unverified</span>`
          : html`<span class="badge badge-good">${icon('check', 'icon-sm')}Active</span>`);

      const load = async () => {
        const qs = new URLSearchParams({ page, limit: 15, role });
        if (search) qs.set('search', search);
        if (status) qs.set('status', status);
        const r = await api(`/admin/users?${qs}`);
        if (!$('#pRows')) return; // navigated away while loading
        if (!r.data.length && r.total > 0 && page > r.pages) { page = r.pages; return load(); }
        const student = role === 'user';
        setHTML($('#pHead'), html`<tr><th>${student ? 'Student' : 'Administrator'}</th>${student ? html`<th>Cohort</th>` : ''}<th>Status</th>${student ? html`<th class="num">Attempts</th><th class="num">Avg. score</th>` : ''}<th class="num">Joined</th><th class="actions"><span class="sr-only">Actions</span></th></tr>`);
        setHTML($('#pRows'), r.data.length ? r.data.map((u) => html`
          <tr>
            <td><div class="cell-user"><span class="avatar avatar-sm">${initials(u.name)}</span><div><strong>${u.name}${u.isSelf ? ' (you)' : ''}</strong><span>${u.email}</span></div></div></td>
            ${student ? html`<td class="small">${u.profileComplete ? fmt.cohort(u) : html`<span class="subtle">Profile not set</span>`}</td>` : ''}
            <td>${statusBadge(u)}</td>
            ${student ? html`<td class="num">${u.attempts}${u.flagged ? html`<br><span class="xsmall text-critical">${u.flagged} flagged</span>` : ''}</td><td class="num">${u.avgPercentage === null ? '—' : fmt.pct(u.avgPercentage, 1)}</td>` : ''}
            <td class="num small">${fmt.date(u.createdAt)}</td>
            <td class="actions">${u.isSelf ? '' : A.actionMenu([
              student && { action: 'cohort', id: u._id, icon: 'book', label: 'Edit academic profile' },
              !u.isVerified && { action: 'verify', id: u._id, icon: 'user-check', label: 'Mark as verified' },
              { action: u.isBanned ? 'unban' : 'ban', id: u._id, icon: u.isBanned ? 'user-check' : 'user-x', label: u.isBanned ? 'Restore access' : 'Suspend account', danger: !u.isBanned },
              '-',
              { action: 'delete', id: u._id, icon: 'trash', label: 'Delete account', danger: true }
            ])}</td>
          </tr>`) : A.emptyRow(7, 'users', 'Nobody matches', search || status ? 'Try a different search or status.' : (student ? 'Students appear here once they register.' : '')));
        A.pager($('#pPager'), { page: r.page, pages: r.pages, total: r.total, label: student ? 'students' : 'administrators' }, (p) => { page = p; load(); });
        el._users = r.data;
      };
      await load();

      $('#pRole').addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        role = b.dataset.r;
        page = 1;
        $$('#pRole button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        load();
      });
      $('#pSearch').addEventListener('input', debounce((e) => { search = e.target.value.trim(); page = 1; load(); }, 250));
      $('#pStatus').addEventListener('change', (e) => { status = e.target.value; page = 1; load(); });
      $('#promoteBatch').addEventListener('click', () => openPromoteModal(load));
      $('#addAdmin').addEventListener('click', () => openAdminModal(() => { if (role === 'admin') load(); }));
      $('#pRows').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const u = (el._users || []).find((x) => x._id === b.dataset.id);
        if (!u) return;
        try {
          if (b.dataset.action === 'cohort') { openCohortModal(u, load); return; }
          if (b.dataset.action === 'verify') {
            await api(`/admin/users/${u._id}`, { method: 'PATCH', body: { isVerified: true } });
            toast(`${u.name} can now sign in.`, { type: 'success' });
          }
          if (b.dataset.action === 'ban') {
            if (!(await confirmDialog({ title: `Suspend ${u.name}?`, message: 'They are signed out immediately and cannot sign in or take quizzes until restored.', confirmText: 'Suspend', danger: true, icon: 'user-x' }))) return;
            await api(`/admin/users/${u._id}`, { method: 'PATCH', body: { isBanned: true } });
            toast(`${u.name} has been suspended.`, { type: 'success' });
          }
          if (b.dataset.action === 'unban') {
            await api(`/admin/users/${u._id}`, { method: 'PATCH', body: { isBanned: false } });
            toast(`${u.name}'s access has been restored.`, { type: 'success' });
          }
          if (b.dataset.action === 'delete') {
            if (!(await confirmDialog({ title: `Delete ${u.name}?`, message: 'The account and all of its quiz attempts are permanently deleted.', confirmText: 'Delete account', danger: true, icon: 'trash' }))) return;
            await api(`/admin/users/${u._id}`, { method: 'DELETE' });
            toast('Account deleted.', { type: 'success' });
          }
          load();
        } catch (err) { toast(err.message, { type: 'error' }); }
      });
    }
  });

  // =======================================================================================
  // Announcements
  // =======================================================================================
  const composeForm = (prefix) => html`
    <form class="stack" id="${prefix}Form" novalidate>
      <div class="field"><label class="label" for="${prefix}Title">Title</label><input class="input" id="${prefix}Title" maxlength="100" placeholder="e.g. Midterm moved to Friday"></div>
      <div class="field"><label class="label" for="${prefix}Msg">Message <span class="opt" id="${prefix}Count">0/1000</span></label><textarea class="textarea" id="${prefix}Msg" maxlength="1000" rows="4" placeholder="What do students need to know?"></textarea><span class="field-error"></span></div>
      <div class="field"><span class="label">Priority</span>
        <div class="segmented" role="group" id="${prefix}Priority">
          <button type="button" data-pr="info" aria-pressed="true">Info</button>
          <button type="button" data-pr="important" aria-pressed="false">Important</button>
          <button type="button" data-pr="urgent" aria-pressed="false">Urgent</button>
        </div></div>
      <div><div class="label mb-1">Audience</div>
        <div class="target-grid">
          <select class="select" id="${prefix}Program" aria-label="Program"></select>
          <select class="select" id="${prefix}Branch" aria-label="Branch"></select>
          <select class="select" id="${prefix}Batch" aria-label="Batch"></select>
          <select class="select" id="${prefix}Semester" aria-label="Semester"></select>
          <select class="select" id="${prefix}Section" aria-label="Section"></select>
        </div></div>
    </form>`;

  const wireCompose = async (prefix, onSent, submitBtn) => {
    let priority = 'info';
    $(`#${prefix}Priority`).addEventListener('click', (e) => {
      const b = e.target.closest('[data-pr]');
      if (!b) return;
      priority = b.dataset.pr;
      $$(`#${prefix}Priority button`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    const msg = $(`#${prefix}Msg`);
    msg.addEventListener('input', () => { $(`#${prefix}Count`).textContent = `${msg.value.length}/1000`; fieldErr(msg, ''); });
    const targeting = await bindTargeting({
      program: $(`#${prefix}Program`), branch: $(`#${prefix}Branch`), batchYear: $(`#${prefix}Batch`), semester: $(`#${prefix}Semester`), section: $(`#${prefix}Section`)
    }, {});
    submitBtn.addEventListener('click', async () => {
      const message = msg.value.trim();
      if (!message) { fieldErr(msg, 'Write a message first'); msg.focus(); return; }
      setLoading(submitBtn, true);
      try {
        const r = await api('/admin/announcements', { method: 'POST', body: { title: $(`#${prefix}Title`).value.trim(), message, priority, ...targeting.value() } });
        toast(`Delivered live to ${r.data.reachedOnline} online student${r.data.reachedOnline === 1 ? '' : 's'} · saved to everyone’s inbox.`, { type: 'success', title: 'Announcement sent' });
        $(`#${prefix}Form`).reset();
        $(`#${prefix}Count`).textContent = '0/1000';
        onSent();
      } catch (err) { toast(err.message, { type: 'error' }); }
      finally { setLoading(submitBtn, false); }
    });
  };

  A.openAnnouncementModal = async () => {
    const m = openModal({
      title: 'Broadcast an announcement',
      description: 'Pushed instantly to students who are online and kept in every targeted student’s notification inbox.',
      iconName: 'megaphone',
      size: 'lg',
      body: composeForm('am'),
      footer: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="amSend">${icon('send', 'icon-sm')}Send announcement</button>`
    });
    await wireCompose('am', () => m.close(), $('#amSend'));
  };

  A.register('announcements', {
    title: 'Announcements',
    async render(el) {
      setHTML(el, html`
        <div class="view-head"><div><h2>Announcements</h2><p>Reach a whole program, a batch or a single section in real time.</p></div></div>
        <div class="ann-grid">
          <section class="card">
            <div class="card-head"><h2>${icon('megaphone')}New announcement</h2></div>
            <div class="card-body">${composeForm('an')}<button class="btn btn-primary mt-2" type="button" id="anSend">${icon('send', 'icon-sm')}Send announcement</button></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('inbox')}Sent</h2></div>
            <div id="annList"></div>
          </section>
        </div>`);
      const PR = { info: ['badge-info', 'Info'], important: ['badge-warning', 'Important'], urgent: ['badge-critical', 'Urgent'] };
      const load = async () => {
        const r = await api('/admin/announcements');
        if (!$('#annList')) return;
        setHTML($('#annList'), r.data.length ? r.data.map((a) => html`
          <div class="ann-item">
            <div class="grow">
              <div class="row wrap" style="gap:.5rem"><strong>${a.title}</strong><span class="badge ${PR[a.priority][0]}">${PR[a.priority][1]}</span></div>
              <p>${a.message}</p>
              <small>${targetLabel(a)} · ${a.createdBy ? a.createdBy.name : 'Administrator'} · ${fmt.dateTime(a.createdAt)}</small>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" data-del="${a._id}" aria-label="Delete announcement">${icon('trash', 'icon-sm')}</button>
          </div>`) : html`<div class="empty"><div class="empty-icon">${icon('megaphone')}</div><h3>No announcements yet</h3><p>Messages you send will be listed here.</p></div>`);
      };
      await load();
      await wireCompose('an', load, $('#anSend'));
      $('#annList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        if (!(await confirmDialog({ title: 'Delete this announcement?', message: 'It disappears from every student’s notification inbox.', confirmText: 'Delete', danger: true, icon: 'trash' }))) return;
        try { await api(`/admin/announcements/${b.dataset.del}`, { method: 'DELETE' }); toast('Announcement deleted.', { type: 'success' }); load(); }
        catch (err) { toast(err.message, { type: 'error' }); }
      });
    }
  });

  // =======================================================================================
  // Settings
  // =======================================================================================
  A.register('settings', {
    title: 'Settings',
    async render(el) {
      const user = A.state.user;
      const ctx = A.context();
      let health = null;
      try { health = await (await fetch(`${QM.API_ORIGIN}/api/health`)).json(); } catch (e) { health = null; }
      setHTML(el, html`
        <div class="view-head"><div><h2>Settings</h2><p>Your account, session defaults and system status.</p></div></div>
        <div class="settings-grid">
          <section class="card">
            <div class="card-head"><h2>${icon('user')}Your profile</h2></div>
            <div class="card-body">
              <form class="stack" id="meForm" novalidate>
                <div class="field"><label class="label" for="meName">Display name</label><input class="input" id="meName" maxlength="80" value="${user.name}"><span class="field-error"></span></div>
                <div class="field"><label class="label" for="meEmail">Email</label><input class="input" id="meEmail" value="${user.email}" readonly></div>
                <button class="btn btn-secondary" type="submit" id="meSave">Save profile</button>
              </form>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('lock')}Change password</h2></div>
            <div class="card-body">
              <form class="stack" id="pwForm" novalidate>
                <div class="field"><label class="label" for="pwCur">Current password</label><input class="input" type="password" id="pwCur" autocomplete="current-password"><span class="field-error"></span></div>
                <div class="field"><label class="label" for="pwNew">New password</label><input class="input" type="password" id="pwNew" autocomplete="new-password" placeholder="8+ characters, a letter and a number"><span class="field-error"></span></div>
                <button class="btn btn-secondary" type="submit" id="pwSave">Update password</button>
                <p class="hint">Other sessions are signed out after a password change.</p>
              </form>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('target')}Session context</h2></div>
            <div class="card-body stack">
              <p class="muted small">Your current teaching context pre-fills targeting, start time and duration when you create quizzes, forms and announcements in this browser session.</p>
              ${ctx ? html`<dl class="kv"><dt>Audience</dt><dd>${targetLabel(ctx)}</dd><dt>Subject</dt><dd>${ctx.subjectName || '—'}</dd><dt>Default start</dt><dd>${ctx.defaultStart ? fmt.dateTime(ctx.defaultStart) : '—'}</dd><dt>Default duration</dt><dd>${ctx.defaultDuration ? `${ctx.defaultDuration} min` : '—'}</dd></dl>` : html`<div class="callout">${icon('info')}<div>No context set for this session.</div></div>`}
              <div class="row wrap"><a class="btn btn-secondary" href="admin-wizard.html">${icon('edit', 'icon-sm')}${ctx ? 'Change context' : 'Set up context'}</a>${ctx ? html`<button class="btn btn-ghost" type="button" id="ctxClear">Clear</button>` : ''}</div>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('activity')}System status</h2></div>
            <div class="card-body">
              <dl class="kv">
                <dt>API</dt><dd>${health && health.success ? html`<span class="badge badge-good">${icon('check', 'icon-sm')}Online</span>` : html`<span class="badge badge-critical">Unreachable</span>`}</dd>
                <dt>Database</dt><dd>${health && health.database === 'connected' ? html`<span class="badge badge-good">${icon('check', 'icon-sm')}Connected</span>` : html`<span class="badge badge-critical">Disconnected</span>`}</dd>
                <dt>Real-time</dt><dd>${A.state.socket && A.state.socket.connected ? html`<span class="badge badge-good">${icon('check', 'icon-sm')}Connected</span>` : html`<span class="badge badge-warning">Reconnecting</span>`}</dd>
                <dt>Server time</dt><dd>${health ? fmt.dateTime(health.timestamp) : '—'}</dd>
                <dt>API endpoint</dt><dd class="small">${QM.API_BASE}</dd>
              </dl>
            </div>
          </section>
        </div>`);

      $('#meForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('#meName').value.trim();
        if (!name) { fieldErr($('#meName'), 'Name cannot be empty'); return; }
        const btn = $('#meSave');
        setLoading(btn, true);
        try {
          const r = await api('/auth/me', { method: 'PUT', body: { name } });
          session.setUser(r.data);
          A.state.user = r.data;
          $('#sideName').textContent = r.data.name;
          $('#sideAvatar').textContent = initials(r.data.name);
          toast('Profile saved.', { type: 'success' });
        } catch (err) { toast(err.message, { type: 'error' }); }
        finally { setLoading(btn, false); }
      });
      $('#pwForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const cur = $('#pwCur');
        const nw = $('#pwNew');
        fieldErr(cur, cur.value ? '' : 'Enter your current password');
        fieldErr(nw, validPassword(nw.value) ? '' : 'Use 8+ characters with a letter and a number');
        if (!cur.value || !validPassword(nw.value)) return;
        const btn = $('#pwSave');
        setLoading(btn, true);
        try {
          const r = await api('/auth/update-password', { method: 'PUT', body: { currentPassword: cur.value, newPassword: nw.value }, on401: 'none' });
          session.set(r.token, r.user);
          $('#pwForm').reset();
          toast('Password updated.', { type: 'success' });
        } catch (err) {
          if (err.status === 401) fieldErr(cur, err.message); else toast(err.message, { type: 'error' });
        } finally { setLoading(btn, false); }
      });
      const clear = $('#ctxClear');
      if (clear) clear.addEventListener('click', () => { sessionStorage.removeItem('quizmuj_admin_context'); location.reload(); });
    }
  });
})();
