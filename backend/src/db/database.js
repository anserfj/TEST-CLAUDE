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
  ['delivery_fee', '3.00'],
  ['free_delivery_threshold', '50.00'],
  ['shop_banner', ''],
  ['telegram_url', ''],
  ['instagram_url', ''],
].forEach(([k, v]) => _upsertSetting.run(k, v));


export default db;
