// src/routes/backtestRoutes.js - Backtest Execution & Quota Management
const { getDb } = require('../db/db');
const { runBacktest } = require('../engine/breakoutEngine');
const { fetchCandles } = require('../binance/binanceClient');

/**
 * Public Example Run:
 * Loads or executes the verified 1-year BTC/USDT daily Breakout backtest.
 * Consumes 0 quota.
 */
async function getPublicExample(req, res) {
  const db = getDb();

  const existing = db.prepare('SELECT * FROM backtest_runs WHERE is_public_example = 1').get();
  if (existing) {
    return res.json({
      success: true,
      isPublicExample: true,
      quotaConsumed: 0,
      runId: existing.id,
      symbol: existing.symbol,
      timeframe: existing.timeframe,
      startDate: existing.start_date,
      endDate: existing.end_date,
      parameters: JSON.parse(existing.parameters_json),
      metrics: JSON.parse(existing.metrics_json),
      trades: JSON.parse(existing.trades_json),
      candles: JSON.parse(existing.candles_summary_json)
    });
  }

  // Generate verified baseline run
  try {
    const { candles } = await fetchCandles('BTCUSDT', '1d', 365);
    const result = runBacktest(candles, {
      symbol: 'BTCUSDT',
      timeframe: '1d',
      lookback: 20,
      exitLookback: 10,
      stopLossAtr: 2.0,
      initialCapital: 10000
    });

    const info = db.prepare(`
      INSERT INTO backtest_runs (
        user_id, symbol, timeframe, start_date, end_date,
        parameters_json, metrics_json, trades_json, candles_summary_json,
        is_public_example, created_at
      ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      result.symbol,
      result.timeframe,
      result.startDate,
      result.endDate,
      JSON.stringify(result.parameters),
      JSON.stringify(result.metrics),
      JSON.stringify(result.trades),
      JSON.stringify(result.candles),
      Date.now()
    );

    return res.json({
      success: true,
      isPublicExample: true,
      quotaConsumed: 0,
      runId: Number(info.lastInsertRowid),
      ...result
    });
  } catch (err) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_EXAMPLE', message: err.message });
  }
}

/**
 * Executes a Backtest with Atomic Quota Reservation
 */
async function executeBacktestRun(req, res) {
  const user = req.user;
  const db = getDb();
  const now = Date.now();

  const {
    symbol = 'BTCUSDT',
    timeframe = '1d',
    startDate,
    endDate,
    lookback = 20,
    exitLookback = 10,
    stopLossAtr = 2.0,
    initialCapital = 10000,
    limit = 365
  } = req.body;

  let reservationId = null;

  // 1. Quota Check for FREE users
  if (user.plan === 'FREE') {
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const completedCount = db.prepare(`
        SELECT COUNT(*) as c FROM quota_reservations
        WHERE user_id = ? AND status = 'COMPLETED'
      `).get(user.id).c;

      const pendingCount = db.prepare(`
        SELECT COUNT(*) as c FROM quota_reservations
        WHERE user_id = ? AND status = 'PENDING'
      `).get(user.id).c;

      if (completedCount + pendingCount >= 5) {
        db.exec('ROLLBACK;');
        return res.status(403).json({
          error: 'QUOTA_EXHAUSTED',
          code: 'QUOTA_EXHAUSTED',
          message: 'Llegaste al límite de 5 pruebas gratuitas. Conservamos tus parámetros para ejecutarlos en Pirapire Pro.',
          remainingFreeTests: 0,
          completedTests: completedCount,
          preservedParams: { symbol, timeframe, startDate, endDate, lookback, exitLookback, stopLossAtr, initialCapital },
          upgradeUrl: '/planes.html'
        });
      }

      // Reserve quota atomically
      const resInfo = db.prepare(`
        INSERT INTO quota_reservations (user_id, status, created_at, updated_at)
        VALUES (?, 'PENDING', ?, ?)
      `).run(user.id, now, now);

      reservationId = Number(resInfo.lastInsertRowid);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ error: 'DATABASE_MUTEX_ERROR', message: err.message });
    }
  }

  // 2. Run Strategy Engine
  try {
    // Validate parameters
    const parsedLookback = parseInt(lookback, 10);
    const parsedExit = parseInt(exitLookback, 10);
    const parsedAtr = parseFloat(stopLossAtr);
    const parsedCap = parseFloat(initialCapital);

    if (isNaN(parsedLookback) || parsedLookback < 3 || parsedLookback > 200) {
      throw new Error('El parámetro lookback (período de entrada) debe estar entre 3 y 200.');
    }
    if (isNaN(parsedExit) || parsedExit < 2 || parsedExit > 100) {
      throw new Error('El parámetro exitLookback (período de salida) debe estar entre 2 y 100.');
    }
    if (isNaN(parsedAtr) || parsedAtr < 0 || parsedAtr > 10) {
      throw new Error('El multiplicador Stop Loss ATR debe ser un número entre 0 y 10.');
    }

    const candleLimit = Math.min(Math.max(parseInt(limit, 10) || 365, 30), 1000);
    const { candles, source, isSynthetic, warning } = await fetchCandles(symbol, timeframe, candleLimit);

    const result = runBacktest(candles, {
      symbol,
      timeframe,
      lookback: parsedLookback,
      exitLookback: parsedExit,
      stopLossAtr: parsedAtr,
      initialCapital: parsedCap
    });

    // Save run in DB
    const runInfo = db.prepare(`
      INSERT INTO backtest_runs (
        user_id, symbol, timeframe, start_date, end_date,
        parameters_json, metrics_json, trades_json, candles_summary_json,
        is_public_example, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      user.id,
      symbol,
      timeframe,
      result.startDate,
      result.endDate,
      JSON.stringify(result.parameters),
      JSON.stringify(result.metrics),
      JSON.stringify(result.trades),
      JSON.stringify(result.candles),
      Date.now()
    );

    const runId = Number(runInfo.lastInsertRowid);

    // Confirm Quota Consumption
    if (reservationId) {
      db.prepare(`
        UPDATE quota_reservations
        SET status = 'COMPLETED', run_id = ?, updated_at = ?
        WHERE id = ?
      `).run(runId, Date.now(), reservationId);
    }

    const currentCompleted = db.prepare(`
      SELECT COUNT(*) as c FROM quota_reservations
      WHERE user_id = ? AND status = 'COMPLETED'
    `).get(user.id).c;

    const remainingFreeTests = user.plan === 'PRO' ? 'Ilimitados' : Math.max(0, 5 - currentCompleted);

    return res.json({
      success: true,
      runId,
      userPlan: user.plan,
      remainingFreeTests,
      completedTests: currentCompleted,
      quotaStatus: 'CONSUMED',
      dataSource: source,
      isSynthetic,
      warning,
      ...result
    });

  } catch (err) {
    // Release quota reservation on any failure so user is never charged a quota on error!
    if (reservationId) {
      db.prepare(`
        UPDATE quota_reservations
        SET status = 'RELEASED', updated_at = ?
        WHERE id = ?
      `).run(Date.now(), reservationId);
    }

    return res.status(400).json({
      error: 'BACKTEST_EXECUTION_FAILED',
      message: err.message,
      quotaStatus: 'RELEASED_NO_CHARGE',
      remainingFreeTests: user.plan === 'PRO' ? 'Ilimitados' : Math.max(0, 5 - db.prepare(`
        SELECT COUNT(*) as c FROM quota_reservations
        WHERE user_id = ? AND status = 'COMPLETED'
      `).get(user.id).c)
    });
  }
}

/**
 * Retrieves a past backtest report by ID (0 quota consumed)
 */
function getBacktestReport(req, res) {
  const user = req.user;
  const db = getDb();
  const runId = parseInt(req.params.id, 10);

  const run = db.prepare('SELECT * FROM backtest_runs WHERE id = ?').get(runId);
  if (!run) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Informe de backtest no encontrado.' });
  }

  // Authorization: either public example or owned by current user (or admin)
  if (!run.is_public_example && run.user_id !== user.id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No tenés permisos para ver este informe.' });
  }

  return res.json({
    success: true,
    runId: run.id,
    symbol: run.symbol,
    timeframe: run.timeframe,
    startDate: run.start_date,
    endDate: run.end_date,
    parameters: JSON.parse(run.parameters_json),
    metrics: JSON.parse(run.metrics_json),
    trades: JSON.parse(run.trades_json),
    candles: JSON.parse(run.candles_summary_json),
    quotaConsumed: 0
  });
}

