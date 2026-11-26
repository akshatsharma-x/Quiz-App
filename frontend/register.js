/* Student registration with email verification */
(() => {
  const { api, session, homeFor, html, setHTML, icon, setLoading, otpInput, passwordStrength, validPassword, $, $$ } = QM;

  if (session.isValid() && session.user) {
    location.replace(homeFor(session.user));
    return;
  }

  let domain = 'muj.manipal.edu';
  let email = '';
  let resendTimer = null;
  api('/meta/config', { auth: false }).then((r) => { domain = r.data.studentEmailDomain || domain; $('#email').placeholder = `name.rollno@${domain}`; }).catch(() => {});

  const form = $('#registerForm');
  const verifyForm = $('#verifyForm');
  const inputs = { name: $('#name'), email: $('#email'), password: $('#password'), confirm: $('#confirm') };

  const showFlash = (message, type = 'error', extra) => {
    const tone = { error: 'critical', warning: 'warning', success: 'good', info: '' }[type] ?? '';
    setHTML($('#flash'), message
      ? html`<div class="callout ${tone} mb-2" role="alert">${icon(type === 'error' ? 'x-circle' : 'info')}<div>${message}${extra || ''}</div></div>`
      : '');
  };
  const fieldError = (input, message) => {
    const field = input.closest('.field');
    field.classList.toggle('has-error', Boolean(message));
    field.querySelector('.field-error').textContent = message || '';
  };
  Object.values(inputs).forEach((i) => i.addEventListener('input', () => fieldError(i, '')));

  $$('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      inputs.confirm.type = input.type;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      setHTML(btn, icon(show ? 'eye-off' : 'eye'));
    });
  });

  inputs.password.addEventListener('input', () => {
    const pw = inputs.password.value;
    $('#pwMeter').dataset.score = passwordStrength(pw).score;
    const rules = { len: pw.length >= 8, letter: /[A-Za-z]/.test(pw), digit: /\d/.test(pw) };
    $$('#pwRules [data-rule]').forEach((el) => el.classList.toggle('ok', rules[el.dataset.rule]));
  });

  const validate = () => {
    let ok = true;
    const name = inputs.name.value.trim();
    const mail = inputs.email.value.trim().toLowerCase();
    if (!name) { fieldError(inputs.name, 'Please enter your full name'); ok = false; }
    if (!QM.validEmail(mail)) { fieldError(inputs.email, 'Please enter a valid email'); ok = false; }
    else if (!mail.endsWith(`@${domain}`)) { fieldError(inputs.email, `Registration is limited to @${domain} addresses`); ok = false; }
    if (!validPassword(inputs.password.value)) { fieldError(inputs.password, 'Use at least 8 characters with a letter and a number'); ok = false; }
    if (inputs.confirm.value !== inputs.password.value) { fieldError(inputs.confirm, 'Passwords don’t match'); ok = false; }
    return ok ? { name, email: mail, password: inputs.password.value } : null;
  };

  const otp = otpInput($('#otpBoxes'), { onComplete: () => verifyForm.requestSubmit() });

  const startResendCountdown = (seconds) => {
    clearInterval(resendTimer);
    let left = Math.max(0, Math.round(seconds || 0));
    const btn = $('#resendBtn');
    const tick = () => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Resend in ${left}s` : 'Resend code';
      if (left-- <= 0) clearInterval(resendTimer);
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  };

  const showVerify = (resendIn) => {
    $('#codeEmail').textContent = email;
    $('#title').textContent = 'Verify your email';
    $('#subtitle').textContent = 'One last step — confirm it’s really you.';
    form.hidden = true;
    verifyForm.hidden = false;
    showFlash('');
    otp.clear();
    startResendCountdown(resendIn);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showFlash('');
    const payload = validate();
    if (!payload) return;
    const btn = $('#registerBtn');
    setLoading(btn, true);
    try {
      const r = await api('/auth/register', { method: 'POST', auth: false, body: payload });
      email = payload.email;
      showVerify(r.data.resendIn);
    } catch (err) {
      if (err.status === 409) {
        showFlash(err.message, 'error', html` <a href="login.html">Sign in →</a>`);
      } else if (err.status === 400 && /password/i.test(err.message)) {
        fieldError(inputs.password, err.message);
      } else if (err.status === 400 && /email|registration/i.test(err.message)) {
        fieldError(inputs.email, err.message);
      } else {
        showFlash(err.message);
      }
    } finally {
      setLoading(btn, false);
    }
  });

  let verifying = false;
  verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (verifying) return; // auto-submit from the OTP boxes may race a click
    const code = otp.value();
    if (code.length !== 6) { otp.setError(true); otp.focus(); return; }
    const btn = $('#verifyBtn');
    setLoading(btn, true);
    verifying = true;
    try {
      const data = await api('/auth/verify-otp', { method: 'POST', auth: false, body: { email, otp: code } });
      session.set(data.token, data.user);
      QM.flash('Email verified — welcome to QuizMUJ!', 'success');
      location.href = homeFor(data.user);
    } catch (err) {
      verifying = false;
      setLoading(btn, false);
      showFlash(err.message);
      otp.clear(); // never resubmit the same wrong code
      otp.setError(true);
    }
  });

  $('#resendBtn').addEventListener('click', async () => {
    $('#resendBtn').disabled = true;
    try {
      const r = await api('/auth/resend-otp', { method: 'POST', auth: false, body: { email } });
      QM.toast('A new code is on its way.', { type: 'success' });
      startResendCountdown(r.data.resendIn);
      otp.clear();
    } catch (err) {
      startResendCountdown((err.data.details && err.data.details.resendIn) || 10);
      QM.toast(err.message, { type: 'error' });
    }
  });

  $('#changeEmailBtn').addEventListener('click', () => {
    clearInterval(resendTimer);
    verifyForm.hidden = true;
    form.hidden = false;
    $('#title').textContent = 'Create your account';
    $('#subtitle').textContent = 'It takes less than a minute.';
    inputs.email.focus();
  });
})();
