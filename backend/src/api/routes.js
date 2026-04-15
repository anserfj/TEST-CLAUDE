import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/database.js';
import { notifyGroupOrder, notifyGroup, notifyLogin, sendMessageToUser } from '../bot/bot.js';
import { generateToken, authMiddleware, checkLoginAllowed, recordFailedAttempt, recordSuccessLogin, createPending2fa, validatePending2fa, auditLog } from '../auth.js';
import { verifyTotp, generateTotpSecret, totpUri } from '../totp.js';
import { telegramAuthMiddleware } from '../telegramAuth.js';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

// ── Input sanitizer — strip HTML tags from strings ───────────────────────────
function sanitize(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/<[^>]*>/g, '').trim();
}
function sanitizeObj(obj, keys) {
  const out = { ...obj };
  for (const k of keys) if (typeof out[k] === 'string') out[k] = sanitize(out[k]);
  return out;
}

const router = Router();

// ── AUTH ───────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  const { email, pass } = req.body;

  // Brute force protection
  const check = checkLoginAllowed(ip);
  if (!check.allowed) {
    return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${check.remaining} min.` });
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@shop.local';
  const adminPass  = process.env.ADMIN_PASS  || 'changeme';

  if (email === adminEmail && pass === adminPass) {
    const ua   = req.headers['user-agent'] || '?';
    const time = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    let geoLine = '';
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,regionName,country,isp&lang=fr`);
      const geo = await geoRes.json();
      if (geo.status === 'success') geoLine = `\n📍 ${geo.city}, ${geo.regionName}, ${geo.country}\n🏢 ${geo.isp}`;
    } catch {}

    // Check if 2FA is enabled
    const totpEnabled = db.prepare("SELECT value FROM settings WHERE key='totp_enabled'").get()?.value === '1';
    const totpSecret  = db.prepare("SELECT value FROM settings WHERE key='totp_secret'").get()?.value || '';

    if (totpEnabled && totpSecret) {
      // Issue a temporary token — client must complete 2FA within 5 min
      const tempToken = createPending2fa(ip);
      auditLog('login_2fa_pending', { email, ip }, ip);
      return res.json({ success: false, require2fa: true, tempToken });
    }

    recordSuccessLogin(ip);
    const token = generateToken();
    auditLog('login_success', { email, ip }, ip);
    notifyLogin(
      `🔐 <b>Connexion au dashboard Baltimore 83</b>\n\n🕐 ${time}\n🌐 IP : <code>${ip}</code>${geoLine}\n📱 ${ua.slice(0, 100)}`
    ).catch(() => {});

    res.json({ success: true, token });
  } else {
    recordFailedAttempt(ip);
    auditLog('login_failed', { email: (email || '').slice(0, 80), ip }, ip);
    const ua   = req.headers['user-agent'] || '?';
    const time = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    let geoLine = '';
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,regionName,country,isp&lang=fr`);
      const geo = await geoRes.json();
      if (geo.status === 'success') geoLine = `\n📍 ${geo.city}, ${geo.regionName}, ${geo.country}\n🏢 ${geo.isp}`;
    } catch {}
    notifyLogin(
      `⚠️ <b>Tentative de connexion échouée — Baltimore 83</b>\n\n🕐 ${time}\n🌐 IP : <code>${ip}</code>${geoLine}\n👤 Email : <code>${(email || '').slice(0, 80)}</code>\n📱 ${ua.slice(0, 100)}`
    ).catch(() => {});
    res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }
});

// 2FA verification
router.post('/auth/2fa', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  const { tempToken, code } = req.body;
  if (!tempToken || !code) return res.status(400).json({ error: 'Paramètres manquants' });

  if (!validatePending2fa(tempToken, ip)) {
    auditLog('2fa_invalid_session', { ip }, ip);
    return res.status(401).json({ error: 'Session 2FA invalide ou expirée' });
  }

  const secret = db.prepare("SELECT value FROM settings WHERE key='totp_secret'").get()?.value || '';
  if (!verifyTotp(secret, code)) {
    auditLog('2fa_wrong_code', { ip }, ip);
    return res.status(401).json({ error: 'Code incorrect' });
  }

  recordSuccessLogin(ip);
  const token = generateToken();
  auditLog('login_success_2fa', { ip }, ip);
  res.json({ success: true, token });
});

// ── PUBLIC ROUTES (no auth needed — miniapp + shop catalog) ───────────────────

router.get('/config', (req, res) => {
  res.json({ miniapp_url: process.env.MINIAPP_URL || '' });
});

router.get('/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    ORDER BY c.sort_order, p.name
  `).all();
  res.json(products.map(p => ({ ...p, tiers: p.tiers ? JSON.parse(p.tiers) : null })));
});

router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
});

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

// Public promo check (used by miniapp)
router.get('/promo/:code', (req, res) => {
  const telegramId = req.query.telegram_id;
  const promo = db.prepare('SELECT * FROM promos WHERE UPPER(code) = UPPER(?) AND active = 1').get(req.params.code);
  if (!promo) return res.status(404).json({ error: 'Code promo invalide' });
  if (promo.max_uses > 0 && promo.uses_count >= promo.max_uses)
    return res.status(400).json({ error: 'Code promo épuisé' });
  if (promo.expires_at && new Date(promo.expires_at) < new Date())
    return res.status(400).json({ error: 'Code promo expiré' });
  if (promo.user_id) {
    if (!telegramId) return res.status(403).json({ error: 'Code promo réservé' });
    const user = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user || user.id !== promo.user_id) return res.status(403).json({ error: 'Code promo réservé' });
  }
  res.json(promo);
});

// ── MINIAPP ENDPOINTS (public — called by Telegram users) ─────────────────────

// ── MINIAPP ENDPOINTS (public — called by Telegram users) ─────────────────────

