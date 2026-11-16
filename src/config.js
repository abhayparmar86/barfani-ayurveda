require('dotenv').config();

const flag = (value, fallback) => (value === undefined ? fallback : value === 'true');
const isProd = process.env.NODE_ENV === 'production';
const isVercel = process.env.VERCEL === '1';
const defaultSiteUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production.');
}
if (isVercel && !process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error('BLOB_READ_WRITE_TOKEN must be set on Vercel.');
}

const razorpay = {
  keyId: process.env.RAZORPAY_KEY_ID || '',
  keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  apiBase: process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com',
};
razorpay.enabled = Boolean(razorpay.keyId && razorpay.keySecret);

module.exports = {
  siteName: 'Barfani Ayurveda',
  siteUrl: (process.env.SITE_URL || defaultSiteUrl).replace(/\/$/, ''),
  port: process.env.PORT || 3000,
  isProd,
  isVercel,
  forceHttps: flag(process.env.FORCE_HTTPS, false),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  doctorName: process.env.DOCTOR_NAME || 'Dr. R.V. Parmar',
  coDoctorName: process.env.CO_DOCTOR_NAME || 'Dr. Poorti R. Parmar',
  instagram: process.env.INSTAGRAM || 'barfani_ayurveda',
  doctorEmail: process.env.DOCTOR_EMAIL || 'barfaniayurveda@gmail.com',
  whatsapp: process.env.WHATSAPP_NUMBER || '919537320355',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },
  razorpay,
  gaId: process.env.GA_MEASUREMENT_ID || '',
  reviewsAutoApprove: flag(process.env.REVIEWS_AUTO_APPROVE, true),
  offer: {
    enabled: flag(process.env.OFFER_ENABLED, true),
    bundleSize: 3,
    bundlePrice: 1999,
    regularPrice: 2250,
    until: process.env.OFFER_UNTIL || 'Bhai Dooj',
  },
};
