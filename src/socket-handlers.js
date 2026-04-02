const readyCheck = require('./ready-check');
const auth = require('./auth');
const cookie = require('cookie');
const { socketRateLimiter, cleanupSocketRateLimit, isCleanInput, isCleanMultilineInput } = require('./security');
const metrics = require('./metrics');

// Debounce roster updates to avoid flooding facilitator
const rosterDebounceTimers = new Map();
const ROSTER_DEBOUNCE_MS = 500;

function setup(io, store) {
  io.on('connection', (socket) => {
    // --- Participant Events ---

    socket.on('join', ({ sessionId, nickname, visitorId }) => {
      if (!socketRateLimiter(socket, 'join')) {
        return socket.emit('error', { message: 'Too many requests, please slow down' });
      }
      const session = store.get(sessionId);
      if (!session) {
        return socket.emit('error', { message: 'Session not found' });
      }

      if (!nickname || !visitorId) {
        return socket.emit('error', { message: 'Nickname and visitorId are required' });
      }

      if (!isCleanInput(nickname)) {
        return socket.emit('error', { message: 'Nickname contains invalid characters' });
      }

      const participant = store.addParticipant(sessionId, {
        visitorId,
        socketId: socket.id,
        nickname,
      });

      if (!participant) {
        return socket.emit('error', { message: 'Failed to join session' });
      }

      socket.join(`session:${sessionId}`);
      socket.data = { sessionId, visitorId, role: 'participant' };

      metrics.inc('participantsJoined');

      // Confirm join to participant
      socket.emit('joined', {
        visitorId: participant.visitorId,
        nickname: participant.nickname,
        sessionName: session.name,
      });

      // If there's an active check, send it to the joining participant
      if (session.activeCheck) {
        const check = session.activeCheck;
        const existingResponse = check.responses.get(visitorId);
        socket.emit('ready-check:start', {
          checkId: check.id,
          label: check.label,
          instructions: check.instructions || '',
          timeoutSeconds: check.timeoutSeconds,
          startedAt: check.startedAt,
          existingResponse: existingResponse ? existingResponse.value : null,
        });
      }

      // Notify facilitator
      debouncedRosterUpdate(io, store, sessionId);
    });

    socket.on('respond', ({ checkId, value }, ack) => {
      if (!socketRateLimiter(socket, 'respond')) {
        return socket.emit('error', { message: 'Too many responses, please slow down' });
      }

      const { sessionId, visitorId } = socket.data || {};
      if (!sessionId || !visitorId) {
        return socket.emit('error', { message: 'Not in a session' });
      }

      const session = store.get(sessionId);
      if (!session) {
        return socket.emit('error', { message: 'Session not found' });
      }

      try {
        const response = readyCheck.respond(session, { checkId, visitorId, value });
        metrics.inc(value === 'ready' ? 'responsesReady' : 'responsesNeedHelp');

        // Ack to participant
        if (typeof ack === 'function') ack({ ok: true, value: response.value });

        // Notify facilitator of individual response
        io.to(`session:${sessionId}:facilitator`).emit('check:response', {
          checkId,
          visitorId,
          nickname: response.nickname,
          value: response.value,
        });

        // Send updated summary
        const summary = readyCheck.getSummary(session);
        io.to(`session:${sessionId}:facilitator`).emit('check:summary', summary);

        // Also send aggregate to participants (without individual data)
        io.to(`session:${sessionId}`).emit('check:aggregate', {
          checkId,
          responded: summary.responded,
          ready: summary.ready,
          total: summary.total,
        });

        // Auto-complete only when everyone is ready
        if (summary.ready === summary.total) {
          completeCheck(io, store, session, 'completed');
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // --- Facilitator Events ---

    socket.on('join-facilitator', ({ sessionId }) => {
      // Verify auth from cookie
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      const payload = auth.verifyToken(cookies.auth_token);
      if (!payload) {
        return socket.emit('error', { message: 'Authentication required' });
      }

      const session = store.get(sessionId);
      if (!session) {
        return socket.emit('error', { message: 'Session not found' });
      }

      // Verify this facilitator owns the session
      if (session.facilitatorEmail !== payload.emailHash) {
        return socket.emit('error', { message: 'Not authorized for this session' });
      }

      session.facilitatorSocketId = socket.id;
      socket.join(`session:${sessionId}`);
      socket.join(`session:${sessionId}:facilitator`);
      socket.data = { sessionId, role: 'facilitator' };

      // Send current state
      socket.emit('session:state', {
        sessionId: session.id,
        name: session.name,
        roster: store.getRoster(sessionId),
        activeCheck: session.activeCheck
          ? {
              checkId: session.activeCheck.id,
              label: session.activeCheck.label,
              instructions: session.activeCheck.instructions || '',
              timeoutSeconds: session.activeCheck.timeoutSeconds,
              startedAt: session.activeCheck.startedAt,
              summary: readyCheck.getSummary(session),
              responses: Object.fromEntries(session.activeCheck.responses),
            }
          : null,
        history: readyCheck.getHistory(session),
      });
    });

    socket.on('create-check', ({ label, instructions, timeoutSeconds } = {}) => {
      if (!socketRateLimiter(socket, 'create-check')) {
        return socket.emit('error', { message: 'Please wait before issuing another check' });
      }

      const { sessionId, role } = socket.data || {};
      if (role !== 'facilitator' || !sessionId) {
        return socket.emit('error', { message: 'Not authorized' });
      }

      const session = store.get(sessionId);
      if (!session) {
        return socket.emit('error', { message: 'Session not found' });
      }

      if (label && !isCleanInput(label)) {
        return socket.emit('error', { message: 'Check label contains invalid characters' });
      }

      if (instructions && !isCleanMultilineInput(instructions)) {
        return socket.emit('error', { message: 'Instructions contain invalid characters' });
      }

      try {
        const check = readyCheck.createReadyCheck(session, { label, instructions, timeoutSeconds });
        metrics.inc('readyChecksIssued');

        // Broadcast to all participants
        io.to(`session:${sessionId}`).emit('ready-check:start', {
          checkId: check.id,
          label: check.label,
          instructions: check.instructions || '',
          timeoutSeconds: check.timeoutSeconds,
          startedAt: check.startedAt,
          existingResponse: null,
        });

        // Send initial summary to facilitator
        const summary = readyCheck.getSummary(session);
        io.to(`session:${sessionId}:facilitator`).emit('check:summary', summary);

        // Set up auto-timeout
        const timer = setTimeout(() => {
          const currentSession = store.get(sessionId);
          if (currentSession && currentSession.activeCheck?.id === check.id) {
            completeCheck(io, store, currentSession, 'timed_out');
          }
        }, check.timeoutSeconds * 1000);

        // Store timer reference for cleanup
        check._timer = timer;
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('end-check', ({ checkId } = {}) => {
      const { sessionId, role } = socket.data || {};
      if (role !== 'facilitator' || !sessionId) {
        return socket.emit('error', { message: 'Not authorized' });
      }

      const session = store.get(sessionId);
      if (!session || !session.activeCheck || session.activeCheck.id !== checkId) {
        return socket.emit('error', { message: 'No matching active check' });
      }

      completeCheck(io, store, session, 'completed');
    });

    socket.on('end-session', () => {
      const { sessionId, role } = socket.data || {};
      if (role !== 'facilitator' || !sessionId) {
        return socket.emit('error', { message: 'Not authorized' });
      }

      const session = store.get(sessionId);
      if (!session) return;

      // End active check if any
      if (session.activeCheck) {
        completeCheck(io, store, session, 'completed');
      }

      // Notify all participants and facilitator
      io.to(`session:${sessionId}`).emit('session:expired');

      // Remove session from store
      store.delete(sessionId);
    });

    socket.on('leave-session', () => {
      const { sessionId, visitorId, role } = socket.data || {};
      if (!sessionId || role !== 'participant') return;

      store.disconnectBySocketId(socket.id);
      socket.leave(`session:${sessionId}`);
      socket.data = {};

      debouncedRosterUpdate(io, store, sessionId);
    });

    // --- Disconnect ---

    socket.on('disconnect', () => {
      cleanupSocketRateLimit(socket.id);
      const { sessionId, role } = socket.data || {};
      if (!sessionId) return;

      if (role === 'participant') {
        const result = store.disconnectBySocketId(socket.id);
        if (result) {
          debouncedRosterUpdate(io, store, sessionId);
        }
      } else if (role === 'facilitator') {
        const session = store.get(sessionId);
        if (session && session.facilitatorSocketId === socket.id) {
          session.facilitatorSocketId = null;
        }
      }
    });
  });
}

function completeCheck(io, store, session, reason) {
  const check = session.activeCheck;
  if (!check) return;

  // Track completion reason
  if (reason === 'timed_out') metrics.inc('checksTimedOut');
  else if (reason === 'completed' && check.responses.size === session.participants.size)
    metrics.inc('checksAutoCompleted');
  else metrics.inc('checksManuallyEnded');

  // Clear timeout timer
  if (check._timer) {
    clearTimeout(check._timer);
    delete check._timer;
  }

  const results = readyCheck.getResults(check, session.participants);
  readyCheck.endCheck(session, reason);

  // Notify everyone
  io.to(`session:${session.id}`).emit('ready-check:end', {
    checkId: check.id,
    reason,
  });

  // Send final results to facilitator
  io.to(`session:${session.id}:facilitator`).emit('check:complete', {
    checkId: check.id,
    reason,
    results,
    summary: {
      total: session.participants.size,
      responded: check.responses.size,
      ready: results.filter((r) => r.value === 'ready').length,
      needHelp: results.filter((r) => r.value === 'need_help').length,
      noResponse: results.filter((r) => r.value === 'no_response').length,
    },
    history: readyCheck.getHistory(session),
  });
}

function debouncedRosterUpdate(io, store, sessionId) {
  if (rosterDebounceTimers.has(sessionId)) {
    clearTimeout(rosterDebounceTimers.get(sessionId));
  }

  const timer = setTimeout(() => {
    rosterDebounceTimers.delete(sessionId);
    const roster = store.getRoster(sessionId);
    io.to(`session:${sessionId}:facilitator`).emit('roster:update', { participants: roster });
  }, ROSTER_DEBOUNCE_MS);

  rosterDebounceTimers.set(sessionId, timer);
}

module.exports = { setup };
