// src/football/poissonEngine.js - Poisson Football Match Expectancy Model & Chat Engine
const { PARAGUAY_LEAGUE_INFO, getMatchById, getTeamDetails } = require('./footballData');
const { getDb } = require('../db/db');

function factorial(n) {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

function poisson(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calculates Poisson probabilities for a match based on home/away attack and defense ratings.
 */
function calculateMatchProbabilities(homeTeamName, awayTeamName) {
  const home = getTeamDetails(homeTeamName);
  const away = getTeamDetails(awayTeamName);

  if (!home || !away) {
    throw new Error('Equipos no encontrados en el registro de Primera División.');
  }

  // Insufficient history check
  if (home.insufficientHistory || away.insufficientHistory || (home.played || 0) < 3 || (away.played || 0) < 3) {
    return {
      status: 'INSUFFICIENT_HISTORY',
      hasProbabilities: false,
      message: 'Historial insuficiente para cálculo probabilístico confiable (< 3 partidos registrados en Primera División).',
      homeTeam: home.name,
      awayTeam: away.name,
      availableStats: {
        homePlayed: home.played || 0,
        awayPlayed: away.played || 0
      }
    };
  }

  const leagueAvgHome = PARAGUAY_LEAGUE_INFO.averageHomeGoals; // ~1.38
  const leagueAvgAway = PARAGUAY_LEAGUE_INFO.averageAwayGoals; // ~1.08

  // Home attack & defense ratings
  const homeMatchesHome = (home.homeWins + home.homeDraws + home.homeLosses) || 1;
  const homeAvgScored = home.homeGoalsFor / homeMatchesHome;
  const homeAvgConceded = home.homeGoalsAgainst / homeMatchesHome;
  const homeAttack = homeAvgScored / leagueAvgHome;
  const homeDefense = homeAvgConceded / leagueAvgAway;

  // Away attack & defense ratings
  const awayMatchesAway = (away.awayWins + away.awayDraws + away.awayLosses) || 1;
  const awayAvgScored = away.awayGoalsFor / awayMatchesAway;
  const awayAvgConceded = away.awayGoalsAgainst / awayMatchesAway;
  const awayAttack = awayAvgScored / leagueAvgAway;
  const awayDefense = awayAvgConceded / leagueAvgHome;

  // Expected Goals (Lambda & Mu)
  const lambdaHome = Math.max(0.2, homeAttack * awayDefense * leagueAvgHome);
  const muAway = Math.max(0.2, awayAttack * homeDefense * leagueAvgAway);

  // Score matrix from 0 to 6 goals
  const MAX_GOALS = 6;
  let probHomeWin = 0;
  let probDraw = 0;
  let probAwayWin = 0;

  let mostLikelyScore = { home: 0, away: 0, prob: 0 };

  for (let x = 0; x <= MAX_GOALS; x++) {
    for (let y = 0; y <= MAX_GOALS; y++) {
      const p = poisson(x, lambdaHome) * poisson(y, muAway);
      if (p > mostLikelyScore.prob) {
        mostLikelyScore = { home: x, away: y, prob: p };
      }

      if (x > y) probHomeWin += p;
      else if (x === y) probDraw += p;
      else probAwayWin += p;
    }
  }

  // Normalize so probabilities sum to 100%
  const total = probHomeWin + probDraw + probAwayWin;
  const probHomePct = Number(((probHomeWin / total) * 100).toFixed(1));
  const probDrawPct = Number(((probDraw / total) * 100).toFixed(1));
  const probAwayPct = Number(((probAwayWin / total) * 100).toFixed(1));

  // Determine edge
  const edgeDiff = Math.abs(probHomePct - probAwayPct);
  let edgeAssessment = 'Ventaja moderada';
  if (edgeDiff < 8) {
    edgeAssessment = 'Ventaja mínima / partido sumamente parejo; alta paridad';
  } else if (edgeDiff > 25) {
    edgeAssessment = 'Ventaja marcada';
  }

  return {
    status: 'CALCULATED',
    hasProbabilities: true,
    modelVersion: 'Poisson APF v1.2.0',
    calculatedAt: new Date().toISOString(),
    homeTeam: home.name,
    awayTeam: away.name,
    expectedGoals: {
      home: Number(lambdaHome.toFixed(2)),
      away: Number(muAway.toFixed(2))
    },
    expectedGoalsHome: Number(lambdaHome.toFixed(2)),
    expectedGoalsAway: Number(muAway.toFixed(2)),
    probabilities: {
      homeWinPct: probHomePct,
      drawPct: probDrawPct,
      awayWinPct: probAwayPct,
      mostLikelyScore: { home: mostLikelyScore.home, away: mostLikelyScore.away, label: `${mostLikelyScore.home} - ${mostLikelyScore.away}` }
    },
    mostLikelyScore: `${mostLikelyScore.home} - ${mostLikelyScore.away}`,
    edgeAssessment,
    assumptions: [
      'Goles modelados como procesos Poisson independientes condicionados a ratings locales y visitantes.',
      'Ajustado a promedios históricos de la División Profesional de la APF.'
    ]
  };
}

/**
 * Generates an analytical response in natural Paraguayan Spanish (voseo)
 */
function analyzeFootballQuery(matchId, questionText) {
  const match = getMatchById(matchId);
  if (!match) {
    throw new Error('Partido no encontrado.');
  }

  const q = (questionText || '').toLowerCase().trim();

  // If postponed
  if (match.status === 'POSTPONED') {
    const text = `Mirá, este partido entre ${match.homeTeam} y ${match.awayTeam} está oficialmente APLAZADO por la APF.\n\nMotivo: ${match.postponedNotice || 'Reprogramación de calendario'}.\n\nLas estimaciones de probabilidades se mantienen en pausa hasta que se confirme la nueva fecha y hora oficial en Asunción.`;
    return {
      matchId: match.id,
      matchTitle: `${match.homeTeam} vs ${match.awayTeam}`,
      status: 'APLAZADO',
      statusEn: 'POSTPONED',
      answer: text,
      explanation: text,
      model: { hasProbabilities: false, status: 'APLAZADO' },
      factors: ['Partido suspendido / aplazado por condiciones climáticas o calendario'],
      dataTimestamp: new Date().toISOString()
    };
  }

  const modelOutput = calculateMatchProbabilities(match.homeTeam, match.awayTeam);

  // Insufficient history
  if (!modelOutput.hasProbabilities) {
    const text = `Sobre ${match.homeTeam} vs ${match.awayTeam}:\n\nActualmente contamos con datos insuficientes (< 3 partidos registrados) para emitir probabilidades Poisson confiables de este partido. ${match.awayTeam} se incorporó recientemente a la categoría y no hay historial representativo en Primera División.\n\nTe mostramos únicamente los datos de campo confirmados: se juega en ${match.venue} a las ${match.paraguayTime}.`;
    return {
      matchId: match.id,
      matchTitle: `${match.homeTeam} vs ${match.awayTeam}`,
      status: 'INSUFFICIENT_HISTORY',
      answer: text,
      explanation: text,
      model: modelOutput,
      factors: ['Historial insuficiente en Primera División (< 3 partidos)', 'Sin registro previo head-to-head en la temporada'],
      dataTimestamp: new Date().toISOString()
    };
  }

  const home = match.homeStats;
  const away = match.awayStats;
  const probs = modelOutput.probabilities;
  const xG = modelOutput.expectedGoals;

  let answerText = '';
  const factors = [];

  // Question 1: "¿Quién llega mejor?"
  if (q.includes('llega mejor') || q.includes('momento') || q.includes('forma') || q.includes('racha')) {
    const homeFormStr = home.formLast5.join(' - ');
    const awayFormStr = away.formLast5.join(' - ');
    const homePoints = home.formLast5.reduce((acc, r) => acc + (r === 'V' ? 3 : r === 'E' ? 1 : 0), 0);
    const awayPoints = away.formLast5.reduce((acc, r) => acc + (r === 'V' ? 3 : r === 'E' ? 1 : 0), 0);

    const leader = homePoints > awayPoints ? home.name : (awayPoints > homePoints ? away.name : 'Ambos llegan con puntajes similares');

    answerText = `Mirá cómo llegan para el partido en ${match.venue}:\n\n` +
      `• **${home.name}**: Cosechó ${homePoints} de 15 puntos en sus últimas 5 fechas (Racha: ${homeFormStr}). En condición de local se mantiene invicto con ${home.homeWins} victorias y ${home.homeDraws} empates.\n` +
      `• **${away.name}**: Sumó ${awayPoints} de 15 puntos en sus últimos 5 juegos (Racha: ${awayFormStr}). Como visitante registra ${away.awayWins} victorias y ${away.awayGoalsFor} goles anotados.\n\n` +
      `En balance de momento reciente, **${leader}** presenta mayor regularidad en la previa.`;

    factors.push(`Racha últimos 5 partidos: ${home.shortName} (${homePoints} pts) vs ${away.shortName} (${awayPoints} pts)`);
    factors.push(`Efectividad de local: ${home.shortName} invicto en ${home.homeWins + home.homeDraws} juegos`);
  }
  // Question 2: "¿Quién tiene más chances de ganar?"
  else if (q.includes('chances') || q.includes('ganar') || q.includes('probabilidades') || q.includes('favorito')) {
    let edgeNote = '';
    if (Math.abs(probs.homeWinPct - probs.awayWinPct) < 8) {
      edgeNote = 'La ventaja es sumamente pequeña. Es un clásico muy parejo donde el empate tiene una ponderación elevada.';
    } else if (probs.homeWinPct > probs.awayWinPct) {
      edgeNote = `La balanza se inclina hacia ${home.name} principalmente por su rendimiento de local y solidez defensiva (${home.cleanSheets} vallas invictas).`;
    } else {
      edgeNote = `La balanza favorece a ${away.name} gracias a su efectividad ofensiva fuera de casa.`;
    }

    answerText = `Según el modelo estadístico Poisson para ${match.homeTeam} vs ${match.awayTeam}:\n\n` +
      `• **Victoria de ${home.name}**: ${probs.homeWinPct}%\n` +
      `• **Empate**: ${probs.drawPct}%\n` +
      `• **Victoria de ${away.name}**: ${probs.awayWinPct}%\n\n` +
      `Goles esperados: ${home.shortName} ${xG.home} vs ${away.shortName} ${xG.away}. Marcador más probable: ${modelOutput.mostLikelyScore}.\n\n` +
      `${edgeNote}`;

    factors.push(`Modelo Poisson: ${probs.homeWinPct}% Local / ${probs.drawPct}% Empate / ${probs.awayWinPct}% Visitante`);
    factors.push(`Goles esperados: ${xG.home} - ${xG.away}`);
    factors.push(`Apreciación: ${modelOutput.edgeAssessment}`);
  }
  // Question 3: "¿Cómo vienen jugando de local y visitante?"
  else if (q.includes('local') || q.includes('visitante') || q.includes('cancha') || q.includes('estadio')) {
    answerText = `Analizando el rendimiento de campo para este cruce:\n\n` +
      `• **${home.name} (Local)**: Jugó ${home.homeWins + home.homeDraws + home.homeLosses} partidos en su estadio, con ${home.homeWins} victorias, ${home.homeDraws} empates y ${home.homeLosses} derrotas ${home.homeLosses === 0 ? '(invicto)' : ''}. Convirtió ${home.homeGoalsFor} goles y recibió solamente ${home.homeGoalsAgainst}.\n` +
      `• **${away.name} (Visitante)**: Disputó ${away.awayWins + away.awayDraws + away.awayLosses} cotejos fuera de casa, ganando ${away.awayWins}, empatando ${away.awayDraws} y perdiendo ${away.awayLosses}. Marcó ${away.awayGoalsFor} goles y encajó ${away.awayGoalsAgainst}.\n\n` +
      `El diferencial defensivo de ${home.shortName} en su feudo (${home.homeGoalsAgainst} goles recibidos en ${home.homeWins + home.homeDraws + home.homeLosses} partidos) es el dato estadístico más destacado.`;

    factors.push(`${home.shortName} de local: ${home.homeWins}V - ${home.homeDraws}E - ${home.homeLosses}D (Goles: ${home.homeGoalsFor}:${home.homeGoalsAgainst})`);
    factors.push(`${away.shortName} de visitante: ${away.awayWins}V - ${away.awayDraws}E - ${away.awayLosses}D (Goles: ${away.awayGoalsFor}:${away.awayGoalsAgainst})`);
  }
  // General fallback question
  else {
    answerText = `Resumen analítico para **${match.homeTeam} vs ${match.awayTeam}** (${match.competition}):\n\n` +
      `• Probabilidades Poisson: ${home.shortName} ${probs.homeWinPct}% | Empate ${probs.drawPct}% | ${away.shortName} ${probs.awayWinPct}%\n` +
      `• Goles esperados: ${home.shortName} ${xG.home} - ${away.shortName} ${xG.away} (Marcador estimado: ${modelOutput.mostLikelyScore})\n` +
      `• Historial reciente directo: ${match.headToHead.homeWins} victorias de ${home.shortName}, ${match.headToHead.draws} empates y ${match.headToHead.awayWins} triunfos de ${away.shortName}.\n\n` +
      `Conclusión: ${modelOutput.edgeAssessment}.`;

    factors.push(`Probabilidades: ${probs.homeWinPct}% - ${probs.drawPct}% - ${probs.awayWinPct}%`);
    factors.push(`Goles esperados: ${xG.home} a ${xG.away}`);
  }

  return {
    matchId: match.id,
    matchTitle: `${match.homeTeam} vs ${match.awayTeam}`,
    competition: match.competition,
    status: 'ANSWERED',
    answer: answerText,
    explanation: answerText,
    model: modelOutput,
    factors,
    source: 'APF / Asociación Paraguaya de Fútbol (Oficial)',
    dataTimestamp: new Date().toISOString(),
    disclaimer: 'Análisis estadístico basado en datos históricos verificados de la APF y modelo Poisson. Pirapire no es una casa de apuestas y no promueve juegos de azar.'
  };
}

/**
 * Stores a pre-match prediction before kickoff into database
 */
function recordPrediction(matchId, modelOutput) {
  const db = getDb();
  const match = getMatchById(matchId);
  if (!match || !modelOutput.hasProbabilities) return null;

  const now = new Date().toISOString();
  const p = modelOutput.probabilities;
  const xG = modelOutput.expectedGoals;

  const info = db.prepare(`
    INSERT INTO football_predictions (
      match_id, home_team, away_team, match_date, prediction_date,
      model_version, prob_home, prob_draw, prob_away,
      expected_home_goals, expected_away_goals,
      actual_home_score, actual_away_score, actual_result, prediction_hit,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    match.id,
    match.homeTeam,
    match.awayTeam,
    match.matchDate,
    now,
    modelOutput.modelVersion,
    p.homeWinPct,
    p.drawPct,
    p.awayWinPct,
    xG.home,
    xG.away,
    match.score ? match.score.home : null,
    match.score ? match.score.away : null,
    match.status === 'FINISHED' ? (match.score.home > match.score.away ? 'HOME_WIN' : (match.score.home === match.score.away ? 'DRAW' : 'AWAY_WIN')) : (match.status === 'POSTPONED' ? 'POSTPONED' : null),
    match.status === 'FINISHED' ? (
      (p.homeWinPct >= p.drawPct && p.homeWinPct >= p.awayWinPct && match.score.home > match.score.away) ||
      (p.drawPct >= p.homeWinPct && p.drawPct >= p.awayWinPct && match.score.home === match.score.away) ||
      (p.awayWinPct >= p.homeWinPct && p.awayWinPct >= p.drawPct && match.score.home < match.score.away) ? 1 : 0
    ) : null,
    Date.now()
  );

  return Number(info.lastInsertRowid);
}

/**
 * Retrieves the historical prediction record including evaluation and transparent error tracking
 */
function getPredictionArchive() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM football_predictions
    ORDER BY created_at DESC
  `).all();

  return rows.map(r => ({
    ...r,
    probabilities: {
      homeWinPct: r.prob_home,
      drawPct: r.prob_draw,
      awayWinPct: r.prob_away
    },
    actual_score_home: r.actual_home_score,
    actual_score_away: r.actual_away_score,
    evaluationResult: r.prediction_hit === 1 ? 'CORRECT' : (r.prediction_hit === 0 ? 'INCORRECT' : 'PENDING')
  }));
}

module.exports = {
  calculateMatchProbabilities,
  analyzeFootballQuery,
  recordPrediction,
  getPredictionArchive
};
