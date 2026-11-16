# Barfani Ayurveda

Website and online store for Barfani Ayurveda (Shraddha Clinic, Surendranagar, Gujarat).
Node.js + Express + EJS + SQLite. No build step, no frontend framework.

## Run it (one command)

Requires Node.js 18 or newer.

```bash
npm run go
```

This installs packages and starts the site at http://localhost:3000.
Next time, `npm start` is enough. The site works with no settings at all: emails are printed in the
terminal and online payment and the admin area stay switched off until you configure them.

## Upgrading from v1.1.0 (keeps your orders, users and settings)

Copy these from your old folder into the new one, then run `npm run go`:

```powershell
Copy-Item ..\v1.1.0\.env .env
Copy-Item ..\v1.1.0\data .\data -Recurse
Copy-Item ..\v1.1.0\uploads\* .\uploads\ -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item ..\v1.1.0\src\data\products.js .\src\data\products.js
```

The database upgrades itself on start. Old orders stay as "Pay later on WhatsApp".

## Settings (`.env`, see `.env.example`)

| Setting | What it does |
|---------|--------------|
| `DOCTOR_EMAIL`, `SMTP_*` | Where consultation requests and orders are emailed, and the Gmail account that sends them. The order inbox defaults to `barfaniayurveda@gmail.com`. |
| `ADMIN_PASSWORD` | Turns on /admin. Choose a long password. Leave empty to keep admin off |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Turns on online payment (see below) |
| `RAZORPAY_WEBHOOK_SECRET` | Lets Razorpay confirm payments even if the customer closes the browser |
| `SITE_URL` | Your public address, e.g. `https://barfaniayurveda.in` (sitemap, canonical links, previews) |
| `FORCE_HTTPS` | `true` when the site is behind HTTPS on your host |
| `OFFER_ENABLED`, `OFFER_UNTIL` | Diwali offer on or off, and the end-date text shown to customers |
| `GA_MEASUREMENT_ID` | Optional Google Analytics 4 |

Restart the server after changing `.env`.

### Order emails and WhatsApp confirmation

The site saves an order and sends an initial order summary to `DOCTOR_EMAIL` and the customer's required checkout email. To send from `barfaniayurveda@gmail.com`, set `SMTP_USER` to that Gmail address, create a Google App Password (do not use your normal Gmail password), and set it as `SMTP_PASS`. Leave `SMTP_FROM` blank or set it to the same Gmail address. Keep the Razorpay keys blank to use the pay-later-on-WhatsApp flow.

In Admin, use **Message customer on WhatsApp** to open a prefilled chat; a person must review and press Send. Edit the products and quantities there, then save the revised order in Admin. After payment has been received and marked paid in Admin, use **Confirm order and email final summary** to confirm the saved items and total by email. This is an order summary, not a tax invoice; shipping is confirmed separately.

## Online payments (Razorpay)

1. Create an account at razorpay.com and open Dashboard > Settings > API Keys. Use **Test Mode** keys first.
2. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`, restart, and place a test order with Razorpay's test card or UPI details (Razorpay Docs > Test Cards).
3. Dashboard > Webhooks > add `https://YOUR-DOMAIN/pay/webhook`, select the `payment.captured` and `order.paid` events, set a secret, and put the same value in `RAZORPAY_WEBHOOK_SECRET`.
4. Complete Razorpay's business verification, then replace the test keys with Live keys.

Online payment is offered for orders in India only. Orders for other countries use "Pay later on WhatsApp",
because shipping for them is quoted individually. Money goes from the customer to your Razorpay account.
The website never sees card or UPI details.

## Admin area (`/admin`)

Set `ADMIN_PASSWORD`, restart, and open `/admin`. Username is `ADMIN_USER` (default `admin`).
You can see orders, change status, add a tracking note and email the customer, mark WhatsApp orders as paid,
approve or delete reviews, and read consultation requests.

## Everyday tasks

| Task | How |
|------|-----|
| Change a price, add a product or edit ingredients | Edit `src/data/products.js`, restart. Text starting with `TODO` is hidden from visitors |
| Add a product photo | Save it in `public/images/` using the file name in `products.js` (4:5 portrait, about 800 x 1000 px, JPG or WebP) |
| Change the Diwali offer | `src/config.js` (bundle size and prices), or set `OFFER_ENABLED=false` |
| Hide a product | Set `in_stock: 0` in `products.js`, restart |
| Moderate reviews before they appear | `REVIEWS_AUTO_APPROVE=false`, then approve in /admin/reviews |
| Back up | Copy the `data/` and `uploads/` folders |

## Test everything

```bash
npm test
```

Starts the site on a temporary database with a fake Razorpay and checks pages, cart, Buy now, validation,
payment signatures, webhook, reviews, wishlist and admin. Run it after every change.

## Before going live

1. Fill every `TODO` in `src/data/products.js` and add real product photos.
2. Review the Shipping, Returns, Privacy and Terms text in `src/routes/pages.js` and the FAQ answers.
3. Confirm the product licences and label details (Legal Metrology and AYUSH requirements) with your advisor.
4. Set `NODE_ENV=production`, a strong `SESSION_SECRET`, `SITE_URL`, `FORCE_HTTPS=true`, `ADMIN_PASSWORD`.
5. Place a real test order for each payment route and confirm the emails arrive.
6. See `docs/LAUNCH-CHECKLIST.md` for the full list and what is still open.

## Deployment note

This project is not ready to deploy to Vercel as-is. It runs a long-lived Express server, stores orders,
accounts and reviews in a local SQLite database, and stores uploaded images on disk. Vercel uses
serverless functions with ephemeral filesystems, so those files are not durable and `better-sqlite3`
is not a suitable production database there.

To use Vercel, first adapt the server for Vercel's function model and move the database to a hosted,
persistent database; move uploaded images to durable object storage as well. Until then, deploy this
version to a Node.js host with a persistent disk and configure backups. The `.env` file and runtime
data are intentionally excluded from Git; configure production environment variables in the host.

## Troubleshooting

- **`better-sqlite3` fails to install**: use Node.js 18, 20 or 22 (LTS) and run `npm install` again.
- **Emails not arriving**: look for `[email not sent]` or `Mail failed` in the terminal. Confirm `DOCTOR_EMAIL`, `SMTP_USER`, and `SMTP_PASS`; Gmail needs an App Password.
- **Page looks unstyled or `include` errors**: turn off "Format on save" for `.ejs` files in your editor. HTML formatters break EJS tags.
- **Payment page says it cannot load**: check the internet connection and that the Razorpay keys are correct.
