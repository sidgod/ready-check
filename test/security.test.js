const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCleanInput, isCleanMultilineInput, validateBaseUrl } = require('../src/security');

describe('Security — Input Validation', () => {
  describe('isCleanInput', () => {
    it('accepts normal text', () => {
      assert.equal(isCleanInput('Hello world'), true);
    });

    it('accepts Unicode text', () => {
      assert.equal(isCleanInput('Héllo wörld'), true);
    });

    it('rejects null bytes', () => {
      assert.equal(isCleanInput('hello\x00world'), false);
    });

    it('rejects newlines', () => {
      assert.equal(isCleanInput('line1\nline2'), false);
    });

    it('rejects non-string input', () => {
      assert.equal(isCleanInput(42), false);
      assert.equal(isCleanInput(null), false);
      assert.equal(isCleanInput(undefined), false);
    });

    it('accepts empty string', () => {
      assert.equal(isCleanInput(''), true);
    });
  });

  describe('isCleanMultilineInput', () => {
    it('accepts normal text', () => {
      assert.equal(isCleanMultilineInput('Hello world'), true);
    });

    it('accepts newlines and tabs', () => {
      assert.equal(isCleanMultilineInput('line1\nline2\ttabbed'), true);
    });

    it('accepts carriage return + newline (Windows)', () => {
      assert.equal(isCleanMultilineInput('line1\r\nline2'), true);
    });

    it('rejects null bytes', () => {
      assert.equal(isCleanMultilineInput('hello\x00world'), false);
    });

    it('rejects other control characters', () => {
      assert.equal(isCleanMultilineInput('hello\x01world'), false);
      assert.equal(isCleanMultilineInput('hello\x07world'), false);
    });

    it('rejects non-string input', () => {
      assert.equal(isCleanMultilineInput(42), false);
    });
  });

  describe('validateBaseUrl', () => {
    it('accepts https URLs', () => {
      assert.equal(validateBaseUrl('https://example.com'), true);
    });

    it('accepts http URLs', () => {
      assert.equal(validateBaseUrl('http://localhost:3000'), true);
    });

    it('rejects javascript: protocol', () => {
      assert.equal(validateBaseUrl('javascript:alert(1)'), false);
    });

    it('rejects ftp: protocol', () => {
      assert.equal(validateBaseUrl('ftp://example.com'), false);
    });

    it('accepts empty/null (falls back to request origin)', () => {
      assert.equal(validateBaseUrl(''), true);
      assert.equal(validateBaseUrl(null), true);
    });
  });
});
