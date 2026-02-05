# 🚀 BSK@L Enterprise — Production Deployment Guide

## Quick Deploy to Render (Recommended)

**Render** is the easiest option. It's free to start and automatically deploys your backend.

### Steps:
1. **Create Render Account** → https://render.com (sign up with GitHub)
2. **Connect Repository** → Click "New +" → "Web Service" → Connect your GitHub repo
3. **Configure Build & Start Commands:**
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
   - Runtime: Node.js
4. **Set Environment Variables** (in Render dashboard):
   - `PORT=5500`
   - `ADMIN_TOKEN=your_very_secure_token` (change from default!)
   - `STRIPE_PUBLISHABLE_KEY=pk_test_...` (if using Stripe)
   - `STRIPE_SECRET_KEY=sk_test_...` (if using Stripe)
5. **Deploy** → Click "Create Web Service"
6. Open the URL provided (e.g., `https://yourapp.onrender.com`)

**Deployment time:** ~2 minutes  
**Cost:** Free tier available (with 15-min auto-sleep limits)

---

## Deploy to Railway

1. Go to https://railway.app and sign up
2. Create a new project → "Deploy from GitHub"
3. Select your repository
4. Railway auto-detects the Node.js app
5. Add environment variables:
   - `PORT=5500`
   - `ADMIN_TOKEN=secure_token_here`
   - Stripe keys (optional)
6. Deploy and get your live URL

---

## Deploy Frontend Only (Netlify/Vercel)

If you want just the frontend on Netlify/Vercel and backend elsewhere:

1. **Netlify** (https://netlify.com):
   - Deploy the `frontend/` folder
   - Set `API_BASE` in `frontend/js/apps.js` to your backend URL
   - Example: `const API_BASE = 'https://yourbackend.onrender.com/api'`

2. **Vercel** (https://vercel.com):
   - Similar steps, select `frontend/` as build folder

---

## Local Development

```bash
cd backend
npm install
npm start
```

Then open http://localhost:5500 in your browser.

For development with auto-reload:
```bash
npm run dev
```

---

## Important Security Notes ⚠️

### Before Going Live:

1. **Change Admin Token** (`ADMIN_TOKEN` env var)
   - Don't use default `admin123`
   - Use a strong random token

2. **Enable Stripe** (optional but recommended)
   - Sign up at https://stripe.com
   - Get test keys and add to environment
   - Test payments work in live mode

3. **Database**
   - Currently uses SQLite (file-based)
   - For production with many orders, consider PostgreSQL (needs code changes)

4. **CORS**
   - Currently allows all origins
   - Before live: Set specific frontend URL in `backend/index.js`

---

## Testing Your Live Site

1. **Browse Catalog** → Check all products load
2. **Add to Cart** → Test cart functionality
3. **Checkout** → Try mock payment
4. **Admin Panel** → Go to `/admin.html`, enter your admin token, view orders
5. **Track Order** → Use order ID from confirmation

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot find module 'express'" | Run `npm install` in backend folder |
| "Port already in use" | Change `PORT` env var or kill process on port 5500 |
| Frontend doesn't load | Check backend is running and accessible |
| Payment fails | Ensure Stripe keys are correct (test vs live) |
| Admin panel access denied | Check `ADMIN_TOKEN` matches deployed value |

---

## Support

Contact: Abigail Abam (+233 59 381 0461) or Alexander Segbedzi (+233 55 298 0212)

Location: Kasoa Timber Market, Ghana
