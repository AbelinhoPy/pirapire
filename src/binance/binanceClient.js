// src/binance/binanceClient.js - Binance Market Data Provider
const https = require('https');
const path = require('path');
const fs = require('fs');

const CACHED_REAL_CANDLES_PATH = path.join(__dirname, '../../real_btcusdt_1d.json');

async function fetchFromUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error(`Error parseando respuesta JSON de Binance: ${err.message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Fallo de red hacia Binance: ${err.message}`));
    });
  });
}

/**
 * Fetch real historical candlesticks from Binance Public REST API
 */
async function fetchCandles(symbol = 'BTCUSDT', interval = '1d', limit = 500, startTime, endTime) {
  let url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  if (startTime) url += `&startTime=${startTime}`;
  if (endTime) url += `&endTime=${endTime}`;

  try {
    const raw = await fetchFromUrl(url);
    if (!Array.isArray(raw)) {
      throw new Error(raw.msg || 'Formato de klines no válido devuelto por Binance');
    }

    const candles = raw.map(c => ({
      openTime: c[0],
      date: new Date(c[0]).toISOString().split('T')[0],
      timeStr: new Date(c[0]).toISOString().replace('T', ' ').substring(0, 16),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      closeTime: c[6]
    }));

    return {
      source: 'Binance Public REST API (api.binance.com)',
      isSynthetic: false,
      timestamp: Date.now(),
      candles
    };
  } catch (err) {
    // If external network fails or rate-limited, fall back to cached real data
    if (fs.existsSync(CACHED_REAL_CANDLES_PATH)) {
      const cached = JSON.parse(fs.readFileSync(CACHED_REAL_CANDLES_PATH, 'utf8'));
      return {
        source: 'Binance Real Data (Local Verified Cache)',
        isSynthetic: false,
        timestamp: Date.now(),
        warning: 'Datos recuperados desde la caché verificada local por fallo de conexión exterior',
        candles: cached.slice(-limit)
      };
    }
    throw err;
  }
}

/**
 * Get current live ticker for demo mode
 */
async function getLiveTicker(symbol = 'BTCUSDT') {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  try {
    const data = await fetchFromUrl(url);
    return {
      symbol: data.symbol,
      lastPrice: parseFloat(data.lastPrice),
      priceChange: parseFloat(data.priceChange),
      priceChangePercent: parseFloat(data.priceChangePercent),
      highPrice: parseFloat(data.highPrice),
      lowPrice: parseFloat(data.lowPrice),
      volume: parseFloat(data.volume),
      source: 'Binance Public API v3',
      serverTime: Date.now(),
      status: 'ONLINE'
    };
  } catch (err) {
    return {
      symbol,
      lastPrice: 65420.50,
      priceChange: -1250.00,
      priceChangePercent: -1.88,
      highPrice: 66800.00,
      lowPrice: 64200.00,
      volume: 18450.25,
      source: 'Offline Fallback Snapshot',
      serverTime: Date.now(),
      status: 'OFFLINE_FALLBACK',
      warning: 'No se pudo conectar a Binance en tiempo real. Precios de referencia estáticos.'
    };
  }
}

module.exports = {
  fetchCandles,
  getLiveTicker
};
