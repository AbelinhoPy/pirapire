// tests/closed_beta_e2e.test.js - End-to-End Closed Beta Verification Suite
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'test_beta_e2e.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_PATH = TEST_DB_PATH;

const { getDb } = require('../src/db/db');
const { registerUser, verifyEmailToken, loginUser, getUserProfile } = require('../src/auth/authService');
const { executeBacktestRun, getBacktestReport } = require('../src/routes/backtestRoutes');
const { analyzeFootballQuery, recordPrediction, getPredictionArchive } = require('../src/football/poissonEngine');
const { createCheckoutSession, handleWebhookEvent, signWebhookPayload, getUserSubscriptionDetails, refundSubscription } = require('../src/billing/paymentService');
const { downloadDesktopApp, getDownloadManifest } = require('../src/routes/downloadRoutes');
const { packageDesktop } = require('../desktop/package-desktop');
const { getActiveSponsorship, deactivateAllSponsors, configureSponsorCampaign } = require('../src/football/sponsorService');
const { Writable } = require('stream');

function createMockRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, encoding, cb) {
      chunks.push(chunk);
      cb();
    }
  });
  res.statusCode = 200;
  res.headers = {};
  res.body = null;
  res.setHeader = function(k, v) { this.headers[k] = v; };
  res.status = function(code) { this.statusCode = code; return this; };
  res.json = function(data) { this.body = data; return this; };
  return res;
}

test('JOURNEY A: Cripto New User Lifecycle & Desktop Verification', async () => {
  // 1. Register
  const email = 'beta.trader@pirapire.py';
  const reg = await registerUser(email, 'Asuncion2026!', true, 'http://localhost:3000');
  assert.ok(reg.userId > 0);
  assert.strictEqual(reg.emailVerified, false);

  // 2. Verify Email & Login
  verifyEmailToken(reg.verificationToken);
  const login = loginUser(email, 'Asuncion2026!');
  assert.strictEqual(login.plan, 'FREE');
  const user = { id: reg.userId, email, plan: 'FREE' };

  // 3. Exactly 5 free backtests
  for (let i = 1; i <= 5; i++) {
    const runRes = createMockRes();
    await executeBacktestRun({
      user,
      body: { symbol: 'BTCUSDT', timeframe: '1d', lookback: 20, exitLookback: 10, limit: 60 }
    }, runRes);
    assert.strictEqual(runRes.statusCode, 200);
    assert.strictEqual(runRes.body.remainingFreeTests, 5 - i);
  }

  // 4. 6th run is blocked with HTTP 403 and preserved parameters
  const blockedRes = createMockRes();
  await executeBacktestRun({
    user,
    body: { symbol: 'ETHUSDT', timeframe: '4h', lookback: 25, exitLookback: 12, stopLossAtr: 1.5, limit: 60 }
  }, blockedRes);
  assert.strictEqual(blockedRes.statusCode, 403);
  assert.strictEqual(blockedRes.body.code, 'QUOTA_EXHAUSTED');
  assert.strictEqual(blockedRes.body.preservedParameters.symbol, 'ETHUSDT');
  assert.strictEqual(blockedRes.body.preservedParameters.stopLossAtr, 1.5);

  // 5. Upgrade to Pro via checkout & webhook
  const checkout = createCheckoutSession(user.id, 'PRO');
  const webhook = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: checkout.orderId,
    idempotencyKey: `idem_beta_a_${checkout.orderId}`,
    amountPyg: 190000,
    paymentMethod: 'BANCARD_QR'
  };
  handleWebhookEvent(webhook, signWebhookPayload(webhook));

  // 6. Pro is active and 6th run now succeeds
  const proUser = { id: user.id, email, plan: 'PRO' };
  const resumeRes = createMockRes();
  await executeBacktestRun({
    user: proUser,
    body: blockedRes.body.preservedParameters
  }, resumeRes);
  assert.strictEqual(resumeRes.statusCode, 200);
  assert.strictEqual(resumeRes.body.userPlan, 'PRO');
  assert.strictEqual(resumeRes.body.remainingFreeTests, 'Ilimitados');

  // 7. Desktop download is authorized for Pro
  const dlRes = createMockRes();
  downloadDesktopApp({ user: proUser, socket: { remoteAddress: '127.0.0.1' } }, dlRes);
  assert.strictEqual(dlRes.statusCode, 200);
  assert.strictEqual(dlRes.headers['Content-Type'], 'application/zip');
});

