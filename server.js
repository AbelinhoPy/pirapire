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
const {
  getDownloadManifest,
  downloadDesktopApp,
  requestDownloadTicket,
  downloadWithTicket
} = require('./src/routes/downloadRoutes');
const PRICING_CONFIG = require('./src/billing/pricingConfig');
const { requireAuth, optionalAuth } = require('./src/auth/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database schema on startup
getDb();

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS & Preflight Middleware for Cross-Domain Support (GitHub Pages <-> Node Backend)
const ALLOWED_ORIGINS = [
  'https://abelinhopy.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500'
];

if (process.env.ADDITIONAL_ALLOWED_ORIGIN) {
  ALLOWED_ORIGINS.push(process.env.ADDITIONAL_ALLOWED_ORIGIN);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.github.io'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Webhook-Signature, X-Pirapire-Signature, Bypass-Tunnel-Reminder');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Block unauthenticated direct access to downloads (Security protection)
app.use('/downloads', (req, res) => {
  res.status(403).json({
    error: 'DIRECT_DOWNLOAD_BLOCKED',
    message: 'El acceso directo a los archivos de instalación está bloqueado por seguridad. La descarga de Pirapire Desktop requiere autenticación y una suscripción activa a Pirapire Pro desde /api/download/pirapire-desktop.'
  });
});

// Serve frontend static assets
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// API Routers
app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/testnet', testnetRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/futbol', footballRoutes);

// Dedicated routes for HTML views
app.get('/futbol', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'futbol.html'));
});

app.get('/planes', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'planes.html'));
});

app.get('/cuenta', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'cuenta.html'));
});

app.get('/404', (req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// Backtest endpoints
app.get('/api/backtest/public-example', getPublicExample);
app.post('/api/backtest/run', requireAuth, executeBacktestRun);
app.get('/api/backtest/report/:id', optionalAuth, getBacktestReport);
app.get('/api/backtest/history', requireAuth, getUserBacktestHistory);
app.post('/api/backtest/compare', requireAuth, compareBacktestRuns);

// Download endpoints (Protected & Single-Use Authorization Ticket)
app.get('/api/download/manifest', getDownloadManifest);
app.post('/api/download/request-ticket', requireAuth, requestDownloadTicket);
app.get('/api/download/file', downloadWithTicket);
app.get('/api/download/pirapire-desktop', requireAuth, downloadDesktopApp);

// System Configuration & Healthcheck (Public Discovery)
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    product: 'Pirapire',
    environment: process.env.NODE_ENV || 'production',
    status: 'ONLINE',
    merchant: PRICING_CONFIG.merchant,
    plans: PRICING_CONFIG.plans,
    timestamp: new Date().toISOString()
  });
});

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
  res.json({
    status: 'ONLINE',
    product: 'Pirapire',
    strategy: 'Breakout Donchian & ATR',
    version: '1.0.0',
    market: 'Paraguay (PYG)',
    timestamp: new Date().toISOString()
  });
});

// Fallback for unknown direct browser URLs
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'ENDPOINT_NOT_FOUND', message: `Ruta de API ${req.path} no encontrada.` });
  }
  const page404 = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(page404)) {
    return res.status(404).sendFile(page404);
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
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
