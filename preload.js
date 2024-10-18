const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onServerStatus: (callback) => ipcRenderer.on("server-status", callback),
});

contextBridge.exposeInMainWorld("electronAPI", {
  onLogMessage: (callback) =>
    ipcRenderer.on("log-message", (event, message) => callback(message)),
});
