// src/routes/testnetRoutes.js - Binance Spot Testnet Router
const express = require('express');
const router = express.Router();
const {
  pingTestnet,
  createOrderPreview,
  executeTestnetOrder,
  IS_PRODUCTION_TRADING_ENABLED,
  TESTNET_BASE_URL
} = require('../binance/testnetClient');
const { requireAuth } = require('../auth/authMiddleware');

// GET /api/testnet/status
router.get('/status', async (req, res) => {
  const ping = await pingTestnet();
  res.json({
    success: true,
    environment: 'BINANCE_SPOT_TESTNET',
    productionTradingEnabled: IS_PRODUCTION_TRADING_ENABLED,
    testnetUrl: TESTNET_BASE_URL,
    legalNotice: 'Las operaciones con dinero real se encuentran estrictamente deshabilitadas. Este terminal opera exclusivamente en entorno de prueba con saldo virtual.',
    ...ping
  });
});

// POST /api/testnet/preview
router.post('/preview', requireAuth, (req, res) => {
  try {
    const { symbol, side, type, quantity, price } = req.body;
    const preview = createOrderPreview({ symbol, side, type, quantity, price });
    res.json({ success: true, preview });
  } catch (err) {
    res.status(400).json({ error: 'PREVIEW_ERROR', message: err.message });
  }
});

// POST /api/testnet/execute
router.post('/execute', requireAuth, async (req, res) => {
  try {
    const { orderPreview, userConfirmation, apiKey, apiSecret } = req.body;
    const result = await executeTestnetOrder(orderPreview, userConfirmation, apiKey, apiSecret);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: 'EXECUTION_FAILED', message: err.message });
  }
});

module.exports = router;
