import { Router } from 'express';
import db from '../db/database.js';

const router = Router();

// ── PRODUCTS ──────────────────────────────────────────────────────────────────

router.get('/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.emoji as category_emoji
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    ORDER BY c.sort_order, p.name
  `).all();
  res.json(products);
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
  const { category_id, name, description, price, stock, unit, thc_percent, cbd_percent, active } = req.body;
  const result = db.prepare(`
    INSERT INTO products (category_id, name, description, price, stock, unit, thc_percent, cbd_percent, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(category_id, name, description, price, stock || 0, unit || 'g', thc_percent || 0, cbd_percent || 0, active !== false ? 1 : 0);
  res.json({ id: result.lastInsertRowid, ...req.body });
});

router.put('/products/:id', (req, res) => {
  const { name, description, price, stock, unit, thc_percent, cbd_percent, active, category_id } = req.body;
  db.prepare(`
    UPDATE products SET name=?, description=?, price=?, stock=?, unit=?, thc_percent=?, cbd_percent=?, active=?, category_id=?
    WHERE id=?
  `).run(name, description, price, stock, unit, thc_percent, cbd_percent, active ? 1 : 0, category_id, req.params.id);
  res.json({ success: true });
});

router.patch('/products/:id/stock', (req, res) => {
  const { stock } = req.body;
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, req.params.id);
  res.json({ success: true });
});

router.delete('/products/:id', (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
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

router.patch('/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
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

// ── STATS ─────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE status != 'cancelled'").get().s;
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const lowStock = db.prepare('SELECT COUNT(*) as c FROM products WHERE stock <= 5 AND active = 1').get().c;
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

  res.json({
    totalOrders, pendingOrders, totalRevenue, totalUsers,
    lowStock, unreadMessages, recentOrders, topProducts
  });
});

export default router;
