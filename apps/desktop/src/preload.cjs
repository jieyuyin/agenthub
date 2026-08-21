const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agenthubDesktop', {
  isDesktop: true,
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  invokeTool: (request) => ipcRenderer.invoke('workspace:tool', request)
})
