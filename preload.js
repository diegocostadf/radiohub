'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rh', {
  engine: (method, params) => ipcRenderer.invoke('engine', method, params),
  onEngineEvent: (fn) => ipcRenderer.on('engine-event', (_e, msg) => fn(msg)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  testAI: (provider) => ipcRenderer.invoke('ai:test', provider),
  listModels: (provider) => ipcRenderer.invoke('ai:models', provider),
  keyWizard: (provider) => ipcRenderer.invoke('key:wizard', provider),
  openBilling: () => ipcRenderer.invoke('key:billing'),
  getPhoto: (id) => ipcRenderer.invoke('photo:get', id),
  choosePhoto: (id) => ipcRenderer.invoke('photo:choose', id),
  removePhoto: (id) => ipcRenderer.invoke('photo:remove', id),
  openFile: (kind) => ipcRenderer.invoke('file:open', kind),
  saveFile: (kind, suggested) => ipcRenderer.invoke('file:save', kind, suggested),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openUrl: (u) => ipcRenderer.invoke('shell:open', u),
  copy: (t) => ipcRenderer.invoke('clipboard:write', t),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  skipUpdate: (v) => ipcRenderer.invoke('update:skip', v),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onUpdate: (fn) => ipcRenderer.on('update-available', (_e, info) => fn(info)),
  onUpdateProgress: (fn) => ipcRenderer.on('update-progress', (_e, p) => fn(p))
});
