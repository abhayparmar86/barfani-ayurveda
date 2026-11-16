const { siteName } = require('./config');

const paymentLabel = (o) =>
  o.payment_method === 'online' ? 'Online payment (Razorpay)' : 'Pay later on WhatsApp';

// Plain-text order summary, used in emails.
function describeOrder(o) {
  const items = JSON.parse(o.items_json);
  return [
    `Order #${o.id}`,
    ...items.map((i) => `- ${i.name} (${i.size}) x ${i.qty} @ Rs ${i.price}`),
    `Subtotal: Rs ${o.subtotal}`,
    `Offer discount: Rs ${o.discount}`,
    `Total: Rs ${o.total}`,
    o.free_gift ? 'FREE DIWALI GIFT: include one free product in this parcel' : '',
    `Payment: ${paymentLabel(o)} - ${o.payment_status}`,
    '',
    `Name: ${o.name}`,
    `Phone: ${o.phone}`,
    `Email: ${o.email || '-'}`,
    `Address: ${o.address}, ${o.city}, ${o.state || '-'}, ${o.pincode}, ${o.country}`,
    `Notes: ${o.notes || '-'}`,
  ].join('\n');
}

function customerConfirmation(o) {
  const paid = o.payment_status === 'Paid';
  return {
    subject: `${siteName}: order #${o.id} ${paid ? 'confirmed and paid' : 'received'}`,
    text: [
      `Namaste ${o.name},`,
      '',
      paid
        ? 'Thank you! We have received your payment and your order is confirmed.'
        : 'Thank you for your order. We will contact you on WhatsApp or phone to confirm shipping and payment.',
      '',
      describeOrder(o),
      '',
      `With regards,\n${siteName}`,
    ].join('\n'),
  };
}

function finalOrderConfirmation(o) {
  return {
    subject: `${siteName}: order #${o.id} confirmed and paid`,
    text: [
      `Namaste ${o.name},`,
      '',
      'Your final order is confirmed and payment has been received. Here is the confirmed order summary:',
      '',
      describeOrder(o),
      '',
      `With regards,\n${siteName}`,
    ].join('\n'),
  };
}

function shippingUpdate(o) {
  return {
    subject: `${siteName}: order #${o.id} is ${o.status}`,
    text: [
      `Namaste ${o.name},`,
      '',
      `Your order #${o.id} is now: ${o.status}.`,
      o.tracking_note ? `Details: ${o.tracking_note}` : '',
      '',
      `With regards,\n${siteName}`,
    ].join('\n'),
  };
}

module.exports = { describeOrder, customerConfirmation, finalOrderConfirmation, shippingUpdate, paymentLabel };
