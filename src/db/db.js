// src/db/db.js - Native Node.js SQLite Persistence
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../pirapire.db');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      reset_token TEXT,
      reset_token_expires INTEGER,
      plan TEXT DEFAULT 'FREE',
      role TEXT DEFAULT 'USER',
      marketing_opt_in INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quota_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL, -- PENDING, COMPLETED, RELEASED
      run_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      candles_summary_json TEXT NOT NULL,
      is_public_example INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      plan_code TEXT NOT NULL,
      status TEXT NOT NULL, -- ACTIVE, CANCELLED, EXPIRED
      amount_pyg INTEGER NOT NULL,
      currency TEXT DEFAULT 'PYG',
      billing_cycle TEXT DEFAULT '30_DAYS',
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      cancel_at_period_end INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id TEXT UNIQUE NOT NULL,
      idempotency_key TEXT UNIQUE,
      amount_pyg INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL, -- PENDING, SUCCESS, FAILED, REFUNDED
      payment_method TEXT,
      provider TEXT DEFAULT 'PAGOPAR_SANDBOX',
      payload_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS download_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      version TEXT NOT NULL,
      ip_address TEXT,
      downloaded_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      type TEXT NOT NULL,
      sent_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS football_quota_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL, -- PENDING, COMPLETED, RELEASED
      match_id TEXT NOT NULL,
      question TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS football_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      match_date TEXT NOT NULL,
      prediction_date TEXT NOT NULL,
      model_version TEXT NOT NULL,
      prob_home REAL NOT NULL,
      prob_draw REAL NOT NULL,
      prob_away REAL NOT NULL,
      expected_home_goals REAL NOT NULL,
      expected_away_goals REAL NOT NULL,
      actual_home_score INTEGER,
      actual_away_score INTEGER,
      actual_result TEXT, -- HOME_WIN, DRAW, AWAY_WIN, POSTPONED
      prediction_hit INTEGER, -- 1 = acierto, 0 = fallo, NULL = pendiente
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS football_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sponsor_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      cta_text TEXT NOT NULL,
      link_url TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      start_date INTEGER NOT NULL,
      end_date INTEGER NOT NULL,
      impressions_count INTEGER DEFAULT 0,
      clicks_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_reservations_user ON quota_reservations(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_football_reservations ON football_quota_reservations(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_football_predictions_match ON football_predictions(match_id);
    CREATE INDEX IF NOT EXISTS idx_runs_user ON backtest_runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_tx_order ON payment_transactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_tx_idempotency ON payment_transactions(idempotency_key);
  `);

  // Seed default non-gambling sponsorship if empty
  const sponsorCount = db.prepare('SELECT COUNT(*) as c FROM sponsor_campaigns').get().c;
  if (sponsorCount === 0) {
    const now = Date.now();
    const in30Days = now + (30 * 24 * 60 * 60 * 1000);
    db.prepare(`
      INSERT INTO sponsor_campaigns (brand_name, tagline, cta_text, link_url, is_active, start_date, end_date, impressions_count, clicks_count, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, 0, 0, ?)
    `).run(
      'Bancard Pago Móvil',
      'Pagá en comercios y transferí al instante vía SIPAP en todo Paraguay',
      'Conocé Pago Móvil',
      'https://www.bancard.com.py',
      now,
      in30Days,
      now
    );
  }
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  getDb,
  closeDb,
  DB_PATH
};
