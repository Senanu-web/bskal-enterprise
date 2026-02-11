const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' })

let state = null
let cart = []
let searchTerm = ''
let backendUnavailable = false

const $ = (id) => document.getElementById(id)

function showFatal(message) {
  const status = $('syncStatus')
  if (status) status.textContent = message
  const badge = $('staffBadge')
  if (badge) badge.textContent = ''
  console.error(message)
}

function formatMoney(value) {
  const num = Number(value || 0)
  return money.format(Number.isFinite(num) ? num : 0)
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function setOverlayVisible(show) {
  const overlay = $('loginOverlay')
  if (!overlay) return
  overlay.classList.toggle('show', show)
}

function renderStaffBadge() {
  const badge = $('staffBadge')
  if (!badge) return
  if (!state?.currentStaff) {
    badge.textContent = ''
    return
  }
  badge.textContent = `${state.currentStaff.name} (${state.currentStaff.role})`
}

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'))
  document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'))
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add('active')
  document.getElementById(tab)?.classList.add('active')
}

function updateSyncStatus() {
  const online = navigator.onLine && !backendUnavailable
  const pending = state?.pendingChanges?.length || 0
  const status = online ? `Online • ${pending} pending` : `Offline • ${pending} pending`
  $('syncStatus').textContent = status
  const offlineBadge = $('offlineBadge')
  if (offlineBadge) offlineBadge.style.display = online ? 'none' : 'inline-block'
}

function setBackendAvailability(available) {
  backendUnavailable = !available
  updateSyncStatus()
  applyRoleAccess()
}

async function probeBackend() {
  const apiBase = state?.settings?.apiBase
  if (!apiBase) {
    setBackendAvailability(false)
    return false
  }
  try {
    const res = await fetch(`${apiBase}/products`)
    if (!res.ok) throw new Error('Backend unavailable')
    setBackendAvailability(true)
    return true
  } catch (err) {
    setBackendAvailability(false)
    return false
  }
}

function applyRoleAccess() {
  const role = state?.currentStaff?.role
  const tabs = document.querySelectorAll('.tab')
  if (!navigator.onLine || backendUnavailable) {
    tabs.forEach(btn => btn.style.display = '')
    applySettingsAccess()
    return
  }
  if (!role) {
    tabs.forEach(btn => btn.style.display = '')
    applySettingsAccess()
    return
  }
  const cashierAllowed = new Set(['sales', 'orders', 'tracking', 'settings'])
  tabs.forEach(btn => {
    const tab = btn.dataset.tab
    if (role === 'manager') {
      btn.style.display = ''
      return
    }
    btn.style.display = cashierAllowed.has(tab) ? '' : 'none'
  })
  if (role !== 'manager') {
    if (!cashierAllowed.has(document.querySelector('.tab.active')?.dataset.tab)) {
      setActiveTab('sales')
    }
  }
  applySettingsAccess()
}

function applySettingsAccess() {
  const isManager = state?.currentStaff?.role === 'manager'
  const allowAll = !navigator.onLine || backendUnavailable
  const branchCard = $('settingsBranches')
  const staffCard = $('settingsStaff')
  if (branchCard) branchCard.style.display = (isManager || allowAll) ? '' : 'none'
  if (staffCard) staffCard.style.display = (isManager || allowAll) ? '' : 'none'
}

async function staffFetch(path, options = {}) {
  const apiBase = state.settings?.apiBase
  const token = state.settings?.staffToken
  if (!navigator.onLine || backendUnavailable) throw new Error('Offline')
  if (!apiBase || !token) throw new Error('Missing staff token')
  const opts = { ...options }
  opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json', 'x-staff-token': token }
  try {
    const res = await fetch(`${apiBase}${path}`, opts)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed')
    setBackendAvailability(true)
    return data
  } catch (err) {
    setBackendAvailability(false)
    throw err
  }
}

function ensureLoginState() {
  if (!state.currentStaff) {
    setOverlayVisible(true)
  } else {
    setOverlayVisible(false)
  }
}

async function handleLogin() {
  const username = $('loginUsername').value.trim()
  const password = $('loginPassword').value
  const name = $('loginName').value.trim()
  const status = $('loginStatus')
  const apiBase = state.settings?.apiBase

  if (!username || !password) {
    status.textContent = 'Username and password required.'
    return
  }

  if (!apiBase) {
    status.textContent = 'Set API Base URL in Connection Settings.'
    return
  }

  try {
    if (!navigator.onLine || backendUnavailable) {
      const offlineOk = await handleOfflineCredentials({ username, password, name })
      if (!offlineOk) return
      status.textContent = 'Offline login successful.'
      ensureLoginState()
      applyRoleAccess()
      renderStaffBadge()
      updateSyncStatus()
      return
    }
    const loginRes = await fetch(`${apiBase}/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const loginData = await loginRes.json()
    if (!loginRes.ok && loginData.code === 'no_staff') {
      if (!name) {
        status.textContent = 'Enter full name to create first manager.'
        return
      }
      const bootRes = await fetch(`${apiBase}/staff/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password })
      })
      const bootData = await bootRes.json()
      if (!bootRes.ok) throw new Error(bootData.error || 'Bootstrap failed')
      status.textContent = 'Manager created. Logging in...'
      return handleLogin()
    }
    if (!loginRes.ok) throw new Error(loginData.error || 'Login failed')
    state.settings.staffToken = loginData.token
    state.currentStaff = loginData.staff
    state.lastStaff = loginData.staff
    await upsertLocalStaff({
      id: loginData.staff.id,
      name: loginData.staff.name,
      username: loginData.staff.username,
      role: loginData.staff.role,
      password
    })
    await persistState()
    setBackendAvailability(true)
    status.textContent = ''
    ensureLoginState()
    applyRoleAccess()
    await loadBranches()
    await loadCurrentShift()
    await renderStaffList()
  } catch (err) {
    if (!navigator.onLine || err?.message?.includes('fetch')) {
      setBackendAvailability(false)
    }
    status.textContent = err.message || 'Login failed.'
  }
}

async function handleLogout() {
  if (!state) return
  state.currentStaff = null
  state.currentShift = null
  state.settings.staffToken = ''
  state.branches = []
  await persistState()
  setOverlayVisible(true)
  ensureLoginState()
  applyRoleAccess()
  applySettingsAccess()
}

