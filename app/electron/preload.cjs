const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicEngine", {
  getLogs: () => ipcRenderer.invoke("log:get"),
  onLog: (cb) => {
    const listener = (_event, entry) => cb(entry);
    ipcRenderer.on("log", listener);
    return () => ipcRenderer.removeListener("log", listener);
  },
  analyze: (payload) => ipcRenderer.invoke("pipeline:analyze", payload),
  generate: (payload) => ipcRenderer.invoke("pipeline:generate", payload),
  exportMusicXml: (payload) => ipcRenderer.invoke("pipeline:export", payload),
  chooseExportPath: () => ipcRenderer.invoke("dialog:saveMusicXml"),
  openOutputFolder: (folderPath) => ipcRenderer.invoke("shell:openFolder", folderPath),
  openOutputFile: (filePath) => ipcRenderer.invoke("shell:openFile", filePath)
});
