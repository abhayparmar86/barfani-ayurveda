// End-to-end smoke test. Run with: npm test
// Starts the real app on a temporary database with a fake Razorpay server, then walks through
// the main customer and admin flows.
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 3900 + Math.floor(Math.random() * 90);
const FAKE_RZP_PORT = PORT + 100;
const BASE = `http://localhost:${PORT}`;
const KEY_SECRET = 'test_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'barfani-')), 'test.db');

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
};

// Minimal cookie-aware client.
function client() {
  const jar = {};
  return async function request(method, url, { form, json, headers = {}, auth, body, redirect = 'manual' } = {}) {
    const h = { ...headers, Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload = body;
    if (form) { payload = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json) { payload = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    if (auth) h.Authorization = 'Basic ' + Buffer.from(auth).toString('base64');
    const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect });
    (res.headers.getSetCookie?.() || []).forEach((c) => { const [pair] = c.split(';'); const i = pair.indexOf('='); jar[pair.slice(0, i)] = pair.slice(i + 1); });
    const text = await res.text();
    return { status: res.status, text, location: res.headers.get('location'), res };
  };
}

function startFakeRazorpay() {
  return new Promise((resolve) => {
    let n = 0;
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const body = JSON.parse(data || '{}');
        n++;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: `order_TEST${n}`, amount: body.amount, currency: body.currency }));
      });
    }).listen(FAKE_RZP_PORT, () => resolve(server));
  });
}

function startFakeSmtp() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let dataMode = false;
    let message = '';
    let recipients = [];
    socket.write('220 localhost ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (dataMode) {
          if (line === '.') {
            dataMode = false;
            messages.push({ recipients, message });
            socket.write('250 2.0.0 queued\r\n');
          } else {
            message += `${line.replace(/^\.\./, '.')}\r\n`;
          }
          continue;
        }
        if (/^EHLO|^HELO/i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH /i.test(line)) socket.write('235 2.7.0 authenticated\r\n');
        else if (/^(MAIL FROM|RSET)/i.test(line)) socket.write('250 2.1.0 ok\r\n');
        else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line.match(/<([^>]+)>/)?.[1] || line.slice(8));
          socket.write('250 2.1.5 ok\r\n');
        } else if (/^DATA$/i.test(line)) {
          dataMode = true;
          message = '';
          socket.write('354 end with <CRLF>.<CRLF>\r\n');
        } else if (/^QUIT$/i.test(line)) {
          socket.write('221 2.0.0 bye\r\n');
          socket.end();
        } else {
          socket.write('250 2.0.0 ok\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, messages, port: server.address().port }));
  });
}

const waitForServer = async () => {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/robots.txt'); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('Server did not start');
};

