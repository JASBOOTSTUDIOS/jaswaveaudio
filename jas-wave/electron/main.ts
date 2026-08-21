const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const fsSync = require('fs')
import type { IpcMainInvokeEvent } from 'electron'
import { aiChat, aiHealth, legacyChatArgsToRequest, type AiChatRequest, type AiHealthRequest } from './ai-gateway'

let mainWindow: typeof BrowserWindow | null = null

/** Icono de app (ventana / taskbar). */
function resolveAppIconPath(): string | undefined {
  const fileName = 'jaswave-icono-con-frecuencia.png'
  const candidates = [
    // Dev: build/electron/electron → ../../../public
    path.join(__dirname, '..', '..', '..', 'public', fileName),
    // Prod: dist (Vite copia public/)
    path.join(__dirname, '..', '..', '..', 'dist', fileName),
    path.join(__dirname, '..', 'dist', fileName),
    path.join(process.resourcesPath || '', fileName),
  ]
  for (const candidate of candidates) {
    try {
      if (candidate && fsSync.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return undefined
}

function sendMenuAction(id: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu-action', id)
  }
}

function buildAppMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo proyecto', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('proyecto.nuevo') },
        { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('proyecto.abrir') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('proyecto.guardar') },
        { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('proyecto.guardarComo') },
        { type: 'separator' },
        { label: 'Cerrar proyecto', click: () => sendMenuAction('proyecto.cerrar') },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('edicion.deshacer') },
        { label: 'Rehacer', accelerator: 'CmdOrCtrl+Y', click: () => sendMenuAction('edicion.rehacer') },
        { type: 'separator' },
        { label: 'Cortar', accelerator: 'CmdOrCtrl+X', click: () => sendMenuAction('edicion.cortar') },
        { label: 'Copiar', accelerator: 'CmdOrCtrl+C', click: () => sendMenuAction('edicion.copiar') },
        { label: 'Pegar', accelerator: 'CmdOrCtrl+V', click: () => sendMenuAction('edicion.pegar') },
        { label: 'Duplicar', accelerator: 'CmdOrCtrl+D', click: () => sendMenuAction('edicion.duplicar') },
        { label: 'Eliminar', accelerator: 'Delete', click: () => sendMenuAction('edicion.eliminar') },
        { type: 'separator' },
        { label: 'Seleccionar todo', accelerator: 'CmdOrCtrl+A', click: () => sendMenuAction('edicion.seleccionarTodo') },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Acercar', accelerator: 'CmdOrCtrl+=', click: () => sendMenuAction('vista.zoomIn') },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: () => sendMenuAction('vista.zoomOut') },
        { label: 'Zoom predeterminado', click: () => sendMenuAction('vista.zoomTodo') },
        { type: 'separator' },
        { label: 'Panel izquierdo', click: () => sendMenuAction('ventana.barraLateral') },
        { label: 'Panel derecho', click: () => sendMenuAction('ventana.panelDerecho') },
        { label: 'Panel inferior', click: () => sendMenuAction('ventana.panelInferior') },
        { type: 'separator' },
        { label: 'Paleta de comandos', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendMenuAction('ventana.paletaComandos') },
        { label: 'Atajos de teclado…', click: () => sendMenuAction('ventana.atajos') },
      ],
    },
    {
      label: 'Transporte',
      submenu: [
        { label: 'Reproducir / Pausar', click: () => sendMenuAction('transporte.reproducir') },
        { label: 'Detener', click: () => sendMenuAction('transporte.detener') },
        { label: 'Grabar', accelerator: 'CmdOrCtrl+R', click: () => sendMenuAction('transporte.grabar') },
        { type: 'separator' },
        { label: 'Ir al inicio', click: () => sendMenuAction('transporte.inicio') },
        { label: 'Bucle', click: () => sendMenuAction('transporte.loop') },
        { label: 'Metrónomo', click: () => sendMenuAction('transporte.metronomo') },
      ],
    },
    {
      label: 'Acciones',
      submenu: [
        { label: 'Nueva pista de audio', click: () => sendMenuAction('pista.nueva') },
        { label: 'Nueva pista MIDI', click: () => sendMenuAction('pista.nuevaMidi') },
        { type: 'separator' },
        { label: 'Ajustes del proyecto…', click: () => sendMenuAction('ventana.ajustes') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const icon = resolveAppIconPath()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0b0d10',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.jaswave.app')
  }
  buildAppMenu()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close()
})

ipcMain.handle('window-is-maximized', () => {
  if (mainWindow) return mainWindow.isMaximized()
  return false
})

