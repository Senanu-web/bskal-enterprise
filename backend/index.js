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

app.use(cors())
app.use(bodyParser.json())

function checkAdmin(req, res, next) {
  const token = req.header('x-admin-token') || ''
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' })
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
          if (payment && payment.method === 'card' && payment.stripePaymentIntentId) {
            if (!stripe) return res.status(400).json({ error: 'Stripe not configured on server' })
            stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, (err, pi) => {
              if (err || !pi || pi.status !== 'succeeded') return res.status(400).json({ error: 'Card payment not completed' })
              
              db.createOrder({ items, delivery, payment, customer, total }, (err, order) => {
                if (err) return res.status(500).json({ error: err.message || 'Server error' })
                res.json({ ok: true, order })
              })
            })
          } else {
            // For demo: non-card flows are mocked.
            payment.processed = true
            payment.provider = payment?.method || 'mock'
            
            db.createOrder({ items, delivery, payment, customer, total }, (err, order) => {
              if (err) return res.status(500).json({ error: err.message || 'Server error' })
              res.json({ ok: true, order })
            })
          }
        }
      })
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Server error' })
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

// Admin endpoints
app.get('/api/admin/orders', checkAdmin, (req, res) => {
  db.getOrders((err, orders) => {
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
