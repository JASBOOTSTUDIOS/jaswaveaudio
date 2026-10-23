const { app, BrowserWindow, ipcMain: rawIpcMain, dialog, Menu, session, clipboard, shell, safeStorage, crashReporter } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const fsSync = require('fs')
import type { IpcMainInvokeEvent } from 'electron'
import { aiChat, aiChatStream, aiHealth, cancelAiChat, legacyChatArgsToRequest, type AiChatRequest, type AiHealthRequest } from './ai-gateway'
import { createAgentRunStore } from './agent-runs'
import { lookupPluginOnWeb } from './plugin-lookup'
import { searchWeb } from './web-search'
import {
  resolveAgentBridgeReply,
  startAgentBridge,
  stopAgentBridge,
} from './agent-bridge'
import { shouldStartAgentBridge } from './agent-bridge-auth'
import { AiCredentialStore } from './ai-credentials'
import { initLogger, logLine } from './logger'
import { writeFileAtomic } from './atomic-write'
import { defaultVstRoots, isAudioFile, PathAccessError, PathGrants, type AccessKind, type GrantMode } from './path-grants'
import { buscarArchivosPorNombre, copiarMediaArchivo, moverMediaArchivo, traducirErrorDisco } from './media-service'
import { checkHostCommand, setAnalysisRoot } from './plugin-host-guard'
import { esRutaProyecto, rutaProyectoDeArgv } from './instancia-unica'
import { initAutoUpdater } from './updater'
import {
  createGuardedIpc,
  devServerUrl,
  installNavigationGuards,
  installPermissionHandlers,
  isSafeExternalUrl,
  loadRenderer,
} from './security'
import { escanearPaquetes } from './plugins/escaner'
import { crearVigilancia } from './plugins/vigilancia'
import { guardarLicenciaLocal, leerLicenciaLocal, leerTokenDispositivo } from './licencias-locales'
import * as os from 'node:os'

// ── Diagnóstico: log persistente y minidumps locales (sin envío a servidores) ──
const logsDir = () => path.join(app.getPath('userData'), 'logs')
try {
  crashReporter.start({ uploadToServer: false })
} catch {
  /* entorno sin crashpad */
}
process.on('uncaughtException', (err: Error) => logLine('error', 'main', 'uncaughtException', err))
process.on('unhandledRejection', (reason: unknown) => logLine('error', 'main', 'unhandledRejection', reason))
app.on('render-process-gone', (_e: unknown, _wc: unknown, details: { reason: string; exitCode: number }) =>
  logLine('error', 'renderer', 'render-process-gone', details),
)
app.on('child-process-gone', (_e: unknown, details: { type: string; reason: string; exitCode: number; name?: string }) =>
  logLine('error', 'child', 'child-process-gone', details),
)

/** Todo IPC valida que el remitente sea el renderer propio. */
const ipcMain = createGuardedIpc(rawIpcMain)
installNavigationGuards()

// ── Acceso a disco del renderer (ver path-grants.ts) ────────────────────────
const pathGrants = new PathGrants()
const grantsFile = () => path.join(app.getPath('userData'), 'path-grants.json')
const MAX_PERSISTED_GRANTS = 300

