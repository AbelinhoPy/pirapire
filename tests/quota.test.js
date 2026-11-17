// tests/quota.test.js - 5 Free Backtests & Quota Reservation Safety Tests
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Use isolated test DB for quota tests
const TEST_DB_PATH = path.join(__dirname, 'test_quota.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_PATH = TEST_DB_PATH;

const { getDb, closeDb } = require('../src/db/db');
const { registerUser } = require('../src/auth/authService');
const { executeBacktestRun, getPublicExample } = require('../src/routes/backtestRoutes');

test('Quota Lifecycle: exactly 5 free tests, reservation and release on failure', async (t) => {
  const db = getDb();

  // Create test free user
  const user = await registerUser('test-quota@pirapire.py', 'Secret123!', true, 'http://localhost:3000');
  const reqUser = { id: user.userId, email: user.email, plan: 'FREE' };

  // Mock response helper
  function createMockRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
  }

  // 1. Run 5 successful backtests
  for (let i = 1; i <= 5; i++) {
    const req = {
      user: reqUser,
      body: { symbol: 'BTCUSDT', timeframe: '1d', lookback: 20, exitLookback: 10, stopLossAtr: 2.0, limit: 50 }
    };
    const res = createMockRes();
    await executeBacktestRun(req, res);

    assert.strictEqual(res.statusCode, 200, `Run ${i} failed: ` + JSON.stringify(res.body));
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.quotaStatus, 'CONSUMED');
    assert.strictEqual(res.body.completedTests, i);
    assert.strictEqual(res.body.remainingFreeTests, 5 - i);
  }

  // 2. Attempt 6th backtest: MUST be rejected with HTTP 403 QUOTA_EXHAUSTED
  const req6 = {
    user: reqUser,
    body: { symbol: 'BTCUSDT', timeframe: '1d', lookback: 35, exitLookback: 15, stopLossAtr: 1.5, limit: 50 }
  };
  const res6 = createMockRes();
  await executeBacktestRun(req6, res6);

  assert.strictEqual(res6.statusCode, 403);
  assert.strictEqual(res6.body.code, 'QUOTA_EXHAUSTED');
  assert.strictEqual(res6.body.remainingFreeTests, 0);
  assert.strictEqual(res6.body.completedTests, 5);
  // Verify preserved parameters
  assert.strictEqual(res6.body.preservedParams.lookback, 35);
  assert.strictEqual(res6.body.preservedParams.exitLookback, 15);
  assert.ok(res6.body.upgradeUrl.includes('planes'));

  // 3. Verify Failed Run Releases Quota:
  // Create a 2nd user with 4 completed tests, then fail on 5th
  const user2 = await registerUser('test-quota-fail@pirapire.py', 'Secret123!', true, 'http://localhost:3000');
  const reqUser2 = { id: user2.userId, email: user2.email, plan: 'FREE' };

  // Intentionally pass an invalid lookback parameter that fails in engine
  const badReq = {
    user: reqUser2,
    body: { symbol: 'BTCUSDT', timeframe: '1d', lookback: -999, exitLookback: 10 }
  };
  const badRes = createMockRes();
  await executeBacktestRun(badReq, badRes);

  assert.strictEqual(badRes.statusCode, 400);
  assert.strictEqual(badRes.body.quotaStatus, 'RELEASED_NO_CHARGE');
  assert.strictEqual(badRes.body.remainingFreeTests, 5, 'Quota was deducted on a failed run!');

  // Check database reservation status is RELEASED
  const reservation = db.prepare('SELECT * FROM quota_reservations WHERE user_id = ?').get(user2.userId);
  assert.strictEqual(reservation.status, 'RELEASED');

  // 4. Public example consumes 0 quota
  const publicRes = createMockRes();
  await getPublicExample({}, publicRes);
  assert.strictEqual(publicRes.body.quotaConsumed, 0);
});
