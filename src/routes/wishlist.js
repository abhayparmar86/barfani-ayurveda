const router = require('express').Router();
const db = require('../db');
const { requireLogin, back } = require('../middleware');

router.get('/wishlist', requireLogin, (req, res) => {
  const products = db
    .prepare('SELECT p.* FROM product_cards p JOIN wishlist w ON w.product_id = p.id WHERE w.user_id = ? ORDER BY p.id')
    .all(req.user.id);
  res.render('wishlist', { title: 'My Wishlist', products });
});

router.post('/wishlist/toggle/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) return res.redirect('/shop');

  const exists = db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND product_id = ?').get(req.user.id, id);
  if (exists) db.prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').run(req.user.id, id);
  else db.prepare('INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)').run(req.user.id, id);

  res.redirect(back(req, '/shop'));
});

module.exports = router;
