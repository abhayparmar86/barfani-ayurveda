# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] - 2026-11-08
### Added
- Quantity stepper (+ / −) on product cards, product page, cart and mini cart
- Slide-out mini cart: add to cart without leaving the page, change quantity, remove, offer progress bar
- True "Buy now": buys that product only, the cart stays untouched
- Online payments with Razorpay (UPI, cards, netbanking) plus "pay later on WhatsApp"; signature verification and a webhook as backup
- Product page rebuilt Amazon-style: zoom, sticky buy box, mobile buy bar, rating summary, per-product reviews and review form, related products, Product schema (JSON-LD)
- Main Reviews page lists all reviews, with rating summary and a filter per product; star ratings on product cards
- Star-rating input, one review per customer per product, shortened reviewer names for privacy
- Admin area at /admin (orders with status and tracking emails, mark as paid, review moderation, consultation requests)
- Customer order-confirmation and shipping-update emails (when the customer gave an email address)
- FAQ page, Terms of Service draft, branded 404 and 500 pages, favicon, robots.txt, sitemap.xml, social preview tags, optional Google Analytics
- Sort products by price or rating; form validation messages and field styling
- Automated end-to-end test (`npm test`)
- Database upgrades run automatically; existing orders, users and reviews are kept

### Changed
- Checkout shows payment options and validates phone and email
- Offer ribbon, cart and checkout mention free shipping within India on offer orders
- Orders store payment method, payment status, tracking note and free-gift flag

## [1.1.0] - 2026-11-08
### Changed
- Full visual redesign: new design system, header, footer, product cards, cart, checkout and consultation form
### Added
- Product detail page, co-doctor profile on Home, About and Consult pages

## [1.0.0] - 2026-11-07
### Added
- Home, About, Shop, Contact (consultation form), Reviews and policy pages
- Product catalog with category tabs, search, wishlist, cart, Buy Now and WhatsApp order
- Diwali offer: any 3 eligible bottles for a fixed bundle price, plus a free gift
- User signup, login, account page with order history
- Checkout that saves the order and emails it to the doctor
- Patient reviews with optional photo upload
- Consultation form emailed to the doctor, with reply-to set to the patient
