/**
 * Security middleware and utilities for ready-check.
 * Addresses OWASP A05:2021 (Security Misconfiguration) and A04:2021 (Insecure Design).
 */

// --- Security Headers Middleware (A05) ---

function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS protection for legacy browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy — don't leak session IDs in referrer headers
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy — disable unnecessary browser features
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for inline styles in CSS
      "img-src 'self' data:",              // data: needed for QR code data URLs
      "connect-src 'self' ws: wss:",       // WebSocket connections
      "font-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  // HSTS — only in production (behind HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

// --- Socket.IO Rate Limiter (A04) ---

const socketRateLimits = new Map();
const RATE_LIMITS = {
  respond: { max: 5, windowMs: 1000 },     // 5 responses per second
  'create-check': { max: 1, windowMs: 2000 }, // 1 check per 2 seconds
  'end-check': { max: 1, windowMs: 2000 },
  join: { max: 3, windowMs: 5000 },           // 3 joins per 5 seconds
};

function socketRateLimiter(socket, eventName) {
  const limit = RATE_LIMITS[eventName];
  if (!limit) return true; // No rate limit defined for this event

  const key = `${socket.id}:${eventName}`;
  const now = Date.now();

  if (!socketRateLimits.has(key)) {
    socketRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }

  const record = socketRateLimits.get(key);

  if (now - record.windowStart > limit.windowMs) {
    record.count = 1;
    record.windowStart = now;
    return true;
  }

  record.count++;
  if (record.count > limit.max) {
    return false; // Rate limited
  }

  return true;
}

function cleanupSocketRateLimit(socketId) {
  for (const key of socketRateLimits.keys()) {
    if (key.startsWith(socketId + ':')) {
      socketRateLimits.delete(key);
    }
  }
}

// --- Input Validation (A03) ---

const PRINTABLE_REGEX = /^[\x20-\x7E\u00A0-\uFFFF]*$/;

function isCleanInput(str) {
  if (typeof str !== 'string') return false;
  // Reject control characters (except common whitespace)
  return PRINTABLE_REGEX.test(str);
}

// --- BASE_URL Validation (A10) ---

function validateBaseUrl(url) {
  if (!url) return true; // Will fall back to request origin
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = {
  securityHeaders,
  socketRateLimiter,
  cleanupSocketRateLimit,
  isCleanInput,
  validateBaseUrl,
};
