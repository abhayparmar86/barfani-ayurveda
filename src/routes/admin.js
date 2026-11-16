const router = require('express').Router();
const db = require('../db');
const mailer = require('../mailer');
const { priceCart } = require('../pricing');
const { describeOrder, finalOrderConfirmation, shippingUpdate } = require('../orders');
const { requireAdmin, flash, clean } = require('../middleware');

const STATUSES = ['New', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];

router.use('/admin', requireAdmin);

router.get('/admin', (req, res) => {
  const count = (sql) => db.prepare(sql).get().n;
  const stats = {
    newOrders: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'New'"),
    pendingPayment: count("SELECT COUNT(*) AS n FROM orders WHERE payment_status = 'Pending'"),
    pendingReviews: count('SELECT COUNT(*) AS n FROM reviews WHERE approved = 0'),
    consultations: count('SELECT COUNT(*) AS n FROM consultations'),
  };
  res.render('admin/dashboard', { title: 'Admin', stats });
});

router.get('/admin/orders', (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const orders = db
    .prepare("SELECT * FROM orders WHERE (? = '' OR status = ?) ORDER BY id DESC LIMIT 200")
    .all(status, status)
    .map((o) => {
      const digits = String(o.phone || '').replace(/\D/g, '');
      const country = String(o.country || '').toLowerCase();
      const whatsappNumber = country === 'india' && digits.length === 10
        ? `91${digits}`
        : country === 'india' && digits.length === 11 && digits.startsWith('0')
          ? `91${digits.slice(1)}`
          : digits;
      const message = `Namaste ${o.name}, we received your order #${o.id}. We can confirm the final products, total and payment here on WhatsApp.`;
      return {
        ...o,
        items: JSON.parse(o.items_json),
        whatsappUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`,
      };
    });
  res.render('admin/orders', { title: 'Admin: orders', orders, statuses: STATUSES, status });
});

function orderEditData(order) {
  const items = JSON.parse(order.items_json);
  const products = db.prepare('SELECT * FROM products ORDER BY id').all();
  const quantities = new Map();
  for (const item of items) {
    const product = products.find((p) => p.id === item.product_id)
      || products.find((p) => p.name === item.name && p.size === item.size);
    if (!product) return null;
    quantities.set(product.id, (quantities.get(product.id) || 0) + item.qty);
  }
  return {
    ...order,
    products: products
      .filter((p) => p.in_stock || quantities.has(p.id))
      .map((p) => ({ ...p, quantity: quantities.get(p.id) || 0 })),
  };
}

router.get('/admin/orders/:id/edit', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) {
    flash(req, 'error', 'Order not found.');
    return res.redirect('/admin/orders');
  }
  const editData = orderEditData(order);
  if (!editData) {
    flash(req, 'error', `Order #${order.id} contains a product that cannot be matched to the current catalog and was not changed.`);
    return res.redirect('/admin/orders');
  }
  res.render('admin/order-edit', { title: `Edit order #${order.id}`, order: editData });
});

router.post('/admin/orders/:id/edit', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) {
    flash(req, 'error', 'Order not found.');
    return res.redirect('/admin/orders');
  }
  const editData = orderEditData(order);
  if (!editData) {
    flash(req, 'error', `Order #${order.id} contains a product that cannot be matched to the current catalog and was not changed.`);
    return res.redirect('/admin/orders');
  }
  if (order.payment_status === 'Paid' || order.status === 'Cancelled') {
    flash(req, 'error', 'Paid or cancelled orders cannot be edited.');
    return res.redirect('/admin/orders');
  }

  const lines = [];
  for (const product of editData.products) {
    const raw = req.body[`qty[${product.id}]`];
    const qty = raw === undefined || raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(qty) || qty < 0 || qty > 10 || (!product.in_stock && qty > product.quantity)) {
      flash(req, 'error', `Invalid quantity for ${product.name}; quantities must be between 0 and 10 and unavailable products cannot be increased.`);
      return res.redirect(`/admin/orders/${order.id}/edit`);
    }
    if (qty > 0) lines.push({ product, qty });
  }
  if (!lines.length) {
    flash(req, 'error', 'An order must contain at least one product.');
    return res.redirect(`/admin/orders/${order.id}/edit`);
  }

  const items = lines.map(({ product, qty }) => ({
    product_id: product.id,
    name: product.name,
    size: product.size,
    qty,
    price: product.price,
  }));
  const pricing = priceCart(lines);
  db.prepare(
    `UPDATE orders SET items_json = ?, subtotal = ?, discount = ?, total = ?, free_gift = ?
     WHERE id = ?`
  ).run(JSON.stringify(items), pricing.subtotal, pricing.discount, pricing.total, pricing.freeGift ? 1 : 0, order.id);
  flash(req, 'success', `Order #${order.id} updated with current catalog prices. Contact the customer to confirm the revised order and payment.`);
  res.redirect('/admin/orders');
});

