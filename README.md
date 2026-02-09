# BSK@L Enterprise — Demo Shop

This is a small demo shop for BSK@L Enterprise (mineral drinks, water, and cold store meats/fishes).

## Features
- Product catalog with stock counts
- Cart, checkout with delivery option
- Mock payment (Card or Mobile Money)
- Order tracking by order id
- Backend (Express) serves frontend for simple deployment
- Desktop POS app (offline-first) with sync to website
- POS staff login/roles, barcode scan, receipts, returns, low-stock alerts
- Shift open/close, cash movements, daily reconciliation, audit log
- Shift export to CSV/PDF
- Multi-branch support (branch selection in POS settings)
- Cashier performance dashboards (manager only)
- Barcode label template customization

## Run locally
1. Open a terminal and install backend dependencies:
   cd backend
   npm install
2. Start the backend (which also serves the frontend):
   npm start
3. Open http://localhost:5500 in your browser

## POS desktop app (offline + online)
The POS app lives in `pos-app/` and syncs with the backend.

1. Install POS dependencies:
   cd pos-app
   npm install
2. Start the POS app:
   npm start
3. In the POS Settings tab:
   - API Base URL: http://localhost:5500/api
   - POS Sync Token: set to the same value as `POS_SYNC_TOKEN` in `.env`

The POS works offline and will sync new sales and stock changes once back online.

## Deploy online
- Option A (quick): Push repository to GitHub and deploy the `backend` folder on a service like Render (https://render.com) or Railway (https://railway.app). These platforms will run `npm install` and `npm start` automatically.
- Option B (frontend only): Deploy `frontend` on Netlify/Vercel/GitHub Pages and set `API_BASE` in `js/apps.js` to the deployed backend URL.

## Notes
- Payments are mocked for demo by default. You can enable Stripe test mode by setting environment variables (see below).
- This demo uses SQLite for persistence (`backend/data.sqlite`). Use a server-grade database for production.

## Stripe (optional)
To enable Stripe test payments:
1. Create a Stripe account and get test keys.
2. Set environment variables in your deployment (or in your local shell):
   - `STRIPE_SECRET_KEY` (Stripe secret key)
   - `STRIPE_PUBLISHABLE_KEY` (Stripe publishable key)
   - `STRIPE_CURRENCY` (optional, default: `usd`)
3. Restart the backend. The frontend will detect Stripe and show a card checkout powered by Stripe Elements.

Important: For demo, if Stripe is not configured the app falls back to mock payments.

## Admin
A minimal admin UI is available at `/admin.html` to:
- View products and add stock (restock)
- View orders and update order statuses

The admin endpoints require a token header `x-admin-token`. Set the token via environment variable `ADMIN_TOKEN` (default: `admin123` for local testing). Store the token in the admin page to operate.

Admin also supports staff login (manager/cashier). Managers can access products and reports; cashiers can manage orders only.

## POS Sync Token
Set `POS_SYNC_TOKEN` in `.env` at the project root. The POS uses it in the `x-pos-token` header to sync.

## Contact
BSK@L Enterprise — Kasoa Timber Market (Ghana)
Abigail Abam (+233 59 381 0461)
Alexander Segbedzi (+233 55 298 0212)