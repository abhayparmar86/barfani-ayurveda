const db = require('./db');

// Average, count and 5-to-1 star bars for one product (or all products when productId is null).
async function ratingSummary(productId = null) {
  const rows = await db.all(
    `SELECT rating, COUNT(*) AS count FROM reviews
     WHERE approved = 1 AND (? IS NULL OR product_id = ?) GROUP BY rating`,
    [productId, productId]
  );
  const counts = Object.fromEntries(rows.map((r) => [r.rating, r.count]));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const sum = rows.reduce((s, r) => s + r.rating * r.count, 0);
  return {
    count: total,
    avg: total ? Math.round((sum / total) * 10) / 10 : 0,
    bars: [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: counts[star] || 0,
      pct: total ? Math.round(((counts[star] || 0) / total) * 100) : 0,
    })),
  };
}

module.exports = { ratingSummary };
