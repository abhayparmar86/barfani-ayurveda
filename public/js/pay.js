// Opens Razorpay Checkout for the order described in #pay-data.
(function () {
  var data = document.getElementById('pay-data').dataset;
  var button = document.getElementById('pay-button');
  var errorBox = document.getElementById('pay-error');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    button.disabled = false;
  }

  function startPayment() {
    errorBox.hidden = true;
    if (typeof Razorpay === 'undefined') { showError('Payment window could not load. Please check your internet connection and try again.'); return; }
    button.disabled = true;

    var checkout = new Razorpay({
      key: data.key,
      amount: Number(data.amount),
      currency: 'INR',
      name: 'Barfani Ayurveda',
      description: 'Order #' + data.order,
      order_id: data.rzpOrder,
      prefill: { name: data.name, email: data.email, contact: data.phone },
      theme: { color: '#1b3a2a' },
      modal: { ondismiss: function () { button.disabled = false; } },
      handler: function (response) {
        fetch('/pay/verify', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(response)
        })
          .then(function (r) { return r.json(); })
          .then(function (result) {
            if (result.ok) window.location.href = result.redirect;
            else showError(result.error);
          })
          .catch(function () { showError('Network problem while confirming payment. If money was deducted, message us on WhatsApp with your order number.'); });
      }
    });
    checkout.on('payment.failed', function (response) {
      showError((response.error && response.error.description) || 'Payment failed. Please try again.');
    });
    checkout.open();
  }

  button.addEventListener('click', startPayment);
})();
