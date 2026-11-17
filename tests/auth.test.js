// tests/auth.test.js - Authentication, Email Verification & Password Reset Tests
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'test_auth.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_PATH = TEST_DB_PATH;

const {
  registerUser,
  verifyEmailToken,
  loginUser,
  requestPasswordReset,
  resetPasswordWithToken,
  verifySessionToken,
  getUserProfile
} = require('../src/auth/authService');
const { getRecentOutbox } = require('../src/email/emailService');

test('Auth Workflow: Register -> Verify -> Login -> Reset Password', async () => {
  // 1. Registration
  const regResult = await registerUser('trader.paraguay@gmail.com', 'ClaveSegura2026!', true, 'http://localhost:3000');
  assert.ok(regResult.userId > 0);
  assert.strictEqual(regResult.email, 'trader.paraguay@gmail.com');
  assert.strictEqual(regResult.emailVerified, false);
  assert.ok(regResult.verificationToken);

  // 2. Email was dispatched to outbox
  const outbox = getRecentOutbox(5);
  const verifyMail = outbox.find(m => m.type === 'VERIFICATION');
  assert.ok(verifyMail, 'Verification email not recorded in outbox');
  assert.strictEqual(verifyMail.to_email, 'trader.paraguay@gmail.com');

  // 3. Confirm Email
  const verifyRes = verifyEmailToken(regResult.verificationToken);
  assert.strictEqual(verifyRes.success, true);
  assert.strictEqual(verifyRes.userId, regResult.userId);

  // 4. Login with verified account
  const loginRes = loginUser('trader.paraguay@gmail.com', 'ClaveSegura2026!');
  assert.strictEqual(loginRes.emailVerified, true);
  assert.strictEqual(loginRes.plan, 'FREE');
  assert.ok(loginRes.sessionToken);

  // 5. Verify Session Token Signature
  const tokenUserId = verifySessionToken(loginRes.sessionToken);
  assert.strictEqual(tokenUserId, regResult.userId);

  // 6. Request Password Reset
  const resetReq = requestPasswordReset('trader.paraguay@gmail.com', 'http://localhost:3000');
  assert.strictEqual(resetReq.success, true);
  assert.ok(resetReq.resetToken);

  // 7. Reset Password with Token
  const resetExec = resetPasswordWithToken(resetReq.resetToken, 'NuevaClave2027!');
  assert.strictEqual(resetExec.success, true);

  // 8. Old password fails, new password succeeds
  assert.throws(() => {
    loginUser('trader.paraguay@gmail.com', 'ClaveSegura2026!');
  }, /Credenciales incorrectas/);

  const newLogin = loginUser('trader.paraguay@gmail.com', 'NuevaClave2027!');
  assert.strictEqual(newLogin.userId, regResult.userId);

  // 9. Profile details check
  const profile = getUserProfile(regResult.userId);
  assert.strictEqual(profile.remainingFreeTests, 5);
  assert.strictEqual(profile.canDownloadDesktop, false);
});
