const apiBaseFromDom = document.documentElement?.dataset?.apiBase?.trim() || ''
const API_BASE = (window.API_BASE || apiBaseFromDom || '').trim() || `${location.origin}/api`
let products = []
let cart = []
let trackMap = null
let trackMarker = null
let trackPollTimer = null
let activeTrackId = null

function loadCartSafely() {
  try {
    const raw = localStorage.getItem('cart') || '[]'
    const parsed = JSON.parse(raw)
    cart = Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.warn('Invalid cart data in localStorage, resetting cart.', e)
    cart = []
    localStorage.removeItem('cart')
  }
}

function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); updateCartCount() }
function updateCartCount() { document.getElementById('cartCount').innerText = cart.reduce((s,i)=>s+Number(i.qty),0) }

async function loadProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`)
    if (!res.ok) throw new Error(`Failed to load products (${res.status})`)
    products = await res.json()
    renderCatalog()
    updateCartCount()
  } catch (e) {
    console.error('Failed to load products', e)
    showCatalogMessage('Unable to load products. Please refresh or check your connection.', true)
  }
}

function renderCatalog() {
  const beveragesGrid = document.getElementById('beverages-grid')
  const meatsGrid = document.getElementById('meats-grid')
  
  if (!beveragesGrid || !meatsGrid) {
    console.warn('Category grids not found in DOM')
    return
  }
  
  beveragesGrid.innerHTML = ''
  meatsGrid.innerHTML = ''
  
  if (!products || products.length === 0) {
    showCatalogMessage('No products available right now. Please check back soon.', false)
    return
  }
  
  // Separate beverages (id < 100) and meats (id >= 100)
  const beverages = products.filter(p => p.id < 100)
  const meats = products.filter(p => p.id >= 100)
  
  beverages.forEach(p => {
    const el = document.createElement('div')
    el.className = 'card'
    el.innerHTML = `
      <div class="product-name">${p.name}</div>
      <div class="product-price">GH₵ ${p.price.toFixed(2)}</div>
      <div class="product-stock">📦 ${p.stock} in stock</div>
      <div class="actions">
        <input type="number" min="1" max="${p.stock}" value="1" id="qty-${p.id}" />
        <button data-id="${p.id}" class="addBtn">Add to Cart</button>
      </div>`
    beveragesGrid.appendChild(el)
  })
  
  meats.forEach(p => {
    const el = document.createElement('div')
    el.className = 'card'
    el.innerHTML = `
      <div class="product-name">${p.name}</div>
      <div class="product-price">GH₵ ${p.price.toFixed(2)} /kg</div>
      <div class="product-stock">📦 ${p.stock} kg in stock</div>
      <div class="actions">
        <input type="number" min="0.5" step="0.5" max="${p.stock}" value="1" id="qty-${p.id}" />
        <button data-id="${p.id}" class="addBtn">Add to Cart</button>
      </div>`
    meatsGrid.appendChild(el)
  })
  
  document.querySelectorAll('.addBtn').forEach(b => b.addEventListener('click', addToCart))
}

function showCatalogMessage(message, isError) {
  const root = document.getElementById('catalog')
  const tone = isError ? 'style="color:#c00"' : ''
  root.innerHTML = `<p ${tone}>${message}</p>`
}

function addToCart(e) {
  const id = Number(e.target.dataset.id)
  const qty = Number(document.getElementById(`qty-${id}`).value) || 1
  const prod = products.find(p => p.id === id)
  if (!prod) return alert('Product not found')
  if (prod.stock < qty) return alert('Not enough stock')
  const existing = cart.find(c => c.id === id)
  if (existing) existing.qty += qty; else cart.push({ id, name: prod.name, price: prod.price, qty })
  saveCart()
  alert('Added to cart')
}

function showSection(name) {
  document.querySelectorAll('#app > section').forEach(s => s.classList.add('hidden'))
  document.getElementById(name).classList.remove('hidden')
  if (name !== 'track') stopTrackPolling()
}

function stopTrackPolling() {
  if (trackPollTimer) {
    clearInterval(trackPollTimer)
    trackPollTimer = null
  }
  activeTrackId = null
  if (trackMap) {
    trackMap.remove()
    trackMap = null
    trackMarker = null
  }
}

function renderCart() {
  const root = document.getElementById('cart')
  if (cart.length === 0) { root.innerHTML = '<p>Your cart is empty.</p>'; return }
  root.innerHTML = '<h2>Cart</h2>'
  cart.forEach(item => {
    root.innerHTML += `<div class="card"><strong>${item.name}</strong><div>GH₵ ${item.price} x ${item.qty} = GH₵ ${item.price*item.qty}</div><button class="remove" data-id="${item.id}">Remove</button></div>`
  })
  root.innerHTML += `<div class="card"><strong>Total: GH₵ ${cart.reduce((s,i)=>s+i.price*i.qty,0)}</strong></div><button id="checkoutBtn">Proceed to Checkout</button>`
  document.querySelectorAll('.remove').forEach(b => b.addEventListener('click', (e)=>{ removeFromCart(Number(e.target.dataset.id)) }))
  document.getElementById('checkoutBtn').addEventListener('click', showCheckout)
}

function removeFromCart(id) { cart = cart.filter(c => c.id !== id); saveCart(); renderCart() }

function showCheckout() {
  showSection('checkout')
  const root = document.getElementById('checkout')
  root.innerHTML = `
    <h2>Checkout</h2>
    <div class="card checkout-form">
      <label>Full Name *</label>
      <input id="custName" placeholder="Enter your full name" />
      
      <label>Phone Number * (WhatsApp)</label>
      <input id="custPhone" placeholder="+233 XX XXX XXXX" />
      <div id="discountMessage" style="margin-top:8px; padding:8px; border-radius:6px; font-size:0.9rem; display:none"></div>
      
      <label>Delivery Method *</label>
      <select id="deliveryOpt">
        <option value="pickup">🏪 Pickup at Kasoa Timber Market (Free)</option>
        <option value="delivery">🚚 Home Delivery (GH₵ 10 - GH₵ 50)</option>
      </select>
      
      <div id="addrDiv" style="display:none">
        <label>Delivery Address *</label>
        <input id="custAddr" placeholder="Enter your full address (area, street, house number)" />
        <div style="margin-top:8px; font-size:0.9rem; color:#666">
          📍 Delivery areas: Kasoa, Accra, Tema (GH₵ 10-30)<br>
          ⏱️ Delivery time: Same day (order before 2pm) or next day
        </div>
      </div>
      
      <label style="margin-top:16px">Payment Method *</label>
      <select id="payMethod">
        <option value="mobile">📱 Mobile Money (MTN / Vodafone / AirtelTigo)</option>
        <option value="cash">💵 Cash on Delivery</option>
      </select>
      
      <div id="mobileInfo" style="display:block">
        <div class="payment-instructions">
          <strong>📱 Mobile Money Payment Instructions:</strong><br><br>
          <strong>MTN: *170#</strong> or <strong>Vodafone: *110#</strong><br>
          1. Dial the code above<br>
          2. Select "Send Money"<br>
          3. Send to: <strong>0593810461</strong> (Hagar Kwankyewaa)<br>
          4. Amount: <strong>GH₵ <span id="totalAmount">0</span></strong><br>
          5. Confirm and send<br>
          6. Enter your reference number below
        </div>
        <label>Mobile Money Number *</label>
        <input id="mobileNumber" placeholder="Your mobile money number" />
        <label>Transaction Reference (after payment)</label>
        <input id="momoRef" placeholder="Enter reference number from SMS" />
      </div>
      
      <div id="cashInfo" style="display:none">
        <div class="payment-instructions">
          <strong>💵 Cash on Delivery:</strong><br>
          Pay when you receive your order. Please have exact change ready.
        </div>
      </div>
      
      <button id="placeOrder">Place Order</button>
    </div>`

  // Update total amount
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0)
  const deliveryCost = 10 // Will be calculated based on delivery method
  const totalEl = document.getElementById('totalAmount')
  if (totalEl) totalEl.innerText = total.toFixed(2)
  
  let appliedDiscount = { eligible: false, discountPercent: 0 }
  
  // Check discount when phone number changes
  document.getElementById('custPhone').addEventListener('blur', async (e) => {
    const phone = e.target.value.trim()
    if (!phone) return
    
    try {
      const res = await fetch(`${API_BASE}/check-discount/${encodeURIComponent(phone)}`)
      const data = await res.json()
      
      if (res.ok && data) {
        appliedDiscount = data
        const msgEl = document.getElementById('discountMessage')
        
        if (data.eligible) {
          msgEl.style.display = 'block'
          msgEl.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
          msgEl.style.color = '#fff'
          msgEl.innerHTML = `<strong>🎉 ${data.message}</strong>`
          
          // Update total amount with discount
          const discountedTotal = total * (1 - data.discountPercent / 100)
          if (totalEl) {
            totalEl.innerHTML = `<span style="text-decoration:line-through; opacity:0.7">${total.toFixed(2)}</span> ${discountedTotal.toFixed(2)}`
          }
        } else {
          msgEl.style.display = 'block'
          msgEl.style.background = '#f3f4f6'
          msgEl.style.color = '#666'
          msgEl.innerHTML = `<strong>💡 ${data.message}</strong>`
        }
      }
    } catch (e) {
      console.error('Failed to check discount:', e)
    }
  })

  document.getElementById('deliveryOpt').addEventListener('change', (e)=>{ 
    document.getElementById('addrDiv').style.display = e.target.value==='delivery' ? 'block' : 'none' 
  })
  
  document.getElementById('payMethod').addEventListener('change', (e)=>{
    document.getElementById('mobileInfo').style.display = e.target.value==='mobile' ? 'block' : 'none'
    document.getElementById('cashInfo').style.display = e.target.value==='cash' ? 'block' : 'none'
  })

  document.getElementById('placeOrder').addEventListener('click', placeOrder)
}

async function placeOrder() {
  const name = document.getElementById('custName').value.trim()
  const phone = document.getElementById('custPhone').value.trim()
  const deliveryOpt = document.getElementById('deliveryOpt').value
  const address = document.getElementById('custAddr') ? document.getElementById('custAddr').value : ''
  const payMethod = document.getElementById('payMethod').value
  if (!name || !phone) return alert('Please provide name and phone')

  // Mobile or cash flow
  const momoNumber = document.getElementById('mobileNumber')?.value || ''
  const momoRef = document.getElementById('momoRef')?.value || ''
  
  const payload = {
    customer: { name, phone },
    items: cart.map(c => ({ id: c.id, qty: c.qty })),
    delivery: { method: deliveryOpt, address },
    payment: { 
      method: payMethod, 
      details: payMethod==='mobile' ? { phone: momoNumber, reference: momoRef } : 
               { type: 'cash_on_delivery' }
    }
  }
  try {
    const res = await fetch(`${API_BASE}/orders`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch (e) { data = null }
    if (!res.ok) return alert((data && data.error) ? data.error : 'Order failed')
    cart = []
    saveCart()
    showConfirmation(data.order)
  } catch (e) { console.error(e); alert('Failed to place order') }
}

function showConfirmation(order) {
  showSection('confirmation')
  const root = document.getElementById('confirmation')
  
  // Calculate delivery date
  const now = new Date()
  const cutoffHour = 14 // 2pm
  const orderTime = now.getHours()
  const deliveryDate = new Date(now)
  
  if (order.delivery.method === 'delivery') {
    // If ordered after 2pm, deliver next day
    if (orderTime >= cutoffHour) {
      deliveryDate.setDate(deliveryDate.getDate() + 1)
    }
  }
  
  const deliveryDateStr = deliveryDate.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  
  // Find product names for items
  const itemsHtml = (order.items || []).map(item => {
    const prod = products.find(p => p.id === item.product_id) || { name: 'Product' }
    return `
      <div class="receipt-row">
        <span>${prod.name} x ${item.qty}</span>
        <span>GH₵ ${(item.price_at * item.qty).toFixed(2)}</span>
      </div>
    `
  }).join('')
  
  root.innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <h2>🎉 ORDER CONFIRMED!</h2>
        <p style="margin:8px 0; color:#666">Thank you for your order</p>
      </div>
      
      <div class="receipt-row" style="background:#f8f9fa; font-weight:600">
        <span>Order ID:</span>
        <span>#${order.id}</span>
      </div>
      
      <div class="receipt-row">
        <span>Customer:</span>
        <span>${order.customer.name}</span>
      </div>
      
      <div class="receipt-row">
        <span>Phone:</span>
        <span>${order.customer.phone}</span>
      </div>
      
      <div class="receipt-row">
        <span>Delivery:</span>
        <span>${order.delivery.method === 'pickup' ? '🏪 Pickup' : '🚚 Delivery'}</span>
      </div>
      
      ${order.delivery.method === 'delivery' ? `
        <div class="receipt-row">
          <span>Address:</span>
          <span style="font-size:0.9rem">${order.delivery.address || 'N/A'}</span>
        </div>
        <div class="receipt-row" style="background:#e8f5e9">
          <span>📅 Estimated Delivery:</span>
          <span style="font-weight:600">${deliveryDateStr}</span>
        </div>
      ` : ''}
      
      <div class="receipt-row">
        <span>Payment:</span>
        <span>${order.payment.method === 'mobile' ? '📱 Mobile Money' : '💵 Cash'}</span>
      </div>
      
      <div class="receipt-row">
        <span>Status:</span>
        <span style="color:var(--success); font-weight:600">${order.status}</span>
      </div>
      
      <div style="margin:24px 0 16px 0; padding-top:16px; border-top:2px solid #eee">
        <strong style="font-size:1.1rem">Order Items:</strong>
      </div>
      
      ${itemsHtml}
      
      <div class="receipt-total" style="text-align:right; border-top:2px solid var(--primary); padding-top:16px; margin-top:16px">
        TOTAL: GH₵ ${order.total.toFixed(2)}
      </div>
      
      <div style="margin-top:24px; padding:16px; background:#f8f9fa; border-radius:8px; text-align:center">
        <p style="margin:0; font-weight:600; color:var(--primary)">📱 Track your order anytime!</p>
        <p style="margin:8px 0 0 0; font-size:0.95rem">Use Order ID <strong>#${order.id}</strong> or your phone number</p>
      </div>
      
      <div style="margin-top:16px; text-align:center">
        <button onclick="window.print()" style="background:var(--accent); color:#000; border:0; padding:12px 24px; border-radius:8px; cursor:pointer; font-weight:600; margin-right:8px">
          🖨️ Print Receipt
        </button>
        <button onclick="location.reload()" style="background:var(--primary); color:#fff; border:0; padding:12px 24px; border-radius:8px; cursor:pointer; font-weight:600">
          🛒 New Order
        </button>
      </div>
    </div>
    
    <div style="margin-top:24px; padding:16px; background:#fff; border:1px solid #ddd; border-radius:8px">
      <strong>📞 Questions? Contact us:</strong><br>
      Abigail: <a href="tel:+233593810461">+233 59 381 0461</a><br>
      Alexander: <a href="tel:+233552980212">+233 55 298 0212</a><br>
      Location: Kasoa Timber Market, Ghana
    </div>
  `
}

