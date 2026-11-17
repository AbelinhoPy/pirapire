// src/auth/authService.js - Native Node Crypto Authentication Service
const crypto = require('crypto');
const { getDb } = require('../db/db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../email/emailService');

const AUTH_SECRET = process.env.AUTH_SECRET || 'pirapire_auth_secret_key_2026';
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derivedKey = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  return crypto.timingSafeEqual(derivedKey, keyBuffer);
}

function generateSessionToken(userId) {
  const payload = `${userId}:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

function verifySessionToken(tokenString) {
  try {
    const raw = Buffer.from(tokenString, 'base64url').toString('utf8');
    const [userIdStr, timestampStr, signature] = raw.split(':');
    if (!userIdStr || !timestampStr || !signature) return null;

    const payload = `${userIdStr}:${timestampStr}`;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    const timestamp = parseInt(timestampStr, 10);
    if (Date.now() - timestamp > TOKEN_EXPIRY_MS) {
      return null; // Expired
    }

    return parseInt(userIdStr, 10);
  } catch (err) {
    return null;
  }
}

async function registerUser(email, password, marketingOptIn = true, appBaseUrl) {
  const db = getDb();
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Ingresá una dirección de correo electrónico válida.');
  }
  if (!password || password.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    throw new Error('Ya existe una cuenta registrada con este correo electrónico.');
  }

  const passwordHash = hashPassword(password);
  const verificationToken = crypto.randomBytes(24).toString('hex');
  const now = Date.now();

  const info = db.prepare(`
    INSERT INTO users (email, password_hash, email_verified, verification_token, plan, role, marketing_opt_in, created_at)
    VALUES (?, ?, 0, ?, 'FREE', 'USER', ?, ?)
  `).run(cleanEmail, passwordHash, verificationToken, marketingOptIn ? 1 : 0, now);

  const userId = Number(info.lastInsertRowid);

  // Send verification email
  sendVerificationEmail(cleanEmail, verificationToken, appBaseUrl);

  const sessionToken = generateSessionToken(userId);

  return {
    userId,
    email: cleanEmail,
    emailVerified: false,
    verificationToken,
    sessionToken,
    plan: 'FREE'
  };
}

function verifyEmailToken(token) {
  const db = getDb();
  if (!token) throw new Error('Token de verificación no proporcionado.');

  const user = db.prepare('SELECT id, email FROM users WHERE verification_token = ?').get(token);
  if (!user) {
    throw new Error('El enlace de verificación no es válido o ya fue utilizado.');
  }

  db.prepare(`
    UPDATE users
    SET email_verified = 1, verification_token = NULL
    WHERE id = ?
  `).run(user.id);

  const sessionToken = generateSessionToken(user.id);
  return {
    success: true,
    userId: user.id,
    email: user.email,
    sessionToken,
    message: '¡Correo verificado con éxito! Tus 5 pruebas gratuitas ya están disponibles.'
  };
}

function loginUser(email, password) {
  const db = getDb();
  const cleanEmail = (email || '').trim().toLowerCase();

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('Credenciales incorrectas. Verificá tu correo y contraseña.');
  }

  const sessionToken = generateSessionToken(user.id);

  return {
    userId: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    plan: user.plan,
    role: user.role,
    sessionToken
  };
}

function requestPasswordReset(email, appBaseUrl) {
  const db = getDb();
  const cleanEmail = (email || '').trim().toLowerCase();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(cleanEmail);

  if (!user) {
    // Return success to avoid email enumeration attacks
    return { success: true, message: 'Si el correo está registrado, enviamos el enlace de restablecimiento.' };
  }

  const resetToken = crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + 60 * 60 * 1000; // 1 hour

  db.prepare(`
    UPDATE users
    SET reset_token = ?, reset_token_expires = ?
    WHERE id = ?
  `).run(resetToken, expires, user.id);

  sendPasswordResetEmail(cleanEmail, resetToken, appBaseUrl);

  return {
    success: true,
    resetToken, // for testing purposes
    message: 'Te enviamos las instrucciones a tu correo para restablecer tu contraseña.'
  };
}

function resetPasswordWithToken(token, newPassword) {
  const db = getDb();
  if (!token) throw new Error('Token de recuperación no válido.');
  if (!newPassword || newPassword.length < 6) {
    throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
  }

  const now = Date.now();
  const user = db.prepare(`
    SELECT id, email, reset_token_expires
    FROM users
    WHERE reset_token = ?
  `).get(token);

  if (!user || user.reset_token_expires < now) {
    throw new Error('El enlace de restablecimiento expiró o no es válido.');
  }

  const newHash = hashPassword(newPassword);
  db.prepare(`
    UPDATE users
    SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL
    WHERE id = ?
  `).run(newHash, user.id);

  const sessionToken = generateSessionToken(user.id);
  return {
    success: true,
    userId: user.id,
    email: user.email,
    sessionToken,
    message: 'Contraseña actualizada correctamente. Ya podés acceder a tu cuenta.'
  };
}

function getUserProfile(userId) {
  const db = getDb();
  const user = db.prepare(`
    SELECT id, email, email_verified, plan, role, created_at
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) return null;

  // Count completed backtests
  const completedBacktests = db.prepare(`
    SELECT COUNT(*) as count
    FROM quota_reservations
    WHERE user_id = ? AND status = 'COMPLETED'
  `).get(userId).count;

  const remainingFreeTests = Math.max(0, 5 - completedBacktests);

  // Count completed football queries
  const completedFootballQueries = db.prepare(`
    SELECT COUNT(*) as count
    FROM football_quota_reservations
    WHERE user_id = ? AND status = 'COMPLETED'
  `).get(userId).count;

  const remainingFootballQueries = Math.max(0, 1 - completedFootballQueries);

  // Fetch subscription info
  const sub = db.prepare(`
    SELECT id, plan_code, status, amount_pyg, currency, started_at, expires_at, cancel_at_period_end
    FROM subscriptions
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(userId);

  // Fetch recent invoices
  const invoices = db.prepare(`
    SELECT id, order_id, amount_pyg, currency, status, payment_method, created_at
    FROM payment_transactions
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 10
  `).all(userId);

  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    plan: user.plan,
    role: user.role,
    createdAt: user.created_at,
    completedBacktests,
    remainingFreeTests: user.plan === 'PRO' ? 'Ilimitados' : remainingFreeTests,
    canRunBacktest: user.plan === 'PRO' || remainingFreeTests > 0,
    completedFootballQueries,
    remainingFootballQueries: user.plan === 'PRO' ? 'Ilimitadas' : remainingFootballQueries,
    canConsultFootball: user.plan === 'PRO' || remainingFootballQueries > 0,
    canDownloadDesktop: user.plan === 'PRO',
    subscription: sub ? {
      planCode: sub.plan_code,
      status: sub.status,
      expiresAt: sub.expires_at,
      expiresAtFormatted: new Date(sub.expires_at).toLocaleDateString('es-PY', { day: '2-digit', month: 'long', year: 'numeric' }),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      amountFormatted: `₲ ${Number(sub.amount_pyg).toLocaleString('es-PY')}`
    } : null,
    invoices: invoices.map(inv => ({
      ...inv,
      amountFormatted: `₲ ${Number(inv.amount_pyg).toLocaleString('es-PY')}`,
      dateFormatted: new Date(inv.created_at).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }))
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  verifySessionToken,
  registerUser,
  verifyEmailToken,
  loginUser,
  requestPasswordReset,
  resetPasswordWithToken,
  getUserProfile
};
