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
  let html = '<table class="admin-table"><tr><th>ID</th><th>Name</th><th>Price</th><th>Stock</th><th>Restock</th></tr>'
  list.forEach(p => {
    html += `<tr><td>${p.id}</td><td>${p.name}</td><td>GH₵ ${p.price}</td><td id="stock-${p.id}">${p.stock}</td><td><input id="add-${p.id}" style="width:80px"/><button data-id="${p.id}" class="restock">Add</button></td></tr>`
  })
  html += '</table>'
  el.innerHTML = html
  document.querySelectorAll('.restock').forEach(b => b.addEventListener('click', async (e) => {
    const id = e.target.dataset.id
    const amount = Number(document.getElementById(`add-${id}`).value) || 0
    if (!amount) return alert('Enter amount')
    const res = await fetchWithToken(`/admin/products/${id}/restock`, { method: 'POST', body: JSON.stringify({ amount }) })
    if (res.error) return alert(res.error)
    document.getElementById(`stock-${id}`).innerText = res.product.stock
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
  // prefill token input with saved
  document.getElementById('adminToken').value = localStorage.getItem('adminToken') || ''
})