/* Academic profile: first-time setup (unskippable) and later editing + password change */
(async () => {
  const { requireAuth, api, session, html, setHTML, icon, setLoading, academics, fillSelect, fmt, toast, initials, validPassword, $, $$ } = QM;

  const user = await requireAuth({ role: 'user', allowIncompleteProfile: true });
  const firstTime = !user.profileComplete;
  const main = $('#main');

  let catalog;
  try {
    catalog = await academics();
  } catch (err) {
    setHTML(main, html`<div class="empty"><div class="empty-icon">${icon('wifi-off')}</div><h3>Can't load the academic catalogue</h3><p>${err.message}</p><button class="btn btn-primary" onclick="location.reload()">Retry</button></div>`);
    return;
  }

  const fieldError = (el, message) => {
    const field = el.closest('.field');
    field.classList.toggle('has-error', Boolean(message));
    const e = field.querySelector('.field-error');
    if (e) e.textContent = message || '';
  };

  // ---- Profile form ------------------------------------------------------------------------
  const mountProfileForm = (form, { onSaved }) => {
    form.innerHTML = $('#profileFormTpl').innerHTML;
    const f = {
      name: $('#pfName', form), program: $('#pfProgram', form), branch: $('#pfBranch', form),
      batch: $('#pfBatch', form), semester: $('#pfSemester', form), section: $('#pfSection', form),
      preview: $('[data-preview]', form), save: $('[data-save]', form)
    };
    f.name.value = user.name || '';
    if (!firstTime) f.save.textContent = 'Save changes';
    let section = user.section || '';

    const withCurrent = (list, current) => (current && !list.includes(current) ? [current, ...list] : list);
    fillSelect(f.program, Object.keys(catalog.programs), { placeholder: 'Select program', selected: user.program });

    const renderSections = () => {
      setHTML(f.section, catalog.sections.map((s) => html`<button type="button" role="radio" aria-checked="${s === section}" data-sec="${s}" ${f.program.value ? '' : 'disabled'}>${s}</button>`));
    };
    f.section.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sec]');
      if (!b || b.disabled) return;
      section = b.dataset.sec;
      renderSections();
      fieldError(f.section, '');
      updatePreview();
      f.section.querySelector(`[data-sec="${section}"]`).focus();
    });
    f.section.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const i = catalog.sections.indexOf(section);
      const ni = (i + (e.key === 'ArrowRight' ? 1 : -1) + catalog.sections.length) % catalog.sections.length;
      section = catalog.sections[ni];
      renderSections();
      updatePreview();
      f.section.querySelector(`[data-sec="${section}"]`).focus();
      e.preventDefault();
    });

    const refresh = (initial) => {
      const p = catalog.programs[f.program.value];
      if (!p) {
        [f.branch, f.batch, f.semester].forEach((s) => { s.disabled = true; fillSelect(s, [], { placeholder: 'Select program first' }); });
        renderSections();
        return;
      }
      const keep = (select, list, saved) => (initial ? saved : (list.includes(select.value) ? select.value : null));
      fillSelect(f.branch, withCurrent(p.branches, initial ? user.branch : null), { placeholder: 'Select branch', selected: keep(f.branch, p.branches, user.branch) });
      fillSelect(f.batch, withCurrent(p.batchYears, initial ? user.batchYear : null), { placeholder: 'Select batch', selected: keep(f.batch, p.batchYears, user.batchYear) });
      fillSelect(f.semester, p.semesters, { placeholder: 'Select semester', selected: keep(f.semester, p.semesters, user.semester) });
      [f.branch, f.batch, f.semester].forEach((s) => { s.disabled = false; });
      renderSections();
    };

    const updatePreview = () => {
      const parts = [f.program.value, f.branch.value, f.batch.value, f.semester.value, section && `Section ${section}`].filter(Boolean);
      f.preview.textContent = parts.length === 5 ? parts.join(' · ') : 'Complete the fields above';
    };

    f.program.addEventListener('change', () => { refresh(false); fieldError(f.program, ''); updatePreview(); });
    [f.branch, f.batch, f.semester].forEach((s) => s.addEventListener('change', () => { fieldError(s, ''); updatePreview(); }));
    f.name.addEventListener('input', () => fieldError(f.name, ''));
    refresh(true);
    updatePreview();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: f.name.value.trim(),
        program: f.program.value,
        branch: f.branch.value,
        batchYear: f.batch.value,
        semester: f.semester.value,
        section
      };
      let ok = true;
      if (!payload.name) { fieldError(f.name, 'Please enter your name'); ok = false; }
      [['program', f.program, 'program'], ['branch', f.branch, 'branch'], ['batchYear', f.batch, 'batch'], ['semester', f.semester, 'semester']]
        .forEach(([k, el, label]) => { if (!payload[k]) { fieldError(el, `Please select your ${label}`); ok = false; } });
      if (!section) { fieldError(f.section, 'Please pick your section'); ok = false; }
      if (!ok) return;

      setLoading(f.save, true);
      try {
        const r = await api('/student/profile', { method: 'PUT', body: payload });
        session.setUser(r.data);
        onSaved(r.data);
      } catch (err) {
        toast(err.message, { type: 'error', title: 'Could not save profile' });
      } finally {
        setLoading(f.save, false);
      }
    });
  };

  // ---- First-time setup ---------------------------------------------------------------------
  if (firstTime) {
    document.body.classList.add('setup-mode');
    main.classList.remove('page');
    main.innerHTML = $('#setupTpl').innerHTML;
    $('[data-greet]').textContent = `Welcome, ${user.name.split(' ')[0]}!`;
    $('[data-email]').textContent = user.email;
    $('[data-logout]').addEventListener('click', QM.logout);
    mountProfileForm($('[data-profile-form]'), {
      onSaved: () => {
        QM.flash('Profile saved — here are the quizzes for your cohort.', 'success');
        location.href = 'student-dashboard.html';
      }
    });
    return;
  }

  // ---- Edit mode ------------------------------------------------------------------------------
  await QMShell.mount({ active: 'profile', user });
  document.title = 'My profile | QuizMUJ';
  setHTML(main, html`
    <div class="page-head">
      <div class="identity reveal">
        <span class="avatar avatar-lg" data-avatar>${initials(user.name)}</span>
        <div>
          <h1 data-name>${user.name}</h1>
          <p>${user.email} <span class="badge badge-good" style="margin-left:.35rem">${icon('check', 'icon-sm')}Verified</span></p>
        </div>
      </div>
    </div>
    <div class="profile-grid">
      <div class="stack">
        <section class="card reveal" style="--d:.05s">
          <div class="card-head"><h2>${icon('book')}Academic profile</h2><span class="badge badge-good">${icon('lock', 'icon-sm')}Locked</span></div>
          <div class="card-body stack">
            <dl class="kv">
              <dt>Program</dt><dd>${user.program}</dd>
              <dt>Branch</dt><dd>${user.branch}</dd>
              <dt>Batch</dt><dd>${user.batchYear}</dd>
              <dt>Semester</dt><dd>${user.semester}</dd>
              <dt>Section</dt><dd>${user.section}</dd>
            </dl>
            <div class="callout">${icon('info')}<div>Your cohort decides which quizzes you can take, so only a faculty administrator can change it. If anything here is wrong — or you’ve moved to a new section — ask your faculty to update it.</div></div>
          </div>
        </section>
        <section class="card reveal" style="--d:.08s">
          <div class="card-head"><h2>${icon('user')}Display name</h2></div>
          <div class="card-body">
            <form id="nameForm" class="stack" novalidate>
              <div class="field"><label class="label" for="pfNameEdit">Full name</label><input class="input" id="pfNameEdit" maxlength="80" autocomplete="name" value="${user.name}"><span class="field-error"></span></div>
              <button class="btn btn-secondary" type="submit" id="nameSave">Save name</button>
            </form>
          </div>
        </section>
      </div>
      <div class="stack">
        <section class="card reveal" style="--d:.1s">
          <div class="card-head"><h2>${icon('lock')}Change password</h2></div>
          <div class="card-body">
            <form id="pwForm" class="stack" novalidate>
              <div class="field"><label class="label" for="pwCurrent">Current password</label><input class="input" type="password" id="pwCurrent" autocomplete="current-password"><span class="field-error"></span></div>
              <div class="field"><label class="label" for="pwNew">New password</label><input class="input" type="password" id="pwNew" autocomplete="new-password" placeholder="8+ characters, a letter and a number"><span class="field-error"></span></div>
              <div class="field"><label class="label" for="pwConfirm">Confirm new password</label><input class="input" type="password" id="pwConfirm" autocomplete="new-password"><span class="field-error"></span></div>
              <button class="btn btn-secondary" type="submit" id="pwSave">Update password</button>
              <p class="hint">Updating your password signs you out on every other device.</p>
            </form>
          </div>
        </section>
        <section class="card reveal" style="--d:.15s">
          <div class="card-head"><h2>${icon('user')}Account</h2></div>
          <div class="card-body">
            <dl class="kv">
              <dt>Member since</dt><dd>${fmt.date(user.createdAt)}</dd>
              <dt>Last sign-in</dt><dd>${user.lastLoginAt ? fmt.dateTime(user.lastLoginAt) : '—'}</dd>
              <dt>Role</dt><dd>Student</dd>
            </dl>
            <button class="btn btn-danger-soft btn-block mt-2" type="button" id="logoutBtn">${icon('logout')}Sign out</button>
          </div>
        </section>
      </div>
    </div>`);

  $('#nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#pfNameEdit');
    const name = input.value.trim();
    if (!name) { fieldError(input, 'Please enter your name'); return; }
    const btn = $('#nameSave');
    setLoading(btn, true);
    try {
      const r = await api('/student/profile', { method: 'PUT', body: { name } });
      session.setUser(r.data);
      $('[data-name]').textContent = r.data.name;
      $('[data-avatar]').textContent = initials(r.data.name);
      toast('Your name has been updated.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setLoading(btn, false);
    }
  });
  $('#pfNameEdit').addEventListener('input', (e) => fieldError(e.target, ''));
  $('#logoutBtn').addEventListener('click', QM.logout);

  const pw = { current: $('#pwCurrent'), next: $('#pwNew'), confirm: $('#pwConfirm') };
  Object.values(pw).forEach((i) => i.addEventListener('input', () => fieldError(i, '')));
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let ok = true;
    if (!pw.current.value) { fieldError(pw.current, 'Enter your current password'); ok = false; }
    if (!validPassword(pw.next.value)) { fieldError(pw.next, 'Use at least 8 characters with a letter and a number'); ok = false; }
    if (pw.confirm.value !== pw.next.value) { fieldError(pw.confirm, 'Passwords don’t match'); ok = false; }
    if (!ok) return;
    const btn = $('#pwSave');
    setLoading(btn, true);
    try {
      const r = await api('/auth/update-password', { method: 'PUT', body: { currentPassword: pw.current.value, newPassword: pw.next.value }, on401: 'none' });
      session.set(r.token, r.user);
      $('#pwForm').reset();
      toast('Password updated. Other devices have been signed out.', { type: 'success' });
    } catch (err) {
      if (err.status === 401) fieldError(pw.current, err.message);
      else toast(err.message, { type: 'error' });
    } finally {
      setLoading(btn, false);
    }
  });
})();
