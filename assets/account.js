/* Account forms fail closed on static hosting. Credentials never enter browser storage. */
(() => {
  'use strict';
  const forms = [...document.querySelectorAll('[data-account-form]')];
  const notice = document.querySelector('#application-status, #sign-in-status');
  let csrfToken = null;
  let enabled = false;
  let changed = false;
  let checking;
  const pending = new Set();
  const sessionChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('shadowbridge-session') : null;
  const changedMessage = 'The account in this browser changed or signed out. Reload this page before continuing. For simultaneous accounts, use separate browser profiles or a private window.';
  function report(title, detail, error = false) {
    if (!notice) return;
    notice.replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = title;
    const p = document.createElement('p'); p.textContent = detail;
    notice.append(strong, p); notice.classList.toggle('entry-notice-error', error);
    notice.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
  function unlock(form, value) {
    form.querySelector('fieldset').disabled = !value;
    form.querySelector('button[type="submit"]').disabled = !value;
  }
  function sessionChanged() {
    if (changed) return;
    changed = true; enabled = false; csrfToken = null;
    for (const controller of pending) controller.abort();
    pending.clear();
    for (const form of forms) { form.reset(); unlock(form, false); form.removeAttribute('aria-busy'); }
    report('Browser session changed.', changedMessage, true);
  }
  function announceSessionChange() { sessionChannel?.postMessage({ sessionChanged: true }); }
  async function checkSession() {
    if (!enabled || changed) throw new Error(changedMessage);
    if (checking) return checking;
    checking = (async () => {
      const controller = new AbortController(); pending.add(controller);
      try {
        const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json', 'X-Session-Token': csrfToken } });
        const result = await response.json().catch(() => ({}));
        if (changed) throw new Error(changedMessage);
        if (response.status === 409 || result.code === 'csrf_failed' || (response.ok && result.csrfToken !== csrfToken)) {
          sessionChanged(); throw new Error(changedMessage);
        }
        if (!response.ok) throw new Error('The secure service could not verify your browser session. Please try again.');
      } finally { pending.delete(controller); }
    })();
    try { await checking; } finally { checking = null; }
  }
  sessionChannel?.addEventListener('message', (event) => { if (event.data?.sessionChanged === true) sessionChanged(); });
  function checkVisibleSession() { if (!document.hidden && enabled && !changed) checkSession().catch(() => {}); }
  window.addEventListener('focus', checkVisibleSession);
  document.addEventListener('visibilitychange', checkVisibleSession);
  window.addEventListener('pageshow', (event) => { if (event.persisted) sessionChanged(); });
  window.setInterval(checkVisibleSession, 15_000);
  const recovery = new URLSearchParams(location.search).get('recovery') === '1';
  if (recovery) {
    const login = document.querySelector('#sign-in-form');
    const password = document.querySelector('#password-form');
    if (login && password) { login.hidden = true; password.hidden = false; }
  }
  for (const form of forms) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!enabled || !csrfToken) return;
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const password = data.get('password');
      if (data.has('passwordConfirm') && password !== data.get('passwordConfirm')) {
        report('Passwords do not match.', 'Please enter the same password in both fields.', true); return;
      }
      const kind = form.dataset.accountForm;
      let payload;
      if (kind === 'register') {
        payload = { email: data.get('email'), password, role: form.dataset.role,
          company: { name: data.get('companyName'), country: data.get('country'), registrationNumber: data.get('registrationNumber') },
          profile: { countries: String(data.get('countries') || '').split(',').map((value) => value.trim()).filter(Boolean), sectors: String(data.get('sectors') || '').split(',').map((value) => value.trim()).filter(Boolean), summary: data.get('summary') } };
      } else if (kind === 'recover') payload = { email: data.get('email') };
      else if (kind === 'password') payload = { password };
      else payload = { email: data.get('email'), password };
      unlock(form, false); form.setAttribute('aria-busy', 'true');
      try {
        await checkSession();
        if (changed) throw new Error(changedMessage);
        const controller = new AbortController(); pending.add(controller);
        let response; let result;
        try {
          response = await fetch(`/api/auth/${kind}`, { method: 'POST', credentials: 'same-origin', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, 'X-Session-Token': csrfToken }, body: JSON.stringify(payload) });
          result = await response.json().catch(() => ({}));
        } finally { pending.delete(controller); }
        if (changed) throw new Error(changedMessage);
        if (result.code === 'session_changed' || result.code === 'csrf_failed') { sessionChanged(); throw new Error(changedMessage); }
        if (!response.ok) throw new Error(result.error || 'The request could not be completed. Please try again later.');
        form.reset();
        if (kind === 'login') { announceSessionChange(); location.assign('/portal/'); return; }
        if (kind === 'register') {
          report('Check your email.', 'If your application can proceed, a verification email will be sent. Email verification is followed by manual company review; private access is not granted automatically.');
          return;
        }
        if (kind === 'recover') report('Recovery request received.', 'If an eligible account exists for that address, a password recovery email will be sent.');
        if (kind === 'password') {
          enabled = false; announceSessionChange();
          report('Password updated.', 'Your password has been changed and previous sessions have been signed out. Sign in again with your new password.');
          const link = document.createElement('a'); link.href = '/member-sign-in/'; link.textContent = 'Sign in again'; link.className = 'access-entry-link'; notice.append(link);
          return;
        }
        unlock(form, true);
      } catch (error) { if (!changed) { report('Request not completed.', error.message, true); unlock(form, enabled); } }
      finally { form.removeAttribute('aria-busy'); }
    });
  }
  fetch('/api/config', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unavailable');
      const config = await response.json();
      if (changed) return;
      if (config.backendEnabled !== true || typeof config.csrfToken !== 'string' || !config.csrfToken) throw new Error('Unavailable');
      csrfToken = config.csrfToken; enabled = true;
      for (const form of forms) unlock(form, true);
      const environment = config.environment === 'local' ? 'Local development' : 'Secure member service';
      report(environment, recovery
        ? 'Set a new password only if you followed your requested recovery email. The server validates your recovery session.'
        : 'Email verification and individual company approval are required. Registration does not grant private access.');
      const status = new URLSearchParams(location.search).get('status');
      if (status === 'verified') report('Email confirmed.', 'You can sign in. Your company application still requires individual approval.');
    }).catch(() => { /* Initial disabled HTML remains truthful and safe. */ });
})();
