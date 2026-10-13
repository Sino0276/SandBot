import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { posix, relative, resolve, sep } from 'path'
import { IPC, type SandbotApi } from '../shared/ipc'

const api: SandbotApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  relativePath: (from, to) => relative(from, to).split(sep).join(posix.sep),
  resolvePath: (base, target) => resolve(base, target),
  chooseProjectFolder: (title) => ipcRenderer.invoke(IPC.chooseProjectFolder, title),
  chooseStepFile: (title, defaultPath) =>
    ipcRenderer.invoke(IPC.chooseStepFile, title, defaultPath),
  openProject: (root) => ipcRenderer.invoke(IPC.openProject, root),
  saveProject: (root, content) => ipcRenderer.invoke(IPC.saveProject, root, content),
  readStepCached: (path, tag) => ipcRenderer.invoke(IPC.readStepCached, path, tag),
  storeMeshCache: (key, model) => ipcRenderer.invoke(IPC.storeMeshCache, key, model),
  syncGeneratedFiles: (root, files) => ipcRenderer.invoke(IPC.syncGeneratedFiles, root, files),
  setDirty: (dirty) => ipcRenderer.send(IPC.setDirty, dirty),
  onCloseRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.closeRequested, listener)
    return () => ipcRenderer.removeListener(IPC.closeRequested, listener)
  },
  confirmClose: () => ipcRenderer.send(IPC.confirmClose)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