function readPersistedGrants(): Array<{ root: string; mode: GrantMode }> {
  try {
    const saved = JSON.parse(fsSync.readFileSync(grantsFile(), 'utf8'))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function initPathGrants() {
  pathGrants.grant(app.getPath('userData'), 'readwrite')
  // Renders de análisis (A7b): escritura libre solo bajo userData/analysis/.
  setAnalysisRoot(path.join(app.getPath('userData'), 'analysis'))
  for (const root of defaultVstRoots(process.env)) pathGrants.grant(root, 'read')
  if (process.resourcesPath) pathGrants.grant(process.resourcesPath, 'read')
  for (const g of readPersistedGrants()) pathGrants.grant(g.root, g.mode)
}

/** Concede (y recuerda entre sesiones) una carpeta elegida por el usuario en un diálogo. */
function grantUserPath(dir: string, mode: GrantMode) {
  if (!pathGrants.grant(dir, mode)) return
  const key = dir.toLowerCase()
  const merged = [...readPersistedGrants().filter((g) => String(g.root).toLowerCase() !== key), { root: dir, mode }]
  writeFileAtomic(grantsFile(), JSON.stringify(merged.slice(-MAX_PERSISTED_GRANTS))).catch(() => undefined)
}

function assertPath(p: unknown, kind: AccessKind): string {
  if (!pathGrants.isAllowed(p, kind)) throw new PathAccessError(p, kind)
  return p as string
}

function assertBinaryRead(p: unknown): string {
  if (!pathGrants.isBinaryReadAllowed(p)) throw new PathAccessError(p, 'read')
  return p as string
}

function isProjectFile(p: string): boolean {
  return esRutaProyecto(p)
}

// ── API keys de IA (cifradas; el renderer no puede leerlas) ─────────────────
let aiCredentials: InstanceType<typeof AiCredentialStore> | null = null
function credentials(): InstanceType<typeof AiCredentialStore> {
  aiCredentials ??= new AiCredentialStore(path.join(app.getPath('userData'), 'ai-credentials.json'), safeStorage)
  return aiCredentials
}

/** Completa apiKey desde el almacén cifrado cuando el renderer manda solo providerId. */
function withStoredApiKey<T extends { apiKey?: string; providerId?: string }>(req: T): T {
  if (req.apiKey?.trim() || !req.providerId) return req
  const apiKey = credentials().get(req.providerId)
  return apiKey ? { ...req, apiKey } : req
}

// ── Ajustes del proceso main (userData/jaswave-settings.json) ───────────────
type MainSettings = { agentBridgeEnabled?: boolean }
const settingsFile = () => path.join(app.getPath('userData'), 'jaswave-settings.json')
function readMainSettings(): MainSettings {
  try {
    return JSON.parse(fsSync.readFileSync(settingsFile(), 'utf8')) as MainSettings
  } catch {
    return {}
  }
}
async function writeMainSettings(patch: MainSettings): Promise<MainSettings> {
  const next = { ...readMainSettings(), ...patch }
  await writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2))
  return next
}

/** Puente HTTP para la CLI: en dev siempre; empaquetado solo con opt-in. */
function startAgentBridgeIfAllowed(): boolean {
  if (
    !shouldStartAgentBridge({
      isPackaged: app.isPackaged,
      env: process.env,
      settingEnabled: !!readMainSettings().agentBridgeEnabled,
    })
  ) {
    return false
  }
  startAgentBridge({
    getMainWindow: () => mainWindow as import('electron').BrowserWindow | null,
    tokenFilePath: path.join(app.getPath('userData'), 'agent-bridge.json'),
    // La CLI autenticada actúa como el usuario: sus rutas explícitas se conceden solo en esta sesión.
    onTrustedPaths: (paths) => {
      for (const p of paths) pathGrants.grant(path.extname(p) ? path.dirname(p) : p, 'readwrite')
    },
  })
  return true
}

let mainWindow: typeof BrowserWindow | null = null

// Evitar que Chromium frise timers/RAF en la ventana principal cuando el foco
// está en un panel undock (playhead sync / metrónomo UI).
try {
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
} catch {
  /* ignore */
}

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
      sandbox: true,
      webSecurity: true,
      // Playhead sync a undock: no throttlear timers/RAF en background.
      backgroundThrottling: false,
    },
  })

  const emitMaximized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-changed', mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', emitMaximized)
  mainWindow.on('unmaximize', emitMaximized)

  disablePageZoom(mainWindow)
  try {
    mainWindow.webContents.setBackgroundThrottling(false)
  } catch {
    /* ignore */
  }

  void loadRenderer(mainWindow)
  if (devServerUrl()) mainWindow.webContents.openDevTools()

  closeGuard.reset()
  mainWindow.on('close', (e: { preventDefault: () => void }) => {
    if (!mainWindow || closeGuard.allowed) return
    const wc = mainWindow.webContents
    // Renderer caído o destruido: no hay a quién preguntar.
    if (wc.isDestroyed() || wc.isCrashed()) {
      closeGuard.allowed = true
      return
    }
    e.preventDefault()
    closeGuard.request()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    closeGuard.reset()
    rendererListo = false
    // Los paneles desacoplados no sobreviven a la ventana principal.
    for (const win of toolWindows.values()) {
      if (!win.isDestroyed()) win.destroy()
    }
    toolWindows.clear()
  })

  mainWindow.webContents.once('did-finish-load', () => {
    rendererListo = true
    const pendiente = proyectoPendiente
    if (!pendiente) return
    proyectoPendiente = null
    mainWindow?.webContents.send('open-project-requested', pendiente)
  })
}

