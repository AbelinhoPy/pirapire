// src/engine/indicators.js
function calculateATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(0);
  if (candles.length === 0) return atr;

  atr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    if (i < period) {
      atr[i] = (atr[i - 1] * i + tr) / (i + 1);
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

function calculateDonchianChannels(candles, lookback = 20, exitLookback = 10) {
  const upperChannel = new Array(candles.length).fill(null);
  const lowerExitChannel = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i++) {
    if (i >= lookback) {
      let maxHigh = -Infinity;
      // Strict lookback: candles from i - lookback to i - 1 (NO LOOKAHEAD)
      for (let k = i - lookback; k < i; k++) {
        if (candles[k].high > maxHigh) maxHigh = candles[k].high;
      }
      upperChannel[i] = maxHigh;
    }

    if (i >= exitLookback) {
      let minLow = Infinity;
      // Strict exit lookback: candles from i - exitLookback to i - 1
      for (let k = i - exitLookback; k < i; k++) {
        if (candles[k].low < minLow) minLow = candles[k].low;
      }
      lowerExitChannel[i] = minLow;
    }
  }

  return { upperChannel, lowerExitChannel };
}

module.exports = {
  calculateATR,
  calculateDonchianChannels
};
