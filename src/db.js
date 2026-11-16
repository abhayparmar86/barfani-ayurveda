const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { products } = require('./data/products');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'barfani.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  phone TEXT, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  benefit TEXT, price INTEGER NOT NULL, size TEXT, ingredients TEXT, usage TEXT, image TEXT,
  offer_eligible INTEGER DEFAULT 0, in_stock INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id), product_id INTEGER NOT NULL REFERENCES products(id),
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER REFERENCES products(id), rating INTEGER NOT NULL, comment TEXT NOT NULL,
  image TEXT, approved INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT, phone TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT, pincode TEXT, country TEXT, notes TEXT, items_json TEXT,
  subtotal INTEGER, discount INTEGER, total INTEGER, status TEXT DEFAULT 'New',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS consultations (
  id INTEGER PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Adds a column to an existing table only when it is missing, so upgrades keep old data.
function addColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!existing.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('orders', 'payment_method', "TEXT DEFAULT 'whatsapp'");
addColumn('orders', 'payment_status', "TEXT DEFAULT 'Unpaid'");
addColumn('orders', 'razorpay_order_id', 'TEXT');
addColumn('orders', 'razorpay_payment_id', 'TEXT');
addColumn('orders', 'tracking_note', 'TEXT');
addColumn('orders', 'free_gift', 'INTEGER DEFAULT 0');

// Products are managed in src/data/products.js and synced on every start.
const upsert = db.prepare(`
INSERT INTO products (slug, name, category, benefit, price, size, ingredients, usage, image, offer_eligible, in_stock)
VALUES (@slug, @name, @category, @benefit, @price, @size, @ingredients, @usage, @image, @offer_eligible, @in_stock)
ON CONFLICT(slug) DO UPDATE SET
  name=excluded.name, category=excluded.category, benefit=excluded.benefit, price=excluded.price,
  size=excluded.size, ingredients=excluded.ingredients, usage=excluded.usage, image=excluded.image,
  offer_eligible=excluded.offer_eligible, in_stock=excluded.in_stock
`);
db.transaction((list) => list.forEach((p) => upsert.run({ offer_eligible: 0, in_stock: 1, ...p })))(products);

// Products plus their approved-review rating, used by every product listing.
db.exec(`
DROP VIEW IF EXISTS product_cards;
CREATE VIEW product_cards AS
SELECT p.*,
  (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.approved = 1) AS avg_rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.approved = 1) AS review_count
FROM products p;
`);

module.exports = db;