// ── Instancia única y apertura de proyectos (U7) ────────────────────────────
// Solo puede haber una instancia de JasWave en marcha: dos instancias pelean por
// el ASIO exclusivo, comparten la sesión (IndexedDB) y pueden guardar el mismo
// `.jaswave` (último gana). La segunda instancia cede el foco y pide a la
// principal que abra el proyecto recibido en los argumentos.

/** Proyecto que aún no se ha podido entregar al renderer. */
let proyectoPendiente: string | null = null
/** El renderer de la ventana principal ya cargó (puede recibir mensajes). */
let rendererListo = false

/** Extrae la primera ruta `.jaswave` válida de los argumentos de la app. */
function rutaProyectoDeArgvLocal(argv: string[]): string | null {
  return rutaProyectoDeArgv(argv, (ruta) => {
    try {
      return fsSync.statSync(ruta).isFile()
    } catch {
      return false
    }
  })
}

/** Enfoca la ventana principal (la segunda instancia cede el foco). */
function enfocarVentanaPrincipal() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Pide al renderer que abra el proyecto (respeta la guarda de cambios sin guardar de U1). */
function abrirProyectoEnVentana(ruta: string) {
  const abs = path.resolve(ruta)
  if (!isProjectFile(abs)) return
  // El renderer necesita leer el archivo: se concede la carpeta.
  grantUserPath(path.dirname(abs), 'readwrite')
  if (mainWindow && !mainWindow.isDestroyed() && rendererListo) {
    enfocarVentanaPrincipal()
    mainWindow.webContents.send('open-project-requested', abs)
    return
  }
  // Todavía no hay renderer listo: se entrega en cuanto cargue.
  proyectoPendiente = abs
}

const instanciaUnica = app.requestSingleInstanceLock()
if (!instanciaUnica) {
  // Ya hay una JasWave en marcha: esta instancia se cierra (no crea ventana).
  app.quit()
} else {
  app.on('second-instance', (_event: unknown, argv: string[]) => {
    logLine('info', 'main', 'Segunda instancia detectada: se cede el foco a la principal')
    enfocarVentanaPrincipal()
    const ruta = rutaProyectoDeArgvLocal(argv)
    if (ruta) abrirProyectoEnVentana(ruta)
  })
  // macOS: doble clic sobre un `.jaswave` (en Windows llega por argv).
  app.on('open-file', (event: { preventDefault: () => void }, ruta: string) => {
    event.preventDefault()
    abrirProyectoEnVentana(ruta)
  })
}

// ── Cierre con cambios sin guardar (U1) ─────────────────────────────────────
// main nunca cierra la ventana principal sin preguntar al renderer: este decide si hay
// cambios sin guardar y responde app-close-confirmed / app-close-canceled. Si el renderer
// no acusa recibo (colgado, sin listener) en CLOSE_ACK_TIMEOUT_MS, main cierra igualmente.
const CLOSE_ACK_TIMEOUT_MS = 5000
const closeGuard = {
  allowed: false,
  ackTimer: null as ReturnType<typeof setTimeout> | null,
  clearTimer() {
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.ackTimer = null
  },
  reset() {
    this.allowed = false
    this.clearTimer()
  },
  request() {
    if (!mainWindow || mainWindow.isDestroyed()) return
    this.clearTimer()
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null
      logLine('warn', 'main', `El renderer no respondió al cierre en ${CLOSE_ACK_TIMEOUT_MS} ms; se cierra sin confirmar`)
      this.forceClose()
    }, CLOSE_ACK_TIMEOUT_MS)
    mainWindow.webContents.send('app-close-requested')
  },
  forceClose() {
    this.clearTimer()
    this.allowed = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  },
}

