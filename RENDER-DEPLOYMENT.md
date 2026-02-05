# Deploy Your Website to Render (FREE)

## What Customers Will Type
After deployment, your customers will visit:
**`https://bskal-enterprise.onrender.com`**
(or your custom URL if you choose a different name)

---

## Step 1: Push Code to GitHub

1. **Create a GitHub account** (if you don't have one):
   - Go to https://github.com/signup
   - Sign up with your email

2. **Create a new repository**:
   - Click the **"+"** icon → **"New repository"**
   - Name it: `bskal-enterprise` (or any name you like)
   - Make it **Public** (required for free deployment)
   - Click **"Create repository"**

3. **Push your code to GitHub**:
   ```powershell
   cd "c:\BSK@L ENTERPRISE"
   
   # Initialize git (if not already done)
   git init
   
   # Add all files
   git add .
   
   # Commit your code
   git commit -m "Initial commit - BSK@L Enterprise website"
   
   # Add your GitHub repository (REPLACE with your actual URL)
   git remote add origin https://github.com/YOUR_USERNAME/bskal-enterprise.git
   
   # Push to GitHub
   git push -u origin main
   ```
   
   **Note:** If you get an error about "main" branch, try:
   ```powershell
   git branch -M main
   git push -u origin main
   ```

---

## Step 2: Deploy on Render

1. **Create a Render account**:
   - Go to https://render.com
   - Click **"Get Started"** or **"Sign Up"**
   - Sign up with your **GitHub account** (easiest option)

2. **Create a new Web Service**:
   - Click **"New +"** → **"Web Service"**
   - Connect your GitHub repository: `bskal-enterprise`
   - Click **"Connect"**

3. **Configure your deployment**:
   Fill in these settings:
   
   - **Name:** `bskal-enterprise` (this becomes your URL)
   - **Region:** Choose closest to Ghana (e.g., Frankfurt)
   - **Branch:** `main`
   - **Root Directory:** Leave blank
   - **Runtime:** `Node`
   - **Build Command:** `cd backend && npm install`
   - **Start Command:** `cd backend && node index.js`
   - **Plan:** **Free** (select this!)

4. **Add Environment Variables**:
   Scroll down to **"Environment Variables"** and add:
   
   | Key | Value |
   |-----|-------|
   | `PORT` | `5500` |
   | `ADMIN_TOKEN` | `admin123` (or change to something secure) |
   | `STRIPE_PUBLISHABLE_KEY` | `pk_test_YOUR_KEY` |
   | `STRIPE_SECRET_KEY` | `sk_test_YOUR_KEY` |
   | `NODE_VERSION` | `24.13.0` |

5. **Click "Create Web Service"**

6. **Wait for deployment** (2-5 minutes):
   - Render will install dependencies and start your server
   - Watch the logs for any errors
   - When you see "Server running on port 5500", it's ready!

---

## Step 3: Access Your Website

Your website is now live at:
**`https://bskal-enterprise.onrender.com`**

Share this link with your customers! 🎉

---

## Step 4: Test Everything

Visit your website and test:
- ✅ Products load (beverages & meats)
- ✅ Add items to cart
- ✅ Checkout with mobile money
- ✅ View receipt
- ✅ Track order by order ID
- ✅ View "My Orders" with phone number

---

## Important Notes

### Free Tier Limitations:
- ⚠️ **Server sleeps after 15 minutes of inactivity**
  - First visit after sleep takes 30-60 seconds to wake up
  - Subsequent visits are instant
  - This is normal for free tier!

- 💰 **Upgrade to Paid ($7/month)** to avoid sleep:
  - If your business grows, consider upgrading
  - Paid tier keeps server always awake

### Custom Domain (Optional):
If you want **www.bskalenterprise.com** instead:
1. Buy a domain from Namecheap/GoDaddy (~$10/year)
2. In Render dashboard → Settings → Custom Domains
3. Add your domain and follow DNS instructions

---

## Troubleshooting

### "Application failed to respond"
- Check Render logs for errors
- Verify environment variables are set correctly
- Make sure PORT is 5500

### Products not showing:
- Check browser console (F12) for errors
- Verify API calls are going to correct URL
- Database might need initialization (should auto-create)

### Orders not saving:
- Check database file permissions
- Verify `data.sqlite` is being created in backend folder
- Check Render logs for database errors

---

## Update Your Website

To make changes after deployment:

```powershell
# Make your code changes, then:
cd "c:\BSK@L ENTERPRISE"
git add .
git commit -m "Description of your changes"
git push

# Render automatically redeploys! (1-2 minutes)
```

---

## Customer Instructions

### How to Share with Customers:

**WhatsApp Message:**
```
🛒 Shop at BSK@L Enterprise!

Order beverages, meats, and fish online:
👉 https://bskal-enterprise.onrender.com

📱 Pay with MTN/Vodafone Mobile Money
🚚 Same-day delivery available
📦 Track your orders anytime

Contact: +233 55 298 0212 (Alexander)
```

**Poster/Flyer:**
```
BSK@L ENTERPRISE
Premium Beverages & Fresh Meats

🌐 Order Online:
bskal-enterprise.onrender.com

📞 Call: +233 55 298 0212
```

---

## Success Checklist

Before sharing with customers:

- [ ] Website loads without errors
- [ ] All products visible with prices
- [ ] Cart adds/removes items correctly
- [ ] Checkout accepts mobile money details
- [ ] Receipt shows delivery date
- [ ] "My Orders" finds orders by phone number
- [ ] Track Order works with order ID
- [ ] Admin panel accessible at /admin.html
- [ ] Mobile responsive (test on phone)

---

## Support

Need help? Common resources:
- **Render Docs:** https://docs.render.com
- **Render Status:** https://status.render.com
- **GitHub Issues:** Check your repository issues tab

---

**Your website is professional and ready for customers! 🎉**
