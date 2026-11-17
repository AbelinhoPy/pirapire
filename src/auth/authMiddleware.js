// src/auth/authMiddleware.js - Endpoint Authorization Guards
const { verifySessionToken, getUserProfile } = require('./authService');

function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.headers['x-session-token']) {
    return req.headers['x-session-token'].trim();
  }
  // Check cookie if present
  if (req.headers['cookie']) {
    const match = req.headers['cookie'].match(/pirapire_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  const userId = verifySessionToken(token);
  if (!userId) {
    req.user = null;
    return next();
  }

  const profile = getUserProfile(userId);
  req.user = profile;
  next();
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'AUTH_REQUIRED',
      message: 'Necesitás iniciar sesión para realizar esta acción.',
      redirectUrl: '/login.html'
    });
  }

  const userId = verifySessionToken(token);
  if (!userId) {
    return res.status(401).json({
      error: 'INVALID_SESSION',
      message: 'Tu sesión expiró o no es válida. Por favor ingresá nuevamente.',
      redirectUrl: '/login.html'
    });
  }

  const profile = getUserProfile(userId);
  if (!profile) {
    return res.status(401).json({
      error: 'USER_NOT_FOUND',
      message: 'Usuario no encontrado.'
    });
  }

  req.user = profile;
  next();
}

function requirePro(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.plan !== 'PRO') {
      return res.status(403).json({
        error: 'UPGRADE_REQUIRED',
        message: 'Esta función requiere una suscripción activa a Pirapire Pro.',
        currentPlan: req.user.plan,
        upgradeUrl: '/planes.html'
      });
    }
    next();
  });
}

module.exports = {
  extractToken,
  optionalAuth,
  requireAuth,
  requirePro
};
