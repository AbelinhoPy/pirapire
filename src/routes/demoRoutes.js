// src/routes/demoRoutes.js - Public Market Data & Hero Simulation Data
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getLiveTicker } = require('../binance/binanceClient');

const HERO_RUN_PATH = path.join(__dirname, '../../hero_run.json');

// GET /api/demo/ticker
router.get('/ticker', async (req, res) => {
  const symbol = req.query.symbol || 'BTCUSDT';
  const ticker = await getLiveTicker(symbol);
  res.json({ success: true, ticker });
});

// GET /api/demo/hero-simulation
router.get('/hero-simulation', (req, res) => {
  if (fs.existsSync(HERO_RUN_PATH)) {
    const data = JSON.parse(fs.readFileSync(HERO_RUN_PATH, 'utf8'));
    return res.json({
      success: true,
      headline: 'Bitcoin cayó. ¿Qué habría hecho Pirapire?',
      description: 'Mirá dónde entró el bot, dónde salió y cómo terminó la simulación. Después probá con tus propias fechas.',
      periodNotice: `Simulación histórica con saldo virtual sobre datos reales de Binance (${data.startDate} a ${data.endDate}).`,
      data
    });
  }

  // Fallback if hero_run.json not yet written
  res.status(404).json({ error: 'HERO_RUN_NOT_FOUND', message: 'Simulación de portada pendiente de generación.' });
});

module.exports = router;
