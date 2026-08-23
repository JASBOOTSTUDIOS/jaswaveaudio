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
    dialogOpenDirectory: () => ipcRenderer.invoke('dialog-open-directory'),
    projectSave: (projectId, data) => ipcRenderer.invoke('project-save', projectId, data),
    projectLoad: (projectId) => ipcRenderer.invoke('project-load', projectId),
    projectOpenDialog: () => ipcRenderer.invoke('project-open-dialog'),
    projectSaveAs: (projectId, data) => ipcRenderer.invoke('project-save-as', projectId, data),
    projectList: () => ipcRenderer.invoke('project-list'),
    aiChat: (payload, model, baseUrl, temperature) => ipcRenderer.invoke('ai-chat', payload, model, baseUrl, temperature),
    aiHealth: (payload) => ipcRenderer.invoke('ai-health', payload),
    pluginLookup: (pluginName) => ipcRenderer.invoke('plugin-lookup', pluginName),
    dialogMessage: (type, title, message) => ipcRenderer.invoke('dialog-message', type, title, message),
    shellOpenExternal: (url) => ipcRenderer.invoke('shell-open-external', url),
    openToolWindow: (toolId, title, extra) => ipcRenderer.invoke('tool-window-open', toolId, title, extra),
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
    // Native C++ audio (ADR-0009)
    nativeAudioAvailable: () => ipcRenderer.invoke('native-audio-available'),
    nativeAudioInitialize: (config) => ipcRenderer.invoke('native-audio-initialize', config),
    nativeAudioShutdown: () => ipcRenderer.invoke('native-audio-shutdown'),
    nativeAudioLoadBuffer: (id, samples, sampleRate, channels) => ipcRenderer.invoke('native-audio-load-buffer', id, samples, sampleRate, channels),
    nativeAudioUnloadBuffer: (id) => ipcRenderer.invoke('native-audio-unload-buffer', id),
    nativeAudioSetGraph: (graph) => ipcRenderer.invoke('native-audio-set-graph', graph),
    nativeAudioPlay: () => ipcRenderer.invoke('native-audio-play'),
    nativeAudioPause: () => ipcRenderer.invoke('native-audio-pause'),
    nativeAudioStop: () => ipcRenderer.invoke('native-audio-stop'),
    nativeAudioSeek: (seconds) => ipcRenderer.invoke('native-audio-seek', seconds),
    nativeAudioGetPlayhead: () => ipcRenderer.invoke('native-audio-playhead'),
    nativeAudioIsPlaying: () => ipcRenderer.invoke('native-audio-is-playing'),
    nativeAudioGetMeterPeak: () => ipcRenderer.invoke('native-audio-meter'),
    pluginHostStatus: () => ipcRenderer.invoke('plugin-host-status'),
    pluginHostEnsure: () => ipcRenderer.invoke('plugin-host-ensure'),
    pluginHostSend: (cmd) => ipcRenderer.invoke('plugin-host-send', cmd),
    pluginHostMidi: (cmd) => ipcRenderer.invoke('plugin-host-midi', cmd),
    onPluginHostRestarted: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('plugin-host-restarted', handler);
        return () => ipcRenderer.removeListener('plugin-host-restarted', handler);
    },
    pluginHostPushPcm: (samples) => {
        // Siempre Uint8Array: ArrayBuffer puro a veces no sobrevive el clone IPC de Electron.
        let u8;
        if (samples instanceof Uint8Array && samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength) {
            u8 = samples;
        }
        else if (samples instanceof ArrayBuffer) {
            u8 = new Uint8Array(samples.slice(0));
        }
        else if (ArrayBuffer.isView(samples)) {
            u8 = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength).slice();
        }
        else {
            return;
        }
        ipcRenderer.send('plugin-host-pcm', u8);
    },
    pluginHostStop: () => ipcRenderer.invoke('plugin-host-stop'),
});
