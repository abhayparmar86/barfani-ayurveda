require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { put } = require('@vercel/blob');
const target = require('../src/db');
const { detectImageMime, imageExtensions } = require('../src/imageFiles');

const tables = ['products', 'users', 'orders', 'reviews', 'wishlist', 'consultations'];
const sourcePath = target.dbPath;
const uploadDir = path.join(__dirname, '..', 'uploads');

function readSource() {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const data = {};
    for (const table of tables) data[table] = source.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    return data;
  } finally {
    source.close();
  }
}

function fingerprint(data) {
  const hash = crypto.createHash('sha256');
  for (const file of [sourcePath, `${sourcePath}-wal`]) {
    try {
      const { size, mtimeMs } = fs.statSync(file);
      hash.update(`${path.resolve(file)}:${size}:${mtimeMs}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const table of tables) {
    const rows = data[table];
    hash.update(`${table}:${rows.length}:${rows.length ? rows[rows.length - 1].id || 0 : 0}`);
  }
  return hash.digest('hex');
}

async function uploadReviewImages(reviews) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  for (const review of reviews) {
    if (!review.image || !review.image.startsWith('/uploads/')) continue;
    if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required to migrate review images.');

    const filename = path.basename(review.image.slice('/uploads/'.length));
    const filePath = path.join(uploadDir, filename);
    const body = await fs.promises.readFile(filePath);
    const extension = path.extname(filename).toLowerCase();
    const contentType = Object.keys(imageExtensions).find((mime) => imageExtensions[mime] === extension);
    if (!contentType) throw new Error(`Unsupported review image type for ${filename}.`);
    if (detectImageMime(body) !== contentType) throw new Error(`Invalid image contents for ${filename}.`);
    const blob = await put(`reviews/${filename}`, body, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token,
    });
    review.image = blob.url;
  }
}

async function destinationColumns(table) {
  return new Set((await target.all(`PRAGMA table_info(${table})`)).map((column) => column.name));
}

function insertStatement(table, row, allowedColumns) {
  const columns = Object.keys(row).filter((column) => allowedColumns.has(column));
  if (!columns.length) return null;
  const names = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const args = columns.map((column) => row[column]);

  if (table === 'wishlist') {
    return { sql: `INSERT OR IGNORE INTO wishlist (${names}) VALUES (${placeholders})`, args };
  }
  const updates = columns.filter((column) => column !== 'id');
  const conflict = updates.length
    ? `ON CONFLICT(id) DO UPDATE SET ${updates.map((column) => `"${column}" = excluded."${column}"`).join(', ')}`
    : 'ON CONFLICT(id) DO NOTHING';
  return { sql: `INSERT INTO "${table}" (${names}) VALUES (${placeholders}) ${conflict}`, args };
}

async function importTable(table, rows) {
  const allowed = await destinationColumns(table);
  const statements = rows.map((row) => insertStatement(table, row, allowed)).filter(Boolean);
  for (let offset = 0; offset < statements.length; offset += 50) {
    await target.batch(statements.slice(offset, offset + 50));
  }
}

async function main() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before running this migration.');
  }
  const data = readSource();
  if (!data.products.length) throw new Error(`No products found in ${sourcePath}.`);
  const sourceFingerprint = fingerprint(data);

  await target.initialize();
  const current = await target.get(
    'SELECT status FROM _migration_runs WHERE source_fingerprint = ?',
    [sourceFingerprint]
  );
  if (current && current.status === 'complete') {
    console.log('This SQLite source was already migrated.');
    return;
  }
  if (!current) {
    const pending = await target.get("SELECT source_fingerprint FROM _migration_runs WHERE status != 'complete' LIMIT 1");
    if (pending) throw new Error('A different SQLite migration is unfinished. Resume it using the same source database.');
    const tablesWithData = ['users', 'orders', 'reviews', 'wishlist', 'consultations'];
    for (const table of tablesWithData) {
      const { count } = await target.get(`SELECT COUNT(*) AS count FROM "${table}"`);
      if (count) throw new Error(`Turso table "${table}" is not empty; refusing to merge local data into it.`);
    }
    await target.run(
      "INSERT INTO _migration_runs (source_fingerprint, status) VALUES (?, 'started')",
      [sourceFingerprint]
    );
  }

  await uploadReviewImages(data.reviews);
  const productColumns = await destinationColumns('products');
  const productStatements = data.products
    .map((row) => insertStatement('products', row, productColumns))
    .filter(Boolean);
  if (!current || current.status === 'started') {
    await target.batch([
      { sql: 'DELETE FROM products' },
      ...productStatements,
      {
        sql: "UPDATE _migration_runs SET status = 'products_done', updated_at = CURRENT_TIMESTAMP WHERE source_fingerprint = ?",
        args: [sourceFingerprint],
      },
    ]);
  } else {
    for (let offset = 0; offset < productStatements.length; offset += 50) {
      await target.batch(productStatements.slice(offset, offset + 50));
    }
  }

  for (const table of tables.slice(1)) {
    await importTable(table, data[table]);
    console.log(`Migrated ${data[table].length} rows from ${table}.`);
  }
  await target.run(
    "UPDATE _migration_runs SET status = 'complete', updated_at = CURRENT_TIMESTAMP WHERE source_fingerprint = ?",
    [sourceFingerprint]
  );
  console.log('SQLite data migration complete. Keep the local database backup until you verify the deployed site.');
}

main().catch((error) => {
  console.error('SQLite migration failed:', error.message);
  process.exitCode = 1;
});
