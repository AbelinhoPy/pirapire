// src/engine/breakoutEngine.js - Core Algorithmic Engine for Breakout Strategy
const { calculateATR, calculateDonchianChannels } = require('./indicators');
const { calculatePerformanceMetrics } = require('./metrics');

/**
 * Executes a deterministic, reproducible backtest of the Breakout strategy.
 * Zero lookahead bias: candle t only uses data strictly from candle t-1 and older for channel calculations.
 */
function runBacktest(candles, options = {}) {
  const {
    lookback = 20,
    exitLookback = 10,
    stopLossAtr = 2.0,
    atrPeriod = 14,
    initialCapital = 10000,
    feeRate = 0.001,      // 0.10% Binance spot standard
    slippage = 0.0005,    // 0.05% slippage model
    symbol = 'BTCUSDT',
    timeframe = '1d'
  } = options;

  if (!candles || candles.length === 0) {
    throw new Error('No se suministraron velas para ejecutar el backtest.');
  }

  const atrs = calculateATR(candles, atrPeriod);
  const { upperChannel, lowerExitChannel } = calculateDonchianChannels(candles, lookback, exitLookback);

  let capital = initialCapital;
  let inPosition = false;
  let entryPrice = 0;
  let entryDate = '';
  let entryIndex = -1;
  let positionSize = 0;
  let stopLossPrice = 0;
  let totalFeesPaid = 0;

  const trades = [];
  const signals = [];
  const equityCurve = [];

  const minIndex = Math.max(lookback, exitLookback, atrPeriod);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const upper = upperChannel[i];
    const lower = lowerExitChannel[i];
    const atr = atrs[i];

    // Compute current mark equity
    let currentEquity = inPosition ? positionSize * c.close : capital;
    equityCurve.push({
      time: c.openTime,
      date: c.date,
      timeStr: c.timeStr || c.date,
      equity: Number(currentEquity.toFixed(2)),
      price: c.close
    });

    if (i < minIndex) continue;

    if (!inPosition) {
      // Long Breakout Condition: candle close crosses above previous N-period high
      if (upper !== null && c.close > upper) {
        entryPrice = c.close * (1 + slippage);
        entryDate = c.date;
        entryIndex = i;
        const entryFee = capital * feeRate;
        totalFeesPaid += entryFee;
        capital -= entryFee;
        positionSize = capital / entryPrice;
        capital = 0;
        inPosition = true;
        stopLossPrice = stopLossAtr > 0 ? entryPrice - (stopLossAtr * atr) : 0;

        signals.push({
          type: 'BUY',
          index: i,
          date: c.date,
          price: Number(entryPrice.toFixed(2)),
          reason: `Ruptura alcista sobre máximo de ${lookback} períodos ($${upper.toFixed(2)})`,
          stopLoss: stopLossPrice > 0 ? Number(stopLossPrice.toFixed(2)) : null
        });
      }
    } else {
      // Exit condition: price drops below lowest low of M periods or hits ATR stop loss
      let shouldExit = false;
      let exitReason = '';
      let rawExitPrice = c.close;

      if (stopLossPrice > 0 && c.low <= stopLossPrice) {
        shouldExit = true;
        exitReason = 'STOP_LOSS';
        rawExitPrice = Math.min(c.open, stopLossPrice);
      } else if (lower !== null && c.close < lower) {
        shouldExit = true;
        exitReason = 'CHANNEL_EXIT';
        rawExitPrice = c.close;
      }

      if (shouldExit) {
        const exitPrice = rawExitPrice * (1 - slippage);
        const exitGross = positionSize * exitPrice;
        const exitFee = exitGross * feeRate;
        totalFeesPaid += exitFee;
        capital = exitGross - exitFee;

        const prevBalance = trades.length === 0 ? initialCapital : trades[trades.length - 1].balanceAfter;
        const pnl = capital - prevBalance;
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

        trades.push({
          id: trades.length + 1,
          entryIndex,
          exitIndex: i,
          entryDate,
          exitDate: c.date,
          entryTimeStr: candles[entryIndex].timeStr || entryDate,
          exitTimeStr: c.timeStr || c.date,
          entryPrice: Number(entryPrice.toFixed(2)),
          exitPrice: Number(exitPrice.toFixed(2)),
          stopLossPrice: stopLossPrice > 0 ? Number(stopLossPrice.toFixed(2)) : null,
          size: Number(positionSize.toFixed(6)),
          pnl: Number(pnl.toFixed(2)),
          pnlPct: Number(pnlPct.toFixed(2)),
          balanceAfter: Number(capital.toFixed(2)),
          exitReason: exitReason === 'STOP_LOSS' ? 'Stop Loss ATR alcanzado' : `Ruptura bajista bajo canal de ${exitLookback} períodos`,
          isWin: pnl > 0
        });

        signals.push({
          type: 'SELL',
          index: i,
          date: c.date,
          price: Number(exitPrice.toFixed(2)),
          reason: exitReason === 'STOP_LOSS' ? 'Ejecución Stop Loss ATR' : `Salida por canal bajo ($${lower ? lower.toFixed(2) : ''})`,
          pnl: Number(pnl.toFixed(2)),
          pnlPct: Number(pnlPct.toFixed(2))
        });

        inPosition = false;
        positionSize = 0;
      }
    }
  }

  // If still in position at the end of the data, mark to market and close cleanly
  if (inPosition) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close * (1 - slippage);
    const exitGross = positionSize * exitPrice;
    const exitFee = exitGross * feeRate;
    totalFeesPaid += exitFee;
    capital = exitGross - exitFee;

    const prevBalance = trades.length === 0 ? initialCapital : trades[trades.length - 1].balanceAfter;
    const pnl = capital - prevBalance;
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    trades.push({
      id: trades.length + 1,
      entryIndex,
      exitIndex: candles.length - 1,
      entryDate,
      exitDate: lastCandle.date,
      entryTimeStr: candles[entryIndex].timeStr || entryDate,
      exitTimeStr: lastCandle.timeStr || lastCandle.date,
      entryPrice: Number(entryPrice.toFixed(2)),
      exitPrice: Number(exitPrice.toFixed(2)),
      stopLossPrice: stopLossPrice > 0 ? Number(stopLossPrice.toFixed(2)) : null,
      size: Number(positionSize.toFixed(6)),
      pnl: Number(pnl.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(2)),
      balanceAfter: Number(capital.toFixed(2)),
      exitReason: 'Cierre por fin de período analizado',
      isWin: pnl > 0
    });

    signals.push({
      type: 'SELL',
      index: candles.length - 1,
      date: lastCandle.date,
      price: Number(exitPrice.toFixed(2)),
      reason: 'Cierre forzado fin de rango histórico',
      pnl: Number(pnl.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(2))
    });

    inPosition = false;
  }

  const metrics = calculatePerformanceMetrics(initialCapital, capital, trades, equityCurve, totalFeesPaid);

  return {
    strategyName: 'Breakout Donchian & Volatility ATR',
    strategyVersion: '1.0.0',
    symbol,
    timeframe,
    startDate: candles[0].date,
    endDate: candles[candles.length - 1].date,
    candleCount: candles.length,
    parameters: {
      lookback,
      exitLookback,
      stopLossAtr,
      atrPeriod,
      feeRate: `${(feeRate * 100).toFixed(2)}%`,
      slippage: `${(slippage * 100).toFixed(2)}%`,
      initialCapital
    },
    metrics,
    trades,
    signals,
    equityCurve,
    candles: candles.map((c, idx) => ({
      index: idx,
      time: c.openTime,
      date: c.date,
      timeStr: c.timeStr || c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      upper: upperChannel[idx],
      lower: lowerExitChannel[idx]
    }))
  };
}

module.exports = {
  runBacktest
};
