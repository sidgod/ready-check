const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createReadyCheck, respond, endCheck, getSummary, getResults, getHistory } = require('../src/ready-check');

function makeSession() {
  return {
    id: 'test123',
    activeCheck: null,
    readyChecks: [],
    participants: new Map([
      ['v1', { visitorId: 'v1', nickname: 'Alice', connected: true }],
      ['v2', { visitorId: 'v2', nickname: 'Bob', connected: true }],
      ['v3', { visitorId: 'v3', nickname: 'Charlie', connected: true }],
    ]),
    settings: { defaultTimeout: 60 },
  };
}

describe('Ready Check', () => {
  let session;

  beforeEach(() => {
    session = makeSession();
  });

  describe('createReadyCheck', () => {
    it('creates a check with a label', () => {
      const check = createReadyCheck(session, { label: 'CLI setup?' });
      assert.equal(check.label, 'CLI setup?');
      assert.equal(check.status, 'active');
      assert.equal(check.timeoutSeconds, 60);
      assert.ok(session.activeCheck);
    });

    it('throws if a check is already active', () => {
      createReadyCheck(session);
      assert.throws(() => createReadyCheck(session), /already active/);
    });

    it('sanitizes label to max 200 chars', () => {
      const check = createReadyCheck(session, { label: 'x'.repeat(300) });
      assert.equal(check.label.length, 200);
    });
  });

  describe('respond', () => {
    it('records a response', () => {
      const check = createReadyCheck(session);
      const response = respond(session, { checkId: check.id, visitorId: 'v1', value: 'ready' });
      assert.equal(response.value, 'ready');
      assert.equal(response.nickname, 'Alice');
    });

    it('allows changing response (last-response-wins)', () => {
      const check = createReadyCheck(session);
      respond(session, { checkId: check.id, visitorId: 'v1', value: 'ready' });
      const updated = respond(session, { checkId: check.id, visitorId: 'v1', value: 'need_help' });
      assert.equal(updated.value, 'need_help');
      assert.equal(check.responses.size, 1); // Still just one entry
    });

    it('rejects invalid response values', () => {
      const check = createReadyCheck(session);
      assert.throws(
        () => respond(session, { checkId: check.id, visitorId: 'v1', value: 'maybe' }),
        /Invalid response/
      );
    });

    it('rejects responses after check ends', () => {
      const check = createReadyCheck(session);
      endCheck(session, 'completed');
      assert.throws(
        () => respond(session, { checkId: check.id, visitorId: 'v1', value: 'ready' }),
        /No active/
      );
    });
  });

  describe('getSummary', () => {
    it('returns correct counts', () => {
      const check = createReadyCheck(session);
      respond(session, { checkId: check.id, visitorId: 'v1', value: 'ready' });
      respond(session, { checkId: check.id, visitorId: 'v2', value: 'need_help' });

      const summary = getSummary(session);
      assert.equal(summary.ready, 1);
      assert.equal(summary.needHelp, 1);
      assert.equal(summary.noResponse, 1);
      assert.equal(summary.total, 3);
    });
  });

  describe('getResults', () => {
    it('includes all participants with no_response default', () => {
      const check = createReadyCheck(session);
      respond(session, { checkId: check.id, visitorId: 'v1', value: 'ready' });

      const results = getResults(check, session.participants);
      assert.equal(results.length, 3);
      assert.equal(results.find((r) => r.visitorId === 'v1').value, 'ready');
      assert.equal(results.find((r) => r.visitorId === 'v2').value, 'no_response');
    });
  });

  describe('getHistory', () => {
    it('returns history of all checks', () => {
      const check1 = createReadyCheck(session, { label: 'Check 1' });
      respond(session, { checkId: check1.id, visitorId: 'v1', value: 'ready' });
      endCheck(session, 'completed');

      const check2 = createReadyCheck(session, { label: 'Check 2' });
      endCheck(session, 'timed_out');

      const history = getHistory(session);
      assert.equal(history.length, 2);
      assert.equal(history[0].label, 'Check 1');
      assert.equal(history[0].status, 'completed');
      assert.equal(history[1].label, 'Check 2');
      assert.equal(history[1].status, 'timed_out');
    });
  });

  describe('endCheck', () => {
    it('marks check as completed and clears activeCheck', () => {
      const check = createReadyCheck(session);
      endCheck(session, 'completed');
      assert.equal(check.status, 'completed');
      assert.equal(session.activeCheck, null);
    });
  });
});
