const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const mailer = require('../mailer');
const { ratingSummary } = require('../reviewStats');
const { flash, clean } = require('../middleware');

const CATEGORIES = ['Hair Care', 'Skin Care'];
const SORTS = {
  price_asc: 'price ASC, id',
  price_desc: 'price DESC, id',
  rating: 'avg_rating DESC, review_count DESC, id',
};

const CONSULT_FIELDS = [
  ['name', 'Full name'], ['age', 'Age'], ['gender', 'Gender'], ['phone', 'Phone / WhatsApp'],
  ['email', 'Email'], ['location', 'City / Country'], ['concern', 'Main health concern'],
  ['duration', 'Since when'], ['history', 'Existing conditions / past illness'],
  ['medicines', 'Current medicines'], ['allergies', 'Allergies'], ['diet', 'Diet and lifestyle'],
  ['sleep', 'Sleep, digestion and energy'], ['contactMode', 'Preferred contact mode'],
  ['slot', 'Preferred call time'],
];

// TODO: have these drafts reviewed before launch (Dr. Parmar holds an LLB and can check them).
const POLICIES = {
  shipping: {
    title: 'Shipping Policy',
    body: [
      'Orders are packed by hand in Surendranagar, Gujarat and usually dispatched within 3 to 5 working days.',
      'We ship across India and to selected countries. Shipping charges, if any, are confirmed with you on WhatsApp or phone before dispatch. Orders in the Diwali offer ship free within India.',
    ],
  },
  returns: {
    title: 'Returns and Refunds',
    body: [
      'Because these are personal care products, we cannot accept returns of opened items.',
      'If your parcel arrives damaged or incorrect, contact us within 48 hours with photos and we will make it right.',
      'If a paid order is cancelled before dispatch, the amount is refunded to the original payment method.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      'We collect only the details needed to process your order or consultation request.',
      'Your health information is shared only with the consulting Vaidya and is never sold or shared with third parties.',
      'Online payments are processed by Razorpay. We never see or store your card or UPI details.',
    ],
  },
  terms: {
    title: 'Terms of Service',
    body: [
      'By using this website and placing an order you agree to these terms. All prices are in Indian rupees (INR).',
      'An order is confirmed only after we accept it and, where applicable, receive payment. We may cancel an order if a product is unavailable and will refund any amount paid.',
      'Our products are traditional Ayurvedic products. Individual results vary, and this website does not replace medical advice.',
      'Content on this website, including text, images and product names, belongs to Barfani Ayurveda and may not be copied without permission.',
    ],
  },
};

const FAQS = [
  ['How do I place an order?', 'Add products to your cart, or use Buy now on a product page, then enter your delivery details at checkout. You can pay online or choose to pay later and confirm on WhatsApp.'],
  ['Which payment options are available?', 'Online payment by UPI, cards and netbanking (India), or pay later: we contact you on WhatsApp to confirm the payment details.'],
  ['Do you deliver outside India?', 'Yes. We have sent products to patients in the USA, UK and UAE. Place your order, choose pay later, and we will confirm shipping charges and payment with you on WhatsApp.'],
  ['How does the Diwali offer work?', 'Choose any 3 eligible bottles and the bundle price is applied automatically in your cart, together with a free Diwali gift. The cart shows how many more bottles you need.'],
  ['Can I talk to the Vaidya before buying?', 'Of course. Fill in the consultation form and the Vaidya will contact you by your preferred method.'],
  ['How are your products made?', 'By hand, in small batches at home in Surendranagar or at a trusted Ayurvedic manufacturing partner.'],
  ['What if my parcel arrives damaged?', 'Contact us within 48 hours with photos. Details are on the Returns page.'],
];

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.get('/', (req, res) => {
  const featured = db.prepare('SELECT * FROM product_cards WHERE in_stock = 1 ORDER BY id LIMIT 4').all();
  const reviews = db
    .prepare(
      `SELECT r.*, u.name AS user_name, p.name AS product_name, p.slug AS product_slug FROM reviews r
       JOIN users u ON u.id = r.user_id LEFT JOIN products p ON p.id = r.product_id
       WHERE r.approved = 1 ORDER BY r.id DESC LIMIT 3`
    )
    .all();
  res.render('home', { title: 'Pure Ayurvedic Care', featured, reviews });
});

