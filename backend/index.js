require('dotenv').config()
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const path = require('path')
const db = require('./db')

const app = express()
const port = process.env.PORT || 5500

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null
const STRIPE_CURRENCY = process.env.STRIPE_CURRENCY || 'usd'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_TOKEN

app.use(cors())
app.use(bodyParser.json())

function parseCookies(req) {
  const header = req.headers?.cookie || ''
  return header.split(';').reduce((acc, part) => {
    const trimmed = part.trim()
    if (!trimmed) return acc
    const idx = trimmed.indexOf('=')
    if (idx === -1) return acc
    const key = trimmed.slice(0, idx)
    const value = trimmed.slice(idx + 1)
    acc[key] = decodeURIComponent(value)
    return acc
  }, {})
}

function getAdminCookie(req) {
  const cookies = parseCookies(req)
  return cookies.adminToken || ''
}

function setAdminCookie(res, token, isSecure) {
  const secure = isSecure ? '; Secure' : ''
  res.setHeader('Set-Cookie', `adminToken=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`)
}

function clearAdminCookie(res, isSecure) {
  const secure = isSecure ? '; Secure' : ''
  res.setHeader('Set-Cookie', `adminToken=; Path=/; Max-Age=0; SameSite=Lax${secure}`)
}

function checkAdmin(req, res, next) {
  const headerToken = req.header('x-admin-token') || ''
  const cookieToken = getAdminCookie(req) || ''
  const token = headerToken || cookieToken
  if (token !== ADMIN_TOKEN) {
    if (cookieToken === ADMIN_TOKEN) return next()
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// API
app.get('/api/products', (req, res) => {
  db.getProducts((err, products) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(products || [])
  })
})

app.get('/api/stock/:id', (req, res) => {
  db.getStock(req.params.id, (err, stock) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ stock: stock || 0 })
  })
})

// Stripe configuration for frontend
app.get('/api/stripe-config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null, currency: STRIPE_CURRENCY })
})

app.post('/api/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'Stripe not configured on server' })
    const { items } = req.body
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items provided' })
    
    let total = 0
    let productCheckCount = 0
    
    items.forEach(it => {
      db.getProductById(it.id, (err, p) => {
        productCheckCount++
        if (!p) return res.status(400).json({ error: 'Invalid product in items' })
        total += (Number(it.qty) || 1) * p.price
        
        if (productCheckCount === items.length) {
          const amount = Math.round(total * 100)
          stripe.paymentIntents.create({ amount, currency: STRIPE_CURRENCY }, (err, paymentIntent) => {
            if (err) return res.status(500).json({ error: 'Failed to create payment intent' })
            res.json({ clientSecret: paymentIntent.client_secret, id: paymentIntent.id })
          })
        }
      })
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create payment intent' })
  }
})

app.post('/api/orders', async (req, res) => {
  try {
    const { items, delivery, payment, customer } = req.body
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items in order' })

    let total = 0
    let productCheckCount = 0
    let checkComplete = false

    items.forEach(it => {
      db.getProductById(it.id, (err, p) => {
        productCheckCount++
        if (!p) return res.status(400).json({ error: 'Invalid product in cart' })
        const qty = Number(it.qty) || 1
        if (p.stock < qty) return res.status(400).json({ error: `Not enough stock for ${p.name}` })
        total += qty * p.price

        if (productCheckCount === items.length && !checkComplete) {
          checkComplete = true
          // If card payment via Stripe, verify the PaymentIntent succeeded
          const safePayment = payment && typeof payment === 'object' ? payment : {}
          if (safePayment.method === 'card' && safePayment.stripePaymentIntentId) {
            if (!stripe) return res.status(400).json({ error: 'Stripe not configured on server' })
            stripe.paymentIntents.retrieve(safePayment.stripePaymentIntentId, (err, pi) => {
              if (err || !pi || pi.status !== 'succeeded') return res.status(400).json({ error: 'Card payment not completed' })
              
              db.createOrder({ items, delivery, payment: safePayment, customer, total }, (err, order) => {
                if (err) return res.status(500).json({ error: err.message || 'Server error' })
                res.json({ ok: true, order })
              })
            })
          } else {
            // For demo: non-card flows are mocked.
            safePayment.processed = true
            safePayment.provider = safePayment?.method || 'mock'
            
            db.createOrder({ items, delivery, payment: safePayment, customer, total }, (err, order) => {
              if (err) return res.status(500).json({ error: err.message || 'Failed to create order' })
              res.json({ ok: true, order })
            })
          }
        }
      })
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to place order' })
  }
})

app.get('/api/orders', (req, res) => {
  db.getOrders((err, orders) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(orders || [])
  })
})

app.get('/api/orders/:id', (req, res) => {
  db.getOrderById(req.params.id, (err, o) => {
    if (err || !o) return res.status(404).json({ error: 'Order not found' })
    res.json(o)
  })
})

app.post('/api/orders/:id/location', (req, res) => {
  const { token, lat, lng, accuracy } = req.body || {}
  const orderId = req.params.id
  const parsedLat = Number(lat)
  const parsedLng = Number(lng)

  if (!orderId) return res.status(400).json({ error: 'Missing order id' })
  if (!token) return res.status(401).json({ error: 'Missing tracking token' })
  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
    return res.status(400).json({ error: 'Invalid latitude/longitude' })
  }

  db.updateOrderLocationByToken(orderId, token, { lat: parsedLat, lng: parsedLng, accuracy }, (err, order) => {
    if (err) {
      const code = err.message === 'Invalid tracking token' ? 401 : 400
      return res.status(code).json({ error: err.message })
    }
    res.json({ ok: true, order })
  })
})

