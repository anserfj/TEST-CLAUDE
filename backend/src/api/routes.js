import { Router } from 'express';
import db from '../db/database.js';
import { notifyGroupOrder, notifyGroup, sendMessageToUser } from '../bot/bot.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// ── AUTH ───────────────────────────────────────────────────────────────────────

router.post('/auth/login', (req, res) => {
  const { email, pass } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@shop.local';
  const adminPass = process.env.ADMIN_PASS || 'changeme';
  if (email === adminEmail && pass === adminPass) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }
});

// ── CONFIG ─────────────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  res.json({ miniapp_url: process.env.MINIAPP_URL || '' });
});

// ── UPLOAD ────────────────────────────────────────────────────────────────────

const UPLOAD_DIR = '/app/data/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = /image\/(jpeg|png|gif|webp)|video\/(mp4|webm|ogg|quicktime|mov|x-msvideo|x-matroska)/;
    cb(null, allowed.test(file.mimetype));
  }
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file or invalid type' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── PRODUCTS ──────────────────────────────────────────────────────────────────

router.get('/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    ORDER BY c.sort_order, p.name
  `).all();
  res.json(products.map(p => ({ ...p, tiers: p.tiers ? JSON.parse(p.tiers) : null })));
});

router.get('/products/:id', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, c.name as category_name FROM products p
    LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?
  `).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

router.post('/products', (req, res) => {
  const { category_id, name, description, price, unit, thc_percent, cbd_percent, active, image_url, video_url, tiers } = req.body;
  const result = db.prepare(`
    INSERT INTO products (category_id, name, description, price, unit, thc_percent, cbd_percent, active, image_url, video_url, tiers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(category_id, name, description, price, unit || 'g', thc_percent || 0, cbd_percent || 0, active !== false ? 1 : 0, image_url || null, video_url || null, tiers?.length ? JSON.stringify(tiers) : null);
  res.json({ id: result.lastInsertRowid, ...req.body });
});

router.put('/products/:id', (req, res) => {
  const { name, description, price, unit, thc_percent, cbd_percent, active, category_id, image_url, video_url, tiers } = req.body;
  db.prepare(`
    UPDATE products SET name=?, description=?, price=?, unit=?, thc_percent=?, cbd_percent=?, active=?, category_id=?, image_url=?, video_url=?, tiers=?
    WHERE id=?
  `).run(name, description, price, unit, thc_percent, cbd_percent, active ? 1 : 0, category_id, image_url || null, video_url || null, tiers?.length ? JSON.stringify(tiers) : null, req.params.id);
  res.json({ success: true });
});

router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM order_items WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM carts WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── CATEGORIES ────────────────────────────────────────────────────────────────

router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  res.json(categories);
});

router.post('/categories', (req, res) => {
  const { name, emoji, sort_order } = req.body;
  const result = db.prepare('INSERT INTO categories (name, emoji, sort_order) VALUES (?, ?, ?)').run(name, emoji || '🌿', sort_order || 0);
  res.json({ id: result.lastInsertRowid, name, emoji, sort_order });
});

router.put('/categories/:id', (req, res) => {
  const { name, emoji, active, sort_order } = req.body;
  db.prepare('UPDATE categories SET name=?, emoji=?, active=?, sort_order=? WHERE id=?')
    .run(name, emoji, active ? 1 : 0, sort_order, req.params.id);
  res.json({ success: true });
});

router.delete('/categories/:id', (req, res) => {
  const id = req.params.id;
  // Supprimer d'abord les produits de cette catégorie (+ leurs order_items et carts)
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
           COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
  `;
  const params = [];
  if (status) {
    query += ' WHERE o.status = ?';
    params.push(status);
  }
  query += ' GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const orders = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM orders' + (status ? ' WHERE status = ?' : '')).get(...(status ? [status] : []));
  res.json({ orders, total: total.c });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare(`
    SELECT o.*, u.username, u.first_name, u.last_name, u.telegram_id, u.phone, u.address
    FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = db.prepare(`
    SELECT oi.*, p.name, p.unit FROM order_items oi JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(req.params.id);

  res.json({ ...order, items });
});

router.patch('/orders/:id/notes', (req, res) => {
  const { notes } = req.body;
  db.prepare("UPDATE orders SET notes = ? WHERE id = ?").run(notes || null, req.params.id);
  res.json({ success: true });
});

router.patch('/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);

  // Notify user via Telegram bot
  const order = db.prepare('SELECT o.*, u.telegram_id FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?').get(req.params.id);
  if (order?.telegram_id) {
    const msgs = {
      confirmed: `✅ <b>Commande #${order.id} confirmée !</b>\n\nVotre commande est prise en charge 🚀`,
      preparing: `👨‍🍳 <b>Commande #${order.id} en préparation</b>\n\nNous préparons votre commande avec soin !`,
      shipped:   `🚚 <b>Commande #${order.id} en route !</b>\n\nVotre livreur arrive bientôt. Soyez disponible 📱`,
      delivered: `🎉 <b>Commande #${order.id} livrée !</b>\n\nMerci pour votre confiance. Bonne dégustation ! 🌿`,
      cancelled: `❌ <b>Commande #${order.id} annulée.</b>\n\nContactez-nous pour plus d'informations.`,
    };
    if (msgs[status]) {
      sendMessageToUser(order.telegram_id, msgs[status]).catch(() => {});
    }
  }

  res.json({ success: true });
});

