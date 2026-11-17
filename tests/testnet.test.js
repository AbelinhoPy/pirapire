// tests/testnet.test.js - Binance Spot Testnet & Safety Guard Tests
const test = require('node:test');
const assert = require('node:assert');
const {
  pingTestnet,
  createOrderPreview,
  executeTestnetOrder,
  IS_PRODUCTION_TRADING_ENABLED
} = require('../src/binance/testnetClient');

test('Binance Spot Testnet Flow & Production Killswitch Guard', async () => {
  // 1. Production Trading Hard-Lock Verification
  assert.strictEqual(IS_PRODUCTION_TRADING_ENABLED, false, 'CRITICAL SECURITY BREACH: Real money trading must remain hard-coded FALSE');

  // 2. Ping Testnet
  const ping = await pingTestnet();
  assert.ok(ping.status === 'CONNECTED' || ping.status === 'ERROR' || ping.status === 'UNREACHABLE');

  // 3. Create Order Preview
  const preview = createOrderPreview({
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 0.05,
    price: 65000.00
  });

  assert.ok(preview.previewId.startsWith('prev_'));
  assert.strictEqual(preview.symbol, 'BTCUSDT');
  assert.strictEqual(preview.side, 'BUY');
  assert.strictEqual(preview.type, 'LIMIT');
  assert.strictEqual(preview.quantity, 0.05);
  assert.strictEqual(preview.price, 65000.00);
  assert.strictEqual(preview.estimatedTotalUsdt, 3250.00);
  assert.strictEqual(preview.requiresUserConfirmation, true);

  // 4. Execution WITHOUT user confirmation MUST fail
  await assert.rejects(async () => {
    await executeTestnetOrder(preview, { confirmed: false });
  }, /confirmación explícita/);

  // 5. Execution WITH explicit confirmation succeeds in Spot Testnet sandbox
  const execution = await executeTestnetOrder(preview, { confirmed: true });
  assert.strictEqual(execution.success, true);
  assert.strictEqual(execution.status, 'FILLED');
  assert.strictEqual(execution.symbol, 'BTCUSDT');
  assert.strictEqual(execution.side, 'BUY');
  assert.ok(execution.orderId > 0);
  assert.ok(execution.clientOrderId.startsWith('pirapire_'));
});