async function handleOfflineLogin() {
  const status = $('loginStatus')
  if (!state?.lastStaff) {
    status.textContent = 'No cached staff. Login online once first.'
    return
  }
  state.currentStaff = state.lastStaff
  await persistState()
  status.textContent = 'Offline mode enabled.'
  ensureLoginState()
  applyRoleAccess()
  renderStaffBadge()
  updateSyncStatus()
}

async function handleOfflineCredentials({ username, password, name }) {
  const status = $('loginStatus')
  if (!username || !password) {
    status.textContent = 'Username and password required.'
    return false
  }

  const localUsers = state.staffUsers || []
  if (localUsers.length === 0) {
    if (!name) {
      status.textContent = 'Enter full name to create first manager (offline).'
      return false
    }
    const passwordHash = await hashPassword(password)
    const newUser = {
      id: Date.now(),
      name,
      username,
      role: 'manager',
      passwordHash,
      active: true
    }
    state.staffUsers = [newUser]
    state.currentStaff = { id: newUser.id, name: newUser.name, username: newUser.username, role: newUser.role }
    state.lastStaff = state.currentStaff
    await persistState()
    return true
  }

  const passwordHash = await hashPassword(password)
  const found = localUsers.find(u => u.username === username && u.active !== false)
  if (!found || found.passwordHash !== passwordHash) {
    status.textContent = 'Offline login failed.'
    return false
  }
  state.currentStaff = { id: found.id, name: found.name, username: found.username, role: found.role }
  state.lastStaff = state.currentStaff
  await persistState()
  return true
}

async function upsertLocalStaff({ id, name, username, role, password }) {
  if (!username || !password) return
  const passwordHash = await hashPassword(password)
  const users = state.staffUsers || []
  const existing = users.find(u => u.username === username)
  if (existing) {
    existing.name = name || existing.name
    existing.role = role || existing.role
    existing.passwordHash = passwordHash
    existing.active = existing.active !== false
  } else {
    users.push({
      id: id || Date.now(),
      name,
      username,
      role: role || 'cashier',
      passwordHash,
      active: true
    })
  }
  state.staffUsers = users
  await persistState()
}

async function addStaffUser() {
  const name = $('staffName').value.trim()
  const username = $('staffUsername').value.trim()
  const password = $('staffPassword').value
  const role = $('staffRole').value

  if (!state.currentStaff || state.currentStaff.role !== 'manager') {
    alert('Only managers can add staff.')
    return
  }
  if (!name || !username || !password) {
    alert('Please fill name, username, and password')
    return
  }

  try {
    if (!navigator.onLine || backendUnavailable) {
      await upsertLocalStaff({ name, username, role, password })
    } else {
      await staffFetch('/staff', {
        method: 'POST',
        body: JSON.stringify({ name, username, role, password })
      })
    }
    $('staffName').value = ''
    $('staffUsername').value = ''
    $('staffPassword').value = ''
    await renderStaffList()
  } catch (err) {
    alert(err.message || 'Failed to add staff')
  }
}

async function renderStaffList() {
  const root = $('staffList')
  if (!state.currentStaff || state.currentStaff.role !== 'manager') {
    root.innerHTML = '<p>Manager access only.</p>'
    return
  }
  try {
    const staff = (!navigator.onLine || backendUnavailable)
      ? (state.staffUsers || [])
      : await staffFetch('/staff')
    if (!staff || staff.length === 0) {
      root.innerHTML = '<p>No staff yet.</p>'
      return
    }
    if (navigator.onLine && !backendUnavailable) {
      state.staffUsers = staff.map(user => ({
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        active: user.active !== false,
        passwordHash: user.passwordHash || null
      }))
      await persistState()
    }
    root.innerHTML = staff.map(user => `
      <div class="product-item">
        <strong>${user.name}</strong>
        <div>${user.username} • ${user.role} ${user.active ? '' : '(inactive)'}</div>
      </div>
    `).join('')
  } catch (err) {
    root.innerHTML = `<p>${err.message === 'Offline' ? 'Offline: staff list unavailable.' : 'Failed to load staff.'}</p>`
  }
}

async function loadState() {
  if (!window.posApi || typeof window.posApi.getState !== 'function') {
    showFatal('POS API unavailable. Please restart the app.')
    throw new Error('POS API unavailable')
  }
  state = await window.posApi.getState()
  updateSyncStatus()
  renderStaffBadge()
}

async function persistState() {
  await window.posApi.saveState(state)
  updateSyncStatus()
  renderStaffBadge()
}

function renderCatalog() {
  const root = $('salesCatalog')
  if (!state.products || state.products.length === 0) {
    root.innerHTML = '<p>No products yet. Sync to load products.</p>'
    return
  }
  const term = (searchTerm || '').toLowerCase()
  const filtered = term
    ? state.products.filter(p =>
        p.name.toLowerCase().includes(term) ||
        String(p.id).includes(term) ||
        (p.barcode || '').toLowerCase().includes(term)
      )
    : state.products

  root.innerHTML = filtered.map(p => {
    const isMeat = p.id >= 100
    const min = isMeat ? 0.5 : 1
    const step = isMeat ? 0.5 : 1
    return `
    <div class="product-item">
      <strong>${p.name}</strong>
      <div>${formatMoney(p.price)} ${p.id >= 100 ? '/kg' : ''}</div>
      <div class="badge">Stock: ${p.stock}</div>
      <input type="number" id="qty-${p.id}" min="${min}" step="${step}" value="${min}" />
      <button data-id="${p.id}" class="addToCart">Add</button>
    </div>
  `
  }).join('')

  document.querySelectorAll('.addToCart').forEach(btn => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.id)
    const qty = Number(document.getElementById(`qty-${id}`).value) || 1
    const product = state.products.find(p => p.id === id)
    addToCart(product, qty)
  }))
}

function addToCart(product, qty) {
  if (!product) return alert('Product not found')
  if (product.stock < qty) return alert('Not enough stock')
  const existing = cart.find(c => c.id === product.id)
  if (existing) {
    existing.qty += qty
  } else {
    cart.push({ id: product.id, name: product.name, price: product.price, qty })
  }
  renderCart()
}

