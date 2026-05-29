const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  onState: (cb) => {
    ipcRenderer.on('overlay-state', (_e, state) => cb(state))
  },
  askLoomie: (question) => ipcRenderer.invoke('overlay-loomie-ask', question),
  setInteractive: (interactive) => ipcRenderer.send('overlay-set-interactive', interactive),
  spotifyControl: (action) => ipcRenderer.send('overlay-spotify-control', action),
})
