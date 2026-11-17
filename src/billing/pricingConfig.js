// src/billing/pricingConfig.js - Single Source of Truth for Pricing and Plans
const PRICING_CONFIG = {
  environment: process.env.PAYMENT_ENV || 'SANDBOX', // 'SANDBOX' or 'PRODUCTION'
  currency: 'PYG',
  currencySymbol: '₲',
  exchangeRateUsdPyg: 7600, // Referencial mercado local CDE/Asunción

  merchant: {
    name: 'Pirapire Technologies S.A.',
    taxId: 'RUC 80123456-7 (En trámite)',
    country: 'Paraguay',
    contactEmail: 'soporte@pirapire.com.py',
    legalTerms: {
      framework: 'Ley N° 4868/13 de Comercio Electrónico de la República del Paraguay',
      rightOfWithdrawalDays: 8,
      withdrawalPolicy: 'Conforme al Art. 27 de la Ley 4868/13, el consumidor tiene derecho a rescindir el contrato dentro del plazo de 8 días corridos desde la contratación, siempre que no haya hecho uso intensivo del servicio.',
      cancellationPolicy: 'El acceso Pro se adquiere por períodos de 30 días renovables o pago único. La cancelación voluntaria mantiene el acceso activo hasta el último día del período pagado y no genera cargos futuros.',
      refundPolicy: 'Reembolsos disponibles dentro de los 8 días para cuentas con disconformidad técnica verificada.',
      taxDisclosure: 'Precios finales exentos de IVA temporalmente hasta emisión de RUC definitivo.'
    }
  },

  plans: {
    FREE: {
      code: 'FREE',
      name: 'Pirapire Básico',
      badge: 'Prueba gratuita',
      pricePyg: 0,
      priceFormatted: 'Gratis',
      billingInterval: 'LIFETIME',
      maxBacktests: 5,
      maxFootballQueries: 1,
      description: 'Ideal para validar la lógica de Breakout en Bitcoin y probar Pirapire Fútbol.',
      features: [
        '5 backtests completos de por vida por cuenta',
        '1 consulta interactiva gratuita en Pirapire Fútbol',
        'Ficha de partidos de Primera División de Paraguay',
        'Velas históricas reales de Binance (BTC, ETH, SOL)',
        'Informe detallado de operaciones y gráfico interactivo',
        'Demo con saldo virtual y cotizaciones en vivo'
      ],
      notIncluded: [
        'Consultas ilimitadas de fútbol',
        'Comparador de equipos de Primera División',
        'Comparación simultánea de corridas cripto',
        'Alertas de señales en tiempo real',
        'Descarga de Pirapire Desktop para Windows',
        'Conexión a Binance Spot Testnet'
      ],
      ctaText: 'Empezá gratis',
      canDownloadDesktop: false
    },

    PRO: {
      code: 'PRO',
      name: 'Pirapire Pro',
      badge: 'Más elegido',
      pricePyg: parseInt(process.env.PIRAPIRE_PRO_PRICE_PYG || '190000', 10),
      priceFormatted: '₲ 190.000',
      priceUsdApprox: 25,
      billingInterval: '30_DAYS',
      durationDays: 30,
      maxBacktests: Infinity,
      maxFootballQueries: Infinity,
      description: 'Para traders y aficionados que buscan optimizar parámetros cripto y analizar el fútbol paraguayo.',
      features: [
        'Backtests cripto ilimitados sin restricciones de cupo',
        'Consultas ilimitadas en Pirapire Fútbol con modelo Poisson',
        'Comparador de equipos de Primera División paraguaya',
        'Terminal de señales y alertas en tiempo real',
        'Descarga autorizada de Pirapire Desktop para Windows',
        'Integración con Binance Spot Testnet con confirmación segura',
        'Exportación de informes en CSV y JSON',
        'Soporte prioritario por WhatsApp y correo'
      ],
      notIncluded: [],
      ctaText: 'Comprar Pirapire Pro',
      canDownloadDesktop: true
    }
  }
};

module.exports = PRICING_CONFIG;
