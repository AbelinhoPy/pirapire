// public/js/config.js - Pirapire Centralized Client Configuration
(function() {
  'use strict';

  const hostname = window.location.hostname;
  const isGitHubPages = hostname.includes('github.io');
  
  // Storage key for backend API URL override
  const STORAGE_KEY = 'pirapire_backend_url';

  // Determine active API URL
  function resolveApiBaseUrl() {
    const customUrl = localStorage.getItem(STORAGE_KEY);
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/$/, '');
    }
    if (window.PIRAPIRE_API_URL) {
      return window.PIRAPIRE_API_URL.replace(/\/$/, '');
    }
    // On GitHub Pages: use configured production/cloud backend or current origin if same-origin
    if (isGitHubPages) {
      // Default cloud backend / active public tunnel
      return 'https://electronics-struck-smallest-flavor.trycloudflare.com';
    }
    // Same-origin (e.g. running on Node server directly)
    return '';
  }

  const CONFIG = {
    PRODUCT_NAME: 'Pirapire',
    VERSION: '1.0.0',
    IS_GITHUB_PAGES: isGitHubPages,
    BASE_PATH: isGitHubPages ? '/pirapire/' : '/',
    TUNNEL_HEADERS: {
      'Bypass-Tunnel-Reminder': 'true'
    },
    get API_BASE_URL() {
      return resolveApiBaseUrl();
    },
    setApiBaseUrl(newUrl) {
      if (newUrl && newUrl.trim()) {
        localStorage.setItem(STORAGE_KEY, newUrl.trim().replace(/\/$/, ''));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    // Confirmed business data & pending markers
    MERCHANT: {
      name: 'Pirapire',
      commercialStatus: 'Proyecto en fase beta cerrada (Entidad operadora en Paraguay: pendiente de designación formal por el titular)',
      taxId: '[Pendiente de confirmación por el titular]',
      locations: 'Asunción / Ciudad del Este (Sede técnica de desarrollo preliminar)',
      contactEmail: 'soporte@pirapire.com.py',
      gatewayNotice: 'Operando en pasarela Sandbox de pruebas (SIPAP / Pagopar).'
    },
    // Single Source of Truth for Pricing & Plans
    PRICING: {
      currency: 'PYG',
      currencySymbol: '₲',
      proPricePyg: 190000,
      proPriceFormatted: '₲ 190.000',
      proPriceUsdApprox: 25,
      billingInterval: '30_DAYS',
      durationDays: 30,
      freeBacktestsLimit: 5,
      freeFootballQueriesLimit: 1
    },
    /**
     * Resolves an API endpoint taking into account cross-domain or same-domain deployment.
     */
    resolveEndpoint(path) {
      if (!path) return '';
      if (path.startsWith('http://') || path.startsWith('https://')) return path;
      const cleanPath = path.startsWith('/') ? path : '/' + path;
      const base = this.API_BASE_URL;
      return base ? `${base}${cleanPath}` : cleanPath;
    },
    /**
     * Checks if backend API is reachable.
     */
    async checkHealth() {
      try {
        const url = this.resolveEndpoint('/api/health');
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Bypass-Tunnel-Reminder': 'true' },
          mode: 'cors'
        });
        if (res.ok) {
          const data = await res.json();
          return { online: true, data };
        }
        return { online: false, status: res.status };
      } catch (err) {
        return { online: false, error: err.message };
      }
    },
    /**
     * Display offline notice in UI
     */
    showOfflineNotice() {
      const banner = document.getElementById('api-status-banner');
      if (banner) banner.style.display = 'block';
    },
    /**
     * Hide offline notice in UI
     */
    hideOfflineNotice() {
      const banner = document.getElementById('api-status-banner');
      if (banner) banner.style.display = 'none';
    },
    /**
     * Sets up banner button handlers if present
     */
    setupBannerHandlers() {
      const retryBtn = document.getElementById('btn-retry-api');
      const configBtn = document.getElementById('btn-config-api');

      if (retryBtn && !retryBtn._bound) {
        retryBtn._bound = true;
        retryBtn.addEventListener('click', async () => {
          retryBtn.textContent = 'Verificando...';
          const health = await CONFIG.checkHealth();
          retryBtn.textContent = 'Reintentar conexión';
          if (health.online) {
            CONFIG.hideOfflineNotice();
            window.location.reload();
          } else {
            alert('El servidor aún no responde en: ' + (CONFIG.API_BASE_URL || window.location.origin) + '\nPodés configurar una URL alternativa con el botón "Configurar URL API".');
          }
        });
      }

      if (configBtn && !configBtn._bound) {
        configBtn._bound = true;
        configBtn.addEventListener('click', () => {
          const current = CONFIG.API_BASE_URL;
          const entered = prompt('Ingresá la URL del servidor backend de Pirapire (ej. https://mi-backend.onrender.com o URL de túnel):', current);
          if (entered !== null) {
            CONFIG.setApiBaseUrl(entered);
            window.location.reload();
          }
        });
      }
    }
  };

  window.PIRAPIRE_CONFIG = CONFIG;
  window.PirapireConfig = CONFIG;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CONFIG.setupBannerHandlers());
  } else {
    CONFIG.setupBannerHandlers();
  }
})();
