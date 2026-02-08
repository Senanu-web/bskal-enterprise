const apiBaseFromDom = document.documentElement?.dataset?.apiBase?.trim() || ''
const API_BASE = (window.API_BASE || apiBaseFromDom || '').trim() || `${location.origin}/api`

function setMessage(text, isError = false) {
  const el = document.getElementById('loginMessage')
  if (!el) return
  el.style.color = isError ? '#dc3545' : '#0a4a8a'
  el.textContent = text
}

async function login() {
  const username = document.getElementById('adminUsername').value.trim()
  const password = document.getElementById('adminPassword').value.trim()

  if (!username || !password) {
    setMessage('Please enter username and password.', true)
    return
  }

  try {
    const res = await fetch(`${API_BASE.replace('/api','')}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      setMessage(data.error || 'Login failed', true)
      return
    }
    setMessage('Login successful. Redirecting...')
    window.location.href = '/admin.html'
  } catch (e) {
    console.error(e)
    setMessage('Login failed. Please try again.', true)
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('adminLogin').addEventListener('click', login)
  document.getElementById('adminPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login()
  })
})
