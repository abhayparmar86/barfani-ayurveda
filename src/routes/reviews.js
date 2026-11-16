const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { ratingSummary } = require('../reviewStats');
const { requireLogin, flash, clean } = require('../middleware');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// The extension comes from the verified mime type, never from the uploaded file name.
const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXTENSIONS[file.mimetype]),
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXTENSIONS[file.mimetype])),
});

// All reviews, optionally filtered to one product with /reviews?product=ID
router.get('/reviews', (req, res) => {
  const productId = Number(req.query.product) || null;
  const reviews = db
    .prepare(
      `SELECT r.*, u.name AS user_name, p.name AS product_name, p.slug AS product_slug FROM reviews r
       JOIN users u ON u.id = r.user_id LEFT JOIN products p ON p.id = r.product_id
       WHERE r.approved = 1 AND (? IS NULL OR r.product_id = ?) ORDER BY r.id DESC LIMIT 100`
    )
    .all(productId, productId);
  const products = db.prepare('SELECT id, name, review_count FROM product_cards ORDER BY id').all();
  res.render('reviews', {
    title: 'Patient Reviews',
    reviews,
    products,
    selected: productId,
    summary: ratingSummary(productId),
  });
});

router.post(
  '/reviews',
  requireLogin,
  (req, res, next) =>
    upload.single('image')(req, res, (err) => {
      if (err) {
        flash(req, 'error', 'Image upload failed. Use a JPG, PNG or WebP under 3 MB.');
        return res.redirect('/reviews');
      }
      next();
    }),
  (req, res) => {
    const rating = parseInt(req.body.rating, 10);
    const comment = clean(req.body.comment, 1000);
    const product = db.prepare('SELECT id, slug FROM products WHERE id = ?').get(Number(req.body.productId));
    const target = product && req.body.from === 'product' ? `/product/${product.slug}#reviews` : '/reviews';
    const discard = () => { if (req.file) fs.unlink(req.file.path, () => {}); };

    if (!(rating >= 1 && rating <= 5) || comment.length < 5) {
      discard();
      flash(req, 'error', 'Please give a star rating and write at least a few words.');
      return res.redirect(target);
    }
    if (product && db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND product_id = ?').get(req.user.id, product.id)) {
      discard();
      flash(req, 'error', 'You have already reviewed this product. Thank you!');
      return res.redirect(target);
    }

    db.prepare('INSERT INTO reviews (user_id, product_id, rating, comment, image, approved) VALUES (?,?,?,?,?,?)').run(
      req.user.id, product ? product.id : null, rating, comment,
      req.file ? '/uploads/' + req.file.filename : null, config.reviewsAutoApprove ? 1 : 0
    );

    flash(req, 'success', config.reviewsAutoApprove
      ? 'Thank you for your review!'
      : 'Thank you! Your review will appear after approval.');
    res.redirect(target);
  }
);

module.exports = router;
