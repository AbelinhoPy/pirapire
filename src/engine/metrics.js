// src/engine/metrics.js - Performance & Risk Metrics
function calculatePerformanceMetrics(initialCapital, finalCapital, trades, equityCurve, totalFeesPaid) {
  const netReturn = finalCapital - initialCapital;
  const netReturnPct = initialCapital > 0 ? (netReturn / initialCapital) * 100 : 0;

  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  const breakevenTrades = trades.filter(t => t.pnl === 0);

  const winRatePct = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const lossRatePct = totalTrades > 0 ? (losingTrades.length / totalTrades) * 100 : 0;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999.99 : 0);

  const avgTrade = totalTrades > 0 ? netReturn / totalTrades : 0;
  const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 999.99 : 0);

  // Maximum Drawdown calculation from equity curve
  let peak = initialCapital;
  let maxDrawdownAbs = 0;
  let maxDrawdownPct = 0;

  for (const pt of equityCurve) {
    if (pt.equity > peak) {
      peak = pt.equity;
    }
    const dd = peak - pt.equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDrawdownAbs) maxDrawdownAbs = dd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  return {
    initialCapital: Number(initialCapital.toFixed(2)),
    finalCapital: Number(finalCapital.toFixed(2)),
    netReturn: Number(netReturn.toFixed(2)),
    netReturnPct: Number(netReturnPct.toFixed(2)),
    maxDrawdownAbs: Number(maxDrawdownAbs.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRatePct: Number(winRatePct.toFixed(2)),
    lossRatePct: Number(lossRatePct.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    avgTrade: Number(avgTrade.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    winLossRatio: Number(winLossRatio.toFixed(2)),
    totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
    costModel: {
      spotMakerTakerFeePct: "0.10%",
      slippagePct: "0.05%",
      unmodeledCosts: [
        "Financiamiento / Funding rate (no aplica en Spot)",
        "Tarifas de red blockchain (operaciones liquidadas internamente en libro de órdenes)"
      ]
    }
  };
}

module.exports = {
  calculatePerformanceMetrics
};
