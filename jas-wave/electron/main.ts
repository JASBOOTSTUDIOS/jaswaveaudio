const { app, BrowserWindow, ipcMain: rawIpcMain, dialog, Menu, session, clipboard, shell, safeStorage, crashReporter, protocol } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const fsSync = require('fs')
import type { IpcMainInvokeEvent } from 'electron'
import { aiChat, aiChatStream, aiHealth, cancelAiChat, legacyChatArgsToRequest, type AiChatRequest, type AiHealthRequest } from './ai-gateway'
import { mockScriptPathFromEnv } from './ai-mock'
import { createAgentRunStore } from './agent-runs'
import { lookupPluginOnWeb } from './plugin-lookup'
import { ServicioGrooves, carpetaDeGrooves } from './grooves-service'
import { enviarPropuesta, sincronizarGrooves, type EventoSync } from './grooves-sync'
import { searchWeb } from './web-search'
import {
  extraerReferenciaAudio,
  extraerVideoId,
  GestorTemporalesReferencia,
  instalarYtDlp,
  LimitadorPeticiones,
  resolverYtDlp,
  urlEmbedYoutube,
  webBuscar,
  webLeer,
  youtubeBuscar,
  youtubeFicha,
  youtubeMiniatura,
} from './web-tools'
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
import { checkHostCommand, expandirVariablesDeEntorno, setAnalysisRoot } from './plugin-host-guard'
import { esRutaProyecto, rutaExtensionDeArgv, rutaProyectoDeArgv, tokenHandoverDeArgv } from './instancia-unica'
import { initAutoUpdater } from './updater'
import {
  createGuardedIpc,
  devServerUrl,
  installNavigationGuards,
  installPermissionHandlers,
  isSafeExternalUrl,
  loadAdmin,
  loadRenderer,
} from './security'
import { escanearPaquetes } from './plugins/escaner'
import { crearVigilancia } from './plugins/vigilancia'
import { desinstalarPaquete, inspeccionarArchivo, instalarArchivo, instalarPaquete, obtenerCatalogo, validarListado } from './plugins/instalador'
import { escribirZip, type EntradaZip } from './zip-writer'
import { AsistenteConfig } from './asistente-config'
import { instalarProduccionMain } from './produccion-main'
import { CLAVE_PUBLICA_JASWAVE } from './plugins/clave-catalogo'
import {
  argsCodificacion,
  esFormatoCodificado,
  extensionCoincide,
  ID_PAQUETE_FFMPEG,
  instalarFfmpeg,
  resolverFfmpeg,
} from './audio-encoder'
import { crearManejadorModulos, ESQUEMA_MODULOS } from './plugins/protocolo-modulos'
import { EditoresEmbebidos, panelDesdeComando, type VentanaEditor } from './plugins/editor-embebido'
import { GestorPins } from './pins'
import { guardarLicenciaLocal, leerLicenciaLocal, leerTokenDispositivo } from './licencias-locales'
import { SesionDictadoWindows } from './dictado-windows'
import {
  conectarEstadoVentana,
  medidasQueCaben,
  normalizarOverlay,
  opcionesVentanaSinMarco,
  vigilarBarraVisible,
} from './window-chrome'
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
  // La carpeta de proyectos que propone «Nuevo proyecto» (Documentos\JasWave): sin esto, guardar ahí se rechazaba.
  const proyectos = carpetaDeProyectos()
  if (proyectos) pathGrants.grant(proyectos, 'readwrite')
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
type MainSettings = {
  agentBridgeEnabled?: boolean
  /** X1: permite instalar extensiones .jwx sin firma (con aviso). */
  modoDesarrollador?: boolean
  /** K6: «Permitir a la IA usar internet» (búsqueda, lectura, YouTube, referencias). Por defecto activada. */
  permitirInternetIA?: boolean
}
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
        { label: 'Nueva carpeta (bus)', click: () => sendMenuAction('pista.nuevaCarpeta') },
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
  const { screen } = require('electron')
  // Nunca más grande que el área de trabajo: con escala alta la barra de título (sin marco) quedaba fuera.
  const medidas = medidasQueCaben(screen.getPrimaryDisplay().workArea, { width: 1400, height: 900, minWidth: 1000, minHeight: 600 })
  mainWindow = new BrowserWindow({
    ...medidas,
    // Sin marco, pero con minimizar / maximizar-restaurar / cerrar nativos siempre visibles (window-chrome.ts)
    ...opcionesVentanaSinMarco(),
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

  conectarEstadoVentana(mainWindow)
  vigilarBarraVisible(mainWindow, screen)
  produccionMain.enlazarVentana(mainWindow)

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
    if (handoverPendiente) {
      const token = handoverPendiente
      handoverPendiente = null
      mainWindow?.webContents.send('handover-recibido', token)
    }
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
/** X1: extensión .jwx abierta con doble clic, pendiente de que el usuario confirme su instalación. */
let extensionPendiente: string | null = null

/** Pide al renderer que muestre la confirmación de instalación del .jwx (nunca instala sin el usuario). */
function entregarExtension(ruta: string) {
  const abs = path.resolve(ruta)
  logLine('info', 'plugins', `extensión recibida para instalar: ${path.basename(abs)}`)
  if (mainWindow && !mainWindow.isDestroyed() && rendererListo) {
    enfocarVentanaPrincipal()
    mainWindow.webContents.send('extension-abrir-solicitada', abs)
    return
  }
  extensionPendiente = abs
}
/** Token de handover web → escritorio (H1) pendiente de entregar al renderer. */
let handoverPendiente: string | null = null

/** Entrega el enlace jaswave://abrir al renderer (o lo guarda hasta que esté listo). */
function entregarHandover(token: string) {
  logLine('info', 'main', 'Enlace de handover recibido desde la web')
  if (mainWindow && !mainWindow.isDestroyed() && rendererListo) {
    enfocarVentanaPrincipal()
    mainWindow.webContents.send('handover-recibido', token)
    return
  }
  handoverPendiente = token
}
/** El renderer de la ventana principal ya cargó (puede recibir mensajes). */
let rendererListo = false

/** Primera extensión `.jwx` existente en los argumentos (doble clic sobre el archivo). */
function rutaExtensionDeArgvLocal(argv: string[]): string | null {
  return rutaExtensionDeArgv(argv, (ruta) => {
    try {
      return fsSync.statSync(ruta).isFile()
    } catch {
      return false
    }
  })
}

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
    const token = tokenHandoverDeArgv(argv)
    if (token) entregarHandover(token)
    const extension = rutaExtensionDeArgvLocal(argv)
    if (extension) entregarExtension(extension)
  })
  // macOS: doble clic sobre un `.jaswave` o un `.jwx` (en Windows llega por argv).
  app.on('open-file', (event: { preventDefault: () => void }, ruta: string) => {
    event.preventDefault()
    if (/\.jwx$/i.test(ruta)) entregarExtension(ruta)
    else abrirProyectoEnVentana(ruta)
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

// M3: código de los módulos instalados (jaswave-modulo://<id>/dist/…), servido solo si su hash coincide
// con la instalación. Debe registrarse como esquema estándar y seguro antes de que la app esté lista.
protocol.registerSchemesAsPrivileged([
  { scheme: ESQUEMA_MODULOS, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

app.whenReady().then(() => {
  if (!instanciaUnica) return
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.jaswave.app')
  }
  initLogger(logsDir())
  logLine('info', 'main', `JasWave ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform}`)
  installPermissionHandlers(session.defaultSession)
  session.defaultSession.protocol.handle(
    ESQUEMA_MODULOS,
    crearManejadorModulos({
      raices: raicesPlugins,
      // Solo en desarrollo: los módulos compilados en plugins/ del repositorio no tienen registro de instalación.
      admitirSinRegistro: (dir) => !app.isPackaged && path.resolve(dir).startsWith(path.resolve(__dirname, '..', '..', '..', '..', 'plugins') + path.sep),
    }),
  )
  initPathGrants()
  iniciarGrooves()
  buildAppMenu()
  createWindow()
  // Proyecto recibido en los argumentos al arrancar (asociación de archivos).
  const rutaInicial = rutaProyectoDeArgvLocal(process.argv)
  if (rutaInicial) abrirProyectoEnVentana(rutaInicial)
  // H1: jaswave://abrir?token=… (el instalador registra el esquema; aquí se reafirma solo empaquetada
  // para no apuntar el registro de Windows a un build de desarrollo).
  if (app.isPackaged) app.setAsDefaultProtocolClient('jaswave')
  const tokenInicial = tokenHandoverDeArgv(process.argv)
  if (tokenInicial) entregarHandover(tokenInicial)
  const extensionInicial = rutaExtensionDeArgvLocal(process.argv)
  if (extensionInicial) entregarExtension(extensionInicial)
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
  // Cierre de verdad: lo que la banda tenía abierto queda marcado como interrumpido (síncrono) para poder reanudarlo.
  produccionMain.cierreDeEmergencia('cierre de la aplicación')
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

// ── Biblioteca de grooves MIDI por estilos (M) ──────────────────────────────
let serviciosGrooves: ServicioGrooves | null = null
function servicioGrooves(): ServicioGrooves {
  if (serviciosGrooves) return serviciosGrooves
  const raiz = carpetaDeGrooves(process.env, app.getPath('appData'))
  const semilla = app.isPackaged
    ? path.join(process.resourcesPath || '', 'grooves', 'estilos')
    : path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'grooves', 'estilos')
  serviciosGrooves = new ServicioGrooves({
    raiz,
    semilla,
    papelera: (ruta: string) => shell.trashItem(ruta),
    alCambiar: () => {
      const w = mainWindow as unknown as import('electron').BrowserWindow | null
      if (w && !w.isDestroyed()) w.webContents.send('grooves-cambio')
    },
  })
  pathGrants.grant(raiz, 'readwrite')
  return serviciosGrooves
}
/** Siembra el contenido de serie (sin pisar nada) y vigila la carpeta. Nunca debe impedir el arranque. */
function iniciarGrooves() {
  try {
    const s = servicioGrooves()
    s.sembrar()
    s.vigilar()
  } catch (err) {
    logLine('warn', 'grooves', `No se pudo preparar la biblioteca de grooves: ${(err as Error).message}`)
  }
}
const envolverGrooves = <T>(f: () => T | Promise<T>) =>
  Promise.resolve()
    .then(f)
    .then((r) => ({ ok: true as const, ...(r as object) }))
    .catch((e: Error) => ({ ok: false as const, error: e.message }))
ipcMain.handle('grooves-carpeta', () => servicioGrooves().raiz)
ipcMain.handle('grooves-listar', () =>
  envolverGrooves(() => {
    const s = servicioGrooves()
    return { raiz: s.raiz, grooves: s.indexar(), carpetas: s.carpetas(), favoritos: s.favoritosIds(), sync: s.leerSync() }
  }),
)
ipcMain.handle('grooves-leer', (_e: IpcMainInvokeEvent, ruta: string) => envolverGrooves(() => ({ bytes: servicioGrooves().leerBytes(String(ruta)) })))
ipcMain.handle('grooves-importar-bytes', (_e: IpcMainInvokeEvent, nombre: string, bytes: Uint8Array, estilo: string, subestilo?: string) =>
  envolverGrooves(() => servicioGrooves().importarBytes(String(nombre), new Uint8Array(bytes), String(estilo), subestilo ? String(subestilo) : undefined)),
)
ipcMain.handle('grooves-importar-dialogo', async (_e: IpcMainInvokeEvent, estilo: string, subestilo?: string) => {
  if (!mainWindow) return { ok: false, error: 'Sin ventana' }
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Añadir grooves MIDI',
    filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
    properties: ['openFile', 'multiSelections'],
  })
  if (r.canceled || !r.filePaths.length) return { ok: true, importados: [], errores: [], cancelado: true }
  return envolverGrooves(() =>
    servicioGrooves().importarRutas(r.filePaths, String(estilo), subestilo ? String(subestilo) : undefined, (p) => pathGrants.isBinaryReadAllowed(p)),
  )
})
ipcMain.handle('grooves-importar-rutas', (_e: IpcMainInvokeEvent, rutas: string[], estilo: string, subestilo?: string) =>
  envolverGrooves(() =>
    servicioGrooves().importarRutas(Array.isArray(rutas) ? rutas.map(String) : [], String(estilo), subestilo ? String(subestilo) : undefined, (p) =>
      pathGrants.isBinaryReadAllowed(p),
    ),
  ),
)
ipcMain.handle('grooves-crear-estilo', (_e: IpcMainInvokeEvent, estilo: string, subestilo?: string) =>
  envolverGrooves(() => servicioGrooves().crearEstilo(String(estilo), subestilo ? String(subestilo) : undefined)),
)
ipcMain.handle('grooves-renombrar-estilo', (_e: IpcMainInvokeEvent, actual: string, nuevo: string) =>
  envolverGrooves(() => servicioGrooves().renombrarEstilo(String(actual), String(nuevo))),
)
ipcMain.handle('grooves-borrar', (_e: IpcMainInvokeEvent, ruta: string) => envolverGrooves(async () => (await servicioGrooves().borrar(String(ruta)), {})))
ipcMain.handle('grooves-borrar-estilo', (_e: IpcMainInvokeEvent, ruta: string) =>
  envolverGrooves(async () => (await servicioGrooves().borrarEstilo(String(ruta)), {})),
)
ipcMain.handle('grooves-favorito', (_e: IpcMainInvokeEvent, id: string, valor?: boolean) =>
  envolverGrooves(() => ({ favoritos: servicioGrooves().alternarFavorito(String(id), typeof valor === 'boolean' ? valor : undefined) })),
)
// Sincronización con el catálogo (grooves-sync.ts): la sesión y la URL del servidor las pone el renderer.
const enviarAlRenderer = (canal: string, datos?: unknown) => {
  const w = mainWindow as unknown as import('electron').BrowserWindow | null
  if (w && !w.isDestroyed()) w.webContents.send(canal, datos)
}
ipcMain.handle('grooves-sync-ahora', async (_e: IpcMainInvokeEvent, apiBase: unknown, token: unknown) => {
  try {
    if (typeof token !== 'string' || !token || token.length > 8192) throw new Error('Inicia sesión para actualizar los grooves')
    const base = apiBaseValida(apiBase)
    return await sincronizarGrooves({
      servicio: servicioGrooves(),
      apiBase: base,
      token,
      emitir: (ev: EventoSync) => enviarAlRenderer(`grooves-sync-${ev.tipo}`, ev),
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message, descargados: 0, actualizados: 0, retirados: 0, conservados: [], errores: [], fecha: new Date().toISOString() }
  }
})
ipcMain.handle('grooves-sync-estado', () => envolverGrooves(() => ({ estado: servicioGrooves().leerEstadoSync() })))
ipcMain.handle('grooves-sync-ajustes', (_e: IpcMainInvokeEvent, ajustes: { auto?: unknown; compartir?: unknown }) =>
  envolverGrooves(() => ({
    estado: servicioGrooves().guardarEstadoSync({
      ...(typeof ajustes?.auto === 'boolean' ? { auto: ajustes.auto } : {}),
      ...(typeof ajustes?.compartir === 'boolean' ? { compartir: ajustes.compartir } : {}),
    }),
  })),
)
ipcMain.handle('grooves-proponer', async (_e: IpcMainInvokeEvent, apiBase: unknown, token: unknown, ruta: unknown, meta: unknown, consentimiento: unknown) => {
  try {
    if (typeof token !== 'string' || !token) throw new Error('Inicia sesión para proponer grooves')
    const c = consentimiento as { aceptado?: unknown; version?: unknown }
    return await enviarPropuesta({
      servicio: servicioGrooves(),
      apiBase: apiBaseValida(apiBase),
      token,
      ruta: String(ruta),
      meta: meta as never,
      consentimiento: { aceptado: c?.aceptado === true, version: String(c?.version ?? '') },
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})
ipcMain.handle('grooves-abrir-carpeta', () => envolverGrooves(async () => (await shell.openPath(servicioGrooves().raiz), {})))
/** Rutas para localizar plugins propios: instalación de usuario o los incluidos en resources/. */
ipcMain.handle('known-paths', () => {
  const resourcesPath = app.isPackaged ? process.resourcesPath || '' : ''
  return {
    resourcesPath,
    localAppData: process.env.LOCALAPPDATA || '',
    // Solo en la app empaquetada (extraResources vst3/JasWave); en dev queda vacío.
    bundledVst3Dir: resourcesPath ? path.join(resourcesPath, 'vst3', 'JasWave') : '',
    proyectosDir: carpetaDeProyectos(),
  }
})

/**
 * Carpeta por defecto de los proyectos nuevos: Documentos\JasWave (visible para el usuario; antes se proponía la
 * carpeta oculta de datos de la app). JASWAVE_PROYECTOS_DIR la sustituye (instancias de prueba aisladas).
 */
function carpetaDeProyectos(): string {
  const dir = process.env.JASWAVE_PROYECTOS_DIR || path.join(app.getPath('documents'), 'JasWave')
  try {
    fsSync.mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return ''
  }
}

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
/** Carpeta VST3 donde el instalador deja los bundles JasWave (también la usan otros DAW). */
function carpetaInstalacionVst3(): string {
  return path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Programs', 'Common', 'VST3', 'JasWave')
}
/** Carpeta de paquetes de esta cuenta de usuario (la única de la que se puede desinstalar). */
function carpetaPaquetesUsuario(): string {
  return path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'JasWave', 'plugins')
}
ipcMain.handle('plugins-listar', async () => {
  const usuario = path.resolve(carpetaPaquetesUsuario()) + path.sep
  const paquetes = await escanearPaquetes(raicesPlugins(), carpetasVst3Plugins(), carpetaInstalacionVst3())
  return paquetes.map((p) => ({ ...p, desinstalable: path.resolve(p.dir).startsWith(usuario) }))
})

// Instalación bajo demanda (D1): catálogo firmado, descarga verificada e instalación en VST3 de usuario.
function apiBaseValida(v: unknown): string {
  if (typeof v !== 'string') throw new Error('URL del servidor inválida')
  const u = new URL(v)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname))) {
    throw new Error('el servidor de JasWave debe usar https')
  }
  return u.origin + u.pathname.replace(/\/+$/, '')
}
const instalacionesEnCurso = new Set<string>()
ipcMain.handle('plugins-catalogo', async (_e: IpcMainInvokeEvent, apiBase: unknown) => obtenerCatalogo(apiBaseValida(apiBase), CLAVE_PUBLICA_JASWAVE))
ipcMain.handle('plugins-instalar', async (e: IpcMainInvokeEvent, apiBase: unknown, id: unknown) => {
  if (typeof id !== 'string') throw new Error('id de plugin inválido')
  if (instalacionesEnCurso.has(id)) return { ok: false, error: 'ya se está instalando' }
  instalacionesEnCurso.add(id)
  try {
    // El catálogo se vuelve a pedir y verificar aquí: el renderer solo elige qué id instalar.
    const catalogo = await obtenerCatalogo(apiBaseValida(apiBase), CLAVE_PUBLICA_JASWAVE)
    const entrada = catalogo.paquetes.find((p) => p.id === id)
    if (!entrada) return { ok: false, error: 'el plugin no está en el catálogo' }
    const ruta = await instalarPaquete(entrada, {
      carpetaPaquetes: path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'JasWave', 'plugins'),
      carpetaVst3: carpetaInstalacionVst3(),
      alProgreso: (p) => { if (!e.sender.isDestroyed()) e.sender.send('plugins-progreso', p) },
    })
    logLine('info', 'plugins', `instalado ${entrada.id}@${entrada.version} en ${ruta}`)
    return { ok: true, version: entrada.version }
  } catch (err) {
    logLine('warn', 'plugins', `instalación fallida ${id}`, err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    instalacionesEnCurso.delete(id)
  }
})

// ── Extensiones .jwx desde archivo (X1, como los .vsix de VS Code) ─────────────
/** Claves que firman paquetes: la de JasWave y, solo en desarrollo (nunca empaquetada), una de pruebas. */
function clavesPaquetes(): string[] {
  const claves = [CLAVE_PUBLICA_JASWAVE]
  if (!app.isPackaged && process.env.JASWAVE_PRUEBAS_CLAVE_PUBLICA) claves.push(process.env.JASWAVE_PRUEBAS_CLAVE_PUBLICA)
  return claves
}
ipcMain.handle('plugins-elegir-jwx', async (e: IpcMainInvokeEvent) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const r = await dialog.showOpenDialog(win, {
    title: 'Instalar extensión de JasWave',
    filters: [{ name: 'Extensión de JasWave', extensions: ['jwx'] }],
    properties: ['openFile'],
  })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
})
ipcMain.handle('plugins-inspeccionar-archivo', async (_e: IpcMainInvokeEvent, ruta: unknown) => {
  try {
    return { ok: true, paquete: await inspeccionarArchivo(String(ruta), { clavesPublicas: clavesPaquetes() }) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
ipcMain.handle('plugins-instalar-archivo', async (e: IpcMainInvokeEvent, ruta: unknown, opciones: unknown) => {
  if (!isMainWindowSender(e)) return { ok: false, error: 'Solo la ventana principal puede instalar extensiones' }
  const clave = `archivo:${String(ruta)}`
  if (instalacionesEnCurso.has(clave)) return { ok: false, error: 'ya se está instalando' }
  instalacionesEnCurso.add(clave)
  try {
    const aceptarSinFirma = !!(opciones && typeof opciones === 'object' && (opciones as { aceptarSinFirma?: unknown }).aceptarSinFirma === true)
    const r = await instalarArchivo(
      String(ruta),
      { modoDesarrollador: !!readMainSettings().modoDesarrollador, aceptarSinFirma },
      {
        carpetaPaquetes: carpetaPaquetesUsuario(),
        carpetaVst3: carpetaInstalacionVst3(),
        clavesPublicas: clavesPaquetes(),
        alProgreso: (p) => { if (!e.sender.isDestroyed()) e.sender.send('plugins-progreso', p) },
      },
    )
    if (r.ok) logLine('info', 'plugins', `instalado desde archivo ${r.paquete.id}@${r.paquete.version} (${r.origen})`)
    else logLine('warn', 'plugins', `instalación desde archivo rechazada: ${r.error}`)
    return r
  } catch (err) {
    logLine('warn', 'plugins', 'instalación desde archivo fallida', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    instalacionesEnCurso.delete(clave)
  }
})
ipcMain.handle('plugins-desinstalar', async (e: IpcMainInvokeEvent, id: unknown) => {
  if (!isMainWindowSender(e)) return { ok: false, error: 'Solo la ventana principal puede desinstalar extensiones' }
  try {
    const r = await desinstalarPaquete(String(id), { carpetaPaquetes: carpetaPaquetesUsuario(), carpetaVst3: carpetaInstalacionVst3() })
    logLine('info', 'plugins', `desinstalado ${String(id)}${r.bundle ? ` (y ${r.bundle})` : ''}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
ipcMain.handle('extension-pendiente', () => {
  const r = extensionPendiente
  extensionPendiente = null
  return r
})
ipcMain.handle('ajustes-modo-desarrollador', () => !!readMainSettings().modoDesarrollador)
// Activarlo exige confirmar en un diálogo nativo: ningún código del renderer (ni un módulo) puede hacerlo solo.
ipcMain.handle('ajustes-fijar-modo-desarrollador', async (e: IpcMainInvokeEvent, activo: unknown) => {
  if (!isMainWindowSender(e)) return !!readMainSettings().modoDesarrollador
  if (activo === true) {
    const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
      type: 'warning',
      buttons: ['Activar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Modo desarrollador',
      message: '¿Activar el Modo desarrollador?',
      detail:
        'Podrás instalar extensiones .jwx que no están firmadas por JasWave (se marcarán como «sin firmar»). ' +
        'El código de una extensión se ejecuta dentro del DAW: instala solo paquetes de quien confíes.',
    })
    if (r.response !== 0) return !!readMainSettings().modoDesarrollador
  }
  await writeMainSettings({ modoDesarrollador: activo === true })
  logLine('info', 'main', `Modo desarrollador ${activo === true ? 'activado' : 'desactivado'}`)
  return activo === true
})

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

// Producciones de la banda (plan Q): diario, puntos de control, cierre de emergencia y vigilancia de memoria.
const produccionMain = instalarProduccionMain({
  ipcMain,
  app,
  dialog,
  powerMonitor: { on: (ev: string, fn: () => void) => void app.whenReady().then(() => require('electron').powerMonitor.on(ev, fn)) },
  getWindow: () => mainWindow as any,
  logLine,
  esRemitentePrincipal: (e: unknown) => isMainWindowSender(e as IpcMainInvokeEvent),
})

// Carpeta de configuración del asistente: reglas, habilidades, prompts y planes en Markdown.
// Solo rutas relativas validadas dentro de `<userData>/asistente/` (ver asistente-config.ts).
let asistenteConfig: AsistenteConfig | null = null
const configAsistente = () => (asistenteConfig ??= new AsistenteConfig(path.join(app.getPath('userData'), 'asistente')))
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : String(e))
ipcMain.handle('asistente-carpeta-listar', async () => {
  try {
    return { ok: true, archivos: await configAsistente().listar(), carpeta: configAsistente().carpeta }
  } catch (e) {
    return { ok: false, error: errorTexto(e) }
  }
})
ipcMain.handle('asistente-carpeta-escribir', async (_e: IpcMainInvokeEvent, ruta: unknown, contenido: unknown) => {
  try {
    await configAsistente().escribir(String(ruta), String(contenido ?? ''))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errorTexto(e) }
  }
})
ipcMain.handle('asistente-carpeta-eliminar', async (_e: IpcMainInvokeEvent, ruta: unknown) => {
  try {
    return { ok: true, existia: await configAsistente().eliminar(String(ruta)) }
  } catch (e) {
    return { ok: false, error: errorTexto(e) }
  }
})
ipcMain.handle('asistente-carpeta-restaurar', async (_e: IpcMainInvokeEvent, ruta: unknown) => {
  try {
    return { ok: true, restaurado: await configAsistente().restaurar(String(ruta)) }
  } catch (e) {
    return { ok: false, error: errorTexto(e) }
  }
})
ipcMain.handle('asistente-carpeta-abrir', async () => {
  try {
    await configAsistente().asegurar()
    const err = await shell.openPath(configAsistente().carpeta)
    return err ? { ok: false, error: err } : { ok: true }
  } catch (e) {
    return { ok: false, error: errorTexto(e) }
  }
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

/** Controles de ventana: actúan sobre la ventana que los pide (principal, flotantes o cualquier otra). */
function ventanaDelEmisor(e: IpcMainInvokeEvent): import('electron').BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(e.sender) as import('electron').BrowserWindow | null
  return win && !win.isDestroyed() ? win : null
}

ipcMain.handle('window-minimize', (e: IpcMainInvokeEvent) => {
  ventanaDelEmisor(e)?.minimize()
})

ipcMain.handle('window-maximize', (e: IpcMainInvokeEvent) => {
  const win = ventanaDelEmisor(e)
  if (!win) return false
  if (win.isFullScreen()) win.setFullScreen(false)
  else if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})

ipcMain.handle('window-close', (e: IpcMainInvokeEvent) => {
  // Pasa por el guard de 'close' (confirmación de cambios sin guardar) en la principal.
  ventanaDelEmisor(e)?.close()
})

/** Recolorea los botones nativos para que casen con la barra visible (p. ej. el Portal). */
ipcMain.handle('window-set-titlebar-overlay', (e: IpcMainInvokeEvent, opciones: unknown) => {
  const win = ventanaDelEmisor(e)
  const ok = normalizarOverlay(opciones)
  if (!win || !ok || process.platform === 'darwin') return false
  try {
    win.setTitleBarOverlay(ok)
    return true
  } catch {
    return false // ventana con marco nativo: no tiene overlay
  }
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

ipcMain.handle('window-is-maximized', (e: IpcMainInvokeEvent) => ventanaDelEmisor(e)?.isMaximized() ?? false)

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

// ── Exportación (G2): ffmpeg bajo demanda y codificación de formatos ───────────
function localAppDataDir(): string {
  return process.env.LOCALAPPDATA || app.getPath('userData')
}

ipcMain.handle('ffmpeg-available', async () => {
  const r = await resolverFfmpeg({ localAppData: localAppDataDir(), env: process.env })
  return r ? { ok: true, origen: r.origen } : { ok: false, error: 'ffmpeg no está instalado' }
})

let instalandoFfmpeg = false
/** Descarga ffmpeg del catálogo firmado (paquete com.jaswave.tool.ffmpeg) a %LOCALAPPDATA%/JasWave/tools. */
ipcMain.handle('ffmpeg-install', async (e: IpcMainInvokeEvent, apiBase: unknown) => {
  if (instalandoFfmpeg) return { ok: false, error: 'ya se está descargando el codificador' }
  instalandoFfmpeg = true
  try {
    const catalogo = await obtenerCatalogo(apiBaseValida(apiBase), CLAVE_PUBLICA_JASWAVE)
    const entrada = catalogo.paquetes.find((p) => p.id === ID_PAQUETE_FFMPEG)
    if (!entrada) {
      return {
        ok: false,
        error: 'El codificador no está publicado en el catálogo de JasWave. Instala ffmpeg y añádelo al PATH, o exporta en WAV.',
      }
    }
    const ruta = await instalarFfmpeg(entrada, {
      localAppData: localAppDataDir(),
      alProgreso: (recibidos, total) => {
        if (!e.sender.isDestroyed()) e.sender.send('ffmpeg-progreso', { recibidos, total })
      },
    })
    logLine('info', 'export', `ffmpeg ${entrada.version} instalado en ${ruta}`)
    return { ok: true, version: entrada.version }
  } catch (err) {
    logLine('warn', 'export', 'instalación de ffmpeg fallida', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    instalandoFfmpeg = false
  }
})

// ── G7: dictado por voz con el reconocedor local de Windows (System.Speech) ──
// La Web Speech API de Chromium no funciona en Electron (sin claves de Google → «network»).
const sesionDictado = new SesionDictadoWindows()
let turnoDictado = 0
ipcMain.handle('dictado-disponible', () =>
  sesionDictado.soportado ? { disponible: true, motor: 'windows' } : { disponible: false, motivo: 'El dictado local solo está disponible en Windows' },
)
ipcMain.handle('dictado-iniciar', async (e: IpcMainInvokeEvent, cultura: unknown) => {
  const wc = e.sender
  const turno = ++turnoDictado
  const r = await sesionDictado.iniciar(cultura, (ev) => {
    if (!wc.isDestroyed()) wc.send('dictado-evento', ev)
  })
  if (r.ok) {
    // Ventana cerrada con el micrófono abierto: soltarlo (solo si sigue siendo su sesión).
    wc.once('destroyed', () => {
      if (turno === turnoDictado) sesionDictado.detener()
    })
  } else {
    logLine('warn', 'dictado', `reconocedor de Windows no disponible: ${r.codigo} · ${r.error}`)
  }
  return r
})
ipcMain.handle('dictado-detener', () => {
  sesionDictado.detener()
  return { ok: true }
})
app.on('will-quit', () => sesionDictado.detener())

/** Crea la carpeta de destino de un export (stems) si el usuario concedió escritura ahí. */
ipcMain.handle('export-ensure-dir', async (_e: IpcMainInvokeEvent, dir: unknown) => {
  try {
    if (typeof dir !== 'string' || !dir.trim()) throw new Error('carpeta inválida')
    assertPath(dir, 'write')
    await fs.mkdir(dir, { recursive: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: traducirErrorDisco(err) }
  }
})

/**
 * Exportar proyecto empaquetado: `<nombre>.jaswave` + `media/…` en un zip. El renderer planifica
 * (rutas reescritas); aquí se comprueba que cada audio se puede leer y el destino escribir.
 */
ipcMain.handle(
  'project-export-bundle',
  async (
    e: IpcMainInvokeEvent,
    salida: unknown,
    json: unknown,
    nombreProyecto: unknown,
    archivos: unknown,
  ) => {
    try {
      if (typeof salida !== 'string' || !/\.zip$/i.test(salida)) throw new Error('el destino debe ser un .zip')
      if (typeof json !== 'string' || typeof nombreProyecto !== 'string') throw new Error('proyecto inválido')
      if (!Array.isArray(archivos)) throw new Error('lista de archivos inválida')
      assertPath(salida, 'write')
      const entradas: EntradaZip[] = [{ nombre: `${nombreProyecto}.jaswave`, texto: json }]
      for (const a of archivos as Array<{ origen?: unknown; destino?: unknown }>) {
        if (typeof a?.origen !== 'string' || typeof a.destino !== 'string' || !a.destino.startsWith('media/')) {
          throw new Error('entrada de media inválida')
        }
        entradas.push({ nombre: a.destino, archivo: assertBinaryRead(a.origen) })
      }
      const bytes = await escribirZip(salida, entradas, (hechos, total) => {
        if (!e.sender.isDestroyed()) e.sender.send('project-bundle-progreso', { hechos, total })
      })
      logLine('info', 'export', `proyecto empaquetado ${salida} (${entradas.length} entradas, ${bytes} bytes)`)
      return { ok: true, bytes }
    } catch (err) {
      return { ok: false, error: traducirErrorDisco(err) }
    }
  },
)

/** Abre un `.jaswave.zip`, lo extrae en una carpeta junto al zip y devuelve el `.jaswave` que contiene. */
ipcMain.handle('project-import-bundle', async () => {
  if (!mainWindow) return { ok: false, canceled: true }
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir proyecto empaquetado',
    filters: [{ name: 'Proyecto JasWave empaquetado', extensions: ['zip'] }],
    properties: ['openFile'],
  })
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
  const zip = r.filePaths[0]
  try {
    const base = path.basename(zip).replace(/\.zip$/i, '').replace(/\.jaswave$/i, '')
    let destino = path.join(path.dirname(zip), base)
    for (let n = 2; await fs.stat(destino).then(() => true, () => false); n++) destino = path.join(path.dirname(zip), `${base} (${n})`)
    const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
    const { execFile } = await import('node:child_process')
    const ejecutar = (args: string[]) =>
      new Promise<string>((resolve, reject) =>
        execFile(tar, args, { windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) =>
          err ? reject(new Error(String(errOut || err.message).slice(0, 300))) : resolve(String(out)),
        ),
      )
    // Mismas reglas que los paquetes de plugins: nada absoluto, sin `..`, tope de entradas.
    const entradas = validarListado(await ejecutar(['-tf', zip]))
    const proyectos = entradas.filter((x) => !x.includes('/') && /\.jaswave$/i.test(x))
    if (proyectos.length !== 1) throw new Error('el zip no es un proyecto JasWave empaquetado (falta el .jaswave en la raíz)')
    await fs.mkdir(destino, { recursive: true })
    await ejecutar(['-xf', zip, '-C', destino])
    grantUserPath(destino, 'readwrite')
    return { ok: true, ruta: path.join(destino, proyectos[0]!) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

const FFMPEG_TIMEOUT_MS = 10 * 60_000

/**
 * WAV del motor → formato final. El renderer elige formato y opciones; los argumentos se arman aquí.
 * `borrarEntrada` solo borra el WAV temporal del render (`*.render.wav`).
 */
ipcMain.handle(
  'audio-encode',
  async (
    _event: IpcMainInvokeEvent,
    input: unknown,
    output: unknown,
    formato: unknown,
    opciones: { bitrate?: number; bitDepth?: number; sampleRate?: number; borrarEntrada?: boolean } = {},
  ) => {
    try {
      if (typeof input !== 'string' || typeof output !== 'string') throw new Error('rutas inválidas')
      if (!esFormatoCodificado(formato)) throw new Error(`formato no soportado: ${String(formato)}`)
      assertBinaryRead(input)
      assertPath(output, 'write')
      if (!/\.wav$/i.test(input) || !isAudioFile(input)) throw new Error('la entrada debe ser el WAV del render')
      if (!extensionCoincide(formato, output)) throw new Error(`la extensión de ${path.basename(output)} no es de ${formato}`)
      const bin = await resolverFfmpeg({ localAppData: localAppDataDir(), env: process.env })
      if (!bin) throw new Error('FFMPEG_MISSING: el codificador no está instalado')
      const codec = argsCodificacion(formato, opciones)
      const { spawn } = await import('node:child_process')
      await fs.mkdir(path.dirname(output), { recursive: true })
      const args = ['-hide_banner', '-nostdin', '-y', '-i', input, ...codec, output]
      await new Promise<void>((resolve, reject) => {
        const child = spawn(bin.ruta, args, { windowsHide: true })
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
      if (opciones?.borrarEntrada && /\.render\.wav$/i.test(input)) {
        await fs.rm(input, { force: true }).catch(() => undefined)
      }
      return { ok: true, output }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle('file-read-binary', async (_event: IpcMainInvokeEvent, ruta: string) => {
  try {
    return await fs.readFile(assertBinaryRead(ruta))
  } catch {
    return null
  }
})

ipcMain.handle('recordings-dir', async (_event: IpcMainInvokeEvent, projectPath?: string) => {
  const projectDir =
    typeof projectPath === 'string' && projectPath.trim() ? path.dirname(projectPath) : null
  const base = projectDir && pathGrants.isAllowed(projectDir, 'write') ? projectDir : app.getPath('userData')
  const dir = path.join(base, 'media', 'grabaciones')
  await fs.mkdir(dir, { recursive: true })
  return dir
})

/**
 * Renders de medición de la IA (análisis con el motor real): una carpeta fija que se vacía en cada uso,
 * así los WAV temporales (mezcla + stems) no se acumulan. Solo se borra dentro de esta carpeta.
 */
const dirAnalisisIA = () => path.join(app.getPath('userData'), 'media', 'grabaciones', 'analisis-ia')
ipcMain.handle('analisis-ia-dir', async () => {
  const dir = dirAnalisisIA()
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(dir, { recursive: true })
  return dir
})
ipcMain.handle('analisis-ia-limpiar', async () => {
  await fs.rm(dirAnalisisIA(), { recursive: true, force: true }).catch(() => {})
  return true
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
  aiff: { name: 'AIFF', extensions: ['aiff', 'aif'] },
  ogg: { name: 'OGG Vorbis', extensions: ['ogg'] },
  m4a: { name: 'AAC (M4A)', extensions: ['m4a'] },
  opus: { name: 'Opus', extensions: ['opus'] },
  mid: { name: 'MIDI', extensions: ['mid'] },
  zip: { name: 'Proyecto JasWave empaquetado', extensions: ['zip'] },
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
    ipcMain.handle('handover-take-pending', () => {
      const token = handoverPendiente
      handoverPendiente = null
      return token
    })

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

/** Modo de pruebas (JASWAVE_AI_MOCK): el asistente usa el proveedor simulado local, sin backend ni claves. */
ipcMain.handle('ai-mock-activo', () => mockScriptPathFromEnv() !== null)

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

// ── K6: internet para la IA (web-tools.ts). Red solo aquí; preferencia + límite de peticiones. ──
const limitadorWeb = new LimitadorPeticiones(30, 60_000)
const temporalesReferencia = new GestorTemporalesReferencia(path.join(os.tmpdir(), `jaswave-referencias-${process.pid}`))
app.on('will-quit', () => temporalesReferencia.limpiar())

const internetPermitidoIA = () => readMainSettings().permitirInternetIA !== false

type RespuestaWeb<T> = ({ ok: true } & T) | { ok: false; error: string }

/** Comprueba la preferencia y el límite; ejecuta la herramienta y traduce errores a texto. */
async function herramientaWeb<T>(nombre: string, fn: () => Promise<T>): Promise<RespuestaWeb<{ datos: T }>> {
  if (!internetPermitidoIA()) return { ok: false, error: 'El acceso a internet de la IA está desactivado en Ajustes → IA («Permitir a la IA usar internet»)' }
  if (!limitadorWeb.permitir()) return { ok: false, error: 'Demasiadas peticiones a internet en un minuto (máximo 30); espera un momento' }
  try {
    return { ok: true, datos: await fn() }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logLine('warn', 'web-tools', `${nombre} falló: ${error}`)
    return { ok: false, error }
  }
}

ipcMain.handle('web-tools-internet-permitido', () => internetPermitidoIA())
ipcMain.handle('web-tools-fijar-internet-permitido', async (e: IpcMainInvokeEvent, activo: unknown) => {
  if (!isMainWindowSender(e)) return internetPermitidoIA()
  await writeMainSettings({ permitirInternetIA: activo !== false })
  logLine('info', 'web-tools', `internet para la IA ${activo !== false ? 'permitido' : 'desactivado'}`)
  return internetPermitidoIA()
})
ipcMain.handle('web-tools-buscar', (_e: IpcMainInvokeEvent, q: unknown, max: unknown) =>
  herramientaWeb('web.buscar', () => webBuscar(String(q ?? ''), { max: Number(max) || undefined })),
)
ipcMain.handle('web-tools-leer', (_e: IpcMainInvokeEvent, url: unknown, maxChars: unknown) =>
  herramientaWeb('web.leer', () => webLeer(String(url ?? ''), { maxChars: Number(maxChars) || undefined })),
)
ipcMain.handle('web-tools-youtube-buscar', (_e: IpcMainInvokeEvent, q: unknown, max: unknown) =>
  herramientaWeb('youtube.buscar', () => youtubeBuscar(String(q ?? ''), { max: Number(max) || undefined })),
)
ipcMain.handle('web-tools-youtube-ficha', (_e: IpcMainInvokeEvent, urlOId: unknown) =>
  herramientaWeb('youtube.ficha', () => youtubeFicha(String(urlOId ?? ''))),
)
ipcMain.handle('web-tools-youtube-miniatura', (_e: IpcMainInvokeEvent, videoId: unknown) =>
  herramientaWeb('youtube.miniatura', () => youtubeMiniatura(String(videoId ?? ''))),
)

let extrayendoReferencia = false
/**
 * Audio de una referencia de YouTube: yt-dlp (descargado y verificado bajo demanda) + ffmpeg → WAV mono
 * 22 050 Hz de hasta 90 s en la carpeta temporal (se borra al cerrar la app). El análisis musical lo hace
 * el renderer con los analizadores del DAW sobre las muestras que se devuelven aquí.
 */
ipcMain.handle('web-tools-referencia-analizar', async (e: IpcMainInvokeEvent, url: unknown) => {
  if (extrayendoReferencia) return { ok: false, error: 'Ya se está descargando otra referencia; espera a que termine' }
  extrayendoReferencia = true
  const progreso = (fase: string, detalle?: string) => {
    if (!e.sender.isDestroyed()) e.sender.send('web-tools-progreso', { fase, detalle })
  }
  try {
    return await herramientaWeb('referencia.analizar', async () => {
      if (!extraerVideoId(url)) throw new Error('La referencia debe ser un enlace o id de YouTube')
      const ffmpeg = await resolverFfmpeg({ localAppData: localAppDataDir(), env: process.env })
      if (!ffmpeg) throw new Error('FFMPEG_MISSING: ffmpeg no está instalado; instálalo desde Exportar (formato MP3) y vuelve a intentarlo')
      let ytDlp = await resolverYtDlp({ localAppData: localAppDataDir(), env: process.env })
      if (!ytDlp) {
        progreso('instalando', 'Descargando yt-dlp (verificado con SHA-256)')
        const ruta = await instalarYtDlp({ localAppData: localAppDataDir(), alProgreso: (r) => progreso('instalando', `${Math.round(r / 1024 / 1024)} MB`) })
        logLine('info', 'web-tools', `yt-dlp instalado en ${ruta}`)
        ytDlp = { ruta, origen: 'jaswave' }
      }
      const carpeta = await temporalesReferencia.preparar()
      pathGrants.grant(carpeta, 'read')
      const ref = await extraerReferenciaAudio(String(url), { carpeta, ytDlp: ytDlp.ruta, ffmpeg: ffmpeg.ruta, alProgreso: progreso })
      logLine('info', 'web-tools', `referencia ${ref.videoId}: ${Math.round(ref.duracionSeg)} s desde ${ref.desdeSeg} s (${ref.ruta})`)
      const { pcm, ...resto } = ref
      return { ...resto, pcm16: pcm }
    })
  } finally {
    extrayendoReferencia = false
  }
})

/** Ventana de la app para escuchar la referencia: sin node, partición propia, solo el embed de YouTube. */
let ventanaReferencia: typeof BrowserWindow | null = null
ipcMain.handle('web-tools-referencia-escuchar', async (_e: IpcMainInvokeEvent, url: unknown, titulo: unknown) => {
  if (!internetPermitidoIA()) return { ok: false, error: 'El acceso a internet de la IA está desactivado en Ajustes → IA' }
  const videoId = extraerVideoId(url)
  if (!videoId) return { ok: false, error: 'La referencia debe ser un enlace o id de YouTube' }
  try {
    const nombre = `Referencia: ${String(titulo ?? '').trim().slice(0, 120) || videoId}`
    if (ventanaReferencia && !ventanaReferencia.isDestroyed()) {
      ventanaReferencia.setTitle(nombre)
      await ventanaReferencia.loadURL(urlEmbedYoutube(videoId))
      ventanaReferencia.focus()
      return { ok: true, videoId }
    }
    const ses = session.fromPartition('referencia-youtube')
    ses.setPermissionRequestHandler((_wc: unknown, _permiso: string, callback: (ok: boolean) => void) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    const { screen } = require('electron')
    const medidasRef = medidasQueCaben(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, { width: 960, height: 560, minWidth: 420, minHeight: 260 })
    const icon = resolveAppIconPath()
    const win = new BrowserWindow({
      width: medidasRef.width,
      height: medidasRef.height,
      minWidth: medidasRef.minWidth,
      minHeight: medidasRef.minHeight,
      minimizable: true,
      maximizable: true,
      closable: true,
      title: nombre,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      ...(icon ? { icon } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: 'referencia-youtube',
      },
    })
    ventanaReferencia = win
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('page-title-updated', (ev: { preventDefault: () => void }) => ev.preventDefault())
    win.on('closed', () => {
      if (ventanaReferencia === win) ventanaReferencia = null
    })
    mainWindow?.once('closed', () => {
      if (!win.isDestroyed()) win.destroy()
    })
    await win.loadURL(urlEmbedYoutube(videoId))
    return { ok: true, videoId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
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
  const { screen } = require('electron')
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const { width, height, minWidth, minHeight } = medidasQueCaben(area, { width: 960, height: 640, minWidth: 480, minHeight: 320 })
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    // Marco nativo de Windows: minimizar, maximizar/restaurar y cerrar siempre (explícito, no por defecto)
    minimizable: true,
    maximizable: true,
    closable: true,
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

  conectarEstadoVentana(win)
  vigilarBarraVisible(win, screen)
  toolWindows.set(toolId, win)
  pinsGestor.ventanaAbierta(toolId, win) // pin: si este panel está anclado, nace siempre visible
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

/** JasWave Admin: app aparte del DAW (admin.html) en su propia ventana con marco nativo. Una sola instancia. */
let adminWindow: typeof BrowserWindow | null = null
ipcMain.handle('admin-window-open', async () => {
  if (adminWindow && !adminWindow.isDestroyed()) {
    if (adminWindow.isMinimized()) adminWindow.restore()
    adminWindow.focus()
    return { success: true, focused: true }
  }
  const icon = resolveAppIconPath()
  const { screen } = require('electron')
  // Estándar de ventanas (window-chrome.ts): cabe en el área de trabajo y con los tres botones nativos.
  const medidasAdmin = medidasQueCaben(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, {
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 520,
  })
  const win = new BrowserWindow({
    width: medidasAdmin.width,
    height: medidasAdmin.height,
    minWidth: medidasAdmin.minWidth,
    minHeight: medidasAdmin.minHeight,
    minimizable: true,
    maximizable: true,
    closable: true,
    title: 'JasWave Admin',
    backgroundColor: '#05060F',
    autoHideMenuBar: true,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  adminWindow = win
  conectarEstadoVentana(win)
  vigilarBarraVisible(win, screen)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  win.on('closed', () => {
    if (adminWindow === win) adminWindow = null
  })
  // El admin vive mientras viva el DAW (comparten proceso y sesión).
  mainWindow?.once('closed', () => {
    if (!win.isDestroyed()) win.destroy()
  })
  await loadAdmin(win)
  return { success: true }
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
  tomarMotorAudio,
  cederMotorAudio,
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
subscribeNativeMidi((msg: { id: string; data: number[]; tNs?: number }) => {
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
// Traspaso del motor de audio entre instancias: «Usar audio aquí» y la cesión de la que sonaba.
ipcMain.handle('audio-engine-take', async (e: IpcMainInvokeEvent) => {
  if (senderIsSatellite(e.sender)) return { ok: false, message: 'Solo la ventana principal maneja el motor de audio' }
  return tomarMotorAudio()
})
ipcMain.handle('audio-engine-release', async (e: IpcMainInvokeEvent) => {
  if (senderIsSatellite(e.sender)) return { ok: false }
  return cederMotorAudio()
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
// V4: editor nativo embebido en el panel del DAW (popup del host alineado al panel; ver editor-embebido.ts)
const editoresEmbebidos = new EditoresEmbebidos((cmd) => {
  void sendPluginHostCommand(cmd, 5_000).catch(() => undefined)
}, 33)
function ventanaEditor(win: InstanceType<typeof BrowserWindow>): VentanaEditor {
  const { screen } = require('electron')
  return {
    id: win.id,
    isDestroyed: () => win.isDestroyed(),
    isMinimized: () => win.isMinimized(),
    isVisible: () => win.isVisible(),
    getContentBounds: () => win.getContentBounds(),
    zoom: () => win.webContents.getZoomFactor(),
    aPantalla: (r) => (process.platform === 'win32' ? screen.dipToScreenRect(win, r) : r),
  }
}
// ── Pin: editores nativos y paneles flotantes anclados, siempre visibles según su jerarquía (ver pins.ts) ──
const pinsGestor = new GestorPins({
  leerArchivo: () => {
    try {
      return fsSync.readFileSync(path.join(app.getPath('userData'), 'pins.json'), 'utf8')
    } catch {
      return null
    }
  },
  escribirArchivo: (contenido) => {
    fsSync.writeFileSync(path.join(app.getPath('userData'), 'pins.json'), contenido, 'utf8')
  },
  enviarHost: (cmd) => {
    // sin host vivo no se arranca uno solo para anclar: el pin se re-anuncia al abrir el editor
    if (!getPluginHostStatus().vst3HostProcessAvailable) return
    void sendPluginHostCommand(cmd, 5_000).catch(() => undefined)
  },
  ventanaPanel: (toolId) => {
    const w = toolWindows.get(toolId)
    return w && !w.isDestroyed() ? w : null
  },
  difundir: (estado) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('pins-cambio', estado)
    }
  },
})
function pinTexto(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}
ipcMain.handle('pins-estado', () => pinsGestor.estado())
ipcMain.handle('pins-proyecto', (e: IpcMainInvokeEvent, clave: unknown) =>
  senderIsSatellite(e.sender) ? pinsGestor.estado() : pinsGestor.establecerProyecto(pinTexto(clave)),
)
ipcMain.handle('pins-alternar', (_e: IpcMainInvokeEvent, tipo: unknown, id: unknown, etiqueta: unknown) =>
  tipo === 'editor' || tipo === 'panel'
    ? pinsGestor.alternar(tipo, pinTexto(id, 512), pinTexto(etiqueta, 120) || undefined)
    : pinsGestor.estado(),
)
ipcMain.handle('pins-mover', (_e: IpcMainInvokeEvent, clave: unknown, delta: unknown) =>
  pinsGestor.mover(pinTexto(clave, 600), Number(delta) || 0),
)
ipcMain.handle('pins-mover-a', (_e: IpcMainInvokeEvent, clave: unknown, destino: unknown) =>
  pinsGestor.moverA(pinTexto(clave, 600), Number(destino) || 0),
)
ipcMain.handle('pins-quitar', (_e: IpcMainInvokeEvent, clave: unknown) => pinsGestor.quitar(pinTexto(clave, 600)))

app.on('browser-window-created', (_ev: unknown, win: InstanceType<typeof BrowserWindow>) => {
  const id = win.id
  // Con la ventana principal minimizada/oculta, los anclados se ocultan; al restaurar vuelven (sin colgarse).
  for (const evento of ['minimize', 'hide']) win.on(evento as 'hide', () => { if (mainWindow && win.id === mainWindow.id) pinsGestor.appOcultada(true) })
  for (const evento of ['restore', 'show']) win.on(evento as 'show', () => { if (mainWindow && win.id === mainWindow.id) pinsGestor.appOcultada(false) })
  const seguir = (raise: boolean) => () => editoresEmbebidos.ventanaCambio(id, raise)
  for (const evento of ['move', 'resize', 'minimize', 'maximize', 'unmaximize', 'hide', 'enter-full-screen', 'leave-full-screen'])
    win.on(evento as 'move', seguir(false))
  // al volver al frente, el DAW tapa el popup del host: se sube encima sin activarlo
  for (const evento of ['focus', 'restore', 'show']) win.on(evento as 'focus', seguir(true))
  win.on('closed', () => editoresEmbebidos.ventanaCerrada(id))
})

ipcMain.handle('plugin-host-send', async (e: IpcMainInvokeEvent, cmd: unknown) => {
  let record = (cmd && typeof cmd === 'object' ? cmd : {}) as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''

  // Las carpetas de escaneo llegan con variables sin expandir (%LOCALAPPDATA%…): se expanden aquí, antes de los permisos.
  if (type === 'discover' && typeof record.path === 'string') record = { ...record, path: expandirVariablesDeEntorno(record.path) }

  const allowed = checkHostCommand(record, pathGrants)
  if (!allowed.ok) return { ok: false, error: allowed.error, message: allowed.error }

  if (!isEditorHostCommand(type)) {
    await ensurePluginHostStarted()
  }

  const panelEmbebido = type === 'openEditor' || type === 'setEditorBounds' ? panelDesdeComando(record) : null
  // cerrar, o reabrir en ventana flotante: main deja de seguir ese editor
  if (type === 'closeEditor' || (type === 'openEditor' && !panelEmbebido)) editoresEmbebidos.cerrar(String(record.slotId ?? ''))
  const ventanaPanel = panelEmbebido ? BrowserWindow.fromWebContents(e.sender) : null
  if (panelEmbebido && ventanaPanel && !ventanaPanel.isDestroyed()) {
    const slotId = String(record.slotId ?? '')
    if (type === 'setEditorBounds') {
      editoresEmbebidos.actualizar(slotId, panelEmbebido)
      return { ok: true }
    }
    record = editoresEmbebidos.abrir(slotId, ventanaEditor(ventanaPanel), panelEmbebido, record)
  } else if (type === 'openEditor' || type === 'setEditorBounds') {
    // openEditor: ventana top-level centrada (sin parent Electron → sin deadlock).
    if (type === 'openEditor') {
      delete record.parentHwnd
      pinsGestor.prepararEditor(String(record.slotId ?? '')) // pin: el host crea la ventana ya TOPMOST
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
    console.info('[plugin-host] setAudioDevice pedido por la UI:', record.backend || record.api || 'auto', record.deviceId || record.device || '')
    return setPluginHostAudioDevice({
      backend: String(record.backend || record.api || 'auto'),
      deviceId: String(record.deviceId || record.device || ''),
      sampleRate: Number(record.sampleRate) || 48000,
      bufferSize: Number(record.bufferSize) || 512,
      exclusive: !!record.exclusive || String(record.backend) === 'wasapi_exclusive',
    })
  }

  if (type === 'unload') pinsGestor.slotDescargado(String(record.slotId ?? '')) // el pin desaparece con el slot
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
