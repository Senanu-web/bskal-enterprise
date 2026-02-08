const apiBaseFromDom = document.documentElement?.dataset?.apiBase?.trim() || ''
const API_BASE = (window.API_BASE || apiBaseFromDom || '').trim() || `${location.origin}/api`

function token() { return localStorage.getItem('adminToken') || '' }
function setAdminCookie(v) {
  if (!v) return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `adminToken=${encodeURIComponent(v)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`
}
function clearAdminCookie() {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `adminToken=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}
function setToken(v) {
  localStorage.setItem('adminToken', v)
  setAdminCookie(v)
}

async function fetchWithToken(path, opts = {}) {
  opts.headers = { ...(opts.headers || {}), 'x-admin-token': token(), 'Content-Type': 'application/json' }
  const res = await fetch(`${API_BASE}${path}`, opts)
  if (res.status === 401) return { error: 'Unauthorized - invalid admin token' }
  return res.json()
}

// Calculate profit margin percentage
function calculateMargin(sellPrice, costPrice) {
  if (!sellPrice || sellPrice <= 0) return 0
  const profit = sellPrice - costPrice
  return (profit / sellPrice * 100).toFixed(1)
}

// Calculate profit per unit
function calculateProfit(sellPrice, costPrice) {
  return (sellPrice - costPrice).toFixed(2)
}

function renderProducts(list) {
  const el = document.getElementById('products')
  if (!list || list.length === 0) { el.innerHTML = '<p>No products</p>'; return }
  let html = '<table class="admin-table"><tr><th>ID</th><th>Name</th><th>Sell Price (GH₵)</th><th>Cost Price (GH₵)</th><th>Profit/Unit</th><th>Margin %</th><th>Stock</th><th>Actions</th></tr>'
  list.forEach(p => {
    const margin = calculateMargin(p.price, p.cost || 0)
    const profit = calculateProfit(p.price, p.cost || 0)
    const marginColor = margin >= 30 ? '#22c55e' : margin >= 15 ? '#f59e0b' : '#ef4444'
    html += `<tr>
      <td>${p.id}</td>
      <td><input id="name-${p.id}" value="${p.name}" style="width:100%" /></td>
      <td><input id="price-${p.id}" type="number" step="0.01" value="${p.price}" style="width:80px" /></td>
      <td><input id="cost-${p.id}" type="number" step="0.01" value="${p.cost || 0}" style="width:80px" /></td>
      <td style="font-weight:600; color:${marginColor}">GH₵ ${profit}</td>
      <td style="font-weight:600; color:${marginColor}">${margin}%</td>
      <td><input id="stock-${p.id}" type="number" step="0.5" value="${p.stock}" style="width:80px" /></td>
      <td>
        <button data-id="${p.id}" class="saveProduct" style="background:var(--primary); color:#fff; margin-right:4px">Save</button>
        <input id="add-${p.id}" placeholder="+stock" style="width:60px"/>
        <button data-id="${p.id}" class="restock" style="background:var(--accent); color:#000">Add</button>
      </td>
    </tr>`
  })
  html += '</table>'
  el.innerHTML = html
  
  // Save product changes
  document.querySelectorAll('.saveProduct').forEach(b => b.addEventListener('click', async (e) => {
    const id = e.target.dataset.id
    const name = document.getElementById(`name-${id}`).value.trim()
    const price = Number(document.getElementById(`price-${id}`).value)
    const cost = Number(document.getElementById(`cost-${id}`).value)
    const stock = Number(document.getElementById(`stock-${id}`).value)
    
    if (!name) return alert('Name cannot be empty')
    if (!price || price <= 0) return alert('Price must be greater than 0')
    if (cost < 0) return alert('Cost cannot be negative')
    if (stock < 0) return alert('Stock cannot be negative')
    
    // Warn if margin is too low
    const margin = calculateMargin(price, cost)
    if (margin < 10 && cost > 0) {
      if (!confirm(`Warning: Low profit margin (${margin}%). Continue?`)) return
    }
    
    const res = await fetchWithToken(`/admin/products/${id}`, { 
      method: 'PUT', 
      body: JSON.stringify({ name, price, cost, stock }) 
    })
    if (res.error) return alert(res.error)
    
    const profit = calculateProfit(res.product.price, res.product.cost)
    const newMargin = calculateMargin(res.product.price, res.product.cost)
    alert(`Product updated: ${res.product.name}\nProfit per unit: GH₵ ${profit}\nMargin: ${newMargin}%`)
    
    // Reload products to update display
    const products = await fetchWithToken('/admin/products')
    if (!products.error) renderProducts(products)
  }))
  
  // Restock (add to existing stock)
  document.querySelectorAll('.restock').forEach(b => b.addEventListener('click', async (e) => {
    const id = e.target.dataset.id
    const amount = Number(document.getElementById(`add-${id}`).value) || 0
    if (!amount) return alert('Enter amount to add')
    const res = await fetchWithToken(`/admin/products/${id}/restock`, { method: 'POST', body: JSON.stringify({ amount }) })
    if (res.error) return alert(res.error)
    document.getElementById(`stock-${id}`).value = res.product.stock
    document.getElementById(`add-${id}`).value = ''
  }))
}

function renderOrders(list) {
  const el = document.getElementById('orders')
  if (!list || list.length === 0) { el.innerHTML = '<p>No orders</p>'; return }
  let html = '<table class="admin-table"><tr><th>ID</th><th>Customer</th><th>Total</th><th>Status</th><th>Update</th></tr>'
  list.forEach(o => {
    html += `<tr><td>${o.id}</td><td>${o.customer?.name || ''} ${o.customer?.phone || ''}</td><td>GH₵ ${o.total}</td><td id="status-${o.id}">${o.status}</td><td><select id="statusSel-${o.id}"><option>Placed</option><option>Processing</option><option>Dispatched</option><option>Delivered</option></select><button data-id="${o.id}" class="setStatus">Set</button></td></tr>`
  })
  html += '</table>'
  el.innerHTML = html
  document.querySelectorAll('.setStatus').forEach(b => b.addEventListener('click', async (e) => {
    const id = e.target.dataset.id
    const status = document.getElementById(`statusSel-${id}`).value
    const res = await fetchWithToken(`/admin/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
    if (res.error) return alert(res.error)
    document.getElementById(`status-${id}`).innerText = res.order.status
  }))
}

