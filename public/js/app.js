// public/js/app.js - Main Application Logic & Terminal Interface
(function() {
  'use strict';

  // State Management
  const state = {
    user: null,
    sessionToken: localStorage.getItem('pirapire_token') || null,
    heroData: null,
    heroPlaybackIndex: 0,
    heroPlaying: false,
    heroTimer: null,
    currentReport: null,
    selectedTradeId: null,
    pricing: null,
    testnetStatus: null,
    apiOnline: true
  };

  // DOM Elements
  const el = {};

  function init() {
    bindDOMElements();
    setupEventListeners();
    setupApiConnectivityBanner();
    loadAuthState();
    loadPricingConfig();
    loadHeroSimulation();
    loadPublicExample();
    checkTestnetStatus();
  }

  function bindDOMElements() {
    el.authBtn = document.getElementById('btn-auth-header');
    el.userMenu = document.getElementById('user-menu-header');
    el.userEmailDisplay = document.getElementById('user-email-display');
    el.userPlanBadge = document.getElementById('user-plan-badge');

    // Hero Elements
    el.heroCanvas = document.getElementById('hero-chart-canvas');
    el.heroPlayBtn = document.getElementById('hero-play-btn');
    el.heroPauseBtn = document.getElementById('hero-pause-btn');
    el.heroResetBtn = document.getElementById('hero-reset-btn');
    el.heroStatusBadge = document.getElementById('hero-status-badge');
    el.heroPnlDisplay = document.getElementById('hero-pnl-display');
    el.heroTradeInfo = document.getElementById('hero-trade-info');

    // Simulator Elements
    el.simCanvas = document.getElementById('sim-chart-canvas');
    el.simForm = document.getElementById('simulator-form');
    el.simSubmitBtn = document.getElementById('sim-submit-btn');
    el.quotaText = document.getElementById('quota-text');
    el.quotaBarFill = document.getElementById('quota-bar-fill');
    el.metricsContainer = document.getElementById('metrics-container');
    el.tradesTableBody = document.getElementById('trades-table-body');
    el.tradeDetailCard = document.getElementById('trade-detail-card');
    el.quotaModal = document.getElementById('quota-exhausted-modal');

    // Modals
    el.authModal = document.getElementById('auth-modal');
    el.checkoutModal = document.getElementById('checkout-modal');
    el.testnetModal = document.getElementById('testnet-confirm-modal');
    el.accountModal = document.getElementById('account-modal');
    el.apiBanner = document.getElementById('api-status-banner');
  }

  function setupEventListeners() {
    // Navigation & Auth trigger
    if (el.authBtn) {
      el.authBtn.addEventListener('click', () => {
        if (state.user) {
          window.location.href = 'cuenta.html';
        } else {
          openAuthModal('login');
        }
      });
    }

    // Hero Controls
    if (el.heroPlayBtn) el.heroPlayBtn.addEventListener('click', startHeroPlayback);
    if (el.heroPauseBtn) el.heroPauseBtn.addEventListener('click', pauseHeroPlayback);
    if (el.heroResetBtn) el.heroResetBtn.addEventListener('click', resetHeroPlayback);

    // Simulator Form
    if (el.simForm) {
      el.simForm.addEventListener('submit', handleSimulatorSubmit);
    }

    // Modal Closes
    document.querySelectorAll('.modal-close, .modal-backdrop-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    // Handle Window Resize for responsive charts
    window.addEventListener('resize', debounce(() => {
      if (state.heroData) renderHeroChart();
      if (state.currentReport) renderReportChart();
    }, 150));
  }

  function setupApiConnectivityBanner() {
    const banner = document.getElementById('api-status-banner');
    const retryBtn = document.getElementById('btn-retry-api');
    const configBtn = document.getElementById('btn-config-api');

    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        retryBtn.textContent = 'Verificando...';
        const health = await window.PIRAPIRE_CONFIG.checkHealth();
        retryBtn.textContent = 'Reintentar conexión';
        if (health.online) {
          state.apiOnline = true;
          if (banner) banner.style.display = 'none';
          loadAuthState();
          loadHeroSimulation();
        } else {
          alert('El servidor aún no responde. Verificá que el backend esté en ejecución o configurá una URL válida.');
        }
      });
    }

    if (configBtn) {
      configBtn.addEventListener('click', () => {
        const current = window.PIRAPIRE_CONFIG.API_BASE_URL;
        const entered = prompt('Ingresá la URL del servidor backend de Pirapire (o dejá vacío para usar predeterminado):', current);
        if (entered !== null) {
          window.PIRAPIRE_CONFIG.setApiBaseUrl(entered);
          window.location.reload();
        }
      });
    }
  }

  function showApiOfflineNotice() {
    state.apiOnline = false;
    const banner = document.getElementById('api-status-banner');
    if (banner) banner.style.display = 'block';
  }

  // API Helpers (Uniform Cross-Origin & Same-Origin Fetch)
  async function apiCall(endpoint, options = {}) {
    const fullUrl = endpoint.startsWith('http')
      ? endpoint
      : (window.PIRAPIRE_CONFIG ? window.PIRAPIRE_CONFIG.resolveEndpoint(endpoint) : endpoint);

    const headers = options.headers || {};
    if (state.sessionToken) {
      headers['Authorization'] = `Bearer ${state.sessionToken}`;
    }
    headers['Bypass-Tunnel-Reminder'] = 'true';

    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    try {
      const res = await fetch(fullUrl, {
        ...options,
        headers,
        mode: 'cors'
      });
      const json = await res.json();

      // Check session expiration
      if (res.status === 401 && state.sessionToken && !endpoint.includes('/api/auth/login')) {
        localStorage.removeItem('pirapire_token');
        state.sessionToken = null;
        state.user = null;
        updateAuthUI(null);
        alert('Tu sesión ha expirado por seguridad. Por favor ingresá nuevamente.');
      }

      // Hide offline banner if previously visible
      const banner = document.getElementById('api-status-banner');
      if (banner && res.status !== 500) banner.style.display = 'none';

      return { status: res.status, ok: res.ok, data: json };
    } catch (err) {
      showApiOfflineNotice();
      return { status: 500, ok: false, data: { error: 'NETWORK_ERROR', message: err.message } };
    }
  }

  // Auth Functions
  async function loadAuthState() {
    if (!state.sessionToken) {
      updateAuthUI(null);
      return;
    }
    const res = await apiCall('/api/auth/me');
    if (res.ok && res.data.user) {
      state.user = res.data.user;
      updateAuthUI(state.user);
      updateQuotaUI();

      // Check if user had a preserved simulation to resume
      checkAndResumePreservedBacktest();
    } else {
      localStorage.removeItem('pirapire_token');
      state.sessionToken = null;
      updateAuthUI(null);
    }
  }

  function updateAuthUI(user) {
    if (!el.authBtn) return;
    const navCuenta = document.getElementById('nav-cuenta-link');
    if (user) {
      el.authBtn.textContent = 'Mi Cuenta';
      if (navCuenta) navCuenta.style.display = 'inline-block';
      if (el.userPlanBadge) {
        el.userPlanBadge.textContent = user.plan;
        el.userPlanBadge.className = `badge ${user.plan === 'PRO' ? 'badge-amber' : 'badge-muted'}`;
      }
    } else {
      el.authBtn.textContent = 'Iniciar sesión';
      if (navCuenta) navCuenta.style.display = 'none';
      if (el.userPlanBadge) el.userPlanBadge.textContent = '';
    }
  }

  function updateQuotaUI() {
    if (!el.quotaText || !el.quotaBarFill) return;
    if (!state.user) {
      el.quotaText.textContent = '5 pruebas gratis al crear tu cuenta';
      el.quotaBarFill.style.width = '100%';
      return;
    }
    if (state.user.plan === 'PRO') {
      el.quotaText.textContent = 'Pirapire Pro: Backtests Ilimitados';
      el.quotaBarFill.style.width = '100%';
      el.quotaBarFill.style.background = '#10b981';
      return;
    }
    const remaining = state.user.remainingFreeTests !== undefined ? state.user.remainingFreeTests : 5;
    const completed = state.user.completedBacktests || 0;
    el.quotaText.textContent = `${remaining} de 5 pruebas gratuitas disponibles (${completed} usadas)`;
    const pct = Math.max(0, (remaining / 5) * 100);
    el.quotaBarFill.style.width = `${pct}%`;
    el.quotaBarFill.style.background = remaining <= 1 ? '#ef4444' : '#f59e0b';
  }

  // Check and resume preserved backtest
  function checkAndResumePreservedBacktest() {
    const raw = localStorage.getItem('pirapire_preserved_backtest');
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      if (el.simForm) {
        if (el.simForm.elements['symbol']) el.simForm.elements['symbol'].value = p.symbol || 'BTCUSDT';
        if (el.simForm.elements['timeframe']) el.simForm.elements['timeframe'].value = p.timeframe || '1d';
        if (el.simForm.elements['lookback']) el.simForm.elements['lookback'].value = p.lookback || 20;
        if (el.simForm.elements['exitLookback']) el.simForm.elements['exitLookback'].value = p.exitLookback || 10;
        if (el.simForm.elements['stopLossAtr']) el.simForm.elements['stopLossAtr'].value = p.stopLossAtr || 2.0;
      }
    } catch (_) {}
  }

  // Load Pricing Config
  async function loadPricingConfig() {
    let pricing = null;
    const res = await apiCall('/api/billing/plans');
    if (res.ok && res.data && res.data.plans) {
      pricing = res.data;
    } else {
      // Fallback matching Single Source of Truth
      pricing = {
        currency: 'PYG',
        plans: {
          FREE: {
            name: "Pirapire Básico",
            priceFormatted: "Gratis",
            pricePyg: 0,
            badge: "Prueba gratuita",
            description: "Ideal para validar la estrategia cripto de Pirapire en Bitcoin y probar Pirapire Fútbol.",
            features: [
              "5 backtests completos de por vida por cuenta",
              "1 consulta interactiva gratuita en Pirapire Fútbol",
              "Ficha de partidos de Primera División de Paraguay",
              "Velas históricas reales de Binance (BTC, ETH, SOL)",
              "Informe detallado de operaciones y gráfico interactivo",
              "Demo con saldo virtual y cotizaciones en vivo"
            ],
            notIncluded: [
              "Consultas ilimitadas de fútbol",
              "Comparador de equipos de Primera División",
              "Comparación simultánea de corridas cripto",
              "Descarga de Pirapire Desktop para Windows"
            ],
            ctaText: "Empezá gratis"
          },
          PRO: {
            name: "Pirapire Pro",
            priceFormatted: "₲ 190.000",
            pricePyg: 190000,
            priceUsdApprox: 25,
            badge: "Más elegido",
            durationDays: 30,
            description: "Para traders y aficionados que buscan optimizar parámetros cripto y analizar el fútbol paraguayo.",
            features: [
              "Backtests cripto ilimitados sin restricciones de cupo",
              "Consultas ilimitadas en Pirapire Fútbol con modelo Poisson",
              "Comparador de equipos de Primera División paraguaya",
              "Terminal de señales y alertas en tiempo real",
              "Descarga autorizada de Pirapire Desktop para Windows",
              "Integración con Binance Spot Testnet con confirmación segura",
              "Exportación de informes en CSV y JSON",
              "Soporte prioritario por WhatsApp y correo"
            ],
            ctaText: "Comprar Pirapire Pro"
          }
        }
      };
    }
    state.pricing = pricing;
    renderPricingCards(pricing);
  }

  function renderPricingCards(config) {
    const container = document.getElementById('pricing-grid-container');
    if (!container) return;

    const free = config.plans.FREE;
    const pro = config.plans.PRO;

    container.innerHTML = `
      <!-- Plan Gratis -->
      <div class="pricing-card">
        <span class="badge badge-muted badge-top">${free.badge}</span>
        <h3>${free.name}</h3>
        <p class="section-desc" style="margin-top:4px;">${free.description}</p>
        <div class="price-box">
          <span class="price-amount">${free.priceFormatted}</span>
          <span class="price-interval">/ para siempre</span>
        </div>
        <ul class="features-list">
          ${free.features.map(f => `<li class="included">✓ ${f}</li>`).join('')}
          ${free.notIncluded ? free.notIncluded.map(f => `<li class="excluded">✗ ${f}</li>`).join('') : ''}
        </ul>
        <button class="btn btn-secondary" onclick="window.app.handleSelectPlan('FREE')">${free.ctaText}</button>
      </div>

      <!-- Plan Pirapire Pro -->
      <div class="pricing-card featured">
        <span class="badge badge-amber badge-top">${pro.badge}</span>
        <h3>${pro.name}</h3>
        <p class="section-desc" style="margin-top:4px;">${pro.description}</p>
        <div class="price-box">
          <span class="price-amount">${pro.priceFormatted}</span>
          <span class="price-interval">/ acceso 30 días (~$${pro.priceUsdApprox || 25} USD)</span>
        </div>
        <ul class="features-list">
          ${pro.features.map(f => `<li class="included">✓ ${f}</li>`).join('')}
        </ul>
        <button class="btn btn-primary" onclick="window.app.handleSelectPlan('PRO')">${pro.ctaText}</button>
      </div>
    `;
  }

  // Load Hero Simulation (Verified Bitcoin Historical Precalculated Run)
  async function loadHeroSimulation() {
    let hero = null;
    const res = await apiCall('/api/demo/hero-simulation');
    if (res.ok && res.data && res.data.data) {
      hero = res.data.data;
    } else {
      try {
        const fallbackRes = await fetch('hero_run.json');
        if (fallbackRes.ok) {
          hero = await fallbackRes.json();
        }
      } catch (_) {}
    }
    if (hero) {
      state.heroData = hero;
      resetHeroPlayback();
    }
  }

  function resetHeroPlayback() {
    pauseHeroPlayback();
    if (!state.heroData || !state.heroData.candles) return;
    state.heroPlaybackIndex = Math.min(25, state.heroData.candles.length - 1);
    updateHeroUI();
    renderHeroChart();
  }

  function startHeroPlayback() {
    if (state.heroPlaying) return;
    state.heroPlaying = true;
    if (el.heroPlayBtn) el.heroPlayBtn.style.display = 'none';
    if (el.heroPauseBtn) el.heroPauseBtn.style.display = 'inline-flex';

    state.heroTimer = setInterval(() => {
      if (!state.heroData || !state.heroData.candles) return;
      if (state.heroPlaybackIndex < state.heroData.candles.length - 1) {
        state.heroPlaybackIndex++;
        updateHeroUI();
        renderHeroChart();
      } else {
        pauseHeroPlayback();
      }
    }, 400);
  }

  function pauseHeroPlayback() {
    state.heroPlaying = false;
    if (state.heroTimer) clearInterval(state.heroTimer);
    if (el.heroPlayBtn) el.heroPlayBtn.style.display = 'inline-flex';
    if (el.heroPauseBtn) el.heroPauseBtn.style.display = 'none';
  }

  function updateHeroUI() {
    if (!state.heroData) return;
    const currentCandle = state.heroData.candles[state.heroPlaybackIndex];
    if (!currentCandle) return;

    const activeTrade = state.heroData.trades.find(t =>
      state.heroPlaybackIndex >= t.entryIndex && state.heroPlaybackIndex <= t.exitIndex
    );

    if (activeTrade) {
      const isExited = state.heroPlaybackIndex === activeTrade.exitIndex;
      if (isExited) {
        el.heroStatusBadge.textContent = activeTrade.isWin ? 'OPERACIÓN GANADORA' : 'STOP LOSS ALCANZADO';
        el.heroStatusBadge.className = `badge ${activeTrade.isWin ? 'badge-green' : 'badge-red'}`;
        el.heroPnlDisplay.textContent = `PnL: ${activeTrade.pnlPct >= 0 ? '+' : ''}${activeTrade.pnlPct}% ($${activeTrade.pnl})`;
        el.heroPnlDisplay.className = `font-mono ${activeTrade.isWin ? 'text-green' : 'text-red'}`;
      } else {
        el.heroStatusBadge.textContent = 'EN POSICIÓN (LONG)';
        el.heroStatusBadge.className = 'badge badge-amber';
        const currentPnlPct = (((currentCandle.close - activeTrade.entryPrice) / activeTrade.entryPrice) * 100).toFixed(2);
        el.heroPnlDisplay.textContent = `P&L flotante: ${currentPnlPct >= 0 ? '+' : ''}${currentPnlPct}%`;
      }
    } else {
      el.heroStatusBadge.textContent = 'ESPERANDO RUPTURA';
      el.heroStatusBadge.className = 'badge badge-muted';
      el.heroPnlDisplay.textContent = 'Sin posición activa';
    }

    if (el.heroTradeInfo) {
      el.heroTradeInfo.textContent = `Vela ${state.heroPlaybackIndex + 1}/${state.heroData.candles.length} • Fecha: ${currentCandle.date} • Cierre: $${currentCandle.close.toLocaleString('en-US')}`;
    }
  }

  function renderHeroChart() {
    if (!el.heroCanvas || !state.heroData) return;
    const canvas = el.heroCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.fillStyle = '#0f1118';
    ctx.fillRect(0, 0, width, height);

    const visibleCandles = state.heroData.candles.slice(0, state.heroPlaybackIndex + 1);
    if (visibleCandles.length === 0) return;

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    visibleCandles.forEach(c => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    });

    const padding = (maxPrice - minPrice) * 0.1 || 100;
    minPrice -= padding;
    maxPrice += padding;

    const priceToY = (price) => height - 24 - ((price - minPrice) / (maxPrice - minPrice)) * (height - 48);
    const count = visibleCandles.length;
    const candleWidth = Math.max(2, (width - 40) / count - 2);

    // Grid lines
    ctx.strokeStyle = '#1e2230';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = (height / 5) * i;
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(width - 20, y);
      ctx.stroke();
    }

    // Donchian Upper Channel Line (Cyan)
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    visibleCandles.forEach((c, idx) => {
      if (c.donchianUpper) {
        const x = 20 + idx * ((width - 40) / count) + candleWidth / 2;
        const y = priceToY(c.donchianUpper);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
    });
    ctx.stroke();

    // Candlesticks
    visibleCandles.forEach((c, idx) => {
      const x = 20 + idx * ((width - 40) / count);
      const isUp = c.close >= c.open;
      const color = isUp ? '#10b981' : '#ef4444';

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;

      const highY = priceToY(c.high);
      const lowY = priceToY(c.low);
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();

      const openY = priceToY(c.open);
      const closeY = priceToY(c.close);
      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.max(2, Math.abs(openY - closeY));
      ctx.fillRect(x, bodyY, candleWidth, bodyH);

      // Signal markers
      if (c.signal === 'BUY') {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, lowY + 12);
        ctx.lineTo(x + candleWidth / 2 - 5, lowY + 22);
        ctx.lineTo(x + candleWidth / 2 + 5, lowY + 22);
        ctx.fill();
        ctx.font = 'bold 9px monospace';
        ctx.fillText('COMPRA', x - 10, lowY + 32);
      } else if (c.signal === 'EXIT') {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, highY - 12);
        ctx.lineTo(x + candleWidth / 2 - 5, highY - 22);
        ctx.lineTo(x + candleWidth / 2 + 5, highY - 22);
        ctx.fill();
        ctx.font = 'bold 9px monospace';
        ctx.fillText('SALIDA', x - 10, highY - 26);
      }
    });
  }

  // Load Baseline Public Example for Simulator
  async function loadPublicExample() {
    let reportData = null;
    const res = await apiCall('/api/backtest/public-example');
    if (res.ok && res.data) {
      reportData = res.data;
    } else if (state.heroData) {
      reportData = state.heroData;
    } else {
      try {
        const fallbackRes = await fetch('hero_run.json');
        if (fallbackRes.ok) {
          reportData = await fallbackRes.json();
        }
      } catch (_) {}
    }
    if (reportData) {
      renderSimulatorReport(reportData);
    }
  }

  // Handle Simulator Submit
  async function handleSimulatorSubmit(e) {
    e.preventDefault();
    if (!state.user) {
      openAuthModal('register', 'Creá tu cuenta gratis para ejecutar tus 5 simulaciones.');
      return;
    }

    const formData = new FormData(el.simForm);
    const payload = {
      symbol: formData.get('symbol') || 'BTCUSDT',
      timeframe: formData.get('timeframe') || '1d',
      lookback: parseInt(formData.get('lookback') || 20, 10),
      exitLookback: parseInt(formData.get('exitLookback') || 10, 10),
      stopLossAtr: parseFloat(formData.get('stopLossAtr') || 2.0),
      initialCapital: 10000,
      limit: 365
    };

    el.simSubmitBtn.disabled = true;
    el.simSubmitBtn.textContent = 'Ejecutando simulación en servidor...';

    const res = await apiCall('/api/backtest/run', {
      method: 'POST',
      body: payload
    });

    el.simSubmitBtn.disabled = false;
    el.simSubmitBtn.textContent = 'Ejecutar Backtest';

    if (res.status === 403 && (res.data.code === 'QUOTA_EXHAUSTED' || res.data.error === 'QUOTA_EXHAUSTED')) {
      const preserved = res.data.preservedParams || res.data.preservedParameters || payload;
      localStorage.setItem('pirapire_preserved_backtest', JSON.stringify(preserved));
      openQuotaExhaustedModal(preserved);
      return;
    }

    if (res.ok && res.data) {
      // Clear preserved backtest on success
      localStorage.removeItem('pirapire_preserved_backtest');

      if (state.user && state.user.plan !== 'PRO') {
        state.user.completedBacktests = res.data.completedTests;
        state.user.remainingFreeTests = res.data.remainingFreeTests;
        updateQuotaUI();
      }
      renderSimulatorReport(res.data);
    } else {
      alert(`Error en simulación: ${res.data.message || 'Ocurrió un error inesperado al procesar el backtest.'}`);
    }
  }

  // Render Simulator Report (TrendSpider style)
  function renderSimulatorReport(report) {
    state.currentReport = report;

    // Metrics Dashboard
    const m = report.metrics;
    if (el.metricsContainer) {
      el.metricsContainer.innerHTML = `
        <div class="metric-box">
          <div class="metric-label">Retorno Neto</div>
          <div class="metric-value ${m.netReturnPct >= 0 ? 'positive' : 'negative'}">
            ${m.netReturnPct >= 0 ? '+' : ''}${m.netReturnPct}%
          </div>
          <div class="metric-label" style="margin-top:2px;">$${m.netReturn} USDT</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Caída Máxima (DD)</div>
          <div class="metric-value negative">-${m.maxDrawdownPct}%</div>
          <div class="metric-label" style="margin-top:2px;">$${m.maxDrawdownAbs}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Operaciones Totales</div>
          <div class="metric-value">${m.totalTrades}</div>
          <div class="metric-label" style="margin-top:2px;">Ganadas: ${m.winningTrades} • Pérdidas: ${m.losingTrades}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Tasa de Acierto</div>
          <div class="metric-value font-mono">${m.winRatePct}%</div>
          <div class="metric-label" style="margin-top:2px;">Ratio Gan/Pérd: ${m.winLossRatio || 1.7}</div>
        </div>
      `;
    }

    // Trades Table
    if (el.tradesTableBody) {
      el.tradesTableBody.innerHTML = '';
      if (report.trades && report.trades.length > 0) {
        report.trades.forEach(t => {
          const row = document.createElement('tr');
          row.className = `trade-row ${t.id === state.selectedTradeId ? 'selected' : ''}`;
          row.onclick = () => selectTrade(t.id);

          const pnlColor = t.isWin ? '#10b981' : '#ef4444';
          row.innerHTML = `
            <td class="font-mono">#${t.id}</td>
            <td style="color:#10b981; font-weight:700;">${t.type}</td>
            <td>${t.entryDate} ($${t.entryPrice})</td>
            <td>${t.exitDate} ($${t.exitPrice})</td>
            <td class="font-mono" style="color:${pnlColor}; font-weight:700;">
              ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}% ($${t.pnl})
            </td>
            <td><span class="badge ${t.isWin ? 'badge-green' : 'badge-red'}">${t.exitReason}</span></td>
          `;
          el.tradesTableBody.appendChild(row);
        });
      } else {
        el.tradesTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">No se generaron operaciones en el período seleccionado.</td></tr>`;
      }
    }

    renderReportChart();
  }

  function selectTrade(tradeId) {
    state.selectedTradeId = tradeId;
    if (!state.currentReport || !state.currentReport.trades) return;
    const trade = state.currentReport.trades.find(t => t.id === tradeId);
    if (!trade) return;

    if (el.tradeDetailCard) {
      el.tradeDetailCard.style.display = 'block';
      document.getElementById('td-id').textContent = `#${trade.id} (${trade.type})`;
      document.getElementById('td-entry').textContent = `${trade.entryDate} a $${trade.entryPrice.toLocaleString('en-US')}`;
      document.getElementById('td-exit').textContent = `${trade.exitDate} a $${trade.exitPrice.toLocaleString('en-US')}`;
      document.getElementById('td-sl').textContent = `$${trade.stopLossPrice} (ATR 2.0x)`;
      document.getElementById('td-dur').textContent = `${trade.barsHeld} días (Velas)`;
      document.getElementById('td-fees').textContent = `$${trade.feePaid} USDT`;

      const pnlEl = document.getElementById('td-pnl');
      pnlEl.textContent = `${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct}% ($${trade.pnl} USDT)`;
      pnlEl.style.color = trade.isWin ? '#10b981' : '#ef4444';
    }

    renderReportChart();
  }

  function renderReportChart() {
    if (!el.simCanvas || !state.currentReport || !state.currentReport.candles) return;
    const canvas = el.simCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.fillStyle = '#0a0b0e';
    ctx.fillRect(0, 0, width, height);

    const candles = state.currentReport.candles;
    if (!candles || candles.length === 0) return;

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    candles.forEach(c => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    });

    const padding = (maxPrice - minPrice) * 0.08 || 100;
    minPrice -= padding;
    maxPrice += padding;

    const priceToY = (price) => height - 30 - ((price - minPrice) / (maxPrice - minPrice)) * (height - 60);
    const count = candles.length;
    const candleWidth = Math.max(2, (width - 40) / count - 2);

    // Candlesticks
    candles.forEach((c, idx) => {
      const x = 20 + idx * ((width - 60) / count);
      const isUp = c.close >= c.open;
      const color = isUp ? '#10b981' : '#ef4444';

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;

      const highY = priceToY(c.high);
      const lowY = priceToY(c.low);
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();

      const openY = priceToY(c.open);
      const closeY = priceToY(c.close);
      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.max(2, Math.abs(openY - closeY));
      ctx.fillRect(x, bodyY, candleWidth, bodyH);
    });

    // Highlight selected trade on chart if any
    if (state.selectedTradeId) {
      const trade = state.currentReport.trades.find(t => t.id === state.selectedTradeId);
      if (trade) {
        const xEntry = 20 + trade.entryIndex * ((width - 60) / count);
        const xExit = 20 + trade.exitIndex * ((width - 60) / count);

        ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
        ctx.fillRect(xEntry, 10, Math.max(candleWidth, xExit - xEntry + candleWidth), height - 40);

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.strokeRect(xEntry, 10, Math.max(candleWidth, xExit - xEntry + candleWidth), height - 40);
      }
    }
  }

  // Quota Modal Handler
  function openQuotaExhaustedModal(preservedParams) {
    if (!el.quotaModal) return;
    el.quotaModal.classList.add('active');

    const desc = document.getElementById('quota-modal-params');
    if (desc && preservedParams) {
      desc.textContent = `Parámetros guardados: ${preservedParams.symbol || 'BTCUSDT'} • Lookback: ${preservedParams.lookback || 20} • Salida: ${preservedParams.exitLookback || 10} • SL ATR: ${preservedParams.stopLossAtr || 2.0}`;
    }
  }

  // Plan Selection & Checkout
  async function handleSelectPlan(planCode) {
    if (planCode === 'FREE') {
      if (!state.user) openAuthModal('register');
      else alert('Tu cuenta ya tiene activo el plan Pirapire Gratis.');
      return;
    }

    if (!state.user) {
      openAuthModal('register', 'Creá tu cuenta para suscribirte a Pirapire Pro.');
      return;
    }

    // Create checkout session
    const res = await apiCall('/api/billing/checkout', {
      method: 'POST',
      body: { planCode: 'PRO' }
    });

    if (res.ok && res.data.session) {
      openCheckoutModal(res.data.session);
    } else {
      alert(`Error creando sesión de pago: ${res.data.message || ''}`);
    }
  }

  function openCheckoutModal(session) {
    if (!el.checkoutModal) return;
    el.checkoutModal.classList.add('active');

    document.getElementById('checkout-order-id').textContent = session.orderId;
    document.getElementById('checkout-amount').textContent = session.amountFormatted || '₲ 190.000';
    document.getElementById('checkout-expires').textContent = session.effectiveAccessUntil || '30 días de acceso';

    // Attach simulation payment button (Calls server-side sandbox simulator rather than client-forged webhook)
    const payBtn = document.getElementById('checkout-simulate-pay-btn');
    if (payBtn) {
      payBtn.onclick = async () => {
        payBtn.disabled = true;
        payBtn.textContent = 'Verificando pago sandbox con servidor...';

        const simRes = await apiCall('/api/billing/sandbox/simulate-payment', {
          method: 'POST',
          body: { orderId: session.orderId }
        });

        payBtn.disabled = false;
        payBtn.textContent = 'Simular Pago Exitoso (Sandbox)';

        if (simRes.ok) {
          el.checkoutModal.classList.remove('active');
          alert('¡Pago verificado con éxito! Tu acceso a Pirapire Pro fue activado por 30 días.');
          await loadAuthState();
          openAccountModal();

          // Resume preserved backtest if any
          checkAndResumePreservedBacktest();
        } else {
          alert(`Fallo en la activación del pago: ${simRes.data.message || 'Error en servidor'}`);
        }
      };
    }
  }

  // Account Modal
  async function openAccountModal() {
    if (!el.accountModal || !state.user) return;
    el.accountModal.classList.add('active');

    document.getElementById('acc-email').textContent = state.user.email;
    const planBadge = document.getElementById('acc-plan-badge');
    planBadge.textContent = state.user.plan;
    planBadge.className = `badge ${state.user.plan === 'PRO' ? 'badge-green' : 'badge-amber'}`;

    const subRes = await apiCall('/api/billing/subscription');
    const sub = subRes.ok ? subRes.data : {};

    const expiresEl = document.getElementById('acc-expires');
    const daysEl = document.getElementById('acc-remaining-days');
    if (expiresEl) expiresEl.textContent = sub.expiresAtFormatted || 'N/A';
    if (daysEl) daysEl.textContent = sub.remainingDays !== undefined ? `${sub.remainingDays} días` : 'N/A';

    // Desktop Download Button (Secure Ticket Pattern)
    const dlBtn = document.getElementById('acc-download-btn');
    const dlWarning = document.getElementById('acc-download-warning');
    if (dlBtn) {
      if (sub.canDownloadDesktop || state.user.plan === 'PRO') {
        dlBtn.style.display = 'inline-flex';
        dlBtn.disabled = false;
        if (dlWarning) dlWarning.style.display = 'none';

        dlBtn.onclick = async () => {
          dlBtn.disabled = true;
          dlBtn.textContent = 'Generando ticket de descarga seguro...';

          const ticketRes = await apiCall('/api/download/request-ticket', { method: 'POST' });
          dlBtn.disabled = false;
          dlBtn.textContent = '⬇ Descargar Pirapire Desktop (Windows x64 v1.0.0)';

          if (ticketRes.ok && ticketRes.data.downloadUrl) {
            const finalDlUrl = window.PIRAPIRE_CONFIG
              ? window.PIRAPIRE_CONFIG.resolveEndpoint(ticketRes.data.downloadUrl)
              : ticketRes.data.downloadUrl;
            window.location.href = finalDlUrl;
          } else {
            alert(ticketRes.data.message || 'No tenés permisos para descargar el instalador.');
          }
        };
      } else {
        dlBtn.style.display = 'inline-flex';
        dlBtn.disabled = true;
        if (dlWarning) {
          dlWarning.style.display = 'block';
          dlWarning.textContent = 'La descarga de Pirapire Desktop está reservada para usuarios con suscripción activa a Pirapire Pro.';
        }
      }
    }
  }

  // Check Binance Testnet
  async function checkTestnetStatus() {
    const res = await apiCall('/api/testnet/status');
    if (res.ok) {
      state.testnetStatus = res.data;
      const statusEl = document.getElementById('testnet-live-status');
      if (statusEl) {
        statusEl.textContent = res.data.connected ? 'ONLINE (TESTNET)' : 'OFFLINE';
        statusEl.className = `badge ${res.data.connected ? 'badge-green' : 'badge-red'}`;
      }
    }
  }

  // Show Download Manifest Checksum Modal
  async function showManifestModal() {
    const res = await apiCall('/api/download/manifest');
    if (res.ok && res.data.manifest) {
      const m = res.data.manifest;
      alert(`[MANIFIESTO DE SEGURIDAD PIRAPIRE DESKTOP]\n\nArchivo: ${m.fileName}\nVersión: ${m.version}\nTamaño: ${m.fileSizeFormatted}\nSHA-256: ${m.sha256}\nFirma: ${m.signingStatus}\n\nComprobación en PowerShell:\nGet-FileHash -Algorithm SHA256 Pirapire-Desktop-Windows-x64-v1.0.0.zip`);
    } else {
      alert('[MANIFIESTO PRECALCULADO PIRAPIRE DESKTOP]\n\nArchivo: Pirapire-Desktop-Windows-x64-v1.0.0.zip\nVersión: 1.0.0\nTamaño: 11.1 KB\nSHA-256: 968a75cb96b6d72cd9861b4d6a73b7e8e9d113e7c395b126d0f13eeb70082098\n\nComprobación en PowerShell:\nGet-FileHash -Algorithm SHA256 Pirapire-Desktop-Windows-x64-v1.0.0.zip');
    }
  }

  // Auth Modal
  function openAuthModal(mode = 'login', notice = '') {
    if (!el.authModal) return;
    el.authModal.classList.add('active');

    const title = document.getElementById('auth-modal-title');
    const submitBtn = document.getElementById('auth-modal-submit');
    const toggleLink = document.getElementById('auth-modal-toggle');
    const noticeEl = document.getElementById('auth-modal-notice');

    if (noticeEl) noticeEl.textContent = notice || '';

    if (mode === 'register') {
      title.textContent = 'Crear cuenta en Pirapire';
      submitBtn.textContent = 'Registrarme y probar gratis';
      toggleLink.textContent = '¿Ya tenés cuenta? Iniciá sesión';
      toggleLink.onclick = () => openAuthModal('login');
    } else {
      title.textContent = 'Iniciar sesión en Pirapire';
      submitBtn.textContent = 'Ingresar a mi cuenta';
      toggleLink.textContent = '¿No tenés cuenta? Registrate gratis';
      toggleLink.onclick = () => openAuthModal('register');
    }

    const form = document.getElementById('auth-form');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;

        const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const res = await apiCall(endpoint, {
          method: 'POST',
          body: {
            email,
            password,
            appBaseUrl: window.location.origin + (window.location.pathname.includes('/pirapire') ? '/pirapire' : '')
          }
        });

        if (res.ok) {
          state.sessionToken = res.data.sessionToken;
          localStorage.setItem('pirapire_token', res.data.sessionToken);
          el.authModal.classList.remove('active');
          await loadAuthState();

          let msg = mode === 'register'
            ? '¡Cuenta creada! Ya tenés acceso a tus 5 pruebas gratis.'
            : '¡Bienvenido de vuelta!';

          if (res.data.emailDelivery && res.data.emailDelivery.isTestMode && res.data.verifyUrl) {
            msg += `\n\n[MODO DE PRUEBA]\nPodés confirmar tu cuenta con este enlace:\n${res.data.verifyUrl}`;
          }
          alert(msg);
        } else {
          alert(res.data.message || 'Error en autenticación');
        }
      };
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Expose global methods
  window.app = {
    handleSelectPlan,
    selectTrade,
    openAuthModal,
    openAccountModal,
    startHeroPlayback,
    showManifestModal,
    logout: () => {
      localStorage.removeItem('pirapire_token');
      state.sessionToken = null;
      state.user = null;
      updateAuthUI(null);
      if (el.accountModal) el.accountModal.classList.remove('active');
      window.location.reload();
    }
  };

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
