const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const initSqlJs = require('sql.js')

const DB_PATH = path.join(__dirname, 'data.sqlite')

let SQL = null
let db = null
let dbData = null

const ORDER_COLUMNS = [
  'id',
  'total',
  'status',
  'delivery',
  'payment',
  'customer',
  'createdAt',
  'updatedAt',
  'source',
  'externalId',
  'staffName',
  'staffRole',
  'branchId',
  'branchName',
  'trackingToken',
  'lastLat',
  'lastLng',
  'lastLocationAt',
  'lastLocationAccuracy'
]

// Initialize database
async function initDb() {
  SQL = await initSqlJs()
  
  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    dbData = fs.readFileSync(DB_PATH)
    db = new SQL.Database(new Uint8Array(dbData))
  } else {
    db = new SQL.Database()
  }
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      cost REAL DEFAULT 0,
      stock REAL NOT NULL
    )
  `)

  ensureProductColumns()
  
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total REAL NOT NULL,
      status TEXT NOT NULL,
      delivery TEXT,
      payment TEXT,
      customer TEXT,
      createdAt TEXT NOT NULL
    )
  `)

  ensureOrderColumns()
  
  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty REAL NOT NULL,
      price_at REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      salt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actorType TEXT,
      actorId TEXT,
      actorName TEXT,
      action TEXT NOT NULL,
      targetType TEXT,
      targetId TEXT,
      meta TEXT,
      createdAt TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staffId INTEGER NOT NULL,
      staffName TEXT NOT NULL,
      openedAt TEXT NOT NULL,
      closedAt TEXT,
      openingCash REAL NOT NULL,
      closingCash REAL,
      expectedCash REAL,
      variance REAL,
      status TEXT NOT NULL,
      FOREIGN KEY(staffId) REFERENCES staff(id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shiftId INTEGER NOT NULL,
      staffId INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(shiftId) REFERENCES shifts(id),
      FOREIGN KEY(staffId) REFERENCES staff(id)
    )
  `)

  ensureShiftColumns()
  ensureAuditColumns()
  ensureCashMovementColumns()
  
  // Seed products if empty
  const result = db.exec('SELECT COUNT(1) as c FROM products')
  const count = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0
  
  if (count === 0) {
    const { beverages, meats } = require('./data-demo')
    const rows = [
      ...beverages.map(b => ({ id: b.id, name: b.name, price: b.price, cost: b.cost || 0, stock: b.stock })),
      ...meats.map(m => ({ id: m.id, name: m.name, price: m.pricePerKg, cost: m.cost || 0, stock: m.stockKg }))
    ]
    rows.forEach(r => {
      const now = new Date().toISOString()
      db.run('INSERT INTO products (id, name, price, cost, stock, updatedAt) VALUES (?, ?, ?, ?, ?, ?)', [r.id, r.name, r.price, r.cost, r.stock, now])
    })
    saveDb()
  }

  const branchResult = db.exec('SELECT COUNT(1) as c FROM branches')
  const branchCount = branchResult.length > 0 && branchResult[0].values.length > 0 ? branchResult[0].values[0][0] : 0
  if (branchCount === 0) {
    const now = new Date().toISOString()
    db.run('INSERT INTO branches (name, location, active, createdAt) VALUES (?, ?, ?, ?)', ['Main Branch', null, 1, now])
  }

  const now = new Date().toISOString()
  try {
    db.run('UPDATE products SET updatedAt = ? WHERE updatedAt IS NULL', [now])
  } catch (err) {
    // ignore if column missing
  }
  try {
    db.run('UPDATE orders SET updatedAt = createdAt WHERE updatedAt IS NULL')
  } catch (err) {
    // ignore if column missing
  }
}

function saveDb() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

function ensureOrderColumns() {
  const info = db.exec('PRAGMA table_info(orders)')
  const existing = info.length > 0 ? info[0].values.map(r => r[1]) : []
  const addColumnIfMissing = (name, type) => {
    if (!existing.includes(name)) {
      db.run(`ALTER TABLE orders ADD COLUMN ${name} ${type}`)
    }
  }
  addColumnIfMissing('updatedAt', 'TEXT')
  addColumnIfMissing('source', 'TEXT')
  addColumnIfMissing('externalId', 'TEXT')
  addColumnIfMissing('staffName', 'TEXT')
  addColumnIfMissing('staffRole', 'TEXT')
  addColumnIfMissing('branchId', 'INTEGER')
  addColumnIfMissing('branchName', 'TEXT')
  addColumnIfMissing('trackingToken', 'TEXT')
  addColumnIfMissing('lastLat', 'REAL')
  addColumnIfMissing('lastLng', 'REAL')
  addColumnIfMissing('lastLocationAt', 'TEXT')
  addColumnIfMissing('lastLocationAccuracy', 'REAL')
}

function ensureProductColumns() {
  const info = db.exec('PRAGMA table_info(products)')
  const existing = info.length > 0 ? info[0].values.map(r => r[1]) : []
  if (!existing.includes('updatedAt')) {
    db.run('ALTER TABLE products ADD COLUMN updatedAt TEXT')
  }
  if (!existing.includes('barcode')) {
    db.run('ALTER TABLE products ADD COLUMN barcode TEXT')
  }
}

function mapOrderRow(row) {
  return {
    id: row[0],
    total: row[1],
    status: row[2],
    delivery: row[3],
    payment: row[4],
    customer: row[5],
    createdAt: row[6],
    updatedAt: row[7],
    source: row[8],
    externalId: row[9],
    staffName: row[10],
    staffRole: row[11],
    branchId: row[12],
    branchName: row[13],
    trackingToken: row[14],
    lastLat: row[15],
    lastLng: row[16],
    lastLocationAt: row[17],
    lastLocationAccuracy: row[18]
  }
}

function parseOrderRow(row, { includeToken = false } = {}) {
  if (!row) return null
  const parsed = {
    ...row,
    delivery: row.delivery ? JSON.parse(row.delivery) : {},
    payment: row.payment ? JSON.parse(row.payment) : {},
    customer: row.customer ? JSON.parse(row.customer) : {}
  }
  if (row.lastLat !== null && row.lastLng !== null && row.lastLat !== undefined && row.lastLng !== undefined) {
    parsed.lastLocation = {
      lat: row.lastLat,
      lng: row.lastLng,
      accuracy: row.lastLocationAccuracy,
      at: row.lastLocationAt
    }
  } else {
    parsed.lastLocation = null
  }
  if (!includeToken) delete parsed.trackingToken
  delete parsed.lastLat
  delete parsed.lastLng
  delete parsed.lastLocationAt
  delete parsed.lastLocationAccuracy
  return parsed
}

function compareIsoDate(a, b) {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  return a.localeCompare(b)
}

// Exported functions for API (using callbacks to match other code)
module.exports = {
  init: initDb,
  
  getProducts: (callback) => {
    try {
      const result = db.exec('SELECT * FROM products ORDER BY id')
      const products = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], name: row[1], price: row[2], cost: row[3], stock: row[4], updatedAt: row[5], barcode: row[6]
      })) : []
      callback(null, products)
    } catch (e) { callback(e) }
  },
  
  getProductById: (id, callback) => {
    try {
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4], updatedAt: result[0].values[0][5], barcode: result[0].values[0][6]
      } : null
      callback(null, product)
    } catch (e) { callback(e) }
  },

  getProductByName: (name, callback) => {
    try {
      const safeName = (name || '').trim()
      if (!safeName) return callback(null, null)
      const result = db.exec('SELECT * FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1', [safeName])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4], updatedAt: result[0].values[0][5], barcode: result[0].values[0][6]
      } : null
      callback(null, product)
    } catch (e) { callback(e) }
  },
  
  getStock: (id, callback) => {
    try {
      const result = db.exec('SELECT stock FROM products WHERE id = ?', [id])
      const stock = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0
      callback(null, stock)
    } catch (e) { callback(e) }
  },
  
  restockProduct: (id, amount, callback) => {
    try {
      const now = new Date().toISOString()
      db.run('UPDATE products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [amount, now, id])
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4], updatedAt: result[0].values[0][5], barcode: result[0].values[0][6]
      } : null
      saveDb()
      callback(null, product)
    } catch (e) { callback(e) }
  },
  
  updateProduct: (id, { name, price, cost, stock, barcode }, callback) => {
    try {
      const updates = []
      const params = []
      
      if (name !== undefined) { updates.push('name = ?'); params.push(name) }
      if (price !== undefined) { updates.push('price = ?'); params.push(price) }
      if (cost !== undefined) { updates.push('cost = ?'); params.push(cost) }
      if (stock !== undefined) { updates.push('stock = ?'); params.push(stock) }
      if (barcode !== undefined) { updates.push('barcode = ?'); params.push(barcode) }
      
      if (updates.length === 0) return callback(new Error('No fields to update'))

      updates.push('updatedAt = ?')
      params.push(new Date().toISOString())
      
      params.push(id)
      db.run(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params)
      
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4], updatedAt: result[0].values[0][5], barcode: result[0].values[0][6]
      } : null
      saveDb()
      callback(null, product)
    } catch (e) { callback(e) }
  },

  replaceProducts: (items, callback) => {
    try {
      const list = Array.isArray(items) ? items : []
      const maxResult = db.exec('SELECT MAX(id) as maxId FROM products')
      const currentMax = maxResult.length > 0 && maxResult[0].values.length > 0 && maxResult[0].values[0][0]
        ? Number(maxResult[0].values[0][0])
        : 0
      const startId = currentMax + 1
      const now = new Date().toISOString()

      db.run('BEGIN')
      db.run('DELETE FROM products')

      list.forEach((item, index) => {
        const id = startId + index
        const name = String(item.name || '').trim()
        const price = Number(item.price || 0)
        const cost = Number(item.cost || 0)
        const stock = Number(item.stock || 0)
        const barcode = item.barcode ? String(item.barcode).trim() : null

        if (!name || !Number.isFinite(price)) return
        db.run(
          'INSERT INTO products (id, name, price, cost, stock, updatedAt, barcode) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, name, price, cost, stock, now, barcode]
        )
      })

      db.run('COMMIT')
      saveDb()
      callback(null, { inserted: list.length })
    } catch (e) {
      try { db.run('ROLLBACK') } catch (err) { /* ignore */ }
      callback(e)
    }
  },
  
  createOrder: ({ items, delivery, payment, customer, total, staff, branch }, callback) => {
    try {
      // Verify stock
      for (const it of items) {
        const result = db.exec('SELECT stock FROM products WHERE id = ?', [it.id])
        const stock = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : null
        if (stock === null || stock < it.qty) {
          return callback(new Error(`Not enough stock for product ${it.id}`))
        }
      }
      
      // Decrement stock and create order
      for (const it of items) {
        db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [it.qty, it.id])
      }
      
      const now = new Date().toISOString()
      const trackingToken = crypto.randomBytes(16).toString('hex')

      let branchId = branch?.id || branch?.branchId || null
      let branchName = branch?.name || branch?.branchName || null
      if (!branchId) {
        const result = db.exec('SELECT id, name FROM branches ORDER BY id ASC LIMIT 1')
        if (result.length > 0 && result[0].values.length > 0) {
          branchId = result[0].values[0][0]
          branchName = result[0].values[0][1]
        }
      } else if (!branchName) {
        const result = db.exec('SELECT name FROM branches WHERE id = ?', [branchId])
        if (result.length > 0 && result[0].values.length > 0) {
          branchName = result[0].values[0][0]
        }
      }

      db.run(
        'INSERT INTO orders (total, status, delivery, payment, customer, createdAt, updatedAt, source, externalId, staffName, staffRole, branchId, branchName, trackingToken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [total, 'Placed', JSON.stringify(delivery || {}), JSON.stringify(payment || {}), JSON.stringify(customer || {}), now, now, 'web', null, staff?.name || null, staff?.role || null, branchId, branchName, trackingToken]
      )
      
      // Get last inserted ID
      const idResult = db.exec('SELECT last_insert_rowid() as id')
      const orderId = idResult[0].values[0][0]
      
      // Add order items
      for (const it of items) {
        const priceResult = db.exec('SELECT price FROM products WHERE id = ?', [it.id])
        const price = priceResult[0].values[0][0]
        db.run('INSERT INTO order_items (order_id, product_id, qty, price_at) VALUES (?, ?, ?, ?)',
          [orderId, it.id, it.qty, price])
      }
      
      saveDb()
      module.exports.getOrderById(orderId, callback)
    } catch (e) { callback(e) }
  },
  
  getOrders: (callback) => {
    try {
      const result = db.exec(`SELECT ${ORDER_COLUMNS.join(', ')} FROM orders ORDER BY id DESC`)
      const orders = result.length > 0 ? result[0].values.map(row => mapOrderRow(row)) : []
      
      // Add items for each order
      orders.forEach(o => {
        const itemResult = db.exec('SELECT * FROM order_items WHERE order_id = ?', [o.id])
        o.items = itemResult.length > 0 ? itemResult[0].values.map(row => ({
          id: row[0], order_id: row[1], product_id: row[2], qty: row[3], price_at: row[4]
        })) : []
      })
      
      callback(null, orders.map(row => parseOrderRow(row)))
    } catch (e) { callback(e) }
  },

  getOrdersForAdmin: (callback) => {
    try {
      const result = db.exec(`SELECT ${ORDER_COLUMNS.join(', ')} FROM orders ORDER BY id DESC`)
      const orders = result.length > 0 ? result[0].values.map(row => mapOrderRow(row)) : []

      orders.forEach(o => {
        const itemResult = db.exec('SELECT * FROM order_items WHERE order_id = ?', [o.id])
        o.items = itemResult.length > 0 ? itemResult[0].values.map(row => ({
          id: row[0], order_id: row[1], product_id: row[2], qty: row[3], price_at: row[4]
        })) : []
      })

      callback(null, orders.map(row => parseOrderRow(row, { includeToken: true })))
    } catch (e) { callback(e) }
  },
  
  getOrderById: (id, callback) => {
    try {
      const result = db.exec(`SELECT ${ORDER_COLUMNS.join(', ')} FROM orders WHERE id = ?`, [id])
      if (result.length === 0 || result[0].values.length === 0) {
        return callback(null, null)
      }
      const order = mapOrderRow(result[0].values[0])
      
      const itemResult = db.exec('SELECT * FROM order_items WHERE order_id = ?', [id])
      order.items = itemResult.length > 0 ? itemResult[0].values.map(r => ({
        id: r[0], order_id: r[1], product_id: r[2], qty: r[3], price_at: r[4]
      })) : []
      
      callback(null, parseOrderRow(order))
    } catch (e) { callback(e) }
  },

  getOrdersUpdatedSince: (since, callback) => {
    try {
      const query = since
        ? `SELECT ${ORDER_COLUMNS.join(', ')} FROM orders WHERE updatedAt >= ? ORDER BY id DESC`
        : `SELECT ${ORDER_COLUMNS.join(', ')} FROM orders ORDER BY id DESC`
      const result = since ? db.exec(query, [since]) : db.exec(query)
      const orders = result.length > 0 ? result[0].values.map(row => mapOrderRow(row)) : []

      orders.forEach(o => {
        const itemResult = db.exec('SELECT * FROM order_items WHERE order_id = ?', [o.id])
        o.items = itemResult.length > 0 ? itemResult[0].values.map(row => ({
          id: row[0], order_id: row[1], product_id: row[2], qty: row[3], price_at: row[4]
        })) : []
      })

      callback(null, orders.map(row => parseOrderRow(row, { includeToken: true })))
    } catch (e) { callback(e) }
  },

  getProductsUpdatedSince: (since, callback) => {
    try {
      const query = since
        ? 'SELECT * FROM products WHERE updatedAt >= ? ORDER BY id'
        : 'SELECT * FROM products ORDER BY id'
      const result = since ? db.exec(query, [since]) : db.exec(query)
      const products = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], name: row[1], price: row[2], cost: row[3], stock: row[4], updatedAt: row[5], barcode: row[6]
      })) : []
      callback(null, products)
    } catch (e) { callback(e) }
  },

  getOrderByExternalId: (source, externalId, callback) => {
    try {
      if (!source || !externalId) return callback(null, null)
      const result = db.exec(`SELECT ${ORDER_COLUMNS.join(', ')} FROM orders WHERE source = ? AND externalId = ?`, [source, externalId])
      if (result.length === 0 || result[0].values.length === 0) return callback(null, null)
      const order = mapOrderRow(result[0].values[0])
      const itemResult = db.exec('SELECT * FROM order_items WHERE order_id = ?', [order.id])
      order.items = itemResult.length > 0 ? itemResult[0].values.map(r => ({
        id: r[0], order_id: r[1], product_id: r[2], qty: r[3], price_at: r[4]
      })) : []
      callback(null, parseOrderRow(order, { includeToken: true }))
    } catch (e) { callback(e) }
  },

  createOrderFromPos: ({ items, delivery, payment, customer, total, createdAt, externalId, source, staff, branch }, callback) => {
    try {
      const safeSource = source || 'pos'
      if (externalId) {
        return module.exports.getOrderByExternalId(safeSource, externalId, (err, existing) => {
          if (err) return callback(err)
          if (existing) return callback(null, existing)
          return createNewOrder()
        })
      }
      return createNewOrder()

      function createNewOrder() {
        // Verify stock
        for (const it of items) {
          const result = db.exec('SELECT stock, price FROM products WHERE id = ?', [it.id])
          if (result.length === 0 || result[0].values.length === 0) {
            return callback(new Error(`Invalid product ${it.id}`))
          }
          const stock = result[0].values[0][0]
          if (stock < it.qty) {
            return callback(new Error(`Not enough stock for product ${it.id}`))
          }
        }

        // Decrement stock
        for (const it of items) {
          db.run('UPDATE products SET stock = stock - ?, updatedAt = ? WHERE id = ?', [it.qty, new Date().toISOString(), it.id])
        }

        const now = new Date().toISOString()
        const orderCreatedAt = createdAt || now
        const trackingToken = crypto.randomBytes(16).toString('hex')

        let branchId = branch?.id || branch?.branchId || null
        let branchName = branch?.name || branch?.branchName || null
        if (!branchId) {
          const result = db.exec('SELECT id, name FROM branches ORDER BY id ASC LIMIT 1')
          if (result.length > 0 && result[0].values.length > 0) {
            branchId = result[0].values[0][0]
            branchName = result[0].values[0][1]
          }
        } else if (!branchName) {
          const result = db.exec('SELECT name FROM branches WHERE id = ?', [branchId])
          if (result.length > 0 && result[0].values.length > 0) {
            branchName = result[0].values[0][0]
          }
        }

        const computedTotal = (items || []).reduce((sum, it) => {
          const priceAt = it.price_at !== undefined ? Number(it.price_at) : null
          if (priceAt !== null && !Number.isNaN(priceAt)) return sum + priceAt * Number(it.qty || 0)
          const priceResult = db.exec('SELECT price FROM products WHERE id = ?', [it.id])
          const price = priceResult[0].values[0][0]
          return sum + price * Number(it.qty || 0)
        }, 0)

        const finalTotal = total !== undefined && total !== null ? Number(total) : computedTotal

        db.run(
          'INSERT INTO orders (total, status, delivery, payment, customer, createdAt, updatedAt, source, externalId, staffName, staffRole, branchId, branchName, trackingToken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [finalTotal, 'Placed', JSON.stringify(delivery || {}), JSON.stringify(payment || {}), JSON.stringify(customer || {}), orderCreatedAt, now, safeSource, externalId || null, staff?.name || null, staff?.role || null, branchId, branchName, trackingToken]
        )

        const idResult = db.exec('SELECT last_insert_rowid() as id')
        const orderId = idResult[0].values[0][0]

        for (const it of items) {
          let priceAt = it.price_at !== undefined ? Number(it.price_at) : null
          if (priceAt === null || Number.isNaN(priceAt)) {
            const priceResult = db.exec('SELECT price FROM products WHERE id = ?', [it.id])
            priceAt = priceResult[0].values[0][0]
          }
          db.run('INSERT INTO order_items (order_id, product_id, qty, price_at) VALUES (?, ?, ?, ?)',
            [orderId, it.id, it.qty, priceAt])
        }

        saveDb()
        module.exports.getOrderById(orderId, callback)
      }
    } catch (e) { callback(e) }
  },

  updateOrderLocationByToken: (id, token, { lat, lng, accuracy }, callback) => {
    try {
      const result = db.exec('SELECT trackingToken FROM orders WHERE id = ?', [id])
      if (result.length === 0 || result[0].values.length === 0) return callback(new Error('Order not found'))
      const storedToken = result[0].values[0][0]
      if (!storedToken || storedToken !== token) return callback(new Error('Invalid tracking token'))

      const now = new Date().toISOString()
      db.run('UPDATE orders SET lastLat = ?, lastLng = ?, lastLocationAccuracy = ?, lastLocationAt = ? WHERE id = ?',
        [lat, lng, accuracy || null, now, id])
      db.run('UPDATE orders SET updatedAt = ? WHERE id = ?', [now, id])
      saveDb()
      module.exports.getOrderById(id, callback)
    } catch (e) { callback(e) }
  },
  
  setOrderStatus: (id, status, callback) => {
    try {
      const now = new Date().toISOString()
      db.run('UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?', [status, now, id])
      saveDb()
      module.exports.getOrderById(id, callback)
    } catch (e) { callback(e) }
  },
  setOrderStatusByExternalId: (source, externalId, status, callback) => {
    try {
      const now = new Date().toISOString()
      db.run('UPDATE orders SET status = ?, updatedAt = ? WHERE source = ? AND externalId = ?', [status, now, source, externalId])
      saveDb()
      module.exports.getOrderByExternalId(source, externalId, callback)
    } catch (e) { callback(e) }
  },

  cancelOrder: (id, callback) => {
    try {
      const orderResult = db.exec('SELECT status FROM orders WHERE id = ?', [id])
      if (orderResult.length === 0 || orderResult[0].values.length === 0) {
        return callback(new Error('Order not found'))
      }
      const currentStatus = orderResult[0].values[0][0]
      if (currentStatus === 'Cancelled') {
        return module.exports.getOrderById(id, callback)
      }

      const itemsResult = db.exec('SELECT product_id, qty FROM order_items WHERE order_id = ?', [id])
      if (itemsResult.length > 0) {
        itemsResult[0].values.forEach(row => {
          const productId = row[0]
          const qty = row[1]
          db.run('UPDATE products SET stock = stock + ? WHERE id = ?', [qty, productId])
        })
      }

      db.run('UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?', ['Cancelled', new Date().toISOString(), id])
      saveDb()
      module.exports.getOrderById(id, callback)
    } catch (e) { callback(e) }
  },

  verifyTrackingToken: (id, token, callback) => {
    try {
      const result = db.exec('SELECT trackingToken FROM orders WHERE id = ?', [id])
      if (result.length === 0 || result[0].values.length === 0) {
        return callback(new Error('Order not found'))
      }
      const storedToken = result[0].values[0][0]
      if (!storedToken || storedToken !== token) return callback(new Error('Invalid tracking token'))
      callback(null, true)
    } catch (e) { callback(e) }
  },
  
  createProduct: ({ name, price, cost, stock, barcode }, callback) => {
    try {
      // Get max ID to avoid conflicts
      const result = db.exec('SELECT MAX(id) as maxId FROM products')
      const maxId = result.length > 0 && result[0].values.length > 0 && result[0].values[0][0] ? result[0].values[0][0] : 0
      const newId = maxId + 1
      
      const now = new Date().toISOString()
      db.run('INSERT INTO products (id, name, price, cost, stock, updatedAt, barcode) VALUES (?, ?, ?, ?, ?, ?, ?)', [newId, name, price, cost || 0, stock, now, barcode || null])
      saveDb()
      
      const product = { id: newId, name, price, cost: cost || 0, stock, updatedAt: now, barcode: barcode || null }
      callback(null, product)
    } catch (e) { callback(e) }
  },
  upsertProductByName: ({ name, price, cost, stock, barcode }, callback) => {
    const safeName = (name || '').trim()
    if (!safeName) return callback(new Error('Missing name'))
    module.exports.getProductByName(safeName, (err, existing) => {
      if (err) return callback(err)
      if (existing) {
        const updates = { name: safeName }
        if (price !== undefined && price !== null) updates.price = price
        if (cost !== undefined && cost !== null) updates.cost = cost
        if (stock !== undefined && stock !== null) updates.stock = stock
        if (barcode !== undefined) updates.barcode = barcode
        return module.exports.updateProduct(existing.id, updates, (updateErr, product) => {
          if (updateErr) return callback(updateErr)
          callback(null, { action: 'updated', product })
        })
      }
      if (price === undefined || price === null) return callback(new Error('Missing selling price'))
      const safeCost = cost !== undefined && cost !== null ? cost : 0
      const safeStock = stock !== undefined && stock !== null ? stock : 0
      return module.exports.createProduct({ name: safeName, price, cost: safeCost, stock: safeStock, barcode }, (createErr, product) => {
        if (createErr) return callback(createErr)
        callback(null, { action: 'created', product })
      })
    })
  },
  updateProductFromPos: ({ id, name, price, cost, stock, barcode, updatedAt }, callback) => {
    try {
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      if (result.length === 0 || result[0].values.length === 0) {
        return callback(new Error('Product not found'))
      }
      const existing = result[0].values[0]
      const existingUpdatedAt = existing[5]
      if (compareIsoDate(updatedAt, existingUpdatedAt) < 0) {
        return callback(null, {
          id: existing[0], name: existing[1], price: existing[2], cost: existing[3], stock: existing[4], updatedAt: existing[5], skipped: true
        })
      }

      const updates = []
      const params = []
      if (name !== undefined) { updates.push('name = ?'); params.push(name) }
      if (price !== undefined) { updates.push('price = ?'); params.push(price) }
      if (cost !== undefined) { updates.push('cost = ?'); params.push(cost) }
      if (stock !== undefined) { updates.push('stock = ?'); params.push(stock) }
      if (barcode !== undefined) { updates.push('barcode = ?'); params.push(barcode) }
      updates.push('updatedAt = ?')
      params.push(updatedAt || new Date().toISOString())
      params.push(id)
      db.run(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params)

      const updated = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = updated.length > 0 && updated[0].values.length > 0 ? {
        id: updated[0].values[0][0], name: updated[0].values[0][1], price: updated[0].values[0][2], cost: updated[0].values[0][3], stock: updated[0].values[0][4], updatedAt: updated[0].values[0][5], barcode: updated[0].values[0][6]
      } : null
      saveDb()
      callback(null, product)
    } catch (e) { callback(e) }
  },
  adjustProductStock: (id, amount, callback) => {
    try {
      const now = new Date().toISOString()
      db.run('UPDATE products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [amount, now, id])
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4], updatedAt: result[0].values[0][5], barcode: result[0].values[0][6]
      } : null
      saveDb()
      callback(null, product)
    } catch (e) { callback(e) }
  },
  returnOrder: (id, callback) => {
    try {
      const orderResult = db.exec('SELECT status FROM orders WHERE id = ?', [id])
      if (orderResult.length === 0 || orderResult[0].values.length === 0) {
        return callback(new Error('Order not found'))
      }
      const itemsResult = db.exec('SELECT product_id, qty FROM order_items WHERE order_id = ?', [id])
      if (itemsResult.length > 0) {
        itemsResult[0].values.forEach(row => {
          const productId = row[0]
          const qty = row[1]
          db.run('UPDATE products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [qty, new Date().toISOString(), productId])
        })
      }

      db.run('UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?', ['Returned', new Date().toISOString(), id])
      saveDb()
      module.exports.getOrderById(id, callback)
    } catch (e) { callback(e) }
  },

  createStaff: ({ name, username, role, passwordHash, salt }, callback) => {
    try {
      const now = new Date().toISOString()
      db.run(
        'INSERT INTO staff (name, username, role, passwordHash, salt, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, username, role, passwordHash, salt, 1, now]
      )
      const idResult = db.exec('SELECT last_insert_rowid() as id')
      const staffId = idResult[0].values[0][0]
      callback(null, { id: staffId, name, username, role, active: 1, createdAt: now })
    } catch (e) { callback(e) }
  },

  listBranches: (callback) => {
    try {
      const result = db.exec('SELECT id, name, location, active, createdAt FROM branches ORDER BY id ASC')
      const branches = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], name: row[1], location: row[2], active: row[3], createdAt: row[4]
      })) : []
      callback(null, branches)
    } catch (e) { callback(e) }
  },

  getBranchById: (id, callback) => {
    try {
      const result = db.exec('SELECT id, name, location, active, createdAt FROM branches WHERE id = ?', [id])
      if (result.length === 0 || result[0].values.length === 0) return callback(null, null)
      const row = result[0].values[0]
      callback(null, { id: row[0], name: row[1], location: row[2], active: row[3], createdAt: row[4] })
    } catch (e) { callback(e) }
  },

  createBranch: ({ name, location }, callback) => {
    try {
      const now = new Date().toISOString()
      db.run('INSERT INTO branches (name, location, active, createdAt) VALUES (?, ?, ?, ?)', [name, location || null, 1, now])
      const idResult = db.exec('SELECT last_insert_rowid() as id')
      const branchId = idResult[0].values[0][0]
      callback(null, { id: branchId, name, location: location || null, active: 1, createdAt: now })
    } catch (e) { callback(e) }
  },

  getDefaultBranch: (callback) => {
    try {
      const result = db.exec('SELECT id, name FROM branches ORDER BY id ASC LIMIT 1')
      if (result.length === 0 || result[0].values.length === 0) return callback(null, null)
      const row = result[0].values[0]
      callback(null, { id: row[0], name: row[1] })
    } catch (e) { callback(e) }
  },

  getStaffByUsername: (username, callback) => {
    try {
      const result = db.exec('SELECT * FROM staff WHERE username = ?', [username])
      if (result.length === 0 || result[0].values.length === 0) return callback(null, null)
      const row = result[0].values[0]
      callback(null, {
        id: row[0], name: row[1], username: row[2], role: row[3], passwordHash: row[4], salt: row[5], active: row[6], createdAt: row[7]
      })
    } catch (e) { callback(e) }
  },

  getStaffById: (id, callback) => {
    try {
      const result = db.exec('SELECT * FROM staff WHERE id = ?', [id])
      if (result.length === 0 || result[0].values.length === 0) return callback(null, null)
      const row = result[0].values[0]
      callback(null, {
        id: row[0], name: row[1], username: row[2], role: row[3], passwordHash: row[4], salt: row[5], active: row[6], createdAt: row[7]
      })
    } catch (e) { callback(e) }
  },

  listStaff: (callback) => {
    try {
      const result = db.exec('SELECT id, name, username, role, active, createdAt FROM staff ORDER BY id DESC')
      const staff = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], name: row[1], username: row[2], role: row[3], active: row[4], createdAt: row[5]
      })) : []
      callback(null, staff)
    } catch (e) { callback(e) }
  },

  getStaffCount: (callback) => {
    try {
      const result = db.exec('SELECT COUNT(1) as c FROM staff')
      const count = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0
      callback(null, count)
    } catch (e) { callback(e) }
  },

  setStaffRole: (id, role, callback) => {
    try {
      db.run('UPDATE staff SET role = ? WHERE id = ?', [role, id])
      callback(null, { ok: true })
    } catch (e) { callback(e) }
  },

  setStaffActive: (id, active, callback) => {
    try {
      db.run('UPDATE staff SET active = ? WHERE id = ?', [active ? 1 : 0, id])
      callback(null, { ok: true })
    } catch (e) { callback(e) }
  },

  addAuditLog: ({ actorType, actorId, actorName, action, targetType, targetId, meta, branchId, branchName }, callback) => {
    try {
      const now = new Date().toISOString()
      db.run(
        'INSERT INTO audit_log (actorType, actorId, actorName, action, targetType, targetId, meta, createdAt, branchId, branchName) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [actorType || null, actorId || null, actorName || null, action, targetType || null, targetId || null, meta ? JSON.stringify(meta) : null, now, branchId || null, branchName || null]
      )
      callback(null, { ok: true })
    } catch (e) { callback(e) }
  },

  getAuditLog: (limit, callback) => {
    try {
      const take = Number(limit) || 100
      const result = db.exec('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [take])
      const logs = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], actorType: row[1], actorId: row[2], actorName: row[3], action: row[4], targetType: row[5], targetId: row[6], meta: row[7] ? JSON.parse(row[7]) : null, createdAt: row[8], branchId: row[9], branchName: row[10]
      })) : []
      callback(null, logs)
    } catch (e) { callback(e) }
  },

  getOpenShiftForStaff: (staffId, callback) => {
    try {
      const result = db.exec('SELECT * FROM shifts WHERE staffId = ? AND status = ?', [staffId, 'open'])
      if (result.length === 0 || result[0].values.length === 0) return callback(null, null)
      const row = result[0].values[0]
      callback(null, {
        id: row[0], staffId: row[1], staffName: row[2], openedAt: row[3], closedAt: row[4], openingCash: row[5], closingCash: row[6], expectedCash: row[7], variance: row[8], status: row[9], branchId: row[10], branchName: row[11]
      })
    } catch (e) { callback(e) }
  },

  createShift: ({ staffId, staffName, openingCash, branchId, branchName }, callback) => {
    try {
      const now = new Date().toISOString()
      db.run(
        'INSERT INTO shifts (staffId, staffName, openedAt, openingCash, status, branchId, branchName) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [staffId, staffName, now, openingCash, 'open', branchId || null, branchName || null]
      )
      const idResult = db.exec('SELECT last_insert_rowid() as id')
      const shiftId = idResult[0].values[0][0]
      callback(null, { id: shiftId, staffId, staffName, openedAt: now, openingCash, status: 'open', branchId: branchId || null, branchName: branchName || null })
    } catch (e) { callback(e) }
  },

  addCashMovement: ({ shiftId, staffId, type, amount, reason, branchId, branchName }, callback) => {
    try {
      const now = new Date().toISOString()
      db.run(
        'INSERT INTO cash_movements (shiftId, staffId, type, amount, reason, createdAt, branchId, branchName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [shiftId, staffId, type, amount, reason || null, now, branchId || null, branchName || null]
      )
      callback(null, { ok: true })
    } catch (e) { callback(e) }
  },

  getCashMovementsByShift: (shiftId, callback) => {
    try {
      const result = db.exec('SELECT * FROM cash_movements WHERE shiftId = ? ORDER BY id DESC', [shiftId])
      const movements = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], shiftId: row[1], staffId: row[2], type: row[3], amount: row[4], reason: row[5], createdAt: row[6], branchId: row[7], branchName: row[8]
      })) : []
      callback(null, movements)
    } catch (e) { callback(e) }
  },

  getOrdersBetween: (startIso, endIso, branchId, callback) => {
    try {
      const result = branchId
        ? db.exec('SELECT * FROM orders WHERE createdAt >= ? AND createdAt <= ? AND branchId = ? ORDER BY id DESC', [startIso, endIso, branchId])
        : db.exec('SELECT * FROM orders WHERE createdAt >= ? AND createdAt <= ? ORDER BY id DESC', [startIso, endIso])
      const orders = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], total: row[1], status: row[2], delivery: row[3], payment: row[4], customer: row[5], createdAt: row[6], staffName: row[10], staffRole: row[11], branchId: row[17], branchName: row[18]
      })) : []
      const parsed = orders.map(o => ({
        ...o,
        payment: o.payment ? JSON.parse(o.payment) : {}
      }))
      callback(null, parsed)
    } catch (e) { callback(e) }
  },

  closeShift: ({ shiftId, closingCash, expectedCash, variance }, callback) => {
    try {
      const now = new Date().toISOString()
      db.run(
        'UPDATE shifts SET closedAt = ?, closingCash = ?, expectedCash = ?, variance = ?, status = ? WHERE id = ?',
        [now, closingCash, expectedCash, variance, 'closed', shiftId]
      )
      callback(null, { ok: true, closedAt: now })
    } catch (e) { callback(e) }
  },

  getShiftById: (shiftId, callback) => {
    try {
      const result = db.exec('SELECT * FROM shifts WHERE id = ?', [shiftId])
      if (result.length === 0 || result[0].values.length === 0) return callback(null, null)
      const row = result[0].values[0]
      callback(null, {
        id: row[0], staffId: row[1], staffName: row[2], openedAt: row[3], closedAt: row[4], openingCash: row[5], closingCash: row[6], expectedCash: row[7], variance: row[8], status: row[9], branchId: row[10], branchName: row[11]
      })
    } catch (e) { callback(e) }
  },

  getOrderTotalsBetween: (startIso, endIso, branchId, callback) => {
    module.exports.getOrdersBetween(startIso, endIso, branchId, (err, orders) => {
      if (err) return callback(err)
      const totals = {
        cashSales: 0,
        mobileSales: 0,
        cashRefunds: 0,
        mobileRefunds: 0,
        totalRefunds: 0
      }
      orders.forEach(order => {
        const method = order.payment?.method || 'unknown'
        const isReturned = order.status === 'Returned'
        const isCancelled = order.status === 'Cancelled'
        if (isCancelled) return
        if (isReturned) {
          totals.totalRefunds += Number(order.total || 0)
          if (method === 'cash') totals.cashRefunds += Number(order.total || 0)
          if (method === 'mobile') totals.mobileRefunds += Number(order.total || 0)
          return
        }
        if (method === 'cash') totals.cashSales += Number(order.total || 0)
        if (method === 'mobile') totals.mobileSales += Number(order.total || 0)
      })
      callback(null, totals)
    })
  },

  getStaffPerformance: (startIso, endIso, branchId, callback) => {
    module.exports.getOrdersBetween(startIso, endIso, branchId, (err, orders) => {
      if (err) return callback(err)
      const map = {}
      orders.forEach(order => {
        if (order.status === 'Cancelled') return
        const staffKey = order.staffName || 'Unknown'
        if (!map[staffKey]) {
          map[staffKey] = {
            staffName: staffKey,
            staffRole: order.staffRole || 'unknown',
            orders: 0,
            totalSales: 0,
            cashSales: 0,
            mobileSales: 0,
            refunds: 0
          }
        }
        const entry = map[staffKey]
        const method = order.payment?.method || 'unknown'
        if (order.status === 'Returned') {
          entry.refunds += Number(order.total || 0)
          return
        }
        entry.orders += 1
        entry.totalSales += Number(order.total || 0)
        if (method === 'cash') entry.cashSales += Number(order.total || 0)
        if (method === 'mobile') entry.mobileSales += Number(order.total || 0)
      })
      const list = Object.values(map).map(item => ({
        ...item,
        avgOrder: item.orders > 0 ? item.totalSales / item.orders : 0
      })).sort((a, b) => b.totalSales - a.totalSales)
      callback(null, list)
    })
  },
  
  getProfitLoss: (callback) => {
    try {
      // Get all completed orders with items
      const ordersResult = db.exec('SELECT * FROM orders')
      if (ordersResult.length === 0 || ordersResult[0].values.length === 0) {
        return callback(null, {
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          orderCount: 0,
          productSales: []
        })
      }
      
      const orders = ordersResult[0].values.map(row => ({
        id: row[0], total: row[1], status: row[2]
      }))
      
      let totalRevenue = 0
      let totalCost = 0
      const productSales = {}
      
      orders.forEach(order => {
        totalRevenue += order.total
        
        // Get order items
        const itemsResult = db.exec('SELECT product_id, qty, price_at FROM order_items WHERE order_id = ?', [order.id])
        if (itemsResult.length > 0) {
          itemsResult[0].values.forEach(item => {
            const productId = item[0]
            const qty = item[1]
            const priceAt = item[2]
            
            // Get product cost
            const prodResult = db.exec('SELECT name, cost FROM products WHERE id = ?', [productId])
            if (prodResult.length > 0 && prodResult[0].values.length > 0) {
              const productName = prodResult[0].values[0][0]
              const cost = prodResult[0].values[0][1] || 0
              const itemCost = cost * qty
              const itemRevenue = priceAt * qty
              const itemProfit = itemRevenue - itemCost
              
              totalCost += itemCost
              
              if (!productSales[productId]) {
                productSales[productId] = {
                  id: productId,
                  name: productName,
                  unitsSold: 0,
                  revenue: 0,
                  cost: 0,
                  profit: 0
                }
              }
              
              productSales[productId].unitsSold += qty
              productSales[productId].revenue += itemRevenue
              productSales[productId].cost += itemCost
              productSales[productId].profit += itemProfit
            }
          })
        }
      })
      
      const report = {
        totalRevenue,
        totalCost,
        totalProfit: totalRevenue - totalCost,
        orderCount: orders.length,
        productSales: Object.values(productSales).sort((a, b) => b.profit - a.profit)
      }
      
      callback(null, report)
    } catch (e) { callback(e) }
  },
  
  getWeeklySales: (callback) => {
    try {
      // Get all orders
      const ordersResult = db.exec('SELECT * FROM orders')
      if (ordersResult.length === 0 || ordersResult[0].values.length === 0) {
        return callback(null, {
          currentWeek: { itemsSold: 0, orders: 0, revenue: 0 },
          lastWeek: { itemsSold: 0, orders: 0, revenue: 0 },
          weeks: []
        })
      }
      
      const orders = ordersResult[0].values.map(row => ({
        id: row[0], 
        total: row[1], 
        status: row[2],
        createdAt: row[6] || new Date().toISOString()
      }))
      
      // Calculate week boundaries
      const now = new Date()
      const currentWeekStart = new Date(now)
      currentWeekStart.setDate(now.getDate() - now.getDay()) // Start of this week (Sunday)
      currentWeekStart.setHours(0, 0, 0, 0)
      
      const lastWeekStart = new Date(currentWeekStart)
      lastWeekStart.setDate(lastWeekStart.getDate() - 7)
      
      const lastWeekEnd = new Date(currentWeekStart)
      lastWeekEnd.setMilliseconds(-1)
      
      let currentWeekStats = { itemsSold: 0, orders: 0, revenue: 0 }
      let lastWeekStats = { itemsSold: 0, orders: 0, revenue: 0 }
      const weeklyData = {}
      
      orders.forEach(order => {
        const orderDate = new Date(order.createdAt)
        const orderWeekStart = new Date(orderDate)
        orderWeekStart.setDate(orderDate.getDate() - orderDate.getDay())
        orderWeekStart.setHours(0, 0, 0, 0)
        const weekKey = orderWeekStart.toISOString().split('T')[0]
        
        // Get order items count
        const itemsResult = db.exec('SELECT SUM(qty) as total FROM order_items WHERE order_id = ?', [order.id])
        const itemsCount = itemsResult.length > 0 && itemsResult[0].values.length > 0 && itemsResult[0].values[0][0] 
          ? itemsResult[0].values[0][0] 
          : 0
        
        // Track by week
        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = { 
            weekStart: weekKey, 
            itemsSold: 0, 
            orders: 0, 
            revenue: 0 
          }
        }
        weeklyData[weekKey].itemsSold += itemsCount
        weeklyData[weekKey].orders += 1
        weeklyData[weekKey].revenue += order.total
        
        // Current week
        if (orderDate >= currentWeekStart) {
          currentWeekStats.itemsSold += itemsCount
          currentWeekStats.orders += 1
          currentWeekStats.revenue += order.total
        }
        // Last week
        else if (orderDate >= lastWeekStart && orderDate <= lastWeekEnd) {
          lastWeekStats.itemsSold += itemsCount
          lastWeekStats.orders += 1
          lastWeekStats.revenue += order.total
        }
      })
      
      // Sort weeks descending (most recent first)
      const weeks = Object.values(weeklyData).sort((a, b) => 
        new Date(b.weekStart) - new Date(a.weekStart)
      ).slice(0, 8) // Last 8 weeks
      
      callback(null, {
        currentWeek: currentWeekStats,
        lastWeek: lastWeekStats,
        weeks
      })
    } catch (e) { callback(e) }
  },
  
  getCustomerMonthlyStats: (callback) => {
    try {
      // Get all orders
      const ordersResult = db.exec('SELECT * FROM orders')
      if (ordersResult.length === 0 || ordersResult[0].values.length === 0) {
        return callback(null, { customers: [] })
      }
      
      const orders = ordersResult[0].values.map(row => ({
        id: row[0], 
        total: row[1], 
        status: row[2],
        customer: row[5] ? JSON.parse(row[5]) : {},
        createdAt: row[6] || new Date().toISOString()
      }))
      
      // Get current month boundaries
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      
      // Track customer stats by phone number
      const customerStats = {}
      
      orders.forEach(order => {
        const orderDate = new Date(order.createdAt)
        const phone = order.customer?.phone || 'unknown'
        const name = order.customer?.name || 'Unknown'
        
        if (!phone || phone === 'unknown') return
        
        // Initialize customer if not exists
        if (!customerStats[phone]) {
          customerStats[phone] = {
            phone,
            name,
            currentMonth: { orders: 0, itemsCount: 0, totalSpent: 0 },
            allTime: { orders: 0, itemsCount: 0, totalSpent: 0 }
          }
        }
        
        // Get order items count
        const itemsResult = db.exec('SELECT SUM(qty) as total FROM order_items WHERE order_id = ?', [order.id])
        const itemsCount = itemsResult.length > 0 && itemsResult[0].values.length > 0 && itemsResult[0].values[0][0] 
          ? itemsResult[0].values[0][0] 
          : 0
        
        // All time stats
        customerStats[phone].allTime.orders += 1
        customerStats[phone].allTime.itemsCount += itemsCount
        customerStats[phone].allTime.totalSpent += order.total
        
        // Current month stats
        if (orderDate >= monthStart && orderDate <= monthEnd) {
          customerStats[phone].currentMonth.orders += 1
          customerStats[phone].currentMonth.itemsCount += itemsCount
          customerStats[phone].currentMonth.totalSpent += order.total
        }
      })
      
      // Calculate discount eligibility
      // Rules: 
      // - 5% discount if 20+ items this month
      // - 10% discount if 50+ items this month
      // - 15% discount if 100+ items this month
      const customers = Object.values(customerStats).map(c => {
        let discountPercent = 0
        let discountReason = ''
        
        if (c.currentMonth.itemsCount >= 100) {
          discountPercent = 15
          discountReason = '100+ items this month'
        } else if (c.currentMonth.itemsCount >= 50) {
          discountPercent = 10
          discountReason = '50+ items this month'
        } else if (c.currentMonth.itemsCount >= 20) {
          discountPercent = 5
          discountReason = '20+ items this month'
        }
        
        return {
          ...c,
          discountPercent,
          discountReason,
          eligible: discountPercent > 0
        }
      }).sort((a, b) => b.currentMonth.itemsCount - a.currentMonth.itemsCount)
      
      callback(null, { customers })
    } catch (e) { callback(e) }
  },
  
  checkCustomerDiscount: (phone, callback) => {
    try {
      if (!phone) return callback(null, { eligible: false, discountPercent: 0 })
      
      // Get customer's current month orders
      const ordersResult = db.exec('SELECT * FROM orders')
      if (ordersResult.length === 0 || ordersResult[0].values.length === 0) {
        return callback(null, { eligible: false, discountPercent: 0 })
      }
      
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      
      let totalItems = 0
      let totalSpent = 0
      let ordersCount = 0
      
      const orders = ordersResult[0].values.map(row => ({
        id: row[0],
        total: row[1],
        customer: row[5] ? JSON.parse(row[5]) : {},
        createdAt: row[6] || new Date().toISOString()
      }))
      
      orders.forEach(order => {
        const orderDate = new Date(order.createdAt)
        const customerPhone = order.customer?.phone || ''
        
        if (customerPhone === phone && orderDate >= monthStart && orderDate <= monthEnd) {
          ordersCount += 1
          totalSpent += order.total
          
          // Get items count
          const itemsResult = db.exec('SELECT SUM(qty) as total FROM order_items WHERE order_id = ?', [order.id])
          const itemsCount = itemsResult.length > 0 && itemsResult[0].values.length > 0 && itemsResult[0].values[0][0] 
            ? itemsResult[0].values[0][0] 
            : 0
          totalItems += itemsCount
        }
      })
      
      // Calculate discount
      let discountPercent = 0
      let message = ''
      
      if (totalItems >= 100) {
        discountPercent = 15
        message = `🎉 Loyalty Discount: ${discountPercent}% off! You've ordered ${totalItems} items this month.`
      } else if (totalItems >= 50) {
        discountPercent = 10
        message = `🎉 Loyalty Discount: ${discountPercent}% off! You've ordered ${totalItems} items this month.`
      } else if (totalItems >= 20) {
        discountPercent = 5
        message = `🎉 Loyalty Discount: ${discountPercent}% off! You've ordered ${totalItems} items this month.`
      } else {
        const remaining = 20 - totalItems
        message = `Order ${remaining} more items this month to get 5% discount!`
      }
      
      callback(null, {
        eligible: discountPercent > 0,
        discountPercent,
        message,
        monthlyItems: totalItems,
        monthlySpent: totalSpent,
        monthlyOrders: ordersCount
      })
    } catch (e) { callback(e) }  }
}

