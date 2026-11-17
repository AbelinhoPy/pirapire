// src/billing/paymentService.js - Payment Processing & Subscription Lifecycle
const crypto = require('crypto');
const { getDb } = require('../db/db');
const PRICING_CONFIG = require('./pricingConfig');
const { sendPurchaseReceiptEmail } = require('../email/emailService');

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'pirapire_sandbox_secret_2026';

/**
 * Creates a checkout order session for the user.
 */
function createCheckoutSession(userId, planCode = 'PRO') {
  const db = getDb();
  const plan = PRICING_CONFIG.plans[planCode];
  if (!plan || plan.pricePyg <= 0) {
    throw new Error('Plan seleccionado no válido para checkout de pago.');
  }

  const user = db.prepare('SELECT id, email, plan FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw new Error('Usuario no encontrado.');
  }

  const orderId = `PIR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO payment_transactions (user_id, order_id, amount_pyg, currency, status, provider, created_at)
    VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(userId, orderId, plan.pricePyg, PRICING_CONFIG.currency, 'PAGOPAR_SANDBOX', now);

  const expiresDate = new Date(now + plan.durationDays * 24 * 60 * 60 * 1000);

  return {
    orderId,
    amountPyg: plan.pricePyg,
    amountFormatted: plan.priceFormatted,
    currency: PRICING_CONFIG.currency,
    planCode: plan.code,
    planName: plan.name,
    environment: PRICING_CONFIG.environment,
    merchant: PRICING_CONFIG.merchant,
    accessDurationDays: plan.durationDays,
    effectiveAccessUntil: expiresDate.toLocaleDateString('es-PY'),
    checkoutUrl: `/checkout.html?orderId=${orderId}`,
    isProduction: PRICING_CONFIG.environment === 'PRODUCTION'
  };
}

/**
 * Generates an HMAC signature for testing webhook payloads
 */
function signWebhookPayload(payloadString) {
  const payloadStr = typeof payloadString === 'string' ? payloadString : JSON.stringify(payloadString);
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');
}

/**
 * Verifies and processes incoming webhook events with idempotency
 */
function handleWebhookEvent(eventPayload, signature) {
  const db = getDb();

  // Signature check
  const payloadStr = typeof eventPayload === 'string' ? eventPayload : JSON.stringify(eventPayload);
  const expectedSignature = signWebhookPayload(payloadStr);

  if (signature && signature !== expectedSignature) {
    throw new Error('Firma de webhook no válida. Evento rechazado por seguridad.');
  }

  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;
  const { eventType, orderId, idempotencyKey, amountPyg, paymentMethod } = payload;

  if (!orderId) {
    throw new Error('orderId ausente en el payload del webhook.');
  }

  // Idempotency check: if already processed successfully with this idempotency key or orderId
  const existingTx = db.prepare('SELECT * FROM payment_transactions WHERE order_id = ?').get(orderId);
  if (!existingTx) {
    throw new Error(`Transacción para orderId ${orderId} no registrada.`);
  }

  if (existingTx.status === 'REFUNDED') {
    return {
      success: false,
      duplicate: true,
      idempotentDuplicate: true,
      status: 'ALREADY_REFUNDED',
      message: 'Esta orden fue reembolsada previamente. Un evento tardío no puede reactivar el acceso.',
      orderId
    };
  }

  if (existingTx.status === 'SUCCESS' && eventType === 'PAYMENT_SUCCESS') {
    return {
      success: true,
      duplicate: true,
      idempotentDuplicate: true,
      status: 'ALREADY_PROCESSED',
      message: 'Evento duplicado ya procesado previamente. No se aplican cambios adicionales.',
      orderId
    };
  }

  const now = Date.now();
  const userId = existingTx.user_id;
  const durationMs = (PRICING_CONFIG.plans.PRO.durationDays || 30) * 24 * 60 * 60 * 1000;

  switch (eventType) {
    case 'PAYMENT_SUCCESS': {
      const expiresAt = now + durationMs;

      // Atomic transaction: update payment tx, upgrade user, upsert subscription
      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          UPDATE payment_transactions
          SET status = 'SUCCESS',
              idempotency_key = ?,
              payment_method = ?,
              payload_json = ?
          WHERE order_id = ?
        `).run(idempotencyKey || `idem_${orderId}`, paymentMethod || 'TARJETA_SIPAP', JSON.stringify(payload), orderId);

        db.prepare(`
          UPDATE users
          SET plan = 'PRO'
          WHERE id = ?
        `).run(userId);

        db.prepare(`
          INSERT INTO subscriptions (user_id, plan_code, status, amount_pyg, currency, billing_cycle, started_at, expires_at, cancel_at_period_end, created_at, updated_at)
          VALUES (?, 'PRO', 'ACTIVE', ?, 'PYG', '30_DAYS', ?, ?, 0, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            status = 'ACTIVE',
            expires_at = MAX(expires_at, excluded.started_at) + excluded.expires_at - excluded.started_at,
            cancel_at_period_end = 0,
            updated_at = excluded.updated_at
        `).run(userId, existingTx.amount_pyg, now, expiresAt, now, now);

        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }

      // Send confirmation email
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
      if (user) {
        sendPurchaseReceiptEmail(user.email, {
          orderId,
          planName: PRICING_CONFIG.plans.PRO.name,
          amountPyg: existingTx.amount_pyg,
          expiresAt: new Date(expiresAt).toLocaleDateString('es-PY')
        });
      }

      return {
        success: true,
        activated: true,
        status: 'ACTIVATED',
        plan: 'PRO',
        orderId,
        expiresAt: new Date(expiresAt).toISOString()
      };
    }

    case 'PAYMENT_FAILED': {
      db.prepare(`
        UPDATE payment_transactions
        SET status = 'FAILED', payload_json = ?
        WHERE order_id = ?
      `).run(JSON.stringify(payload), orderId);

      return { success: true, status: 'PAYMENT_FAILED', orderId };
    }

    case 'SUBSCRIPTION_RENEW': {
      const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
      const newExpiry = (sub ? Math.max(sub.expires_at, now) : now) + durationMs;

      db.prepare(`
        UPDATE subscriptions
        SET status = 'ACTIVE', expires_at = ?, updated_at = ?
        WHERE user_id = ?
      `).run(newExpiry, now, userId);

      return { success: true, status: 'RENEWED', expiresAt: new Date(newExpiry).toISOString() };
    }

    case 'SUBSCRIPTION_CANCEL': {
      db.prepare(`
        UPDATE subscriptions
        SET cancel_at_period_end = 1, updated_at = ?
        WHERE user_id = ?
      `).run(now, userId);

      return { success: true, status: 'CANCELLATION_SCHEDULED' };
    }

    case 'PAYMENT_REFUNDED': {
      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          UPDATE payment_transactions
          SET status = 'REFUNDED', payload_json = ?
          WHERE order_id = ?
        `).run(JSON.stringify(payload), orderId);

        db.prepare(`
          UPDATE subscriptions
          SET status = 'EXPIRED', updated_at = ?
          WHERE user_id = ?
        `).run(now, userId);

        db.prepare(`
          UPDATE users
          SET plan = 'FREE'
          WHERE id = ?
        `).run(userId);

        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }

      return { success: true, status: 'REFUNDED' };
    }

    default:
      throw new Error(`Tipo de evento no reconocido: ${eventType}`);
  }
}

/**
 * Returns user subscription details, remaining days, and receipts
 */
function getUserSubscriptionDetails(userId) {
  const db = getDb();
  const user = db.prepare('SELECT id, email, plan FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Usuario no encontrado.');

  const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  const receipts = db.prepare(`
    SELECT order_id, amount_pyg, currency, status, payment_method, created_at
    FROM payment_transactions
    WHERE user_id = ? AND status = 'SUCCESS'
    ORDER BY created_at DESC
  `).all(userId);

  const now = Date.now();
  const isPro = user.plan === 'PRO';
  let isActive = false;
  let expiresAtDate = null;
  let remainingDays = 0;
  let cancelAtPeriodEnd = false;

  if (isPro && sub) {
    if (sub.expires_at > now && sub.status !== 'EXPIRED') {
      isActive = true;
      expiresAtDate = new Date(sub.expires_at).toISOString();
      remainingDays = Math.max(0, Math.ceil((sub.expires_at - now) / (1000 * 60 * 60 * 24)));
      cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
    } else {
      // Lazy expiration sync
      db.prepare("UPDATE users SET plan = 'FREE' WHERE id = ?").run(userId);
      db.prepare("UPDATE subscriptions SET status = 'EXPIRED' WHERE user_id = ?").run(userId);
      user.plan = 'FREE';
    }
  }

  return {
    plan: user.plan,
    isActive,
    expiresAt: expiresAtDate,
    expiresAtFormatted: expiresAtDate ? new Date(expiresAtDate).toLocaleDateString('es-PY') : null,
    remainingDays,
    cancelAtPeriodEnd,
    canDownloadDesktop: user.plan === 'PRO' && isActive,
    receipts: receipts.map(r => ({
      orderId: r.order_id,
      amountFormatted: `₲ ${Number(r.amount_pyg).toLocaleString('es-PY')}`,
      status: r.status,
      date: new Date(r.created_at).toLocaleDateString('es-PY')
    }))
  };
}

module.exports = {
  createCheckoutSession,
  handleWebhookEvent,
  signWebhookPayload,
  getUserSubscriptionDetails
};
