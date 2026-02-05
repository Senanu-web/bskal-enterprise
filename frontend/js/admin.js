const apiBaseFromDom = document.documentElement?.dataset?.apiBase?.trim() || ''
const API_BASE = (window.API_BASE || apiBaseFromDom || '').trim() || `${location.origin}/api`

function token() { return localStorage.getItem('adminToken') || '' }
function setToken(v) { localStorage.setItem('adminToken', v) }

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
  document.getElementById('setToken').addEventListener('click', () => {
    const v = document.getElementById('adminToken').value.trim()
    if (!v) return alert('Enter token')
    setToken(v)
    alert('Admin token set')
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