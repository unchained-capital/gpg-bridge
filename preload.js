const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onServerStatus: (callback) => ipcRenderer.on("server-status", callback),
});

contextBridge.exposeInMainWorld("electronAPI", {
  onLogMessage: (callback) =>
    ipcRenderer.on("log-message", (event, message) => callback(message)),
});

contextBridge.exposeInMainWorld("electron", {
  onYubiKeyTouchRequired: (callback) => {
    ipcRenderer.on("yubikey-touch-required", (_, message) => callback(message));
  },

  onYubiKeyTouchComplete: (callback) => {
    ipcRenderer.on("yubikey-touch-complete", (_, message) => callback(message));
  },
});
