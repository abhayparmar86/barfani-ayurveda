const crypto = require('crypto');
const { razorpay } = require('./config');

// Creates a Razorpay order for an amount in rupees. Uses the REST API directly (no SDK needed).
async function createRazorpayOrder({ amountInr, receipt }) {
  const auth = Buffer.from(`${razorpay.keyId}:${razorpay.keySecret}`).toString('base64');
  const response = await fetch(`${razorpay.apiBase}/v1/orders`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountInr * 100, currency: 'INR', receipt: String(receipt) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.description || `Razorpay returned ${response.status}`);
  return body;
}

function safeCompare(expected, actual) {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(actual || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const hmac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

// Checks the signature Razorpay returns to the browser after a successful payment.
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId) return false;
  return safeCompare(hmac(razorpay.keySecret, `${orderId}|${paymentId}`), signature);
}

// Checks the signature on a webhook call (computed over the raw request body).
function verifyWebhookSignature(rawBody, signature) {
  if (!razorpay.webhookSecret || !rawBody) return false;
  return safeCompare(hmac(razorpay.webhookSecret, rawBody), signature);
}

module.exports = { createRazorpayOrder, verifyPaymentSignature, verifyWebhookSignature };
