"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    windowMinimize: () => ipcRenderer.invoke('window-minimize'),
    windowMaximize: () => ipcRenderer.invoke('window-maximize'),
    windowClose: () => ipcRenderer.invoke('window-close'),
    windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    onWindowMaximizedChanged: (callback) => {
        ipcRenderer.on('window-maximized-changed', (_event, isMaximized) => {
            callback(isMaximized);
        });
    },
    fileSave: (ruta, contenido) => ipcRenderer.invoke('file-save', ruta, contenido),
    fileRead: (ruta) => ipcRenderer.invoke('file-read', ruta),
    fileExists: (ruta) => ipcRenderer.invoke('file-exists', ruta),
    fileSize: (ruta) => ipcRenderer.invoke('file-size', ruta),
    dialogSave: () => ipcRenderer.invoke('dialog-save'),
    dialogOpen: () => ipcRenderer.invoke('dialog-open'),
    projectSave: (projectId, data) => ipcRenderer.invoke('project-save', projectId, data),
    projectLoad: (projectId) => ipcRenderer.invoke('project-load', projectId),
    projectOpenDialog: () => ipcRenderer.invoke('project-open-dialog'),
    projectSaveAs: (projectId, data) => ipcRenderer.invoke('project-save-as', projectId, data),
    projectList: () => ipcRenderer.invoke('project-list'),
    aiChat: (payload, model, baseUrl, temperature) => ipcRenderer.invoke('ai-chat', payload, model, baseUrl, temperature),
    aiHealth: (payload) => ipcRenderer.invoke('ai-health', payload),
    dialogMessage: (type, title, message) => ipcRenderer.invoke('dialog-message', type, title, message),
    shellOpenExternal: (url) => ipcRenderer.invoke('shell-open-external', url),
    openToolWindow: (toolId, title) => ipcRenderer.invoke('tool-window-open', toolId, title),
    closeToolWindow: (toolId) => ipcRenderer.invoke('tool-window-close', toolId),
    onToolWindowClosed: (callback) => {
        const handler = (_event, toolId) => callback(toolId);
        ipcRenderer.on('tool-window-closed', handler);
        return () => ipcRenderer.removeListener('tool-window-closed', handler);
    },
    onMenuAction: (callback) => {
        const handler = (_event, actionId) => callback(actionId);
        ipcRenderer.on('menu-action', handler);
        return () => ipcRenderer.removeListener('menu-action', handler);
    },
});
