// tests/hero_reproducibility.test.js - Verifies Exact Reproducibility of Hero Simulation
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { runBacktest } = require('../src/engine/breakoutEngine');

test('Hero Simulation Reproducibility: Engine output matches published hero data', () => {
  const heroPath = path.join(__dirname, '../hero_run.json');
  assert.ok(fs.existsSync(heroPath), 'hero_run.json does not exist!');

  const heroData = JSON.parse(fs.readFileSync(heroPath, 'utf8'));

  // Re-run the engine on the exact same candles
  const rerun = runBacktest(heroData.candles, {
    lookback: heroData.parameters.lookback,
    exitLookback: heroData.parameters.exitLookback,
    stopLossAtr: heroData.parameters.stopLossAtr,
    initialCapital: heroData.parameters.initialCapital,
    symbol: heroData.symbol,
    timeframe: heroData.timeframe
  });

  // Verify exact mathematical match
  assert.strictEqual(rerun.metrics.initialCapital, heroData.metrics.initialCapital);
  assert.strictEqual(rerun.metrics.finalCapital, heroData.metrics.finalCapital);
  assert.strictEqual(rerun.metrics.netReturnPct, heroData.metrics.netReturnPct);
  assert.strictEqual(rerun.metrics.maxDrawdownPct, heroData.metrics.maxDrawdownPct);
  assert.strictEqual(rerun.metrics.totalTrades, heroData.metrics.totalTrades);
  assert.strictEqual(rerun.metrics.winningTrades, heroData.metrics.winningTrades);
  assert.strictEqual(rerun.metrics.losingTrades, heroData.metrics.losingTrades);
  assert.strictEqual(rerun.metrics.winRatePct, heroData.metrics.winRatePct);
  assert.strictEqual(rerun.metrics.lossRatePct, heroData.metrics.lossRatePct);
  assert.strictEqual(rerun.trades.length, heroData.trades.length);

  console.log(`[REPRODUCIBILITY CHECK PASSED]`);
  console.log(`  Period: ${rerun.startDate} to ${rerun.endDate}`);
  console.log(`  Trades: ${rerun.metrics.totalTrades} (Wins: ${rerun.metrics.winningTrades}, Losses: ${rerun.metrics.losingTrades})`);
  console.log(`  Net Return: ${rerun.metrics.netReturnPct}% | Max Drawdown: ${rerun.metrics.maxDrawdownPct}%`);
});
