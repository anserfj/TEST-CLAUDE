// ── SCHEDULER — automations background jobs ──────────────────────────────────
import db from './db/database.js';
import { sendMessageToUser } from './bot/bot.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}

// ── Welcome message ───────────────────────────────────────────────────────────
// Called from bot.js when a new validated user is created
export async function sendWelcomeMessage(telegramId) {
  try {
    if (getSetting('auto_welcome_enabled') !== '1') return;
    const text = getSetting('auto_welcome_text');
    if (!text?.trim()) return;
    await sendMessageToUser(telegramId, text);
  } catch(e) {
    console.error('[scheduler] welcome error:', e.message);
  }
}

// ── Inactivity reminder ───────────────────────────────────────────────────────
async function runInactivityReminder() {
  if (getSetting('auto_inactivity_enabled') !== '1') return;
  const days = parseInt(getSetting('auto_inactivity_days')) || 14;
  const text = getSetting('auto_inactivity_text');
  if (!text?.trim()) return;

  // Users validated, not blacklisted, with at least one past order, but none in last X days,
  // and who have NOT already received an inactivity reminder
  const users = db.prepare(`
    SELECT DISTINCT u.id, u.telegram_id FROM users u
    JOIN orders o_past ON o_past.user_id = u.id
    LEFT JOIN orders o_recent ON o_recent.user_id = u.id
      AND o_recent.created_at >= datetime('now', '-' || ? || ' days')
    WHERE (u.blacklisted = 0 OR u.blacklisted IS NULL)
      AND u.is_validated = 1
      AND o_recent.id IS NULL
      AND u.last_inactivity_reminder IS NULL
  `).all(days);

  let sent = 0;
  for (const u of users) {
    // Marquer AVANT d'envoyer pour éviter les doublons même en cas d'erreur
    db.prepare('UPDATE users SET last_inactivity_reminder = datetime("now") WHERE id = ?').run(u.id);
    try {
      await sendMessageToUser(u.telegram_id, text);
      sent++;
    } catch(e) {
      console.error(`[scheduler] failed to send reminder to ${u.telegram_id}:`, e.message);
    }
  }
  if (sent > 0) console.log(`[scheduler] inactivity reminder sent to ${sent} users`);
  else if (users.length > 0) console.log(`[scheduler] ${users.length} reminders marked but send failed`);
}

// ── Shop inactivity alert ─────────────────────────────────────────────────────
async function runShopAlert() {
  if (getSetting('auto_shop_alert_enabled') !== '1') return;
  const hours = parseInt(getSetting('auto_shop_alert_hours')) || 4;

  const recentOrder = db.prepare(`
    SELECT id FROM orders WHERE created_at >= datetime('now', '-' || ? || ' hours') LIMIT 1
  `).get(hours);

  if (!recentOrder) {
    console.log(`[scheduler] shop alert — no orders in ${hours}h`);
  }
}

// ── Main loop — run every hour ────────────────────────────────────────────────
export function startScheduler() {
  console.log('[scheduler] started');

  // First run after 5 min to let the server warm up
  setTimeout(() => {
    runInactivityReminder().catch(e => console.error('[scheduler] inactivity error:', e.message));
    runShopAlert().catch(e => console.error('[scheduler] shop alert error:', e.message));
  }, 5 * 60 * 1000);

  // Then every hour
  setInterval(() => {
    runInactivityReminder().catch(e => console.error('[scheduler] inactivity error:', e.message));
    runShopAlert().catch(e => console.error('[scheduler] shop alert error:', e.message));
  }, 60 * 60 * 1000);
}
