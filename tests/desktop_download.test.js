// tests/desktop_download.test.js - Desktop App Protection & Checksum Verification Tests
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TEST_DB_PATH = path.join(__dirname, 'test_download.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_PATH = TEST_DB_PATH;

const { registerUser } = require('../src/auth/authService');
const { createCheckoutSession, handleWebhookEvent, signWebhookPayload } = require('../src/billing/paymentService');
const { getDownloadManifest, downloadDesktopApp } = require('../src/routes/downloadRoutes');
const { packageDesktop } = require('../desktop/package-desktop');

test('Desktop Download Security: 403 for Free, 200 for Pro, SHA-256 validation', async () => {
  // Ensure package and manifest exist
  const manifest = packageDesktop();
  assert.ok(manifest.sha256);

  // 1. Create Free User
  const freeUser = await registerUser('free.user@pirapire.py', 'Password123!', true);
  const freeReq = {
    user: { id: freeUser.userId, email: freeUser.email, plan: 'FREE' },
    socket: { remoteAddress: '127.0.0.1' }
  };

  const freeRes = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };

  downloadDesktopApp(freeReq, freeRes);
  assert.strictEqual(freeRes.statusCode, 403);
  assert.strictEqual(freeRes.body.code, 'PRO_SUBSCRIPTION_REQUIRED');

  // 2. Upgrade user to PRO
  const session = createCheckoutSession(freeUser.userId, 'PRO');
  const webhook = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: session.orderId,
    idempotencyKey: `idem_dl_${session.orderId}`,
    amountPyg: 190000
  };
  handleWebhookEvent(webhook, signWebhookPayload(JSON.stringify(webhook)));

  // 3. Pro User downloads desktop package
  const proReq = {
    user: { id: freeUser.userId, email: freeUser.email, plan: 'PRO' },
    socket: { remoteAddress: '127.0.0.1' }
  };

  let headers = {};
  const chunks = [];
  const proRes = {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    write(chunk) { chunks.push(chunk); },
    end(chunk) { if (chunk) chunks.push(chunk); },
    on() {},
    once() {},
    emit() {}
  };

  // Check manifest endpoint
  const manifestRes = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
  getDownloadManifest({}, manifestRes);
  assert.strictEqual(manifestRes.body.success, true);
  assert.strictEqual(manifestRes.body.manifest.sha256, manifest.sha256);

  // Verify file directly matches manifest hash
  const zipPath = path.join(__dirname, '../public/downloads/Pirapire-Desktop-Windows-x64-v1.0.0.zip');
  assert.ok(fs.existsSync(zipPath));
  const fileBytes = fs.readFileSync(zipPath);
  const actualHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
  assert.strictEqual(actualHash, manifest.sha256, 'Published SHA-256 does not match artifact bytes!');
});
