const { contextBridge, ipcRenderer } = require('electron')
let bwipjs = null
try {
  bwipjs = require('bwip-js')
} catch (err) {
  bwipjs = null
}

contextBridge.exposeInMainWorld('posApi', {
  getState: () => ipcRenderer.invoke('pos:getState'),
  saveState: (state) => ipcRenderer.invoke('pos:saveState', state),
  updateState: (patch) => ipcRenderer.invoke('pos:updateState', patch),
  addPendingChange: (change) => ipcRenderer.invoke('pos:addPendingChange', change),
  clearPendingChanges: (ids) => ipcRenderer.invoke('pos:clearPendingChanges', ids),
  generateBarcode: (text, options = {}) => new Promise((resolve, reject) => {
    if (!bwipjs) return reject(new Error('Barcode generator unavailable'))
    bwipjs.toBuffer({
      bcid: 'code128',
      text: String(text || ''),
      scale: options.scale || 3,
      height: options.height || 10,
      includetext: false,
      textxalign: 'center'
    }, (err, png) => {
      if (err) return reject(err)
      resolve(`data:image/png;base64,${png.toString('base64')}`)
    })
  })
})
