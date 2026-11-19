// public/js/futbol.js - Pirapire Fútbol Client Application
(function() {
  'use strict';

  // Application State
  const state = {
    user: null,
    sessionToken: localStorage.getItem('pirapire_token') || null,
    fixtures: [],
    selectedMatchId: 'par-2024-cl-01', // Olimpia vs Cerro Porteño by default
    activeSponsor: null,
    preservedQuery: null, // Preserved question upon quota exhaustion
    pendingQuery: null    // Preserved question for visitor registration
  };

  // Cached DOM Elements
  const el = {};

  async function init() {
    bindDOMElements();
    setupEventListeners();
    await loadAuthState();
    await loadFixtures();
    await loadPublicSample();
    await loadSponsorship();
    await loadPredictionsArchive();
  }

  function bindDOMElements() {
    el.userPlanBadge = document.getElementById('user-plan-badge');
    el.btnAuthHeader = document.getElementById('btn-auth-header');
    el.fixturesContainer = document.getElementById('fixtures-container');
    el.chatMatchSelect = document.getElementById('chat-match-select');
    el.chatQuotaBadge = document.getElementById('chat-quota-badge');
    el.queryForm = document.getElementById('football-query-form');
    el.customQuestionInput = document.getElementById('football-custom-question');
    el.submitBtn = document.getElementById('football-submit-btn');
    el.responseTimestamp = document.getElementById('response-timestamp');
    el.responseTextBody = document.getElementById('response-text-body');
    el.responseProbBar = document.getElementById('response-prob-bar-container');
    el.responseFactorsList = document.getElementById('response-factors-list');
    el.sponsorshipBox = document.getElementById('sponsorship-box');
    el.sponsorBrand = document.getElementById('sponsor-brand');
    el.sponsorTagline = document.getElementById('sponsor-tagline');
    el.sponsorCtaBtn = document.getElementById('sponsor-cta-btn');
    el.predictionsHistoryTbody = document.getElementById('predictions-history-tbody');
    el.compareBtn = document.getElementById('compare-btn');
    el.compareResults = document.getElementById('compare-results');
    el.compareTeamA = document.getElementById('compare-team-a');
    el.compareTeamB = document.getElementById('compare-team-b');

    // Modals
    el.authModal = document.getElementById('auth-modal');
    el.quotaModal = document.getElementById('football-quota-modal');
    el.preservedQueryCard = document.getElementById('football-preserved-query-card');
    el.checkoutModal = document.getElementById('checkout-modal');
    el.checkoutPayBtn = document.getElementById('checkout-pay-btn');
  }

  function setupEventListeners() {
    // Header Auth Button
    if (el.btnAuthHeader) {
      el.btnAuthHeader.addEventListener('click', () => {
        if (state.user) {
          window.location.href = 'cuenta.html';
        } else {
          openAuthModal('login');
        }
      });
    }

    // Custom query submission
    if (el.queryForm) {
      el.queryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const question = el.customQuestionInput.value.trim();
        if (question) {
          await submitQuestion(question);
        }
      });
    }

    // Modal Close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    // Close modal on click outside box
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });
  }

  // API Helper with Bearer Token
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
      const res = await fetch(endpoint, { credentials: 'same-origin', ...options, headers });
      const json = await res.json();
      return { status: res.status, ok: res.ok, data: json };
    } catch (err) {
      return { status: 500, ok: false, data: { error: 'NETWORK_ERROR', message: err.message } };
    }
  }

  // Load User Authentication State
  async function loadAuthState() {
    if (!state.sessionToken) {
      updateAuthUI(null);
      return;
    }
    const res = await apiCall('/api/auth/me');
    if (res.ok && res.data.user) {
      state.user = res.data.user;
      updateAuthUI(state.user);
    } else {
      state.sessionToken = null;
      localStorage.removeItem('pirapire_token');
      updateAuthUI(null);
    }
  }

  function updateAuthUI(user) {
    const navCuenta = document.getElementById('futbol-nav-cuenta');
    if (user) {
      el.btnAuthHeader.textContent = 'Mi Cuenta';
      if (navCuenta) navCuenta.style.display = 'inline-block';
      if (user.plan === 'PRO') {
        el.userPlanBadge.textContent = 'PRO ACTIVO';
        el.userPlanBadge.className = 'badge badge-green';
        el.chatQuotaBadge.textContent = 'Pirapire Pro (Consultas ilimitadas)';
        el.chatQuotaBadge.className = 'badge badge-green';
      } else {
        el.userPlanBadge.textContent = 'PLAN GRATIS';
        el.userPlanBadge.className = 'badge badge-amber';
        el.chatQuotaBadge.textContent = '1 consulta gratis disponible';
        el.chatQuotaBadge.className = 'badge badge-amber';
      }
    } else {
      el.btnAuthHeader.textContent = 'Iniciar sesión';
      el.userPlanBadge.textContent = 'VISITANTE';
      el.userPlanBadge.className = 'badge badge-muted';
      el.chatQuotaBadge.textContent = '1 consulta gratis al registrarte';
      el.chatQuotaBadge.className = 'badge badge-muted';
    }
  }

  // Load Fixtures
  async function loadFixtures() {
    let data = null;
    const res = await apiCall('/api/futbol/fixtures');
    if (res.ok && res.data.fixtures) {
      data = res.data;
    } else {
      try {
        const fallbackRes = await fetch('futbol_bundle.json');
        if (fallbackRes.ok) {
          const bundle = await fallbackRes.json();
          data = bundle.fixtures;
        }
      } catch (_) {}
    }
    if (data && data.fixtures) {
      state.fixtures = data.fixtures;
      renderFeaturedMatch(data.featuredMatch);
      renderFixturesList(data.fixtures);
      populateMatchSelect(data.fixtures);
    }
  }

  function renderFeaturedMatch(match) {
    if (!match) return;
    const compEl = document.getElementById('featured-competition');
    const statusEl = document.getElementById('featured-status-badge');
    const kickoffEl = document.getElementById('featured-kickoff');
    const homeNameEl = document.getElementById('featured-home-name');
    const awayNameEl = document.getElementById('featured-away-name');
    const homeFormEl = document.getElementById('featured-home-form');
    const awayFormEl = document.getElementById('featured-away-form');

    if (compEl) compEl.textContent = `${match.round} • Torneo ${match.tournament}`;
    if (statusEl) {
      statusEl.textContent = match.status;
      statusEl.className = `badge ${match.status === 'PROGRAMADO' ? 'badge-green' : 'badge-amber'}`;
    }
    if (kickoffEl) kickoffEl.textContent = `${match.kickoffParaguay} (Horario de Asunción)`;
    if (homeNameEl) homeNameEl.textContent = match.homeTeam;
    if (awayNameEl) awayNameEl.textContent = match.awayTeam;
    if (homeFormEl && match.homeStats) {
      homeFormEl.textContent = `Forma: ${match.homeStats.form.join(' - ')}`;
    }
    if (awayFormEl && match.awayStats) {
      awayFormEl.textContent = `Forma: ${match.awayStats.form.join(' - ')}`;
    }
  }

  function renderFixturesList(fixtures) {
    if (!el.fixturesContainer) return;
    el.fixturesContainer.innerHTML = '';

    fixtures.forEach(f => {
      const card = document.createElement('div');
      card.className = `fixture-item-card ${f.id === state.selectedMatchId ? 'selected' : ''}`;
      card.dataset.matchId = f.id;

      let statusBadgeHtml = '';
      if (f.status === 'FINALIZADO') {
        statusBadgeHtml = `<span class="badge badge-muted">${f.status}: ${f.score.home} - ${f.score.away}</span>`;
      } else if (f.status === 'APLAZADO') {
        statusBadgeHtml = `<span class="badge badge-red" title="${f.notes || ''}">APLAZADO</span>`;
      } else if (f.insufficientData) {
        statusBadgeHtml = `<span class="badge badge-amber" title="Menos de 3 partidos registrados">DATOS INSUFICIENTES</span>`;
      } else {
        statusBadgeHtml = `<span class="badge badge-green">PROGRAMADO</span>`;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <span style="font-size:11px; font-family:var(--font-mono); color:var(--text-muted);">${f.kickoffParaguay}</span>
          ${statusBadgeHtml}
        </div>
        <div style="font-weight:700; font-size:15px; margin-bottom:6px; color:#fff;">
          ${f.homeTeam} vs ${f.awayTeam}
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">
          🏟️ ${f.venue} (${f.city})
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:8px;">
          <span style="font-size:11px; font-family:var(--font-mono); color:var(--amber-primary);">
            ${f.insufficientData ? '⚠️ Requiere más historial' : (f.status === 'APLAZADO' ? '⚠️ ' + f.notes : 'Poisson disponible')}
          </span>
          <button class="btn btn-secondary btn-sm" onclick="window.futbolApp.selectMatch('${f.id}')">
            Abrir Ficha
          </button>
        </div>
      `;

      el.fixturesContainer.appendChild(card);
    });
  }

  function populateMatchSelect(fixtures) {
    if (!el.chatMatchSelect) return;
    el.chatMatchSelect.innerHTML = '';
    fixtures.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      let label = `${f.homeTeam} vs ${f.awayTeam}`;
      if (f.status === 'APLAZADO') label += ' (Aplazado)';
      if (f.status === 'FINALIZADO') label += ` (${f.score.home}-${f.score.away})`;
      if (f.insufficientData) label += ' (Datos en proceso)';
      opt.textContent = label;
      if (f.id === state.selectedMatchId) opt.selected = true;
      el.chatMatchSelect.appendChild(opt);
    });
  }

  // Load Public Sample Consultation for Visitors
  async function loadPublicSample() {
    let analysis = null;
    const res = await apiCall('/api/futbol/public-sample');
    if (res.ok && res.data.analysis) {
      analysis = res.data.analysis;
    } else {
      try {
        const fallbackRes = await fetch('futbol_bundle.json');
        if (fallbackRes.ok) {
          const bundle = await fallbackRes.json();
          analysis = bundle.sampleAnalysis;
        }
      } catch (_) {}
    }
    if (analysis) {
      renderAnalysis(analysis, 'VISITANTE', 1, true);
    }
  }

  // Render Analysis Bubble and Probability Visuals
  function renderAnalysis(analysis, userPlan, remainingQueries, isPublic = false) {
    if (!analysis) return;

    if (el.responseTimestamp) {
      const dateStr = analysis.lastUpdated ? new Date(analysis.lastUpdated).toLocaleDateString('es-PY') : 'Reciente';
      el.responseTimestamp.textContent = `Fuente: ${analysis.source || 'APF Oficial'} • ${dateStr}`;
    }

    if (el.responseTextBody) {
      el.responseTextBody.textContent = analysis.explanation;
    }

    // Render Poisson Probability Bar
    if (analysis.model && analysis.model.hasProbabilities && analysis.model.probabilities) {
      const probs = analysis.model.probabilities;
      el.responseProbBar.style.display = 'block';
      el.responseProbBar.innerHTML = `
        <div style="font-size:11px; font-family:var(--font-mono); color:var(--text-muted); margin-bottom:4px; display:flex; justify-content:space-between;">
          <span style="color:#10b981;">Local (${analysis.match.homeTeam}): ${probs.homeWinPct}%</span>
          <span style="color:#9ca3af;">Empate: ${probs.drawPct}%</span>
          <span style="color:#3b82f6;">Visitante (${analysis.match.awayTeam}): ${probs.awayWinPct}%</span>
        </div>
        <div class="prob-bar-container">
          <div class="prob-seg-home" style="width:${probs.homeWinPct}%;">${probs.homeWinPct}%</div>
          <div class="prob-seg-draw" style="width:${probs.drawPct}%;">${probs.drawPct}%</div>
          <div class="prob-seg-away" style="width:${probs.awayWinPct}%;">${probs.awayWinPct}%</div>
        </div>
        <div style="font-size:11px; font-family:var(--font-mono); color:var(--text-secondary); margin-top:4px;">
          Goles esperados Poisson: ${analysis.match.homeTeam} (${analysis.model.expectedGoalsHome}) — ${analysis.match.awayTeam} (${analysis.model.expectedGoalsAway}) • Marcador más probable: ${probs.mostLikelyScore.home}-${probs.mostLikelyScore.away}
        </div>
      `;
    } else {
      // Postponed or Insufficient history
      el.responseProbBar.style.display = 'none';
    }

    // Render Statistical Factors List
    if (analysis.factors && analysis.factors.length > 0) {
      el.responseFactorsList.style.display = 'block';
      el.responseFactorsList.innerHTML = `
        <strong>Factores estadísticos considerados:</strong>
        <ul style="padding-left:18px; margin-top:6px; line-height:1.6;">
          ${analysis.factors.map(f => `<li>${f}</li>`).join('')}
        </ul>
      `;
    } else {
      el.responseFactorsList.style.display = 'none';
    }

    // Update Quota display
    if (!isPublic) {
      if (userPlan === 'PRO') {
        el.chatQuotaBadge.textContent = 'Pirapire Pro (Consultas ilimitadas)';
        el.chatQuotaBadge.className = 'badge badge-green';
      } else {
        const rem = typeof remainingQueries === 'number' ? remainingQueries : 0;
        el.chatQuotaBadge.textContent = `${rem} consulta gratis disponible`;
        el.chatQuotaBadge.className = rem > 0 ? 'badge badge-amber' : 'badge badge-muted';
      }
    }
  }

  // Submit Interactive Question
  async function submitQuestion(question) {
    const matchId = state.selectedMatchId;
    el.submitBtn.disabled = true;
    el.submitBtn.textContent = 'Analizando partido...';

    const res = await apiCall('/api/futbol/ask', {
      method: 'POST',
      body: { matchId, question }
    });

    el.submitBtn.disabled = false;
    el.submitBtn.textContent = 'Consultar a Pirapire';

    // 1. Visitor needs to sign up (HTTP 401)
    if (res.status === 401) {
      state.pendingQuery = { matchId, question };
      openAuthModal('register', 'Creá tu cuenta gratis para probar una consulta interactiva en Pirapire Fútbol.');
      return;
    }

    // 2. Free User Quota Exhausted (HTTP 403)
    if (res.status === 403 && res.data.code === 'FOOTBALL_QUOTA_EXHAUSTED') {
      state.preservedQuery = { matchId, question };
      openQuotaModal(state.preservedQuery);
      return;
    }

    // 3. Success
    if (res.ok && res.data.analysis) {
      renderAnalysis(res.data.analysis, res.data.userPlan, res.data.remainingQueries, false);
      await loadPredictionsArchive(); // Refresh history
      // Smooth scroll to response
      document.getElementById('chat-response-area').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      alert(res.data.message || 'No se pudo completar el análisis.');
    }
  }

  // Open Quota Modal and preserve the question
  function openQuotaModal(preserved) {
    if (!el.quotaModal) return;
    const match = state.fixtures.find(f => f.id === preserved.matchId);
    const matchTitle = match ? `${match.homeTeam} vs ${match.awayTeam}` : preserved.matchId;

    if (el.preservedQueryCard) {
      el.preservedQueryCard.innerHTML = `
        <div><strong>Partido:</strong> ${matchTitle}</div>
        <div style="margin-top:4px;"><strong>Pregunta guardada:</strong> "${preserved.question}"</div>
      `;
    }
    el.quotaModal.classList.add('active');
  }

  // Open Pro Checkout Modal
  async function openProCheckout() {
    if (!state.user) {
      if (el.quotaModal) el.quotaModal.classList.remove('active');
      openAuthModal('register', 'Creá tu cuenta para suscribirte a Pirapire Pro.');
      return;
    }

    const res = await apiCall('/api/billing/checkout', {
      method: 'POST',
      body: { planCode: 'PRO' }
    });

    if (res.ok && res.data.session) {
      if (el.quotaModal) el.quotaModal.classList.remove('active');
      openCheckoutModal(res.data.session);
    } else {
      alert('Error al iniciar checkout: ' + (res.data.message || ''));
    }
  }

  function openCheckoutModal(session) {
    if (!el.checkoutModal) return;
    el.checkoutModal.classList.add('active');

    if (el.checkoutPayBtn) {
      el.checkoutPayBtn.onclick = async () => {
        el.checkoutPayBtn.disabled = true;
        el.checkoutPayBtn.textContent = 'Verificando con pasarela local...';

        const webhookRes = await apiCall('/api/billing/webhook', {
          method: 'POST',
          body: {
            eventType: 'PAYMENT_SUCCESS',
            orderId: session.orderId,
            idempotencyKey: `idem_futbol_${session.orderId}_${Date.now()}`,
            amountPyg: session.amountPyg,
            paymentMethod: 'TARJETA_SIPAP_BANCARD'
          }
        });

        el.checkoutPayBtn.disabled = false;
        el.checkoutPayBtn.textContent = 'Confirmar y Activar Pro (Sandbox)';

        if (webhookRes.ok) {
          el.checkoutModal.classList.remove('active');
          alert('¡Pago verificado! Tu suscripción a Pirapire Pro fue activada con éxito por 30 días.');
          await loadAuthState();

          // If there was a preserved query, resume it automatically!
          if (state.preservedQuery) {
            const queryToResume = { ...state.preservedQuery };
            state.preservedQuery = null;
            await submitQuestion(queryToResume.question);
          }
        } else {
          alert('Error en la confirmación del pago.');
        }
      };
    }
  }

  // Pro Feature: Compare Two Teams
  async function handleCompareClick() {
    const teamA = el.compareTeamA.value;
    const teamB = el.compareTeamB.value;

    if (teamA === teamB) {
      alert('Seleccioná dos equipos diferentes para comparar.');
      return;
    }

    el.compareBtn.disabled = true;
    el.compareBtn.textContent = 'Consultando estadísticas...';

    const res = await apiCall('/api/futbol/compare', {
      method: 'POST',
      body: { teamA, teamB }
    });

    el.compareBtn.disabled = false;
    el.compareBtn.textContent = 'Comparar Equipos (Requiere Pro)';

    if (res.status === 401) {
      openAuthModal('login', 'Iniciá sesión con tu cuenta Pro para comparar equipos.');
      return;
    }

    if (res.status === 403) {
      alert('La comparación directa de equipos es exclusiva de Pirapire Pro. Activá Pro para acceder.');
      openProCheckout();
      return;
    }

    if (res.ok && res.data.teamA && res.data.teamB) {
      renderCompareResults(res.data.teamA, res.data.teamB, res.data.modelComparison);
    } else {
      alert(res.data.message || 'No se pudo generar la comparación.');
    }
  }

  function renderCompareResults(teamA, teamB, model) {
    if (!el.compareResults) return;
    el.compareResults.style.display = 'block';

    let modelHtml = '';
    if (model && model.hasProbabilities && model.probabilities) {
      modelHtml = `
        <div style="background:#11141d; border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; padding:16px; margin-top:16px;">
          <div style="font-size:12px; font-weight:700; color:var(--amber-primary); font-family:var(--font-mono); margin-bottom:8px;">
            PROYECCIÓN POISSON NEUTRAL (CANCHA NEUTRAL)
          </div>
          <div style="font-size:13px; color:#fff; margin-bottom:8px;">
            ${teamA.name}: ${model.probabilities.homeWinPct}% • Empate: ${model.probabilities.drawPct}% • ${teamB.name}: ${model.probabilities.awayWinPct}%
          </div>
          <div class="prob-bar-container">
            <div class="prob-seg-home" style="width:${model.probabilities.homeWinPct}%;">${model.probabilities.homeWinPct}%</div>
            <div class="prob-seg-draw" style="width:${model.probabilities.drawPct}%;">${model.probabilities.drawPct}%</div>
            <div class="prob-seg-away" style="width:${model.probabilities.awayWinPct}%;">${model.probabilities.awayWinPct}%</div>
          </div>
        </div>
      `;
    }

    el.compareResults.innerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-top:16px;">
        <div style="background:#151821; border:1px solid var(--border-color); border-radius:8px; padding:16px;">
          <h4 style="color:var(--amber-primary); margin-bottom:12px;">${teamA.name}</h4>
          <div style="font-size:12px; line-height:1.8; color:var(--text-secondary); font-family:var(--font-mono);">
            <div>Puntos totales: <strong style="color:#fff;">${teamA.points}</strong> (${teamA.played} PJ)</div>
            <div>Goles a favor: <strong style="color:#fff;">${teamA.goalsFor}</strong> (${(teamA.goalsFor / teamA.played).toFixed(2)} p/p)</div>
            <div>Goles en contra: <strong style="color:#fff;">${teamA.goalsAgainst}</strong> (${(teamA.goalsAgainst / teamA.played).toFixed(2)} p/p)</div>
            <div>Vallas invictas: <strong style="color:#fff;">${teamA.cleanSheets}</strong></div>
            <div>Racha reciente: <span style="color:#10b981;">${teamA.form.join(' - ')}</span></div>
          </div>
        </div>

        <div style="background:#151821; border:1px solid var(--border-color); border-radius:8px; padding:16px;">
          <h4 style="color:#3b82f6; margin-bottom:12px;">${teamB.name}</h4>
          <div style="font-size:12px; line-height:1.8; color:var(--text-secondary); font-family:var(--font-mono);">
            <div>Puntos totales: <strong style="color:#fff;">${teamB.points}</strong> (${teamB.played} PJ)</div>
            <div>Goles a favor: <strong style="color:#fff;">${teamB.goalsFor}</strong> (${(teamB.goalsFor / teamB.played).toFixed(2)} p/p)</div>
            <div>Goles en contra: <strong style="color:#fff;">${teamB.goalsAgainst}</strong> (${(teamB.goalsAgainst / teamB.played).toFixed(2)} p/p)</div>
            <div>Vallas invictas: <strong style="color:#fff;">${teamB.cleanSheets}</strong></div>
            <div>Racha reciente: <span style="color:#10b981;">${teamB.form.join(' - ')}</span></div>
          </div>
        </div>
      </div>
      ${modelHtml}
    `;
  }

  // Load Active Sponsorship
  async function loadSponsorship() {
    let sponsor = null;
    const res = await apiCall('/api/futbol/sponsor');
    if (res.ok && res.data.sponsor) {
      sponsor = res.data.sponsor;
    } else {
      try {
        const fallbackRes = await fetch('futbol_bundle.json');
        if (fallbackRes.ok) {
          const bundle = await fallbackRes.json();
          sponsor = bundle.sponsor;
        }
      } catch (_) {}
    }
    if (sponsor) {
      state.activeSponsor = sponsor;
      renderSponsorship(sponsor);
    } else {
      if (el.sponsorshipBox) el.sponsorshipBox.style.display = 'none';
    }
  }

  function renderSponsorship(sponsor) {
    if (!el.sponsorshipBox || !sponsor) return;
    el.sponsorshipBox.style.display = 'flex';
    if (el.sponsorBrand) el.sponsorBrand.textContent = sponsor.brandName;
    if (el.sponsorTagline) el.sponsorTagline.textContent = sponsor.tagline;
    if (el.sponsorCtaBtn) {
      el.sponsorCtaBtn.textContent = sponsor.ctaText;
      el.sponsorCtaBtn.href = sponsor.targetUrl;
    }
  }

  async function handleSponsorClick() {
    if (state.activeSponsor && state.activeSponsor.id) {
      await apiCall('/api/futbol/sponsor/click', {
        method: 'POST',
        body: { campaignId: state.activeSponsor.id }
      });
    }
  }

  // Load Predictions Archive Table
  async function loadPredictionsArchive() {
    let predictions = null;
    const res = await apiCall('/api/futbol/predictions/history');
    if (res.ok && res.data.predictions) {
      predictions = res.data.predictions;
    } else {
      try {
        const fallbackRes = await fetch('futbol_bundle.json');
        if (fallbackRes.ok) {
          const bundle = await fallbackRes.json();
          predictions = bundle.archive;
        }
      } catch (_) {}
    }
    if (predictions) {
      renderPredictionsArchive(predictions);
    }
  }

  function renderPredictionsArchive(list) {
    if (!el.predictionsHistoryTbody) return;
    el.predictionsHistoryTbody.innerHTML = '';

    if (!list || list.length === 0) {
      el.predictionsHistoryTbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">
            Aún no hay pronósticos archivados.
          </td>
        </tr>
      `;
      return;
    }

    list.forEach(p => {
      const tr = document.createElement('tr');
      const probs = p.probabilities || {};
      const probStr = probs.homeWinPct ? `L: ${probs.homeWinPct}% | E: ${probs.drawPct}% | V: ${probs.awayWinPct}%` : 'N/A';
      
      let evalBadge = '';
      if (p.evaluationResult === 'CORRECT') {
        evalBadge = '<span class="badge badge-green">ACIERTO</span>';
      } else if (p.evaluationResult === 'INCORRECT') {
        evalBadge = '<span class="badge badge-red">NO ACERTADO</span>';
      } else {
        evalBadge = '<span class="badge badge-amber">PENDIENTE</span>';
      }

      const matchLabel = `${p.home_team || 'Equipo A'} vs ${p.away_team || 'Equipo B'}`;
      const actualScore = p.actual_score_home !== null && p.actual_score_away !== null ? `${p.actual_score_home} - ${p.actual_score_away}` : 'Por jugarse';
      const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('es-PY') : 'Pre-partido';

      tr.innerHTML = `
        <td style="font-weight:600; color:#fff;">${matchLabel}</td>
        <td style="font-size:12px; font-family:var(--font-mono); color:var(--text-muted);">${dateStr}</td>
        <td style="font-size:12px; font-family:var(--font-mono);">${probStr}</td>
        <td style="font-weight:700; font-family:var(--font-mono); color:var(--amber-primary);">${actualScore}</td>
        <td>${evalBadge}</td>
      `;

      el.predictionsHistoryTbody.appendChild(tr);
    });
  }

  // Auth Modal Handler
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
      submitBtn.textContent = 'Registrarme y probar consulta';
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
          alert(mode === 'register' ? '¡Cuenta creada! Ya tenés acceso a tu consulta gratuita de Pirapire Fútbol.' : '¡Bienvenido de vuelta!');

          // If visitor had a pending query, resume it now
          if (state.pendingQuery) {
            const queryToResume = { ...state.pendingQuery };
            state.pendingQuery = null;
            await submitQuestion(queryToResume.question);
          }
        } else {
          alert(res.data.message || 'Error en autenticación');
        }
      };
    }
  }

  function logout() {
    localStorage.removeItem('pirapire_token');
    state.sessionToken = null;
    state.user = null;
    updateAuthUI(null);
    window.location.reload();
  }

  // Public Interface for Inline HTML onclick handlers
  window.futbolApp = {
    selectFeaturedMatchForAnalysis: () => {
      window.futbolApp.selectMatch('par-2024-cl-01');
    },
    selectMatch: (matchId) => {
      state.selectedMatchId = matchId;
      if (el.chatMatchSelect) el.chatMatchSelect.value = matchId;
      // Highlight selected card
      document.querySelectorAll('.fixture-item-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.matchId === matchId);
      });
      // Scroll smoothly to analysis
      document.getElementById('analisis').scrollIntoView({ behavior: 'smooth' });
    },
    onMatchSelectChange: (matchId) => {
      state.selectedMatchId = matchId;
      document.querySelectorAll('.fixture-item-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.matchId === matchId);
      });
    },
    askQuick: async (question) => {
      if (el.customQuestionInput) el.customQuestionInput.value = question;
      await submitQuestion(question);
    },
    handleCompareClick,
    handleSponsorClick,
    openProCheckout
  };

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