// ── USERS ─────────────────────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.*, COUNT(o.id) as order_count,
           COALESCE(SUM(o.total), 0) as total_spent
    FROM users u LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.id ORDER BY u.last_seen DESC
  `).all();
  res.json(users);
});

router.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.patch('/users/:id/notes', (req, res) => {
  const { notes } = req.body;
  db.prepare('UPDATE users SET notes = ? WHERE id = ?').run(notes || null, req.params.id);
  res.json({ success: true });
});

router.get('/users/:id/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT o.*,
      (SELECT json_group_array(json_object(
        'name', p.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal, 'unit', p.unit
      )) FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id) as items_json
    FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC
  `).all(req.params.id);
  res.json(orders.map(o => ({ ...o, items: o.items_json ? JSON.parse(o.items_json) : [] })));
});

router.get('/broadcasts', (req, res) => {
  const rows = db.prepare(`
    SELECT text, created_at, COUNT(*) as recipients
    FROM messages WHERE is_broadcast = 1 AND from_admin = 1
    GROUP BY text, strftime('%Y-%m-%d %H:%M', created_at)
    ORDER BY created_at DESC LIMIT 30
  `).all();
  res.json(rows);
});

router.post('/broadcast', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message vide' });
  const { sendMessageToUser } = await import('../bot/bot.js');
  const users = db.prepare('SELECT id, telegram_id FROM users').all();
  let sent = 0, failed = 0;
  const insertMsg = db.prepare('INSERT INTO messages (user_id, telegram_id, text, from_admin, is_broadcast, read) VALUES (?, ?, ?, 1, 1, 1)');
  for (const u of users) {
    try {
      await sendMessageToUser(u.telegram_id, text);
      insertMsg.run(u.id, u.telegram_id, text);
      sent++;
    } catch { failed++; }
  }
  res.json({ sent, failed, total: users.length });
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────

router.get('/messages/:userId', (req, res) => {
  const messages = db.prepare(`
    SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100
  `).all(req.params.userId);
  res.json(messages);
});

router.get('/messages', (req, res) => {
  // Get latest message per user with unread count
  const conversations = db.prepare(`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name,
           m.text as last_message, m.created_at as last_message_time, m.from_admin,
           SUM(CASE WHEN m2.read = 0 AND m2.from_admin = 0 THEN 1 ELSE 0 END) as unread_count
    FROM users u
    JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN messages m2 ON m2.user_id = u.id
    GROUP BY u.id
    ORDER BY m.created_at DESC
  `).all();
  res.json(conversations);
});

router.post('/messages/read/:userId', (req, res) => {
  db.prepare('UPDATE messages SET read = 1 WHERE user_id = ? AND from_admin = 0').run(req.params.userId);
  res.json({ success: true });
});

router.post('/messages/:userId/send', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Missing text' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    await sendMessageToUser(user.telegram_id, text.trim());
    const result = db.prepare('INSERT INTO messages (user_id, telegram_id, text, from_admin) VALUES (?, ?, ?, 1)')
      .run(user.id, user.telegram_id, text.trim());
    res.json({ id: result.lastInsertRowid, user_id: user.id, telegram_id: user.telegram_id, text: text.trim(), from_admin: 1, created_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

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
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STATS ─────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE status != 'cancelled'").get().s;
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const unreadMessages = db.prepare('SELECT COUNT(*) as c FROM messages WHERE read = 0 AND from_admin = 0').get().c;

  const recentOrders = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total) as revenue
    FROM orders WHERE created_at >= date('now', '-7 days')
    GROUP BY DATE(created_at) ORDER BY date
  `).all();

  const topProducts = db.prepare(`
    SELECT p.name, SUM(oi.quantity) as sold, SUM(oi.subtotal) as revenue
    FROM order_items oi JOIN products p ON oi.product_id = p.id
    JOIN orders o ON oi.order_id = o.id WHERE o.status != 'cancelled'
    GROUP BY p.id ORDER BY sold DESC LIMIT 5
  `).all();

  const revenueByCategory = db.prepare(`
    SELECT c.name, c.emoji, COALESCE(SUM(oi.subtotal), 0) as revenue, COALESCE(SUM(oi.quantity), 0) as sold
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id
    LEFT JOIN order_items oi ON oi.product_id = p.id
    LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
    WHERE c.active = 1
    GROUP BY c.id ORDER BY revenue DESC
  `).all();

  const topClients = db.prepare(`
    SELECT u.id, u.username, u.first_name, u.last_name, u.telegram_id,
           COUNT(o.id) as order_count, COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id AND o.status != 'cancelled'
    GROUP BY u.id ORDER BY total_spent DESC LIMIT 5
  `).all();

  res.json({
    totalOrders, pendingOrders, totalRevenue, totalUsers,
    unreadMessages, recentOrders, topProducts, revenueByCategory, topClients
  });
});

// ── MINI APP ENDPOINTS ────────────────────────────────────────────────────────

// ── PROMO CODES ──────────────────────────────────────────────────────────────

router.get('/promo/:code', (req, res) => {
  const promo = db.prepare('SELECT * FROM promos WHERE UPPER(code) = UPPER(?) AND active = 1').get(req.params.code);
  if (!promo) return res.status(404).json({ error: 'Code promo invalide' });
  if (promo.max_uses > 0 && promo.uses_count >= promo.max_uses)
    return res.status(400).json({ error: 'Code promo épuisé' });
  res.json(promo);
});

router.get('/promos', (req, res) => {
  res.json(db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all());
});

router.post('/promos', (req, res) => {
  const { code, discount_type, discount_value, min_order, max_uses } = req.body;
  if (!code || !discount_value) return res.status(400).json({ error: 'Code et valeur requis' });
  try {
    const info = db.prepare(
      'INSERT INTO promos (code, discount_type, discount_value, min_order, max_uses) VALUES (?,?,?,?,?)'
    ).run(code.toUpperCase().trim(), discount_type || 'percent', parseFloat(discount_value), parseFloat(min_order||0), parseInt(max_uses||0));
    res.json({ id: info.lastInsertRowid });
  } catch(e) {
    res.status(400).json({ error: 'Code déjà existant' });
  }
});

router.patch('/promos/:id', (req, res) => {
  db.prepare('UPDATE promos SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/promos/:id', (req, res) => {
  db.prepare('DELETE FROM promos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Post an order from the mini app
router.post('/miniapp/order', (req, res) => {
  const { telegram_id, items, notes, total, delivery_name, delivery_phone, delivery_address, promo_code, discount } = req.body;
  if (!telegram_id || !items?.length) return res.status(400).json({ error: 'Missing fields' });
  if (!delivery_name || !delivery_phone || !delivery_address)
    return res.status(400).json({ error: 'Nom, téléphone et adresse requis' });

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
  if (!user) return res.status(404).json({ error: 'User not found. Start the bot first.' });
  if (!user.is_validated) return res.status(403).json({ error: 'Compte non validé. Entre un code de parrainage dans le bot.' });

  // Vérifier zones non livrées
  const zonesRaw = db.prepare('SELECT value FROM settings WHERE key = ?').get('no_delivery_zones')?.value;
  if (zonesRaw) {
    try {
      const zones = JSON.parse(zonesRaw);
      const addrLower = delivery_address.toLowerCase();
      const blocked = zones.find(z => z.name && addrLower.includes(z.name.toLowerCase()));
      if (blocked) {
        return res.status(400).json({ error: `❌ Nous ne livrons pas dans cette zone (${blocked.name}). Contactez-nous pour plus d'infos.` });
      }
    } catch(e) {}
  }

  // Fetch product details for recap
  const itemsWithDetails = items.map(item => {
    const prod = db.prepare('SELECT p.*, c.name as category_name, c.emoji as category_emoji FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?').get(item.product_id);
    return { ...item, prod };
  });

  // Update user phone/address
  db.prepare('UPDATE users SET phone = ?, address = ? WHERE telegram_id = ?')
    .run(delivery_phone, delivery_address, telegram_id);

  // Validate and apply promo code
  let appliedPromo = null;
  if (promo_code) {
    appliedPromo = db.prepare('SELECT * FROM promos WHERE UPPER(code) = UPPER(?) AND active = 1').get(promo_code);
  }

  const createOrder = db.transaction(() => {
    const order = db.prepare(
      'INSERT INTO orders (user_id, total, status, notes, delivery_address, delivery_name, delivery_phone, promo_code, discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, total, 'pending', notes || null, delivery_address, delivery_name, delivery_phone, promo_code || null, discount || 0);

    const orderId = order.lastInsertRowid;
    for (const item of itemsWithDetails) {
      db.prepare(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)'
      ).run(orderId, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price);
    }
    if (appliedPromo) {
      db.prepare('UPDATE promos SET uses_count = uses_count + 1 WHERE id = ?').run(appliedPromo.id);
    }
    return orderId;
  });

  const orderId = createOrder();

  // Notify admin via WS
  import('../websocket/wsServer.js').then(({ broadcastToAdmins }) => {
    broadcastToAdmins({
      type: 'new_order',
      order: { id: orderId, total, username: user.username, first_name: user.first_name, items }
    });
  });

  const tgName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Inconnu';
  const tgHandle = user.username ? `@${user.username}` : `ID: ${user.telegram_id}`;
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const sep = '───────────────────';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Build items list with real product names
  const itemsLines = itemsWithDetails.map(i => {
    const prodName = i.prod?.name || `Produit #${i.product_id}`;
    const unit = i.prod?.unit || 'u';
    const subtotal = (i.unit_price * i.quantity).toFixed(2);
    return `• <b>${esc(prodName)}</b> × ${i.quantity}${unit} — ${subtotal}€`;
  }).join('\n');

  // Build category summary
  const catMap = {};
  itemsWithDetails.forEach(i => {
    const catName = i.prod?.category_name || 'Autre';
    const catEmoji = i.prod?.category_emoji || '📦';
    const key = catName;
    if (!catMap[key]) catMap[key] = { emoji: catEmoji, name: catName, qty: 0, unit: i.prod?.unit || 'u', total: 0 };
    catMap[key].qty += i.quantity;
    catMap[key].total += i.unit_price * i.quantity;
  });
  const catLines = Object.values(catMap).map(c =>
    `• ${c.emoji} <b>${esc(c.name)}</b> × ${c.qty}${c.unit} — ${c.total.toFixed(2)}€`
  ).join('\n');

  // ── GROUP notification (max details, HTML format) ──
  const groupMsg =
    `🛍️ <b>NOUVELLE COMMANDE #${orderId}</b>\n${sep}\n\n` +
    `👤 <b>CLIENT</b>\n` +
    `📛 Nom: <b>${esc(delivery_name)}</b>\n` +
    `📱 Tél: <code>${esc(delivery_phone)}</code>\n` +
    `💬 Telegram: ${esc(tgHandle)} (${esc(tgName)})\n` +
    `🆔 ID: <code>${user.telegram_id}</code>\n` +
    `🏠 Adresse: ${esc(delivery_address)}\n` +
    (notes ? `📝 Notes: ${esc(notes)}\n` : '') +
    `\n${sep}\n\n` +
    `🛒 <b>ARTICLES</b>\n${itemsLines}\n\n` +
    `${sep}\n\n` +
    `🗂 <b>PAR CATÉGORIE</b>\n${catLines}\n\n` +
    `${sep}\n` +
    `💰 <b>TOTAL: ${parseFloat(total).toFixed(2)}€</b>\n` +
    `📅 ${now}`;

  console.log(`📦 Order #${orderId} | telegram_id=${user.telegram_id} | total=${total}€ | group=${process.env.NOTIFY_GROUP_ID || 'NOT SET'}`);
  notifyGroupOrder(groupMsg, orderId);

  // ── PRIVATE recap to user (HTML format) ──
  const userRecap =
    `✅ <b>Commande #${orderId} confirmée !</b>\n\n` +
    `🛒 <b>Vos articles:</b>\n${itemsLines}\n\n` +
    `💰 <b>Total: ${parseFloat(total).toFixed(2)}€</b>\n\n` +
    `📦 <b>Livraison à:</b>\n` +
    `${esc(delivery_name)}\n` +
    `${esc(delivery_address)}\n\n` +
    `Notre équipe vous contactera au <code>${esc(delivery_phone)}</code> 🚀\n\n` +
    `<i>Merci pour votre commande !</i>`;

  sendMessageToUser(user.telegram_id, userRecap).catch(e => console.error('recap error:', e.message));

  res.json({ success: true, order_id: orderId });
});