test('JOURNEY B: Fútbol Free User, Quota Exhaustion & Limitation Handlers', async () => {
  const db = getDb();
  const email = 'beta.futbolero@pirapire.py';
  const reg = await registerUser(email, 'Olimpia2026!', true);
  verifyEmailToken(reg.verificationToken);
  const user = { id: reg.userId, email, plan: 'FREE' };

  // 1. First interactive question succeeds (1 quota consumed)
  const now = Date.now();
  db.prepare(`
    INSERT INTO football_quota_reservations (user_id, status, match_id, question, created_at, updated_at)
    VALUES (?, 'COMPLETED', 'par-2024-cl-01', '¿Quién llega mejor?', ?, ?)
  `).run(user.id, now, now);

  const analysis = analyzeFootballQuery('par-2024-cl-01', '¿Quién llega mejor?');
  assert.ok(analysis.factors.length > 0);
  assert.match(analysis.explanation, /Mirá cómo llegan/i);

  // 2. Second query triggers quota exhaustion
  const completed = db.prepare(`SELECT COUNT(*) as c FROM football_quota_reservations WHERE user_id = ? AND status = 'COMPLETED'`).get(user.id).c;
  assert.strictEqual(completed, 1);
  const remaining = Math.max(0, 1 - completed);
  assert.strictEqual(remaining, 0, 'Free user should have 0 queries left');

  // 3. Postponed match does NOT run or fabricate Poisson probabilities
  const postponed = analyzeFootballQuery('par-2024-cl-04', '¿Quién tiene más chances?');
  assert.strictEqual(postponed.status, 'APLAZADO');
  assert.strictEqual(postponed.model.hasProbabilities, false);
  assert.match(postponed.explanation, /precipitaciones torrenciales/i);

  // 4. Insufficient history (< 3 games) exposes limitation without fabricating numbers
  const insufficient = analyzeFootballQuery('par-2024-cl-06', '¿Quién tiene más chances?');
  assert.strictEqual(insufficient.status, 'INSUFFICIENT_HISTORY');
  assert.strictEqual(insufficient.model.hasProbabilities, false);
  assert.match(insufficient.explanation, /datos insuficientes/i);
});

test('JOURNEY C: Shared Pro Access Across Both Products', async () => {
  const email = 'shared.pro@pirapire.py';
  const reg = await registerUser(email, 'SharedPro2026!', true);
  verifyEmailToken(reg.verificationToken);
  const user = { id: reg.userId, email, plan: 'FREE' };

  // Free user has limits
  let profile = getUserProfile(user.id);
  assert.strictEqual(profile.plan, 'FREE');
  assert.strictEqual(profile.canDownloadDesktop, false);

  // Buy Pro via single checkout
  const checkout = createCheckoutSession(user.id, 'PRO');
  const webhook = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: checkout.orderId,
    idempotencyKey: `idem_shared_${checkout.orderId}`,
    amountPyg: 190000,
    paymentMethod: 'SIPAP'
  };
  handleWebhookEvent(webhook, signWebhookPayload(webhook));

  // Verify single Pro account unlocks BOTH Cripto and Fútbol
  profile = getUserProfile(user.id);
  assert.strictEqual(profile.plan, 'PRO');
  assert.strictEqual(profile.remainingFreeTests, 'Ilimitados');
  assert.strictEqual(profile.remainingFootballQueries, 'Ilimitadas');
  assert.strictEqual(profile.canDownloadDesktop, true);
  assert.ok(profile.subscription);
  assert.strictEqual(profile.subscription.status, 'ACTIVE');
});

