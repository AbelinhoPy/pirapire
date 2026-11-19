// tests/billing.test.js - Pro Billing, Webhook Idempotency & Lifecycle Tests
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'test_billing.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_PATH = TEST_DB_PATH;

const { registerUser } = require('../src/auth/authService');
const {
  createCheckoutSession,
  handleWebhookEvent,
  signWebhookPayload,
  getUserSubscriptionDetails
} = require('../src/billing/paymentService');
const PRICING_CONFIG = require('../src/billing/pricingConfig');

test('Billing & Webhook Lifecycle: Checkout -> Success -> Idempotent Duplicate -> Cancel -> Refund', async () => {
  // 1. Single Source of Truth Validation
  assert.strictEqual(PRICING_CONFIG.currency, 'PYG');
  assert.strictEqual(PRICING_CONFIG.plans.PRO.pricePyg, 190000);
  assert.strictEqual(PRICING_CONFIG.plans.PRO.durationDays, 30);
  assert.ok(PRICING_CONFIG.merchant.legalTerms.framework.includes('Ley N° 4868/13'));

  // Create test user
  const user = await registerUser('cliente.pro@pirapire.py', 'ClaveSegura2026!', true, 'http://localhost:3000');

  // 2. Checkout session creation
  const session = createCheckoutSession(user.userId, 'PRO');
  assert.ok(session.orderId.startsWith('PIR-'));
  assert.strictEqual(session.amountPyg, 190000);
  assert.strictEqual(session.currency, 'PYG');
  assert.strictEqual(session.merchant.name, PRICING_CONFIG.merchant.name);
  assert.strictEqual(session.accessDurationDays, 30);

  // 3. Webhook: PAYMENT_SUCCESS
  const webhookPayload = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: session.orderId,
    idempotencyKey: `idem_test_${session.orderId}`,
    amountPyg: 190000,
    paymentMethod: 'TARJETA_SIPAP'
  };
  const payloadStr = JSON.stringify(webhookPayload);
  const validSignature = signWebhookPayload(payloadStr);

  const activationRes = handleWebhookEvent(webhookPayload, validSignature);
  assert.strictEqual(activationRes.success, true);
  assert.strictEqual(activationRes.status, 'ACTIVATED');
  assert.strictEqual(activationRes.plan, 'PRO');

  // Verify user is now PRO
  let subDetails = getUserSubscriptionDetails(user.userId);
  assert.strictEqual(subDetails.plan, 'PRO');
  assert.strictEqual(subDetails.isActive, true);
  assert.strictEqual(subDetails.remainingDays, 30);
  assert.strictEqual(subDetails.canDownloadDesktop, true);
  assert.strictEqual(subDetails.receipts.length, 1);

  // 4. Test Idempotency: Re-deliver the exact same webhook event
  const duplicateRes = handleWebhookEvent(webhookPayload, validSignature);
  assert.strictEqual(duplicateRes.success, true);
  assert.strictEqual(duplicateRes.idempotentDuplicate, true);

  // Remaining days MUST still be 30 (not 60)
  subDetails = getUserSubscriptionDetails(user.userId);
  assert.strictEqual(subDetails.remainingDays, 30);
  assert.strictEqual(subDetails.receipts.length, 1, 'Duplicate transaction row created!');

  // 5. Subscription Cancellation
  const cancelPayload = {
    eventType: 'SUBSCRIPTION_CANCEL',
    orderId: session.orderId
  };
  const cancelRes = handleWebhookEvent(cancelPayload, signWebhookPayload(JSON.stringify(cancelPayload)));
  assert.strictEqual(cancelRes.status, 'CANCELLATION_SCHEDULED');

  subDetails = getUserSubscriptionDetails(user.userId);
  assert.strictEqual(subDetails.cancelAtPeriodEnd, true);
  // User still retains PRO access until end of the 30-day period!
  assert.strictEqual(subDetails.isActive, true);
  assert.strictEqual(subDetails.canDownloadDesktop, true);

  // 6. Webhook: PAYMENT_REFUNDED
  const refundPayload = {
    eventType: 'PAYMENT_REFUNDED',
    orderId: session.orderId
  };
  const refundRes = handleWebhookEvent(refundPayload, signWebhookPayload(JSON.stringify(refundPayload)));
  assert.strictEqual(refundRes.status, 'REFUNDED');

  subDetails = getUserSubscriptionDetails(user.userId);
  assert.strictEqual(subDetails.plan, 'FREE');
  assert.strictEqual(subDetails.isActive, false);
  assert.strictEqual(subDetails.canDownloadDesktop, false);
});