function renderCart() {
  const root = $('cartItems')
  if (cart.length === 0) {
    root.innerHTML = '<p>Cart is empty.</p>'
    $('cartTotals').innerHTML = ''
    return
  }
  root.innerHTML = cart.map(item => `
    <div class="product-item">
      <div><strong>${item.name}</strong></div>
      <div>${item.qty} × ${formatMoney(item.price)}</div>
      <div>${formatMoney(item.qty * item.price)}</div>
      <button class="secondary" data-id="${item.id}">Remove</button>
    </div>
  `).join('')

  const total = cart.reduce((sum, item) => sum + item.qty * item.price, 0)
  $('cartTotals').innerHTML = `<strong>Total: ${formatMoney(total)}</strong>`

  root.querySelectorAll('button.secondary').forEach(btn => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.id)
    cart = cart.filter(c => c.id !== id)
    renderCart()
  }))
}

function showReceipt(order) {
  const receipt = $('receiptCard')
  if (!receipt) return
  const itemsHtml = (order.items || []).map(item => {
    const product = state.products.find(p => p.id === item.product_id) || { name: 'Product' }
    return `<div class="receipt-line"><span>${product.name} × ${item.qty}</span><span>${formatMoney(item.qty * item.price_at)}</span></div>`
  }).join('')

  receipt.innerHTML = `
    <h3>Receipt</h3>
    <div>Order: ${order.externalId || order.id || ''}</div>
    <div>Customer: ${order.customer?.name || ''} (${order.customer?.phone || ''})</div>
    <div>Staff: ${order.staff?.name || ''} (${order.staff?.role || ''})</div>
    <div style="margin-top:12px">${itemsHtml}</div>
    <div style="margin-top:12px; font-weight:700">Total: ${formatMoney(order.total)}</div>
    <button id="printReceipt" class="secondary" style="margin-top:12px">Print Receipt</button>
  `
  receipt.style.display = 'block'
  document.getElementById('printReceipt')?.addEventListener('click', () => printReceipt(order))
}

function printReceipt(order) {
  const win = window.open('', 'PRINT', 'height=600,width=400')
  if (!win) return
  const mode = state?.settings?.printMode || 'thermal'
  const itemsHtml = (order.items || []).map(item => {
    const product = state.products.find(p => p.id === item.product_id) || { name: 'Product' }
    return `<div style="display:flex; justify-content:space-between"><span>${product.name} × ${item.qty}</span><span>${formatMoney(item.qty * item.price_at)}</span></div>`
  }).join('')
  const baseStyles = `
    body { font-family: Arial, sans-serif; margin: 0; padding: 8px; }
    h3 { margin: 0 0 6px 0; text-align: center; }
    .line { display:flex; justify-content:space-between; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .meta { font-size: 12px; }
    .total { font-weight: 700; margin-top: 6px; }
  `
  const thermalStyles = `
    @page { size: 80mm auto; margin: 0; }
    body { width: 80mm; font-size: 12px; }
  `
  const standardStyles = `
    body { width: 210mm; font-size: 14px; padding: 16px; }
  `
  const styles = `<style>${baseStyles}${mode === 'thermal' ? thermalStyles : standardStyles}</style>`
  win.document.write(`
    <html><head><title>Receipt</title>${styles}</head><body>
      <h3>BSK@L Enterprise</h3>
      <div class="meta">Order: ${order.externalId || order.id || ''}</div>
      <div class="meta">Customer: ${order.customer?.name || ''} (${order.customer?.phone || ''})</div>
      <div class="meta">Staff: ${order.staff?.name || ''} (${order.staff?.role || ''})</div>
      <div class="divider"></div>
      ${itemsHtml}
      <div class="divider"></div>
      <div class="total">Total: ${formatMoney(order.total)}</div>
    </body></html>
  `)
  win.document.close()
  win.focus()
  win.print()
  win.close()
}

async function placeSale() {
  if (cart.length === 0) return alert('Cart is empty')
  if (!state.currentStaff) return alert('Please login first')
  const name = $('custName').value.trim()
  const phone = $('custPhone').value.trim()
  if (!name || !phone) return alert('Customer name and phone are required')

  const deliveryMethod = $('deliveryMethod').value
  const deliveryAddress = $('deliveryAddress').value.trim()
  const paymentMethod = $('paymentMethod').value
  const paymentRef = $('paymentRef').value.trim()

  const now = new Date().toISOString()
  const externalId = window.crypto.randomUUID()
  const total = cart.reduce((sum, item) => sum + item.qty * item.price, 0)
  const branchId = state.settings?.branchId || ''
  const branch = (state.branches || []).find(b => String(b.id) === String(branchId))

  const order = {
    id: null,
    externalId,
    source: 'pos',
    status: 'Placed',
    createdAt: now,
    updatedAt: now,
    staff: { name: state.currentStaff.name, role: state.currentStaff.role },
    branch: branch ? { id: branch.id, name: branch.name } : null,
    customer: { name, phone },
    delivery: { method: deliveryMethod, address: deliveryAddress },
    payment: { method: paymentMethod, details: paymentRef ? { reference: paymentRef } : {} },
    total,
    items: cart.map(item => ({
      product_id: item.id,
      qty: item.qty,
      price_at: item.price
    }))
  }

  // Update local stock
  cart.forEach(item => {
    const product = state.products.find(p => p.id === item.id)
    if (product) product.stock = Number(product.stock) - Number(item.qty)
  })

  state.orders = [order, ...(state.orders || [])]

  const change = {
    changeId: window.crypto.randomUUID(),
    type: 'order:create',
    payload: {
      externalId,
      source: 'pos',
      items: cart.map(item => ({ id: item.id, qty: item.qty, price_at: item.price })),
      delivery: order.delivery,
      payment: order.payment,
      customer: order.customer,
      staff: order.staff,
      branch: order.branch,
      total: order.total,
      createdAt: now
    }
  }

  state.pendingChanges = [...(state.pendingChanges || []), change]
  cart = []
  $('custName').value = ''
  $('custPhone').value = ''
  $('deliveryAddress').value = ''
  $('paymentRef').value = ''

  await persistState()
  renderCatalog()
  renderCart()
  renderOrders()
  renderLowStock()
  showReceipt(order)

  if (navigator.onLine) await syncNow()
}

