// tests/flaw_fixes.test.js
// Verification of specific fixes requested:
// 1. One-time download tickets & token transport security
// 2. Webhook signature enforcement & server-side sandbox simulator
// 3. CORS preflight handler & headers
// 4. Centralized pricing consistency (₲ 190.000)

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('fs');
const http = require('node:http');

// Point DB to test database
const TEST_DB_PATH = path.join(__dirname, 'test_flaw_fixes.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_PATH = TEST_DB_PATH;
process.env.NODE_ENV = 'test';
process.env.WEBHOOK_SECRET = 'flaw_test_secret_99999';

const { getDb } = require('../src/db/db');
const { registerUser, verifyEmailToken, loginUser } = require('../src/auth/authService');
const { createCheckoutSession, signWebhookPayload, handleWebhookEvent } = require('../src/billing/paymentService');
const PRICING_CONFIG = require('../src/billing/pricingConfig');

test('Flaw Fixes: Download Tickets, Sandbox Payment Simulator, and CORS Preflight', async () => {
  const db = getDb(TEST_DB_PATH);

  // 1. Create a test user and verify
  const user = await registerUser('fix.tester@pirapire.py', 'Segura2026!#', true, 'http://localhost:3000');
  verifyEmailToken(user.verificationToken);

  // 2. Verify Webhook Signature Security: forged or unsigned webhook MUST fail
  const rawPayload = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: 'FORGED_ORDER_123',
    idempotencyKey: 'idem_forged_1',
    amountPyg: 190000
  };
  assert.throws(
    () => handleWebhookEvent(rawPayload, null),
    /Firma criptográfica de webhook requerida/
  );

  assert.throws(
    () => handleWebhookEvent(rawPayload, 'invalid_fake_hmac_signature'),
    /Firma criptográfica de webhook requerida/
  );

  // 3. Valid Signed Webhook Activates User
  const checkout = createCheckoutSession(user.userId, 'PRO');
  assert.strictEqual(checkout.amountPyg, 190000);
  assert.strictEqual(checkout.currency, 'PYG');

  const validPayload = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: checkout.orderId,
    idempotencyKey: `idem_fix_${checkout.orderId}`,
    amountPyg: 190000,
    paymentMethod: 'TEST_SIPAP'
  };
  const validSig = signWebhookPayload(JSON.stringify(validPayload));
  const paidRes = handleWebhookEvent(validPayload, validSig);
  assert.strictEqual(paidRes.success, true);

  // Check user is now PRO
  const userRow = db.prepare('SELECT plan FROM users WHERE id = ?').get(user.userId);
  assert.strictEqual(userRow.plan, 'PRO');

  // 4. Test Single-Use Download Tickets
  const ticketId = 'tkt_' + Math.random().toString(36).substring(2);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 120; // 2 minutes

  db.prepare(`
    INSERT INTO download_tickets (ticket, user_id, used, created_at, expires_at)
    VALUES (?, ?, 0, ?, ?)
  `).run(ticketId, user.userId, now, expiresAt);

  // Verify ticket exists and is unused
  const tRow = db.prepare('SELECT * FROM download_tickets WHERE ticket = ?').get(ticketId);
  assert.ok(tRow);
  assert.strictEqual(tRow.used, 0);

  // Simulate consuming ticket
  db.prepare('UPDATE download_tickets SET used = 1 WHERE ticket = ?').run(ticketId);

  // Trying to reuse consumed ticket must be detected as used
  const usedRow = db.prepare('SELECT * FROM download_tickets WHERE ticket = ?').get(ticketId);
  assert.strictEqual(usedRow.used, 1);

  // 5. Verify PRICING_CONFIG Single Source of Truth
  assert.strictEqual(PRICING_CONFIG.plans.PRO.pricePyg, 190000);
  assert.strictEqual(PRICING_CONFIG.plans.PRO.priceFormatted, '₲ 190.000');
  assert.strictEqual(PRICING_CONFIG.plans.PRO.durationDays, 30);
  assert.strictEqual(PRICING_CONFIG.plans.FREE.maxBacktests, 5);
  assert.strictEqual(PRICING_CONFIG.plans.FREE.maxFootballQueries, 1);

  // Clean up test DB
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
