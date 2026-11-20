// scripts/verify_live_public_journeys.js
// Automated verification of all 5 main user journeys over the LIVE public HTTPS backend.
const assert = require('assert');

const BASE_URL = 'https://electronics-struck-smallest-flavor.trycloudflare.com';
const ORIGIN = 'https://abelinhopy.github.io';

const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': ORIGIN,
  'Bypass-Tunnel-Reminder': 'true'
};

async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) }
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, headers: res.headers, data };
}

async function run() {
  console.log('========================================================================');
  console.log('  VERIFICACIÓN DE RECORRIDOS PÚBLICOS DE PIRAPIRE');
  console.log(`  Backend Público: ${BASE_URL}`);
  console.log(`  Origin Frontend: ${ORIGIN}`);
  console.log('========================================================================\n');

  const testEmail = `test.public.${Date.now()}@pirapire.py`;
  const testPassword = 'PasswordSegura2026!#';

  // 1. Health check
  console.log('>>> [1/7] GET /api/health...');
  const health = await api('/api/health');
  assert.strictEqual(health.status, 200, 'Health check failed');
  assert.strictEqual(health.data.product, 'Pirapire');
  assert.strictEqual(health.data.status, 'ONLINE');
  console.log('  [PASS] /api/health respondió HTTP 200:', JSON.stringify(health.data));

  // 2. Registro de cuenta nueva
  console.log(`\n>>> [2/7] Registro de cuenta nueva: ${testEmail}...`);
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });
  assert.strictEqual(reg.status, 201, 'Registration failed');
  assert.ok(reg.data.sessionToken, 'Missing sessionToken');
  const verificationToken = reg.data.verificationToken;
  assert.ok(verificationToken, 'Missing verificationToken');
  console.log('  [PASS] Registro completado. Token de sesión emitido.');

  // 3. Verificación de correo y login
  console.log('\n>>> [3/7] Verificación de correo...');
  const ver = await api('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token: verificationToken })
  });
  assert.strictEqual(ver.status, 200, 'Email verification failed');
  console.log('  [PASS] Correo confirmado exitosamente.');

  console.log('  Iniciando sesión con credenciales nuevas...');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });
  assert.strictEqual(login.status, 200, 'Login failed');
  const sessionToken = login.data.sessionToken;
  const authHeaders = { Authorization: `Bearer ${sessionToken}` };
  console.log('  [PASS] Sesión iniciada con éxito. Usuario plan inicial:', login.data.plan);
  assert.strictEqual(login.data.plan, 'FREE');

  const me = await api('/api/auth/me', { headers: authHeaders });
  assert.strictEqual(me.data.user.remainingFreeTests, 5);
  assert.strictEqual(me.data.user.remainingFootballQueries, 1);

  // 4. Recuperación de contraseña
  console.log('\n>>> [4/7] Solicitud de recuperación de contraseña...');
  const forgot = await api('/api/auth/request-reset', {
    method: 'POST',
    body: JSON.stringify({ email: testEmail })
  });
  assert.strictEqual(forgot.status, 200, 'Forgot password request failed');
  console.log('  [PASS] Solicitud de restablecimiento procesada con éxito.');

  // 5. Ejecución de Backtest nuevo (Cripto)
  console.log('\n>>> [5/7] Ejecutando backtest nuevo de Cripto (BTCUSDT, 1d)...');
  const btRun = await api('/api/backtest/run', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      symbol: 'BTCUSDT',
      timeframe: '1d',
      startDate: '2025-11-18',
      endDate: '2026-11-17',
      initialCapital: 10000,
      channelPeriod: 20,
      atrMultiplier: 2.0
    })
  });
  assert.strictEqual(btRun.status, 200, 'Backtest run failed');
  assert.ok(btRun.data.runId, 'Missing runId');
  assert.strictEqual(btRun.data.metrics.totalTrades, 5);
  assert.strictEqual(btRun.data.metrics.netReturnPct, 2.3);
  console.log(`  [PASS] Backtest completado. ID Corrida: ${btRun.data.runId}. Retorno neto: ${btRun.data.metrics.netReturnPct}%.`);

  // Comprobar cupo restante (debe ser 4)
  const meAfterBt = await api('/api/auth/me', { headers: authHeaders });
  assert.strictEqual(meAfterBt.data.user.remainingFreeTests, 4);
  console.log(`  [PASS] Cupo de backtests actualizado correctamente: ${meAfterBt.data.user.remainingFreeTests} restantes.`);

  // Abrir informe individual
  const report = await api(`/api/backtest/report/${btRun.data.runId}`, { headers: authHeaders });
  assert.strictEqual(report.status, 200, 'Report retrieval failed');
  assert.strictEqual(report.data.runId, btRun.data.runId);
  console.log('  [PASS] Informe individual recuperado con éxito con gráfico y operaciones.');

  // 6. Fútbol: carga de partido y consulta interactiva
  console.log('\n>>> [6/7] Fútbol: consultando fixture oficial...');
  const fixtures = await api('/api/futbol/fixtures');
  assert.strictEqual(fixtures.status, 200, 'Fixtures failed');
  assert.ok(fixtures.data.fixtures.length > 0);
  const match = fixtures.data.fixtures[0];
  console.log(`  [PASS] Fixture cargado. Partido analizado: ${match.homeTeam} vs ${match.awayTeam} (${match.paraguayTime}).`);

  console.log('  Enviando consulta a Pirapire Fútbol: "¿Quién llega mejor?"...');
  const ask = await api('/api/futbol/ask', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      matchId: match.id,
      question: '¿Quién llega mejor?'
    })
  });
  assert.strictEqual(ask.status, 200, 'Football ask failed');
  assert.ok(ask.data.analysis.answer.length > 0);
  console.log('  [PASS] Respuesta del bot recibida:');
  console.log(`    "${ask.data.analysis.answer.split('\n')[0]}..."`);
  console.log(`    Fuente: ${ask.data.analysis.source} | Fecha/Hora: ${ask.data.analysis.dataTimestamp}`);

  // 7. Checkout Sandbox y Activación Pro Unificada
  console.log('\n>>> [7/7] Checkout Sandbox y Activación Pro...');
  const checkout = await api('/api/billing/checkout', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ planCode: 'PRO' })
  });
  assert.strictEqual(checkout.status, 200, 'Checkout failed');
  const orderId = checkout.data.session.orderId;
  assert.strictEqual(checkout.data.session.amountPyg, 190000);
  console.log(`  [PASS] Sesión de pago creada. Orden: ${orderId} por ₲ 190.000.`);

  // Simular pago firmado en el servidor
  console.log('  Procesando simulación de pago en servidor...');
  const simPay = await api('/api/billing/sandbox/simulate-payment', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ orderId })
  });
  assert.strictEqual(simPay.status, 200, 'Payment simulation failed');
  console.log('  [PASS] Pago confirmado y firmado por servidor. Suscripción Pro activada.');

  // Verificar cuenta Pro
  const mePro = await api('/api/auth/me', { headers: authHeaders });
  assert.strictEqual(mePro.data.user.plan, 'PRO');
  console.log('  [PASS] Perfil de usuario actualizado a PIRAPIRE PRO ACTIVO.');

  // Probar descarga autorizada con ticket de un solo uso
  console.log('\n  Solicitando pase seguro de descarga...');
  const ticketRes = await api('/api/download/request-ticket', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ fileKey: 'desktop-zip' })
  });
  assert.strictEqual(ticketRes.status, 200, 'Ticket request failed');
  const ticket = ticketRes.data.ticket;
  console.log(`  [PASS] Ticket de descarga emitido: ${ticket}.`);

  // Descargar archivo usando el ticket
  console.log('  Descargando archivo ZIP con el ticket...');
  const dlRes = await api(`/api/download/file?ticket=${ticket}`);
  assert.strictEqual(dlRes.status, 200, 'Download with ticket failed');
  console.log('  [PASS] Descarga autorizada completada (HTTP 200).');

  // Intentar reutilizar el ticket (debe devolver 403)
  console.log('  Intentando reutilizar el mismo ticket...');
  const reuseRes = await api(`/api/download/file?ticket=${ticket}`);
  assert.strictEqual(reuseRes.status, 403, 'Ticket reuse should be blocked');
  console.log('  [PASS] Reutilización rechazada con HTTP 403 (Ticket de un solo uso).');

  // Intentar descarga insegura con ?token=... en URL (debe devolver 400)
  console.log('  Verificando bloqueo de transporte inseguro de tokens (?token=...)...');
  const insecureRes = await api(`/api/download/pirapire-desktop?token=${sessionToken}`);
  assert.ok([400, 401].includes(insecureRes.status), 'Insecure token transport must be rejected');
  console.log(`  [PASS] Transporte inseguro de tokens rechazado con HTTP ${insecureRes.status}.`);

  console.log('\n========================================================================');
  console.log('  TODOS LOS RECORRIDOS PÚBLICOS COMPLETADOS Y VERIFICADOS CON ÉXITO');
  console.log('========================================================================');
}

run().catch(err => {
  console.error('\n[ERROR]', err);
  process.exit(1);
});
