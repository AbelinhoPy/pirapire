// src/routes/billingRoutes.js - Billing & Payments Router
const express = require('express');
const router = express.Router();
const PRICING_CONFIG = require('../billing/pricingConfig');
const {
  createCheckoutSession,
  handleWebhookEvent,
  getUserSubscriptionDetails,
  simulateSandboxPayment
} = require('../billing/paymentService');
const { requireAuth } = require('../auth/authMiddleware');
const { getDb } = require('../db/db');

// GET /api/billing/plans - Single source of truth for Plans
router.get('/plans', (req, res) => {
  res.json({
    success: true,
    currency: PRICING_CONFIG.currency,
    currencySymbol: PRICING_CONFIG.currencySymbol,
    plans: PRICING_CONFIG.plans,
    merchant: PRICING_CONFIG.merchant,
    environment: PRICING_CONFIG.environment
  });
});

// POST /api/billing/checkout - Initiate payment
router.post('/checkout', requireAuth, (req, res) => {
  try {
    const { planCode = 'PRO' } = req.body;
    const session = createCheckoutSession(req.user.id, planCode);
    res.json({ success: true, session });
  } catch (err) {
    res.status(400).json({ error: 'CHECKOUT_FAILED', message: err.message });
  }
});

// POST /api/billing/sandbox/simulate-payment - Server-side simulated payment confirmation
router.post('/sandbox/simulate-payment', requireAuth, (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'MISSING_ORDER_ID', message: 'orderId es requerido.' });
    }
    const result = simulateSandboxPayment(orderId, req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: 'SIMULATION_FAILED', message: err.message });
  }
});

// POST /api/billing/webhook - Payment provider webhook
router.post('/webhook', (req, res) => {
  try {
    const signature = req.headers['x-pirapire-signature'] || req.headers['x-signature'];
    const result = handleWebhookEvent(req.body, signature);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'WEBHOOK_FAILED', message: err.message });
  }
});

// GET /api/billing/subscription - User subscription details
router.get('/subscription', requireAuth, (req, res) => {
  try {
    const details = getUserSubscriptionDetails(req.user.id);
    res.json({ success: true, ...details });
  } catch (err) {
    res.status(400).json({ error: 'SUBSCRIPTION_FETCH_FAILED', message: err.message });
  }
});

// POST /api/billing/cancel - Schedule subscription cancellation
router.post('/cancel', requireAuth, (req, res) => {
  try {
    const db = getDb();
    db.prepare(`
      UPDATE subscriptions
      SET cancel_at_period_end = 1, updated_at = ?
      WHERE user_id = ?
    `).run(Date.now(), req.user.id);

    const updated = getUserSubscriptionDetails(req.user.id);
    res.json({
      success: true,
      message: 'Suscripción cancelada. Conservarás tu acceso Pro hasta el vencimiento del período pagado.',
      ...updated
    });
  } catch (err) {
    res.status(400).json({ error: 'CANCEL_FAILED', message: err.message });
  }
});

// GET /api/billing/receipt/:orderId - Protected single receipt with IDOR guard
router.get('/receipt/:orderId', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const tx = db.prepare('SELECT * FROM payment_transactions WHERE order_id = ?').get(req.params.orderId);
    if (!tx) {
      return res.status(404).json({ error: 'RECEIPT_NOT_FOUND', message: 'Comprobante no encontrado.' });
    }
    if (tx.user_id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'No tenés permisos para ver este comprobante ajeno.' });
    }
    res.json({
      success: true,
      receipt: {
        orderId: tx.order_id,
        merchant: PRICING_CONFIG.merchant,
        amountPyg: tx.amount_pyg,
        amountFormatted: `₲ ${Number(tx.amount_pyg).toLocaleString('es-PY')}`,
        currency: tx.currency,
        status: tx.status,
        paymentMethod: tx.payment_method,
        createdAt: tx.created_at,
        dateFormatted: new Date(tx.created_at).toLocaleDateString('es-PY', { day: '2-digit', month: 'long', year: 'numeric' })
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'RECEIPT_FETCH_ERROR', message: err.message });
  }
});

module.exports = router;
