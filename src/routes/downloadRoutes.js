// src/routes/downloadRoutes.js - Server-Protected Download Controller
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('../db/db');
const { getUserSubscriptionDetails } = require('../billing/paymentService');

const DOWNLOADS_DIR = path.join(__dirname, '../../storage/downloads');
const MANIFEST_PATH = path.join(DOWNLOADS_DIR, 'manifest.json');
const ZIP_PATH = path.join(DOWNLOADS_DIR, 'Pirapire-Desktop-Windows-x64-v1.0.0.zip');

function getDownloadManifest(req, res) {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return res.status(404).json({ error: 'MANIFEST_NOT_FOUND', message: 'No hay instalador publicado actualmente.' });
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return res.json({ success: true, manifest });
}

/**
 * Generates a short-lived, single-use download authorization ticket.
 * Prevents exposing long-lived session tokens in download query strings.
 */
function requestDownloadTicket(req, res) {
  const user = req.user;
  const subDetails = getUserSubscriptionDetails(user.id);

  if (!subDetails.canDownloadDesktop) {
    return res.status(403).json({
      error: 'DOWNLOAD_FORBIDDEN',
      code: 'PRO_SUBSCRIPTION_REQUIRED',
      message: 'La descarga de Pirapire Desktop para Windows requiere una suscripción activa a Pirapire Pro.',
      currentPlan: user.plan,
      upgradeUrl: 'planes.html'
    });
  }

  const db = getDb();
  const ticket = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const ttlMs = 120 * 1000; // 2 minutes valid TTL
  const expiresAt = now + ttlMs;

  db.prepare(`
    INSERT INTO download_tickets (ticket, user_id, used, created_at, expires_at)
    VALUES (?, ?, 0, ?, ?)
  `).run(ticket, user.id, now, expiresAt);

  return res.json({
    success: true,
    ticket,
    downloadUrl: `/api/download/file?ticket=${ticket}`,
    expiresInSeconds: 120,
    message: 'Ticket de descarga temporal generado con éxito. Válido para un único uso por 120 segundos.'
  });
}

/**
 * Delivers the desktop application using a single-use authorization ticket.
 */
function downloadWithTicket(req, res) {
  const ticket = req.query.ticket;
  if (!ticket) {
    return res.status(400).json({
      error: 'TICKET_REQUIRED',
      message: 'Se requiere un ticket de descarga temporal válido. Solicitá uno en /api/download/request-ticket.'
    });
  }

  const db = getDb();
  const now = Date.now();
  const ticketRow = db.prepare(`
    SELECT * FROM download_tickets WHERE ticket = ?
  `).get(ticket);

  if (!ticketRow) {
    return res.status(403).json({
      error: 'INVALID_TICKET',
      message: 'El ticket de descarga no es válido o ya no existe.'
    });
  }

  if (ticketRow.used === 1) {
    return res.status(403).json({
      error: 'TICKET_ALREADY_USED',
      message: 'Este ticket de descarga ya fue utilizado. Cada descarga requiere un nuevo ticket temporal por seguridad.'
    });
  }

  if (ticketRow.expires_at < now) {
    return res.status(403).json({
      error: 'TICKET_EXPIRED',
      message: 'El ticket de descarga ha expirado (límite de 120 segundos excedido).'
    });
  }

  // Check user still has Pro entitlement
  const subDetails = getUserSubscriptionDetails(ticketRow.user_id);
  if (!subDetails.canDownloadDesktop) {
    return res.status(403).json({
      error: 'SUBSCRIPTION_INACTIVE',
      message: 'La suscripción requerida ya no está activa.'
    });
  }

  if (!fs.existsSync(ZIP_PATH)) {
    return res.status(404).json({
      error: 'FILE_NOT_FOUND',
      message: 'El archivo de distribución no se encuentra disponible temporalmente.'
    });
  }

  // Atomically mark ticket as used
  db.prepare('UPDATE download_tickets SET used = 1 WHERE id = ?').run(ticketRow.id);

  // Record download audit log
  db.prepare(`
    INSERT INTO download_logs (user_id, version, ip_address, downloaded_at)
    VALUES (?, '1.0.0', ?, ?)
  `).run(ticketRow.user_id, req.socket.remoteAddress || '127.0.0.1', now);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Pirapire-Desktop-Windows-x64-v1.0.0.zip"');
  
  const stream = fs.createReadStream(ZIP_PATH);
  stream.pipe(res);
}

function downloadDesktopApp(req, res) {
  // Reject tokens in URL query string for security
  if (req.query && req.query.token) {
    return res.status(400).json({
      error: 'INSECURE_TOKEN_TRANSPORT',
      message: 'Por seguridad, los tokens de sesión no deben transmitirse como parámetros de URL. Solicitá un ticket temporal mediante POST /api/download/request-ticket o transmití el token en el encabezado Authorization: Bearer.'
    });
  }

  const user = req.user;
  const subDetails = getUserSubscriptionDetails(user.id);

  if (!subDetails.canDownloadDesktop) {
    return res.status(403).json({
      error: 'DOWNLOAD_FORBIDDEN',
      code: 'PRO_SUBSCRIPTION_REQUIRED',
      message: 'La descarga de Pirapire Desktop para Windows requiere una suscripción activa a Pirapire Pro.',
      currentPlan: user.plan,
      upgradeUrl: 'planes.html'
    });
  }

  if (!fs.existsSync(ZIP_PATH)) {
    return res.status(404).json({
      error: 'FILE_NOT_FOUND',
      message: 'El archivo de distribución no se encuentra disponible temporalmente.'
    });
  }

  // Record download audit log
  const db = getDb();
  db.prepare(`
    INSERT INTO download_logs (user_id, version, ip_address, downloaded_at)
    VALUES (?, '1.0.0', ?, ?)
  `).run(user.id, req.socket.remoteAddress || '127.0.0.1', Date.now());

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Pirapire-Desktop-Windows-x64-v1.0.0.zip"');
  
  const stream = fs.createReadStream(ZIP_PATH);
  stream.pipe(res);
}

module.exports = {
  getDownloadManifest,
  downloadDesktopApp,
  requestDownloadTicket,
  downloadWithTicket
};
