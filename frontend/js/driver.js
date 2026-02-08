const apiBaseFromDom = document.documentElement?.dataset?.apiBase?.trim() || ''
const API_BASE = (window.API_BASE || apiBaseFromDom || '').trim() || `${location.origin}/api`

let watchId = null
let lastSentAt = 0

function setStatus(message, isError = false) {
  const el = document.getElementById('driverStatus')
  if (!el) return
  el.style.color = isError ? '#dc3545' : '#555'
  el.textContent = message
}

function getParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    orderId: params.get('orderId') || '',
    token: params.get('token') || ''
  }
}

async function sendLocation({ orderId, token, lat, lng, accuracy }) {
  const res = await fetch(`${API_BASE}/orders/${orderId}/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, lat, lng, accuracy })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to update location')
  return data
}

function startTracking() {
  const orderId = document.getElementById('orderId').value.trim()
  const token = document.getElementById('trackingToken').value.trim()

  if (!orderId || !token) return setStatus('Order ID and tracking token are required.', true)
  if (!navigator.geolocation) return setStatus('Geolocation is not supported on this device.', true)

  setStatus('Requesting location permission...')

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const now = Date.now()
      if (now - lastSentAt < 8000) return
      lastSentAt = now

      try {
        await sendLocation({
          orderId,
          token,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        })
        const time = new Date().toLocaleTimeString()
        setStatus(`Location updated at ${time} (accuracy ±${Math.round(pos.coords.accuracy)}m)`)
      } catch (err) {
        setStatus(err.message, true)
      }
    },
    (err) => {
      setStatus(err.message || 'Failed to get location.', true)
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  )
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
    setStatus('Live location stopped.')
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const params = getParams()
  if (params.orderId) document.getElementById('orderId').value = params.orderId
  if (params.token) document.getElementById('trackingToken').value = params.token

  document.getElementById('startTracking').addEventListener('click', startTracking)
  document.getElementById('stopTracking').addEventListener('click', stopTracking)
})