router.get('/shop', (req, res) => {
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
  const q = clean(req.query.q, 50);
  const sort = SORTS[req.query.sort] ? req.query.sort : '';
  const products = db
    .prepare(
      `SELECT * FROM product_cards
       WHERE in_stock = 1 AND (? = '' OR category = ?) AND (name LIKE ? OR benefit LIKE ?)
       ORDER BY ${SORTS[sort] || 'id'}`
    )
    .all(category, category, `%${q}%`, `%${q}%`);
  res.render('shop', { title: 'Shop', products, category, q, sort, categories: CATEGORIES });
});

router.get('/product/:slug', (req, res, next) => {
  const product = db.prepare('SELECT * FROM product_cards WHERE slug = ? AND in_stock = 1').get(req.params.slug);
  if (!product) return next();

  const reviews = db
    .prepare(
      `SELECT r.*, u.name AS user_name FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.approved = 1 AND r.product_id = ? ORDER BY r.id DESC LIMIT 50`
    )
    .all(product.id);
  const summary = ratingSummary(product.id);
  const related = db.prepare('SELECT * FROM product_cards WHERE in_stock = 1 AND id != ? ORDER BY id LIMIT 4').all(product.id);
  const url = `${config.siteUrl}/product/${product.slug}`;
  const description = res.locals.filled(product.benefit, `${product.name} by Barfani Ayurveda.`);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    image: config.siteUrl + product.image,
    brand: { '@type': 'Brand', name: config.siteName },
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'INR',
      price: product.price,
      availability: 'https://schema.org/InStock',
    },
  };
  if (summary.count) {
    jsonLd.aggregateRating = { '@type': 'AggregateRating', ratingValue: summary.avg, reviewCount: summary.count };
    jsonLd.review = reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: r.rating },
      author: { '@type': 'Person', name: res.locals.shortName(r.user_name) },
      reviewBody: r.comment,
    }));
  }

  res.render('product', {
    title: product.name,
    product,
    reviews,
    summary,
    related,
    jsonLd,
    metaDescription: description,
    ogImage: config.siteUrl + product.image,
    bodyClass: 'has-buybar',
  });
});

router.get('/about', (req, res) => res.render('about', { title: 'About Us' }));
router.get('/faq', (req, res) => res.render('faq', { title: 'Frequently Asked Questions', faqs: FAQS }));

router.get('/policy/:name', (req, res, next) => {
  const policy = POLICIES[req.params.name];
  if (!policy) return next();
  res.render('policy', { title: policy.title, policy });
});

router.get('/contact', (req, res) => res.render('contact', { title: 'Consult the Vaidya', form: {} }));

router.post('/contact', contactLimiter, async (req, res) => {
  const data = {};
  CONSULT_FIELDS.forEach(([key]) => { data[key] = clean(req.body[key], 1500); });

  if (!data.name || !data.phone || !data.concern || !req.body.consent) {
    res.locals.flash = { type: 'error', msg: 'Please fill the required fields and accept the consent box.' };
    return res.status(400).render('contact', { title: 'Consult the Vaidya', form: data });
  }

  db.prepare('INSERT INTO consultations (data_json) VALUES (?)').run(JSON.stringify(data));
  const text = CONSULT_FIELDS.map(([key, label]) => `${label}: ${data[key] || '-'}`).join('\n');
  await mailer.sendToDoctor({
    subject: `New consultation request: ${data.name}`,
    text,
    replyTo: data.email || undefined,
  });

  flash(req, 'success', 'Thank you. The Vaidya will contact you soon via your preferred mode.');
  res.redirect('/contact');
});

module.exports = router;
