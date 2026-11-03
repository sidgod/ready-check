const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/auth');
const mailer = require('../src/mailer');

describe('Auth', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('register', () => {
    it('reports success when the PIN is sent', async () => {
      mock.method(mailer, 'sendPIN', async () => {});

      const result = await auth.register('sent@example.com');

      assert.equal(result.message, 'PIN sent to your email');
    });

    it('hides mail transport errors from the caller and logs them', async () => {
      const smtpMessage =
        'Message failed: 554 Message rejected: Email address is not verified.';
      mock.method(mailer, 'sendPIN', async () => {
        throw new Error(smtpMessage);
      });
      const logged = mock.method(console, 'error', () => {});

      await assert.rejects(
        () => auth.register('rejected@example.com'),
        (err) => {
          assert.equal(err.message, 'Unable to send PIN. Please try again later.');
          return true;
        }
      );

      assert.equal(logged.mock.callCount(), 1);
      assert.match(logged.mock.calls[0].arguments.join(' '), /554 Message rejected/);
    });

    it('still reports validation errors to the caller', async () => {
      await assert.rejects(
        () => auth.register('not-an-email'),
        /Valid email address is required/
      );
    });
  });
});
