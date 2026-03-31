const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore } = require('../src/session-store');

let store;

beforeEach(() => {
  store = new SessionStore({ maxSessions: 5, sessionTTLMs: 1000 });
});

after(() => {
  if (store) store.destroy();
});

describe('SessionStore', () => {
  describe('create', () => {
    it('creates a session with an 8-char ID', () => {
      const session = store.create({ name: 'Test', facilitatorEmail: 'hash1' });
      assert.equal(session.id.length, 8);
      assert.equal(session.name, 'Test');
      assert.equal(session.facilitatorEmail, 'hash1');
    });

    it('enforces max sessions', () => {
      for (let i = 0; i < 5; i++) {
        store.create({ facilitatorEmail: 'hash' });
      }
      assert.throws(() => store.create({ facilitatorEmail: 'hash' }), /Maximum/);
    });

    it('sanitizes name to max 100 chars', () => {
      const longName = 'x'.repeat(200);
      const session = store.create({ name: longName, facilitatorEmail: 'hash' });
      assert.equal(session.name.length, 100);
    });
  });

  describe('addParticipant', () => {
    it('adds a participant to a session', () => {
      const session = store.create({ facilitatorEmail: 'hash' });
      const p = store.addParticipant(session.id, {
        visitorId: 'v1',
        socketId: 's1',
        nickname: 'Alice',
      });
      assert.equal(p.nickname, 'Alice');
      assert.equal(p.connected, true);
    });

    it('auto-suffixes duplicate nicknames', () => {
      const session = store.create({ facilitatorEmail: 'hash' });
      store.addParticipant(session.id, { visitorId: 'v1', socketId: 's1', nickname: 'Alice' });
      const p2 = store.addParticipant(session.id, { visitorId: 'v2', socketId: 's2', nickname: 'Alice' });
      assert.equal(p2.nickname, 'Alice-2');
    });

    it('reconnects existing participant by visitorId', () => {
      const session = store.create({ facilitatorEmail: 'hash' });
      store.addParticipant(session.id, { visitorId: 'v1', socketId: 's1', nickname: 'Alice' });
      store.removeParticipant(session.id, 'v1');

      const p = store.addParticipant(session.id, { visitorId: 'v1', socketId: 's2', nickname: 'Alice' });
      assert.equal(p.socketId, 's2');
      assert.equal(p.connected, true);
      assert.equal(session.participants.size, 1); // No duplicate
    });
  });

  describe('getRoster', () => {
    it('returns participant list without internal fields', () => {
      const session = store.create({ facilitatorEmail: 'hash' });
      store.addParticipant(session.id, { visitorId: 'v1', socketId: 's1', nickname: 'Alice' });
      const roster = store.getRoster(session.id);
      assert.equal(roster.length, 1);
      assert.equal(roster[0].nickname, 'Alice');
      assert.equal(roster[0].socketId, undefined); // Not exposed
    });
  });

  describe('cleanup', () => {
    it('returns expired session IDs', async () => {
      const session = store.create({ facilitatorEmail: 'hash' });
      // Wait for TTL to expire (1 second)
      await new Promise((r) => setTimeout(r, 1100));
      const expired = store.cleanup();
      assert.ok(expired.includes(session.id));
    });
  });
});
