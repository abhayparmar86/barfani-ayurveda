const router = require('express').Router();
const db = require('../db');
const { asyncHandler, requireLogin, back } = require('../middleware');

router.get('/wishlist', requireLogin, asyncHandler(async (req, res) => {
  const products = await db.all(
    'SELECT p.* FROM product_cards p JOIN wishlist w ON w.product_id = p.id WHERE w.user_id = ? ORDER BY p.id',
    [req.user.id]
  );
  res.render('wishlist', { title: 'My Wishlist', products });
}));

router.post('/wishlist/toggle/:id', requireLogin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!await db.get('SELECT 1 FROM products WHERE id = ?', [id])) return res.redirect('/shop');

  const exists = await db.get('SELECT 1 FROM wishlist WHERE user_id = ? AND product_id = ?', [req.user.id, id]);
  if (exists) await db.run('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', [req.user.id, id]);
  else await db.run('INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)', [req.user.id, id]);

  res.redirect(back(req, '/shop'));
}));

module.exports = router;