ipcMain.handle('file-save', async (_event: IpcMainInvokeEvent, ruta: string, contenido: string) => {
  try {
    await fs.writeFile(ruta, contenido, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle('file-read', async (_event: IpcMainInvokeEvent, ruta: string) => {
  const contenido = await fs.readFile(ruta, 'utf-8')
  return contenido
})

ipcMain.handle('file-exists', async (_event: IpcMainInvokeEvent, ruta: string) => {
  try {
    await fs.access(ruta)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('file-size', async (_event: IpcMainInvokeEvent, ruta: string) => {
  const stat = await fs.stat(ruta)
  return stat.size
})

ipcMain.handle('dialog-save', async () => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
    properties: ['createPanel'],
  })
  return result
})

ipcMain.handle('dialog-open', async () => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
    properties: ['openFile'],
  })
  return result
})

ipcMain.handle('project-save', async (_event: IpcMainInvokeEvent, _projectId: string, data: unknown) => {
  if (!mainWindow) return { success: false, error: 'No window' }
  try {
    const proyecto = (data as { project?: { ruta?: string; nombre?: string } })?.project
    let ruta = proyecto?.ruta
    if (!ruta) {
      const dialogResult = await dialog.showSaveDialog(mainWindow, {
        filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
        defaultPath: `${proyecto?.nombre || 'proyecto'}.jaswave`,
      })
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: false, canceled: true }
      }
      ruta = dialogResult.filePath.endsWith('.jaswave')
        ? dialogResult.filePath
        : `${dialogResult.filePath}.jaswave`
    }
    const json = JSON.stringify(data)
    await fs.writeFile(ruta, json, 'utf-8')
    const stat = await fs.stat(ruta)
    return { success: true, path: ruta, size: stat.size }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle('project-load', async (_event: IpcMainInvokeEvent, projectId: string) => {
  try {
    const ruta = projectId.endsWith('.jaswave') ? projectId : `${projectId}.jaswave`
    const contenido = await fs.readFile(ruta, 'utf-8')
    return { success: true, data: JSON.parse(contenido), path: ruta }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle('project-save-as', async (_event: IpcMainInvokeEvent, projectId: string, data: unknown) => {
  if (!mainWindow) return { success: false, canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
    properties: ['createPanel'],
  })
  if (result.canceled || !result.filePath) return { success: false, canceled: true }
  try {
    await fs.writeFile(result.filePath, JSON.stringify(data), 'utf-8')
    return { success: true, path: result.filePath, size: 0 }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle('project-open-dialog', async () => {
  if (!mainWindow) return { success: false, canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
  // Solo devolvemos la ruta; project.load + FileService leen el archivo
  return { success: true, path: result.filePaths[0] }
})

ipcMain.handle('project-list', async () => {
  return { success: true, projects: [] }
})

ipcMain.handle('ai-chat', async (_event: IpcMainInvokeEvent, payload: unknown, model?: string, baseUrl?: string, temperature?: number) => {
  // Nuevo: objeto AiChatRequest. Legacy: (messages[], model, baseUrl, temperature)
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'messages' in (payload as object) && 'kind' in (payload as object)) {
    return aiChat(payload as AiChatRequest)
  }
  return aiChat(legacyChatArgsToRequest((payload as unknown[]) ?? [], model, baseUrl, temperature))
})

ipcMain.handle('ai-health', async (_event: IpcMainInvokeEvent, payload?: unknown) => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'kind' in (payload as object)) {
    return aiHealth(payload as AiHealthRequest)
  }
  // Legacy: solo baseUrl string
  const baseUrl = typeof payload === 'string' ? payload : undefined
  return aiHealth({
    kind: 'ollama',
    baseUrl: baseUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  })
})

ipcMain.handle('dialog-message', async (_event: IpcMainInvokeEvent, type: string, title: string, message: string) => {
  if (!mainWindow) return 0
  const result = await dialog.showMessageBox(mainWindow, {
    type: type as any,
    title,
    message,
    buttons: ['OK'],
  })
  return result.response
})

ipcMain.handle('shell-open-external', async (_event: IpcMainInvokeEvent, url: string) => {
  const { shell } = require('electron')
  await shell.openExternal(url)
})

/** Ventanas flotantes de herramientas (multi-monitor) */
const toolWindows = new Map<string, typeof BrowserWindow>()

ipcMain.handle('tool-window-open', async (_event: IpcMainInvokeEvent, toolId: string, title: string) => {
  const existing = toolWindows.get(toolId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return { success: true, focused: true }
  }

  const icon = resolveAppIconPath()
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 480,
    minHeight: 320,
    title: `JasWave — ${title}`,
    backgroundColor: '#0b0d10',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  toolWindows.set(toolId, win)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  // Fallback: no quedar oculto si ready-to-show tarda
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }, 400)
  win.on('closed', () => {
    toolWindows.delete(toolId)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tool-window-closed', toolId)
    }
  })

  const query = `?undock=${encodeURIComponent(toolId)}`
  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(`${process.env.VITE_DEV_SERVER_URL}${query}`)
  } else {
    await win.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { undock: toolId },
    })
  }
  return { success: true }
})

ipcMain.handle('tool-window-close', async (_event: IpcMainInvokeEvent, toolId: string) => {
  const win = toolWindows.get(toolId)
  if (win && !win.isDestroyed()) win.close()
  toolWindows.delete(toolId)
})