router.get('/miniapp/access/:telegramId', (req, res) => {
  const user = db.prepare('SELECT is_validated, referral_code, blacklisted FROM users WHERE telegram_id = ?').get(req.params.telegramId);
  if (!user) return res.json({ validated: false, referral_code: null });
  if (user.blacklisted) return res.json({ validated: false, blacklisted: true, referral_code: null });
  res.json({ validated: !!user.is_validated, referral_code: user.referral_code });
});

router.get('/miniapp/orders/:telegramId', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.params.telegramId);
  if (!user) return res.json([]);
  const orders = db.prepare('SELECT o.* FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 20').all(user.id);
  const withItems = orders.map(order => {
    const items = db.prepare('SELECT oi.*, p.name, p.unit FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?').all(order.id);
    return { ...order, items };
  });
  res.json(withItems);
});

router.post('/miniapp/order', telegramAuthMiddleware, (req, res) => {
  const raw = req.body;
  const telegram_id = raw.telegram_id;
  const items = raw.items;
  const promo_code = raw.promo_code;
  // Sanitize text inputs
  const notes           = sanitize(raw.notes || '');
  const delivery_name   = sanitize(raw.delivery_name || '');
  const delivery_phone  = sanitize(raw.delivery_phone || '');
  const delivery_address = sanitize(raw.delivery_address || '');

  if (!telegram_id || !items?.length) return res.status(400).json({ error: 'Champs manquants' });
  if (!delivery_name || !delivery_phone || !delivery_address)
    return res.status(400).json({ error: 'Nom, téléphone et adresse requis' });

  // Validate that initData telegram_id matches body telegram_id (if initData was provided)
  if (req.telegramUser && String(req.telegramUser.id) !== String(telegram_id)) {
    return res.status(403).json({ error: 'Identité Telegram invalide' });
  }

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable. Démarrez le bot d\'abord.' });
  if (!user.is_validated) return res.status(403).json({ error: 'Compte non validé. Entre un code de parrainage dans le bot.' });

  // ── Order rate limiting ───────────────────────────────────────────────────
  const maxOrders = parseInt(db.prepare("SELECT value FROM settings WHERE key='order_rate_limit'").get()?.value || '5');
  const windowHours = parseInt(db.prepare("SELECT value FROM settings WHERE key='order_rate_window_hours'").get()?.value || '1');
  const rateRow = db.prepare('SELECT * FROM order_rate WHERE telegram_id = ?').get(telegram_id);
  if (rateRow) {
    const windowStart = new Date(rateRow.window_start + 'Z');
    const windowAge = (Date.now() - windowStart.getTime()) / 3600000;
    if (windowAge < windowHours) {
      if (rateRow.count >= maxOrders)
        return res.status(429).json({ error: `Trop de commandes. Maximum ${maxOrders} commandes par ${windowHours}h.` });
    } else {
      // Reset window
      db.prepare("UPDATE order_rate SET count = 0, window_start = datetime('now') WHERE telegram_id = ?").run(telegram_id);
    }
  }

  // Check no-delivery zones
  const zonesRaw = db.prepare('SELECT value FROM settings WHERE key = ?').get('no_delivery_zones')?.value;
  if (zonesRaw) {
    try {
      const zones = JSON.parse(zonesRaw);
      const addrLower = delivery_address.toLowerCase();
      const blocked = zones.find(z => z.name && addrLower.includes(z.name.toLowerCase()));
      if (blocked) return res.status(400).json({ error: `❌ Nous ne livrons pas dans cette zone (${blocked.name}).` });
    } catch {}
  }

  // ── Server-side price calculation (prevents price tampering) ─────────────────
  let subtotalCalc = 0;
  const itemsWithDetails = [];
  for (const item of items) {
    const prod = db.prepare('SELECT p.*, c.name as category_name, c.emoji as category_emoji FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ? AND p.active = 1').get(item.product_id);
    if (!prod) return res.status(400).json({ error: `Produit introuvable` });

    const qty = Math.max(1, parseInt(item.quantity) || 1);
    let unitPrice = parseFloat(prod.price || 0);

    // Apply tier pricing if available
    // tier.price = prix TOTAL pour tier.qty unités → prix unitaire = tier.price / tier.qty
    if (prod.tiers) {
      try {
        const tiers = JSON.parse(prod.tiers).sort((a, b) => b.qty - a.qty);
        for (const t of tiers) {
          if (qty >= parseFloat(t.qty)) { unitPrice = parseFloat(t.price) / parseFloat(t.qty); break; }
        }
      } catch {}
    }

    subtotalCalc += unitPrice * qty;
    itemsWithDetails.push({ product_id: prod.id, quantity: qty, unit_price: unitPrice, prod });
  }

  // Apply promo server-side (with min_order check)
  let discountCalc = 0;
  let appliedPromo = null;
  if (promo_code) {
    appliedPromo = db.prepare('SELECT * FROM promos WHERE UPPER(code) = UPPER(?) AND active = 1').get(promo_code);
    if (appliedPromo) {
      if (appliedPromo.max_uses > 0 && appliedPromo.uses_count >= appliedPromo.max_uses)
        return res.status(400).json({ error: 'Code promo épuisé' });
      if (appliedPromo.expires_at && new Date(appliedPromo.expires_at) < new Date())
        return res.status(400).json({ error: 'Code promo expiré' });
      if (appliedPromo.user_id && appliedPromo.user_id !== user.id)
        return res.status(403).json({ error: 'Code promo réservé' });
      if (appliedPromo.min_order > 0 && subtotalCalc < appliedPromo.min_order)
        return res.status(400).json({ error: `Commande minimum ${appliedPromo.min_order}€ requis pour ce code` });
      if (appliedPromo.discount_type === 'percent')
        discountCalc = subtotalCalc * parseFloat(appliedPromo.discount_value) / 100;
      else
        discountCalc = parseFloat(appliedPromo.discount_value);
      discountCalc = Math.min(discountCalc, subtotalCalc);
    }
  }

  const deliveryFee      = parseFloat(db.prepare("SELECT value FROM settings WHERE key='delivery_fee'").get()?.value || 0);
  const freeThreshold    = parseFloat(db.prepare("SELECT value FROM settings WHERE key='free_delivery_threshold'").get()?.value || 0);
  const deliveryApplied  = (freeThreshold > 0 && subtotalCalc >= freeThreshold) ? 0 : deliveryFee;
  const totalCalc        = Math.max(0, subtotalCalc + deliveryApplied - discountCalc);

  // Update user contact info
  db.prepare('UPDATE users SET phone = ?, address = ? WHERE telegram_id = ?').run(delivery_phone, delivery_address, telegram_id);
  // Increment order rate counter
  db.prepare("INSERT INTO order_rate (telegram_id, count, window_start) VALUES (?, 1, datetime('now')) ON CONFLICT(telegram_id) DO UPDATE SET count = count + 1").run(telegram_id);

  const createOrder = db.transaction(() => {
    const order = db.prepare(
      'INSERT INTO orders (user_id, total, status, notes, delivery_address, delivery_name, delivery_phone, promo_code, discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, totalCalc, 'pending', notes || null, delivery_address, delivery_name, delivery_phone, promo_code || null, discountCalc);
    const orderId = order.lastInsertRowid;
    for (const item of itemsWithDetails) {
      db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)')
        .run(orderId, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price);
    }
    if (appliedPromo) db.prepare('UPDATE promos SET uses_count = uses_count + 1 WHERE id = ?').run(appliedPromo.id);
    db.prepare('UPDATE users SET last_inactivity_reminder = NULL WHERE id = ?').run(user.id);
    return orderId;
  });

  const orderId = createOrder();

  import('../websocket/wsServer.js').then(({ broadcastToAdmins }) => {
    broadcastToAdmins({ type: 'new_order', order: { id: orderId, total: totalCalc, username: user.username, first_name: user.first_name, items } });
  });

  const tgName   = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Inconnu';
  const tgHandle = user.username ? `@${user.username}` : `ID: ${user.telegram_id}`;
  const now      = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const sep      = '───────────────────';
  const esc      = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const itemsLines = itemsWithDetails.map(i => {
    const unit = i.prod?.unit || 'u';
    return `• <b>${esc(i.prod?.name || `#${i.product_id}`)}</b> × ${i.quantity}${unit} — ${(i.unit_price * i.quantity).toFixed(2)}€`;
  }).join('\n');

  const catMap = {};
  itemsWithDetails.forEach(i => {
    const key = i.prod?.category_name || 'Autre';
    if (!catMap[key]) catMap[key] = { emoji: i.prod?.category_emoji || '📦', name: key, qty: 0, unit: i.prod?.unit || 'u', total: 0 };
    catMap[key].qty   += i.quantity;
    catMap[key].total += i.unit_price * i.quantity;
  });
  const catLines = Object.values(catMap).map(c => `• ${c.emoji} <b>${esc(c.name)}</b> × ${c.qty}${c.unit} — ${c.total.toFixed(2)}€`).join('\n');

  const groupMsg =
    `🛍️ <b>NOUVELLE COMMANDE #${orderId}</b>\n${sep}\n\n` +
    `👤 <b>CLIENT</b>\n📛 Nom: <b>${esc(delivery_name)}</b>\n📱 Tél: <code>${esc(delivery_phone)}</code>\n💬 Telegram: ${esc(tgHandle)} (${esc(tgName)})\n🆔 ID: <code>${user.telegram_id}</code>\n🏠 Adresse: ${esc(delivery_address)}\n` +
    (notes ? `📝 Notes: ${esc(notes)}\n` : '') +
    `\n${sep}\n\n🛒 <b>ARTICLES</b>\n${itemsLines}\n\n${sep}\n\n🗂 <b>PAR CATÉGORIE</b>\n${catLines}\n\n${sep}\n💰 <b>TOTAL: ${totalCalc.toFixed(2)}€</b>\n📅 ${now}`;

  notifyGroupOrder(groupMsg, orderId);

  // Discord notification — même contenu que Telegram (HTML → Markdown)
  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhook) {
    const discordMsg = groupMsg
      .replace(/<b>(.*?)<\/b>/g, '**$1**')
      .replace(/<code>(.*?)<\/code>/g, '`$1`')
      .replace(/<[^>]+>/g, '');
    fetch(discordWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: discordMsg })
    }).catch(() => {});
  }

  const userRecap =
    `✅ <b>Commande #${orderId} confirmée !</b>\n\n🛒 <b>Vos articles:</b>\n${itemsLines}\n\n💰 <b>Total: ${totalCalc.toFixed(2)}€</b>\n\n📦 <b>Livraison à:</b>\n${esc(delivery_name)}\n${esc(delivery_address)}\n\nNotre équipe vous contactera au <code>${esc(delivery_phone)}</code> 🚀\n\n<i>Merci pour votre commande !</i>`;
  sendMessageToUser(user.telegram_id, userRecap).catch(() => {});

  res.json({ success: true, order_id: orderId });
});

