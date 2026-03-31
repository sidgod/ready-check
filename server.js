const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const path = require('path');

const { SessionStore } = require('./src/session-store');
const socketHandlers = require('./src/socket-handlers');
const routes = require('./src/routes');
const mailer = require('./src/mailer');
const { securityHeaders, validateBaseUrl } = require('./src/security');

// Load .env in development
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch {
    // dotenv is optional
  }
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '4', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '100', 10);

// Initialize
const app = express();
const server = createServer(app);
// CORS: restrict to BASE_URL origin in production, allow localhost in dev
const allowedOrigins = process.env.BASE_URL
  ? [process.env.BASE_URL]
  : ['http://localhost:3000'];

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : allowedOrigins,
    credentials: true,
  },
  pingTimeout: 10000,
  pingInterval: 5000,
});

const store = new SessionStore({
  maxSessions: MAX_SESSIONS,
  sessionTTLMs: SESSION_TTL_HOURS * 60 * 60 * 1000,
});

// Validate BASE_URL on startup
if (process.env.BASE_URL && !validateBaseUrl(process.env.BASE_URL)) {
  console.error('[FATAL] Invalid BASE_URL — must be http:// or https://');
  process.exit(1);
}

// Middleware
app.use(securityHeaders);
app.use(express.json({ limit: '16kb' })); // Limit request body size
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize email transport
mailer.init();

// Setup routes and socket handlers
routes.setup(app, store);
socketHandlers.setup(io, store);

// Session cleanup with socket notification
setInterval(() => {
  const expired = store.cleanup();
  for (const sessionId of expired) {
    io.to(`session:${sessionId}`).emit('session:expired', {
      message: 'Session has expired due to inactivity',
    });
    store.delete(sessionId);
  }
}, 5 * 60 * 1000);

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Notify all connected clients
  for (const [sessionId] of store.sessions) {
    io.to(`session:${sessionId}`).emit('session:expired', {
      message: 'Server is shutting down',
    });
  }

  server.close(() => {
    store.destroy();
    console.log('Server closed.');
    process.exit(0);
  });

  // Force close after 5 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║         ready-check server            ║
  ║                                       ║
  ║   http://localhost:${PORT}              ║
  ║                                       ║
  ║   Max sessions: ${MAX_SESSIONS}                  ║
  ║   Session TTL:  ${SESSION_TTL_HOURS}h                     ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = { app, server, io, store };
