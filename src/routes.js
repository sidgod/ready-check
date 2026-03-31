const express = require('express');
const QRCode = require('qrcode');
const auth = require('./auth');
const path = require('path');
const metrics = require('./metrics');

function setup(app, store) {
  const router = express.Router();

  // --- Auth Routes ---

  router.post('/api/auth/register', async (req, res) => {
    try {
      const result = await auth.register(req.body.email);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/auth/verify', async (req, res) => {
    try {
      const { token } = await auth.verify(req.body.email, req.body.pin);
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
      res.json({ authenticated: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/api/auth/status', (req, res) => {
    const token = req.cookies?.auth_token;
    if (!token) {
      return res.json({ authenticated: false });
    }
    const payload = auth.verifyToken(token);
    res.json({ authenticated: !!payload });
  });

  router.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ authenticated: false });
  });

  // --- Session Routes ---

  router.post('/api/sessions', auth.authMiddleware, async (req, res) => {
    try {
      const session = store.create({
        name: req.body.name,
        facilitatorEmail: req.facilitator.emailHash,
        defaultTimeout: req.body.defaultTimeout,
      });

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const joinUrl = `${baseUrl}/session/${session.id}`;
      const facilitateUrl = `${baseUrl}/session/${session.id}/facilitate`;

      metrics.inc('sessionsCreated');

      const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });

      res.json({
        sessionId: session.id,
        name: session.name,
        joinUrl,
        facilitateUrl,
        qrCodeDataUrl,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/api/sessions/:id/qr', auth.authMiddleware, async (req, res) => {
    const session = store.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify facilitator owns this session
    if (session.facilitatorEmail !== req.facilitator.emailHash) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }

    try {
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const joinUrl = `${baseUrl}/session/${session.id}`;
      const qrBuffer = await QRCode.toBuffer(joinUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });
      res.set('Content-Type', 'image/png');
      res.send(qrBuffer);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  });

  // Public endpoint — only expose what participants need (name for display)
  router.get('/api/sessions/:id', (req, res) => {
    const session = store.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      sessionId: session.id,
      name: session.name,
    });
  });

  // --- Health Check ---

  router.get('/health', (req, res) => {
    const stats = store.getStats();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      ...stats,
    });
  });

  // --- Usage Metrics (auth required) ---

  router.get('/api/metrics', auth.authMiddleware, (req, res) => {
    res.json(metrics.snapshot(store));
  });

  // --- Page Routes ---

  router.get('/session/:id', (req, res) => {
    // Verify session exists
    const session = store.get(req.params.id);
    if (!session) {
      return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'not-found.html'));
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'join.html'));
  });

  router.get('/session/:id/facilitate', (req, res) => {
    const session = store.get(req.params.id);
    if (!session) {
      return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'not-found.html'));
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'facilitate.html'));
  });

  app.use(router);
}

module.exports = { setup };