// ── DRIVER AUTH ───────────────────────────────────────────────────────────────

const driverTokens = new Map(); // token -> { driverId, name, expires }

function hashPin(pin, salt) {
  return crypto.createHmac('sha256', salt).update(String(pin)).digest('hex');
}

function driverAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non autorisé' });
  const token = auth.slice(7);
  const session = driverTokens.get(token);
  if (!session || session.expires < Date.now()) {
    driverTokens.delete(token);
    return res.status(401).json({ error: 'Session expirée' });
  }
  req.driver = session;
  next();
}

router.post('/driver/login', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Champs requis' });
  const driver = db.prepare('SELECT * FROM drivers WHERE name = ? AND active = 1').get(String(name).trim());
  if (!driver) return res.status(401).json({ error: 'Identifiants incorrects' });
  const hash = hashPin(pin, driver.pin_salt);
  if (hash !== driver.pin_hash) return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = crypto.randomBytes(32).toString('hex');
  driverTokens.set(token, { driverId: driver.id, name: driver.name, expires: Date.now() + 24 * 60 * 60 * 1000 });
  res.json({ token, name: driver.name, id: driver.id });
});

router.get('/driver/orders', driverAuthMiddleware, (req, res) => {
  try {
    const driverId = req.driver.driverId;
    const orders = db.prepare(`
      SELECT o.*, u.first_name, u.last_name, u.username, u.phone as user_phone,
             d.name as driver_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN drivers d ON d.id = o.driver_id
      WHERE
        (o.status IN ('confirmed','preparing') AND (o.driver_id IS NULL OR o.driver_id = ?))
        OR (o.status = 'shipped' AND o.driver_id = ?)
      ORDER BY CASE o.status WHEN 'shipped' THEN 0 WHEN 'preparing' THEN 1 WHEN 'confirmed' THEN 2 END, o.created_at ASC
    `).all(driverId, driverId);
    const result = orders.map(o => {
      const items = db.prepare(`
        SELECT oi.quantity, oi.unit_price, oi.subtotal, p.name as product_name, p.unit
        FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?
      `).all(o.id);
      return { ...o, items };
    });
    res.json(result);
  } catch(e) {
    console.error('[driver/orders]', e.message);
    res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
});

router.get('/driver/stats', driverAuthMiddleware, (req, res) => {
  const driverId = req.driver.driverId;
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
      AVG(CASE WHEN driver_taken_at IS NOT NULL AND driver_delivered_at IS NOT NULL
        THEN CAST((julianday(driver_delivered_at) - julianday(driver_taken_at)) * 1440 AS INTEGER)
      END) as avg_delivery_min,
      AVG(CASE WHEN driver_taken_at IS NOT NULL AND created_at IS NOT NULL
        THEN CAST((julianday(driver_taken_at) - julianday(created_at)) * 1440 AS INTEGER)
      END) as avg_pickup_min
    FROM orders WHERE driver_id = ?
  `).get(driverId);
  const recent = db.prepare(`
    SELECT id, status, total, created_at, driver_taken_at, driver_delivered_at
    FROM orders WHERE driver_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(driverId);
  res.json({ ...stats, recent });
});

router.patch('/driver/orders/:id/status', driverAuthMiddleware, async (req, res) => {
  try {
  const { status } = req.body;
  const orderId = parseInt(req.params.id);
  const driverId = req.driver.driverId;
  if (!['shipped', 'delivered'].includes(status)) return res.status(400).json({ error: 'Statut non autorisé' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  if (status === 'shipped') {
    if (!['confirmed', 'preparing'].includes(order.status)) return res.status(400).json({ error: 'Transition invalide' });
    // Check exclusivity: another driver already took it
    if (order.driver_id && order.driver_id !== driverId) {
      const other = db.prepare('SELECT name FROM drivers WHERE id = ?').get(order.driver_id);
      return res.status(409).json({ error: `Déjà prise en charge par ${other?.name || 'un autre livreur'}` });
    }
    db.prepare(`UPDATE orders SET status='shipped', driver_id=?, driver_taken_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(driverId, orderId);
  } else if (status === 'delivered') {
    if (order.status !== 'shipped') return res.status(400).json({ error: 'Transition invalide' });
    if (order.driver_id !== driverId) return res.status(403).json({ error: 'Cette commande ne vous appartient pas' });
    db.prepare(`UPDATE orders SET status='delivered', driver_delivered_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(orderId);
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
  if (user) {
    const msgs = {
      shipped:   `🚚 <b>Commande #${orderId} en route !</b>\n\nVotre livreur est en chemin.`,
      delivered: `✅ <b>Commande #${orderId} livrée !</b>\n\nMerci pour votre commande. À bientôt ! 🙏`
    };
    sendMessageToUser(user.telegram_id, msgs[status]).catch(() => {});
  }
  res.json({ success: true });
  } catch(e) {
    console.error('[driver/status]', e.message);
    res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
});

// ── AUTH MIDDLEWARE — everything below requires a valid token ──────────────────

router.use(authMiddleware);

// ── UPLOAD ────────────────────────────────────────────────────────────────────

const UPLOAD_DIR = '/app/data/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /image\/(jpeg|png|gif|webp)|video\/(mp4|webm|ogg|quicktime|mov|x-msvideo|x-matroska)/;
    cb(null, allowed.test(file.mimetype));
  }
});

// Magic bytes signatures
const MAGIC = {
  image: [
    [0xFF, 0xD8, 0xFF],                          // JPEG
    [0x89, 0x50, 0x4E, 0x47],                    // PNG
    [0x47, 0x49, 0x46],                          // GIF
    [0x52, 0x49, 0x46, 0x46],                    // WEBP (RIFF)
  ],
  video: [
    [0x00, 0x00, 0x00],                          // MP4/MOV (ftyp box, partial)
    [0x1A, 0x45, 0xDF, 0xA3],                    // MKV/WEBM
  ],
};
function checkMagicBytes(buf, type) {
  if (type === 'image') return MAGIC.image.some(sig => sig.every((b, i) => buf[i] === b));
  if (type === 'video') return true; // Video containers are complex; rely on sharp/reject on image check
  return true;
}

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant ou type invalide' });

  // Magic bytes check for images
  if (req.file.mimetype.startsWith('image/')) {
    const fd = fs.openSync(req.file.path, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    if (!checkMagicBytes(buf, 'image')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Fichier image invalide' });
    }
  }

  if (req.file.mimetype.startsWith('image/')) {
    try {
      const newFilename = req.file.filename.replace(/\.[^.]+$/, '.jpg');
      const outPath = path.join(UPLOAD_DIR, newFilename);
      await sharp(req.file.path)
        .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(outPath);
      fs.unlinkSync(req.file.path);
      return res.json({ url: `/uploads/${newFilename}` });
    } catch(e) {
      console.error('sharp error:', e.message);
      // Remove the original if sharp failed
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(500).json({ error: 'Erreur traitement image' });
    }
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── PRODUCTS ──────────────────────────────────────────────────────────────────

router.get('/products/:id', (req, res) => {
  const product = db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(product);
});

router.post('/products', (req, res) => {
  const { category_id, name, description, price, unit, thc_percent, cbd_percent, active, image_url, video_url, tiers, gallery } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  const result = db.prepare(`
    INSERT INTO products (category_id, name, description, price, unit, thc_percent, cbd_percent, active, image_url, video_url, tiers, gallery)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(category_id || null, name.trim(), description || null, parseFloat(price) || 0, unit || 'g', parseFloat(thc_percent) || 0, parseFloat(cbd_percent) || 0, active !== false ? 1 : 0, image_url || null, video_url || null, tiers?.length ? JSON.stringify(tiers) : null, gallery || null);
  res.json({ id: result.lastInsertRowid, ...req.body });
});

router.put('/products/:id', (req, res) => {
  const { name, description, price, unit, thc_percent, cbd_percent, active, category_id, image_url, video_url, tiers, gallery } = req.body;
  db.prepare(`
    UPDATE products SET name=?, description=?, price=?, unit=?, thc_percent=?, cbd_percent=?, active=?, category_id=?, image_url=?, video_url=?, tiers=?, gallery=?
    WHERE id=?
  `).run(name, description, parseFloat(price) || 0, unit, parseFloat(thc_percent) || 0, parseFloat(cbd_percent) || 0, active ? 1 : 0, category_id || null, image_url || null, video_url || null, tiers?.length ? JSON.stringify(tiers) : null, gallery || null, req.params.id);
  res.json({ success: true });
});

router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM order_items WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM carts WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── CATEGORIES ────────────────────────────────────────────────────────────────

router.post('/categories', (req, res) => {
  const { name, emoji, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  const result = db.prepare('INSERT INTO categories (name, emoji, sort_order) VALUES (?, ?, ?)').run(name.trim(), emoji || '🌿', parseInt(sort_order) || 0);
  res.json({ id: result.lastInsertRowid, name, emoji, sort_order });
});

router.put('/categories/:id', (req, res) => {
  const { name, emoji, active, sort_order } = req.body;
  db.prepare('UPDATE categories SET name=?, emoji=?, active=?, sort_order=? WHERE id=?')
    .run(name, emoji, active ? 1 : 0, parseInt(sort_order) || 0, req.params.id);
  res.json({ success: true });
});

router.delete('/categories/:id', (req, res) => {
  const id = req.params.id;
  const products = db.prepare('SELECT id FROM products WHERE category_id = ?').all(id);
  products.forEach(p => {
    db.prepare('DELETE FROM order_items WHERE product_id = ?').run(p.id);
    db.prepare('DELETE FROM carts WHERE product_id = ?').run(p.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  });
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ success: true });
});

// ── ORDERS ────────────────────────────────────────────────────────────────────

router.get('/orders', (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  let query = `
    SELECT o.*, u.username, u.first_name, u.last_name, u.telegram_id,
           d.name as driver_name,
           COUNT(oi.id) as item_count,
           json_group_array(json_object('name', p.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price)) as items
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN products p ON oi.product_id = p.id
  `;
  const params = [];
  if (status) { query += ' WHERE o.status = ?'; params.push(status); }
  query += ' GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const orders = db.prepare(query).all(...params);
  const total  = db.prepare('SELECT COUNT(*) as c FROM orders' + (status ? ' WHERE status = ?' : '')).get(...(status ? [status] : []));
  res.json({ orders, total: total.c });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT o.*, u.username, u.first_name, u.last_name, u.telegram_id, u.phone, u.address, d.name as driver_name FROM orders o LEFT JOIN users u ON o.user_id = u.id LEFT JOIN drivers d ON o.driver_id = d.id WHERE o.id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  const items = db.prepare('SELECT oi.*, p.name, p.unit FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?').all(req.params.id);
  res.json({ ...order, items });
});

router.patch('/orders/:id/notes', (req, res) => {
  db.prepare("UPDATE orders SET notes = ? WHERE id = ?").run(req.body.notes || null, req.params.id);
  res.json({ success: true });
});

router.patch('/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  auditLog('order_status_change', { order_id: req.params.id, status }, ip);
  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  const order = db.prepare('SELECT o.*, u.telegram_id FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?').get(req.params.id);
  if (order?.telegram_id) {
    const msgs = {
      confirmed: `✅ <b>Commande #${order.id} confirmée !</b>\n\nVotre commande est prise en charge 🚀`,
      preparing: `👨‍🍳 <b>Commande #${order.id} en préparation</b>`,
      shipped:   `🚚 <b>Commande #${order.id} en route !</b>\n\nVotre livreur arrive bientôt 📱`,
      delivered: `🎉 <b>Commande #${order.id} livrée !</b>\n\nMerci pour votre confiance 🌿`,
      cancelled: `❌ <b>Commande #${order.id} annulée.</b>\n\nContactez-nous pour plus d'informations.`,
    };
    if (msgs[status]) sendMessageToUser(order.telegram_id, msgs[status]).catch(() => {});
  }
  res.json({ success: true });
});

// ── DRIVERS (admin management) ────────────────────────────────────────────────

router.get('/drivers', (req, res) => {
  const drivers = db.prepare('SELECT id, name, active, created_at FROM drivers ORDER BY name').all();
  res.json(drivers);
});

router.post('/drivers', (req, res) => {
  const { name, pin } = req.body;
  if (!name?.trim() || !pin) return res.status(400).json({ error: 'Champs requis' });
  if (String(pin).length < 4) return res.status(400).json({ error: 'PIN trop court (min 4 chiffres)' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPin(pin, salt);
  try {
    const r = db.prepare('INSERT INTO drivers (name, pin_hash, pin_salt) VALUES (?, ?, ?)').run(name.trim(), hash, salt);
    res.json({ id: r.lastInsertRowid, name: name.trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nom déjà utilisé' });
    throw e;
  }
});

router.put('/drivers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { pin, active } = req.body;
  if (pin !== undefined) {
    if (String(pin).length < 4) return res.status(400).json({ error: 'PIN trop court' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPin(pin, salt);
    db.prepare('UPDATE drivers SET pin_hash = ?, pin_salt = ? WHERE id = ?').run(hash, salt, id);
  }
  if (active !== undefined) db.prepare('UPDATE drivers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  res.json({ success: true });
});

router.delete('/drivers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM drivers WHERE id = ?').run(id);
  for (const [token, s] of driverTokens.entries()) if (s.driverId === id) driverTokens.delete(token);
  res.json({ success: true });
});

router.get('/drivers/:id/stats', (req, res) => {
  const id = parseInt(req.params.id);
  const driver = db.prepare('SELECT id, name, active, created_at FROM drivers WHERE id = ?').get(id);
  if (!driver) return res.status(404).json({ error: 'Livreur introuvable' });
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
      COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) as total_delivered_amount,
      AVG(CASE WHEN driver_taken_at IS NOT NULL AND driver_delivered_at IS NOT NULL
        THEN CAST((julianday(driver_delivered_at) - julianday(driver_taken_at)) * 1440 AS INTEGER) END) as avg_delivery_min,
      AVG(CASE WHEN driver_taken_at IS NOT NULL
        THEN CAST((julianday(driver_taken_at) - julianday(created_at)) * 1440 AS INTEGER) END) as avg_pickup_min
    FROM orders WHERE driver_id = ?
  `).get(id);
  const recent = db.prepare(`
    SELECT o.id, o.status, o.total, o.created_at, o.driver_taken_at, o.driver_delivered_at,
           u.first_name, u.last_name, u.username
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.driver_id = ? ORDER BY o.created_at DESC LIMIT 20
  `).all(id);
  res.json({ driver, stats, recent });
});

// ── USERS ─────────────────────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total), 0) as total_spent
    FROM users u LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.id ORDER BY u.last_seen DESC
  `).all();
  res.json(users);
});

router.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

router.patch('/users/:id/notes', (req, res) => {
  db.prepare('UPDATE users SET notes = ? WHERE id = ?').run(req.body.notes || null, req.params.id);
  res.json({ success: true });
});

router.get('/users/:id/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, (SELECT json_group_array(json_object('name', p.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal, 'unit', p.unit))
      FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id) as items_json
    FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC
  `).all(req.params.id);
  res.json(orders.map(o => ({ ...o, items: o.items_json ? JSON.parse(o.items_json) : [] })));
});

router.patch('/users/:id/validate', (req, res) => {
  db.prepare('UPDATE users SET is_validated = ? WHERE id = ?').run(req.body.validated ? 1 : 0, req.params.id);
  res.json({ success: true });
});

router.patch('/users/:id/tag', (req, res) => {
  const { tag } = req.body;
  const valid = [null, 'vip', 'regulier', 'nouveau'];
  if (!valid.includes(tag)) return res.status(400).json({ error: 'Tag invalide' });
  db.prepare('UPDATE users SET tag = ? WHERE id = ?').run(tag || null, req.params.id);
  res.json({ success: true });
});

router.patch('/users/:id/blacklist', (req, res) => {
  const { blacklisted } = req.body;
  db.prepare('UPDATE users SET blacklisted = ? WHERE id = ?').run(blacklisted ? 1 : 0, req.params.id);
  res.json({ success: true });
});

router.get('/users/:id/referrals', (req, res) => {
  res.json(db.prepare('SELECT u.id, u.first_name, u.last_name, u.username, u.created_at FROM users u WHERE u.referred_by = ?').all(req.params.id));
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────

router.get('/broadcasts', (req, res) => {
  res.json(db.prepare(`
    SELECT text, created_at, COUNT(*) as recipients FROM messages
    WHERE is_broadcast = 1 AND from_admin = 1
    GROUP BY text, strftime('%Y-%m-%d %H:%M', created_at)
    ORDER BY created_at DESC LIMIT 30
  `).all());
});

router.post('/broadcast', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message vide' });
  const users = db.prepare('SELECT id, telegram_id FROM users WHERE blacklisted = 0 OR blacklisted IS NULL').all();
  let sent = 0, failed = 0;
  const insertMsg = db.prepare('INSERT INTO messages (user_id, telegram_id, text, from_admin, is_broadcast, read) VALUES (?, ?, ?, 1, 1, 1)');
  for (const u of users) {
    try { await sendMessageToUser(u.telegram_id, text); insertMsg.run(u.id, u.telegram_id, text); sent++; }
    catch { failed++; }
  }
  res.json({ sent, failed, total: users.length });
});

// Segmented broadcast
router.post('/broadcast/segment', async (req, res) => {
  const { text, segment, segment_value } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message vide' });
  if (!segment) return res.status(400).json({ error: 'Segment requis' });

  let users = [];
  if (segment === 'inactive') {
    const days = parseInt(segment_value) || 14;
    users = db.prepare(`
      SELECT DISTINCT u.id, u.telegram_id FROM users u
      LEFT JOIN orders o ON o.user_id = u.id AND o.created_at >= datetime('now', '-' || ? || ' days')
      WHERE (u.blacklisted = 0 OR u.blacklisted IS NULL)
      AND u.is_validated = 1
      GROUP BY u.id
      HAVING COUNT(o.id) = 0
    `).all(days);
  } else if (segment === 'product') {
    const productId = parseInt(segment_value);
    if (!productId) return res.status(400).json({ error: 'Produit requis' });
    users = db.prepare(`
      SELECT DISTINCT u.id, u.telegram_id FROM users u
      JOIN orders o ON o.user_id = u.id
      JOIN order_items oi ON oi.order_id = o.id
      WHERE oi.product_id = ? AND (u.blacklisted = 0 OR u.blacklisted IS NULL)
    `).all(productId);
  } else if (segment === 'tag') {
    users = db.prepare(`SELECT id, telegram_id FROM users WHERE tag = ? AND (blacklisted = 0 OR blacklisted IS NULL)`).all(segment_value);
  } else {
    return res.status(400).json({ error: 'Segment inconnu' });
  }

  let sent = 0, failed = 0;
  const insertMsg = db.prepare('INSERT INTO messages (user_id, telegram_id, text, from_admin, is_broadcast, read) VALUES (?, ?, ?, 1, 1, 1)');
  for (const u of users) {
    try { await sendMessageToUser(u.telegram_id, text); insertMsg.run(u.id, u.telegram_id, text); sent++; }
    catch { failed++; }
  }
  res.json({ sent, failed, total: users.length });
});

// Count preview for segment
router.post('/broadcast/segment/count', (req, res) => {
  const { segment, segment_value } = req.body;
  let count = 0;
  if (segment === 'inactive') {
    const days = parseInt(segment_value) || 14;
    count = db.prepare(`
      SELECT COUNT(DISTINCT u.id) as c FROM users u
      LEFT JOIN orders o ON o.user_id = u.id AND o.created_at >= datetime('now', '-' || ? || ' days')
      WHERE (u.blacklisted = 0 OR u.blacklisted IS NULL) AND u.is_validated = 1
      GROUP BY u.id HAVING COUNT(o.id) = 0
    `).all(days).length;
  } else if (segment === 'product') {
    const productId = parseInt(segment_value);
    if (productId) count = db.prepare(`SELECT COUNT(DISTINCT u.id) as c FROM users u JOIN orders o ON o.user_id = u.id JOIN order_items oi ON oi.order_id = o.id WHERE oi.product_id = ? AND (u.blacklisted = 0 OR u.blacklisted IS NULL)`).get(productId)?.c || 0;
  } else if (segment === 'tag') {
    count = db.prepare(`SELECT COUNT(*) as c FROM users WHERE tag = ? AND (blacklisted = 0 OR blacklisted IS NULL)`).get(segment_value)?.c || 0;
  }
  res.json({ count });
});

router.get('/messages/:userId', (req, res) => {
  res.json(db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100').all(req.params.userId));
});

router.get('/messages', (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name,
           m.text as last_message, m.created_at as last_message_time, m.from_admin,
           SUM(CASE WHEN m2.read = 0 AND m2.from_admin = 0 THEN 1 ELSE 0 END) as unread_count
    FROM users u
    JOIN messages m ON m.id = (SELECT id FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN messages m2 ON m2.user_id = u.id
    GROUP BY u.id ORDER BY m.created_at DESC
  `).all());
});

router.post('/messages/read/:userId', (req, res) => {
  db.prepare('UPDATE messages SET read = 1 WHERE user_id = ? AND from_admin = 0').run(req.params.userId);
  res.json({ success: true });
});

router.post('/messages/:userId/send', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message vide' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  try {
    await sendMessageToUser(user.telegram_id, text.trim());
    const result = db.prepare('INSERT INTO messages (user_id, telegram_id, text, from_admin) VALUES (?, ?, ?, 1)')
      .run(user.id, user.telegram_id, text.trim());
    res.json({ id: result.lastInsertRowid, user_id: user.id, telegram_id: user.telegram_id, text: text.trim(), from_admin: 1, created_at: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: 'Erreur envoi message' });
  }
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────

router.put('/settings', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(req.body).forEach(([k, v]) => upsert.run(k, String(v)));
  res.json({ success: true });
});

router.post('/reset-data', (req, res) => {
  try {
    db.prepare('DELETE FROM carts').run();
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM order_items').run();
    db.prepare('DELETE FROM orders').run();
    db.prepare('DELETE FROM users').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('orders','order_items','messages','users','carts')").run();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Erreur réinitialisation' });
  }
});

// ── STATS ─────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const totalOrders   = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const totalRevenue  = db.prepare("SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE status != 'cancelled'").get().s;
  const totalUsers    = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const unreadMessages = db.prepare('SELECT COUNT(*) as c FROM messages WHERE read = 0 AND from_admin = 0').get().c;
  const recentOrders  = db.prepare("SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE created_at >= date('now', '-7 days') GROUP BY DATE(created_at) ORDER BY date").all();
  const topProducts   = db.prepare("SELECT p.name, SUM(oi.quantity) as sold, SUM(oi.subtotal) as revenue FROM order_items oi JOIN products p ON oi.product_id = p.id JOIN orders o ON oi.order_id = o.id WHERE o.status != 'cancelled' GROUP BY p.id ORDER BY sold DESC LIMIT 5").all();
  const revenueByCategory = db.prepare("SELECT c.name, c.emoji, COALESCE(SUM(oi.subtotal), 0) as revenue, COALESCE(SUM(oi.quantity), 0) as sold FROM categories c LEFT JOIN products p ON p.category_id = c.id LEFT JOIN order_items oi ON oi.product_id = p.id LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled' WHERE c.active = 1 GROUP BY c.id ORDER BY revenue DESC").all();
  const topClients    = db.prepare("SELECT u.id, u.username, u.first_name, u.last_name, u.telegram_id, COUNT(o.id) as order_count, COALESCE(SUM(o.total), 0) as total_spent FROM users u JOIN orders o ON o.user_id = u.id AND o.status != 'cancelled' GROUP BY u.id ORDER BY total_spent DESC LIMIT 5").all();
  res.json({ totalOrders, pendingOrders, totalRevenue, totalUsers, unreadMessages, recentOrders, topProducts, revenueByCategory, topClients });
});

