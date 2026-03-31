// ready-check — Facilitator client

const socket = io();

// Extract session ID from URL: /session/:id/facilitate
const pathParts = window.location.pathname.split('/');
const sessionId = pathParts[2];

let currentCheckId = null;
let checkTimerInterval = null;
let checkStartedAt = null;
let checkTimeoutSeconds = null;
let participants = [];
let responseMap = {};

// --- Initialize ---

socket.emit('join-facilitator', { sessionId });

// --- Session State (on connect / reconnect) ---

socket.on('session:state', (state) => {
  document.getElementById('session-name').textContent = state.name || '';

  // Build join URL
  const baseUrl = window.location.origin;
  const joinUrl = `${baseUrl}/session/${sessionId}`;
  document.getElementById('join-url-text').textContent = joinUrl;

  // Load QR code
  loadQRCode();

  // Roster
  updateRoster(state.roster);

  // Active check
  if (state.activeCheck) {
    currentCheckId = state.activeCheck.checkId;
    responseMap = state.activeCheck.responses || {};
    showActiveCheck(state.activeCheck.label, state.activeCheck.summary);
    renderResults();
  }

  // History
  if (state.history && state.history.length > 0) {
    renderHistory(state.history);
  }
});

// --- QR Code ---

async function loadQRCode() {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (!res.ok) return;

    // Generate QR from join URL
    const baseUrl = window.location.origin;
    const joinUrl = `${baseUrl}/session/${sessionId}`;

    // We'll use the QR code from session creation, but as a fallback
    // generate via a simple API call or just show the URL
    const img = document.getElementById('qr-code');
    // Use an inline QR generation approach via the server
    img.src = `/api/sessions/${sessionId}/qr`;
    img.onerror = () => {
      // Fallback: hide QR if not available
      img.style.display = 'none';
    };
  } catch {
    // QR load failed, no big deal
  }
}

// --- Roster ---

socket.on('roster:update', (data) => {
  updateRoster(data.participants);
});

function updateRoster(roster) {
  participants = roster || [];
  document.getElementById('participant-count').textContent = participants.length;

  const online = participants.filter((p) => p.connected).length;
  document.getElementById('online-count').textContent = `${online} online`;

  const list = document.getElementById('roster-list');

  if (participants.length === 0) {
    list.innerHTML = '<li class="text-center text-muted" style="padding: 24px;">Waiting for participants to join...</li>';
    return;
  }

  list.innerHTML = participants
    .sort((a, b) => a.nickname.localeCompare(b.nickname))
    .map((p) => {
      const statusClass = p.connected ? 'online' : 'offline';
      const response = responseMap[p.visitorId];
      const badge = response ? getBadgeHTML(response.value || response) : '';
      return `
        <li class="roster-item">
          <span class="roster-name">
            <span class="status-dot ${statusClass}"></span>
            ${escapeHtml(p.nickname)}
          </span>
          ${badge}
        </li>
      `;
    })
    .join('');
}

// --- Ready Check ---

function issueCheck() {
  const label = document.getElementById('check-label-input').value.trim();
  socket.emit('create-check', { label });
  document.getElementById('check-label-input').value = '';
}

function endCurrentCheck() {
  if (currentCheckId) {
    socket.emit('end-check', { checkId: currentCheckId });
  }
}

socket.on('check:summary', (summary) => {
  if (!currentCheckId) {
    currentCheckId = summary.checkId;
    showActiveCheck(summary.label);
  }
  updateStats(summary);
});

socket.on('check:response', (data) => {
  responseMap[data.visitorId] = data;
  renderResults();
  updateRoster(participants); // Re-render roster with badges
});

socket.on('check:complete', (data) => {
  stopTimer();
  currentCheckId = null;

  // Update final stats
  updateStats(data.summary);

  // Show end state
  document.getElementById('btn-issue-check').classList.remove('hidden');
  document.getElementById('btn-end-check').classList.add('hidden');
  document.getElementById('check-timer').textContent = data.reason === 'timed_out' ? 'Timed out' : 'Completed';

  // Build final response map from results
  responseMap = {};
  if (data.results) {
    data.results.forEach((r) => {
      responseMap[r.visitorId] = r;
    });
  }
  renderResults();
  updateRoster(participants);

  // Re-render full history from server
  if (data.history) {
    renderHistory(data.history);
  }
});

socket.on('ready-check:start', (data) => {
  // Facilitator also receives this (they're in the session room)
  currentCheckId = data.checkId;
  checkStartedAt = data.startedAt;
  checkTimeoutSeconds = data.timeoutSeconds;
  responseMap = {};

  showActiveCheck(data.label);
  startTimer();
});

socket.on('ready-check:end', () => {
  // Handled by check:complete for facilitator
});

function showActiveCheck(label, summary) {
  document.getElementById('section-active-check').classList.remove('hidden');
  document.getElementById('active-check-label').textContent = label || 'Ready Check';

  document.getElementById('btn-issue-check').classList.add('hidden');
  document.getElementById('btn-end-check').classList.remove('hidden');

  if (summary) {
    updateStats(summary);
  }
}

