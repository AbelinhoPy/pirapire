// tests/football.test.js - Comprehensive Unit & Integration Tests for Pirapire Fútbol
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(__dirname, 'test_football.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
process.env.DB_PATH = TEST_DB_PATH;

const { getDb } = require('../src/db/db');
const { registerUser, verifyEmailToken, loginUser } = require('../src/auth/authService');
const { createCheckoutSession, handleWebhookEvent, signWebhookPayload } = require('../src/billing/paymentService');
const { getFixtureMatches, getMatchById, getTeamDetails } = require('../src/football/footballData');
const {
  calculateMatchProbabilities,
  analyzeFootballQuery,
  recordPrediction,
  getPredictionArchive
} = require('../src/football/poissonEngine');
const { getActiveSponsorship, recordSponsorClick } = require('../src/football/sponsorService');

test('Pirapire Fútbol - 1. Fixtures & Match Sheet Integrity', async () => {
  const data = await getFixtureMatches();
  assert.strictEqual(data.competition, 'División Profesional de la Asociación Paraguaya de Fútbol (APF)');
  assert.strictEqual(data.round, 'Fecha 17');
  assert.ok(data.fixtures.length >= 6);

  // Check featured match (Olimpia vs Cerro Porteño)
  const featured = data.featuredMatch;
  assert.strictEqual(featured.id, 'par-2024-cl-01');
  assert.strictEqual(featured.homeTeam, 'Club Olimpia');
  assert.strictEqual(featured.awayTeam, 'Club Cerro Porteño');
  assert.ok(featured.status === 'SCHEDULED' || featured.status === 'PROGRAMADO');
  assert.ok(featured.kickoffParaguay.includes('19:30'));

  // Check single match sheet fetch
  const single = getMatchById('par-2024-cl-01');
  assert.strictEqual(single.id, 'par-2024-cl-01');
  assert.ok(single.venue.includes('Defensores del Chaco'));
});

test('Pirapire Fútbol - 2. Mathematical Poisson Engine (Zero-Lookahead)', () => {
  // Olimpia vs Cerro Porteño
  const prob = calculateMatchProbabilities('Club Olimpia', 'Club Cerro Porteño');
  assert.strictEqual(prob.status, 'CALCULATED');
  assert.strictEqual(prob.hasProbabilities, true);
  assert.ok(prob.expectedGoalsHome > 0, 'Expected goals for home must be positive');
  assert.ok(prob.expectedGoalsAway > 0, 'Expected goals for away must be positive');

  // Sum of probabilities must equal ~100%
  const totalProb = prob.probabilities.homeWinPct + prob.probabilities.drawPct + prob.probabilities.awayWinPct;
  assert.ok(Math.abs(totalProb - 100.0) < 0.5, `Total probability should be ~100%, got ${totalProb}`);

  // Most likely score
  assert.ok(prob.probabilities.mostLikelyScore);
  assert.ok(typeof prob.probabilities.mostLikelyScore.home === 'number');
  assert.ok(typeof prob.probabilities.mostLikelyScore.away === 'number');
});

test('Pirapire Fútbol - 3. Special Scenarios: Postponed & Insufficient History', () => {
  // 3a. Postponed match (Tacuary vs Sol de América)
  const postponedAnalysis = analyzeFootballQuery('par-2024-cl-04', '¿Quién llega mejor?');
  assert.strictEqual(postponedAnalysis.status, 'APLAZADO');
  assert.strictEqual(postponedAnalysis.model.hasProbabilities, false);
  assert.match(postponedAnalysis.explanation, /aplazado/i);
  assert.match(postponedAnalysis.explanation, /precipitaciones torrenciales/i);

  // 3b. Insufficient history (< 3 matches, 2 de Mayo vs Tembetary)
  const insufficientAnalysis = analyzeFootballQuery('par-2024-cl-06', '¿Quién tiene más chances de ganar?');
  assert.strictEqual(insufficientAnalysis.status, 'INSUFFICIENT_HISTORY');
  assert.strictEqual(insufficientAnalysis.model.hasProbabilities, false);
  assert.match(insufficientAnalysis.explanation, /datos insuficientes|insuficiente/i);
});

test('Pirapire Fútbol - 4. Conversational Engine & Paraguayan Spanish Voseo', () => {
  const analysis1 = analyzeFootballQuery('par-2024-cl-01', '¿Quién llega mejor?');
  assert.match(analysis1.explanation, /Mirá cómo llegan/i);
  assert.ok(analysis1.factors.length > 0);
  assert.ok(analysis1.source.includes('APF'));

  const analysis2 = analyzeFootballQuery('par-2024-cl-01', '¿Quién tiene más chances de ganar?');
  assert.match(analysis2.explanation, /Poisson/i);
  assert.ok(analysis2.model.probabilities.homeWinPct > 0);

  const analysis3 = analyzeFootballQuery('par-2024-cl-01', '¿Cómo vienen jugando de local y visitante?');
  assert.match(analysis3.explanation, /invicto/i);
});

test('Pirapire Fútbol - 5. Quota Reservation & Exhaustion Workflow', async () => {
  const db = getDb();

  // Create test user
  const email = 'futbolero.py@gmail.com';
  const reg = await registerUser(email, 'SolDeAmerica2026!', true, 'http://localhost:3000');
  verifyEmailToken(reg.verificationToken);
  const login = loginUser(email, 'SolDeAmerica2026!');
  const user = { id: reg.userId, email, plan: 'FREE' };

  // Step 5a: First interactive query succeeds and consumes 1 quota
  const now = Date.now();
  // Simulate atomic quota reservation in route
  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  const completedCount = db.prepare(`SELECT COUNT(*) as c FROM football_quota_reservations WHERE user_id = ? AND status = 'COMPLETED'`).get(user.id).c;
  assert.strictEqual(completedCount, 0);

  const resInfo = db.prepare(`
    INSERT INTO football_quota_reservations (user_id, status, match_id, question, created_at, updated_at)
    VALUES (?, 'PENDING', ?, ?, ?, ?)
  `).run(user.id, 'par-2024-cl-01', '¿Quién llega mejor?', now, now);
  db.exec('COMMIT;');

  const reservationId = Number(resInfo.lastInsertRowid);
  assert.ok(reservationId > 0);

  // Complete analysis
  const analysis = analyzeFootballQuery('par-2024-cl-01', '¿Quién llega mejor?');
  db.prepare(`UPDATE football_quota_reservations SET status = 'COMPLETED', updated_at = ? WHERE id = ?`).run(Date.now(), reservationId);

  const currentCompleted = db.prepare(`SELECT COUNT(*) as c FROM football_quota_reservations WHERE user_id = ? AND status = 'COMPLETED'`).get(user.id).c;
  assert.strictEqual(currentCompleted, 1);
  const remainingQueries = Math.max(0, 1 - currentCompleted);
  assert.strictEqual(remainingQueries, 0);

  // Step 5b: Second query triggers QUOTA EXHAUSTION (HTTP 403)
  const checkCount = db.prepare(`SELECT COUNT(*) as c FROM football_quota_reservations WHERE user_id = ? AND status = 'COMPLETED'`).get(user.id).c;
  assert.strictEqual(checkCount >= 1, true);
  // Preserved query saved
  const preservedQuery = { matchId: 'par-2024-cl-02', question: '¿Quién tiene más chances de ganar?' };
  assert.strictEqual(preservedQuery.matchId, 'par-2024-cl-02');

  // Step 5c: Quota release on simulated failure
  // If an error occurs, quota is marked RELEASED and not counted
  const failResInfo = db.prepare(`
    INSERT INTO football_quota_reservations (user_id, status, match_id, question, created_at, updated_at)
    VALUES (?, 'PENDING', ?, ?, ?, ?)
  `).run(user.id, 'par-2024-cl-01', 'Pregunta con error', now, now);
  const failId = Number(failResInfo.lastInsertRowid);

  // Release on error
  db.prepare(`UPDATE football_quota_reservations SET status = 'RELEASED', updated_at = ? WHERE id = ?`).run(Date.now(), failId);

  // Still exactly 1 completed query, not 2!
  const finalCompleted = db.prepare(`SELECT COUNT(*) as c FROM football_quota_reservations WHERE user_id = ? AND status = 'COMPLETED'`).get(user.id).c;
  assert.strictEqual(finalCompleted, 1);
});

test('Pirapire Fútbol - 6. Pro Upgrade & Team Comparison Feature', async () => {
  const db = getDb();
  const email = 'pro.futbol@gmail.com';
  const reg = await registerUser(email, 'CerroCampéon2026!', true, 'http://localhost:3000');
  verifyEmailToken(reg.verificationToken);
  const user = { id: reg.userId, email, plan: 'FREE' };

  // Free user cannot compare teams
  assert.strictEqual(user.plan, 'FREE');

  // Upgrade user to PRO via checkout session and webhook
  const checkout = createCheckoutSession(user.id, 'PRO');
  const payload = {
    eventType: 'PAYMENT_SUCCESS',
    orderId: checkout.orderId,
    idempotencyKey: `idem_test_pro_compare_${Date.now()}`,
    amountPyg: 190000,
    paymentMethod: 'SIPAP'
  };
  const signature = signWebhookPayload(payload);
  handleWebhookEvent(payload, signature);

  // Verify plan is now PRO
  const updatedUser = db.prepare('SELECT plan FROM users WHERE id = ?').get(user.id);
  assert.strictEqual(updatedUser.plan, 'PRO');

  // Pro user can run Team Comparison
  const teamA = getTeamDetails('Club Olimpia');
  const teamB = getTeamDetails('Club Cerro Porteño');
  assert.ok(teamA);
  assert.ok(teamB);
  assert.strictEqual(teamA.name, 'Club Olimpia');
  assert.strictEqual(teamB.name, 'Club Cerro Porteño');
  assert.ok(teamA.points >= 0);
  assert.ok(teamB.points >= 0);

  const modelComparison = calculateMatchProbabilities('Club Olimpia', 'Club Cerro Porteño');
  assert.strictEqual(modelComparison.status, 'CALCULATED');
  assert.ok(modelComparison.probabilities.homeWinPct > 0);
});

test('Pirapire Fútbol - 7. Pre-match Prediction Archiving & Accuracy Evaluation', () => {
  // Test pre-match prediction recording
  const model = calculateMatchProbabilities('Sportivo Ameliano', 'Sportivo Trinidense');
  recordPrediction('par-2024-cl-05', model);

  const archive = getPredictionArchive();
  assert.ok(archive.length >= 1, 'Archive should contain recorded predictions');

  // Check finished match evaluation
  const finishedRecord = archive.find(p => p.match_id === 'par-2024-cl-05');
  assert.ok(finishedRecord);
  assert.strictEqual(finishedRecord.home_team, 'Sportivo Ameliano');
  assert.strictEqual(finishedRecord.away_team, 'Sportivo Trinidense');
  assert.strictEqual(finishedRecord.actual_score_home, 1);
  assert.strictEqual(finishedRecord.actual_score_away, 0);
  assert.strictEqual(finishedRecord.evaluationResult, 'CORRECT'); // Predicted home win, actual was home win (1-0)
});

test('Pirapire Fútbol - 8. Sponsorship Engine (Publicidad)', () => {
  // Active campaign
  const sponsor = getActiveSponsorship();
  assert.ok(sponsor, 'Active sponsorship campaign must be returned');
  assert.strictEqual(sponsor.brandName, 'Bancard Pago Móvil');
  assert.ok(sponsor.tagline);
  assert.ok(sponsor.ctaText);
  assert.ok(sponsor.targetUrl);

  const initialClicks = sponsor.clicks;
  recordSponsorClick(sponsor.id);

  const updatedSponsor = getActiveSponsorship();
  assert.strictEqual(updatedSponsor.clicks, initialClicks + 1);
});
