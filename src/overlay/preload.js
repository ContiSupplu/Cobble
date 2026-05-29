const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  onState: (cb) => {
    ipcRenderer.on('overlay-state', (_e, state) => cb(state))
  },
  askPebble: (question) => ipcRenderer.invoke('overlay-pebble-ask', question),
  setInteractive: (interactive) => ipcRenderer.send('overlay-set-interactive', interactive),
  spotifyControl: (action) => ipcRenderer.send('overlay-spotify-control', action),
})
