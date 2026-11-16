const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const mailer = require('../mailer');
const payments = require('../payments');
const { priceCart } = require('../pricing');
const { describeOrder, customerConfirmation } = require('../orders');
const { asyncHandler, flash, back, clean, wantsJson } = require('../middleware');

const MAX_QTY = 10;
const checkoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

// ---------- helpers ----------

async function loadLines(quantities) {
  const ids = Object.keys(quantities).map(Number).filter(Boolean);
  if (!ids.length) return [];
  const rows = await db.all(
    `SELECT * FROM products WHERE in_stock = 1 AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ids
  );
  return rows.map((product) => ({ product, qty: quantities[product.id] }));
}

// mode "buynow" buys one product only (Amazon style), mode "cart" buys the whole cart.
async function getLines(req, mode = 'cart') {
  if (mode === 'buynow') {
    const item = req.session.buyNow;
    return item ? loadLines({ [item.id]: item.qty }) : [];
  }
  return loadLines(req.session.cart || {});
}

const modeOf = (req) => ((req.query.mode || (req.body && req.body.mode)) === 'buynow' ? 'buynow' : 'cart');
const cartCount = (req) => Object.values(req.session.cart || {}).reduce((sum, qty) => sum + qty, 0);

function setQty(req, id, qty) {
  const cart = { ...(req.session.cart || {}) };
  if (qty <= 0) delete cart[id];
  else cart[id] = Math.min(qty, MAX_QTY);
  req.session.cart = cart;
}

async function cartState(req) {
  const lines = await getLines(req);
  return { lines, pricing: priceCart(lines) };
}

const getOrder = (id) => db.get('SELECT * FROM orders WHERE id = ?', [id]);

async function notifyNewOrder(order) {
  const ownerSent = await mailer.sendToDoctor({
    subject: `New order #${order.id}: ${order.name} (${order.payment_status})`,
    text: describeOrder(order),
    replyTo: order.email || undefined,
  });
  const customerSent = order.email
    ? await mailer.sendToCustomer({ to: order.email, ...customerConfirmation(order) })
    : false;
  return ownerSent && customerSent;
}

// ---------- cart ----------

router.get('/cart', asyncHandler(async (req, res) => {
  res.render('cart', { title: 'Your Cart', ...await cartState(req) });
}));

// HTML fragment for the slide-out mini cart.
router.get('/cart/drawer', asyncHandler(async (req, res) => {
  res.render('partials/mini-cart', await cartState(req));
}));

router.post('/cart/add/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!await db.get('SELECT 1 FROM products WHERE id = ? AND in_stock = 1', [id])) {
    return wantsJson(req) ? res.status(404).json({ ok: false, error: 'Product not found' }) : res.redirect('/shop');
  }
  const qty = Math.min(Math.max(1, parseInt(req.body.qty, 10) || 1), MAX_QTY);

  if (req.body.buyNow) {
    req.session.buyNow = { id, qty };
    return res.redirect('/checkout?mode=buynow');
  }

  setQty(req, id, ((req.session.cart || {})[id] || 0) + qty);
  if (wantsJson(req)) return res.json({ ok: true, count: cartCount(req) });
  flash(req, 'success', 'Added to your cart.');
  res.redirect(back(req, '/shop'));
}));

async function changeCart(req, res, id, qty) {
  setQty(req, id, qty);
  if (wantsJson(req)) return res.json({ ok: true, count: cartCount(req) });
  res.redirect('/cart');
}

router.post('/cart/update/:id', asyncHandler(async (req, res) => changeCart(req, res, Number(req.params.id), parseInt(req.body.qty, 10) || 0)));
router.post('/cart/remove/:id', asyncHandler(async (req, res) => changeCart(req, res, Number(req.params.id), 0)));

// ---------- checkout ----------

router.get('/checkout', asyncHandler(async (req, res) => {
  const mode = modeOf(req);
  const lines = await getLines(req, mode);
  if (!lines.length) return res.redirect(mode === 'buynow' ? '/shop' : '/cart');
  const form = {
    name: req.user?.name || '',
    phone: req.user?.phone || '',
    email: req.user?.email || '',
    payment: config.razorpay.enabled ? 'online' : 'whatsapp',
  };
  res.render('checkout', { title: 'Checkout', lines, pricing: priceCart(lines), form, mode });
}));

