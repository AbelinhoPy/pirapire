// src/routes/downloadRoutes.js - Server-Protected Download Controller
const path = require('path');
const fs = require('fs');
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

function downloadDesktopApp(req, res) {
  const user = req.user;
  const subDetails = getUserSubscriptionDetails(user.id);

  if (!subDetails.canDownloadDesktop) {
    return res.status(403).json({
      error: 'DOWNLOAD_FORBIDDEN',
      code: 'PRO_SUBSCRIPTION_REQUIRED',
      message: 'La descarga de Pirapire Desktop para Windows requiere una suscripción activa a Pirapire Pro.',
      currentPlan: user.plan,
      upgradeUrl: '/planes.html'
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
  downloadDesktopApp
};
