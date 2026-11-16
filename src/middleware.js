const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const clean = (value, max) => String(value || '').trim().slice(0, max);
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const wantsJson = (req) => req.get('X-Requested-With') === 'fetch';

// Only the path is reused, so a forged Referer cannot redirect off-site.
function back(req, fallback = '/') {
  try {
    const url = new URL(req.get('referer'));
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

function attachLocals(req, res, next) {
  req.user = req.session.userId
    ? db.prepare('SELECT id, name, email, phone FROM users WHERE id = ?').get(req.session.userId)
    : null;
  if (req.session.userId && !req.user) delete req.session.userId;

  const cart = req.session.cart || {};
  res.locals.user = req.user;
  res.locals.cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  res.locals.wishIds = new Set(
    req.user
      ? db.prepare('SELECT product_id FROM wishlist WHERE user_id = ?').all(req.user.id).map((r) => r.product_id)
      : []
  );
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.config = config;
  res.locals.canonical = config.siteUrl + req.path;
  res.locals.currentPath = req.path;
  res.locals.inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  res.locals.wa = (text) => `https://wa.me/${config.whatsapp}?text=${encodeURIComponent(text)}`;
  // Text that still starts with TODO is hidden from visitors.
  res.locals.filled = (value, fallback = '') => (!value || String(value).startsWith('TODO') ? fallback : value);
  res.locals.stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  // "Asha Sharma" -> "Asha S."
  res.locals.shortName = (name) => {
    const parts = String(name || '').trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || 'Customer';
  };
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  flash(req, 'error', 'Please log in to continue.');
  res.redirect('/login');
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

// Admin uses HTTP Basic auth. Browsers send those credentials on cross-site posts too,
// so state-changing requests must also come from this same site.
function requireAdmin(req, res, next) {
  if (!config.admin.password) {
    return res.status(503).send('Admin is disabled. Set ADMIN_PASSWORD in .env and restart to enable it.');
  }
  const [scheme, encoded] = (req.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(user, config.admin.user) && safeEqual(rest.join(':'), config.admin.password)) {
      if (req.method === 'POST') {
        const origin = req.get('origin');
        if (origin && new URL(origin).host !== req.get('host')) return res.status(403).send('Forbidden');
      }
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Barfani Admin"');
  res.status(401).send('Authentication required.');
}

module.exports = { attachLocals, requireLogin, requireAdmin, flash, back, clean, wantsJson };
