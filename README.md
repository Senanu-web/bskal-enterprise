# BSK@L Enterprise — Demo Shop

This is a small demo shop for BSK@L Enterprise (mineral drinks, water, and cold store meats/fishes).

## Features
- Product catalog with stock counts
- Cart, checkout with delivery option
- Mock payment (Card or Mobile Money)
- Order tracking by order id
- Backend (Express) serves frontend for simple deployment

## Run locally
1. Open a terminal and install backend dependencies:
   cd backend
   npm install
2. Start the backend (which also serves the frontend):
   npm start
3. Open http://localhost:5500 in your browser

## Deploy online
- Option A (quick): Push repository to GitHub and deploy the `backend` folder on a service like Render (https://render.com) or Railway (https://railway.app). These platforms will run `npm install` and `npm start` automatically.
- Option B (frontend only): Deploy `frontend` on Netlify/Vercel/GitHub Pages and set `API_BASE` in `js/apps.js` to the deployed backend URL.

## Notes
- Payments are mocked for demo by default. You can enable Stripe test mode by setting environment variables (see below).
- This demo uses in-memory data. Use a database (Postgres/MongoDB) for persistence and concurrency in production.

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

## Contact
BSK@L Enterprise — Kasoa Timber Market (Ghana)
Abigail Abam (+233 59 381 0461)
Alexander Segbedzi (+233 55 298 0212)