function updateStats(summary) {
  if (!summary) return;
  const total = summary.total || 1;

  document.getElementById('stat-ready').textContent = summary.ready || 0;
  document.getElementById('stat-help').textContent = summary.needHelp || 0;
  document.getElementById('stat-no-response').textContent = (summary.noResponse || 0) + (summary.notReady || 0);

  // Progress bar
  document.getElementById('progress-ready').style.width = `${((summary.ready || 0) / total) * 100}%`;
  document.getElementById('progress-help').style.width = `${(((summary.needHelp || 0) + (summary.notReady || 0)) / total) * 100}%`;
}

function renderResults() {
  const grid = document.getElementById('results-grid');

  // Merge roster with responses
  const items = participants.map((p) => {
    const response = responseMap[p.visitorId];
    const value = response ? (response.value || 'no_response') : 'no_response';
    return { nickname: p.nickname, value };
  });

  // Sort: need_help first, then no_response, then ready
  const order = { need_help: 0, no_response: 1, ready: 2 };
  items.sort((a, b) => (order[a.value] ?? 4) - (order[b.value] ?? 4));

  grid.innerHTML = items
    .map((item) => {
      const icon = getIcon(item.value);
      return `<div class="result-card ${item.value}">${icon} ${escapeHtml(item.nickname)}</div>`;
    })
    .join('');
}

// --- Timer ---

function startTimer() {
  stopTimer();
  updateTimerDisplay();
  checkTimerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (checkTimerInterval) {
    clearInterval(checkTimerInterval);
    checkTimerInterval = null;
  }
}

function updateTimerDisplay() {
  if (!checkStartedAt || !checkTimeoutSeconds) return;

  const elapsed = (Date.now() - checkStartedAt) / 1000;
  const remaining = Math.max(0, checkTimeoutSeconds - elapsed);

  if (remaining <= 0) {
    document.getElementById('check-timer').textContent = 'Time\'s up';
    stopTimer();
    return;
  }

  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  document.getElementById('check-timer').textContent =
    mins > 0 ? `${mins}m ${secs}s remaining` : `${secs}s remaining`;
}

// --- History ---

function renderHistory(history) {
  if (!history || history.length === 0) {
    document.getElementById('section-history').classList.add('hidden');
    return;
  }

  document.getElementById('section-history').classList.remove('hidden');
  const list = document.getElementById('history-list');

  list.innerHTML = history
    .slice()
    .reverse()
    .map((item, i) => {
      const time = new Date(item.startedAt).toLocaleTimeString();
      const s = item.summary;
      return `
        <div class="history-item">
          <div class="history-header" data-history-index="${i}">
            <div>
              <strong>${escapeHtml(item.label || 'Ready Check')}</strong>
              <span class="text-muted" style="margin-left: 8px; font-size: 0.85rem;">${time}</span>
            </div>
            <div class="flex gap-8">
              <span class="badge badge-ready">${s.ready}</span>
              <span class="badge badge-help">${s.needHelp}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function toggleHistory(index) {
  // Simple toggle — could expand to show individual results
  const items = document.querySelectorAll('.history-details');
  items.forEach((el, i) => {
    el.classList.toggle('expanded', i === index && !el.classList.contains('expanded'));
  });
}

// --- Connection ---

socket.on('disconnect', () => {
  document.getElementById('connection-status').classList.add('disconnected');
});

socket.on('connect', () => {
  document.getElementById('connection-status').classList.remove('disconnected');
  // Re-join facilitator room
  socket.emit('join-facilitator', { sessionId });
});

socket.on('error', (data) => {
  const el = document.getElementById('alert-facilitator');
  el.textContent = data.message;
  el.className = 'alert alert-error';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
});

socket.on('session:expired', () => {
  alert('This session has expired.');
  window.location.href = '/';
});

// --- Helpers ---

function copyJoinUrl() {
  const url = document.getElementById('join-url-text').textContent;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getBadgeHTML(value) {
  const badges = {
    ready: '<span class="badge badge-ready">Ready</span>',
    need_help: '<span class="badge badge-help">Need Help</span>',
    no_response: '<span class="badge badge-no-response">No Response</span>',
  };
  return badges[value] || '';
}

function getIcon(value) {
  const icons = {
    ready: '&#x2714;',
    need_help: '&#x270B;',
    no_response: '&#x2022;',
  };
  return icons[value] || '';
}

// Event listeners (no inline onclick — CSP requires script-src 'self')
document.getElementById('btn-issue-check').addEventListener('click', issueCheck);
document.getElementById('btn-end-check').addEventListener('click', endCurrentCheck);
document.getElementById('btn-copy-url').addEventListener('click', copyJoinUrl);
document.getElementById('btn-end-session').addEventListener('click', () => {
  if (confirm('End this session? All participants will be disconnected.')) {
    socket.emit('end-session');
  }
});

// History toggle — event delegation on history list
document.getElementById('history-list').addEventListener('click', (e) => {
  const header = e.target.closest('[data-history-index]');
  if (header) toggleHistory(Number(header.dataset.historyIndex));
});

// Enter key on check label
document.getElementById('check-label-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') issueCheck();
});