function renderProducts() {
  const root = $('productList')
  if (!state.products || state.products.length === 0) {
    root.innerHTML = '<p>No products available.</p>'
    return
  }

  root.innerHTML = `
    <table class="admin-table">
      <tr><th>ID</th><th>Name</th><th>Barcode</th><th>Price</th><th>Cost</th><th>Stock</th><th>Actions</th></tr>
      ${state.products.map(p => `
        <tr>
          <td>${p.id}</td>
          <td><input id="p-name-${p.id}" value="${p.name}" /></td>
          <td><input id="p-barcode-${p.id}" value="${p.barcode || ''}" /></td>
          <td><input id="p-price-${p.id}" type="number" step="0.01" value="${p.price}" /></td>
          <td><input id="p-cost-${p.id}" type="number" step="0.01" value="${p.cost || 0}" /></td>
          <td><input id="p-stock-${p.id}" type="number" step="0.5" value="${p.stock}" /></td>
          <td>
            <button data-id="${p.id}" class="saveProduct">Save</button>
            <input id="p-add-${p.id}" placeholder="+stock" style="width:70px" />
            <button data-id="${p.id}" class="restock secondary">Add</button>
          </td>
        </tr>
      `).join('')}
    </table>
  `

  document.querySelectorAll('.saveProduct').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.id)
    const name = document.getElementById(`p-name-${id}`).value.trim()
    const barcode = document.getElementById(`p-barcode-${id}`).value.trim()
    const price = Number(document.getElementById(`p-price-${id}`).value)
    const cost = Number(document.getElementById(`p-cost-${id}`).value)
    const stock = Number(document.getElementById(`p-stock-${id}`).value)
    const updatedAt = new Date().toISOString()

    const product = state.products.find(p => p.id === id)
    if (product) {
      product.name = name
      product.price = price
      product.cost = cost
      product.stock = stock
      product.barcode = barcode
      product.updatedAt = updatedAt
    }

    state.pendingChanges = [...(state.pendingChanges || []), {
      changeId: window.crypto.randomUUID(),
      type: 'product:update',
      payload: { id, name, price, cost, stock, barcode, updatedAt }
    }]

    await persistState()
    renderCatalog()
    renderProducts()
    if (navigator.onLine) await syncNow()
  }))

  document.querySelectorAll('.restock').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.id)
    const amount = Number(document.getElementById(`p-add-${id}`).value)
    if (!amount) return alert('Enter stock amount')
    const product = state.products.find(p => p.id === id)
    if (product) product.stock = Number(product.stock) + amount

    state.pendingChanges = [...(state.pendingChanges || []), {
      changeId: window.crypto.randomUUID(),
      type: 'stock:adjust',
      payload: { id, amount }
    }]

    await persistState()
    renderCatalog()
    renderProducts()
    if (navigator.onLine) await syncNow()
  }))

  renderLabelProductOptions()
}

function renderLabelProductOptions() {
  const select = $('labelProduct')
  if (!select) return
  if (!state.products || state.products.length === 0) {
    select.innerHTML = '<option value="">No products</option>'
    return
  }
  select.innerHTML = state.products.map(p => `
    <option value="${p.id}">${p.name} (${p.barcode || p.id})</option>
  `).join('')
}

function renderOrders() {
  const root = $('orderList')
  const orders = state.orders || []
  if (orders.length === 0) {
    root.innerHTML = '<p>No orders yet.</p>'
    return
  }

  root.innerHTML = `
    <table class="admin-table">
      <tr><th>ID</th><th>Customer</th><th>Staff</th><th>Total</th><th>Status</th><th>Update</th><th>Return</th></tr>
      ${orders.map(o => `
        <tr>
          <td>${o.id || o.externalId || 'LOCAL'}</td>
          <td>${o.customer?.name || ''} ${o.customer?.phone || ''}</td>
          <td>${o.staff?.name || o.staffName || ''} ${o.staff?.role ? `(${o.staff.role})` : o.staffRole ? `(${o.staffRole})` : ''}</td>
          <td>${formatMoney(o.total)}</td>
          <td>${o.status}</td>
          <td>
            <select id="order-status-${o.externalId || o.id}">
              <option ${o.status === 'Placed' ? 'selected' : ''}>Placed</option>
              <option ${o.status === 'Processing' ? 'selected' : ''}>Processing</option>
              <option ${o.status === 'Dispatched' ? 'selected' : ''}>Dispatched</option>
              <option ${o.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
              <option ${o.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
              <option ${o.status === 'Returned' ? 'selected' : ''}>Returned</option>
            </select>
            <button data-id="${o.id || ''}" data-ext="${o.externalId || ''}" class="updateStatus">Set</button>
          </td>
          <td>
            <button data-id="${o.id || ''}" data-ext="${o.externalId || ''}" class="returnOrder secondary">Return</button>
          </td>
        </tr>
      `).join('')}
    </table>
  `

  document.querySelectorAll('.updateStatus').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.id
    const externalId = btn.dataset.ext
    const selectId = `order-status-${externalId || id}`
    const status = document.getElementById(selectId).value

    const order = orders.find(o => (o.id && String(o.id) === id) || (o.externalId && o.externalId === externalId))
    if (order) order.status = status

    state.pendingChanges = [...(state.pendingChanges || []), {
      changeId: window.crypto.randomUUID(),
      type: 'order:status',
      payload: id ? { id: Number(id), status } : { externalId, source: 'pos', status }
    }]

    await persistState()
    renderOrders()
    if (navigator.onLine) await syncNow()
  }))

  document.querySelectorAll('.returnOrder').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Mark this order as Returned and restock items?')) return
    const id = btn.dataset.id
    const externalId = btn.dataset.ext

    const order = orders.find(o => (o.id && String(o.id) === id) || (o.externalId && o.externalId === externalId))
    if (order) {
      order.status = 'Returned'
      ;(order.items || []).forEach(item => {
        const productId = item.product_id || item.id
        const qty = Number(item.qty || 0)
        const product = state.products.find(p => p.id === productId)
        if (product) product.stock = Number(product.stock) + qty
      })
    }

    state.pendingChanges = [...(state.pendingChanges || []), {
      changeId: window.crypto.randomUUID(),
      type: 'order:return',
      payload: id ? { id: Number(id) } : { externalId, source: 'pos' }
    }]

    await persistState()
    renderCatalog()
    renderProducts()
    renderLowStock()
    renderOrders()
    if (navigator.onLine) await syncNow()
  }))
}

