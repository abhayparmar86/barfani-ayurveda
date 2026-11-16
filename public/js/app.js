// Barfani Ayurveda: small progressive enhancements.
// Every form also works without this file (plain page reloads), so the site never depends on it.
(function () {
  var body = document.body;
  var toastTimer;

  function toast(message, isError) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  function setCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach(function (badge) {
      badge.textContent = count;
      badge.hidden = !count;
    });
  }

  // ---------- slide-out cart ----------
  var drawer = document.getElementById('mini-cart');
  var drawerBody = document.getElementById('mini-cart-body');

  function refreshDrawer() {
    return fetch('/cart/drawer', { credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (html) { drawerBody.innerHTML = html; });
  }

  function openDrawer() {
    if (!drawer) return Promise.resolve();
    return refreshDrawer().then(function () {
      body.classList.add('drawer-open');
      drawer.setAttribute('aria-hidden', 'false');
    });
  }

  function closeDrawer() {
    body.classList.remove('drawer-open');
    if (drawer) drawer.setAttribute('aria-hidden', 'true');
  }

  function post(form) {
    return fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (r) {
      return r.json().then(function (data) { if (!r.ok || !data.ok) throw new Error(data.error || 'Failed'); return data; });
    });
  }

  // ---------- clicks ----------
  document.addEventListener('click', function (event) {
    var target = event.target;

    var step = target.closest('[data-step]');
    if (step) {
      var input = step.parentElement.querySelector('input');
      var next = Math.min(Math.max((parseInt(input.value, 10) || 1) + Number(step.dataset.step), Number(input.min) || 1), Number(input.max) || 10);
      if (next !== Number(input.value)) {
        input.value = next;
        var form = input.form;
        if (form && form.hasAttribute('data-drawer-form')) submitDrawerForm(form);
        else if (form && form.hasAttribute('data-autosubmit')) form.requestSubmit();
      }
      return;
    }

    if (target.closest('[data-drawer-close]')) { closeDrawer(); return; }

    var cartLink = target.closest('[data-open-cart]');
    if (cartLink && !event.metaKey && !event.ctrlKey && !event.shiftKey && drawer) {
      event.preventDefault();
      openDrawer().catch(function () { window.location.href = '/cart'; });
    }
  });

  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeDrawer(); });

  // ---------- add to cart without leaving the page ----------
  document.addEventListener('submit', function (event) {
    var form = event.target;

    if (form.hasAttribute('data-cart-form')) {
      if (event.submitter && event.submitter.name === 'buyNow') return; // Buy now is a normal page visit
      event.preventDefault();
      post(form)
        .then(function (data) { setCount(data.count); toast('Added to your cart ✓'); return openDrawer(); })
        .catch(function () { form.submit(); });
      return;
    }

    if (form.hasAttribute('data-drawer-form')) {
      event.preventDefault();
      submitDrawerForm(form);
    }
  });

  function submitDrawerForm(form) {
    post(form)
      .then(function (data) { setCount(data.count); return refreshDrawer(); })
      .catch(function () { toast('Could not update your cart. Please try again.', true); });
  }

  document.addEventListener('change', function (event) {
    var input = event.target;
    if (input.name === 'qty' && input.form && input.form.hasAttribute('data-drawer-form')) submitDrawerForm(input.form);
  });

  // ---------- product image zoom (desktop) ----------
  document.querySelectorAll('[data-zoom]').forEach(function (box) {
    if (!window.matchMedia('(hover: hover)').matches) return;
    box.addEventListener('mousemove', function (event) {
      var rect = box.getBoundingClientRect();
      box.style.setProperty('--zx', ((event.clientX - rect.left) / rect.width * 100) + '%');
      box.style.setProperty('--zy', ((event.clientY - rect.top) / rect.height * 100) + '%');
      box.classList.add('zooming');
    });
    box.addEventListener('mouseleave', function () { box.classList.remove('zooming'); });
  });
})();
