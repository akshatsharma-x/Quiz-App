/* Sign-in page: password, passwordless code, email verification and password reset */
(() => {
  const { api, session, homeFor, safeNext, consumeFlash, html, setHTML, icon, setLoading, otpInput, passwordStrength, validPassword, $, $$ } = QM;

  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));

  // Role-aware redirect target (never send a student to an admin page or vice versa)
  const destinationFor = (user) => {
    if (next) {
      const adminPage = /^(admin|create-quiz)/.test(next);
      if ((user.role === 'admin') === adminPage && (user.role === 'admin' || user.profileComplete)) return next;
    }
    // Admins pick their teaching context once per session (the wizard can be skipped)
    if (user.role === 'admin' && !sessionStorage.getItem('quizmuj_admin_context') && !sessionStorage.getItem('quizmuj_admin_context_skipped')) {
      return 'admin-wizard.html';
    }
    return homeFor(user);
  };

  // Already signed in? Skip the form.
  if (session.isValid() && session.user) {
    location.replace(destinationFor(session.user));
    return;
  }

  let role = 'user';
  let domain = 'muj.manipal.edu';
  let mode = null;          // 'login' | 'verify' | 'reset' (for the code step)
  let codeEmail = '';
  let resendTimer = null;

  const els = {
    title: $('#title'), subtitle: $('#subtitle'), flash: $('#flash'),
    passwordForm: $('#passwordForm'), requestForm: $('#requestForm'), verifyForm: $('#verifyForm'),
    email: $('#email'), password: $('#password'), requestEmail: $('#requestEmail'),
    newPassword: $('#newPassword'), resetFields: $('#resetFields'),
    resendBtn: $('#resendBtn'), resendHint: $('#resendHint'), verifyBtn: $('#verifyBtn'),
    roleSwitch: $('#roleSwitch'), registerFoot: $('#registerFoot')
  };

  const showFlash = (message, type = 'info') => {
    const tone = { error: 'critical', warning: 'warning', success: 'good', info: '' }[type] ?? '';
    const ic = { error: 'x-circle', warning: 'alert', success: 'check-circle' }[type] || 'info';
    setHTML(els.flash, message ? html`<div class="callout ${tone} mb-2" role="alert">${icon(ic)}<div>${message}</div></div>` : '');
  };
  const f = consumeFlash();
  if (f) showFlash(f.message, f.type);

  QM.config().then((c) => {
    domain = c.studentEmailDomain || domain;
    applyRole();
    if (c.showcase) renderDemoBox(c.showcase);
  }).catch(() => {});

  // ---- Public demo (SHOWCASE_MODE): one-click sign-in with the shared demo accounts --------
  const demoSignIn = (who, acc) => {
    role = who === 'faculty' ? 'admin' : 'user';
    applyRole();
    showStep(els.passwordForm);
    els.email.value = acc.email;
    els.password.value = acc.password;
    els.passwordForm.requestSubmit();
  };
  const renderDemoBox = (accounts) => {
    const box = $('#demoBox');
    setHTML(box, html`
      <div class="demo-box">
        <div class="demo-copy"><strong>Try the live demo</strong><span>No sign-up needed — explore QuizMUJ as a student or as faculty.</span></div>
        <div class="demo-actions">
          <button type="button" class="btn btn-primary" data-demo="student">${icon('user', 'icon-sm')}Student demo</button>
          <button type="button" class="btn btn-secondary" data-demo="faculty">${icon('monitor', 'icon-sm')}Faculty demo</button>
        </div>
      </div>`);
    box.hidden = false;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-demo]');
      if (b) demoSignIn(b.dataset.demo, accounts[b.dataset.demo]);
    });
    const wanted = params.get('demo');
    if (wanted === 'student' || wanted === 'faculty') demoSignIn(wanted, accounts[wanted]);
  };

  // ---- Field errors ---------------------------------------------------------------------
  const fieldError = (input, message) => {
    const field = input.closest('.field');
    field.classList.toggle('has-error', Boolean(message));
    const err = field.querySelector('.field-error');
    if (err) err.textContent = message || '';
  };
  $$('.input').forEach((i) => i.addEventListener('input', () => fieldError(i, '')));

  const { validEmail } = QM;
  const checkEmail = (input) => {
    const v = input.value.trim().toLowerCase();
    if (!v) { fieldError(input, 'Please enter your email address'); return null; }
    if (!validEmail(v)) { fieldError(input, 'That doesn’t look like a valid email'); return null; }
    if (role === 'user' && !v.endsWith(`@${domain}`)) { fieldError(input, `Use your @${domain} address`); return null; }
    return v;
  };

  // ---- Role switch ------------------------------------------------------------------------
  const applyRole = () => {
    $$('button', els.roleSwitch).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === role)));
    $('#emailLabel').textContent = role === 'admin' ? 'Admin email' : 'University email';
    els.email.placeholder = role === 'admin' ? 'admin@quizmuj.com' : `name.rollno@${domain}`;
    els.requestEmail.placeholder = els.email.placeholder;
    els.registerFoot.hidden = role === 'admin';
    if (!mode) {
      els.title.textContent = role === 'admin' ? 'Faculty console' : 'Welcome back';
      els.subtitle.textContent = role === 'admin' ? 'Sign in to manage quizzes, students and results.' : 'Sign in to continue to QuizMUJ.';
    }
    fieldError(els.email, '');
  };
  els.roleSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-role]');
    if (!b) return;
    role = b.dataset.role;
    applyRole();
  });
  applyRole();

  // ---- Show / hide password -----------------------------------------------------------------
  $$('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      setHTML(btn, icon(show ? 'eye-off' : 'eye'));
    });
  });

  // ---- Step switching -------------------------------------------------------------------------
  const showStep = (step) => {
    [els.passwordForm, els.requestForm, els.verifyForm].forEach((form) => { form.hidden = form !== step; });
    els.roleSwitch.hidden = step === els.verifyForm;
  };
  const backToPassword = () => {
    mode = null;
    clearInterval(resendTimer);
    showStep(els.passwordForm);
    applyRole();
    els.email.focus();
  };
  $$('[data-back]').forEach((b) => b.addEventListener('click', backToPassword));

  const otp = otpInput($('#otpBoxes'), {
    onComplete: () => { if (mode !== 'reset') els.verifyForm.requestSubmit(); }
  });

  const startResendCountdown = (seconds) => {
    clearInterval(resendTimer);
    let left = Math.max(0, Math.round(seconds || 0));
    const tick = () => {
      els.resendBtn.disabled = left > 0;
      els.resendBtn.textContent = left > 0 ? `Resend in ${left}s` : 'Resend code';
      left--;
      if (left < -1) clearInterval(resendTimer);
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  };

  const openCodeStep = (purpose, email, resendIn) => {
    mode = purpose;
    codeEmail = email;
    $('#codeEmail').textContent = email;
    els.resetFields.hidden = purpose !== 'reset';
    els.verifyBtn.textContent = { login: 'Verify & sign in', verify: 'Verify email & continue', reset: 'Reset password & sign in' }[purpose];
    els.title.textContent = { login: 'Check your inbox', verify: 'Verify your email', reset: 'Choose a new password' }[purpose];
    els.subtitle.textContent = purpose === 'verify'
      ? 'Your account isn’t verified yet. Enter the code we emailed you.'
      : 'We emailed you a one-time code. It expires in 10 minutes.';
    showStep(els.verifyForm);
    otp.clear();
    startResendCountdown(resendIn ?? 45);
  };

  const finishLogin = (data) => {
    session.set(data.token, data.user);
    setLoading(els.verifyBtn, true);
    location.href = destinationFor(data.user);
  };

  // ---- Password sign-in -------------------------------------------------------------------------
  els.passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showFlash('');
    const email = checkEmail(els.email);
    const password = els.password.value;
    if (!password) fieldError(els.password, 'Please enter your password');
    if (!email || !password) return;

    const btn = $('#passwordBtn');
    setLoading(btn, true);
    try {
      const data = await api('/auth/login', { method: 'POST', auth: false, body: { email, password } });
      session.set(data.token, data.user);
      location.href = destinationFor(data.user);
    } catch (err) {
      setLoading(btn, false);
      if (err.data && err.data.needsVerification) {
        openCodeStep('verify', err.data.email || email, err.data.resendIn);
        showFlash(err.message, 'warning');
        return;
      }
      if (err.status === 401) {
        fieldError(els.password, err.message);
        els.password.select();
      } else {
        showFlash(err.message, 'error');
      }
    }
  });

  // ---- Request code (passwordless or reset) -------------------------------------------------------
  let requestPurpose = 'login';
  const openRequest = (purpose) => {
    requestPurpose = purpose;
    mode = null;
    els.requestEmail.value = els.email.value;
    els.title.textContent = purpose === 'reset' ? 'Reset your password' : 'Sign in with a code';
    els.subtitle.textContent = purpose === 'reset'
      ? 'We’ll email you a code to set a new password.'
      : 'No password needed — we’ll email you a one-time code.';
    $('#requestBtn').textContent = purpose === 'reset' ? 'Send reset code' : 'Email me a code';
    showStep(els.requestForm);
    els.requestEmail.focus();
  };
  $('#otpModeBtn').addEventListener('click', () => openRequest('login'));
  $('#forgotLink').addEventListener('click', () => openRequest('reset'));

  const requestCode = async (purpose, email) => {
    const path = purpose === 'reset' ? '/auth/forgot-password' : purpose === 'verify' ? '/auth/resend-otp' : '/auth/request-login-otp';
    return api(path, { method: 'POST', auth: false, body: { email } });
  };

  els.requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showFlash('');
    const email = checkEmail(els.requestEmail);
    if (!email) return;
    const btn = $('#requestBtn');
    setLoading(btn, true);
    try {
      const r = await requestCode(requestPurpose, email);
      openCodeStep(requestPurpose, email, r.data.resendIn);
    } catch (err) {
      if (err.status === 429 && err.data.details && err.data.details.resendIn) {
        openCodeStep(requestPurpose, email, err.data.details.resendIn); // a code is already on its way
      } else {
        fieldError(els.requestEmail, err.message);
      }
    } finally {
      setLoading(btn, false);
    }
  });

  els.resendBtn.addEventListener('click', async () => {
    els.resendBtn.disabled = true;
    try {
      const r = await requestCode(mode, codeEmail);
      startResendCountdown(r.data.resendIn);
      QM.toast('A new code is on its way.', { type: 'success' });
      otp.clear();
    } catch (err) {
      startResendCountdown((err.data.details && err.data.details.resendIn) || 10);
      QM.toast(err.message, { type: 'error' });
    }
  });

  els.newPassword.addEventListener('input', () => {
    $('#pwMeter').dataset.score = passwordStrength(els.newPassword.value).score;
  });

  // ---- Verify code ---------------------------------------------------------------------------------
  let verifying = false;
  els.verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (verifying) return; // auto-submit from the OTP boxes may race a click
    const code = otp.value();
    if (code.length !== 6) { otp.setError(true); otp.focus(); return; }
    if (mode === 'reset' && !validPassword(els.newPassword.value)) {
      fieldError(els.newPassword, 'Use at least 8 characters with a letter and a number');
      els.newPassword.focus();
      return;
    }
    setLoading(els.verifyBtn, true);
    verifying = true;
    try {
      const path = { login: '/auth/verify-login-otp', verify: '/auth/verify-otp', reset: '/auth/reset-password' }[mode];
      const body = { email: codeEmail, otp: code };
      if (mode === 'reset') body.password = els.newPassword.value;
      const data = await api(path, { method: 'POST', auth: false, body });
      if (mode === 'reset') QM.flash('Your password has been updated.', 'success');
      finishLogin(data);
    } catch (err) {
      verifying = false;
      setLoading(els.verifyBtn, false);
      showFlash(err.message, 'error');
      if (/request a new/i.test(err.message)) startResendCountdown(0);
      if (mode === 'reset' && /password/i.test(err.message)) { fieldError(els.newPassword, err.message); return; }
      otp.clear(); // never resubmit the same wrong code
      otp.setError(true);
    }
  });
})();