function renderLowStock() {
  const threshold = Number($('lowStockThreshold').value) || 0
  const low = (state.products || []).filter(p => Number(p.stock) <= threshold)
  const root = $('lowStockList')
  if (low.length === 0) {
    root.innerHTML = '<p>No low stock items.</p>'
    return
  }
  root.innerHTML = low.map(p => `
    <div class="product-item">
      <strong>${p.name}</strong>
      <div>Stock: ${p.stock}</div>
    </div>
  `).join('')
}

async function loadBranches() {
  if (!navigator.onLine || backendUnavailable) return
  try {
    const branches = await staffFetch('/branches')
    state.branches = branches || []
    if (!state.settings.branchId && state.branches.length > 0) {
      state.settings.branchId = String(state.branches[0].id)
    }
    await persistState()
    renderBranchSelect()
  } catch (err) {
    const status = $('branchStatus')
    if (status) status.textContent = err.message || 'Failed to load branches.'
  }
}

function renderBranchSelect() {
  const select = $('branchSelect')
  if (!select) return
  const branches = state.branches || []
  if (!branches.length) {
    select.innerHTML = '<option value="">No branches</option>'
    return
  }
  select.innerHTML = branches.map(b => `
    <option value="${b.id}">${b.name}</option>
  `).join('')
  select.value = state.settings.branchId || String(branches[0].id)

  const perfSelect = $('perfBranch')
  if (perfSelect) {
    perfSelect.innerHTML = '<option value="">All branches</option>' + branches.map(b => `
      <option value="${b.id}">${b.name}</option>
    `).join('')
    perfSelect.value = state.settings.branchId || ''
  }
}

async function saveSettingsFromInputs(source = 'settings') {
  const apiBaseInput = source === 'login' ? $('loginApiBase') : $('apiBase')
  const posTokenInput = source === 'login' ? $('loginPosToken') : $('posToken')
  const printModeInput = $('printMode')
  const branchSelect = $('branchSelect')
  const statusEl = source === 'login' ? $('loginSettingsStatus') : $('settingsStatus')

  if (apiBaseInput) state.settings.apiBase = apiBaseInput.value.trim()
  if (posTokenInput) state.settings.posToken = posTokenInput.value.trim()
  if (printModeInput) state.settings.printMode = printModeInput.value
  if (branchSelect) state.settings.branchId = branchSelect.value
  if (state.settings.apiBase) {
    const base = state.settings.apiBase.replace(/\/api\/?$/, '')
    state.settings.updateUrl = `${base}/downloads/pos`
  }

  await persistState()
  if (statusEl) statusEl.textContent = 'Settings saved.'
}

async function addBranch() {
  if (!state.currentStaff || state.currentStaff.role !== 'manager') {
    alert('Only managers can add branches.')
    return
  }
  const name = $('branchName').value.trim()
  const location = $('branchLocation').value.trim()
  if (!name) return alert('Branch name required')
  try {
    if (!navigator.onLine || backendUnavailable) {
      const newBranch = { id: Date.now(), name, location, active: true }
      state.branches = [...(state.branches || []), newBranch]
      if (!state.settings.branchId) state.settings.branchId = String(newBranch.id)
      await persistState()
      renderBranchSelect()
      $('branchStatus').textContent = 'Branch added (offline).'
    } else {
      await staffFetch('/branches', {
        method: 'POST',
        body: JSON.stringify({ name, location })
      })
      $('branchName').value = ''
      $('branchLocation').value = ''
      await loadBranches()
      $('branchStatus').textContent = 'Branch added.'
    }
  } catch (err) {
    $('branchStatus').textContent = err.message || 'Failed to add branch.'
  }
}

async function loadCurrentShift() {
  if (!state.settings?.staffToken || !navigator.onLine || backendUnavailable) return
  try {
    const data = await staffFetch('/pos/shifts/current')
    state.currentShift = data.shift
    await persistState()
    renderShiftStatus()
  } catch (err) {
    $('shiftStatus').textContent = err.message || 'Failed to load shift.'
  }
}

function renderShiftStatus() {
  const status = $('shiftStatus')
  if (!status) return
  if (!state.currentShift) {
    status.textContent = 'No open shift.'
    return
  }
  status.textContent = `Shift #${state.currentShift.id} opened at ${new Date(state.currentShift.openedAt).toLocaleString()}`
}

async function openShift() {
  const openingCash = Number($('openingCash').value || 0)
  const branchId = state.settings?.branchId
  if (!branchId) {
    $('shiftStatus').textContent = 'Select a branch in Settings.'
    return
  }
  try {
    const data = await staffFetch('/pos/shifts/open', {
      method: 'POST',
      body: JSON.stringify({ openingCash, branchId: Number(branchId) })
    })
    state.currentShift = data.shift
    await persistState()
    renderShiftStatus()
  } catch (err) {
    $('shiftStatus').textContent = err.message || 'Failed to open shift.'
  }
}

async function closeShift() {
  if (!state.currentShift) return
  const closingCash = Number($('closingCash').value || 0)
  try {
    const data = await staffFetch(`/pos/shifts/${state.currentShift.id}/close`, {
      method: 'POST',
      body: JSON.stringify({ closingCash })
    })
    state.currentShift = null
    state.lastShiftSummary = data
    await persistState()
    renderShiftStatus()
    renderShiftSummary(data)
  } catch (err) {
    $('shiftStatus').textContent = err.message || 'Failed to close shift.'
  }
}

async function addCashMovement() {
  if (!state.currentShift) return
  const type = $('cashMoveType').value
  const amount = Number($('cashMoveAmount').value || 0)
  const reason = $('cashMoveReason').value.trim()
  try {
    await staffFetch(`/pos/shifts/${state.currentShift.id}/cash-movement`, {
      method: 'POST',
      body: JSON.stringify({ type, amount, reason })
    })
    $('cashMoveAmount').value = ''
    $('cashMoveReason').value = ''
    $('shiftStatus').textContent = 'Cash movement added.'
  } catch (err) {
    $('shiftStatus').textContent = err.message || 'Failed to add movement.'
  }
}

