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
    testnetStatus: null
  };

  // DOM Elements
  const el = {};

  function init() {
    bindDOMElements();
    setupEventListeners();
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

  // API Helpers
  async function apiCall(endpoint, options = {}) {
    const headers = options.headers || {};
    if (state.sessionToken) {
      headers['Authorization'] = `Bearer ${state.sessionToken}`;
    }
    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    try {
      const res = await fetch(endpoint, { credentials: 'same-origin', credentials: 'omit', ...options, headers });
      const json = await res.json();
      return { status: res.status, ok: res.ok, data: json };
    } catch (err) {
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

  // Load Pricing Config
  async function loadPricingConfig() {
    let pricing = null;
    const res = await apiCall('/api/billing/plans');
    if (res.ok && res.data && res.data.plans) {
      pricing = res.data;
    } else {
      // Fallback for static GitHub Pages preview
      pricing = {
        plans: {
          FREE: {
            name: "Plan Inicial",
            priceFormatted: "₲ 0",
            priceUsdApprox: 0,
            badge: "Acceso Gratuito",
            description: "Probá la estrategia Breakout en Bitcoin y el análisis deportivo sin costo.",
            features: [
              "5 backtests históricos de Breakout con velas reales",
              "1 consulta de fútbol paraguayo (análisis y Poisson)",
              "Gráficos interactivos Donchian + ATR",
              "Métricas completas de rendimiento y lista de trades"
            ],
            notIncluded: [
              "Backtests ilimitados",
              "Consultas ilimitadas de fútbol paraguayo",
              "Comparador de equipos y métricas avanzadas",
              "Descarga de Pirapire Desktop para Windows"
            ],
            ctaText: "Crear cuenta gratis"
          },
          PRO: {
            name: "Pirapire Pro",
            priceFormatted: "₲ 150.000",
            priceUsdApprox: 20,
            badge: "Acceso Total",
            description: "Acceso unificado y sin límites a Cripto y Fútbol paraguayo.",
            features: [
              "Backtests ilimitados en todas las temporalidades",
              "Consultas ilimitadas al bot de análisis de fútbol",
              "Comparador directo de equipos y predicciones archivadas",
              "Descarga inmediata de Pirapire Desktop (Windows x64)",
              "Exportación de operaciones en CSV/JSON",
              "Soporte prioritario por WhatsApp y Telegram"
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
          <span class="price-amount">₲ 0</span>
          <span class="price-interval">/ para siempre</span>
        </div>
        <ul class="features-list">
          ${free.features.map(f => `<li class="included">✓ ${f}</li>`).join('')}
          ${free.notIncluded.map(f => `<li class="excluded">✗ ${f}</li>`).join('')}
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
          <span class="price-interval">/ acceso 30 días (~$${pro.priceUsdApprox} USD)</span>
        </div>
        <ul class="features-list">
          ${pro.features.map(f => `<li class="included">✓ ${f}</li>`).join('')}
        </ul>
        <button class="btn btn-primary" onclick="window.app.handleSelectPlan('PRO')">${pro.ctaText}</button>
      </div>
    `;
  }

  // Load Hero Simulation (Verified Bitcoin Run)
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
    // Start at lookback index
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
    }, 400); // 400ms per candle animation step
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

    // Check if current step has a trade or signal
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

  // High-performance HTML5 Canvas Candlestick Renderer
  function renderHeroChart() {
    const canvas = el.heroCanvas;
    if (!canvas || !state.heroData) return;
    const ctx = canvas.getContext('2d');

    // Set pixel ratio for crisp rendering on retina/4k
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear background
    ctx.fillStyle = '#0a0b0e';
    ctx.fillRect(0, 0, width, height);

    const visibleCandles = state.heroData.candles.slice(0, state.heroPlaybackIndex + 1);
    if (visibleCandles.length === 0) return;

    // Viewport window: show up to last 40 candles for clarity
    const windowSize = Math.min(visibleCandles.length, 45);
    const slice = visibleCandles.slice(-windowSize);

    // Compute min and max price
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    slice.forEach(c => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.upper && c.upper > maxPrice) maxPrice = c.upper;
      if (c.lower && c.lower < minPrice) minPrice = c.lower;
    });

    const padding = (maxPrice - minPrice) * 0.1 || 100;
    minPrice -= padding;
    maxPrice += padding;

    const priceToY = (price) => height - 30 - ((price - minPrice) / (maxPrice - minPrice)) * (height - 60);
    const candleWidth = Math.max(3, (width - 40) / windowSize - 3);

    // Draw Grid Lines
    ctx.strokeStyle = '#181b24';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = 30 + (i * (height - 60) / 4);
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(width - 60, y);
      ctx.stroke();

      const priceVal = maxPrice - (i * (maxPrice - minPrice) / 4);
      ctx.fillStyle = '#4b5563';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${Math.round(priceVal).toLocaleString('en-US')}`, width - 10, y + 3);
    }

    // Draw Donchian Channels (Upper line & Lower line)
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)'; // Cyan upper
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    slice.forEach((c, idx) => {
      const x = 20 + idx * ((width - 70) / windowSize) + candleWidth / 2;
      if (c.upper) {
        const y = priceToY(c.upper);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Candlesticks
    slice.forEach((c, idx) => {
      const x = 20 + idx * ((width - 70) / windowSize);
      const isUp = c.close >= c.open;
      const color = isUp ? '#10b981' : '#ef4444';

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;

      // Wick
      const highY = priceToY(c.high);
      const lowY = priceToY(c.low);
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();

      // Body
      const openY = priceToY(c.open);
      const closeY = priceToY(c.close);
      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.max(2, Math.abs(openY - closeY));
      ctx.fillRect(x, bodyY, candleWidth, bodyH);

      // Check if trade entry on this candle
      const tradeEntry = state.heroData.trades.find(t => t.entryDate === c.date);
      if (tradeEntry) {
        // Draw green entry arrow
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, lowY + 14);
        ctx.lineTo(x + candleWidth / 2 - 5, lowY + 22);
        ctx.lineTo(x + candleWidth / 2 + 5, lowY + 22);
        ctx.fill();
        ctx.font = 'bold 9px monospace';
        ctx.fillText('COMPRA', x - 10, lowY + 34);
      }

      // Check if trade exit on this candle
      const tradeExit = state.heroData.trades.find(t => t.exitDate === c.date);
      if (tradeExit) {
        // Draw red exit arrow
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, highY - 14);
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
    el.simSubmitBtn.textContent = 'Ejecutando backtest...';

    const res = await apiCall('/api/backtest/run', {
      method: 'POST',
      body: payload
    });

    el.simSubmitBtn.disabled = false;
    el.simSubmitBtn.textContent = 'Ejecutar Backtest';

    if (res.status === 403 && res.data.code === 'QUOTA_EXHAUSTED') {
      openQuotaExhaustedModal(res.data.preservedParams);
      return;
    }

    if (res.ok) {
      // Update state quota
      if (state.user.plan !== 'PRO') {
        state.user.completedBacktests = res.data.completedTests;
        state.user.remainingFreeTests = res.data.remainingFreeTests;
        updateQuotaUI();
      }
      renderSimulatorReport(res.data);
    } else {
      alert(`Error en simulación: ${res.data.message || 'Ocurrió un error inesperado.'}`);
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
          <div class="metric-label" style="margin-top:2px;">${m.winningTrades} Ganadoras / ${m.losingTrades} Pérdidas</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Tasa de Acierto</div>
          <div class="metric-value">${m.winRatePct}%</div>
          <div class="metric-label" style="margin-top:2px;">Pérdida: ${m.lossRatePct}%</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Factor de Ganancia</div>
          <div class="metric-value">${m.profitFactor}</div>
          <div class="metric-label" style="margin-top:2px;">Ratio W/L: ${m.winLossRatio}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Comisiones Binance</div>
          <div class="metric-value">$${m.totalFeesPaid}</div>
          <div class="metric-label" style="margin-top:2px;">0.10% Spot maker/taker</div>
        </div>
      `;
    }

    // Trade Table
    if (el.tradesTableBody) {
      if (report.trades.length === 0) {
        el.tradesTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color:#6b7280;">No se registraron operaciones en este rango con estos parámetros.</td></tr>`;
      } else {
        el.tradesTableBody.innerHTML = report.trades.map(t => `
          <tr data-trade-id="${t.id}" onclick="window.app.selectTrade(${t.id})">
            <td>#${t.id}</td>
            <td>${t.entryDate}<br><span style="color:#9ca3af;">$${t.entryPrice.toLocaleString('en-US')}</span></td>
            <td>${t.exitDate}<br><span style="color:#9ca3af;">$${t.exitPrice.toLocaleString('en-US')}</span></td>
            <td>${t.size}</td>
            <td class="${t.isWin ? 'text-green' : 'text-red'}" style="font-weight:700;">
              ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%<br>
              <span style="font-size:11px; font-weight:normal;">$${t.pnl}</span>
            </td>
            <td>${t.exitReason}</td>
            <td><button class="btn btn-secondary btn-sm">Ver</button></td>
          </tr>
        `).join('');
      }
    }

    renderReportChart();
  }

  function selectTrade(tradeId) {
    if (!state.currentReport) return;
    const trade = state.currentReport.trades.find(t => t.id === tradeId);
    if (!trade) return;

    state.selectedTradeId = tradeId;

    // Highlight row
    document.querySelectorAll('#trades-table-body tr').forEach(tr => {
      tr.classList.toggle('selected', tr.getAttribute('data-trade-id') == tradeId);
    });

    // Display detail card
    if (el.tradeDetailCard) {
      el.tradeDetailCard.style.display = 'block';
      el.tradeDetailCard.innerHTML = `
        <div style="background:#151821; border:1px solid #f59e0b; border-radius:6px; padding:16px; margin-top:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:#f59e0b;">Detalle de la Operación #${trade.id}</strong>
            <span class="badge ${trade.isWin ? 'badge-green' : 'badge-red'}">${trade.isWin ? 'GANADORA' : 'PÉRDIDA'}</span>
          </div>
          <p style="margin:8px 0 4px; font-size:13px;">
            <strong>Entrada:</strong> ${trade.entryDate} a $${trade.entryPrice.toLocaleString('en-US')} (Ruptura sobre canal Donchian)
          </p>
          <p style="margin:4px 0; font-size:13px;">
            <strong>Salida:</strong> ${trade.exitDate} a $${trade.exitPrice.toLocaleString('en-US')} (${trade.exitReason})
          </p>
          <p style="margin:4px 0; font-size:13px;">
            <strong>Resultado:</strong> ${trade.pnlPct}% ($${trade.pnl} USDT) • Saldo posterior: $${trade.balanceAfter.toLocaleString('en-US')}
          </p>
        </div>
      `;
    }

    renderReportChart();
  }

  function renderReportChart() {
    const canvas = el.simCanvas;
    if (!canvas || !state.currentReport) return;
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
      desc.textContent = `Parámetros guardados: ${preservedParams.symbol} • Lookback: ${preservedParams.lookback} • Salida: ${preservedParams.exitLookback} • SL ATR: ${preservedParams.stopLossAtr}`;
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
    document.getElementById('checkout-amount').textContent = session.amountFormatted;
    document.getElementById('checkout-expires').textContent = session.effectiveAccessUntil;

    // Attach simulation payment button
    const payBtn = document.getElementById('checkout-simulate-pay-btn');
    if (payBtn) {
      payBtn.onclick = async () => {
        payBtn.disabled = true;
        payBtn.textContent = 'Verificando con pasarela local...';

        const webhookRes = await apiCall('/api/billing/webhook', {
          method: 'POST',
          body: {
            eventType: 'PAYMENT_SUCCESS',
            orderId: session.orderId,
            idempotencyKey: `idem_web_${session.orderId}`,
            amountPyg: session.amountPyg,
            paymentMethod: 'TARJETA_SIPAP_BANCARD'
          }
        });

        payBtn.disabled = false;
        payBtn.textContent = 'Simular Pago Exitoso (Sandbox)';

        if (webhookRes.ok) {
          el.checkoutModal.classList.remove('active');
          alert('¡Pago verificado! Tu suscripción a Pirapire Pro fue activada con éxito por 30 días.');
          await loadAuthState();
          openAccountModal();
        } else {
          alert('Fallo en la activación del pago.');
        }
      };
    }
  }

  // Account Modal
  async function openAccountModal() {
    if (!el.accountModal || !state.user) return;
    el.accountModal.classList.add('active');

    const subRes = await apiCall('/api/billing/subscription');
    const sub = subRes.ok ? subRes.data : {};

    document.getElementById('acc-email').textContent = state.user.email;
    document.getElementById('acc-plan-badge').textContent = state.user.plan;
    document.getElementById('acc-expires').textContent = sub.expiresAtFormatted || 'N/A';
    document.getElementById('acc-remaining-days').textContent = sub.remainingDays !== undefined ? `${sub.remainingDays} días` : 'N/A';

    const cancelBtn = document.getElementById('acc-cancel-sub-btn');
    if (cancelBtn) {
      if (state.user.plan === 'PRO' && !sub.cancelAtPeriodEnd) {
        cancelBtn.style.display = 'inline-block';
        cancelBtn.onclick = async () => {
          if (confirm('¿Confirmás la cancelación de la renovación automática? Conservarás el acceso Pro hasta el final de los 30 días.')) {
            await apiCall('/api/billing/cancel', { method: 'POST' });
            alert('Cancelación programada para el final del período pagado.');
            openAccountModal();
          }
        };
      } else {
        cancelBtn.style.display = 'none';
      }
    }

    // Desktop Download Button
    const dlBtn = document.getElementById('acc-download-btn');
    const dlWarning = document.getElementById('acc-download-warning');
    if (dlBtn) {
      if (sub.canDownloadDesktop) {
        dlBtn.style.display = 'inline-flex';
        dlBtn.disabled = false;
        if (dlWarning) dlWarning.style.display = 'none';
        dlBtn.onclick = () => {
          window.location.href = `/api/download/pirapire-desktop?token=${state.sessionToken}`;
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
      const elStatus = document.getElementById('testnet-status-badge');
      if (elStatus) {
        elStatus.textContent = res.data.status === 'CONNECTED' ? 'ONLINE (FONDOS SIMULADOS)' : 'OFFLINE';
        elStatus.className = `badge ${res.data.status === 'CONNECTED' ? 'badge-green' : 'badge-red'}`;
      }
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
          body: { email, password }
        });

        if (res.ok) {
          state.sessionToken = res.data.sessionToken;
          localStorage.setItem('pirapire_token', res.data.sessionToken);
          el.authModal.classList.remove('active');
          await loadAuthState();
          alert(mode === 'register' ? '¡Cuenta creada! Ya tenés acceso a tus 5 pruebas gratis.' : '¡Bienvenido de vuelta!');
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
