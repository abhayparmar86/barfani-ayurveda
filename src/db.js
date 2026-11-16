const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');
const { products } = require('./data/products');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'barfani.db');
const hasTursoUrl = Boolean(process.env.TURSO_DATABASE_URL);
const hasTursoToken = Boolean(process.env.TURSO_AUTH_TOKEN);
const useTurso = hasTursoUrl || hasTursoToken;
const orderColumns = [
  ['payment_method', "TEXT DEFAULT 'whatsapp'"],
  ['payment_status', "TEXT DEFAULT 'Unpaid'"],
  ['razorpay_order_id', 'TEXT'],
  ['razorpay_payment_id', 'TEXT'],
  ['tracking_note', 'TEXT'],
  ['free_gift', 'INTEGER DEFAULT 0'],
];

let localDb;
let turso;
let ready;

const createTables = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
    benefit TEXT, price INTEGER NOT NULL, size TEXT, ingredients TEXT, usage TEXT, image TEXT,
    offer_eligible INTEGER DEFAULT 0, in_stock INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS wishlist (
    user_id INTEGER NOT NULL REFERENCES users(id), product_id INTEGER NOT NULL REFERENCES products(id),
    PRIMARY KEY (user_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    product_id INTEGER REFERENCES products(id), rating INTEGER NOT NULL, comment TEXT NOT NULL,
    image TEXT, approved INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT, phone TEXT, email TEXT,
    address TEXT, city TEXT, state TEXT, pincode TEXT, country TEXT, notes TEXT, items_json TEXT,
    subtotal INTEGER, discount INTEGER, total INTEGER, status TEXT DEFAULT 'New',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, payment_method TEXT DEFAULT 'whatsapp',
    payment_status TEXT DEFAULT 'Unpaid', razorpay_order_id TEXT, razorpay_payment_id TEXT,
    tracking_note TEXT, free_gift INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS consultations (
    id INTEGER PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS _migration_runs (
    source_fingerprint TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
];

async function rawAll(sql, args = []) {
  if (localDb) return localDb.prepare(sql).all(...args);
  return (await turso.execute({ sql, args })).rows;
}

async function rawRun(sql, args = []) {
  if (localDb) {
    const result = localDb.prepare(sql).run(...args);
    return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
  }
  const result = await turso.execute({ sql, args });
  return {
    changes: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid),
  };
}

async function rawBatch(statements) {
  const items = statements.map((statement) =>
    typeof statement === 'string' ? { sql: statement, args: [] } : statement
  );
  if (localDb) {
    const execute = localDb.transaction((batchItems) => {
      batchItems.forEach(({ sql, args = [] }) => localDb.prepare(sql).run(...args));
    });
    return execute(items);
  }
  return turso.batch(items.map(({ sql, args = [] }) => ({ sql, args })), 'write');
}

async function initializeConnection() {
  if (useTurso && (!hasTursoUrl || !hasTursoToken)) {
    throw new Error('Both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured together.');
  }
  if (process.env.VERCEL && !useTurso) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required on Vercel.');
  }

  if (useTurso) {
    turso = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    await turso.execute('PRAGMA foreign_keys = ON');
  } else {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    localDb = new Database(dbPath);
    localDb.pragma('journal_mode = WAL');
    localDb.pragma('foreign_keys = ON');
  }

  const productUpsert = `INSERT INTO products
    (slug, name, category, benefit, price, size, ingredients, usage, image, offer_eligible, in_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, category=excluded.category, benefit=excluded.benefit, price=excluded.price,
      size=excluded.size, ingredients=excluded.ingredients, usage=excluded.usage, image=excluded.image,
      offer_eligible=excluded.offer_eligible, in_stock=excluded.in_stock`;
  const initialStatements = [...createTables];
  for (const product of products) {
    const p = { offer_eligible: 0, in_stock: 1, ...product };
    initialStatements.push({
      sql: productUpsert,
      args: [
        p.slug, p.name, p.category, p.benefit, p.price, p.size, p.ingredients, p.usage, p.image,
        p.offer_eligible, p.in_stock,
      ],
    });
  }
  initialStatements.push({
    sql: `CREATE VIEW IF NOT EXISTS product_cards AS
      SELECT p.*,
        (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.approved = 1) AS avg_rating,
        (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.approved = 1) AS review_count
      FROM products p`,
  });
  await rawBatch(initialStatements);

  const columns = new Set((await rawAll('PRAGMA table_info(orders)')).map((column) => column.name));
  const migrations = orderColumns
    .filter(([name]) => !columns.has(name))
    .map(([name, definition]) => ({ sql: `ALTER TABLE orders ADD COLUMN ${name} ${definition}` }));
  if (migrations.length) await rawBatch(migrations);
}

function initialize() {
  if (!ready) {
    ready = initializeConnection().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function all(sql, args = []) {
  await initialize();
  return rawAll(sql, args);
}

async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0];
}

async function run(sql, args = []) {
  await initialize();
  return rawRun(sql, args);
}

async function batch(statements) {
  await initialize();
  return rawBatch(statements);
}

module.exports = { all, batch, get, initialize, run, dbPath };
