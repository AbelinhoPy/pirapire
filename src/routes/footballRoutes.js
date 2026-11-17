// src/routes/footballRoutes.js - Pirapire Fútbol API Router
const express = require('express');
const router = express.Router();
const { getFixtureMatches, getMatchById, getTeamDetails } = require('../football/footballData');
const { calculateMatchProbabilities, analyzeFootballQuery, recordPrediction, getPredictionArchive } = require('../football/poissonEngine');
const { getActiveSponsorship, recordSponsorClick } = require('../football/sponsorService');
const { requireAuth, optionalAuth } = require('../auth/authMiddleware');
const { getDb } = require('../db/db');

// GET /api/futbol/fixtures - Public fixtures list
router.get('/fixtures', async (req, res) => {
  try {
    const data = await getFixtureMatches();
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: 'FIXTURES_ERROR', message: err.message });
  }
});

// GET /api/futbol/match/:id - Single match sheet
router.get('/match/:id', (req, res) => {
  const match = getMatchById(req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'MATCH_NOT_FOUND', message: 'Partido no encontrado.' });
  }
  res.json({ success: true, match });
});

// GET /api/futbol/public-sample - Sample consultation for visitors (0 quota)
router.get('/public-sample', (req, res) => {
  try {
    const featuredMatchId = 'par-2024-cl-01'; // Olimpia vs Cerro Porteño
    const sample = analyzeFootballQuery(featuredMatchId, '¿Quién llega mejor?');
    res.json({
      success: true,
      isPublicSample: true,
      quotaConsumed: 0,
      question: '¿Quién llega mejor al clásico?',
      analysis: sample
    });
  } catch (err) {
    res.status(500).json({ error: 'SAMPLE_ERROR', message: err.message });
  }
});

// POST /api/futbol/ask - Interactive Consultation with atomic quota tracking
router.post('/ask', optionalAuth, async (req, res) => {
  const user = req.user;
  const { matchId, question } = req.body;

  if (!matchId || !question) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'El ID del partido y la pregunta son obligatorios.' });
  }

  // 1. Visitor without login
  if (!user) {
    return res.status(401).json({
      error: 'AUTH_REQUIRED',
      message: 'Creá tu cuenta gratis para probar una consulta interactiva en Pirapire Fútbol.',
      preservedQuery: { matchId, question },
      redirectUrl: '/login.html'
    });
  }

  const db = getDb();
  const now = Date.now();
  let reservationId = null;

  // 2. Quota Check for FREE Users (1 free interactive query per account)
  if (user.plan === 'FREE') {
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const completedCount = db.prepare(`
        SELECT COUNT(*) as c FROM football_quota_reservations
        WHERE user_id = ? AND status = 'COMPLETED'
      `).get(user.id).c;

      const pendingCount = db.prepare(`
        SELECT COUNT(*) as c FROM football_quota_reservations
        WHERE user_id = ? AND status = 'PENDING'
      `).get(user.id).c;

      if (completedCount + pendingCount >= 1) {
        db.exec('ROLLBACK;');
        return res.status(403).json({
          error: 'FOOTBALL_QUOTA_EXHAUSTED',
          code: 'FOOTBALL_QUOTA_EXHAUSTED',
          message: 'Agotaste tu consulta gratuita de Pirapire Fútbol. Conservamos tu pregunta para que la retomes al pasar a Pirapire Pro.',
          remainingQueries: 0,
          completedQueries: completedCount,
          preservedQuery: { matchId, question },
          upgradeUrl: '/planes.html'
        });
      }

      // Reserve quota atomically
      const resInfo = db.prepare(`
        INSERT INTO football_quota_reservations (user_id, status, match_id, question, created_at, updated_at)
        VALUES (?, 'PENDING', ?, ?, ?, ?)
      `).run(user.id, matchId, question, now, now);

      reservationId = Number(resInfo.lastInsertRowid);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ error: 'MUTEX_ERROR', message: err.message });
    }
  }

  // 3. Execute Analysis
  try {
    const analysis = analyzeFootballQuery(matchId, question);

    // Save pre-match prediction if calculated
    if (analysis.model && analysis.model.hasProbabilities) {
      try {
        recordPrediction(matchId, analysis.model);
      } catch (e) {
        // Continue if already recorded
      }
    }

    // Confirm Quota Consumption
    if (reservationId) {
      db.prepare(`
        UPDATE football_quota_reservations
        SET status = 'COMPLETED', updated_at = ?
        WHERE id = ?
      `).run(Date.now(), reservationId);
    }

    const currentCompleted = db.prepare(`
      SELECT COUNT(*) as c FROM football_quota_reservations
      WHERE user_id = ? AND status = 'COMPLETED'
    `).get(user.id).c;

    return res.json({
      success: true,
      userPlan: user.plan,
      remainingQueries: user.plan === 'PRO' ? 'Ilimitadas' : Math.max(0, 1 - currentCompleted),
      quotaStatus: 'CONSUMED',
      question,
      analysis
    });

  } catch (err) {
    // Release quota reservation on any failure so user is NEVER deducted on error!
    if (reservationId) {
      db.prepare(`
        UPDATE football_quota_reservations
        SET status = 'RELEASED', updated_at = ?
        WHERE id = ?
      `).run(Date.now(), reservationId);
    }

    return res.status(400).json({
      error: 'ANALYSIS_FAILED',
      message: err.message,
      quotaStatus: 'RELEASED_NO_CHARGE',
      remainingQueries: user.plan === 'PRO' ? 'Ilimitadas' : Math.max(0, 1 - db.prepare(`
        SELECT COUNT(*) as c FROM football_quota_reservations
        WHERE user_id = ? AND status = 'COMPLETED'
      `).get(user.id).c)
    });
  }
});

// POST /api/futbol/compare - Pro Feature: Compare two Paraguayan teams side by side
router.post('/compare', requireAuth, (req, res) => {
  const user = req.user;
  if (user.plan !== 'PRO') {
    return res.status(403).json({
      error: 'UPGRADE_REQUIRED',
      message: 'La comparación directa de equipos es una función exclusiva de Pirapire Pro.',
      upgradeUrl: '/planes.html'
    });
  }

  const { teamA, teamB } = req.body;
  const statsA = getTeamDetails(teamA);
  const statsB = getTeamDetails(teamB);

  if (!statsA || !statsB) {
    return res.status(400).json({ error: 'TEAMS_NOT_FOUND', message: 'Uno o ambos equipos no se encuentran en Primera División.' });
  }

  // Calculate neutral head to head Poisson probabilities
  let modelComparison = null;
  try {
    modelComparison = calculateMatchProbabilities(teamA, teamB);
  } catch (e) {
    modelComparison = { status: 'NOT_AVAILABLE' };
  }

  res.json({
    success: true,
    teamA: statsA,
    teamB: statsB,
    modelComparison
  });
});

// GET /api/futbol/predictions/history - Transparent historical prediction archive
router.get('/predictions/history', (req, res) => {
  const archive = getPredictionArchive();
  res.json({ success: true, count: archive.length, predictions: archive });
});

// GET /api/futbol/sponsor - Active sponsorship banner
router.get('/sponsor', (req, res) => {
  const sponsor = getActiveSponsorship();
  res.json({ success: true, sponsor });
});

// POST /api/futbol/sponsor/click - Record sponsor click
router.post('/sponsor/click', (req, res) => {
  const { campaignId } = req.body;
  if (campaignId) recordSponsorClick(campaignId);
  res.json({ success: true });
});

module.exports = router;
