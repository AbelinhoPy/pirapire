// src/binance/testnetClient.js - Binance Spot Testnet Integration & Production Guard
const https = require('https');
const crypto = require('crypto');

// CRITICAL SECURITY GUARD: Production trading with real funds is hard-disabled.
const IS_PRODUCTION_TRADING_ENABLED = false;
const TESTNET_BASE_URL = 'https://testnet.binance.vision';

/**
 * Ping Binance Spot Testnet
 */
async function pingTestnet() {
  return new Promise((resolve) => {
    https.get(`${TESTNET_BASE_URL}/api/v3/time`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            status: 'CONNECTED',
            serverTime: json.serverTime,
            host: TESTNET_BASE_URL
          });
        } catch (err) {
          resolve({ status: 'ERROR', error: err.message });
        }
      });
    }).on('error', (err) => {
      resolve({ status: 'UNREACHABLE', error: err.message });
    });
  });
}

/**
 * Prepares an explicit Order Preview before any order can be confirmed.
 */
function createOrderPreview(orderParams) {
  const {
    symbol = 'BTCUSDT',
    side = 'BUY', // BUY or SELL
    type = 'LIMIT', // LIMIT or MARKET
    quantity,
    price
  } = orderParams;

  if (!quantity || quantity <= 0) {
    throw new Error('La cantidad de la orden debe ser un número positivo mayor a 0.');
  }

  const estimatedTotal = type === 'LIMIT' ? Number((quantity * (price || 0)).toFixed(2)) : 'Al precio de mercado';

  return {
    previewId: `prev_${crypto.randomBytes(8).toString('hex')}`,
    environment: 'BINANCE_SPOT_TESTNET',
    symbol,
    side,
    type,
    quantity: Number(quantity),
    price: price ? Number(price) : null,
    estimatedTotalUsdt: estimatedTotal,
    requiresUserConfirmation: true,
    warning: 'Este entorno es Binance Spot Testnet con fondos simulados. Ningún fondo real de Binance se verá afectado.',
    createdAt: Date.now()
  };
}

/**
 * Signs and sends order to Binance Spot Testnet.
 * Requires explicit user confirmation.
 */
async function executeTestnetOrder(orderPreview, userConfirmation, apiKey, apiSecret) {
  // 1. Strict Production Guard Check
  if (IS_PRODUCTION_TRADING_ENABLED) {
    throw new Error('Fallo crítico de configuración de seguridad.');
  }

  // 2. Explicit Confirmation Check
  if (!userConfirmation || userConfirmation.confirmed !== true) {
    throw new Error('La orden requiere confirmación explícita del usuario antes de ser transmitida.');
  }

  const clientOrderId = `pirapire_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const timestamp = Date.now();

  // If no user API credentials provided, run simulated Testnet execution with realistic matching
  if (!apiKey || !apiSecret) {
    return {
      success: true,
      mode: 'TESTNET_MOCK_SANDBOX',
      orderId: Math.floor(Math.random() * 100000000),
      clientOrderId,
      symbol: orderPreview.symbol,
      side: orderPreview.side,
      type: orderPreview.type,
      status: 'FILLED',
      origQty: orderPreview.quantity.toString(),
      executedQty: orderPreview.quantity.toString(),
      price: orderPreview.price ? orderPreview.price.toString() : '65420.00',
      transactTime: timestamp,
      message: 'Orden completada con éxito en simulador de Binance Spot Testnet (sin claves API configuradas).'
    };
  }

  // Real HMAC-SHA256 signature for actual Testnet credentials
  const queryString = `symbol=${orderPreview.symbol}&side=${orderPreview.side}&type=${orderPreview.type}&timeInForce=GTC&quantity=${orderPreview.quantity}&price=${orderPreview.price}&newClientOrderId=${clientOrderId}&timestamp=${timestamp}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

  const url = `${TESTNET_BASE_URL}/api/v3/order?${queryString}&signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code && json.code < 0) {
            reject(new Error(`Error de Binance Testnet (${json.code}): ${json.msg}`));
          } else {
            resolve({
              success: true,
              mode: 'TESTNET_LIVE_AUTHENTICATED',
              ...json
            });
          }
        } catch (err) {
          reject(new Error(`Respuesta inválida de Binance Testnet: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Error de conexión con Binance Testnet: ${err.message}`));
    });

    req.end();
  });
}

module.exports = {
  IS_PRODUCTION_TRADING_ENABLED,
  TESTNET_BASE_URL,
  pingTestnet,
  createOrderPreview,
  executeTestnetOrder
};
