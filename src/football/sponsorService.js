// src/football/sponsorService.js - Sponsorship Campaign Management & Analytics
const { getDb } = require('../db/db');

/**
 * Retrieves the currently active sponsorship campaign, or null if inactive/none.
 * Gated by dates and is_active flag.
 */
function getActiveSponsorship() {
  const db = getDb();
  const now = Date.now();

  const campaign = db.prepare(`
    SELECT id, brand_name, tagline, cta_text, link_url, is_active, start_date, end_date, impressions_count, clicks_count
    FROM sponsor_campaigns
    WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
    ORDER BY id DESC
    LIMIT 1
  `).get(now, now);

  if (!campaign) {
    return null; // Hidden when no active campaign
  }

  // Increment impression counter
  db.prepare(`
    UPDATE sponsor_campaigns
    SET impressions_count = impressions_count + 1
    WHERE id = ?
  `).run(campaign.id);

  return {
    id: campaign.id,
    label: 'Publicidad', // Obligatory label
    brandName: campaign.brand_name,
    tagline: campaign.tagline,
    ctaText: campaign.cta_text,
    linkUrl: campaign.link_url,
    targetUrl: campaign.link_url,
    disclosure: 'Espacio de patrocinio por tarifa fija. El patrocinador no influye en las conclusiones estadísticas ni pronósticos de Pirapire Fútbol.',
    impressions: campaign.impressions_count + 1,
    clicks: campaign.clicks_count
  };
}

/**
 * Records a click on a sponsor campaign
 */
function recordSponsorClick(campaignId) {
  const db = getDb();
  db.prepare(`
    UPDATE sponsor_campaigns
    SET clicks_count = clicks_count + 1
    WHERE id = ?
  `).run(campaignId);
  return { success: true };
}

/**
 * Configures or seeds a sponsor campaign (for admin or tests)
 */
function configureSponsorCampaign(params) {
  const db = getDb();
  const {
    brandName = 'Yerba Mate Selecta (Piloto)',
    tagline = 'La energía que acompaña a la hinchada paraguaya en cada clásico',
    ctaText = 'Conocé más',
    linkUrl = 'https://example.com/selecta',
    isActive = 1,
    durationDays = 30
  } = params;

  const now = Date.now();
  const endDate = now + (durationDays * 24 * 60 * 60 * 1000);

  const info = db.prepare(`
    INSERT INTO sponsor_campaigns (brand_name, tagline, cta_text, link_url, is_active, start_date, end_date, impressions_count, clicks_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
  `).run(brandName, tagline, ctaText, linkUrl, isActive ? 1 : 0, now, endDate, now);

  return Number(info.lastInsertRowid);
}

function deactivateAllSponsors() {
  const db = getDb();
  db.prepare('UPDATE sponsor_campaigns SET is_active = 0').run();
}

module.exports = {
  getActiveSponsorship,
  recordSponsorClick,
  configureSponsorCampaign,
  deactivateAllSponsors
};