function renderShiftSummary(data) {
  const root = $('shiftSummary')
  if (!root) return
  if (!data || !data.shift) {
    root.innerHTML = ''
    return
  }
  const totals = data.totals || {}
  root.innerHTML = `
    <div><strong>Shift Summary</strong></div>
    <div>Cash Sales: ${formatMoney(totals.cashSales || 0)}</div>
    <div>Mobile Sales: ${formatMoney(totals.mobileSales || 0)}</div>
    <div>Refunds: ${formatMoney(totals.totalRefunds || 0)}</div>
    <div>Expected Cash: ${formatMoney(data.shift.expectedCash || 0)}</div>
    <div>Closing Cash: ${formatMoney(data.shift.closingCash || 0)}</div>
    <div>Variance: ${formatMoney(data.shift.variance || 0)}</div>
  `
}

async function loadShiftSummary() {
  const shiftId = Number($('exportShiftId').value)
  if (!shiftId) return
  try {
    const data = await staffFetch(`/pos/shifts/${shiftId}/summary`)
    state.lastShiftSummary = data
    await persistState()
    renderShiftSummary(data)
  } catch (err) {
    $('shiftStatus').textContent = err.message || 'Failed to load shift summary.'
  }
}

function exportShiftCsv() {
  const summary = state.lastShiftSummary
  if (!summary || !summary.shift) return alert('Load a shift summary first.')
  const totals = summary.totals || {}
  const shift = summary.shift
  const lines = [
    ['Shift ID', shift.id],
    ['Staff', shift.staffName],
    ['Opened At', shift.openedAt],
    ['Closed At', shift.closedAt || ''],
    ['Opening Cash', shift.openingCash],
    ['Closing Cash', shift.closingCash || ''],
    ['Expected Cash', shift.expectedCash || ''],
    ['Variance', shift.variance || ''],
    ['Cash Sales', totals.cashSales || 0],
    ['Mobile Sales', totals.mobileSales || 0],
    ['Refunds', totals.totalRefunds || 0],
    ['Cash Refunds', totals.cashRefunds || 0],
    ['Mobile Refunds', totals.mobileRefunds || 0]
  ]
  const csv = lines.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `shift-${shift.id}-summary.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function exportShiftPdf() {
  const summary = state.lastShiftSummary
  if (!summary || !summary.shift) return alert('Load a shift summary first.')
  const totals = summary.totals || {}
  const shift = summary.shift
  const win = window.open('', 'SHIFT_PDF', 'height=700,width=600')
  if (!win) return
  win.document.write(`
    <html><head><title>Shift Summary</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 16px; }
        h2 { margin-top: 0; }
        .row { display:flex; justify-content:space-between; margin-bottom: 6px; }
        .section { margin-top: 16px; }
      </style>
    </head><body>
      <h2>Shift Summary</h2>
      <div class="row"><span>Shift ID</span><span>${shift.id}</span></div>
      <div class="row"><span>Staff</span><span>${shift.staffName}</span></div>
      <div class="row"><span>Opened</span><span>${shift.openedAt}</span></div>
      <div class="row"><span>Closed</span><span>${shift.closedAt || ''}</span></div>
      <div class="section">
        <div class="row"><span>Opening Cash</span><span>${formatMoney(shift.openingCash)}</span></div>
        <div class="row"><span>Closing Cash</span><span>${formatMoney(shift.closingCash || 0)}</span></div>
        <div class="row"><span>Expected Cash</span><span>${formatMoney(shift.expectedCash || 0)}</span></div>
        <div class="row"><span>Variance</span><span>${formatMoney(shift.variance || 0)}</span></div>
      </div>
      <div class="section">
        <div class="row"><span>Cash Sales</span><span>${formatMoney(totals.cashSales || 0)}</span></div>
        <div class="row"><span>Mobile Sales</span><span>${formatMoney(totals.mobileSales || 0)}</span></div>
        <div class="row"><span>Refunds</span><span>${formatMoney(totals.totalRefunds || 0)}</span></div>
      </div>
    </body></html>
  `)
  win.document.close()
  win.focus()
  win.print()
  win.close()
}

async function loadReconciliation() {
  const date = $('reconDate').value
  if (!date) return
  try {
    const data = await staffFetch(`/pos/reconciliation?date=${encodeURIComponent(date)}`)
    const totals = data.totals || {}
    $('reconciliationResult').innerHTML = `
      <div>Cash Sales: ${formatMoney(totals.cashSales || 0)}</div>
      <div>Mobile Sales: ${formatMoney(totals.mobileSales || 0)}</div>
      <div>Refunds: ${formatMoney(totals.totalRefunds || 0)}</div>
      <div>Cash Refunds: ${formatMoney(totals.cashRefunds || 0)}</div>
    `
  } catch (err) {
    $('reconciliationResult').innerHTML = `<p>${err.message || 'Failed to load reconciliation.'}</p>`
  }
}

async function loadAuditLog() {
  try {
    const logs = await staffFetch('/pos/audit?limit=100')
    const root = $('auditLog')
    if (!logs || logs.length === 0) {
      root.innerHTML = '<p>No audit entries.</p>'
      return
    }
    root.innerHTML = logs.map(log => `
      <div class="product-item">
        <strong>${log.action}</strong>
        <div>${log.actorName || ''} • ${new Date(log.createdAt).toLocaleString()}</div>
      </div>
    `).join('')
  } catch (err) {
    $('auditLog').innerHTML = `<p>${err.message || 'Failed to load audit log.'}</p>`
  }
}

async function loadPerformance() {
  const start = $('perfStart').value
  const end = $('perfEnd').value
  const branchId = $('perfBranch').value
  if (!start || !end) return
  try {
    const query = new URLSearchParams({ start, end })
    if (branchId) query.set('branchId', branchId)
    const data = await staffFetch(`/pos/performance?${query.toString()}`)
    renderPerformance(data.performance || [])
  } catch (err) {
    $('performanceTable').innerHTML = `<p>${err.message || 'Failed to load performance.'}</p>`
  }
}

function renderPerformance(rows) {
  const root = $('performanceTable')
  if (!rows || rows.length === 0) {
    root.innerHTML = '<p>No data for this period.</p>'
    return
  }
  root.innerHTML = `
    <table class="admin-table">
      <tr><th>Cashier</th><th>Role</th><th>Orders</th><th>Total Sales</th><th>Cash</th><th>Mobile</th><th>Refunds</th><th>Avg Order</th></tr>
      ${rows.map(r => `
        <tr>
          <td>${r.staffName}</td>
          <td>${r.staffRole}</td>
          <td>${r.orders}</td>
          <td>${formatMoney(r.totalSales)}</td>
          <td>${formatMoney(r.cashSales)}</td>
          <td>${formatMoney(r.mobileSales)}</td>
          <td>${formatMoney(r.refunds)}</td>
          <td>${formatMoney(r.avgOrder)}</td>
        </tr>
      `).join('')}
    </table>
  `
}

async function printBarcodeLabels() {
  const status = $('labelStatus')
  status.textContent = ''

  const productId = Number($('labelProduct').value)
  const qty = Number($('labelQty').value) || 1
  const size = $('labelSize').value
  const showPrice = $('labelShowPrice').checked
  const showBarcodeText = $('labelShowBarcode').checked
  const storeName = $('labelStoreName').value.trim()
  const fontSize = Number($('labelFontSize').value) || 11
  const customField = $('labelCustomField').value.trim()

  const product = state.products.find(p => p.id === productId)
  if (!product) {
    status.textContent = 'Select a product.'
    return
  }

  const barcodeValue = product.barcode || product.id
  let barcodeDataUrl = ''

  try {
    barcodeDataUrl = await window.posApi.generateBarcode(barcodeValue, { scale: 3, height: 12 })
  } catch (err) {
    status.textContent = 'Failed to generate barcode.'
    return
  }

  const [widthMm, heightMm] = size.split('x').map(Number)
  const labels = Array.from({ length: qty }).map(() => `
    <div class="label" style="width:${widthMm}mm; height:${heightMm}mm;">
      ${storeName ? `<div style="font-weight:700; font-size:${fontSize}px">${storeName}</div>` : ''}
      <div style="font-weight:600; font-size:${fontSize}px">${product.name}</div>
      ${customField ? `<div style="font-size:${Math.max(fontSize - 1, 8)}px">${customField}</div>` : ''}
      ${showPrice ? `<div style="font-size:${Math.max(fontSize - 1, 8)}px">${formatMoney(product.price)}</div>` : ''}
      <img src="${barcodeDataUrl}" alt="barcode" />
      ${showBarcodeText ? `<div style="font-size:${Math.max(fontSize - 2, 8)}px">${barcodeValue}</div>` : ''}
    </div>
  `).join('')

  const win = window.open('', 'LABELS', 'height=600,width=600')
  if (!win) return
  win.document.write(`
    <html>
      <head>
        <title>Barcode Labels</title>
        <style>
          @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
          body { margin: 0; padding: 4mm; font-family: Arial, sans-serif; }
          .label { page-break-after: always; }
          img { width: 100%; height: auto; }
        </style>
      </head>
      <body>
        ${labels}
      </body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
  win.close()
}

