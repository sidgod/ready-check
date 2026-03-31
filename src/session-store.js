const { nanoid } = require('nanoid');

class SessionStore {
  constructor({ maxSessions = 100, sessionTTLMs = 4 * 60 * 60 * 1000 } = {}) {
    this.sessions = new Map();
    this.maxSessions = maxSessions;
    this.sessionTTLMs = sessionTTLMs;

    // Cleanup expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  create({ name = '', facilitatorEmail, defaultTimeout } = {}) {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('Maximum number of active sessions reached');
    }

    // Per-facilitator limit: max 5 concurrent sessions
    const facilitatorCount = [...this.sessions.values()]
      .filter((s) => s.facilitatorEmail === facilitatorEmail).length;
    if (facilitatorCount >= 5) {
      throw new Error('Too many active sessions for this account');
    }

    // Validate timeout: must be between 60s and 1800s, default 300s
    const allowedTimeouts = [120, 180, 300, 600, 900, 1800];
    const timeout = allowedTimeouts.includes(Number(defaultTimeout)) ? Number(defaultTimeout) : 300;

    const id = nanoid(8);
    const session = {
      id,
      name: sanitize(name, 100),
      createdAt: Date.now(),
      facilitatorEmail,
      facilitatorSocketId: null,
      participants: new Map(),
      readyChecks: [],
      activeCheck: null,
      lastActivity: Date.now(),
      settings: {
        defaultTimeout: timeout,
      },
    };

    this.sessions.set(id, session);
    return session;
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session || null;
  }

  delete(sessionId) {
    return this.sessions.delete(sessionId);
  }

  addParticipant(sessionId, { visitorId, socketId, nickname }) {
    const session = this.get(sessionId);
    if (!session) return null;

    const existing = session.participants.get(visitorId);
    if (existing) {
      // Reconnect: update socket, mark connected
      existing.socketId = socketId;
      existing.connected = true;
      return existing;
    }

    // Enforce unique nicknames with auto-suffix
    const finalNickname = uniqueNickname(nickname, session.participants);

    const participant = {
      visitorId,
      socketId,
      nickname: finalNickname,
      joinedAt: Date.now(),
      connected: true,
    };

    session.participants.set(visitorId, participant);
    return participant;
  }

  removeParticipant(sessionId, visitorId) {
    const session = this.get(sessionId);
    if (!session) return;
    const participant = session.participants.get(visitorId);
    if (participant) {
      participant.connected = false;
    }
  }

  disconnectBySocketId(socketId) {
    for (const session of this.sessions.values()) {
      if (session.facilitatorSocketId === socketId) {
        session.facilitatorSocketId = null;
      }
      for (const participant of session.participants.values()) {
        if (participant.socketId === socketId) {
          participant.connected = false;
          return { sessionId: session.id, participant };
        }
      }
    }
    return null;
  }

  findParticipantBySocket(socketId) {
    for (const session of this.sessions.values()) {
      for (const participant of session.participants.values()) {
        if (participant.socketId === socketId) {
          return { session, participant };
        }
      }
    }
    return null;
  }

  getRoster(sessionId) {
    const session = this.get(sessionId);
    if (!session) return [];
    return Array.from(session.participants.values()).map((p) => ({
      visitorId: p.visitorId,
      nickname: p.nickname,
      connected: p.connected,
      joinedAt: p.joinedAt,
    }));
  }

  getStats() {
    let totalParticipants = 0;
    for (const session of this.sessions.values()) {
      totalParticipants += session.participants.size;
    }
    return {
      activeSessions: this.sessions.size,
      totalParticipants,
    };
  }

  cleanup() {
    const now = Date.now();
    const expired = [];
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTTLMs) {
        expired.push(id);
      }
    }
    return expired; // Caller handles disconnecting sockets
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
  }
}

function sanitize(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .slice(0, maxLen)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uniqueNickname(nickname, participants) {
  const clean = sanitize(nickname, 30) || 'Anonymous';
  const existing = new Set(
    Array.from(participants.values()).map((p) => p.nickname)
  );

  if (!existing.has(clean)) return clean;

  let suffix = 2;
  while (existing.has(`${clean}-${suffix}`)) {
    suffix++;
  }
  return `${clean}-${suffix}`;
}

module.exports = { SessionStore };
