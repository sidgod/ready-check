// ready-check — Participant client

const socket = io({ autoConnect: false });

// --- Tab notification (flash title + sound when check arrives while tab is backgrounded) ---
const originalTitle = document.title;
let titleFlashInterval = null;

function startTitleFlash(label) {
  stopTitleFlash();
  let show = true;
  titleFlashInterval = setInterval(() => {
    document.title = show ? `🔔 ${label || 'Ready Check!'}` : originalTitle;
    show = !show;
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
    document.title = originalTitle;
  }
}

// Stop flashing when tab gains focus
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stopTitleFlash();
});

// Extract session ID from URL: /session/:id
const pathParts = window.location.pathname.split('/');
const sessionId = pathParts[2];

// Dev mode: ?dev=1 gives each tab its own visitorId (for multi-participant testing)
const isDev = new URLSearchParams(window.location.search).has('dev');
let visitorId;
if (isDev) {
  visitorId = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
} else {
  visitorId = localStorage.getItem(`rc_visitor_${sessionId}`);
  if (!visitorId) {
    visitorId = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(`rc_visitor_${sessionId}`, visitorId);
  }
}

let currentCheckId = null;
let myResponse = null;

// --- Load session info ---
(async function loadSession() {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (!res.ok) {
      document.getElementById('session-name-display').textContent = 'Session not found';
      document.getElementById('btn-join').disabled = true;
      return;
    }
    const data = await res.json();
    document.getElementById('session-name-display').textContent = data.name || 'Workshop Session';
  } catch {
    document.getElementById('session-name-display').textContent = 'Workshop Session';
  }
})();

// --- Join ---

function handleJoin() {
  const nickname = document.getElementById('nickname').value.trim();
  if (!nickname) {
    showJoinAlert('Please enter a nickname');
    return;
  }

  const btn = document.getElementById('btn-join');
  btn.disabled = true;
  btn.textContent = 'Joining...';

  // Store nickname for reconnect
  localStorage.setItem(`rc_nickname_${sessionId}`, nickname);

  socket.connect();
  socket.emit('join', { sessionId, nickname, visitorId });
}

// Auto-rejoin if we have a stored nickname
const storedNickname = localStorage.getItem(`rc_nickname_${sessionId}`);
if (storedNickname) {
  document.getElementById('nickname').value = storedNickname;
}

// --- Socket Events ---

socket.on('joined', (data) => {
  document.getElementById('view-join').classList.add('hidden');
  document.getElementById('view-waiting').classList.remove('hidden');
  document.getElementById('my-nickname').textContent = data.nickname;

  // Update stored nickname (may have been auto-suffixed)
  localStorage.setItem(`rc_nickname_${sessionId}`, data.nickname);
});

socket.on('ready-check:start', (data) => {
  currentCheckId = data.checkId;
  myResponse = data.existingResponse || null;

  const label = data.label || 'Are you ready?';
  document.getElementById('check-label').textContent = label;

  if (myResponse) {
    showConfirmed(myResponse);
  } else {
    showPrompt();
  }

  document.getElementById('check-panel').classList.add('active');

  // Flash tab title if tab is in background
  if (document.hidden) {
    startTitleFlash(label);
  }
});

socket.on('ready-check:end', () => {
  currentCheckId = null;
  myResponse = null;
  document.getElementById('check-panel').classList.remove('active');
  stopTitleFlash();
});

socket.on('check:aggregate', () => {
  // No-op: aggregate info not shown to participants
});

socket.on('session:expired', () => {
  alert('This session has expired.');
  window.location.href = '/';
});

socket.on('error', (data) => {
  if (document.getElementById('view-join').classList.contains('hidden')) {
    // Already in session, show as alert
    console.error('[ready-check]', data.message);
  } else {
    showJoinAlert(data.message);
    document.getElementById('btn-join').disabled = false;
    document.getElementById('btn-join').textContent = 'Join Session';
  }
});

// --- Connection Status ---

socket.on('disconnect', () => {
  document.getElementById('connection-status').classList.add('disconnected');
});

socket.on('connect', () => {
  document.getElementById('connection-status').classList.remove('disconnected');

  // Re-join on reconnect
  const nickname = localStorage.getItem(`rc_nickname_${sessionId}`);
  if (nickname && document.getElementById('view-join').classList.contains('hidden')) {
    socket.emit('join', { sessionId, nickname, visitorId });
  }
});

// --- Response ---

function sendResponse(value) {
  if (!currentCheckId) return;

  socket.emit('respond', { checkId: currentCheckId, value }, (ack) => {
    if (ack && ack.ok) {
      myResponse = ack.value;
      showConfirmed(myResponse);
    }
  });
}

function showPrompt() {
  document.getElementById('check-prompt').classList.remove('hidden');
  document.getElementById('check-confirmed').classList.add('hidden');
}

function showConfirmed(value) {
  document.getElementById('check-prompt').classList.add('hidden');
  document.getElementById('check-confirmed').classList.remove('hidden');

  const labels = {
    ready: '&#x2714; You responded: Ready',
    need_help: '&#x270B; You responded: Need Help',
  };
  document.getElementById('confirmed-text').innerHTML = labels[value] || value;
}

function showJoinAlert(message) {
  const el = document.getElementById('alert-join');
  el.textContent = message;
  el.className = 'alert alert-error';
  el.classList.remove('hidden');
}

function handleLeave() {
  socket.emit('leave-session');
  socket.disconnect();
  localStorage.removeItem(`rc_nickname_${sessionId}`);
  if (isDev) {
    // Generate fresh visitorId for next join in dev mode
    visitorId = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  } else {
    localStorage.removeItem(`rc_visitor_${sessionId}`);
  }
  document.getElementById('view-waiting').classList.add('hidden');
  document.getElementById('check-panel').classList.remove('active');
  document.getElementById('view-join').classList.remove('hidden');
  document.getElementById('nickname').value = '';
  document.getElementById('btn-join').disabled = false;
  document.getElementById('btn-join').textContent = 'Join Session';
  currentCheckId = null;
  myResponse = null;
}

// Event listeners (no inline onclick — CSP requires script-src 'self')
document.getElementById('btn-join').addEventListener('click', handleJoin);
document.getElementById('link-leave').addEventListener('click', (e) => {
  e.preventDefault();
  handleLeave();
});

// Response buttons — use event delegation on the check panel
document.getElementById('check-panel').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-response]');
  if (btn) sendResponse(btn.dataset.response);
});

// Enter key on nickname
document.getElementById('nickname').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleJoin();
});
