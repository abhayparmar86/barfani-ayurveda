const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const router = require('express').Router();
const multer = require('multer');
const { del, put } = require('@vercel/blob');
const db = require('../db');
const config = require('../config');
const { detectImageMime, imageExtensions } = require('../imageFiles');
const { ratingSummary } = require('../reviewStats');
const { asyncHandler, requireLogin, flash, clean } = require('../middleware');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(imageExtensions[file.mimetype])),
});

async function saveImage(file) {
  const filename = `${crypto.randomBytes(12).toString('hex')}${imageExtensions[file.mimetype]}`;
  if (config.isVercel) {
    const blob = await put(`reviews/${filename}`, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return {
      url: blob.url,
      remove: () => del(blob.url, { token: process.env.BLOB_READ_WRITE_TOKEN }),
    };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const imagePath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(imagePath, file.buffer);
  return {
    url: `/uploads/${filename}`,
    remove: () => fs.unlink(imagePath),
  };
}

// All reviews, optionally filtered to one product with /reviews?product=ID
router.get('/reviews', asyncHandler(async (req, res) => {
  const productId = Number(req.query.product) || null;
  const reviews = await db.all(
    `SELECT r.*, u.name AS user_name, p.name AS product_name, p.slug AS product_slug FROM reviews r
     JOIN users u ON u.id = r.user_id LEFT JOIN products p ON p.id = r.product_id
     WHERE r.approved = 1 AND (? IS NULL OR r.product_id = ?) ORDER BY r.id DESC LIMIT 100`,
    [productId, productId]
  );
  const products = await db.all('SELECT id, name, review_count FROM product_cards ORDER BY id');
  res.render('reviews', {
    title: 'Patient Reviews',
    reviews,
    products,
    selected: productId,
    summary: await ratingSummary(productId),
  });
}));

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
  asyncHandler(async (req, res) => {
    const rating = parseInt(req.body.rating, 10);
    const comment = clean(req.body.comment, 1000);
    const product = await db.get('SELECT id, slug FROM products WHERE id = ?', [Number(req.body.productId)]);
    const target = product && req.body.from === 'product' ? `/product/${product.slug}#reviews` : '/reviews';

    if (req.file && detectImageMime(req.file.buffer) !== req.file.mimetype) {
      flash(req, 'error', 'Image upload failed. Use a valid JPG, PNG or WebP under 3 MB.');
      return res.redirect(target);
    }
    if (!(rating >= 1 && rating <= 5) || comment.length < 5) {
      flash(req, 'error', 'Please give a star rating and write at least a few words.');
      return res.redirect(target);
    }
    if (product && await db.get(
      'SELECT 1 FROM reviews WHERE user_id = ? AND product_id = ?',
      [req.user.id, product.id]
    )) {
      flash(req, 'error', 'You have already reviewed this product. Thank you!');
      return res.redirect(target);
    }

    let image;
    try {
      image = req.file ? await saveImage(req.file) : null;
      await db.run(
        'INSERT INTO reviews (user_id, product_id, rating, comment, image, approved) VALUES (?,?,?,?,?,?)',
        [
          req.user.id, product ? product.id : null, rating, comment,
          image ? image.url : null, config.reviewsAutoApprove ? 1 : 0,
        ]
      );
    } catch (error) {
      if (image) {
        try {
          await image.remove();
        } catch (cleanupError) {
          console.error('Review image cleanup failed:', cleanupError.message);
        }
      }
      throw error;
    }

    flash(req, 'success', config.reviewsAutoApprove
      ? 'Thank you for your review!'
      : 'Thank you! Your review will appear after approval.');
    res.redirect(target);
  })
);

module.exports = router;