/** Solo la ventana principal puede confirmar o cancelar su propio cierre. */
function isMainWindowSender(e: IpcMainInvokeEvent): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents
}

app.whenReady().then(() => {
  if (!instanciaUnica) return
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.jaswave.app')
  }
  initLogger(logsDir())
  logLine('info', 'main', `JasWave ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform}`)
  installPermissionHandlers(session.defaultSession)
  initPathGrants()
  buildAppMenu()
  createWindow()
  // Proyecto recibido en los argumentos al arrancar (asociación de archivos).
  const rutaInicial = rutaProyectoDeArgvLocal(process.argv)
  if (rutaInicial) abrirProyectoEnVentana(rutaInicial)
  initAutoUpdater({
    ipc: ipcMain,
    getWindow: () => mainWindow as unknown as import('electron').BrowserWindow | null,
  })
  startAgentBridgeIfAllowed()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (e: { preventDefault: () => void }) => {
  // Salir (menú/Alt+F4 vía app.quit): pasar antes por la confirmación de la ventana.
  // Al confirmarse, la ventana se cierra y window-all-closed vuelve a llamar a app.quit().
  if (mainWindow && !mainWindow.isDestroyed() && !closeGuard.allowed) {
    e.preventDefault()
    mainWindow.close()
    return
  }
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
/** Rutas para localizar plugins propios: instalación de usuario o los incluidos en resources/. */
ipcMain.handle('known-paths', () => {
  const resourcesPath = app.isPackaged ? process.resourcesPath || '' : ''
  return {
    resourcesPath,
    localAppData: process.env.LOCALAPPDATA || '',
    // Solo en la app empaquetada (extraResources vst3/JasWave); en dev queda vacío.
    bundledVst3Dir: resourcesPath ? path.join(resourcesPath, 'vst3', 'JasWave') : '',
  }
})

/**
 * Raíces de paquetes de plugins JasWave (P1): la instalación de usuario (D1) y, en desarrollo,
 * la carpeta plugins/ del repositorio. JASWAVE_PLUGINS_DIR añade una raíz (pruebas/CI).
 */
function raicesPlugins(): string[] {
  const raices = [path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'JasWave', 'plugins')]
  // __dirname = jas-wave/build/electron/electron → la raíz del repo está 4 niveles arriba.
  if (!app.isPackaged) raices.push(path.resolve(__dirname, '..', '..', '..', '..', 'plugins'))
  if (process.env.JASWAVE_PLUGINS_DIR) raices.push(path.resolve(process.env.JASWAVE_PLUGINS_DIR))
  return raices
}
/** Carpetas VST3 donde buscar los binarios de los plugins JasWave (y, en desarrollo, su build). */
function carpetasVst3Plugins(): string[] {
  const local = process.env.LOCALAPPDATA || ''
  const carpetas = local ? [path.join(local, 'Programs', 'Common', 'VST3', 'JasWave'), path.join(local, 'Programs', 'Common', 'VST3')] : []
  if (process.env.CommonProgramFiles) carpetas.push(path.join(process.env.CommonProgramFiles, 'VST3', 'JasWave'))
  if (!app.isPackaged) {
    // En desarrollo, los VST recién compilados del repositorio tienen prioridad sobre instalaciones previas.
    const build = path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'build', 'VST3', 'Release')
    carpetas.unshift(build)
    // Solo en desarrollo: el host puede cargar los VST recién compilados del repositorio.
    pathGrants.grant(build, 'read')
  }
  return carpetas
}
ipcMain.handle('plugins-listar', () => escanearPaquetes(raicesPlugins(), carpetasVst3Plugins()))

