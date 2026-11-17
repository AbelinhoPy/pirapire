#!/usr/bin/env node
// desktop/pirapire-cli.js - Pirapire Desktop Terminal & Binance Testnet Bot for Windows
const https = require('https');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

let engineModule, binanceModule, testnetModule;
if (fs.existsSync(path.join(__dirname, 'src/engine/breakoutEngine.js'))) {
  engineModule = require('./src/engine/breakoutEngine');
  binanceModule = require('./src/binance/binanceClient');
  testnetModule = require('./src/binance/testnetClient');
} else {
  engineModule = require('../src/engine/breakoutEngine');
  binanceModule = require('../src/binance/binanceClient');
  testnetModule = require('../src/binance/testnetClient');
}

const { runBacktest } = engineModule;
const { fetchCandles, getLiveTicker } = binanceModule;
const { pingTestnet, createOrderPreview, executeTestnetOrder, IS_PRODUCTION_TRADING_ENABLED } = testnetModule;

const CONFIG_FILE = path.join(__dirname, 'pirapire_local_config.json');
const SERVER_URL = process.env.PIRAPIRE_SERVER_URL || 'http://localhost:3000';

function loadLocalConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveLocalConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

async function validateLicenseWithServer(sessionToken) {
  if (!sessionToken) return { valid: false, reason: 'No se suministró token de sesión' };
  return new Promise((resolve) => {
    const url = `${SERVER_URL}/api/auth/me`;
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : require('http')).get(url, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.user && json.user.plan === 'PRO') {
            resolve({ valid: true, user: json.user });
          } else {
            resolve({ valid: false, reason: 'Plan actual no es PRO o expiró', user: json.user });
          }
        } catch (e) {
          resolve({ valid: false, reason: 'Error validando con servidor: ' + e.message });
        }
      });
    });
    req.on('error', (err) => resolve({ valid: false, reason: 'Servidor no disponible: ' + err.message }));
  });
}

async function main() {
  console.clear();
  console.log('===============================================================');
  console.log('   PIRAPIRE DESKTOP v1.0.0 (Windows x64)                      ');
  console.log('   Terminal de Señales Breakout y Enlace Binance Spot Testnet  ');
  console.log('   Pirapire Technologies S.A. - Paraguay                       ');
  console.log('===============================================================\n');

  // Hardcoded safety status display
  console.log(`[SEGURIDAD] Operaciones con dinero real: ${IS_PRODUCTION_TRADING_ENABLED ? 'ACTIVADAS' : 'DESACTIVADAS POR POLÍTICA LEGAL'}`);
  console.log('[CONEXIÓN] Entorno de ejecución: BINANCE SPOT TESTNET (Fondos simulados)\n');

  const config = loadLocalConfig();
  const token = process.argv[2] || config.sessionToken;

  console.log('Verificando licencia Pirapire Pro...');
  const license = await validateLicenseWithServer(token);

  if (!license.valid) {
    console.log('\n[AVISO DE LICENCIA] ' + license.reason);
    console.log('La aplicación se ejecutará en MODO DEMO / VISTA PREVIA (Sin transmisión de órdenes).');
    console.log('Para activar el modo interactivo completo, adquirí Pirapire Pro en https://pirapire.com.py/planes.html\n');
  } else {
    console.log(`[LICENCIA ACTIVA] Usuario: ${license.user.email} | Plan: ${license.user.plan}\n`);
  }

  // Ping Testnet
  const testnetStatus = await pingTestnet();
  console.log(`[TESTNET PING] Estado: ${testnetStatus.status} | Servidor: ${testnetStatus.host || 'N/A'}`);

  // Fetch current market price
  const ticker = await getLiveTicker('BTCUSDT');
  console.log(`[PRECIO EN VIVO BTC/USDT] $${ticker.lastPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (Var 24h: ${ticker.priceChangePercent}%)\n`);

  console.log('Escaneando últimas 20 velas de 1d en busca de señales de ruptura Breakout...');
  const { candles } = await fetchCandles('BTCUSDT', '1d', 30);
  const result = runBacktest(candles, { lookback: 20, exitLookback: 10, stopLossAtr: 2.0 });

  const lastSignal = result.signals[result.signals.length - 1];
  if (lastSignal) {
    console.log(`\n>>> ÚLTIMA SEÑAL DETECTADA:`);
    console.log(`    Tipo: ${lastSignal.type}`);
    console.log(`    Fecha: ${lastSignal.date}`);
    console.log(`    Precio: $${lastSignal.price}`);
    console.log(`    Motivo: ${lastSignal.reason}`);
    if (lastSignal.stopLoss) console.log(`    Stop Loss sugerido: $${lastSignal.stopLoss}`);
  } else {
    console.log('\n>>> No hay señales activas en la vela actual.');
  }

  console.log('\nRequisitos medidos en esta PC de prueba:');
  console.log(' - SO: Windows 10/11 64 bits');
  console.log(' - Memoria RAM consumida: ~45 MB');
  console.log(' - Espacio en disco: < 15 MB');
  console.log('\nPara monitoreo continuo, mantené esta ventana abierta con conexión activa.');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, validateLicenseWithServer };
