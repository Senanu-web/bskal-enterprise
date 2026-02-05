const path = require('path')
const fs = require('fs')
const initSqlJs = require('sql.js')

const DB_PATH = path.join(__dirname, 'data.sqlite')

let SQL = null
let db = null
let dbData = null

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
      stock REAL NOT NULL
    )
  `)
  
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
  
  // Seed products if empty
  const result = db.exec('SELECT COUNT(1) as c FROM products')
  const count = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0
  
  if (count === 0) {
    const { beverages, meats } = require('./data-demo')
    const rows = [
      ...beverages.map(b => ({ id: b.id, name: b.name, price: b.price, stock: b.stock })),
      ...meats.map(m => ({ id: m.id, name: m.name, price: m.pricePerKg, stock: m.stockKg }))
    ]
    rows.forEach(r => {
      db.run('INSERT INTO products (id, name, price, stock) VALUES (?, ?, ?, ?)', [r.id, r.name, r.price, r.stock])
    })
    saveDb()
  }
}

function saveDb() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

function parseOrderRow(row) {
  if (!row) return null
  return {
    ...row,
    delivery: row.delivery ? JSON.parse(row.delivery) : {},
    payment: row.payment ? JSON.parse(row.payment) : {},
    customer: row.customer ? JSON.parse(row.customer) : {}
  }
}

// Exported functions for API (using callbacks to match other code)
module.exports = {
  init: initDb,
  
  getProducts: (callback) => {
    try {
      const result = db.exec('SELECT * FROM products ORDER BY id')
      const products = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], name: row[1], price: row[2], stock: row[3]
      })) : []
      callback(null, products)
    } catch (e) { callback(e) }
  },
  
  getProductById: (id, callback) => {
    try {
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], stock: result[0].values[0][3]
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
      db.run('UPDATE products SET stock = stock + ? WHERE id = ?', [amount, id])
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], stock: result[0].values[0][3]
      } : null
      saveDb()
      callback(null, product)
    } catch (e) { callback(e) }
  },
  
  createOrder: ({ items, delivery, payment, customer, total }, callback) => {
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
      db.run('INSERT INTO orders (total, status, delivery, payment, customer, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [total, 'Placed', JSON.stringify(delivery || {}), JSON.stringify(payment || {}), JSON.stringify(customer || {}), now])
      
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
      const result = db.exec('SELECT * FROM orders ORDER BY id DESC')
      const orders = result.length > 0 ? result[0].values.map(row => ({
        id: row[0], total: row[1], status: row[2], delivery: row[3], payment: row[4], customer: row[5], createdAt: row[6]
      })) : []
      
      // Add items for each order
      orders.forEach(o => {
        const itemResult = db.exec('SELECT * FROM order_items WHERE order_id = ?', [o.id])
        o.items = itemResult.length > 0 ? itemResult[0].values.map(row => ({
          id: row[0], order_id: row[1], product_id: row[2], qty: row[3], price_at: row[4]
        })) : []
      })
      
      callback(null, orders.map(parseOrderRow))
    } catch (e) { callback(e) }
  },
  
  getOrderById: (id, callback) => {
    try {
      const result = db.exec('SELECT * FROM orders WHERE id = ?', [id])
      if (result.length === 0 || result[0].values.length === 0) {
        return callback(null, null)
      }
      const row = result[0].values[0]
      const order = {
        id: row[0], total: row[1], status: row[2], delivery: row[3], payment: row[4], customer: row[5], createdAt: row[6]
      }
      
      const itemResult = db.exec('SELECT * FROM order_items WHERE order_id = ?', [id])
      order.items = itemResult.length > 0 ? itemResult[0].values.map(r => ({
        id: r[0], order_id: r[1], product_id: r[2], qty: r[3], price_at: r[4]
      })) : []
      
      callback(null, parseOrderRow(order))
    } catch (e) { callback(e) }
  },
  
  setOrderStatus: (id, status, callback) => {
    try {
      db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id])
      saveDb()
      module.exports.getOrderById(id, callback)
    } catch (e) { callback(e) }
  }
}
