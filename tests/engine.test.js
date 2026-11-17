// tests/engine.test.js - Strategy Engine & Verification Tests
const test = require('node:test');
const assert = require('node:assert');
const { runBacktest } = require('../src/engine/breakoutEngine');
const { calculateATR, calculateDonchianChannels } = require('../src/engine/indicators');

// Synthetic deterministic test candles
function createSampleCandles(count = 50, trend = 'up') {
  const candles = [];
  let price = 50000;
  const baseTime = 1704067200000; // 2024-01-01

  for (let i = 0; i < count; i++) {
    const delta = trend === 'up' ? (i * 100) : (trend === 'down' ? -(i * 100) : Math.sin(i) * 500);
    const close = price + delta;
    const high = close + 200;
    const low = close - 200;
    const open = close - 50;

    candles.push({
      openTime: baseTime + i * 86400000,
      date: new Date(baseTime + i * 86400000).toISOString().split('T')[0],
      open,
      high,
      low,
      close,
      volume: 1000
    });
  }
  return candles;
}

test('Donchian Channels: zero lookahead bias verification', () => {
  const candles = createSampleCandles(30);
  const { upperChannel, lowerExitChannel } = calculateDonchianChannels(candles, 20, 10);

  // Before lookback period, upper channel should be null
  assert.strictEqual(upperChannel[0], null);
  assert.strictEqual(upperChannel[19], null);
  assert.notStrictEqual(upperChannel[20], null);

  // Upper channel at candle index 20 MUST be the max high of candles 0..19
  let expectedMax = -Infinity;
  for (let k = 0; k < 20; k++) {
    if (candles[k].high > expectedMax) expectedMax = candles[k].high;
  }
  assert.strictEqual(upperChannel[20], expectedMax);

  // Verify candle 20's OWN high does NOT leak into upperChannel[20]
  const mockCandles = [...candles];
  mockCandles[20] = { ...mockCandles[20], high: 999999 };
  const { upperChannel: noLeakUpper } = calculateDonchianChannels(mockCandles, 20, 10);
  assert.strictEqual(noLeakUpper[20], expectedMax, 'Candle 20 high leaked into channel calculation at index 20!');
});

test('ATR Indicator: smooth volatility calculation', () => {
  const candles = createSampleCandles(25);
  const atr = calculateATR(candles, 14);

  assert.strictEqual(atr.length, 25);
  assert.ok(atr[14] > 0, 'ATR at period 14 should be greater than zero');
  assert.ok(!isNaN(atr[20]), 'ATR should not be NaN');
});

test('Breakout Engine: accurately executes trades, fees and accounting', () => {
  // Construct a breakout pattern: 25 sideways candles, 1 massive breakout candle, then 10 candles up, then drop below exit channel
  const candles = [];
  const baseTime = 1704067200000;
  for (let i = 0; i < 45; i++) {
    let close = 50000;
    if (i >= 22 && i < 35) close = 55000; // Breakout!
    if (i >= 35) close = 45000; // Crash below lower channel!

    candles.push({
      openTime: baseTime + i * 86400000,
      date: new Date(baseTime + i * 86400000).toISOString().split('T')[0],
      open: close,
      high: close + 100,
      low: close - 100,
      close: close,
      volume: 1500
    });
  }

  const result = runBacktest(candles, {
    lookback: 20,
    exitLookback: 10,
    stopLossAtr: 2.0,
    initialCapital: 10000,
    feeRate: 0.001,
    slippage: 0.0005
  });

  assert.strictEqual(result.strategyName, 'Breakout Donchian & Volatility ATR');
  assert.strictEqual(result.strategyVersion, '1.0.0');
  assert.ok(result.trades.length >= 1, 'Should have executed at least 1 trade');

  const trade = result.trades[0];
  assert.ok(trade.entryPrice > 50000, 'Entry price should reflect breakout level');
  assert.ok(trade.size > 0, 'Position size should be positive');
  assert.ok(result.metrics.totalFeesPaid > 0, 'Should have modeled Binance fees');
  assert.ok(result.metrics.costModel.spotMakerTakerFeePct === '0.10%');
});
