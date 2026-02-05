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
      cost REAL DEFAULT 0,
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
      ...beverages.map(b => ({ id: b.id, name: b.name, price: b.price, cost: b.cost || 0, stock: b.stock })),
      ...meats.map(m => ({ id: m.id, name: m.name, price: m.pricePerKg, cost: m.cost || 0, stock: m.stockKg }))
    ]
    rows.forEach(r => {
      db.run('INSERT INTO products (id, name, price, cost, stock) VALUES (?, ?, ?, ?, ?)', [r.id, r.name, r.price, r.cost, r.stock])
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
        id: row[0], name: row[1], price: row[2], cost: row[3], stock: row[4]
      })) : []
      callback(null, products)
    } catch (e) { callback(e) }
  },
  
  getProductById: (id, callback) => {
    try {
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4]
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
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4]
      } : null
      saveDb()
      callback(null, product)
    } catch (e) { callback(e) }
  },
  
  updateProduct: (id, { name, price, cost, stock }, callback) => {
    try {
      const updates = []
      const params = []
      
      if (name !== undefined) { updates.push('name = ?'); params.push(name) }
      if (price !== undefined) { updates.push('price = ?'); params.push(price) }
      if (cost !== undefined) { updates.push('cost = ?'); params.push(cost) }
      if (stock !== undefined) { updates.push('stock = ?'); params.push(stock) }
      
      if (updates.length === 0) return callback(new Error('No fields to update'))
      
      params.push(id)
      db.run(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params)
      
      const result = db.exec('SELECT * FROM products WHERE id = ?', [id])
      const product = result.length > 0 && result[0].values.length > 0 ? {
        id: result[0].values[0][0], name: result[0].values[0][1], price: result[0].values[0][2], cost: result[0].values[0][3], stock: result[0].values[0][4]
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
  },
  
  createProduct: ({ name, price, cost, stock }, callback) => {
    try {
      // Get max ID to avoid conflicts
      const result = db.exec('SELECT MAX(id) as maxId FROM products')
      const maxId = result.length > 0 && result[0].values.length > 0 && result[0].values[0][0] ? result[0].values[0][0] : 0
      const newId = maxId + 1
      
      db.run('INSERT INTO products (id, name, price, cost, stock) VALUES (?, ?, ?, ?, ?)', [newId, name, price, cost || 0, stock])
      saveDb()
      
      const product = { id: newId, name, price, cost: cost || 0, stock }
      callback(null, product)
    } catch (e) { callback(e) }
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