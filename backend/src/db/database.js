import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/shop.db');

import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '🌿',
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    unit TEXT DEFAULT 'g',
    image_url TEXT,
    active INTEGER DEFAULT 1,
    thc_percent REAL DEFAULT 0,
    cbd_percent REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'pending',
    total REAL NOT NULL,
    notes TEXT,
    delivery_address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    telegram_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    from_admin INTEGER DEFAULT 0,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER DEFAULT 1,
    UNIQUE(telegram_id, product_id)
  );
`);

// Migrate: add delivery columns if missing
['delivery_name', 'delivery_phone'].forEach(col => {
  try { db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT`); } catch(e) {}
});
// Migrate: add tiers column to products
try { db.exec(`ALTER TABLE products ADD COLUMN tiers TEXT`); } catch(e) {}
// Migrate: add video_url column to products
try { db.exec(`ALTER TABLE products ADD COLUMN video_url TEXT`); } catch(e) {}
// Migrate: add is_broadcast column to messages
try { db.exec(`ALTER TABLE messages ADD COLUMN is_broadcast INTEGER DEFAULT 0`); } catch(e) {}
// Migrate: add notes column to users
try { db.exec(`ALTER TABLE users ADD COLUMN notes TEXT`); } catch(e) {}
// Migrate: add promo_code + discount columns to orders
try { db.exec(`ALTER TABLE orders ADD COLUMN promo_code TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN discount REAL DEFAULT 0`); } catch(e) {}

// Migrate: système de parrainage
try { db.exec(`ALTER TABLE users ADD COLUMN is_validated INTEGER DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER`); } catch(e) {}
// Les utilisateurs existants sont validés automatiquement (ne pas bloquer les clients actuels)
db.prepare(`UPDATE users SET is_validated = 1 WHERE is_validated = 0 OR is_validated IS NULL`).run();
// Générer un code de parrainage pour les utilisateurs qui n'en ont pas
const usersWithoutCode = db.prepare(`SELECT id, telegram_id FROM users WHERE referral_code IS NULL`).all();
const genCode = (id) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  let seed = id;
  for (let i = 0; i < 6; i++) { seed = (seed * 1664525 + 1013904223) & 0xffffffff; code += chars[Math.abs(seed) % chars.length]; }
  return code;
};
const updateCode = db.prepare(`UPDATE users SET referral_code = ? WHERE id = ?`);
usersWithoutCode.forEach(u => { let code = genCode(u.telegram_id); updateCode.run(code, u.id); });

// Promos table
db.exec(`CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL NOT NULL,
  min_order REAL DEFAULT 0,
  max_uses INTEGER DEFAULT 0,
  uses_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// Settings table
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
// Seed default settings (INSERT OR IGNORE so existing values are preserved)
const _upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
[
  ['shop_name', 'Baltimore 83'],
  ['shop_tagline', 'Votre shop dans le Var 83 🔥'],
  ['delivery_fee', '3.00'],
  ['free_delivery_threshold', '50.00'],
  ['shop_banner', ''],
  ['telegram_url', 'https://t.me/+kzA04I6sErVjYWVk'],
  ['instagram_url', ''],
  ['no_delivery_zones', '[]'],
].forEach(([k, v]) => _upsertSetting.run(k, v));

// Migration: supprimer les catégories et produits de démonstration CBD
try {
  // Par nom exact (données de démo connues)
  const demoCats = ['Fleurs CBD', 'Huiles CBD', 'Résines CBD', 'Infusions CBD', 'Cosmétiques CBD'];
  demoCats.forEach(name => {
    db.prepare(`DELETE FROM products WHERE category_id IN (SELECT id FROM categories WHERE name = ?)`).run(name);
    db.prepare(`DELETE FROM categories WHERE name = ?`).run(name);
  });
  // Fallback large : toute catégorie contenant "CBD"
  db.prepare(`DELETE FROM products WHERE category_id IN (SELECT id FROM categories WHERE name LIKE '%CBD%')`).run();
  db.prepare(`DELETE FROM categories WHERE name LIKE '%CBD%'`).run();
} catch(e) {}


export default db;