// Admin endpoints
app.get('/api/admin/orders', checkAdmin, (req, res) => {
  db.getOrdersForAdmin((err, orders) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(orders || [])
  })
})

app.get('/api/admin/products', checkAdmin, (req, res) => {
  db.getProducts((err, products) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(products || [])
  })
})

app.post('/api/admin/products/:id/restock', checkAdmin, (req, res) => {
  const amount = Number(req.body.amount) || 0
  db.restockProduct(req.params.id, amount, (err, p) => {
    if (err || !p) return res.status(404).json({ error: 'Product not found' })
    res.json({ ok: true, product: p })
  })
})

app.put('/api/admin/products/:id', checkAdmin, (req, res) => {
  const { name, price, cost, stock } = req.body
  const updates = {}
  if (name !== undefined) updates.name = name
  if (price !== undefined) updates.price = Number(price)
  if (cost !== undefined) updates.cost = Number(cost)
  if (stock !== undefined) updates.stock = Number(stock)
  
  db.updateProduct(req.params.id, updates, (err, p) => {
    if (err || !p) return res.status(404).json({ error: err?.message || 'Product not found' })
    res.json({ ok: true, product: p })
  })
})

// Protected order status update
app.post('/api/admin/orders/:id/status', checkAdmin, (req, res) => {
  const { status } = req.body
  db.setOrderStatus(req.params.id, status, (err, o) => {
    if (err || !o) return res.status(404).json({ error: 'Order not found' })
    res.json({ ok: true, order: o })
  })
})

// Create new product
app.post('/api/admin/products', checkAdmin, (req, res) => {
  const { name, price, cost, stock } = req.body
  if (!name || !price || stock === undefined) {
    return res.status(400).json({ error: 'Missing required fields: name, price, stock' })
  }
  db.createProduct({ name, price: Number(price), cost: Number(cost) || 0, stock: Number(stock) }, (err, product) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ ok: true, product })
  })
})

// Get profit/loss report
app.get('/api/admin/profit-loss', checkAdmin, (req, res) => {
  db.getProfitLoss((err, report) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(report)
  })
})

// Get weekly sales report
app.get('/api/admin/weekly-sales', checkAdmin, (req, res) => {
  db.getWeeklySales((err, report) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(report)
  })
})

// Get customer monthly stats for loyalty discounts
app.get('/api/admin/customer-discounts', checkAdmin, (req, res) => {
  db.getCustomerMonthlyStats((err, data) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(data)
  })
})

// Check discount for a specific customer (public endpoint for checkout)
app.get('/api/check-discount/:phone', (req, res) => {
  db.checkCustomerDiscount(req.params.phone, (err, discount) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(discount)
  })
})

// Admin login: sets cookie for /admin.html access
app.post('/admin/login', (req, res) => {
  const username = (req.body?.username || '').trim()
  const password = (req.body?.password || '').trim()
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  if (username && password && username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    setAdminCookie(res, ADMIN_TOKEN, isSecure)
    return res.json({ ok: true })
  }
  return res.status(401).json({ error: 'Unauthorized' })
})

// Admin logout: clears cookie
app.post('/admin/logout', (req, res) => {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  clearAdminCookie(res, isSecure)
  return res.json({ ok: true })
})

// Protect admin page: require admin token, otherwise redirect home
app.get('/admin.html', (req, res) => {
  const tokenFromQuery = (req.query?.token || '').trim()
  const cookieToken = getAdminCookie(req)
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'

  if (tokenFromQuery && tokenFromQuery === ADMIN_TOKEN) {
    setAdminCookie(res, ADMIN_TOKEN, isSecure)
    return res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html'))
  }

  if (cookieToken !== ADMIN_TOKEN) return res.redirect('/admin-login.html')
  return res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html'))
})

// Serve frontend static files for simple deployments
app.use(express.static(path.join(__dirname, '..', 'frontend')))
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')))

// Initialize database and start server
db.init().then(() => {
  app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
