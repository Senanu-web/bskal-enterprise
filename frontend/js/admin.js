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

function renderProducts(list) {
  const el = document.getElementById('products')
  if (!list || list.length === 0) { el.innerHTML = '<p>No products</p>'; return }
  let html = '<table class="admin-table"><tr><th>ID</th><th>Name</th><th>Price (GH₵)</th><th>Stock</th><th>Actions</th></tr>'
  list.forEach(p => {
    html += `<tr>
      <td>${p.id}</td>
      <td><input id="name-${p.id}" value="${p.name}" style="width:100%" /></td>
      <td><input id="price-${p.id}" type="number" step="0.01" value="${p.price}" style="width:80px" /></td>
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
    const stock = Number(document.getElementById(`stock-${id}`).value)
    
    if (!name) return alert('Name cannot be empty')
    if (!price || price <= 0) return alert('Price must be greater than 0')
    if (stock < 0) return alert('Stock cannot be negative')
    
    const res = await fetchWithToken(`/admin/products/${id}`, { 
      method: 'PUT', 
      body: JSON.stringify({ name, price, stock }) 
    })
    if (res.error) return alert(res.error)
    alert(`Product updated: ${res.product.name}`)
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
  
  document.getElementById('addProduct').addEventListener('click', async () => {
    const name = document.getElementById('newProductName').value.trim()
    const price = Number(document.getElementById('newProductPrice').value)
    const stock = Number(document.getElementById('newProductStock').value)
    
    if (!name) return alert('Enter product name')
    if (!price || price <= 0) return alert('Enter valid price')
    if (stock === undefined || stock < 0) return alert('Enter valid stock')
    
    const res = await fetchWithToken('/admin/products', { 
      method: 'POST', 
      body: JSON.stringify({ name, price, stock }) 
    })
    
    if (res.error) return alert(res.error)
    
    alert(`Product "${res.product.name}" added successfully! (ID: ${res.product.id})`)
    
    // Clear form
    document.getElementById('newProductName').value = ''
    document.getElementById('newProductPrice').value = ''
    document.getElementById('newProductStock').value = ''
    
    // Reload products
    const products = await fetchWithToken('/admin/products')
    if (!products.error) renderProducts(products)
  })
  
  // prefill token input with saved
  document.getElementById('adminToken').value = localStorage.getItem('adminToken') || ''
})