// UI events
window.addEventListener('DOMContentLoaded', () => {
  const tokenParam = new URLSearchParams(window.location.search).get('token')
  if (tokenParam) {
    setToken(tokenParam.trim())
    if (history.replaceState) history.replaceState({}, document.title, window.location.pathname)
  }
  document.getElementById('setToken').addEventListener('click', () => {
    const v = document.getElementById('adminToken').value.trim()
    if (!v) return alert('Enter token')
    setToken(v)
    alert('Admin token set')
  })
  document.getElementById('logoutAdmin').addEventListener('click', async () => {
    try {
      await fetch('/admin/logout', { method: 'POST' })
    } catch (err) {
      // ignore network errors
    }
    localStorage.removeItem('adminToken')
    clearAdminCookie()
    window.location.href = '/admin-login.html'
  })
  document.getElementById('loadProducts').addEventListener('click', async () => {
    const res = await fetchWithToken('/admin/products')
    if (res.error) return alert(res.error)
    renderProducts(res)
  })
  document.getElementById('loadOrders').addEventListener('click', async () => {
    const res = await fetchWithToken('/admin/orders')
    if (res.error) return alert(res.error)
    renderOrders(res)
  })
  
  document.getElementById('loadProfitLoss').addEventListener('click', async () => {
    const res = await fetchWithToken('/admin/profit-loss')
    if (res.error) return alert(res.error)
    
    // Show the section
    document.getElementById('profitLossSection').style.display = 'block'
    
    // Update summary cards
    document.getElementById('totalRevenue').textContent = `GH₵ ${res.totalRevenue.toFixed(2)}`
    document.getElementById('totalCost').textContent = `GH₵ ${res.totalCost.toFixed(2)}`
    document.getElementById('netProfit').textContent = `GH₵ ${res.totalProfit.toFixed(2)}`
    document.getElementById('orderCount').textContent = res.orderCount
    
    // Render product performance table
    const perfEl = document.getElementById('productPerformance')
    if (!res.productSales || res.productSales.length === 0) {
      perfEl.innerHTML = '<p style="color:#666">No sales data available yet. Products will appear here after orders are placed.</p>'
    } else {
      let html = '<table class="admin-table"><tr><th>Product</th><th>Units Sold</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin %</th></tr>'
      res.productSales.forEach(p => {
        const margin = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : 0
        const profitClass = p.profit >= 0 ? 'color:#22c55e' : 'color:#ef4444'
        html += `<tr>
          <td>${p.name}</td>
          <td>${p.unitsSold.toFixed(1)}</td>
          <td>GH₵ ${p.revenue.toFixed(2)}</td>
          <td>GH₵ ${p.cost.toFixed(2)}</td>
          <td style="${profitClass}; font-weight:600">GH₵ ${p.profit.toFixed(2)}</td>
          <td style="${profitClass}">${margin}%</td>
        </tr>`
      })
      html += '</table>'
      perfEl.innerHTML = html
    }
  })
  
  document.getElementById('loadWeeklySales').addEventListener('click', async () => {
    const res = await fetchWithToken('/admin/weekly-sales')
    if (res.error) return alert(res.error)
    
    // Show the section
    document.getElementById('weeklySalesSection').style.display = 'block'
    
    // Update current week stats
    document.getElementById('currentWeekItems').textContent = `${res.currentWeek.itemsSold} items`
    document.getElementById('currentWeekOrders').textContent = `${res.currentWeek.orders} orders • GH₵ ${res.currentWeek.revenue.toFixed(2)}`
    
    // Update last week stats
    document.getElementById('lastWeekItems').textContent = `${res.lastWeek.itemsSold} items`
    document.getElementById('lastWeekOrders').textContent = `${res.lastWeek.orders} orders • GH₵ ${res.lastWeek.revenue.toFixed(2)}`
    
    // Calculate comparison
    const diff = res.currentWeek.itemsSold - res.lastWeek.itemsSold
    const percentChange = res.lastWeek.itemsSold > 0 
      ? ((diff / res.lastWeek.itemsSold) * 100).toFixed(1) 
      : (res.currentWeek.itemsSold > 0 ? '+100' : '0')
    const comparisonColor = diff >= 0 ? '#22c55e' : '#ef4444'
    const arrow = diff >= 0 ? '↑' : '↓'
    document.getElementById('weekComparison').innerHTML = `<span style="color:${comparisonColor}">${arrow} ${Math.abs(diff)} (${percentChange}%)</span>`
    
    // Render weekly history table
    const historyEl = document.getElementById('weeklyHistory')
    if (!res.weeks || res.weeks.length === 0) {
      historyEl.innerHTML = '<p style="color:#666">No sales history available yet.</p>'
    } else {
      let html = '<table class="admin-table"><tr><th>Week Starting</th><th>Items Sold</th><th>Orders</th><th>Revenue</th></tr>'
      res.weeks.forEach(week => {
        const weekDate = new Date(week.weekStart)
        const weekLabel = weekDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        html += `<tr>
          <td>${weekLabel}</td>
          <td style="font-weight:600">${week.itemsSold}</td>
          <td>${week.orders}</td>
          <td>GH₵ ${week.revenue.toFixed(2)}</td>
        </tr>`
      })
      html += '</table>'
      historyEl.innerHTML = html
    }
  })
  
  document.getElementById('loadCustomerDiscounts').addEventListener('click', async () => {
    const res = await fetchWithToken('/admin/customer-discounts')
    if (res.error) return alert(res.error)
    
    // Show the section
    document.getElementById('customerDiscountsSection').style.display = 'block'
    
    // Render customer discounts table
    const listEl = document.getElementById('customerDiscountsList')
    const eligible = res.customers.filter(c => c.eligible)
    const notEligible = res.customers.filter(c => !c.eligible).slice(0, 10) // Top 10 non-eligible
    
    if (eligible.length === 0 && notEligible.length === 0) {
      listEl.innerHTML = '<p style="color:#666">No customer data available yet.</p>'
    } else {
      let html = ''
      
      if (eligible.length > 0) {
        html += '<h4 style="color:var(--success); margin-top:0">✅ Eligible for Discount (' + eligible.length + ')</h4>'
        html += '<table class="admin-table"><tr><th>Customer</th><th>Phone</th><th>This Month</th><th>All Time</th><th>Discount</th></tr>'
        eligible.forEach(c => {
          const badgeColor = c.discountPercent >= 15 ? '#fbbf24' : c.discountPercent >= 10 ? '#c0c0c0' : '#cd7f32'
          html += `<tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.phone}</td>
            <td>
              <div><strong>${c.currentMonth.itemsCount} items</strong> (${c.currentMonth.orders} orders)</div>
              <div style="font-size:0.9rem; color:#666">GH₵ ${c.currentMonth.totalSpent.toFixed(2)}</div>
            </td>
            <td>
              <div>${c.allTime.itemsCount} items (${c.allTime.orders} orders)</div>
              <div style="font-size:0.9rem; color:#666">GH₵ ${c.allTime.totalSpent.toFixed(2)}</div>
            </td>
            <td>
              <span style="background:${badgeColor}; color:#fff; padding:4px 12px; border-radius:12px; font-weight:700">
                ${c.discountPercent}% OFF
              </span>
              <div style="font-size:0.85rem; color:#666; margin-top:4px">${c.discountReason}</div>
            </td>
          </tr>`
        })
        html += '</table>'
      }
      
      if (notEligible.length > 0) {
        html += '<h4 style="margin-top:24px">📊 Top Customers (Not Yet Eligible)</h4>'
        html += '<table class="admin-table"><tr><th>Customer</th><th>Phone</th><th>This Month</th><th>To Next Tier</th></tr>'
        notEligible.forEach(c => {
          let nextTier = 20
          if (c.currentMonth.itemsCount >= 50) nextTier = 100
          else if (c.currentMonth.itemsCount >= 20) nextTier = 50
          const remaining = nextTier - c.currentMonth.itemsCount
          
          html += `<tr>
            <td>${c.name}</td>
            <td>${c.phone}</td>
            <td>${c.currentMonth.itemsCount} items (${c.currentMonth.orders} orders)</td>
            <td style="color:#f59e0b">${remaining} more items for ${nextTier >= 100 ? '15' : nextTier >= 50 ? '10' : '5'}% discount</td>
          </tr>`
        })
        html += '</table>'
      }
      
      listEl.innerHTML = html
    }
  })
  
  document.getElementById('addProduct').addEventListener('click', async () => {
    const name = document.getElementById('newProductName').value.trim()
    const price = Number(document.getElementById('newProductPrice').value)
    const cost = Number(document.getElementById('newProductCost').value)
    const stock = Number(document.getElementById('newProductStock').value)
    
    if (!name) return alert('Enter product name')
    if (!price || price <= 0) return alert('Enter valid selling price')
    if (cost < 0) return alert('Cost price cannot be negative')
    if (stock === undefined || stock < 0) return alert('Enter valid stock')
    
    // Calculate and show profit info
    const profit = calculateProfit(price, cost)
    const margin = calculateMargin(price, cost)
    
    // Warn if margin is too low
    if (margin < 10 && cost > 0) {
      if (!confirm(`Warning: Low profit margin (${margin}%).\nProfit per unit: GH₵ ${profit}\n\nContinue adding this product?`)) return
    }
    
    const res = await fetchWithToken('/admin/products', { 
      method: 'POST', 
      body: JSON.stringify({ name, price, cost, stock }) 
    })
    
    if (res.error) return alert(res.error)
    
    alert(`Product "${res.product.name}" added successfully!\n\nID: ${res.product.id}\nSelling Price: GH₵ ${price.toFixed(2)}\nCost Price: GH₵ ${cost.toFixed(2)}\nProfit per unit: GH₵ ${profit}\nMargin: ${margin}%`)    
    // Clear form
    document.getElementById('newProductName').value = ''
    document.getElementById('newProductPrice').value = ''
    document.getElementById('newProductCost').value = ''
    document.getElementById('newProductStock').value = ''
    
    // Reload products
    const products = await fetchWithToken('/admin/products')
    if (!products.error) renderProducts(products)
  })
  
  // prefill token input with saved
  document.getElementById('adminToken').value = localStorage.getItem('adminToken') || ''
})