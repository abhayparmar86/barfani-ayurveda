const router = require('express').Router();
const db = require('../db');
const { siteUrl } = require('../config');
const { asyncHandler } = require('../middleware');

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /cart',
      'Disallow: /checkout',
      'Disallow: /pay',
      'Disallow: /account',
      `Sitemap: ${siteUrl}/sitemap.xml`,
    ].join('\n')
  );
});

router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const pages = ['/', '/shop', '/about', '/faq', '/reviews', '/contact', '/policy/shipping', '/policy/returns', '/policy/privacy', '/policy/terms'];
  const products = (await db.all('SELECT slug FROM products WHERE in_stock = 1')).map((p) => `/product/${p.slug}`);
  const urls = [...pages, ...products].map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
}));

router.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

module.exports = router;