// Licencia local compartida con los VST JasWave (L3; contrato plugins/CONTRATO-V5.md §4).
ipcMain.handle('licencia-guardar', async (_e: IpcMainInvokeEvent, datos: unknown) => {
  const d = (datos ?? {}) as { token?: unknown; tokenDispositivo?: unknown }
  if (typeof d.token !== 'string' || typeof d.tokenDispositivo !== 'string') throw new Error('datos de licencia inválidos')
  await guardarLicenciaLocal({ token: d.token, tokenDispositivo: d.tokenDispositivo })
  return true
})
ipcMain.handle('licencia-leer', () => leerLicenciaLocal())
ipcMain.handle('licencia-token-dispositivo', () => leerTokenDispositivo())
ipcMain.handle('equipo-nombre', () => os.hostname().slice(0, 120))

// Errores del renderer (window.onerror, rechazos, error boundaries) → log persistente.
let rendererLogBudget = { windowStart: 0, count: 0 }
ipcMain.on('log-error', (_e: IpcMainInvokeEvent, scope: unknown, message: unknown, stack: unknown) => {
  const now = Date.now()
  if (now - rendererLogBudget.windowStart > 60_000) rendererLogBudget = { windowStart: now, count: 0 }
  if (++rendererLogBudget.count > 100) return
  logLine('error', `renderer:${String(scope ?? '').slice(0, 40)}`, String(message ?? '').slice(0, 4000), String(stack ?? '').slice(0, 8000))
})
ipcMain.handle('open-logs-folder', async () => {
  await shell.openPath(logsDir())
  return logsDir()
})

ipcMain.handle('agent-bridge-get-enabled', () => !!readMainSettings().agentBridgeEnabled)
ipcMain.handle('agent-bridge-set-enabled', async (_e: IpcMainInvokeEvent, enabled: unknown) => {
  await writeMainSettings({ agentBridgeEnabled: enabled === true })
  stopAgentBridge()
  return { enabled: enabled === true, running: startAgentBridgeIfAllowed() }
})

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
  // Pasa por el guard de 'close' (confirmación de cambios sin guardar).
  if (mainWindow) mainWindow.close()
})

ipcMain.on('app-close-ack', (e: IpcMainInvokeEvent) => {
  if (isMainWindowSender(e)) closeGuard.clearTimer()
})
ipcMain.handle('app-close-confirmed', (e: IpcMainInvokeEvent) => {
  if (!isMainWindowSender(e)) return false
  closeGuard.forceClose()
  return true
})
ipcMain.handle('app-close-canceled', (e: IpcMainInvokeEvent) => {
  if (!isMainWindowSender(e)) return false
  closeGuard.clearTimer()
  return true
})

ipcMain.handle('window-is-maximized', () => {
  if (mainWindow) return mainWindow.isMaximized()
  return false
})

ipcMain.handle('file-save', async (_event: IpcMainInvokeEvent, ruta: string, contenido: string) => {
  try {
    assertPath(ruta, 'write')
    await writeFileAtomic(ruta, String(contenido ?? ''), { backup: isProjectFile(ruta) })
    return { success: true }
  } catch (err) {
    return { success: false, error: traducirErrorDisco(err) }
  }
})

