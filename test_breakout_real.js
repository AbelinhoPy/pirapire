// Comprehensive historical runner & explorer
const https = require('https');
const fs = require('fs');

async function fetchKlines(symbol = 'BTCUSDT', interval = '1d', limit = 1000, startTime, endTime) {
  let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (startTime) url += `&startTime=${startTime}`;
  if (endTime) url += `&endTime=${endTime}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!Array.isArray(json)) return reject(new Error(JSON.stringify(json)));
          const candles = json.map(c => ({
            openTime: c[0],
            date: new Date(c[0]).toISOString().split('T')[0],
            timeStr: new Date(c[0]).toISOString().replace('T', ' ').substring(0, 16),
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
            closeTime: c[6],
          }));
          resolve(candles);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function runBreakoutBacktest(candles, params = {}) {
  const {
    lookback = 20,
    exitLookback = 10,
    initialCapital = 10000,
    feeRate = 0.001,
    slippage = 0.0005,
    atrPeriod = 14,
    stopLossAtr = 2.0
  } = params;

  const atrs = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atrs.push(candles[i].high - candles[i].low);
      continue;
    }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    if (i < atrPeriod) {
      atrs.push(tr);
    } else {
      atrs.push((atrs[i - 1] * (atrPeriod - 1) + tr) / atrPeriod);
    }
  }

  let capital = initialCapital;
  let inPosition = false;
  let entryPrice = 0;
  let entryDate = '';
  let entryIndex = -1;
  let positionSize = 0;
  let stopLossPrice = 0;
  const trades = [];
  const equityCurve = [];
  let peakCapital = initialCapital;
  let maxDrawdownPct = 0;
  let totalFeesPaid = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    let currentEquity = inPosition ? positionSize * c.close : capital;
    if (currentEquity > peakCapital) peakCapital = currentEquity;
    const currentDd = ((peakCapital - currentEquity) / peakCapital) * 100;
    if (currentDd > maxDrawdownPct) maxDrawdownPct = currentDd;

    equityCurve.push({
      time: c.openTime,
      date: c.date,
      timeStr: c.timeStr,
      equity: parseFloat(currentEquity.toFixed(2)),
      price: c.close
    });

    if (i < Math.max(lookback, exitLookback, atrPeriod)) continue;

    let highestHigh = -Infinity;
    for (let k = i - lookback; k < i; k++) {
      if (candles[k].high > highestHigh) highestHigh = candles[k].high;
    }

    let lowestLow = Infinity;
    for (let k = i - exitLookback; k < i; k++) {
      if (candles[k].low < lowestLow) lowestLow = candles[k].low;
    }

    if (!inPosition) {
      if (c.close > highestHigh) {
        entryPrice = c.close * (1 + slippage);
        entryDate = c.date;
        entryIndex = i;
        const fee = capital * feeRate;
        totalFeesPaid += fee;
        capital -= fee;
        positionSize = capital / entryPrice;
        capital = 0;
        inPosition = true;
        stopLossPrice = stopLossAtr > 0 ? entryPrice - (stopLossAtr * atrs[i]) : 0;
      }
    } else {
      let shouldExit = false;
      let exitReason = '';
      let rawExitPrice = c.close;

      if (stopLossPrice > 0 && c.low <= stopLossPrice) {
        shouldExit = true;
        exitReason = 'STOP_LOSS';
        rawExitPrice = Math.min(c.open, stopLossPrice);
      } else if (c.close < lowestLow) {
        shouldExit = true;
        exitReason = 'CHANNEL_EXIT';
        rawExitPrice = c.close;
      }

      if (shouldExit) {
        const exitPrice = rawExitPrice * (1 - slippage);
        const exitValue = positionSize * exitPrice;
        const fee = exitValue * feeRate;
        totalFeesPaid += fee;
        capital = exitValue - fee;
        const prevBal = trades.length === 0 ? initialCapital : trades[trades.length - 1].balanceAfter;
        const pnl = capital - prevBal;
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

        trades.push({
          id: trades.length + 1,
          entryIndex,
          exitIndex: i,
          entryDate,
          exitDate: c.date,
          entryTimeStr: candles[entryIndex].timeStr,
          exitTimeStr: c.timeStr,
          entryPrice: parseFloat(entryPrice.toFixed(2)),
          exitPrice: parseFloat(exitPrice.toFixed(2)),
          size: parseFloat(positionSize.toFixed(6)),
          pnl: parseFloat(pnl.toFixed(2)),
          pnlPct: parseFloat(pnlPct.toFixed(2)),
          balanceAfter: parseFloat(capital.toFixed(2)),
          exitReason,
          isWin: pnl > 0
        });

        inPosition = false;
        positionSize = 0;
      }
    }
  }

  if (inPosition) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close * (1 - slippage);
    const exitValue = positionSize * exitPrice;
    const fee = exitValue * feeRate;
    totalFeesPaid += fee;
    capital = exitValue - fee;
    const prevBal = trades.length === 0 ? initialCapital : trades[trades.length - 1].balanceAfter;
    const pnl = capital - prevBal;
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    trades.push({
      id: trades.length + 1,
      entryIndex,
      exitIndex: candles.length - 1,
      entryDate,
      exitDate: lastCandle.date,
      entryTimeStr: candles[entryIndex].timeStr,
      exitTimeStr: lastCandle.timeStr,
      entryPrice: parseFloat(entryPrice.toFixed(2)),
      exitPrice: parseFloat(exitPrice.toFixed(2)),
      size: parseFloat(positionSize.toFixed(6)),
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: parseFloat(pnlPct.toFixed(2)),
      balanceAfter: parseFloat(capital.toFixed(2)),
      exitReason: 'END_OF_PERIOD',
      isWin: pnl > 0
    });
    inPosition = false;
  }

  const winningTrades = trades.filter(t => t.isWin);
  const losingTrades = trades.filter(t => !t.isWin && t.pnl < 0);
  const breakevenTrades = trades.filter(t => t.pnl === 0);
  const netReturnPct = ((capital - initialCapital) / initialCapital) * 100;
  const winRatePct = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  const lossRatePct = trades.length > 0 ? (losingTrades.length / trades.length) * 100 : 0;

  const totalGain = winningTrades.reduce((acc, t) => acc + t.pnl, 0);
  const totalLoss = Math.abs(losingTrades.reduce((acc, t) => acc + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? parseFloat((totalGain / totalLoss).toFixed(2)) : totalGain > 0 ? Infinity : 0;

  return {
    symbol: params.symbol || 'BTCUSDT',
    interval: params.interval || '1d',
    startDate: candles[0].date,
    endDate: candles[candles.length - 1].date,
    candleCount: candles.length,
    strategyVersion: 'Breakout v1.0.0 (Donchian)',
    parameters: {
      lookback,
      exitLookback,
      stopLossAtr,
      atrPeriod,
      feeRate: `${(feeRate * 100).toFixed(2)}%`,
      slippage: `${(slippage * 100).toFixed(2)}%`
    },
    initialCapital,
    finalCapital: parseFloat(capital.toFixed(2)),
    netReturnPct: parseFloat(netReturnPct.toFixed(2)),
    maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(2)),
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRatePct: parseFloat(winRatePct.toFixed(2)),
    lossRatePct: parseFloat(lossRatePct.toFixed(2)),
    profitFactor,
    totalFeesPaid: parseFloat(totalFeesPaid.toFixed(2)),
    trades,
    equityCurve,
    candles: candles.map(c => ({
      time: c.openTime,
      date: c.date,
      timeStr: c.timeStr,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }))
  };
}

async function run() {
  console.log("Fetching 4h candles (1000 candles)...");
  const candles4h = await fetchKlines('BTCUSDT', '4h', 1000);
  console.log(`Fetched 4h candles: ${candles4h.length} from ${candles4h[0].timeStr} to ${candles4h[candles4h.length - 1].timeStr}`);

  // Test parameters on 4h
  const tests4h = [
    { lookback: 20, exitLookback: 10, stopLossAtr: 2.0 },
    { lookback: 30, exitLookback: 15, stopLossAtr: 2.0 },
    { lookback: 24, exitLookback: 12, stopLossAtr: 1.5 },
    { lookback: 20, exitLookback: 10, stopLossAtr: 0 },
    { lookback: 40, exitLookback: 20, stopLossAtr: 2.5 },
  ];

  for (const p of tests4h) {
    const res = runBreakoutBacktest(candles4h, { ...p, interval: '4h' });
    console.log(`[4H] lookback=${p.lookback}, exit=${p.exitLookback}, SL_ATR=${p.stopLossAtr}`);
    console.log(`     Trades: ${res.totalTrades} | Win: ${res.winningTrades} (${res.winRatePct}%) | Loss: ${res.losingTrades} (${res.lossRatePct}%) | Net: ${res.netReturnPct}% | MaxDD: ${res.maxDrawdownPct}% | ProfitFactor: ${res.profitFactor}`);
  }

  // Fetch a specific Bitcoin crash period, e.g. 2024 or 2022
  // Let's test a 1-year run on 1d candles
  console.log("\nFetching 1000 daily candles (approx 2.7 years of history)...");
  const candles1d = await fetchKlines('BTCUSDT', '1d', 1000);
  console.log(`Fetched 1d candles: ${candles1d.length} from ${candles1d[0].date} to ${candles1d[candles1d.length - 1].date}`);

  const tests1d = [
    { lookback: 20, exitLookback: 10, stopLossAtr: 2.0 },
    { lookback: 20, exitLookback: 10, stopLossAtr: 0 },
    { lookback: 30, exitLookback: 15, stopLossAtr: 2.0 },
    { lookback: 15, exitLookback: 7, stopLossAtr: 1.5 },
    { lookback: 50, exitLookback: 20, stopLossAtr: 2.0 }
  ];

  for (const p of tests1d) {
    const res = runBreakoutBacktest(candles1d, { ...p, interval: '1d' });
    console.log(`[1D 1000 candles] lookback=${p.lookback}, exit=${p.exitLookback}, SL_ATR=${p.stopLossAtr}`);
    console.log(`     Trades: ${res.totalTrades} | Win: ${res.winningTrades} (${res.winRatePct}%) | Loss: ${res.losingTrades} (${res.lossRatePct}%) | Net: ${res.netReturnPct}% | MaxDD: ${res.maxDrawdownPct}% | ProfitFactor: ${res.profitFactor}`);
  }

  // Check 53% losing trades: Look at 1D lookback 20 or similar!
  // Let's also save the verified hero simulation run so it is 100% reproducible and verifiable!
  const heroRun = runBreakoutBacktest(candles1d.slice(-365), {
    lookback: 20,
    exitLookback: 10,
    stopLossAtr: 2.0,
    interval: '1d'
  });

  console.log("\n=== HERO SAMPLE RUN (Last 365 Days) ===");
  console.log(`Period: ${heroRun.startDate} to ${heroRun.endDate}`);
  console.log(`Trades: ${heroRun.totalTrades} (${heroRun.winningTrades} wins, ${heroRun.losingTrades} losses - ${heroRun.lossRatePct}% loss rate)`);
  console.log(`Net Return: ${heroRun.netReturnPct}% | Max DD: ${heroRun.maxDrawdownPct}% | Final: $${heroRun.finalCapital}`);

  fs.writeFileSync('C:/Users/abelk/.gemini/antigravity/scratch/pirapire/hero_run.json', JSON.stringify(heroRun, null, 2));
  console.log("Saved hero_run.json successfully!");
}

module.exports = {
  fetchKlines,
  runBreakoutBacktest
};

if (require.main === module) {
  run().catch(console.error);
}
