// ── Telegram Mini App initData HMAC-SHA256 validation ────────────────────────
// Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import crypto from 'crypto';

/**
 * Validate Telegram WebApp initData.
 * @param {string} initData - The raw initData string from Telegram.WebApp.initData
 * @param {string} botToken - The bot token from BOT_TOKEN env var
 * @returns {{ valid: boolean, data: object|null }}
 */
export function validateInitData(initData, botToken) {
  if (!initData || !botToken) return { valid: false, data: null };

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, data: null };

    // Build data-check-string (all fields except hash, sorted alphabetically)
    params.delete('hash');
    const checkString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256 with key = HMAC-SHA256("WebAppData", botToken)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    if (expectedHash !== hash) return { valid: false, data: null };

    // Check expiry (24h)
    const authDate = parseInt(params.get('auth_date') || '0');
    if (Date.now() / 1000 - authDate > 86400) return { valid: false, data: null };

    // Parse user object
    const userJson = params.get('user');
    const user = userJson ? JSON.parse(userJson) : null;

    return { valid: true, data: { user, auth_date: authDate } };
  } catch(e) {
    console.error('validateInitData error:', e.message);
    return { valid: false, data: null };
  }
}

/**
 * Express middleware — validates Telegram initData from X-Telegram-Init-Data header.
 * Attaches req.telegramUser if valid.
 * In development (no BOT_TOKEN), passes through.
 */
export function telegramAuthMiddleware(req, res, next) {
  const botToken = process.env.BOT_TOKEN;

  // Dev mode or no token: pass through (fail-open for local testing)
  if (!botToken || botToken === 'your_telegram_bot_token_here') {
    req.telegramUser = null;
    return next();
  }

  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || '';

  if (!initData) {
    return res.status(401).json({ error: 'initData manquant' });
  }

  const { valid, data } = validateInitData(initData, botToken);
  if (!valid) {
    return res.status(401).json({ error: 'initData invalide ou expiré' });
  }

  req.telegramUser = data.user;
  next();
}
