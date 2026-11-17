// src/email/emailService.js - Transactional Email Engine
const { getDb } = require('../db/db');

function recordOutboxEmail(toEmail, subject, bodyHtml, type) {
  const db = getDb();
  db.prepare(`
    INSERT INTO email_outbox (to_email, subject, body_html, type, sent_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(toEmail, subject, bodyHtml, type, Date.now());

  // Also log to console in development
  console.log(`[EMAIL DISPATCH] To: ${toEmail} | Type: ${type} | Subject: "${subject}"`);
}

function sendVerificationEmail(toEmail, token, appBaseUrl = 'http://localhost:3000') {
  const verifyUrl = `${appBaseUrl}/verify-email.html?token=${token}`;
  const subject = 'Confirmá tu cuenta en Pirapire';
  const bodyHtml = `
    <div style="font-family: sans-serif; background: #0b0c10; color: #e5e7eb; padding: 32px; border-radius: 8px;">
      <h2 style="color: #f59e0b; margin-top: 0;">¡Bienvenido a Pirapire!</h2>
      <p>Gracias por sumarte a la plataforma de simulación y trading algorítmico para Paraguay.</p>
      <p>Para activar tus <strong>5 backtests gratuitos</strong>, por favor confirmá tu correo haciendo clic en el siguiente enlace:</p>
      <div style="margin: 24px 0;">
        <a href="${verifyUrl}" style="background: #f59e0b; color: #000; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Confirmar mi correo</a>
      </div>
      <p style="color: #9ca3af; font-size: 13px;">O copiá este enlace en tu navegador:<br><a href="${verifyUrl}" style="color: #f59e0b;">${verifyUrl}</a></p>
      <hr style="border: 1px solid #1f2937; margin: 24px 0;">
      <p style="color: #6b7280; font-size: 11px;">Pirapire Technologies S.A. - Asunción / Ciudad del Este, Paraguay.</p>
    </div>
  `;

  recordOutboxEmail(toEmail, subject, bodyHtml, 'VERIFICATION');
  return { success: true, verifyUrl, token };
}

function sendPasswordResetEmail(toEmail, token, appBaseUrl = 'http://localhost:3000') {
  const resetUrl = `${appBaseUrl}/reset-password.html?token=${token}`;
  const subject = 'Recuperación de contraseña en Pirapire';
  const bodyHtml = `
    <div style="font-family: sans-serif; background: #0b0c10; color: #e5e7eb; padding: 32px; border-radius: 8px;">
      <h2 style="color: #f59e0b; margin-top: 0;">Recuperación de contraseña</h2>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Pirapire.</p>
      <p>Hacé clic en el siguiente botón para establecer una nueva clave (válido por 1 hora):</p>
      <div style="margin: 24px 0;">
        <a href="${resetUrl}" style="background: #f59e0b; color: #000; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Restablecer contraseña</a>
      </div>
      <p style="color: #9ca3af; font-size: 13px;">Si no solicitaste este cambio, podés ignorar este mensaje.</p>
      <hr style="border: 1px solid #1f2937; margin: 24px 0;">
      <p style="color: #6b7280; font-size: 11px;">Pirapire Technologies S.A. - Asunción / Ciudad del Este, Paraguay.</p>
    </div>
  `;

  recordOutboxEmail(toEmail, subject, bodyHtml, 'PASSWORD_RESET');
  return { success: true, resetUrl, token };
}

function sendPurchaseReceiptEmail(toEmail, details) {
  const subject = `Comprobante de compra Pirapire Pro - ${details.orderId}`;
  const bodyHtml = `
    <div style="font-family: sans-serif; background: #0b0c10; color: #e5e7eb; padding: 32px; border-radius: 8px;">
      <h2 style="color: #10b981; margin-top: 0;">¡Tu suscripción a Pirapire Pro está activa!</h2>
      <p>Confirmamos la recepción de tu pago correspondiente al acceso a <strong>Pirapire Pro</strong>.</p>
      <div style="background: #111827; padding: 16px; border-radius: 6px; margin: 20px 0; border: 1px solid #374151;">
        <p style="margin: 4px 0;"><strong>N° de Pedido:</strong> ${details.orderId}</p>
        <p style="margin: 4px 0;"><strong>Plan:</strong> ${details.planName}</p>
        <p style="margin: 4px 0;"><strong>Total Pagado:</strong> ₲ ${Number(details.amountPyg).toLocaleString('es-PY')}</p>
        <p style="margin: 4px 0;"><strong>Acceso vigente hasta:</strong> ${details.expiresAt}</p>
      </div>
      <p>Ya podés acceder a backtests ilimitados, comparador de estrategias y descargar Pirapire Desktop desde tu panel.</p>
      <div style="margin: 24px 0;">
        <a href="/cuenta.html" style="background: #f59e0b; color: #000; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Ir a Mi Cuenta</a>
      </div>
      <hr style="border: 1px solid #1f2937; margin: 24px 0;">
      <p style="color: #6b7280; font-size: 11px;">Emisor: Pirapire Technologies S.A. - RUC en trámite - Comercio Electrónico Ley 4868/13.</p>
    </div>
  `;

  recordOutboxEmail(toEmail, subject, bodyHtml, 'PURCHASE_RECEIPT');
  return { success: true };
}

function getRecentOutbox(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT id, to_email, subject, type, sent_at
    FROM email_outbox
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPurchaseReceiptEmail,
  getRecentOutbox
};