router.post('/admin/orders/:id/status', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.redirect('/admin/orders');
  const status = STATUSES.includes(req.body.status) ? req.body.status : order.status;
  if (status === 'Confirmed' && order.payment_status !== 'Paid') {
    flash(req, 'error', `Order #${order.id} can only be confirmed after payment is marked as received.`);
    return res.redirect('/admin/orders');
  }
  const note = clean(req.body.tracking_note, 300);
  db.prepare('UPDATE orders SET status = ?, tracking_note = ? WHERE id = ?').run(status, note, order.id);

  if (req.body.notify && order.email) {
    const sent = await mailer.sendToCustomer({ to: order.email, ...shippingUpdate({ ...order, status, tracking_note: note }) });
    flash(req, sent ? 'success' : 'error', sent
      ? `Order #${order.id} updated and the customer was emailed.`
      : `Order #${order.id} was updated, but the email could not be sent.`);
  } else {
    flash(req, 'success', `Order #${order.id} updated.`);
  }
  res.redirect('/admin/orders');
});

router.post('/admin/orders/:id/confirm', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) {
    flash(req, 'error', 'Order not found.');
    return res.redirect('/admin/orders');
  }
  if (order.payment_status !== 'Paid' || order.status === 'Cancelled') {
    flash(req, 'error', 'Mark payment as received and make sure the order is not cancelled before confirming it.');
    return res.redirect('/admin/orders');
  }
  if (!order.email) {
    flash(req, 'error', `Order #${order.id} has no customer email address.`);
    return res.redirect('/admin/orders');
  }
  const sent = await mailer.sendToCustomer({ to: order.email, ...finalOrderConfirmation(order) });
  if (!sent) {
    flash(req, 'error', `Order #${order.id} was not marked confirmed because the final email could not be sent. Check SMTP settings and try again.`);
    return res.redirect('/admin/orders');
  }
  db.prepare("UPDATE orders SET status = 'Confirmed' WHERE id = ?").run(order.id);
  flash(req, 'success', `Order #${order.id} confirmed and final order email sent to ${order.email}.`);
  res.redirect('/admin/orders');
});

// For payments confirmed outside the website, for example on WhatsApp or by bank transfer.
router.post('/admin/orders/:id/paid', (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) {
    flash(req, 'error', 'Order not found.');
    return res.redirect('/admin/orders');
  }
  db.prepare("UPDATE orders SET payment_status = 'Paid' WHERE id = ?").run(order.id);
  flash(req, 'success', `Order #${req.params.id} marked as paid.`);
  res.redirect('/admin/orders');
});

router.get('/admin/reviews', (req, res) => {
  const reviews = db
    .prepare(
      `SELECT r.*, u.name AS user_name, p.name AS product_name FROM reviews r
       JOIN users u ON u.id = r.user_id LEFT JOIN products p ON p.id = r.product_id
       ORDER BY r.approved ASC, r.id DESC LIMIT 200`
    )
    .all();
  res.render('admin/reviews', { title: 'Admin: reviews', reviews });
});

router.post('/admin/reviews/:id/approve', (req, res) => {
  db.prepare('UPDATE reviews SET approved = 1 WHERE id = ?').run(Number(req.params.id));
  flash(req, 'success', 'Review approved.');
  res.redirect('/admin/reviews');
});

router.post('/admin/reviews/:id/delete', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(req.params.id));
  flash(req, 'success', 'Review deleted.');
  res.redirect('/admin/reviews');
});

router.get('/admin/consultations', (req, res) => {
  const consultations = db
    .prepare('SELECT * FROM consultations ORDER BY id DESC LIMIT 200')
    .all()
    .map((c) => ({ ...c, data: JSON.parse(c.data_json) }));
  res.render('admin/consultations', { title: 'Admin: consultations', consultations });
});

module.exports = router;
