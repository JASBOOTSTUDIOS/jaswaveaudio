const { app, BrowserWindow, ipcMain, dialog, Menu, session, clipboard } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const fsSync = require('fs')
import type { IpcMainInvokeEvent } from 'electron'
import { aiChat, aiHealth, legacyChatArgsToRequest, type AiChatRequest, type AiHealthRequest } from './ai-gateway'
import { lookupPluginOnWeb } from './plugin-lookup'
import { searchWeb } from './web-search'
import {
  resolveAgentBridgeReply,
  startAgentBridge,
  stopAgentBridge,
} from './agent-bridge'

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
  const focused = BrowserWindow.getFocusedWindow()
  // Transporte / proyecto: siempre en la ventana principal (motor de audio).
  if (
    String(id).startsWith('transporte.') ||
    String(id).startsWith('proyecto.') ||
    id === 'ventana.ajustes'
  ) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('menu-action', id)
    }
    return
  }
  const target =
    focused && !focused.isDestroyed()
      ? focused
      : mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : null
  target?.webContents.send('menu-action', id)
}

function senderIsSatellite(sender: { getURL?: () => string } | null | undefined): boolean {
  try {
    const url = sender?.getURL?.() ?? ''
    return /(?:\?|&)undock=/.test(url) || url.includes('#undock/')
  } catch {
    return false
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
        { label: 'Eliminar', click: () => sendMenuAction('edicion.eliminar') },
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
        {
          label: 'Herramientas',
          submenu: [
            { label: 'Asistente Jas', click: () => sendMenuAction('ventana.tool.coproducer') },
            { label: 'Explorador', click: () => sendMenuAction('ventana.tool.docs-explorer') },
            { label: 'Docs', click: () => sendMenuAction('ventana.tool.docs') },
            { label: 'Biblioteca', click: () => sendMenuAction('ventana.tool.library') },
            { label: 'Instrumentos', click: () => sendMenuAction('ventana.tool.instruments') },
            { label: 'MIDI · MD', click: () => sendMenuAction('ventana.tool.midi-md') },
            { type: 'separator' },
            { label: 'Arrange', click: () => sendMenuAction('ventana.tool.arrange') },
            { label: 'Mixer', click: () => sendMenuAction('ventana.tool.mixer') },
            { label: 'Piano roll', click: () => sendMenuAction('ventana.tool.piano-roll') },
            { label: 'Partitura', click: () => sendMenuAction('ventana.tool.score-editor') },
            { label: 'Terminal', click: () => sendMenuAction('ventana.tool.terminal') },
            { type: 'separator' },
            { label: 'Inspector', click: () => sendMenuAction('ventana.tool.track-detail') },
            { label: 'FX Chain', click: () => sendMenuAction('ventana.tool.fx-chain') },
            { label: 'Automatización', click: () => sendMenuAction('ventana.tool.automation') },
            { label: 'Editor de plugin', click: () => sendMenuAction('ventana.tool.plugin-editor') },
            { label: 'MIDI Learn', click: () => sendMenuAction('ventana.tool.midi-map') },
            { label: 'Medidores', click: () => sendMenuAction('ventana.tool.meters') },
            { label: 'Ruteo', click: () => sendMenuAction('ventana.tool.routing') },
            { label: 'Configuración', click: () => sendMenuAction('ventana.tool.settings') },
          ],
        },
        { type: 'separator' },
        { label: 'Paleta de comandos', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendMenuAction('ventana.paletaComandos') },
        { label: 'Atajos de teclado…', click: () => sendMenuAction('ventana.atajos') },
        { label: 'Control MIDI / MIDI Learn', accelerator: 'CmdOrCtrl+Shift+M', click: () => sendMenuAction('ventana.midiMap') },
        { label: 'Terminal', accelerator: 'CmdOrCtrl+`', click: () => sendMenuAction('ventana.terminal') },
      ],
    },
    {
      label: 'Transporte',
      submenu: [
        // Sin accelerator: Space/Enter deben llegar al renderer (p. ej. chat del agente).
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

function disablePageZoom(win: InstanceType<typeof BrowserWindow>) {
  try {
    // Ctrl+rueda / pinch no deben hacer zoom de página (rompe paneles undock / arrangement).
    void win.webContents.setVisualZoomLevelLimits(1, 1)
    win.webContents.setZoomFactor(1)
    win.webContents.on('zoom-changed', () => {
      try {
        win.webContents.setZoomFactor(1)
      } catch {
        /* ignore */
      }
    })
  } catch {
    /* ignore */
  }
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

  disablePageZoom(mainWindow)

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
  session.defaultSession.setPermissionRequestHandler(
    (_wc: unknown, perm: string, callback: (ok: boolean) => void) => {
      callback(
        perm === 'midi' ||
          perm === 'midiSysex' ||
          perm === 'media' ||
          perm === 'audioCapture' ||
          perm === 'mediaKeySystem',
      )
    },
  )
  session.defaultSession.setPermissionCheckHandler((_wc: unknown, perm: string) => {
    return (
      perm === 'midi' ||
      perm === 'midiSysex' ||
      perm === 'media' ||
      perm === 'audioCapture'
    )
  })
  try {
    session.defaultSession.setDevicePermissionHandler((details: { deviceType?: string }) => {
      return (
        details?.deviceType === 'midi' ||
        details?.deviceType === 'hid' ||
        details?.deviceType === 'audio' ||
        details?.deviceType === 'unknown'
      )
    })
  } catch {
    /* Electron viejo sin device permission handler */
  }
  buildAppMenu()
  createWindow()
  startAgentBridge({
    getMainWindow: () => mainWindow as import('electron').BrowserWindow | null,
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAgentBridge()
  try {
    require('./plugin-host-bridge').stopPluginHost()
  } catch {
    /* ignore */
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('clipboard-write-text', (_e: IpcMainInvokeEvent, text: unknown) => {
  clipboard.writeText(String(text ?? ''))
  return true
})
ipcMain.handle('env-local-appdata', () => process.env.LOCALAPPDATA || '')
ipcMain.handle('user-data-path', () => app.getPath('userData'))

ipcMain.on('agent-bridge-reply', (_event: IpcMainInvokeEvent, id: string, result: unknown, error?: string) => {
  resolveAgentBridgeReply(String(id), result, error ? String(error) : undefined)
})

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
    await fs.mkdir(path.dirname(ruta), { recursive: true })
    await fs.writeFile(ruta, contenido, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle('file-save-binary', async (_event: IpcMainInvokeEvent, ruta: string, data: Uint8Array | ArrayBuffer) => {
  try {
    await fs.mkdir(path.dirname(ruta), { recursive: true })
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
    await fs.writeFile(ruta, buf)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle('ffmpeg-available', async () => {
  try {
    const { spawn } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-version'], { windowsHide: true })
      child.on('error', (e) => reject(e))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg exit ${code}`))
      })
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle(
  'ffmpeg-convert',
  async (
    _event: IpcMainInvokeEvent,
    input: string,
    output: string,
    extraArgs: string[] = [],
  ) => {
    try {
      const { spawn } = await import('node:child_process')
      await fs.mkdir(path.dirname(output), { recursive: true })
      const args = ['-y', '-i', input, ...extraArgs, output]
      await new Promise<void>((resolve, reject) => {
        const child = spawn('ffmpeg', args, { windowsHide: true })
        let err = ''
        child.stderr?.on('data', (d: Buffer) => {
          err += d.toString()
        })
        child.on('error', (e) => reject(e))
        child.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(err.slice(-400) || `ffmpeg exit ${code}`))
        })
      })
      return { ok: true, output }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle('file-read-binary', async (_event: IpcMainInvokeEvent, ruta: string) => {
  const buf = await fs.readFile(ruta)
  return buf
})

ipcMain.handle('recordings-dir', async (_event: IpcMainInvokeEvent, projectPath?: string) => {
  const base =
    typeof projectPath === 'string' && projectPath.trim()
      ? path.dirname(projectPath)
      : app.getPath('userData')
  const dir = path.join(base, 'media', 'grabaciones')
  await fs.mkdir(dir, { recursive: true })
  return dir
})

ipcMain.handle('file-read', async (_event: IpcMainInvokeEvent, ruta: string) => {
  const contenido = await fs.readFile(ruta, 'utf-8')
  return contenido
})

ipcMain.handle('file-list-dir', async (_event: IpcMainInvokeEvent, dir: string) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return {
      success: true,
      entries: entries.map((e: import('fs').Dirent) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      })),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'list failed',
      entries: [] as Array<{ name: string; isDirectory: boolean; isFile: boolean }>,
    }
  }
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

ipcMain.handle('dialog-save', async (_event: IpcMainInvokeEvent, defaultPath?: string) => {
  if (!mainWindow) return { canceled: true }
  const isPdf = typeof defaultPath === 'string' && /\.pdf$/i.test(defaultPath)
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: isPdf
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : [{ name: 'JasWave Project', extensions: ['jaswave'] }],
    ...(typeof defaultPath === 'string' && defaultPath ? { defaultPath } : {}),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
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

ipcMain.handle('dialog-open-directory', async () => {
  if (!mainWindow) return { canceled: true, filePaths: [] as string[] }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Carpeta de plugins VST3',
    properties: ['openDirectory'],
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
    properties: ['createDirectory', 'showOverwriteConfirmation'],
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

ipcMain.handle('plugin-lookup', async (_event: IpcMainInvokeEvent, pluginName: unknown) => {
  const name = String(pluginName ?? '').trim().slice(0, 120)
  if (name.length < 2) return []
  return lookupPluginOnWeb(name)
})

ipcMain.handle('web-search', async (_event: IpcMainInvokeEvent, query: unknown) => {
  const q = String(query ?? '').trim().slice(0, 200)
  if (q.length < 2) return []
  return searchWeb(q)
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

ipcMain.handle('tool-window-open', async (_event: IpcMainInvokeEvent, toolId: string, title: string, extra?: Record<string, string>) => {
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

  disablePageZoom(win)

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

  const params = new URLSearchParams({ undock: String(toolId || '') })
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, String(v))
    }
  }
  const query = `?${params.toString()}`
  const queryObj: Record<string, string> = { undock: String(toolId || '') }
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v) queryObj[k] = String(v)
    }
  }
  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(`${process.env.VITE_DEV_SERVER_URL}${query}`)
  } else {
    await win.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: queryObj,
    })
  }
  return { success: true }
})

ipcMain.handle('tool-window-close', async (_event: IpcMainInvokeEvent, toolId: string) => {
  const win = toolWindows.get(toolId)
  if (win && !win.isDestroyed()) win.close()
  toolWindows.delete(toolId)
})

// ── Native C++ audio bridge (ADR-0009) ──────────────────────────────────────
const { getNativeAudio, nativeAudioAvailable } = require('./native-audio')

ipcMain.handle('native-audio-available', () => nativeAudioAvailable())
ipcMain.handle('native-audio-initialize', (_e: IpcMainInvokeEvent, config: unknown) => {
  getNativeAudio()?.initialize(config)
})
ipcMain.handle('native-audio-shutdown', () => {
  getNativeAudio()?.shutdown()
})
ipcMain.handle(
  'native-audio-load-buffer',
  (_e: IpcMainInvokeEvent, id: string, samples: Float32Array, sampleRate: number, channels: number) => {
    getNativeAudio()?.loadBuffer(id, samples, sampleRate, channels)
  },
)
ipcMain.handle('native-audio-unload-buffer', (_e: IpcMainInvokeEvent, id: string) => {
  getNativeAudio()?.unloadBuffer(id)
})
ipcMain.handle('native-audio-set-graph', (_e: IpcMainInvokeEvent, graph: unknown) => {
  getNativeAudio()?.setGraph(graph)
})
ipcMain.handle('native-audio-play', () => {
  getNativeAudio()?.transportPlay()
})
ipcMain.handle('native-audio-pause', () => {
  getNativeAudio()?.transportPause()
})
ipcMain.handle('native-audio-stop', () => {
  getNativeAudio()?.transportStop()
})
ipcMain.handle('native-audio-seek', (_e: IpcMainInvokeEvent, seconds: number) => {
  getNativeAudio()?.transportSeek(seconds)
})
ipcMain.handle('native-audio-playhead', () => getNativeAudio()?.getPlayheadSeconds() ?? 0)
ipcMain.handle('native-audio-is-playing', () => getNativeAudio()?.isPlaying() ?? false)
ipcMain.handle('native-audio-meter', () => getNativeAudio()?.getMeterPeak() ?? 0)

// Plugin host híbrido (ADR-0011 C)
const {
  ensurePluginHostStarted,
  ensureMixPipeConnected,
  getPluginHostStatus,
  sendPluginHostCommand,
  sendPluginHostMidi,
  pushPluginHostPcm,
  stopPluginHost,
  isEditorHostCommand,
  setPluginHostAudioDevice,
  subscribeNativeMidi,
} = require('./plugin-host-bridge')

subscribeNativeMidi((msg: { id: string; data: number[] }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('native-midi', msg)
  }
})

ipcMain.handle('plugin-host-status', async (e: IpcMainInvokeEvent) => {
  if (!senderIsSatellite(e.sender)) {
    await ensurePluginHostStarted()
    // No ensureMixPipeConnected aquí: el UI pollea status y pelea con maxInstances=1.
  }
  return getPluginHostStatus()
})
ipcMain.handle('plugin-host-ensure', async (e: IpcMainInvokeEvent) => {
  if (senderIsSatellite(e.sender)) {
    return { ok: !!getPluginHostStatus().vst3HostProcessAvailable, ...getPluginHostStatus() }
  }
  const ok = await ensurePluginHostStarted()
  if (ok) await ensureMixPipeConnected()
  return { ok, ...getPluginHostStatus() }
})
ipcMain.on('plugin-host-midi', (e: IpcMainInvokeEvent, cmd: unknown) => {
  // Piano roll / teclado flotante (undock) también envían noteOn preview.
  const record = (cmd && typeof cmd === 'object' ? cmd : {}) as Record<string, unknown>
  sendPluginHostMidi(record)
})
ipcMain.handle('plugin-host-midi', async (e: IpcMainInvokeEvent, cmd: unknown) => {
  const record = (cmd && typeof cmd === 'object' ? cmd : {}) as Record<string, unknown>
  sendPluginHostMidi(record)
  return { ok: true }
})
ipcMain.handle('plugin-host-send', async (e: IpcMainInvokeEvent, cmd: unknown) => {
  const record = (cmd && typeof cmd === 'object' ? cmd : {}) as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''

  if (!isEditorHostCommand(type)) {
    await ensurePluginHostStarted()
  }

  if (type === 'openEditor' || type === 'setEditorBounds') {
    // openEditor: ventana top-level centrada (sin parent Electron → sin deadlock).
    if (type === 'openEditor') {
      delete record.parentHwnd
      if (record.x == null) record.x = 0
      if (record.y == null) record.y = 0
    } else {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (win && !win.isDestroyed()) {
        try {
          const buf = win.getNativeWindowHandle()
          const hwnd =
            buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0))
          if (!record.parentHwnd) record.parentHwnd = hwnd
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (type === 'setAudioDevice') {
    return setPluginHostAudioDevice({
      backend: String(record.backend || record.api || 'auto'),
      deviceId: String(record.deviceId || record.device || ''),
      sampleRate: Number(record.sampleRate) || 48000,
      bufferSize: Number(record.bufferSize) || 512,
      exclusive: !!record.exclusive || String(record.backend) === 'wasapi_exclusive',
    })
  }

  return sendPluginHostCommand(record)
})
ipcMain.on('plugin-host-pcm', (e: IpcMainInvokeEvent, data: unknown) => {
  // Legacy JWST pipe retirado — live/bounce usan clip_player nativo.
  void e
  void data
})
ipcMain.handle('plugin-host-stop', () => {
  stopPluginHost()
  return { ok: true }
})
