// src/routes/authRoutes.js - Authentication & Account Router
const express = require('express');
const router = express.Router();
const {
  registerUser,
  verifyEmailToken,
  loginUser,
  requestPasswordReset,
  resetPasswordWithToken,
  getUserProfile
} = require('../auth/authService');
const { requireAuth } = require('../auth/authMiddleware');
const { getRecentOutbox } = require('../email/emailService');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, marketingOptIn } = req.body;
    const appBaseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await registerUser(email, password, marketingOptIn, appBaseUrl);
    res.status(201).json({
      success: true,
      message: 'Cuenta creada. Enviamos un enlace de confirmación a tu correo.',
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: 'REGISTRATION_FAILED', message: err.message });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', (req, res) => {
  try {
    const { token } = req.body;
    const result = verifyEmailToken(token);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'VERIFICATION_FAILED', message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const result = loginUser(email, password);
    res.json({
      success: true,
      message: 'Ingreso exitoso.',
      ...result
    });
  } catch (err) {
    res.status(401).json({ error: 'LOGIN_FAILED', message: err.message });
  }
});

// POST /api/auth/request-reset
router.post('/request-reset', (req, res) => {
  try {
    const { email } = req.body;
    const appBaseUrl = `${req.protocol}://${req.get('host')}`;
    const result = requestPasswordReset(email, appBaseUrl);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'REQUEST_RESET_FAILED', message: err.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const result = resetPasswordWithToken(token, newPassword);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'RESET_PASSWORD_FAILED', message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// GET /api/auth/outbox (dev helper for previewing verification/reset emails)
router.get('/outbox', (req, res) => {
  const emails = getRecentOutbox(20);
  res.json({ success: true, emails });
});

module.exports = router;
