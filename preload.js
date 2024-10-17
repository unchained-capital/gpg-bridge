// preload.js

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onServerStatus: (callback) => ipcRenderer.on("server-status", callback),
});