/**
 * Lists user's past backtest runs
 */
function getUserBacktestHistory(req, res) {
  const user = req.user;
  const db = getDb();

  const runs = db.prepare(`
    SELECT id, symbol, timeframe, start_date, end_date, metrics_json, created_at
    FROM backtest_runs
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(user.id);

  return res.json({
    success: true,
    history: runs.map(r => {
      const metrics = JSON.parse(r.metrics_json);
      return {
        id: r.id,
        symbol: r.symbol,
        timeframe: r.timeframe,
        startDate: r.start_date,
        endDate: r.end_date,
        netReturnPct: metrics.netReturnPct,
        maxDrawdownPct: metrics.maxDrawdownPct,
        totalTrades: metrics.totalTrades,
        winRatePct: metrics.winRatePct,
        dateFormatted: new Date(r.created_at).toLocaleDateString('es-PY')
      };
    })
  });
}

/**
 * Pro Feature: Compare multiple runs
 */
function compareBacktestRuns(req, res) {
  const user = req.user;
  if (user.plan !== 'PRO') {
    return res.status(403).json({
      error: 'UPGRADE_REQUIRED',
      message: 'La comparación simultánea de corridas es una función exclusiva de Pirapire Pro.',
      upgradeUrl: '/planes.html'
    });
  }

  const { runIds } = req.body;
  if (!Array.isArray(runIds) || runIds.length < 2) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Seleccioná al menos 2 corridas para comparar.' });
  }

  const db = getDb();
  const placeholders = runIds.map(() => '?').join(',');
  const runs = db.prepare(`
    SELECT id, symbol, timeframe, parameters_json, metrics_json, created_at
    FROM backtest_runs
    WHERE id IN (${placeholders}) AND user_id = ?
  `).all(...runIds, user.id);

  return res.json({
    success: true,
    comparison: runs.map(r => ({
      runId: r.id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      parameters: JSON.parse(r.parameters_json),
      metrics: JSON.parse(r.metrics_json),
      createdAt: new Date(r.created_at).toLocaleDateString('es-PY')
    }))
  });
}

module.exports = {
  getPublicExample,
  executeBacktestRun,
  getBacktestReport,
  getUserBacktestHistory,
  compareBacktestRuns
};
