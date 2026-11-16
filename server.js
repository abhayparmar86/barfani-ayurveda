const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const config = require('./src/config');
require('./src/db');
const { attachLocals } = require('./src/middleware');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (config.isProd || config.forceHttps) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (config.forceHttps) {
    res.set('Strict-Transport-Security', 'max-age=15552000');
    if (!req.secure) return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});

// rawBody is kept so the payment webhook signature can be checked.
app.use(express.json({ limit: '50kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(
  cookieSession({
    name: 'barfani',
    keys: [config.secret],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax', // blocks cross-site form posts, which covers CSRF for customer actions
    secure: config.isProd,
  })
);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(attachLocals);

app.use(require('./src/routes/seo'));
app.use(require('./src/routes/pages'));
app.use(require('./src/routes/auth'));
app.use(require('./src/routes/cart'));
app.use(require('./src/routes/wishlist'));
app.use(require('./src/routes/reviews'));
app.use(require('./src/routes/admin'));

app.use((req, res) => res.status(404).render('404', { title: 'Page not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('500', { title: 'Something went wrong' }, (renderError, html) => {
    res.send(renderError ? 'Something went wrong. Please try again.' : html);
  });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`${config.siteName} running at http://localhost:${config.port}`);
    if (!config.razorpay.enabled) console.log('Online payments: off (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable)');
    if (!config.admin.password) console.log('Admin page: off (set ADMIN_PASSWORD to enable /admin)');
  });
}

module.exports = app;
