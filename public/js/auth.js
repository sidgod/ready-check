// ready-check — Auth UI logic

let currentEmail = '';

// Check if already authenticated on load
(async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (data.authenticated) {
      showCreateSession();
    }
  } catch {
    // Not authenticated, show register
  }
})();

function showRegister() {
  document.getElementById('view-register').classList.remove('hidden');
  document.getElementById('view-verify').classList.add('hidden');
  document.getElementById('view-create').classList.add('hidden');
  clearAlerts();
}

function showVerify() {
  document.getElementById('view-register').classList.add('hidden');
  document.getElementById('view-verify').classList.remove('hidden');
  document.getElementById('view-create').classList.add('hidden');
  clearAlerts();
  document.getElementById('pin').focus();
}

function showCreateSession() {
  document.getElementById('view-register').classList.add('hidden');
  document.getElementById('view-verify').classList.add('hidden');
  document.getElementById('view-create').classList.remove('hidden');
  clearAlerts();
  document.getElementById('session-name').focus();
}

function clearAlerts() {
  document.querySelectorAll('.alert').forEach((el) => el.classList.add('hidden'));
}

function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
}

async function handleRegister() {
  const email = document.getElementById('email').value.trim();
  if (!email) return showAlert('alert-register', 'Please enter your email');

  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send PIN');
    }

    currentEmail = email;
    showVerify();
  } catch (err) {
    showAlert('alert-register', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send PIN';
  }
}

async function handleVerify() {
  const pin = document.getElementById('pin').value.trim();
  if (!pin || pin.length !== 6) return showAlert('alert-verify', 'Please enter the 6-digit PIN');

  const btn = document.getElementById('btn-verify');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, pin }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Verification failed');
    }

    showCreateSession();
  } catch (err) {
    showAlert('alert-verify', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify';
  }
}

async function handleCreateSession() {
  const name = document.getElementById('session-name').value.trim();

  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, defaultTimeout: Number(document.getElementById('check-timeout').value) }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to create session');
    }

    // Redirect to facilitator dashboard
    window.location.href = data.facilitateUrl;
  } catch (err) {
    showAlert('alert-create', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Session';
  }
}

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  showRegister();
}

// Event listeners (no inline onclick — CSP requires script-src 'self')
document.getElementById('btn-register').addEventListener('click', handleRegister);
document.getElementById('btn-verify').addEventListener('click', handleVerify);
document.getElementById('btn-create').addEventListener('click', handleCreateSession);
document.getElementById('link-back-register').addEventListener('click', (e) => {
  e.preventDefault();
  showRegister();
});
document.getElementById('link-logout').addEventListener('click', (e) => {
  e.preventDefault();
  handleLogout();
});

// Enter key handlers
document.getElementById('email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleRegister();
});

document.getElementById('pin').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleVerify();
});

document.getElementById('session-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCreateSession();
});