// Vérifier l'accès d'un utilisateur (validation + code parrainage)
router.get('/miniapp/access/:telegramId', (req, res) => {
  const user = db.prepare('SELECT is_validated, referral_code FROM users WHERE telegram_id = ?').get(req.params.telegramId);
  if (!user) return res.json({ validated: false, referral_code: null });
  res.json({ validated: !!user.is_validated, referral_code: user.referral_code });
});

// Dashboard: valider/invalider un utilisateur manuellement
router.patch('/users/:id/validate', (req, res) => {
  const { validated } = req.body;
  db.prepare('UPDATE users SET is_validated = ? WHERE id = ?').run(validated ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// Dashboard: stats de parrainage
router.get('/users/:id/referrals', (req, res) => {
  const referrals = db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.username, u.created_at
    FROM users u WHERE u.referred_by = ?
  `).all(req.params.id);
  res.json(referrals);
});

// Get orders for a telegram user (mini app)
router.get('/miniapp/orders/:telegramId', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.params.telegramId);
  if (!user) return res.json([]);

  const orders = db.prepare(`
    SELECT o.* FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 20
  `).all(user.id);

  const withItems = orders.map(order => {
    const items = db.prepare(`
      SELECT oi.*, p.name, p.unit FROM order_items oi JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);
    return { ...order, items };
  });

  res.json(withItems);
});

export default router;