function ensureShiftColumns() {
  const info = db.exec('PRAGMA table_info(shifts)')
  const existing = info.length > 0 ? info[0].values.map(r => r[1]) : []
  const addColumnIfMissing = (name, type) => {
    if (!existing.includes(name)) {
      db.run(`ALTER TABLE shifts ADD COLUMN ${name} ${type}`)
    }
  }
  addColumnIfMissing('branchId', 'INTEGER')
  addColumnIfMissing('branchName', 'TEXT')
}

function ensureAuditColumns() {
  const info = db.exec('PRAGMA table_info(audit_log)')
  const existing = info.length > 0 ? info[0].values.map(r => r[1]) : []
  const addColumnIfMissing = (name, type) => {
    if (!existing.includes(name)) {
      db.run(`ALTER TABLE audit_log ADD COLUMN ${name} ${type}`)
    }
  }
  addColumnIfMissing('branchId', 'INTEGER')
  addColumnIfMissing('branchName', 'TEXT')
}

function ensureCashMovementColumns() {
  const info = db.exec('PRAGMA table_info(cash_movements)')
  const existing = info.length > 0 ? info[0].values.map(r => r[1]) : []
  const addColumnIfMissing = (name, type) => {
    if (!existing.includes(name)) {
      db.run(`ALTER TABLE cash_movements ADD COLUMN ${name} ${type}`)
    }
  }
  addColumnIfMissing('branchId', 'INTEGER')
  addColumnIfMissing('branchName', 'TEXT')
}