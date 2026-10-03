'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Мост в главный процесс. Наружу отдаются только именованные операции —
 * сам ipcRenderer не экспонируется.
 */
contextBridge.exposeInMainWorld('api', {
  pickSources: () => ipcRenderer.invoke('dialog:pickSources'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickOutDir: () => ipcRenderer.invoke('dialog:pickOutDir'),
  pickCover: () => ipcRenderer.invoke('dialog:pickCover'),

  analyze: (paths) => ipcRenderer.invoke('book:analyze', paths),
  applyEdits: (edits) => ipcRenderer.invoke('book:applyEdits', edits),
  build: (opts) => ipcRenderer.invoke('book:build', opts),

  assetDataUrl: (assetId) => ipcRenderer.invoke('asset:dataUrl', assetId),
  styleDefaults: () => ipcRenderer.invoke('style:defaults'),

  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  openFile: (filePath) => ipcRenderer.invoke('shell:open', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  /** Путь перетащенного файла: File.path в Electron 32+ больше не доступен. */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
});
