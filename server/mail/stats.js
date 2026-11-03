// Mail: campaign numbers (delivered, opened, clicked, unsubscribed, bounced) and per-customer history.
const { get, all } = require('../db');
const config = require('../config');

const webhookSecret = () => { try { return require('../integrations').value('email.webhook_secret') || process.env.RESEND_WEBHOOK_SECRET || ''; } catch { return process.env.RESEND_WEBHOOK_SECRET || ''; } };

function stats(cid) {
  const r = get(`SELECT COUNT(*) AS total, SUM(status = 'queued') AS queued, SUM(status = 'sending') AS sending, SUM(status = 'sent') AS sent,
    SUM(status = 'failed') AS failed, SUM(status = 'skipped') AS skipped, SUM(status = 'cancelled') AS cancelled,
    SUM(delivered_at IS NOT NULL) AS delivered, SUM(opened_at IS NOT NULL) AS opened, SUM(clicked_at IS NOT NULL) AS clicked,
    SUM(unsubscribed_at IS NOT NULL) AS unsubscribed, SUM(bounced_at IS NOT NULL) AS bounced, SUM(complained_at IS NOT NULL) AS complained,
    COALESCE(SUM(open_count), 0) AS opens, COALESCE(SUM(click_count), 0) AS clicks FROM mail_sends WHERE campaign_id = ?`, Number(cid));
  const n = (k) => Number(r[k]) || 0;
  const tracked = !!webhookSecret() && !!config.email.resendKey;
  // Without the Resend webhook, "delivered" is estimated as sent minus bounces.
  const delivered = tracked ? n('delivered') : Math.max(0, n('sent') - n('bounced'));
  const base = Math.max(1, delivered);
  const pct = (x) => Math.round((x / base) * 1000) / 10;
  return {
    total: n('total'), queued: n('queued') + n('sending'), sent: n('sent'), failed: n('failed'), skipped: n('skipped'), cancelled: n('cancelled'),
    delivered, delivered_estimated: !tracked, opened: n('opened'), clicked: n('clicked'), unsubscribed: n('unsubscribed'), bounced: n('bounced'), complained: n('complained'),
    opens: n('opens'), clicks: n('clicks'),
    open_rate: pct(n('opened')), click_rate: pct(n('clicked')), unsub_rate: pct(n('unsubscribed')), bounce_rate: n('sent') ? Math.round((n('bounced') / n('sent')) * 1000) / 10 : 0,
    progress: n('total') ? Math.round(((n('sent') + n('failed') + n('skipped') + n('cancelled')) / n('total')) * 100) : 0,
  };
}

function topLinks(cid) {
  return all("SELECT url, COUNT(*) AS clicks, COUNT(DISTINCT send_id) AS people FROM mail_events WHERE campaign_id = ? AND type = 'click' GROUP BY url ORDER BY clicks DESC LIMIT 10", Number(cid));
}

// Every campaign email one customer got, newest first, plus their lifecycle emails.
function userHistory(userId, email) {
  const e = String(email || '').toLowerCase();
  const sends = all(`SELECT ms.id, ms.campaign_id, c.name AS campaign, c.subject, ms.status, ms.sent_at, ms.delivered_at, ms.opened_at, ms.open_count,
    ms.clicked_at, ms.click_count, ms.bounced_at, ms.complained_at, ms.unsubscribed_at, ms.error
    FROM mail_sends ms JOIN mail_campaigns c ON c.id = ms.campaign_id WHERE ms.user_id = ? OR ms.email = ? ORDER BY ms.id DESC LIMIT 100`, Number(userId) || 0, e);
  const lifecycle = all('SELECT id, template, send_at, sent_at, error FROM email_queue WHERE user_id = ? OR lower(to_email) = ? ORDER BY id DESC LIMIT 100', Number(userId) || 0, e);
  return { sends, lifecycle };
}

module.exports = { stats, topLinks, userHistory, webhookSecret };
