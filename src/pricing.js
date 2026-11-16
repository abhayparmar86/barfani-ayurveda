const { offer } = require('./config');

// lines: [{ product, qty }]
// Offer: every group of `bundleSize` eligible bottles costs `bundlePrice`.
// The most expensive bottles are bundled first, the remainder is charged at regular price.
function priceCart(lines) {
  const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);
  const units = lines
    .filter((l) => l.product.offer_eligible)
    .flatMap((l) => Array(l.qty).fill(l.product.price))
    .sort((a, b) => b - a);

  let discount = 0;
  let bundles = 0;
  if (offer.enabled) {
    bundles = Math.floor(units.length / offer.bundleSize);
    const bundledValue = units.slice(0, bundles * offer.bundleSize).reduce((s, p) => s + p, 0);
    discount = Math.max(0, bundledValue - bundles * offer.bundlePrice);
  }

  return {
    subtotal,
    discount,
    total: subtotal - discount,
    bundles,
    freeGift: bundles > 0,
    eligibleUnits: units.length,
  };
}

module.exports = { priceCart };
