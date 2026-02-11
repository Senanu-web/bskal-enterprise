const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { autoUpdater } = require('electron-updater')

const WINDOW = { width: 1280, height: 800 }

function getStorePath() {
  return path.join(app.getPath('userData'), 'pos-store.json')
}

function defaultState() {
  return {
    deviceId: crypto.randomUUID(),
    products: [],
    orders: [],
    pendingChanges: [],
    lastSyncAt: null,
    reports: { profitLoss: null, weeklySales: null, customerDiscounts: null },
    staffUsers: [],
    currentStaff: null,
    lastStaff: null,
    currentShift: null,
    lastShiftSummary: null,
    branches: [],
    settings: {
      apiBase: 'http://localhost:5500/api',
      posToken: '',
      printMode: 'thermal',
      staffToken: '',
      branchId: '',
      updateUrl: ''
    }
  }
}

function readState() {
  const storePath = getStorePath()
  if (!fs.existsSync(storePath)) return defaultState()
  try {
    const raw = fs.readFileSync(storePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed.deviceId) parsed.deviceId = crypto.randomUUID()
    if (!parsed.pendingChanges) parsed.pendingChanges = []
    if (!parsed.settings) parsed.settings = { apiBase: 'http://localhost:5500/api', posToken: '', printMode: 'thermal', staffToken: '' }
    if (!parsed.settings.printMode) parsed.settings.printMode = 'thermal'
    if (!parsed.settings.staffToken) parsed.settings.staffToken = ''
    if (!parsed.settings.updateUrl) parsed.settings.updateUrl = ''
    if (!parsed.reports) parsed.reports = { profitLoss: null, weeklySales: null, customerDiscounts: null }
    if (!parsed.staffUsers) parsed.staffUsers = []
    if (!parsed.currentStaff) parsed.currentStaff = null
    if (!parsed.lastStaff) parsed.lastStaff = null
    if (!parsed.currentShift) parsed.currentShift = null
    if (!parsed.lastShiftSummary) parsed.lastShiftSummary = null
    if (!parsed.branches) parsed.branches = []
    if (!parsed.settings.branchId) parsed.settings.branchId = ''
    return parsed
  } catch (err) {
    return defaultState()
  }
}

function getUpdateConfigFromState(state) {
  const updateUrl = state?.settings?.updateUrl || ''
  const token = state?.settings?.posToken || ''
  if (!updateUrl) return null
  return { updateUrl, token }
}

function configureAutoUpdater() {
  if (!app.isPackaged) return
  const state = readState()
  const config = getUpdateConfigFromState(state)
  if (!config) return
  autoUpdater.autoDownload = true
  autoUpdater.setFeedURL({ provider: 'generic', url: config.updateUrl })
  if (config.token) {
    autoUpdater.requestHeaders = { 'x-download-token': config.token }
  }
  autoUpdater.checkForUpdatesAndNotify()
}

function startAutoUpdater() {
  if (!app.isPackaged) return
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err?.message || err)
  })
  autoUpdater.on('update-downloaded', () => {
    const win = BrowserWindow.getAllWindows()[0]
    const prompt = dialog.showMessageBoxSync(win, {
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: 'A new POS update is ready. Restart to install it now?'
    })
    if (prompt === 0) autoUpdater.quitAndInstall()
  })

  configureAutoUpdater()
  setInterval(() => configureAutoUpdater(), 6 * 60 * 60 * 1000)
}

function writeState(state) {
  const storePath = getStorePath()
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2))
}

function createWindow() {
  const win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(() => {
  createWindow()
  startAutoUpdater()

  ipcMain.handle('pos:getState', () => readState())
  ipcMain.handle('pos:saveState', (event, state) => {
    writeState(state)
    return true
  })
  ipcMain.handle('pos:updateState', (event, patch) => {
    const current = readState()
    const next = { ...current, ...patch }
    writeState(next)
    return next
  })
  ipcMain.handle('pos:addPendingChange', (event, change) => {
    const current = readState()
    current.pendingChanges = [...(current.pendingChanges || []), change]
    writeState(current)
    return current.pendingChanges
  })
  ipcMain.handle('pos:clearPendingChanges', (event, ids) => {
    const current = readState()
    const toRemove = new Set(ids || [])
    current.pendingChanges = (current.pendingChanges || []).filter(c => !toRemove.has(c.changeId))
    writeState(current)
    return current.pendingChanges
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