router.post('/checkout', checkoutLimiter, asyncHandler(async (req, res) => {
  const mode = modeOf(req);
  const lines = await getLines(req, mode);
  if (!lines.length) return res.redirect('/shop');

  const f = {};
  ['name', 'phone', 'email', 'address', 'city', 'state', 'pincode', 'country', 'notes'].forEach((key) => {
    f[key] = clean(req.body[key], key === 'address' || key === 'notes' ? 500 : 100);
  });
  f.payment = req.body.payment === 'online' ? 'online' : 'whatsapp';
  const pricing = priceCart(lines);

  const fail = (msg) => {
    res.locals.flash = { type: 'error', msg };
    return res.status(400).render('checkout', { title: 'Checkout', lines, pricing, form: f, mode });
  };

  if (!f.name || !f.phone || !f.email || !f.address || !f.city || !f.pincode || !f.country) {
    return fail('Please fill all required delivery details.');
  }
  if (f.phone.replace(/\D/g, '').length < 8) return fail('Please enter a valid phone number.');
  if (!/^\S+@\S+\.\S+$/.test(f.email)) return fail('Please enter a valid email address.');
  if (f.payment === 'online' && !config.razorpay.enabled) {
    return fail('Online payment is not available right now. Please choose "Pay later on WhatsApp".');
  }
  if (f.payment === 'online' && f.country.toLowerCase() !== 'india') {
    return fail('Online payment is available for India only. For other countries, choose "Pay later on WhatsApp" and we will confirm shipping and payment with you.');
  }

  const items = lines.map((l) => ({
    product_id: l.product.id,
    name: l.product.name,
    size: l.product.size,
    qty: l.qty,
    price: l.product.price,
  }));
  const online = f.payment === 'online';
  const info = await db.run(
    `INSERT INTO orders (user_id, name, phone, email, address, city, state, pincode, country, notes,
        items_json, subtotal, discount, total, payment_method, payment_status, free_gift)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ,
    [req.user?.id ?? null, f.name, f.phone, f.email, f.address, f.city, f.state, f.pincode, f.country, f.notes,
      JSON.stringify(items), pricing.subtotal, pricing.discount, pricing.total,
      online ? 'online' : 'whatsapp', online ? 'Pending' : 'Unpaid', pricing.freeGift ? 1 : 0]
  );
  const orderId = Number(info.lastInsertRowid);

  if (mode === 'buynow') delete req.session.buyNow;
  else req.session.cart = {};
  req.session.lastOrder = orderId;

  if (online) {
    try {
      const rzp = await payments.createRazorpayOrder({ amountInr: pricing.total, receipt: `order_${orderId}` });
      await db.run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [rzp.id, orderId]);
      return res.redirect(`/pay/${orderId}`);
    } catch (err) {
      console.error('Razorpay order failed:', err.message);
      await db.run("UPDATE orders SET payment_method = 'whatsapp', payment_status = 'Unpaid' WHERE id = ?", [orderId]);
      flash(req, 'error', 'Online payment could not be started. Your order is saved and we will confirm payment with you on WhatsApp.');
    }
  }

  const emailsSent = await notifyNewOrder(await getOrder(orderId));
  if (!emailsSent) {
    flash(req, 'error', 'Your order was saved, but an order email could not be sent. Please contact us on WhatsApp.');
  }
  res.redirect('/order-success');
}));

// ---------- online payment (Razorpay) ----------

router.get('/pay/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await getOrder(id);
  const owns = order && (req.session.lastOrder === id || (req.user && order.user_id === req.user.id));
  if (!owns || order.payment_method !== 'online' || order.payment_status === 'Paid' || !order.razorpay_order_id) {
    return res.redirect('/order-success');
  }
  res.render('pay', { title: 'Secure payment', order, keyId: config.razorpay.keyId });
}));

async function markPaid(razorpayOrderId, paymentId) {
  const order = await db.get('SELECT * FROM orders WHERE razorpay_order_id = ?', [razorpayOrderId]);
  if (!order) return null;
  if (order.payment_status === 'Paid') return { order, already: true };
  await db.run("UPDATE orders SET payment_status = 'Paid', razorpay_payment_id = ? WHERE id = ?", [paymentId || null, order.id]);
  return { order: await getOrder(order.id), already: false };
}

// Called by the browser after Razorpay reports success. The signature proves the payment is real.
router.post('/pay/verify', asyncHandler(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!payments.verifyPaymentSignature({ orderId, paymentId, signature })) {
    return res.status(400).json({
      ok: false,
      error: 'We could not verify this payment. If money was deducted, please message us on WhatsApp with your order number.',
    });
  }
  const result = await markPaid(orderId, paymentId);
  if (!result) return res.status(404).json({ ok: false, error: 'Order not found.' });
  if (!result.already) await notifyNewOrder(result.order);
  res.json({ ok: true, redirect: '/order-success' });
}));

// Backup path: Razorpay tells us about the payment even if the customer closed the browser.
router.post('/pay/webhook', asyncHandler(async (req, res) => {
  if (!payments.verifyWebhookSignature(req.rawBody, req.get('X-Razorpay-Signature'))) return res.status(400).send('Invalid signature');
  const event = req.body || {};
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const payment = event.payload?.payment?.entity;
    const orderId = payment?.order_id || event.payload?.order?.entity?.id;
    const result = orderId ? await markPaid(orderId, payment?.id) : null;
    if (result && !result.already) await notifyNewOrder(result.order);
  }
  res.json({ ok: true });
}));

router.get('/order-success', asyncHandler(async (req, res) => {
  const order = await getOrder(req.session.lastOrder || 0);
  if (!order) return res.redirect('/');
  res.render('order-success', { title: 'Order placed', order });
}));

module.exports = router;
