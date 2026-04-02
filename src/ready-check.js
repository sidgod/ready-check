const { nanoid } = require('nanoid');

function createReadyCheck(session, { label = '', instructions = '', timeoutSeconds } = {}) {
  if (session.activeCheck) {
    throw new Error('A ready check is already active');
  }

  const timeout = timeoutSeconds || session.settings.defaultTimeout;

  const check = {
    id: nanoid(6),
    label: sanitize(label, 200),
    instructions: sanitize(instructions, 2000),
    startedAt: Date.now(),
    timeoutSeconds: timeout,
    status: 'active',
    responses: new Map(),
  };

  session.activeCheck = check;
  session.readyChecks.push(check);

  return check;
}

function respond(session, { checkId, visitorId, value }) {
  const check = session.activeCheck;
  if (!check || check.id !== checkId) {
    throw new Error('No active ready check with that ID');
  }
  if (check.status !== 'active') {
    throw new Error('Ready check is no longer active');
  }

  const validValues = ['ready', 'need_help'];
  if (!validValues.includes(value)) {
    throw new Error(`Invalid response value: ${value}`);
  }

  const participant = session.participants.get(visitorId);
  if (!participant) {
    throw new Error('Participant not found in session');
  }

  // Last-response-wins: participants can change their answer
  check.responses.set(visitorId, {
    visitorId,
    nickname: participant.nickname,
    value,
    respondedAt: Date.now(),
  });

  return check.responses.get(visitorId);
}

function endCheck(session, reason = 'completed') {
  const check = session.activeCheck;
  if (!check) return null;

  check.status = reason; // 'completed' or 'timed_out'
  session.activeCheck = null;

  return check;
}

function getSummary(session) {
  const check = session.activeCheck;
  if (!check) return null;

  const total = session.participants.size;
  let ready = 0;
  let needHelp = 0;

  for (const response of check.responses.values()) {
    switch (response.value) {
      case 'ready':
        ready++;
        break;
      case 'need_help':
        needHelp++;
        break;
    }
  }

  return {
    checkId: check.id,
    label: check.label,
    ready,
    needHelp,
    noResponse: total - check.responses.size,
    total,
    responded: check.responses.size,
  };
}

function getResults(check, participants) {
  const results = [];
  for (const [visitorId, participant] of participants) {
    const response = check.responses.get(visitorId);
    results.push({
      visitorId,
      nickname: participant.nickname,
      value: response ? response.value : 'no_response',
      respondedAt: response ? response.respondedAt : null,
    });
  }
  return results;
}

function getHistory(session) {
  return session.readyChecks.map((check) => ({
    id: check.id,
    label: check.label,
    instructions: check.instructions || '',
    startedAt: check.startedAt,
    status: check.status,
    summary: {
      total: session.participants.size,
      responded: check.responses.size,
      ready: countByValue(check.responses, 'ready'),
      needHelp: countByValue(check.responses, 'need_help'),
    },
  }));
}

function countByValue(responses, value) {
  let count = 0;
  for (const r of responses.values()) {
    if (r.value === value) count++;
  }
  return count;
}

function sanitize(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .slice(0, maxLen)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = {
  createReadyCheck,
  respond,
  endCheck,
  getSummary,
  getResults,
  getHistory,
};
