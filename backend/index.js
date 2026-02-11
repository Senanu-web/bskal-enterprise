const dotenv = require('dotenv')
dotenv.config({ path: require('path').join(__dirname, '..', '.env') })
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const path = require('path')
const multer = require('multer')
const XLSX = require('xlsx')
const db = require('./db')

const app = express()
const port = process.env.PORT || 5500

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null
const STRIPE_CURRENCY = process.env.STRIPE_CURRENCY || 'usd'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'Senanu123'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Senanu'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_TOKEN
const POS_SYNC_TOKEN = process.env.POS_SYNC_TOKEN || ADMIN_TOKEN
const STAFF_TOKEN_SECRET = process.env.STAFF_TOKEN_SECRET || 'change_me_staff_secret'
const POS_DOWNLOAD_TOKEN = process.env.POS_DOWNLOAD_TOKEN || ''

app.use(cors())
app.use(bodyParser.json())

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
})

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

function checkPos(req, res, next) {
  const token = req.header('x-pos-token') || ''
  if (!token || token !== POS_SYNC_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

function checkDownloadToken(req, res, next) {
  const token = req.header('x-download-token') || req.query?.token || ''
  if (!POS_DOWNLOAD_TOKEN || token !== POS_DOWNLOAD_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = require('crypto').createHmac('sha256', STAFF_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${header}.${body}.${signature}`
}

function verifyToken(token) {
  const parts = (token || '').split('.')
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  const expected = require('crypto').createHmac('sha256', STAFF_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  if (expected !== signature) return null
  const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf-8'))
  if (payload.exp && Date.now() > payload.exp) return null
  return payload
}

function checkStaff(requiredRoles = []) {
  return (req, res, next) => {
    const header = req.header('x-staff-token') || req.header('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : header
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Unauthorized' })
    if (requiredRoles.length > 0 && !requiredRoles.includes(payload.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    req.staff = payload
    next()
  }
}

function checkStaffOrAdmin(requiredRoles = []) {
  return (req, res, next) => {
    const headerToken = req.header('x-admin-token') || ''
    const cookieToken = getAdminCookie(req) || ''
    const token = headerToken || cookieToken
    if (token === ADMIN_TOKEN) return next()
    return checkStaff(requiredRoles)(req, res, next)
  }
}

function hashPassword(password, salt) {
  return require('crypto').pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase()
}

function parseNumeric(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = String(value).trim()
  if (!raw) return null
  let cleaned = raw.replace(/\s/g, '')
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.')
  } else if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '')
  }
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function parseImportFile(file) {
  const workbook = XLSX.read(file.buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { error: 'No sheet found in file' }
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!rows || rows.length === 0) return { error: 'File is empty' }

  const header = rows[0].map(normalizeHeader)
  const findIndex = (aliases) => header.findIndex(h => aliases.includes(h))

  const nameIdx = findIndex(['item name', 'product name', 'name', 'item'])
  const priceIdx = findIndex(['selling price', 'sell price', 'price', 'selling'])
  const costIdx = findIndex(['cost price', 'cost', 'costprice'])
  const stockIdx = findIndex(['stock', 'qty', 'quantity', 'inventory'])
  const barcodeIdx = findIndex(['barcode', 'barcode id', 'barcode_id'])
  const departmentIdx = findIndex(['department', 'category'])

  if (nameIdx === -1) return { error: 'Missing required column: Item Name' }
  if (priceIdx === -1) return { error: 'Missing required column: Selling Price' }

  const items = []
  const errors = []

  for (let i = 1; i < rows.length; i += 1) {
    const rowNumber = i + 1
    const row = rows[i] || []
    const name = String(row[nameIdx] || '').trim()
    if (!name) continue

    const price = parseNumeric(row[priceIdx])
    const cost = costIdx !== -1 ? parseNumeric(row[costIdx]) : null
    const stock = stockIdx !== -1 ? parseNumeric(row[stockIdx]) : null
    const barcode = barcodeIdx !== -1 ? String(row[barcodeIdx] || '').trim() : undefined
    const department = departmentIdx !== -1 ? String(row[departmentIdx] || '').trim() : undefined

    if (price === null) {
      errors.push({ row: rowNumber, name, error: 'Invalid selling price' })
      continue
    }

    items.push({ row: rowNumber, name, price, cost, stock, barcode, department })
  }

  return { items, errors }
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

// POS sync endpoint (offline/online)
app.post('/api/pos/sync', checkPos, (req, res) => {
  const payload = req.body || {}
  const since = payload.since || null
  const changes = Array.isArray(payload.changes) ? payload.changes : []

  const applied = []
  const applyChange = (index) => {
    if (index >= changes.length) return finishSync()
    const change = changes[index] || {}
    const changeId = change.changeId || null

    const markApplied = (status, data, error) => {
      applied.push({ changeId, type: change.type || 'unknown', status, data, error })
      applyChange(index + 1)
    }

    if (change.type === 'order:create') {
      const payload = change.payload || {}
      return db.createOrderFromPos(payload, (err, order) => {
        if (err) return markApplied('failed', null, err.message)
        db.addAuditLog({
          actorType: 'pos',
          actorId: payload.staff?.name || 'pos',
          actorName: payload.staff?.name || 'POS',
          action: 'order.create',
          targetType: 'order',
          targetId: String(order.id),
          meta: { source: 'pos', externalId: order.externalId },
          branchId: order.branchId,
          branchName: order.branchName
        }, () => {})
        return markApplied('ok', { orderId: order.id, externalId: order.externalId }, null)
      })
    }

    if (change.type === 'order:status') {
      const payload = change.payload || {}
      if (!payload.status) return markApplied('failed', null, 'Missing status')
      if (payload.id) {
        return db.setOrderStatus(payload.id, payload.status, (err, order) => {
          if (err) return markApplied('failed', null, err.message)
          db.addAuditLog({
            actorType: 'pos',
            actorId: payload.source || 'pos',
            actorName: payload.source || 'POS',
            action: 'order.status',
            targetType: 'order',
            targetId: String(order.id),
            meta: { status: order.status },
            branchId: order.branchId,
            branchName: order.branchName
          }, () => {})
          return markApplied('ok', { orderId: order.id, status: order.status }, null)
        })
      }
      if (payload.externalId && payload.source) {
        return db.setOrderStatusByExternalId(payload.source, payload.externalId, payload.status, (err, order) => {
          if (err) return markApplied('failed', null, err.message)
          db.addAuditLog({
            actorType: 'pos',
            actorId: payload.source || 'pos',
            actorName: payload.source || 'POS',
            action: 'order.status',
            targetType: 'order',
            targetId: String(order?.id || ''),
            meta: { status: order?.status, externalId: payload.externalId },
            branchId: order?.branchId,
            branchName: order?.branchName
          }, () => {})
          return markApplied('ok', { orderId: order?.id, status: order?.status, externalId: payload.externalId }, null)
        })
      }
      return markApplied('failed', null, 'Missing order id or externalId')
    }

    if (change.type === 'product:update') {
      const payload = change.payload || {}
      if (!payload.id) return markApplied('failed', null, 'Missing product id')
      return db.updateProductFromPos(payload, (err, product) => {
        if (err) return markApplied('failed', null, err.message)
        db.addAuditLog({
          actorType: 'pos',
          actorId: 'pos',
          actorName: 'POS',
          action: 'product.update',
          targetType: 'product',
          targetId: String(product.id),
          meta: { skipped: product.skipped || false }
        }, () => {})
        return markApplied('ok', { productId: product.id, skipped: product.skipped || false }, null)
      })
    }

    if (change.type === 'stock:adjust') {
      const payload = change.payload || {}
      if (!payload.id || payload.amount === undefined) return markApplied('failed', null, 'Missing stock adjustment')
      return db.adjustProductStock(payload.id, Number(payload.amount), (err, product) => {
        if (err) return markApplied('failed', null, err.message)
        db.addAuditLog({
          actorType: 'pos',
          actorId: 'pos',
          actorName: 'POS',
          action: 'stock.adjust',
          targetType: 'product',
          targetId: String(product.id),
          meta: { amount: Number(payload.amount) }
        }, () => {})
        return markApplied('ok', { productId: product.id, stock: product.stock }, null)
      })
    }

    if (change.type === 'order:return') {
      const payload = change.payload || {}
      if (payload.id) {
        return db.returnOrder(payload.id, (err, order) => {
          if (err) return markApplied('failed', null, err.message)
          db.addAuditLog({
            actorType: 'pos',
            actorId: 'pos',
            actorName: 'POS',
            action: 'order.return',
            targetType: 'order',
            targetId: String(order.id),
            meta: { status: order.status },
            branchId: order.branchId,
            branchName: order.branchName
          }, () => {})
          return markApplied('ok', { orderId: order.id, status: order.status }, null)
        })
      }
      if (payload.externalId && payload.source) {
        return db.getOrderByExternalId(payload.source, payload.externalId, (err, order) => {
          if (err) return markApplied('failed', null, err.message)
          if (!order) return markApplied('failed', null, 'Order not found')
          return db.returnOrder(order.id, (retErr, returned) => {
            if (retErr) return markApplied('failed', null, retErr.message)
            db.addAuditLog({
              actorType: 'pos',
              actorId: payload.source || 'pos',
              actorName: payload.source || 'POS',
              action: 'order.return',
              targetType: 'order',
              targetId: String(returned.id),
              meta: { status: returned.status },
              branchId: returned.branchId,
              branchName: returned.branchName
            }, () => {})
            return markApplied('ok', { orderId: returned.id, status: returned.status }, null)
          })
        })
      }
      return markApplied('failed', null, 'Missing order id or externalId')
    }

    return markApplied('skipped', null, 'Unknown change type')
  }

  function finishSync() {
    const serverTime = new Date().toISOString()
    db.getProductsUpdatedSince(since, (prodErr, products) => {
      if (prodErr) return res.status(500).json({ error: prodErr.message })
      db.getOrdersUpdatedSince(since, (orderErr, orders) => {
        if (orderErr) return res.status(500).json({ error: orderErr.message })
        db.getProfitLoss((plErr, profitLoss) => {
          if (plErr) return res.status(500).json({ error: plErr.message })
          db.getWeeklySales((wsErr, weeklySales) => {
            if (wsErr) return res.status(500).json({ error: wsErr.message })
            db.getCustomerMonthlyStats((csErr, customerDiscounts) => {
              if (csErr) return res.status(500).json({ error: csErr.message })
              return res.json({
                ok: true,
                serverTime,
                applied,
                snapshot: {
                  products,
                  orders,
                  reports: { profitLoss, weeklySales, customerDiscounts }
                }
              })
            })
          })
        })
      })
    })
  }

  applyChange(0)
})

// Staff authentication
app.post('/api/staff/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' })
  db.getStaffCount((countErr, count) => {
    if (countErr) return res.status(500).json({ error: countErr.message })
    if (!count) return res.status(409).json({ error: 'No staff configured', code: 'no_staff' })
    db.getStaffByUsername(username, (err, staff) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!staff || !staff.active) return res.status(401).json({ error: 'Unauthorized' })
      const hashed = hashPassword(password, staff.salt)
      if (hashed !== staff.passwordHash) return res.status(401).json({ error: 'Unauthorized' })
      const token = signToken({
        id: staff.id,
        name: staff.name,
        username: staff.username,
        role: staff.role,
        exp: Date.now() + 12 * 60 * 60 * 1000
      })
      db.addAuditLog({ actorType: 'staff', actorId: String(staff.id), actorName: staff.name, action: 'staff.login' }, () => {})
      res.json({ ok: true, token, staff: { id: staff.id, name: staff.name, username: staff.username, role: staff.role } })
    })
  })
})

app.post('/api/staff/bootstrap', (req, res) => {
  const { name, username, password } = req.body || {}
  if (!name || !username || !password) return res.status(400).json({ error: 'Missing fields' })
  db.getStaffCount((countErr, count) => {
    if (countErr) return res.status(500).json({ error: countErr.message })
    if (count > 0) return res.status(403).json({ error: 'Staff already configured' })
    const salt = require('crypto').randomBytes(16).toString('hex')
    const passwordHash = hashPassword(password, salt)
    db.createStaff({ name, username, role: 'manager', passwordHash, salt }, (err, staff) => {
      if (err) return res.status(500).json({ error: err.message })
      db.addAuditLog({ actorType: 'system', actorId: 'bootstrap', actorName: name, action: 'staff.bootstrap', targetType: 'staff', targetId: String(staff.id) }, () => {})
      res.json({ ok: true, staff })
    })
  })
})

app.get('/api/staff/me', checkStaff(), (req, res) => {
  res.json({ ok: true, staff: req.staff })
})

app.get('/api/staff', checkStaffOrAdmin(['manager']), (req, res) => {
  db.listStaff((err, staff) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(staff || [])
  })
})

app.get('/api/branches', checkStaffOrAdmin([]), (req, res) => {
  db.listBranches((err, branches) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(branches || [])
  })
})

app.post('/api/branches', checkStaffOrAdmin(['manager']), (req, res) => {
  const { name, location } = req.body || {}
  if (!name) return res.status(400).json({ error: 'Missing branch name' })
  db.createBranch({ name, location }, (err, branch) => {
    if (err) return res.status(500).json({ error: err.message })
    db.addAuditLog({
      actorType: 'staff',
      actorId: req.staff?.id,
      actorName: req.staff?.name,
      action: 'branch.create',
      targetType: 'branch',
      targetId: String(branch.id),
      branchId: branch.id,
      branchName: branch.name
    }, () => {})
    res.json({ ok: true, branch })
  })
})

app.post('/api/staff', checkStaffOrAdmin(['manager']), (req, res) => {
  const { name, username, role, password } = req.body || {}
  if (!name || !username || !role || !password) return res.status(400).json({ error: 'Missing fields' })
  const salt = require('crypto').randomBytes(16).toString('hex')
  const passwordHash = hashPassword(password, salt)
  db.createStaff({ name, username, role, passwordHash, salt }, (err, staff) => {
    if (err) return res.status(500).json({ error: err.message })
    db.addAuditLog({ actorType: 'staff', actorId: req.staff?.id, actorName: req.staff?.name, action: 'staff.create', targetType: 'staff', targetId: String(staff.id) }, () => {})
    res.json({ ok: true, staff })
  })
})

app.put('/api/staff/:id/role', checkStaffOrAdmin(['manager']), (req, res) => {
  const { role } = req.body || {}
  if (!role) return res.status(400).json({ error: 'Missing role' })
  db.setStaffRole(req.params.id, role, (err) => {
    if (err) return res.status(500).json({ error: err.message })
    db.addAuditLog({ actorType: 'staff', actorId: req.staff?.id, actorName: req.staff?.name, action: 'staff.role', targetType: 'staff', targetId: String(req.params.id), meta: { role } }, () => {})
    res.json({ ok: true })
  })
})

app.put('/api/staff/:id/active', checkStaffOrAdmin(['manager']), (req, res) => {
  const { active } = req.body || {}
  db.setStaffActive(req.params.id, Boolean(active), (err) => {
    if (err) return res.status(500).json({ error: err.message })
    db.addAuditLog({ actorType: 'staff', actorId: req.staff?.id, actorName: req.staff?.name, action: 'staff.active', targetType: 'staff', targetId: String(req.params.id), meta: { active: Boolean(active) } }, () => {})
    res.json({ ok: true })
  })
})

// Shift management
app.post('/api/pos/shifts/open', checkStaff(), (req, res) => {
  const openingCash = Number(req.body?.openingCash || 0)
  const branchId = req.body?.branchId ? Number(req.body.branchId) : null
  db.getOpenShiftForStaff(req.staff.id, (err, openShift) => {
    if (err) return res.status(500).json({ error: err.message })
    if (openShift) return res.status(400).json({ error: 'Shift already open' })
    const createShiftWithBranch = (branch) => {
      db.createShift({ staffId: req.staff.id, staffName: req.staff.name, openingCash, branchId: branch?.id || null, branchName: branch?.name || null }, (createErr, shift) => {
        if (createErr) return res.status(500).json({ error: createErr.message })
        db.addAuditLog({ actorType: 'staff', actorId: req.staff.id, actorName: req.staff.name, action: 'shift.open', targetType: 'shift', targetId: String(shift.id), branchId: shift.branchId, branchName: shift.branchName }, () => {})
        res.json({ ok: true, shift })
      })
    }
    if (branchId) {
      return db.getBranchById(branchId, (branchErr, branch) => {
        if (branchErr) return res.status(500).json({ error: branchErr.message })
        return createShiftWithBranch(branch)
      })
    }
    return db.getDefaultBranch((defErr, branch) => {
      if (defErr) return res.status(500).json({ error: defErr.message })
      return createShiftWithBranch(branch)
    })
  })
})

app.get('/api/pos/shifts/current', checkStaff(), (req, res) => {
  db.getOpenShiftForStaff(req.staff.id, (err, openShift) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ ok: true, shift: openShift })
  })
})

app.post('/api/pos/shifts/:id/cash-movement', checkStaff(), (req, res) => {
  const { type, amount, reason } = req.body || {}
  if (!['in', 'out'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  const amt = Number(amount)
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' })
  db.getShiftById(Number(req.params.id), (shiftErr, shift) => {
    if (shiftErr) return res.status(500).json({ error: shiftErr.message })
    db.addCashMovement({ shiftId: Number(req.params.id), staffId: req.staff.id, type, amount: amt, reason, branchId: shift?.branchId, branchName: shift?.branchName }, (err) => {
      if (err) return res.status(500).json({ error: err.message })
      db.addAuditLog({ actorType: 'staff', actorId: req.staff.id, actorName: req.staff.name, action: 'cash.movement', targetType: 'shift', targetId: String(req.params.id), meta: { type, amount: amt }, branchId: shift?.branchId, branchName: shift?.branchName }, () => {})
      res.json({ ok: true })
    })
  })
})

app.post('/api/pos/shifts/:id/close', checkStaff(), (req, res) => {
  const closingCash = Number(req.body?.closingCash || 0)
  const shiftId = Number(req.params.id)
  db.getShiftById(shiftId, (err, shift) => {
    if (err) return res.status(500).json({ error: err.message })
    if (!shift) return res.status(404).json({ error: 'Shift not found' })
    if (shift.status !== 'open') return res.status(400).json({ error: 'Shift already closed' })
    if (req.staff.role !== 'manager' && Number(shift.staffId) !== Number(req.staff.id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const endTime = new Date().toISOString()
    db.getOrderTotalsBetween(shift.openedAt, endTime, shift.branchId || null, (totErr, totals) => {
      if (totErr) return res.status(500).json({ error: totErr.message })
      db.getCashMovementsByShift(shiftId, (movErr, movements) => {
        if (movErr) return res.status(500).json({ error: movErr.message })
        const cashIn = movements.filter(m => m.type === 'in').reduce((s, m) => s + Number(m.amount || 0), 0)
        const cashOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + Number(m.amount || 0), 0)
        const expectedCash = Number(shift.openingCash) + totals.cashSales - totals.cashRefunds + cashIn - cashOut
        const variance = closingCash - expectedCash
        db.closeShift({ shiftId, closingCash, expectedCash, variance }, (closeErr) => {
          if (closeErr) return res.status(500).json({ error: closeErr.message })
          db.addAuditLog({ actorType: 'staff', actorId: req.staff.id, actorName: req.staff.name, action: 'shift.close', targetType: 'shift', targetId: String(shiftId), meta: { expectedCash, variance } }, () => {})
          res.json({ ok: true, shift: { ...shift, closingCash, expectedCash, variance, closedAt: endTime, status: 'closed' }, totals, cashIn, cashOut })
        })
      })
    })
  })
})

app.get('/api/pos/shifts/:id/summary', checkStaff(), (req, res) => {
  const shiftId = Number(req.params.id)
  db.getShiftById(shiftId, (err, shift) => {
    if (err) return res.status(500).json({ error: err.message })
    if (!shift) return res.status(404).json({ error: 'Shift not found' })
    db.getCashMovementsByShift(shiftId, (movErr, movements) => {
      if (movErr) return res.status(500).json({ error: movErr.message })
      db.getOrderTotalsBetween(shift.openedAt, shift.closedAt || new Date().toISOString(), shift.branchId || null, (totErr, totals) => {
        if (totErr) return res.status(500).json({ error: totErr.message })
        res.json({ ok: true, shift, totals, movements })
      })
    })
  })
})

app.get('/api/pos/reconciliation', checkStaffOrAdmin(['manager']), (req, res) => {
  const date = (req.query?.date || '').trim()
  if (!date) return res.status(400).json({ error: 'Missing date' })
  const start = new Date(`${date}T00:00:00.000Z`).toISOString()
  const end = new Date(`${date}T23:59:59.999Z`).toISOString()
  const branchId = req.query?.branchId ? Number(req.query.branchId) : null
  db.getOrderTotalsBetween(start, end, branchId, (err, totals) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ ok: true, date, totals })
  })
})

app.get('/api/pos/performance', checkStaffOrAdmin(['manager']), (req, res) => {
  const start = (req.query?.start || '').trim()
  const end = (req.query?.end || '').trim()
  if (!start || !end) return res.status(400).json({ error: 'Missing date range' })
  const branchId = req.query?.branchId ? Number(req.query.branchId) : null
  db.getStaffPerformance(start, end, branchId, (err, performance) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ ok: true, performance })
  })
})

// Admin endpoints
app.get('/api/admin/orders', checkStaffOrAdmin(['manager', 'cashier']), (req, res) => {
  db.getOrdersForAdmin((err, orders) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(orders || [])
  })
})

app.get('/api/admin/products', checkStaffOrAdmin(['manager']), (req, res) => {
  db.getProducts((err, products) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(products || [])
  })
})

app.post('/api/admin/products/:id/restock', checkStaffOrAdmin(['manager']), (req, res) => {
  const amount = Number(req.body.amount) || 0
  db.restockProduct(req.params.id, amount, (err, p) => {
    if (err || !p) return res.status(404).json({ error: 'Product not found' })
    db.addAuditLog({
      actorType: 'admin',
      actorId: ADMIN_USERNAME,
      actorName: 'admin',
      action: 'product.restock',
      targetType: 'product',
      targetId: String(p.id),
      meta: { amount }
    }, () => {})
    res.json({ ok: true, product: p })
  })
})

app.put('/api/admin/products/:id', checkStaffOrAdmin(['manager']), (req, res) => {
  const { name, price, cost, stock, barcode } = req.body
  const updates = {}
  if (name !== undefined) updates.name = name
  if (price !== undefined) updates.price = Number(price)
  if (cost !== undefined) updates.cost = Number(cost)
  if (stock !== undefined) updates.stock = Number(stock)
  if (barcode !== undefined) updates.barcode = barcode
  
  db.updateProduct(req.params.id, updates, (err, p) => {
    if (err || !p) return res.status(404).json({ error: err?.message || 'Product not found' })
    db.addAuditLog({
      actorType: 'admin',
      actorId: ADMIN_USERNAME,
      actorName: 'admin',
      action: 'product.update',
      targetType: 'product',
      targetId: String(p.id)
    }, () => {})
    res.json({ ok: true, product: p })
  })
})

// Protected order status update
app.post('/api/admin/orders/:id/status', checkStaffOrAdmin(['manager', 'cashier']), (req, res) => {
  const { status } = req.body
  const allowed = ['Placed', 'Processing', 'Dispatched', 'Delivered', 'Cancelled', 'Returned']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })

  if (status === 'Cancelled') {
    return db.cancelOrder(req.params.id, (err, o) => {
      if (err || !o) return res.status(404).json({ error: err?.message || 'Order not found' })
      db.addAuditLog({
        actorType: 'admin',
        actorId: ADMIN_USERNAME,
        actorName: 'admin',
        action: 'order.cancel',
        targetType: 'order',
        targetId: String(o.id)
      }, () => {})
      res.json({ ok: true, order: o })
    })
  }

  if (status === 'Returned') {
    return db.returnOrder(req.params.id, (err, o) => {
      if (err || !o) return res.status(404).json({ error: err?.message || 'Order not found' })
      db.addAuditLog({
        actorType: 'admin',
        actorId: ADMIN_USERNAME,
        actorName: 'admin',
        action: 'order.return',
        targetType: 'order',
        targetId: String(o.id)
      }, () => {})
      res.json({ ok: true, order: o })
    })
  }

  db.setOrderStatus(req.params.id, status, (err, o) => {
    if (err || !o) return res.status(404).json({ error: 'Order not found' })
    db.addAuditLog({
      actorType: 'admin',
      actorId: ADMIN_USERNAME,
      actorName: 'admin',
      action: 'order.status',
      targetType: 'order',
      targetId: String(o.id),
      meta: { status: o.status }
    }, () => {})
    res.json({ ok: true, order: o })
  })
})

app.post('/api/orders/:id/cancel', (req, res) => {
  const { phone } = req.body || {}
  if (!phone) return res.status(400).json({ error: 'Phone is required' })
  db.getOrderById(req.params.id, (err, o) => {
    if (err || !o) return res.status(404).json({ error: 'Order not found' })
    const createdAt = o.createdAt ? new Date(o.createdAt).getTime() : 0
    const now = Date.now()
    const cancelWindowMs = 15 * 60 * 1000
    if (!createdAt || now - createdAt > cancelWindowMs) {
      return res.status(400).json({ error: 'Cancellation not allowed after 15 minutes' })
    }
    const orderPhone = (o.customer?.phone || '').replace(/\s/g, '')
    const providedPhone = String(phone).replace(/\s/g, '')
    if (!orderPhone || orderPhone !== providedPhone) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    db.cancelOrder(req.params.id, (cancelErr, updated) => {
      if (cancelErr || !updated) return res.status(400).json({ error: cancelErr?.message || 'Cancel failed' })
      res.json({ ok: true, order: updated })
    })
  })
})

app.post('/api/orders/:id/driver-cancel', (req, res) => {
  const { token } = req.body || {}
  if (!token) return res.status(401).json({ error: 'Missing tracking token' })
  db.verifyTrackingToken(req.params.id, token, (err) => {
    if (err) return res.status(401).json({ error: err.message })
    db.cancelOrder(req.params.id, (cancelErr, updated) => {
      if (cancelErr || !updated) return res.status(400).json({ error: cancelErr?.message || 'Cancel failed' })
      res.json({ ok: true, order: updated })
    })
  })
})

// Create new product
app.post('/api/admin/products', checkStaffOrAdmin(['manager']), (req, res) => {
  const { name, price, cost, stock, barcode } = req.body
  if (!name || !price || stock === undefined) {
    return res.status(400).json({ error: 'Missing required fields: name, price, stock' })
  }
  db.createProduct({ name, price: Number(price), cost: Number(cost) || 0, stock: Number(stock), barcode }, (err, product) => {
    if (err) return res.status(500).json({ error: err.message })
    db.addAuditLog({
      actorType: 'admin',
      actorId: ADMIN_USERNAME,
      actorName: 'admin',
      action: 'product.create',
      targetType: 'product',
      targetId: String(product.id)
    }, () => {})
    res.json({ ok: true, product })
  })
})

// Bulk import products (CSV/Excel)
app.post('/api/admin/products/import', checkStaffOrAdmin(['manager']), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing file upload' })
  const parsed = parseImportFile(req.file)
  if (parsed.error) return res.status(400).json({ error: parsed.error })

  const items = parsed.items || []
  const parseErrors = parsed.errors || []
  if (items.length === 0 && parseErrors.length > 0) {
    return res.status(400).json({ error: 'No valid rows found', errors: parseErrors })
  }

  const mode = (req.query?.mode || '').trim().toLowerCase()
  const summary = {
    created: 0,
    updated: 0,
    skipped: 0,
    replaced: 0,
    mode: mode === 'replace' ? 'replace' : 'merge',
    errors: [...parseErrors]
  }

  if (mode === 'replace') {
    const cleaned = items.map(item => ({
      name: item.name,
      price: item.price,
      cost: item.cost !== null && item.cost !== undefined ? item.cost : 0,
      stock: item.stock !== null && item.stock !== undefined ? item.stock : 0,
      barcode: null
    }))

    return db.replaceProducts(cleaned, (err, result) => {
      if (err) return res.status(500).json({ error: err.message || 'Replace failed' })
      summary.replaced = result?.inserted || cleaned.length
      db.addAuditLog({
        actorType: 'staff',
        actorId: req.staff?.id || ADMIN_USERNAME,
        actorName: req.staff?.name || 'admin',
        action: 'product.replace',
        targetType: 'product',
        targetId: null,
        meta: { replaced: summary.replaced, errors: summary.errors.length }
      }, () => {})
      return res.json({ ok: true, summary })
    })
  }

  const processNext = (index) => {
    if (index >= items.length) {
      db.addAuditLog({
        actorType: 'staff',
        actorId: req.staff?.id || ADMIN_USERNAME,
        actorName: req.staff?.name || 'admin',
        action: 'product.import',
        targetType: 'product',
        targetId: null,
        meta: { created: summary.created, updated: summary.updated, skipped: summary.skipped, errors: summary.errors.length }
      }, () => {})
      return res.json({ ok: true, summary })
    }

    const item = items[index]
    db.upsertProductByName({
      name: item.name,
      price: item.price,
      cost: item.cost !== null && item.cost !== undefined ? item.cost : undefined,
      stock: item.stock !== null && item.stock !== undefined ? item.stock : undefined,
      barcode: item.barcode
    }, (err, result) => {
      if (err) {
        summary.errors.push({ row: item.row, name: item.name, error: err.message })
      } else if (result?.action === 'created') {
        summary.created += 1
      } else if (result?.action === 'updated') {
        summary.updated += 1
      } else {
        summary.skipped += 1
      }
      processNext(index + 1)
    })
  }

  processNext(0)
})

// Get profit/loss report
app.get('/api/admin/profit-loss', checkStaffOrAdmin(['manager']), (req, res) => {
  db.getProfitLoss((err, report) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(report)
  })
})

// Get weekly sales report
app.get('/api/admin/weekly-sales', checkStaffOrAdmin(['manager']), (req, res) => {
  db.getWeeklySales((err, report) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(report)
  })
})

// Get customer monthly stats for loyalty discounts
app.get('/api/admin/customer-discounts', checkStaffOrAdmin(['manager']), (req, res) => {
  db.getCustomerMonthlyStats((err, data) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(data)
  })
})

app.get('/api/admin/audit', checkStaffOrAdmin(['manager']), (req, res) => {
  const limit = Number(req.query?.limit || 100)
  db.getAuditLog(limit, (err, logs) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(logs || [])
  })
})

app.get('/api/pos/audit', checkStaffOrAdmin(['manager']), (req, res) => {
  const limit = Number(req.query?.limit || 100)
  db.getAuditLog(limit, (err, logs) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(logs || [])
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

// POS installer downloads (protected)
app.use('/downloads/pos', checkDownloadToken, express.static(path.join(__dirname, 'downloads', 'pos')))

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

  if (cookieToken === ADMIN_TOKEN) return res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html'))
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