function renderReports() {
  const reports = state.reports || {}
  $('profitLoss').innerHTML = reports.profitLoss
    ? `<div>Total Revenue: ${formatMoney(reports.profitLoss.totalRevenue)}</div>
       <div>Total Cost: ${formatMoney(reports.profitLoss.totalCost)}</div>
       <div>Total Profit: ${formatMoney(reports.profitLoss.totalProfit)}</div>`
    : '<p>No report available.</p>'

  $('weeklySales').innerHTML = reports.weeklySales
    ? `<div>Current Week: ${reports.weeklySales.currentWeek.itemsSold} items • ${formatMoney(reports.weeklySales.currentWeek.revenue)}</div>
       <div>Last Week: ${reports.weeklySales.lastWeek.itemsSold} items • ${formatMoney(reports.weeklySales.lastWeek.revenue)}</div>`
    : '<p>No weekly report available.</p>'

  const discounts = reports.customerDiscounts?.customers || []
  if (!discounts.length) {
    $('customerDiscounts').innerHTML = '<p>No customer discounts yet.</p>'
  } else {
    $('customerDiscounts').innerHTML = discounts.slice(0, 10).map(c => `
      <div>${c.name} (${c.phone}) - ${c.discountPercent}%</div>
    `).join('')
  }
}

