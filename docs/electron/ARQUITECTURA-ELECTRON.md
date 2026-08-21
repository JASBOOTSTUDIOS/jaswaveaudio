# Arquitectura de Electron

## 1. Visión General

Jaswave usa Electron como framework de escritorio. Electron encapsula el motor de Chromium y Node.js, permitiendo desarrollar la UI con tecnologías web mientras se accede a funcionalidades nativas.

## 2. Arquitectura de Procesos

```
┌──────────────────────────────────────────────┐
│                   Electron App                │
├────────────┬────────────┬─────────────────────┤
│  Main      │ Renderer   │  Native Bridge      │
│  Process   │ Process    │  (FFI a C++/C++)   │
│            │            │                      │
│  - Node.js │  - Chromium│  - Audio I/O        │
│  - IPC     │  - React   │  - DSP               │
│  - FS      │  - TS      │  - Plugins           │
│  - Audio   │            │                      │
│    Bridge  │            │                      │
└────────────┴────────────┴─────────────────────┘
```

## 3. Proceso Principal (Main)

Responsabilidades:
- Gestión de ventanas
- IPC con Renderer
- Acceso al sistema de archivos
- Comunicación con Native Bridge
- Servicios de dominio (proyecto, audio, IA)
- Lifecycle de la aplicación

```typescript
// main/index.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { ProjectService } from './services/project.service';
import { AudioService } from './services/audio.service';
import { AIService } from './services/ai.service';

let mainWindow: BrowserWindow;
const projectService = new ProjectService();
const audioService = new AudioService();
const aiService = new AIService();

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  // Registrar handlers IPC
  ipcMain.handle('project:save', async (_, project) => {
    return projectService.save(project);
  });
  
  ipcMain.handle('audio:start', async () => {
    return audioService.startPlayback();
  });
  
  ipcMain.handle('ai:sendMessage', async (_, message) => {
    return aiService.sendMessage(message);
  });
});
```

## 4. Script de Preload

El preload expone APIs tipadas al Renderer de forma segura:

```typescript
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jaswave', {
  // Command System
  executeCommand: (type: string, payload: unknown) => 
    ipcRenderer.invoke('command:execute', type, payload),
  undo: () => ipcRenderer.invoke('command:undo'),
  redo: () => ipcRenderer.invoke('command:redo'),
  
  // Query API
  getProjectSummary: () => ipcRenderer.invoke('query:projectSummary'),
  getTracks: () => ipcRenderer.invoke('query:tracks'),
  getMixerState: () => ipcRenderer.invoke('query:mixer'),
  
  // Audio
  startPlayback: () => ipcRenderer.invoke('audio:start'),
  stopPlayback: () => ipcRenderer.invoke('audio:stop'),
  seek: (position: number) => ipcRenderer.invoke('audio:seek', position),
  
  // AI
  sendChatMessage: (message: string) => ipcRenderer.invoke('ai:sendMessage', message),
  setPermissionLevel: (level: PermissionLevel) => 
    ipcRenderer.invoke('ai:setPermissionLevel', level),
  
  // Eventos (read-only)
  onEvent: (event: string, handler: (payload: unknown) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      handler(payload);
    };
    ipcRenderer.on(event, subscription);
    return { unsubscribe: () => ipcRenderer.removeListener(event, subscription) };
  }
});
```

## 5. Proceso de Renderizado (UI)

El Renderer ejecuta la aplicación React:

- No tiene acceso a `require`, `process`, `fs` ni APIs de Node.js
- Se comunica exclusivamente mediante `window.jaswave` (expuesto por preload)
- Usa React con TypeScript
- Estilos con CSS Modules o equivalente

```typescript
// renderer/index.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

## 6. Canales IPC

Todos los canales IPC están tipados y centralizados:

```typescript
// main/ipc/channels.ts
export const IpcChannels = {
  // Command System
  'command:execute': 'command:execute',
  'command:undo': 'command:undo',
  'command:redo': 'command:redo',
  
  // Query API
  'query:projectSummary': 'query:projectSummary',
  'query:tracks': 'query:tracks',
  'query:mixer': 'query:mixer',
  
  // Audio
  'audio:start': 'audio:start',
  'audio:stop': 'audio:stop',
  'audio:seek': 'audio:seek',
  
  // AI
  'ai:sendMessage': 'ai:sendMessage',
  'ai:setPermissionLevel': 'ai:setPermissionLevel',
  
  // Eventos (broadcast)
  'event:project.updated': 'event:project.updated',
  'event:track.created': 'event:track.created',
  'event:audio.analysis.updated': 'event:audio.analysis.updated'
} as const;
```

## 7. Seguridad

- `contextIsolation: true` (default en Electron moderno)
- `nodeIntegration: false`
- `sandbox: true` (recomendado para Renderer)
- No usar `remote` module (deprecado)
- Validar todos los payloads IPC en el Main process
- CSP estricto para recursos cargados remotamente

## 8. Actualizaciones

Auto-updater integrado:

```typescript
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();
```

## 9. Empaquetado

Usar `electron-builder` para empaquetar:

```json
{
  "build": {
    "appId": "com.jaswave.daw",
    "productName": "Jaswave",
    "directories": {
      "output": "dist"
    },
    "files": [
      "build/**/*",
      "node_modules/**/*"
    ],
    "extraResources": [
      {
        "from": "native/",
        "to": "native/"
      }
    ]
  }
}
```

El motor de audio nativo se empaqueta como `extraResource` y se carga dinámicamente.
