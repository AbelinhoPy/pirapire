// server.js - Unified Node.js Server for Pirapire
const express = require('express');
const path = require('path');
const fs = require('fs');

const { getDb } = require('./src/db/db');
const authRoutes = require('./src/routes/authRoutes');
const billingRoutes = require('./src/routes/billingRoutes');
const testnetRoutes = require('./src/routes/testnetRoutes');
const demoRoutes = require('./src/routes/demoRoutes');
const footballRoutes = require('./src/routes/footballRoutes');
const {
  getPublicExample,
  executeBacktestRun,
  getBacktestReport,
  getUserBacktestHistory,
  compareBacktestRuns
} = require('./src/routes/backtestRoutes');
const { getDownloadManifest, downloadDesktopApp } = require('./src/routes/downloadRoutes');
const { requireAuth, optionalAuth } = require('./src/auth/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database schema on startup
getDb();

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// API Routers
app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/testnet', testnetRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/futbol', footballRoutes);

// Dedicated route for Pirapire Fútbol
app.get('/futbol', (req, res) => {
  const futbolPath = path.join(PUBLIC_DIR, 'futbol.html');
  if (fs.existsSync(futbolPath)) {
    return res.sendFile(futbolPath);
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Backtest endpoints
app.get('/api/backtest/public-example', getPublicExample);
app.post('/api/backtest/run', requireAuth, executeBacktestRun);
app.get('/api/backtest/report/:id', optionalAuth, getBacktestReport);
app.get('/api/backtest/history', requireAuth, getUserBacktestHistory);
app.post('/api/backtest/compare', requireAuth, compareBacktestRuns);

// Download endpoints
app.get('/api/download/manifest', getDownloadManifest);
app.get('/api/download/pirapire-desktop', requireAuth, downloadDesktopApp);

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    product: 'Pirapire',
    strategy: 'Breakout Donchian & ATR',
    version: '1.0.0',
    market: 'Paraguay (PYG)',
    timestamp: new Date().toISOString()
  });
});

// Single Page Application Fallback for direct browser URLs
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'ENDPOINT_NOT_FOUND', message: `Ruta de API ${req.path} no encontrada.` });
  }
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

let serverInstance = null;

function startServer(port = PORT) {
  return new Promise((resolve) => {
    serverInstance = app.listen(port, () => {
      console.log(`[PIRAPIRE] Servidor iniciado y escuchando en http://localhost:${port}`);
      resolve(serverInstance);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, stopServer };