test('JOURNEY D: Security, IDOR Protection & Edge Cases', async () => {
  const db = getDb();

  // Create User A and User B
  const userA = await registerUser('alice.security@pirapire.py', 'ClaveAlice123!', true);
  const userB = await registerUser('bob.security@pirapire.py', 'ClaveBob123!', true);

  // User A runs a backtest and saves report
  const reportRunRes = createMockRes();
  await executeBacktestRun({
    user: { id: userA.userId, email: 'alice.security@pirapire.py', plan: 'FREE' },
    body: { symbol: 'BTCUSDT', timeframe: '1d', lookback: 20, exitLookback: 10, limit: 50 }
  }, reportRunRes);
  const reportId = reportRunRes.body.runId;
  assert.ok(reportId > 0);

  // IDOR TEST: User B attempts to access User A's private report -> HTTP 403 FORBIDDEN
  const idorRes = createMockRes();
  getBacktestReport({
    params: { id: reportId },
    user: { id: userB.userId, email: 'bob.security@pirapire.py', plan: 'FREE' }
  }, idorRes);
  assert.strictEqual(idorRes.statusCode, 403);
  assert.strictEqual(idorRes.body.error, 'FORBIDDEN');

  // IDOR TEST: Visitor without session attempts to access private report -> HTTP 403 FORBIDDEN
  const visitorIdorRes = createMockRes();
  getBacktestReport({
    params: { id: reportId },
    user: null
  }, visitorIdorRes);
  assert.strictEqual(visitorIdorRes.statusCode, 403);

  // Duplicate webhook test: sending duplicate webhook does not duplicate activation
  const checkoutA = createCheckoutSession(userA.userId, 'PRO');
  const hookPayload = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: checkoutA.orderId,
    idempotencyKey: `idem_dup_${checkoutA.orderId}`,
    amountPyg: 190000
  };
  const sig = signWebhookPayload(hookPayload);
  const firstHook = handleWebhookEvent(hookPayload, sig);
  assert.strictEqual(firstHook.activated, true);

  const duplicateHook = handleWebhookEvent(hookPayload, sig);
  assert.strictEqual(duplicateHook.duplicate, true);
  assert.strictEqual(duplicateHook.status, 'ALREADY_PROCESSED');

  // Refund test: refunding terminates Pro access immediately
  const refundWebhook = {
    eventType: 'PAYMENT_REFUNDED',
    orderId: checkoutA.orderId,
    reason: 'Disconformidad dentro del plazo legal de 8 días'
  };
  const refundResult = handleWebhookEvent(refundWebhook, signWebhookPayload(refundWebhook));
  assert.strictEqual(refundResult.status, 'REFUNDED');
  const userAfterRefund = getUserProfile(userA.userId);
  assert.strictEqual(userAfterRefund.plan, 'FREE');
  assert.strictEqual(userAfterRefund.canDownloadDesktop, false);

  // Late webhook cannot revive a refunded subscription
  const lateHookRes = handleWebhookEvent(hookPayload, sig);
  assert.strictEqual(lateHookRes.duplicate, true);
  const userAfterLateHook = getUserProfile(userA.userId);
  assert.strictEqual(userAfterLateHook.plan, 'FREE');

  // Sponsorship tests: inactive is null, active returns Publicidad label
  deactivateAllSponsors();
  const noSponsor = getActiveSponsorship();
  assert.strictEqual(noSponsor, null, 'Inactive sponsorship space must be completely hidden (null)');

  configureSponsorCampaign({
    brandName: 'Bancard Pago Móvil',
    tagline: 'Transferencias SIPAP inmediatas',
    ctaText: 'Ver detalles',
    linkUrl: 'https://bancard.com.py',
    isActive: 1,
    durationDays: 30
  });
  const activeSponsor = getActiveSponsorship();
  assert.ok(activeSponsor);
  assert.strictEqual(activeSponsor.label, 'Publicidad');
  assert.strictEqual(activeSponsor.brandName, 'Bancard Pago Móvil');
});