ipcMain.handle('file-save-binary', async (_event: IpcMainInvokeEvent, ruta: string, data: Uint8Array | ArrayBuffer) => {
  try {
    assertPath(ruta, 'write')
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
    await writeFileAtomic(ruta, buf)
    return { success: true }
  } catch (err) {
    return { success: false, error: traducirErrorDisco(err) }
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

/** Solo opciones de codificación conocidas; el renderer no puede inyectar flags de ffmpeg. */
const FFMPEG_ARG_RULES: Record<string, RegExp> = {
  '-b:a': /^\d{2,3}k$/,
  '-c:a': /^(flac|libmp3lame|pcm_s16le|pcm_s24le|pcm_f32le)$/,
  '-compression_level': /^\d{1,2}$/,
  '-ar': /^\d{4,6}$/,
  '-ac': /^[12]$/,
}
const FFMPEG_OUTPUT_EXT = /\.(flac|mp3|wav)$/i
const FFMPEG_TIMEOUT_MS = 5 * 60_000

function sanitizeFfmpegArgs(extraArgs: unknown): string[] {
  const args = Array.isArray(extraArgs) ? extraArgs.map(String) : []
  if (args.length % 2 !== 0) throw new Error('ffmpeg: argumentos incompletos')
  for (let i = 0; i < args.length; i += 2) {
    const rule = FFMPEG_ARG_RULES[args[i]!]
    if (!rule || !rule.test(args[i + 1]!)) throw new Error(`ffmpeg: opción no permitida ${args[i]}`)
  }
  return args
}

ipcMain.handle(
  'ffmpeg-convert',
  async (
    _event: IpcMainInvokeEvent,
    input: string,
    output: string,
    extraArgs: string[] = [],
  ) => {
    try {
      assertBinaryRead(input)
      assertPath(output, 'write')
      if (!isAudioFile(input) || !FFMPEG_OUTPUT_EXT.test(output)) throw new Error('ffmpeg: solo conversión de audio')
      const safeArgs = sanitizeFfmpegArgs(extraArgs)
      const { spawn } = await import('node:child_process')
      await fs.mkdir(path.dirname(output), { recursive: true })
      const args = ['-hide_banner', '-nostdin', '-y', '-i', input, ...safeArgs, output]
      await new Promise<void>((resolve, reject) => {
        const child = spawn('ffmpeg', args, { windowsHide: true })
        const timer = setTimeout(() => {
          child.kill()
          reject(new Error('ffmpeg: tiempo agotado'))
        }, FFMPEG_TIMEOUT_MS)
        let err = ''
        child.stderr?.on('data', (d: Buffer) => {
          err = (err + d.toString()).slice(-4000)
        })
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
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
  return fs.readFile(assertBinaryRead(ruta))
})

ipcMain.handle('recordings-dir', async (_event: IpcMainInvokeEvent, projectPath?: string) => {
  const projectDir =
    typeof projectPath === 'string' && projectPath.trim() ? path.dirname(projectPath) : null
  const base = projectDir && pathGrants.isAllowed(projectDir, 'write') ? projectDir : app.getPath('userData')
  const dir = path.join(base, 'media', 'grabaciones')
  await fs.mkdir(dir, { recursive: true })
  return dir
})

/** Copia un archivo de audio al media del proyecto (o a media/pending/). */
ipcMain.handle(
  'media-copy',
  async (
    _event: IpcMainInvokeEvent,
    opts: { src?: string; destDir?: string; nombre?: string; mover?: boolean },
  ) => {
    try {
      const src = assertBinaryRead(opts?.src)
      const destDir = assertPath(opts?.destDir, 'write')
      if (opts?.mover) return await moverMediaArchivo({ src, destDir, nombre: opts?.nombre })
      return await copiarMediaArchivo({ src, destDir, nombre: opts?.nombre })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
)

/** Busca archivos por nombre en una carpeta (reenlace de media faltante). */
ipcMain.handle(
  'media-buscar',
  async (_event: IpcMainInvokeEvent, opts: { carpeta?: string; nombres?: string[] }) => {
    try {
      const carpeta = assertPath(opts?.carpeta, 'read')
      const nombres = Array.isArray(opts?.nombres)
        ? opts.nombres.filter((n): n is string => typeof n === 'string').slice(0, 200)
        : []
      return { ok: true, encontrados: await buscarArchivosPorNombre(carpeta, nombres) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), encontrados: {} }
    }
  },
)

ipcMain.handle('file-read', async (_event: IpcMainInvokeEvent, ruta: string) => {
  return fs.readFile(assertPath(ruta, 'read'), 'utf-8')
})

ipcMain.handle('file-list-dir', async (_event: IpcMainInvokeEvent, dir: string) => {
  try {
    const entries = await fs.readdir(assertPath(dir, 'read'), { withFileTypes: true })
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
  if (!pathGrants.isBinaryReadAllowed(ruta)) return false
  try {
    await fs.access(ruta)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('file-size', async (_event: IpcMainInvokeEvent, ruta: string) => {
  const stat = await fs.stat(assertBinaryRead(ruta))
  return stat.size
})

/** Firma del archivo (mtime + tamaño) para detectar cambios externos (U7). */
ipcMain.handle('file-stat', async (_event: IpcMainInvokeEvent, ruta: string) => {
  if (!pathGrants.isBinaryReadAllowed(ruta)) return null
  try {
    const stat = await fs.stat(ruta)
    if (!stat.isFile()) return null
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
})

const SAVE_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  wav: { name: 'WAV', extensions: ['wav'] },
  flac: { name: 'FLAC', extensions: ['flac'] },
  mp3: { name: 'MP3', extensions: ['mp3'] },
  mid: { name: 'MIDI', extensions: ['mid'] },
  jaswave: { name: 'JasWave Project', extensions: ['jaswave'] },
}

ipcMain.handle('dialog-save', async (_event: IpcMainInvokeEvent, defaultPath?: string) => {
  if (!mainWindow) return { canceled: true }
  const ext = typeof defaultPath === 'string' ? path.extname(defaultPath).slice(1).toLowerCase() : ''
  const filter = SAVE_FILTERS[ext] ?? SAVE_FILTERS.jaswave!
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [filter],
    ...(typeof defaultPath === 'string' && defaultPath ? { defaultPath } : {}),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (!result.canceled && result.filePath) grantUserPath(path.dirname(result.filePath), 'readwrite')
  return result
})

ipcMain.handle('dialog-open-directory', async () => {
  if (!mainWindow) return { canceled: true, filePaths: [] as string[] }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar carpeta',
    properties: ['openDirectory'],
  })
  if (!result.canceled && result.filePaths[0]) grantUserPath(result.filePaths[0], 'readwrite')
  return result
})

    ipcMain.handle('project-open-dialog', async () => {
      if (!mainWindow) return { success: false, canceled: true }
      const result = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
      grantUserPath(path.dirname(result.filePaths[0]), 'readwrite')
      // Solo devolvemos la ruta; project.load + FileService leen el archivo
      return { success: true, path: result.filePaths[0] }
    })

    // Proyecto que llegó antes de que el renderer estuviera listo (U7).
    ipcMain.handle('project-take-pending', () => {
      const pendiente = proyectoPendiente
      proyectoPendiente = null
      return pendiente
    })


ipcMain.handle('ai-chat', async (_event: IpcMainInvokeEvent, payload: unknown, model?: string, baseUrl?: string, temperature?: number) => {
  // Nuevo: objeto AiChatRequest. Legacy: (messages[], model, baseUrl, temperature)
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'messages' in (payload as object) && 'kind' in (payload as object)) {
    return aiChat(withStoredApiKey(payload as AiChatRequest))
  }
  return aiChat(legacyChatArgsToRequest((payload as unknown[]) ?? [], model, baseUrl, temperature))
})

ipcMain.handle('ai-health', async (_event: IpcMainInvokeEvent, payload?: unknown) => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'kind' in (payload as object)) {
    return aiHealth(withStoredApiKey(payload as AiHealthRequest))
  }
  // Legacy: solo baseUrl string
  const baseUrl = typeof payload === 'string' ? payload : undefined
  return aiHealth({
    kind: 'ollama',
    baseUrl: baseUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  })
})

/** Chat con streaming: deltas por 'ai-chat-stream-event' al mismo renderer; resuelve con el resultado final. */
ipcMain.handle('ai-chat-stream', async (event: IpcMainInvokeEvent, payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('messages' in payload) || !('kind' in payload)) {
    return { success: false, error: 'Petición de streaming inválida', errorCode: 'bad_request' }
  }
  const req = withStoredApiKey(payload as AiChatRequest)
  const requestId = typeof req.requestId === 'string' ? req.requestId : ''
  const sender = event.sender
  const send = (msg: Record<string, unknown>) => {
    if (!sender.isDestroyed()) sender.send('ai-chat-stream-event', { requestId, ...msg })
  }
  const result = await aiChatStream(req, (text) => send({ type: 'delta', text }))
  send({ type: 'done', success: result.success })
  return result
})

// ── Runs del motor de agente (userData/agent-runs/<id>.json) ────────────────
const agentRuns = createAgentRunStore({
  dir: () => path.join(app.getPath('userData'), 'agent-runs'),
  assertWrite: (p) => assertPath(p, 'write'),
  assertRead: (p) => assertPath(p, 'read'),
})
ipcMain.handle('agent-run-save', (_event: IpcMainInvokeEvent, runId: unknown, json: unknown) => agentRuns.save(runId, json))
ipcMain.handle('agent-run-load', (_event: IpcMainInvokeEvent, runId: unknown) => agentRuns.load(runId))
ipcMain.handle('agent-run-list', (_event: IpcMainInvokeEvent, limit: unknown) => agentRuns.list(limit))
ipcMain.handle('agent-run-delete', (_event: IpcMainInvokeEvent, runId: unknown) => agentRuns.remove(runId))

ipcMain.handle('ai-chat-cancel', (_event: IpcMainInvokeEvent, requestId: unknown) =>
  typeof requestId === 'string' ? cancelAiChat(requestId) : false,
)
ipcMain.handle('ai-cred-set', (_event: IpcMainInvokeEvent, providerId: unknown, apiKey: unknown) =>
  credentials().set(providerId, apiKey),
)
ipcMain.handle('ai-cred-status', (_event: IpcMainInvokeEvent, providerIds: unknown) => {
  const ids = Array.isArray(providerIds) ? providerIds.slice(0, 200) : []
  return Object.fromEntries(ids.map((id) => [String(id), credentials().has(id)]))
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
  const safeType = ['none', 'info', 'error', 'question', 'warning'].includes(type) ? type : 'info'
  const result = await dialog.showMessageBox(mainWindow, {
    type: safeType as 'none' | 'info' | 'error' | 'question' | 'warning',
    title: String(title ?? '').slice(0, 200),
    message: String(message ?? '').slice(0, 4000),
    buttons: ['OK'],
  })
  return result.response
})

ipcMain.handle('shell-open-external', async (_event: IpcMainInvokeEvent, url: string) => {
  if (!isSafeExternalUrl(url)) return false
  await shell.openExternal(url)
  return true
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
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  disablePageZoom(win)
  try {
    win.webContents.setBackgroundThrottling(false)
  } catch {
    /* ignore */
  }

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

  const queryObj: Record<string, string> = { undock: String(toolId || '') }
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v) queryObj[k] = String(v)
    }
  }
  await loadRenderer(win, queryObj)
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
  stopPluginHost,
  isEditorHostCommand,
  setPluginHostAudioDevice,
  subscribeNativeMidi,
  resetPluginHost,
  ponerPluginEnCuarentena,
  suscribirLimpiezaCuarentena,
} = require('./plugin-host-bridge')

// Watchdog de plugins vivos (V5 §2.4): saturación sostenida o fallos recurrentes → bypass + cuarentena.
const vigilanciaPlugins = crearVigilancia({
  enviar: (cmd) => sendPluginHostCommand(cmd, 5_000) as Promise<{ ok?: boolean; slots?: unknown }>,
  activo: () => getPluginHostStatus().backend === 'native' && getPluginHostStatus().vst3HostProcessAvailable,
  apartar: (ruta) => ponerPluginEnCuarentena(ruta),
  notificar: (decision, mensaje) => {
    logLine('warn', 'plugin-watchdog', mensaje)
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('plugin-cuarentena', { ruta: decision.plugin, motivo: decision.motivo, mensaje })
    }
  },
})
suscribirLimpiezaCuarentena(() => vigilanciaPlugins.rehabilitar())
app.on('will-quit', () => vigilanciaPlugins.detener())
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
// U7: "Reiniciar motor" tras un bucle de fallos: limpia el contador y reinicia.
ipcMain.handle('plugin-host-reset', async (e: IpcMainInvokeEvent) => {
  if (senderIsSatellite(e.sender)) {
    return { ok: false, message: 'Solo la ventana principal puede reiniciar el motor de audio' }
  }
  return resetPluginHost()
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

  const allowed = checkHostCommand(record, pathGrants)
  if (!allowed.ok) return { ok: false, error: allowed.error }

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
