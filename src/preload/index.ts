import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type WowdApi,
  type MenuCommand,
  type TemplateId,
  type PrintRequest
} from '../shared/ipc'

/**
 * ipcRenderer を参照してよい唯一のファイル。
 * ここにビジネスロジックは置かない。チャネルを型付きの関数に写すだけ。
 */
const api: WowdApi = {
  openDialog: () => ipcRenderer.invoke(IPC.openDialog),
  openPath: (path: string) => ipcRenderer.invoke(IPC.openPath, path),
  saveDialog: (defaultPath?: string) => ipcRenderer.invoke(IPC.saveDialog, defaultPath),
  writeFile: (path: string, bytes: Uint8Array) => ipcRenderer.invoke(IPC.writeFile, path, bytes),
  readTemplate: (id: TemplateId) => ipcRenderer.invoke(IPC.readTemplate, id),

  getRecent: () => ipcRenderer.invoke(IPC.getRecent),
  addRecent: (path: string) => ipcRenderer.invoke(IPC.addRecent, path),
  clearRecent: () => ipcRenderer.invoke(IPC.clearRecent),

  saveRecovery: (bytes: Uint8Array, originalPath: string | null, name: string) =>
    ipcRenderer.invoke(IPC.saveRecovery, bytes, originalPath, name),
  listRecovery: () => ipcRenderer.invoke(IPC.listRecovery),
  readRecovery: (id: string) => ipcRenderer.invoke(IPC.readRecovery, id),
  clearRecovery: () => ipcRenderer.invoke(IPC.clearRecovery),

  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  showItemInFolder: (path: string) => ipcRenderer.invoke(IPC.showItemInFolder, path),
  confirmDiscard: (name: string) => ipcRenderer.invoke(IPC.confirmDiscard, name),
  reportError: (title: string, message: string) => ipcRenderer.invoke(IPC.reportError, title, message),
  printToPdf: (request: PrintRequest) => ipcRenderer.invoke(IPC.printToPdf, request),

  onMenuCommand(cb: (cmd: MenuCommand) => void) {
    const listener = (_e: IpcRendererEvent, cmd: MenuCommand): void => cb(cmd)
    ipcRenderer.on(IPC.menuCommand, listener)
    return () => ipcRenderer.removeListener(IPC.menuCommand, listener)
  },

  onOpenFileRequest(cb: (path: string) => void) {
    const listener = (_e: IpcRendererEvent, path: string): void => cb(path)
    ipcRenderer.on(IPC.openFileRequest, listener)
    return () => ipcRenderer.removeListener(IPC.openFileRequest, listener)
  },

  onQueryDirty(cb: () => boolean) {
    const listener = (e: IpcRendererEvent): void => {
      e.sender.send(IPC.queryDirty, cb())
    }
    ipcRenderer.on(IPC.queryDirty, listener)
    return () => ipcRenderer.removeListener(IPC.queryDirty, listener)
  }
}

contextBridge.exposeInMainWorld('wowd', api)
