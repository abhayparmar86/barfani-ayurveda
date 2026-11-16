# Launch checklist status (v1.2.0)

Done = built and covered by `npm test` or checked by hand. Open = still needs you or a later version.

## Front end and UX
| Item | Status |
|------|--------|
| Mobile layout, no horizontal scroll, 44px touch targets, 16px body text | Done (please also test on real phones) |
| Favicon | Done (`public/favicon.svg`) |
| Lazy loading of images | Done |
| WebP images | Open: convert product photos to WebP when final photos arrive |
| Custom 404 with search and home button | Done |
| Broken link scan | Open: run a link checker after launch |
| Sticky header, announcement bar, cart badge, slide-out cart | Done |
| Search bar in header with suggestions and typo tolerance | Open: search exists on Shop and 404 pages |
| Mega menu, language and currency switcher | Not needed yet (2 categories, India) |

## Product page and checkout
| Item | Status |
|------|--------|
| Zoomable image, accordion details, ingredients, related products | Done |
| Multiple photos, video, size chart | Open: needs the photos |
| Sticky buy box and mobile buy bar | Done |
| Stock status | Partly: shows "In stock". Low-stock counts need stock numbers per product |
| Quantity selector everywhere, direct +/- in cart | Done |
| Buy now (single item) | Done |
| Guest checkout | Done |
| Online payment (UPI, cards, netbanking), pay-later option | Done, needs your Razorpay keys |
| Apple Pay / Google Pay buttons | Open: Razorpay checkout shows UPI and GPay where the customer's device supports it |
| Shipping and tax display | Partly: shipping is confirmed on WhatsApp. Fixed shipping rates and GST invoices are Open |
| Promo codes | Open |
| Live test orders | Open: do this with Razorpay test keys, then one small live order and refund |

## Technical, SEO, security
| Item | Status |
|------|--------|
| HTTPS redirect and security headers | Done: set `FORCE_HTTPS=true` behind HTTPS |
| Product, Offer, Review schema | Done |
| sitemap.xml and robots.txt | Done: submit the sitemap in Google Search Console |
| Page speed | Open: measure with PageSpeed Insights after deploying |
| www and root domain redirect | Open: configure at your host or DNS |
| Rate limits, password hashing, upload checks, admin protection | Done |

## Analytics and marketing
| Item | Status |
|------|--------|
| Google Analytics page views | Done: set `GA_MEASUREMENT_ID` |
| E-commerce events (add_to_cart, purchase), Search Console | Open |
| Meta / Google Ads pixels | Open: needs your pixel IDs |
| Order confirmation and shipping emails | Done (needs SMTP settings and the customer's email) |
| Account-reset email (forgot password) | Open |
| Abandoned-cart emails | Open |
| Newsletter box | Open |

## Legal and support
| Item | Status |
|------|--------|
| Privacy, Terms, Shipping, Returns pages | Draft: have them reviewed |
| FAQ page, contact form, WhatsApp, Instagram | Done |
| Support email address | Open: create one such as support@barfaniayurveda.in |
| Product licences and label details | Open: confirm with your advisor |