async function renderTrack() {
  showSection('track')
  const root = document.getElementById('track')
  root.innerHTML = `
    <h2>Track Order</h2>
    <div class="card">
      <label>Order ID</label>
      <input id="trackId" placeholder="Enter your order ID (e.g., 1234)" />
      <button id="doTrack">Track Order</button>
      <div id="trackResult" style="margin-top:16px"></div>
    </div>`
  document.getElementById('doTrack').addEventListener('click', async ()=>{
    const id = document.getElementById('trackId').value
    if (!id) return alert('Enter order id')
    try {
      const res = await fetch(`${API_BASE}/orders/${id}`)
      if (!res.ok) {
        document.getElementById('trackResult').innerHTML = '<p style="color:var(--danger)">Order not found</p>'
        return
      }
      const data = await res.json()
      document.getElementById('trackResult').innerHTML = `
        <div class="card" style="background:#e8f5e9">
          <strong>Order #${data.id}</strong><br>
          Status: <span id="trackStatus" style="font-weight:600; color:var(--primary)">${data.status}</span><br>
          Total: GH₵ <span id="trackTotal">${data.total.toFixed(2)}</span><br>
          Customer: <span id="trackCustomer">${data.customer?.name || 'N/A'}</span>
          <div id="trackMap" class="map-container" style="display:none"></div>
          <div id="trackLocation" style="margin-top:8px; font-size:0.9rem; color:#666"></div>
          <div style="margin-top:12px; border-top:1px solid #d9ead3; padding-top:12px">
            <label style="margin:0 0 6px 0; font-weight:600">Cancel Order (within 15 minutes)</label>
            <input id="cancelPhone" placeholder="Enter your phone number to cancel" />
            <button id="cancelOrderBtn" style="margin-top:8px; background:#dc3545; color:#fff">Cancel Order</button>
            <div id="cancelMessage" style="margin-top:8px; font-size:0.9rem"></div>
          </div>
        </div>
      `
      activeTrackId = id
      updateTrackLocation(data)

      const cancelBtn = document.getElementById('cancelOrderBtn')
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          const phone = document.getElementById('cancelPhone')?.value || ''
          const msgEl = document.getElementById('cancelMessage')
          if (!phone.trim()) {
            if (msgEl) { msgEl.style.color = '#dc3545'; msgEl.textContent = 'Phone number is required.' }
            return
          }
          if (!confirm('Are you sure you want to cancel this order?')) return
          try {
            const cancelRes = await fetch(`${API_BASE}/orders/${id}/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            })
            const cancelData = await cancelRes.json()
            if (!cancelRes.ok) throw new Error(cancelData.error || 'Cancel failed')
            if (msgEl) { msgEl.style.color = '#0a4a8a'; msgEl.textContent = 'Order cancelled successfully.' }
            const statusEl = document.getElementById('trackStatus')
            if (statusEl) statusEl.textContent = cancelData.order.status
          } catch (err) {
            if (msgEl) { msgEl.style.color = '#dc3545'; msgEl.textContent = err.message || 'Cancel failed' }
          }
        })
      }

      if (trackPollTimer) clearInterval(trackPollTimer)
      trackPollTimer = setInterval(async () => {
        try {
          const pollRes = await fetch(`${API_BASE}/orders/${id}`)
          if (!pollRes.ok) return
          const pollData = await pollRes.json()
          const statusEl = document.getElementById('trackStatus')
          const totalEl = document.getElementById('trackTotal')
          if (statusEl) statusEl.textContent = pollData.status
          if (totalEl) totalEl.textContent = pollData.total.toFixed(2)
          updateTrackLocation(pollData)
        } catch (e) {
          console.warn('Failed to refresh tracking data', e)
        }
      }, 10000)
    } catch (e) { 
      console.error(e)
      document.getElementById('trackResult').innerHTML = '<p style="color:var(--danger)">Error fetching order</p>'
    }
  })
}

function updateTrackLocation(order) {
  const mapEl = document.getElementById('trackMap')
  const locationEl = document.getElementById('trackLocation')
  if (!mapEl || !locationEl) return

  const last = order.lastLocation
  if (!last || last.lat === undefined || last.lng === undefined || last.lat === null || last.lng === null) {
    mapEl.style.display = 'none'
    locationEl.innerText = 'No live location yet. Please check again soon.'
    return
  }

  const lat = Number(last.lat)
  const lng = Number(last.lng)
  const updatedAt = last.at ? new Date(last.at) : null
  const updatedText = updatedAt ? updatedAt.toLocaleTimeString() : 'just now'

  mapEl.style.display = 'block'
  locationEl.innerText = `Last updated: ${updatedText}`

  if (!window.L) {
    locationEl.innerText += ' (Map unavailable)'
    return
  }

  if (!trackMap) {
    trackMap = L.map('trackMap').setView([lat, lng], 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(trackMap)
    trackMarker = L.marker([lat, lng]).addTo(trackMap)
  } else {
    trackMap.setView([lat, lng])
    if (trackMarker) trackMarker.setLatLng([lat, lng])
  }
}

async function renderMyOrders() {
  showSection('myOrders')
  const root = document.getElementById('myOrders')
  root.innerHTML = `
    <h2>📦 My Orders</h2>
    <div class="card">
      <label>Enter Your Phone Number</label>
      <input id="myPhone" placeholder="+233 XX XXX XXXX" />
      <button id="findMyOrders" style="background:var(--primary); color:#fff; border:0; padding:12px 24px; border-radius:8px; cursor:pointer; font-weight:600; margin-top:12px">
        Find My Orders
      </button>
      <div id="myOrdersList" style="margin-top:24px"></div>
    </div>`
  
  document.getElementById('findMyOrders').addEventListener('click', async ()=>{
    const phone = document.getElementById('myPhone').value.trim()
    if (!phone) return alert('Please enter your phone number')
    
    const resultDiv = document.getElementById('myOrdersList')
    resultDiv.innerHTML = '<p>Loading...</p>'
    
    try {
      // Fetch all orders (in real app, backend should filter by phone)
      const res = await fetch(`${API_BASE}/orders`)
      if (!res.ok) throw new Error('Failed to fetch orders')
      
      const allOrders = await res.json()
      const myOrders = allOrders.filter(o => o.customer?.phone?.includes(phone.replace(/\s/g, '')))
      
      if (myOrders.length === 0) {
        resultDiv.innerHTML = '<p style="color:#666">No orders found for this phone number</p>'
        return
      }
      
      resultDiv.innerHTML = '<h3 style="margin-bottom:16px">Your Orders</h3>' + myOrders.map(order => `
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px">
            <strong>Order #${order.id}</strong>
            <span style="color:var(--primary); font-weight:600">${order.status}</span>
          </div>
          <div>Total: <strong>GH₵ ${order.total.toFixed(2)}</strong></div>
          <div style="font-size:0.9rem; color:#666">
            ${order.delivery?.method === 'delivery' ? '🚚 Delivery' : '🏪 Pickup'} • 
            ${new Date(order.createdAt).toLocaleDateString('en-GB')}
          </div>
          <div style="margin-top:8px">
            ${(order.items || []).map(item => {
              const prod = products.find(p => p.id === item.product_id)
              return `<div style="font-size:0.9rem">• ${prod?.name || 'Product'} x ${item.qty}</div>`
            }).join('')}
          </div>
        </div>
      `).join('')
      
    } catch (e) {
      console.error(e)
      resultDiv.innerHTML = '<p style="color:var(--danger)">Error loading orders. Please try again.</p>'
    }
  })
}

// Navigation
window.addEventListener('DOMContentLoaded', async () => {
  loadCartSafely()
  document.getElementById('viewCatalog').addEventListener('click', ()=>{ showSection('catalog') })
  document.getElementById('viewCart').addEventListener('click', ()=>{ renderCart(); showSection('cart') })
  document.getElementById('viewMyOrders').addEventListener('click', ()=>{ renderMyOrders() })
  document.getElementById('viewTrack').addEventListener('click', ()=>{ renderTrack() })
  // Admin link is plain anchor to /admin.html
  loadProducts()
})