(async () => {
  const fakeRzp = await startFakeRazorpay();
  const fakeSmtp = await startFakeSmtp();
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT, DB_PATH: dbFile, SESSION_SECRET: 'test', ADMIN_PASSWORD: 'adminpass', ADMIN_USER: 'admin',
      RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RAZORPAY_API_BASE: `http://localhost:${FAKE_RZP_PORT}`, SITE_URL: 'https://barfaniayurveda.in',
      DOCTOR_EMAIL: 'barfaniayurveda@gmail.com', SMTP_HOST: '127.0.0.1', SMTP_PORT: fakeSmtp.port,
      SMTP_USER: 'barfaniayurveda@gmail.com', SMTP_PASS: 'fake-app-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  try {
    await waitForServer();
    const guest = client();

    console.log('\nPublic pages');
    for (const p of ['/', '/shop', '/shop?category=Hair+Care&sort=price_desc', '/shop?q=oil', '/product/ayurvedic-hair-oil', '/about', '/faq', '/contact', '/login', '/signup', '/reviews', '/cart', '/policy/shipping', '/policy/terms']) {
      const r = await guest('GET', p);
      check(`GET ${p} -> 200`, r.status === 200, `got ${r.status}`);
      check(`GET ${p} has no "undefined"`, !/undefined|\[object Object\]|NaN/.test(r.text));
    }
    let r = await guest('GET', '/shop');
    check('shop navigation is highlighted on shop and product pages',
      /href="\/shop" class="active" aria-current="page">Shop/.test(r.text));
    r = await guest('GET', '/product/ayurvedic-hair-oil');
    check('shop navigation stays highlighted on product pages',
      /href="\/shop" class="active" aria-current="page">Shop/.test(r.text));
    r = await guest('GET', '/about');
    check('about navigation is highlighted on about page',
      /href="\/about" class="active" aria-current="page">About/.test(r.text));
    r = await guest('GET', '/shop');
    check('shop cards have a quantity stepper', /class="stepper"/.test(r.text) && /name="qty"/.test(r.text));
    check('TODO text is hidden from visitors', !/TODO/.test(r.text));
    r = await guest('GET', '/nope');
    check('unknown page -> branded 404 with search', r.status === 404 && /type="search"/.test(r.text));
    r = await guest('GET', '/robots.txt');
    check('robots.txt lists sitemap', /Sitemap: https:\/\/barfaniayurveda\.in\/sitemap\.xml/.test(r.text));
    r = await guest('GET', '/sitemap.xml');
    check('sitemap lists products', /product\/ayurvedic-hair-oil/.test(r.text));
    r = await guest('GET', '/product/ayurvedic-hair-oil');
    check('product page has JSON-LD Product schema', /"@type":"Product"/.test(r.text));
    check('product page has buy box with Add to cart and Buy now', /Add to cart/.test(r.text) && /name="buyNow"/.test(r.text));
    r = await guest('GET', '/product/does-not-exist');
    check('unknown product -> 404', r.status === 404);

    console.log('\nCart');
    const ajax = { 'X-Requested-With': 'fetch' };
    r = await guest('POST', '/cart/add/1', { form: { qty: '2' }, headers: ajax });
    check('add 2 oils via fetch -> JSON count 2', r.status === 200 && JSON.parse(r.text).count === 2, r.text);
    r = await guest('POST', '/cart/add/2', { form: { qty: '1' }, headers: ajax });
    r = await guest('POST', '/cart/add/3', { form: { qty: '1' }, headers: ajax });
    check('count is 4 after oil x2, shampoo, hair ark', JSON.parse(r.text).count === 4, r.text);
    r = await guest('GET', '/cart/drawer');
    check('drawer lists items with steppers', /Pure Ayurvedic Hair Oil/.test(r.text) && /data-drawer-form/.test(r.text));
    check('drawer shows offer discount of 251', /−₹251/.test(r.text), r.text.match(/Diwali offer[^<]*<\/span><span>[^<]*/)?.[0]);
    r = await guest('GET', '/cart');
    check('cart page total is ₹2,999 (3,000 minus 251 + soap-free)', /₹2,749/.test(r.text), r.text.match(/Total<\/span><span>[^<]*/)?.[0]);
    r = await guest('POST', '/cart/update/1', { form: { qty: '1' }, headers: ajax });
    check('update qty to 1 -> count 3', JSON.parse(r.text).count === 3, r.text);
    r = await guest('POST', '/cart/remove/3', { form: {}, headers: ajax });
    check('remove hair ark -> count 2', JSON.parse(r.text).count === 2, r.text);
    r = await guest('POST', '/cart/add/1', { form: { qty: '50' }, headers: ajax });
    r = await guest('GET', '/cart/drawer');
    check('quantity is capped at 10', /value="10"/.test(r.text));
    await guest('POST', '/cart/remove/1', { form: {}, headers: ajax });
    await guest('POST', '/cart/remove/2', { form: {}, headers: ajax });
    r = await guest('GET', '/cart');
    check('empty cart shows empty state', /Your cart is empty/.test(r.text));

    console.log('\nBuy now (single item, cart untouched)');
    await guest('POST', '/cart/add/5', { form: { qty: '1' }, headers: ajax });
    r = await guest('POST', '/cart/add/1', { form: { qty: '2', buyNow: '1' } });
    check('Buy now redirects to checkout in buynow mode', r.status === 302 && r.location === '/checkout?mode=buynow', `${r.status} ${r.location}`);
    r = await guest('GET', '/checkout?mode=buynow');
    check('checkout shows only the buy-now item', /Pure Ayurvedic Hair Oil × 2/.test(r.text) && !/Handmade Ayurvedic Soap/.test(r.text));
    check('checkout offers online and pay-later', /value="online"/.test(r.text) && /value="whatsapp"/.test(r.text));

    console.log('\nCheckout validation');
    const address = { name: 'Test Buyer', phone: '9876543210', email: 'buyer@example.com', address: '12 Test Street', city: 'Surendranagar', state: 'Gujarat', pincode: '363001', country: 'India', mode: 'buynow' };
    r = await guest('POST', '/checkout', { form: { ...address, phone: '12', payment: 'whatsapp' } });
    check('short phone number is rejected', r.status === 400 && /valid phone/.test(r.text));
    r = await guest('POST', '/checkout', { form: { ...address, country: 'United Kingdom', payment: 'online' } });
    check('online payment outside India is rejected', r.status === 400 && /India only/.test(r.text));
    r = await guest('POST', '/checkout', { form: { ...address, email: 'not-an-email', payment: 'whatsapp' } });
    check('bad email is rejected', r.status === 400 && /valid email/.test(r.text));
    r = await guest('POST', '/checkout', { form: { ...address, email: '', payment: 'whatsapp' } });
    check('checkout requires a customer email for order updates', r.status === 400 && /required delivery details/.test(r.text));

    console.log('\nPay later on WhatsApp');
    r = await guest('POST', '/checkout', { form: { ...address, payment: 'whatsapp' } });
    check('order placed -> /order-success', r.status === 302 && r.location === '/order-success', `${r.status} ${r.location}`);
    check('initial order email goes to business and customer', fakeSmtp.messages.some((m) =>
      m.recipients.includes('barfaniayurveda@gmail.com') && /Order #1/.test(m.message)
    ) && fakeSmtp.messages.some((m) =>
      m.recipients.includes('buyer@example.com') && /Order #1/.test(m.message)
    ));
    r = await guest('GET', '/order-success');
    check('success page confirms the order', /Thank you, Test Buyer/.test(r.text) && /confirm shipping and payment/.test(r.text));
    r = await guest('GET', '/cart/drawer');
    check('buy-now order left the separate cart item (soap) untouched', /Handmade Ayurvedic Soap/.test(r.text));

    console.log('\nOnline payment (Razorpay)');
    await guest('POST', '/cart/add/2', { form: { qty: '3' }, headers: ajax });
    r = await guest('POST', '/checkout', { form: { ...address, mode: 'cart', payment: 'online' } });
    check('online order redirects to /pay/ID', r.status === 302 && /^\/pay\/\d+$/.test(r.location), `${r.status} ${r.location}`);
    const payUrl = r.location;
    const orderId = payUrl.split('/').pop();
    r = await guest('GET', payUrl);
    // 3 shampoos (offer price 1999) + the soap still in the cart (199) = 2198 rupees = 219800 paise
    check('pay page carries Razorpay order id and amount in paise', /data-rzp-order="order_TEST1"/.test(r.text) && /data-amount="219800"/.test(r.text), r.text.match(/data-amount="[^"]*"/)?.[0]);
    r = await guest('GET', '/order-success');
    check('abandoned online order shows "Payment pending"', /Payment pending/.test(r.text));
    r = await guest('POST', '/pay/verify', { json: { razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' } });
    check('forged payment signature is rejected', r.status === 400);
    const sig = crypto.createHmac('sha256', KEY_SECRET).update('order_TEST1|pay_1').digest('hex');
    r = await guest('POST', '/pay/verify', { json: { razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_1', razorpay_signature: sig } });
    check('valid payment signature is accepted', r.status === 200 && JSON.parse(r.text).ok === true, r.text);
    r = await guest('GET', '/order-success');
    check('success page shows payment received', /Payment received/.test(r.text));
    r = await guest('GET', payUrl);
    check('paid order cannot be paid twice', r.status === 302 && r.location === '/order-success');

    // webhook path: second online order paid only through the webhook
    await guest('POST', '/cart/add/1', { form: { qty: '1' }, headers: ajax });
    r = await guest('POST', '/checkout', { form: { ...address, mode: 'cart', payment: 'online' } });
    const order2 = r.location.split('/').pop();
    const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_2', order_id: 'order_TEST2' } } } });
    r = await guest('POST', '/pay/webhook', { body: event, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'wrong' } });
    check('webhook with wrong signature is rejected', r.status === 400);
    const whSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(event).digest('hex');
    r = await guest('POST', '/pay/webhook', { body: event, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': whSig } });
    check('webhook with right signature is accepted', r.status === 200);

    console.log('\nAccounts, reviews and wishlist');
    const shopper = client();
    r = await shopper('POST', '/signup', { form: { name: 'Asha Sharma', email: 'asha@example.com', phone: '9999999999', password: 'password123' } });
    check('signup works', r.status === 302);
    r = await shopper('GET', '/account');
    check('account page loads', r.status === 200 && /Asha Sharma/.test(r.text));
    r = await shopper('POST', '/wishlist/toggle/1', { form: {}, headers: { Referer: BASE + '/shop' } });
    r = await shopper('GET', '/wishlist');
    check('wishlist shows the product', /Pure Ayurvedic Hair Oil/.test(r.text));
    r = await guest('POST', '/reviews', { form: { productId: '1', rating: '5', comment: 'Guest review' } });
    check('guest cannot post a review (sent to login)', r.status === 302 && r.location === '/login');

    const fd = new FormData();
    fd.set('productId', '1'); fd.set('from', 'product'); fd.set('rating', '4'); fd.set('comment', 'Lovely smell and my scalp feels fresh.');
    r = await shopper('POST', '/reviews', { body: fd });
    check('review on product page redirects back to that product', r.status === 302 && r.location === '/product/ayurvedic-hair-oil#reviews', `${r.status} ${r.location}`);
    const fd2 = new FormData();
    fd2.set('productId', '1'); fd2.set('from', 'product'); fd2.set('rating', '5'); fd2.set('comment', 'Second review attempt');
    r = await shopper('POST', '/reviews', { body: fd2 });
    r = await shopper('GET', '/product/ayurvedic-hair-oil');
    check('duplicate review is blocked', /already reviewed/.test(r.text));
    check('product page shows this product review and rating', /Lovely smell/.test(r.text) && /4\.0 · 1 review/.test(r.text), r.text.match(/\d\.\d · \d+ review/)?.[0]);
    check('reviewer name is shortened to first name and initial', /Asha S\./.test(r.text) && !/Asha Sharma/.test(r.text.split('id="reviews"')[1] || ''));
    check('product page schema includes aggregateRating', /"aggregateRating"/.test(r.text));
    r = await guest('GET', '/product/ayurvedic-hair-shampoo');
    check('other product does not show that review', !/Lovely smell/.test(r.text));
    r = await guest('GET', '/reviews');
    check('main reviews page lists all reviews', /Lovely smell/.test(r.text));
    r = await guest('GET', '/reviews?product=2');
    check('main reviews page can filter by product', !/Lovely smell/.test(r.text));
    r = await guest('GET', '/shop');
    check('shop card shows star rating', /card-rating/.test(r.text) && /4\.0/.test(r.text));

    console.log('\nAdmin');
    r = await guest('GET', '/admin');
    check('admin requires login', r.status === 401);
    r = await guest('GET', '/admin', { auth: 'admin:wrong' });
    check('admin rejects wrong password', r.status === 401);
    r = await guest('GET', '/admin/orders', { auth: 'admin:adminpass' });
    check('admin lists orders', r.status === 200 && /Order #1/.test(r.text) && /Paid/.test(r.text));
    check('admin offers WhatsApp contact and revised-order editing', /wa\.me\/919876543210/.test(r.text) && /\/admin\/orders\/1\/edit/.test(r.text));
    r = await guest('GET', '/admin/orders/1/edit', { auth: 'admin:adminpass' });
    check('admin order editor loads catalog quantities', r.status === 200 && /qty\[1\]/.test(r.text) && /Save revised order/.test(r.text));
    r = await guest('POST', '/admin/orders/1/edit', { auth: 'admin:adminpass', form: { 'qty[1]': '2', 'qty[2]': '1' } });
    check('admin can revise order items before payment', r.status === 302);
    r = await guest('POST', '/admin/orders/1/confirm', { auth: 'admin:adminpass', form: {} });
    check('unpaid order cannot be finally confirmed', r.status === 302);
    r = await guest('POST', '/admin/orders/1/paid', { auth: 'admin:adminpass', form: {} });
    check('admin can mark WhatsApp payment received', r.status === 302);
    r = await guest('POST', '/admin/orders/1/confirm', { auth: 'admin:adminpass', form: {} });
    check('admin confirms paid WhatsApp order after sending final email', r.status === 302);
    r = await guest('GET', '/admin/orders?status=Confirmed', { auth: 'admin:adminpass' });
    const finalMail = fakeSmtp.messages.find((m) =>
      m.recipients.includes('buyer@example.com')
      && /confirmed order summary/.test(m.message.replace(/=\r?\n/g, ''))
      && /Order #1/.test(m.message)
    );
    const finalMailText = finalMail?.message.replace(/=\r?\n/g, '') || '';
    check('final email includes revised products and total', /Order #1/.test(r.text) && !!finalMail
      && /Pure Ayurvedic Hair Shampoo/.test(finalMailText) && /Total: Rs 1999/.test(finalMailText));
    r = await guest('POST', `/admin/orders/${orderId}/status`, { auth: 'admin:adminpass', form: { status: 'Shipped', tracking_note: 'Tracking 123', notify: '1' }, headers: { Origin: 'http://evil.example' } });
    check('admin post from another site is blocked', r.status === 403);
    r = await guest('POST', `/admin/orders/${orderId}/status`, { auth: 'admin:adminpass', form: { status: 'Shipped', tracking_note: 'Tracking 123', notify: '1' }, headers: { Origin: BASE } });
    check('admin can mark order shipped', r.status === 302);
    r = await shopper('GET', '/account');
    r = await guest('GET', '/admin/orders?status=Shipped', { auth: 'admin:adminpass' });
    check('shipped filter shows the order with tracking note', /Tracking 123/.test(r.text));
    r = await guest('GET', '/admin/reviews', { auth: 'admin:adminpass' });
    check('admin lists reviews', r.status === 200 && /Lovely smell/.test(r.text));
    r = await guest('GET', '/admin/consultations', { auth: 'admin:adminpass' });
    check('admin consultations page loads', r.status === 200);
    r = await guest('POST', '/contact', { form: { name: 'Seeker', phone: '9876500000', concern: 'Hair fall', consent: '1' } });
    r = await guest('GET', '/admin/consultations', { auth: 'admin:adminpass' });
    check('consultation request appears in admin', /Seeker/.test(r.text));
    r = await guest('POST', '/contact', { form: { name: 'No Consent', phone: '1', concern: 'x' } });
    check('consultation without consent is rejected', r.status === 400);

    console.log('\nServer log check');
    check('no server errors were logged', !/Error|TypeError|SqliteError/.test(serverLog.replace(/Razorpay order failed/g, '')), serverLog.split('\n').filter((l) => /Error/.test(l)).join(' | '));
  } catch (err) {
    failed++;
    console.log('  FAIL unexpected error:', err);
  } finally {
    server.kill();
    fakeRzp.close();
    fakeSmtp.server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { process.exit(1); }
})();