// ── PROMO CODES (admin write) ─────────────────────────────────────────────────

router.get('/promos', (req, res) => {
  res.json(db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all());
});

router.post('/promos', (req, res) => {
  const { code, discount_type, discount_value, min_order, max_uses, expires_at, user_id } = req.body;
  if (!code || !discount_value) return res.status(400).json({ error: 'Code et valeur requis' });
  try {
    const info = db.prepare('INSERT INTO promos (code, discount_type, discount_value, min_order, max_uses, expires_at, user_id) VALUES (?,?,?,?,?,?,?)')
      .run(code.toUpperCase().trim(), discount_type || 'percent', parseFloat(discount_value), parseFloat(min_order || 0), parseInt(max_uses || 0), expires_at || null, user_id ? parseInt(user_id) : null);
    res.json({ id: info.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Code déjà existant' });
  }
});

router.patch('/promos/:id', (req, res) => {
  const { active, expires_at, user_id } = req.body;
  if (typeof active !== 'undefined') {
    db.prepare('UPDATE promos SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  }
  if (typeof expires_at !== 'undefined') {
    db.prepare('UPDATE promos SET expires_at = ? WHERE id = ?').run(expires_at || null, req.params.id);
  }
  if (typeof user_id !== 'undefined') {
    db.prepare('UPDATE promos SET user_id = ? WHERE id = ?').run(user_id ? parseInt(user_id) : null, req.params.id);
  }
  res.json({ ok: true });
});

router.delete('/promos/:id', (req, res) => {
  db.prepare('DELETE FROM promos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────

router.post('/auth/logout', (req, res) => {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  import('../auth.js').then(({ invalidateToken }) => { invalidateToken(token); });
  auditLog('logout', { ip }, ip);
  res.json({ success: true });
});

// ── TOTP SETUP ────────────────────────────────────────────────────────────────

router.get('/auth/totp/status', authMiddleware, (req, res) => {
  const enabled = db.prepare("SELECT value FROM settings WHERE key='totp_enabled'").get()?.value === '1';
  const secret  = db.prepare("SELECT value FROM settings WHERE key='totp_secret'").get()?.value || '';
  res.json({ enabled, has_secret: !!secret });
});

router.get('/auth/totp/setup', authMiddleware, (req, res) => {
  const secret = generateTotpSecret();
  const uri = totpUri(secret, 'Baltimore83 Dashboard', 'Baltimore83');
  const qr = `https://chart.googleapis.com/chart?chs=200x200&chld=M|0&cht=qr&chl=${encodeURIComponent(uri)}`;
  res.json({ secret, uri, qr });
});

router.post('/auth/totp/verify-setup', authMiddleware, (req, res) => {
  const { secret, code } = req.body;
  if (!secret || !code) return res.status(400).json({ error: 'Secret et code requis' });
  if (!verifyTotp(secret, code)) return res.status(400).json({ error: 'Code incorrect' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_secret', ?)").run(secret);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_enabled', '1')").run();
  auditLog('totp_enabled', { ip }, ip);
  res.json({ success: true });
});

router.post('/auth/totp/disable', authMiddleware, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code TOTP requis' });
  const secret = db.prepare("SELECT value FROM settings WHERE key='totp_secret'").get()?.value || '';
  if (!secret || !verifyTotp(secret, code)) return res.status(400).json({ error: 'Code incorrect' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_enabled', '0')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_secret', '')").run();
  auditLog('totp_disabled', { ip }, ip);
  res.json({ success: true });
});

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────

router.get('/audit-log', (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?').all(parseInt(limit), parseInt(offset));
  const total = db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
  res.json({ rows, total });
});

// ── ANALYTICS ─────────────────────────────────────────────────────────────────

router.get('/analytics', (req, res) => {
  const { period = '30d' } = req.query;
  let dateCond = '';
  if (period === '7d')   dateCond = `AND o.created_at >= datetime('now', '-7 days')`;
  else if (period === '30d') dateCond = `AND o.created_at >= datetime('now', '-30 days')`;
  else if (period === '90d') dateCond = `AND o.created_at >= datetime('now', '-90 days')`;

  const topClients = db.prepare(`
    SELECT u.id, u.username, u.first_name, u.last_name, u.telegram_id, u.tag,
           COUNT(o.id) as order_count,
           COALESCE(SUM(o.total), 0) as total_spent,
           MAX(o.created_at) as last_order
    FROM users u
    JOIN orders o ON o.user_id = u.id AND o.status != 'cancelled' ${dateCond}
    GROUP BY u.id
    HAVING total_spent > 0
    ORDER BY total_spent DESC LIMIT 10
  `).all();

  const topProducts = db.prepare(`
    SELECT p.id, p.name, p.unit,
           SUM(oi.quantity) as total_qty,
           SUM(oi.subtotal) as total_revenue,
           COUNT(DISTINCT o.id) as order_count
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status != 'cancelled' ${dateCond}
    GROUP BY p.id ORDER BY total_revenue DESC LIMIT 10
  `).all();

  const peakHours = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour,
           COUNT(*) as order_count,
           COALESCE(SUM(total), 0) as revenue
    FROM orders
    WHERE status != 'cancelled' ${dateCond}
    GROUP BY hour ORDER BY hour
  `).all();

  const basketStats = db.prepare(`
    SELECT
      COALESCE(AVG(total), 0) as avg_basket,
      COALESCE(MIN(total), 0) as min_basket,
      COALESCE(MAX(total), 0) as max_basket,
      COUNT(*) as order_count
    FROM orders WHERE status != 'cancelled' ${dateCond}
  `).get();

  const tagStats = db.prepare(`
    SELECT tag, COUNT(*) as count FROM users
    WHERE tag IS NOT NULL GROUP BY tag
  `).all();

  const blacklistCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE blacklisted = 1`).get().c;

  res.json({ topClients, topProducts, peakHours, basketStats, tagStats, blacklistCount });
});

// ── AUTOMATIONS ───────────────────────────────────────────────────────────────

router.get('/automations', (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'auto_%'`).all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

router.put('/automations', (req, res) => {
  const allowed = [
    'auto_welcome_enabled', 'auto_welcome_text',
    'auto_inactivity_enabled', 'auto_inactivity_days', 'auto_inactivity_text',
    'auto_shop_alert_enabled', 'auto_shop_alert_hours',
  ];
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(req.body).forEach(([k, v]) => {
    if (allowed.includes(k)) upsert.run(k, String(v));
  });
  res.json({ success: true });
});

export default router;