async function renderTracking() {
  const id = $('trackOrderId').value.trim()
  if (!id) return alert('Enter order ID')
  const apiBase = state.settings?.apiBase
  if (!apiBase || !navigator.onLine) {
    $('trackingResult').innerHTML = '<p>Tracking is available only online.</p>'
    return
  }
  try {
    const res = await fetch(`${apiBase}/orders/${id}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Order not found')
    $('trackingResult').innerHTML = `
      <div><strong>Status:</strong> ${data.status}</div>
      <div><strong>Total:</strong> ${formatMoney(data.total)}</div>
      <div><strong>Customer:</strong> ${data.customer?.name || ''}</div>
    `
  } catch (err) {
    $('trackingResult').innerHTML = `<p>${err.message}</p>`
  }
}

function mergeProducts(newProducts) {
  const map = new Map((state.products || []).map(p => [p.id, p]))
  newProducts.forEach(p => {
    const existing = map.get(p.id)
    if (!existing || (p.updatedAt && existing.updatedAt && p.updatedAt >= existing.updatedAt) || !existing.updatedAt) {
      map.set(p.id, p)
    }
  })
  state.products = Array.from(map.values()).sort((a, b) => a.id - b.id)
}

function mergeOrders(newOrders) {
  const byId = new Map((state.orders || []).map(o => [o.id, o]))
  const byExternal = new Map((state.orders || []).filter(o => o.externalId).map(o => [o.externalId, o]))

  newOrders.forEach(order => {
    if (order.externalId && byExternal.has(order.externalId)) {
      const local = byExternal.get(order.externalId)
      Object.assign(local, order)
      if (order.id) byId.set(order.id, local)
    } else if (order.id && byId.has(order.id)) {
      const local = byId.get(order.id)
      Object.assign(local, order)
    } else {
      state.orders = [order, ...(state.orders || [])]
    }
  })
}

async function syncNow() {
  const apiBase = state.settings?.apiBase
  const posToken = state.settings?.posToken
  if (!navigator.onLine || backendUnavailable) {
    $('syncStatus').textContent = 'Offline • queued changes'
    return
  }
  if (!apiBase || !posToken) {
    $('syncStatus').textContent = 'Missing API base or POS token'
    return
  }

  try {
    const res = await fetch(`${apiBase}/pos/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pos-token': posToken
      },
      body: JSON.stringify({
        since: state.lastSyncAt,
        changes: state.pendingChanges || [],
        deviceId: state.deviceId
      })
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Sync failed')
    setBackendAvailability(true)

    const appliedIds = (data.applied || []).filter(a => a.status === 'ok' || a.status === 'skipped').map(a => a.changeId)
    if (appliedIds.length) {
      state.pendingChanges = (state.pendingChanges || []).filter(c => !appliedIds.includes(c.changeId))
    }

    state.lastSyncAt = data.serverTime
    if (data.snapshot?.products) mergeProducts(data.snapshot.products)
    if (data.snapshot?.orders) mergeOrders(data.snapshot.orders)
    if (data.snapshot?.reports) state.reports = data.snapshot.reports

    await persistState()
    renderCatalog()
    renderProducts()
    renderOrders()
    renderReports()
    renderLowStock()
    renderLabelProductOptions()
  } catch (err) {
    if (!navigator.onLine || err?.message?.includes('fetch')) {
      setBackendAvailability(false)
      $('syncStatus').textContent = 'Offline • queued changes'
    } else {
      $('syncStatus').textContent = `Sync failed: ${err.message}`
    }
  }
}

function wireEvents() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab)
  }))

  $('placeSale').addEventListener('click', placeSale)
  $('syncNow').addEventListener('click', syncNow)
  $('trackOrderBtn').addEventListener('click', renderTracking)
  $('loginBtn').addEventListener('click', handleLogin)
  $('useOfflineBtn').addEventListener('click', handleOfflineLogin)
  $('logoutBtn').addEventListener('click', async () => {
    await handleLogout()
  })
  $('addStaff').addEventListener('click', addStaffUser)
  $('refreshLowStock').addEventListener('click', renderLowStock)
  $('printLabels').addEventListener('click', printBarcodeLabels)
  $('openShift').addEventListener('click', openShift)
  $('closeShift').addEventListener('click', closeShift)
  $('addCashMovement').addEventListener('click', addCashMovement)
  $('loadReconciliation').addEventListener('click', loadReconciliation)
  $('loadAudit').addEventListener('click', loadAuditLog)
  $('loadShiftSummary').addEventListener('click', loadShiftSummary)
  $('exportShiftCsv').addEventListener('click', exportShiftCsv)
  $('exportShiftPdf').addEventListener('click', exportShiftPdf)
  $('loadPerformance').addEventListener('click', loadPerformance)

  $('productSearch').addEventListener('input', (e) => {
    searchTerm = e.target.value
    renderCatalog()
  })

  $('barcodeInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const code = e.target.value.trim()
    if (!code) return
    const product = state.products.find(p => String(p.barcode || '').trim() === code || String(p.id) === code)
    if (!product) {
      alert('Barcode not found')
      return
    }
    addToCart(product, 1)
    e.target.value = ''
  })

  $('saveSettings').addEventListener('click', async () => {
    await saveSettingsFromInputs('settings')
  })
  $('saveLoginSettings').addEventListener('click', async () => {
    await saveSettingsFromInputs('login')
  })

  $('addBranch').addEventListener('click', addBranch)

  window.addEventListener('online', () => {
    updateSyncStatus()
    probeBackend()
  })
  window.addEventListener('offline', updateSyncStatus)
}

async function init() {
  try {
    await loadState()
    if (!state.staffUsers) state.staffUsers = []
    if (!state.settings.updateUrl && state.settings.apiBase) {
      const base = state.settings.apiBase.replace(/\/api\/?$/, '')
      state.settings.updateUrl = `${base}/downloads/pos`
    }
    $('apiBase').value = state.settings?.apiBase || ''
    $('posToken').value = state.settings?.posToken || ''
    const loginApiBase = $('loginApiBase')
    const loginPosToken = $('loginPosToken')
    if (loginApiBase) loginApiBase.value = state.settings?.apiBase || ''
    if (loginPosToken) loginPosToken.value = state.settings?.posToken || ''
    $('printMode').value = state.settings?.printMode || 'thermal'
    renderBranchSelect()
    if ($('perfStart') && $('perfEnd')) {
      const today = new Date()
      const endDate = today.toISOString().split('T')[0]
      const startDate = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      $('perfStart').value = $('perfStart').value || startDate
      $('perfEnd').value = $('perfEnd').value || endDate
    }

    renderCatalog()
    renderCart()
    renderProducts()
    renderOrders()
    renderReports()
    renderLowStock()
    await probeBackend()
    if (navigator.onLine && state.settings?.staffToken && !backendUnavailable) {
      await renderStaffList()
    } else if (!navigator.onLine) {
      const loginStatus = $('loginStatus')
      if (!state.currentStaff && state.lastStaff && loginStatus) {
        loginStatus.textContent = 'Offline: tap “Use Offline Mode”.'
      }
    }
    ensureLoginState()
    applyRoleAccess()
    applySettingsAccess()
    wireEvents()

    if (state.settings?.staffToken && navigator.onLine && !backendUnavailable) {
      await loadBranches()
      await loadCurrentShift()
    }

    if (state.lastShiftSummary) {
      renderShiftSummary(state.lastShiftSummary)
    }

    if (navigator.onLine && !backendUnavailable) {
      await syncNow()
    }

    setInterval(() => {
      if (navigator.onLine) {
        syncNow()
      }
    }, 30000)
  } catch (err) {
    showFatal(err.message || 'Failed to start POS app.')
  }
}

window.addEventListener('DOMContentLoaded', init)
window.addEventListener('error', (event) => {
  const message = event?.error?.message || event?.message
  if (message) showFatal(message)
})
