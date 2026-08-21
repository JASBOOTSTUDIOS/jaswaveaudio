const { contextBridge, ipcRenderer } = require('electron')
import type { IpcMainInvokeEvent } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window-maximized-changed', (_event: IpcMainInvokeEvent, isMaximized: boolean) => {
      callback(isMaximized)
    })
  },
  fileSave: (ruta: string, contenido: string) => ipcRenderer.invoke('file-save', ruta, contenido),
  fileRead: (ruta: string) => ipcRenderer.invoke('file-read', ruta),
  fileExists: (ruta: string) => ipcRenderer.invoke('file-exists', ruta),
  fileSize: (ruta: string) => ipcRenderer.invoke('file-size', ruta),
  dialogSave: () => ipcRenderer.invoke('dialog-save'),
  dialogOpen: () => ipcRenderer.invoke('dialog-open'),
  projectSave: (projectId: string, data: unknown) => ipcRenderer.invoke('project-save', projectId, data),
  projectLoad: (projectId: string) => ipcRenderer.invoke('project-load', projectId),
  projectOpenDialog: () => ipcRenderer.invoke('project-open-dialog'),
  projectSaveAs: (projectId: string, data: unknown) => ipcRenderer.invoke('project-save-as', projectId, data),
  projectList: () => ipcRenderer.invoke('project-list'),
  aiChat: (payload: unknown, model?: string, baseUrl?: string, temperature?: number) =>
    ipcRenderer.invoke('ai-chat', payload, model, baseUrl, temperature),
  aiHealth: (payload?: unknown) => ipcRenderer.invoke('ai-health', payload),
  dialogMessage: (type: string, title: string, message: string) => ipcRenderer.invoke('dialog-message', type, title, message),
  shellOpenExternal: (url: string) => ipcRenderer.invoke('shell-open-external', url),
  openToolWindow: (toolId: string, title: string) => ipcRenderer.invoke('tool-window-open', toolId, title),
  closeToolWindow: (toolId: string) => ipcRenderer.invoke('tool-window-close', toolId),
  onToolWindowClosed: (callback: (toolId: string) => void) => {
    const handler = (_event: unknown, toolId: string) => callback(toolId)
    ipcRenderer.on('tool-window-closed', handler)
    return () => ipcRenderer.removeListener('tool-window-closed', handler)
  },
  onMenuAction: (callback: (actionId: string) => void) => {
    const handler = (_event: unknown, actionId: string) => callback(actionId)
    ipcRenderer.on('menu-action', handler)
    return () => ipcRenderer.removeListener('menu-action', handler)
  },
})
