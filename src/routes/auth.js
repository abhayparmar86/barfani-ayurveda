const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { asyncHandler, requireLogin, flash, clean } = require('../middleware');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

router.get('/signup', (req, res) => res.render('signup', { title: 'Sign up', form: {} }));

router.post('/signup', limiter, asyncHandler(async (req, res) => {
  const form = {
    name: clean(req.body.name, 80),
    email: clean(req.body.email, 120).toLowerCase(),
    phone: clean(req.body.phone, 20),
  };
  const password = String(req.body.password || '');
  const existingUser = await db.get('SELECT 1 FROM users WHERE email = ?', [form.email]);

  const error = !form.name ? 'Please enter your name.'
    : !/^\S+@\S+\.\S+$/.test(form.email) ? 'Please enter a valid email address.'
    : password.length < 8 ? 'Password must be at least 8 characters.'
    : existingUser ? 'An account with this email already exists.'
    : null;

  if (error) {
    res.locals.flash = { type: 'error', msg: error };
    return res.status(400).render('signup', { title: 'Sign up', form });
  }

  const info = await db.run(
    'INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
    [form.name, form.email, form.phone, bcrypt.hashSync(password, 10)]
  );
  req.session.userId = info.lastInsertRowid;
  flash(req, 'success', 'Welcome to Barfani Ayurveda!');
  res.redirect('/shop');
}));

router.get('/login', (req, res) => res.render('login', { title: 'Log in', form: {} }));

router.post('/login', limiter, asyncHandler(async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    res.locals.flash = { type: 'error', msg: 'Invalid email or password.' };
    return res.status(401).render('login', { title: 'Log in', form: { email } });
  }

  req.session.userId = user.id;
  const destination = req.session.returnTo || '/';
  delete req.session.returnTo;
  res.redirect(destination);
}));

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

router.get('/account', requireLogin, asyncHandler(async (req, res) => {
  const orders = (await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]))
    .map((o) => ({ ...o, items: JSON.parse(o.items_json) }));
  res.render('account', { title: 'My Account', orders });
}));

module.exports = router;
