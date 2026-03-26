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

// Seed default data if empty
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
if (catCount.c === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, emoji, sort_order) VALUES (?, ?, ?)');
  insertCat.run('Fleurs CBD', '🌸', 1);
  insertCat.run('Huiles CBD', '💧', 2);
  insertCat.run('Résines CBD', '🟤', 3);
  insertCat.run('Infusions', '🍵', 4);
  insertCat.run('Cosmétiques', '✨', 5);

  const insertProd = db.prepare(`
    INSERT INTO products (category_id, name, description, price, stock, unit, thc_percent, cbd_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Fleurs
  insertProd.run(1, 'OG Kush CBD', 'Fleur premium avec arômes terreux et boisés', 9.90, 50, 'g', 0.2, 18.5);
  insertProd.run(1, 'Amnesia CBD', 'Fleur énergisante aux notes citronnées', 8.90, 35, 'g', 0.2, 15.0);
  insertProd.run(1, 'Purple Haze CBD', 'Fleur relaxante aux arômes fruités violets', 10.90, 20, 'g', 0.2, 20.0);
  insertProd.run(1, 'White Widow CBD', 'Fleur équilibrée aux cristaux blancs', 11.90, 15, 'g', 0.2, 22.0);

  // Huiles
  insertProd.run(2, 'Huile CBD 5%', 'Huile de chanvre bio 10ml - idéale débutants', 19.90, 30, 'flacon', 0, 5.0);
  insertProd.run(2, 'Huile CBD 10%', 'Huile de chanvre bio 10ml - usage quotidien', 34.90, 25, 'flacon', 0, 10.0);
  insertProd.run(2, 'Huile CBD 20%', 'Huile de chanvre bio 10ml - concentration forte', 59.90, 10, 'flacon', 0, 20.0);

  // Résines
  insertProd.run(3, 'Résine Maroc CBD', 'Résine traditionnelle 1g - arômes épicés', 7.90, 40, 'g', 0.2, 25.0);
  insertProd.run(3, 'Résine Liban CBD', 'Résine premium 1g - texture souple', 9.90, 20, 'g', 0.2, 30.0);

  // Infusions
  insertProd.run(4, 'Tisane Relaxante CBD', 'Mélange camomille & chanvre 20g', 8.90, 45, 'sachet', 0, 5.0);
  insertProd.run(4, 'Tisane Sommeil CBD', 'Mélange valériane & chanvre 20g', 9.90, 30, 'sachet', 0, 7.0);

  // Cosmétiques
  insertProd.run(5, 'Crème CBD 50mg', 'Crème hydratante visage 30ml', 24.90, 20, 'tube', 0, 0);
  insertProd.run(5, 'Baume CBD 100mg', 'Baume corps apaisant 50ml', 29.90, 15, 'pot', 0, 0);
}

export default db;
