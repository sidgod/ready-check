const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mailer = require('./mailer');

// In-memory facilitator store: hash(email) -> { hashedPin, expiresAt, verified, attempts }
const facilitators = new Map();

// Rate limiting: email -> { count, windowStart }
const rateLimits = new Map();

const PIN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PIN_REQUESTS = 3; // per hour per email
const MAX_VERIFY_ATTEMPTS = 3; // per PIN
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const TOKEN_EXPIRY = '24h';

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function generatePIN() {
  return String(crypto.randomInt(100000, 999999));
}

function getSecret() {
  return process.env.AUTH_SECRET || 'dev-secret-change-me';
}

function isRateLimited(emailHash) {
  const now = Date.now();
  const limit = rateLimits.get(emailHash);

  if (!limit || now - limit.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(emailHash, { count: 1, windowStart: now });
    return false;
  }

  if (limit.count >= MAX_PIN_REQUESTS) {
    return true;
  }

  limit.count++;
  return false;
}

async function register(email) {
  if (!email || !isValidEmail(email)) {
    throw new Error('Valid email address is required');
  }

  const emailHash = hashEmail(email);

  if (isRateLimited(emailHash)) {
    throw new Error('Too many PIN requests. Please try again later.');
  }

  const pin = generatePIN();
  const hashedPin = await bcrypt.hash(pin, 10);

  facilitators.set(emailHash, {
    hashedPin,
    expiresAt: Date.now() + PIN_EXPIRY_MS,
    verified: false,
    attempts: 0,
  });

  await mailer.sendPIN(email, pin);

  return { message: 'PIN sent to your email' };
}

async function verify(email, pin) {
  if (!email || !pin) {
    throw new Error('Email and PIN are required');
  }

  const emailHash = hashEmail(email);
  const record = facilitators.get(emailHash);

  if (!record) {
    throw new Error('No PIN request found. Please register first.');
  }

  if (Date.now() > record.expiresAt) {
    facilitators.delete(emailHash);
    throw new Error('PIN has expired. Please request a new one.');
  }

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    facilitators.delete(emailHash);
    throw new Error('Too many failed attempts. Please request a new PIN.');
  }

  record.attempts++;

  const match = await bcrypt.compare(pin, record.hashedPin);
  if (!match) {
    throw new Error('Invalid PIN');
  }

  record.verified = true;

  const token = jwt.sign({ emailHash }, getSecret(), {
    expiresIn: TOKEN_EXPIRY,
  });

  return { token, emailHash };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.facilitator = payload;
  next();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = {
  register,
  verify,
  verifyToken,
  authMiddleware,
  hashEmail,
};
