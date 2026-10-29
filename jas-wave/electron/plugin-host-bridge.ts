/**
 * Electron main: Plugin Host Process (ADR-0011 C).
 *
 * VST3: misma instancia para process() y createView (UI nativa).
 * Device de audio: WASAPI / Exclusive / DirectSound / WinMM / ASIO (seleccionable).
 */

import { logLine } from './logger'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app, BrowserWindow } from 'electron'
import { parseAudioDeviceNotice, type AudioDeviceNotice } from './audio-device-notice'
import { hayCrashLoop, limpiarSalidas, registrarSalidaInesperada } from './crash-loop'
import { matarHostsHuerfanos } from './host-huerfanos'
import { claveSerieRpc, esBarreraRpc, siguienteRpcEnviable } from './plugin-host-rpc-scheduler'
import { ColaPipeMezcla } from './mix-pipe-queue'
import {
  evaluarCuarentena,
  mensajeMotivoCuarentena,
  VENTANA_PRIMER_BLOQUE_MS,
  type CargaEnCurso,
} from './quarantine'

import { pickPreferredWasapi, wantsSharedWasapi, type AudioDevicePrefs } from './salida-wasapi'

export type { AudioDevicePrefs }

export type PluginHostRpcResult =
  | {
      ok: true
      processId: string
      message?: string
      slotId?: string
      latencySamples?: number
      plugins?: Array<{
        path: string
        name: string
        format?: string
        hostReady?: boolean
        editorReady?: boolean
      }>
      count?: number
      editorReady?: boolean
      editorOpening?: boolean
      audioReady?: boolean
      backends?: Array<{ id: string; name: string; available: boolean; hint?: string }>
      devices?: Array<{
        id: string
        backend: string
        name: string
        isDefault?: boolean
        available?: boolean
      }>
      audio?: {
        backend: string
        deviceId: string
        deviceName: string
        sampleRate: number
        bufferSize: number
        exclusive: boolean
        running: boolean
        lastError?: string
      }
      mixPipe?: string
      parameterCount?: number
      parameters?: Array<{
        id: number
        parameterId: string
        name: string
        shortName?: string
        unit?: string
        displayValue?: string
        normalizedValue: number
        defaultNormalizedValue?: number
        stepCount?: number
        automatable?: boolean
        readOnly?: boolean
        hidden?: boolean
        bypass?: boolean
        programChange?: boolean
      }>
    }
  | {
      ok: false
      code: string
      message: string
      audio?: {
        backend: string
        deviceId: string
        deviceName: string
        sampleRate: number
        bufferSize: number
        exclusive: boolean
        running: boolean
        lastError?: string
      }
    }

type Pending = {
  resolve: (v: PluginHostRpcResult) => void
  timer: ReturnType<typeof setTimeout>
  type: string
  /** Comandos del mismo slot no se solapan (load → setPluginState → listParameters…). */
  slotKey: string
  barrier: boolean
}

type QueuedCmd = {
  cmd: Record<string, unknown>
  timeoutMs: number
  resolve: (v: PluginHostRpcResult) => void
}

let child: ChildProcessWithoutNullStreams | null = null
let buffer = ''
/**
 * Peticiones en vuelo por `rid`. Con un host que devuelve el `rid` (ping → `ridEcho`), varias
 * peticiones conviven: una carga lenta de VST ya no frena subidas de clip, reloj ni medidores, y
 * una respuesta tardía tras un timeout se descarta en vez de resolver la petición siguiente.
 * Sin `ridEcho` (host antiguo / node-host) se trabaja en serie como antes.
 */
const inFlight = new Map<number, Pending>()
let nextRid = 1
let hostEchoesRid = false
const MAX_IN_FLIGHT = 8
const queue: QueuedCmd[] = []
const sondeosEnCurso = new Map<string, Promise<PluginHostRpcResult>>()
let started = false
let backend: 'native' | 'node' | 'none' = 'none'
let startPromise: Promise<boolean> | null = null
let lastError: string | undefined
/** Último `load` (para cuarentena si el host muere justo después). */
let lastLoadPluginPath = ''
/** U7: carga en vuelo (load/prepare) del proceso actual. */
let cargaEnCursoActual: CargaEnCurso | null = null
/** U7: plugin cargado en el proceso actual y su primer bloque. */
let pluginCargadoEnProceso: string | null = null
let pluginCargadoEn = 0
let bloquePluginAbierto = false
let bloquePluginTimer: ReturnType<typeof setTimeout> | null = null
/** Ruta del plugin por slot (para resolver un `prepare` en vuelo). */
const slotPluginPath = new Map<string, string>()
let unexpectedExitTimes: number[] = []
let autoRespawnTimer: ReturnType<typeof setTimeout> | null = null
let mixSock: fs.WriteStream | null = null
let mixBackpressure = false
let mixPipePath = ''
const mixQueue = new ColaPipeMezcla(2048 * 2)
let mixReconnectTimer: ReturnType<typeof setTimeout> | null = null
let mixReconnectAttempts = 0
let mixSuppressReconnect = false
/** Evita close+connect concurrentes (maxInstances=1 en el named pipe del host). */
let mixConnectLock: Promise<boolean> | null = null
let lastMixConnectOkAt = 0

/** Rate-limit Soft Pad→pipe en main (Chromium sink-none puede inundar tras N compases). */
const MIX_MAGIC = 0x4a575354
let mixPaceEpochMs = 0
let mixPaceFrames = 0
let mixPaceSr = 48000
let mixPaceMaxAhead = 2048

export function configureMixPcmPace(sampleRate?: number, bufferSize?: number): void {
  if (sampleRate && sampleRate >= 8000 && sampleRate <= 192000) mixPaceSr = sampleRate
  if (bufferSize && bufferSize >= 16 && bufferSize <= 8192) {
    // ~1.5 bloques ASIO de holgura (antes 2× → saturaba tras Soft Pad multi-pista).
    mixPaceMaxAhead = Math.max(Math.round(bufferSize * 1.5), 768)
  }
  // La cola de contrapresión aguanta ~2 ventanas de holgura antes de descartar lo más antiguo.
  mixQueue.fijarTope(mixPaceMaxAhead * 2)
}

export function resetMixPcmPace(): void {
  mixPaceEpochMs = 0
  mixPaceFrames = 0
}

function framesInMixPacket(buf: Buffer): number {
  if (buf.byteLength >= 8 && buf.readUInt32LE(0) === MIX_MAGIC) {
    return buf.readUInt16LE(6) || 0
  }
  return Math.floor(buf.byteLength / 8)
}
function sleepMs(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function cancelMixReconnect() {
  mixSuppressReconnect = true
  if (mixReconnectTimer) {
    clearTimeout(mixReconnectTimer)
    mixReconnectTimer = null
  }
  mixReconnectAttempts = 0
}

function closeMixPipe() {
  mixBackpressure = false
  mixQueue.vaciar()
  if (!mixSock) return
  const s = mixSock
  mixSock = null
  try {
    // No quitar 'error' antes de destroy: writes pendientes emiten ERR_STREAM_DESTROYED
    // y sin listener tumba el main process (uncaughtException).
    s.removeAllListeners('drain')
    s.removeAllListeners('open')
    s.removeAllListeners('close')
    s.removeAllListeners('error')
    s.on('error', () => {
      /* swallow late FS write-after-destroy */
    })
    if (typeof (s as fs.WriteStream & { end?: () => void }).end === 'function' && s.writable) {
      try {
        s.end()
      } catch {
        /* ignore */
      }
    }
    s.destroy()
  } catch {
    /* ignore */
  }
}

/** Write seguro al mix pipe (nunca lanza; reconecta si el stream murió). */
function writeMixPipe(buf: Buffer): boolean {
  const s = mixSock
  if (!s || s.destroyed || !s.writable) return false
  try {
    return s.write(buf, (err) => {
      if (!err) return
      if (mixSock === s) {
        mixSock = null
        mixBackpressure = false
        mixQueue.vaciar()
      }
      if (!mixSuppressReconnect) scheduleMixReconnect()
    })
  } catch {
    if (mixSock === s) {
      mixSock = null
      mixBackpressure = false
      mixQueue.vaciar()
    }
    if (!mixSuppressReconnect) scheduleMixReconnect()
    return false
  }
}

function flushMixPending() {
  if (!mixSock || mixSock.destroyed || !mixSock.writable) {
    mixQueue.vaciar()
    return
  }
  while (mixQueue.length) {
    const p = mixQueue.primero()!
    const ok = writeMixPipe(p)
    mixQueue.quitarPrimero()
    if (!ok) {
      mixBackpressure = true
      return
    }
  }
}

function scheduleMixReconnect() {
  if (mixSuppressReconnect || backend !== 'native' || !started) return
  if (mixReconnectTimer || isMixPipeConnected()) return
  if (mixReconnectAttempts >= 16) return
  mixReconnectAttempts += 1
  const delay = Math.min(1500, 80 * mixReconnectAttempts)
  mixReconnectTimer = setTimeout(() => {
    mixReconnectTimer = null
    if (mixSuppressReconnect || isMixPipeConnected() || !started) return
    void ensureMixPipeConnected().then((ok) => {
      if (ok) mixReconnectAttempts = 0
      else scheduleMixReconnect()
    })
  }, delay)
}

/**
 * El host crea el pipe con PIPE_ACCESS_INBOUND (solo escribe el cliente).
 * net.connect abre R/W y en Windows el socket se cierra al instante → storm de reconnect.
 * Usamos WriteStream en modo 'w' (O_WRONLY).
 */
function connectMixPipeOnce(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let sock: fs.WriteStream | null = null
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!ok) {
    try {
      sock?.removeAllListeners('drain')
      sock?.removeAllListeners('open')
      sock?.removeAllListeners('close')
      sock?.removeAllListeners('error')
      sock?.on('error', () => {})
      sock?.destroy()
    } catch {
      /* ignore */
    }
        if (sock && mixSock === sock) mixSock = null
      }
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), 1500)
    try {
      sock = fs.createWriteStream(name, { flags: 'w', autoClose: true, emitClose: true, highWaterMark: 128 * 1024 })
    } catch {
      done(false)
      return
    }
    const stream = sock
    stream.on('open', () => {
      mixSock = stream
      mixBackpressure = false
      mixQueue.vaciar()
      resetMixPcmPace()
      done(true)
    })
    stream.on('error', () => {
      if (!settled) {
        done(false)
        return
      }
      if (mixSock === stream) {
        mixSock = null
        mixBackpressure = false
        if (!mixSuppressReconnect) scheduleMixReconnect()
      }
    })
    stream.on('close', () => {
      if (mixSock === stream) {
        mixSock = null
        mixBackpressure = false
        if (!settled) {
          done(false)
          return
        }
        if (!mixSuppressReconnect) scheduleMixReconnect()
      }
    })
    stream.on('drain', () => {
      mixBackpressure = false
      flushMixPending()
    })
  })
}

async function connectMixPipeUnlocked(pipeName: string, pid?: number): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const name =
    pipeName || (typeof pid === 'number' && pid > 0 ? `\\\\.\\pipe\\jaswave-mix-${pid}` : '')
  if (!name) return false
  // Ya hay socket vivo: no tocar (maxInstances=1 → close+reconnect pelea con el reader).
  if (isMixPipeConnected()) return true
  // Tras un connect OK, ignorar ráfagas de ensure/status unos ms (evita storm).
  if (Date.now() - lastMixConnectOkAt < 400) {
    await sleepMs(80)
    if (isMixPipeConnected()) return true
  }
  closeMixPipe()
  mixPipePath = name
  mixSuppressReconnect = false
  for (let i = 0; i < 12; i++) {
    if (mixSuppressReconnect) return false
    if (isMixPipeConnected()) return true
    const ok = await connectMixPipeOnce(name)
    if (ok) {
      mixReconnectAttempts = 0
      lastMixConnectOkAt = Date.now()
      console.error(`[plugin-host] mix pipe connected ${name}`)
      return true
    }
    await sleepMs(50 + i * 40)
  }
  console.error(`[plugin-host] mix pipe connect FAILED ${name}`)
  return false
}

async function connectMixPipe(pipeName: string, pid?: number): Promise<boolean> {
  while (mixConnectLock) {
    try {
      await mixConnectLock
    } catch {
      /* ignore */
    }
  }
  // Tras esperar, otro caller pudo haber dejado el pipe listo.
  const want =
    pipeName || (typeof pid === 'number' && pid > 0 ? `\\\\.\\pipe\\jaswave-mix-${pid}` : '')
  if (want && isMixPipeConnected() && mixPipePath === want) return true
  const run = connectMixPipeUnlocked(pipeName, pid)
  mixConnectLock = run
  void run.finally(() => {
    if (mixConnectLock === run) mixConnectLock = null
  })
  return run
}

export function isMixPipeConnected(): boolean {
  return !!mixSock && !mixSock.destroyed
}

/** Reconecta el named pipe Soft Pad→ASIO si se cayó (p. ej. tras setAudioDevice). */
export async function ensureMixPipeConnected(): Promise<boolean> {
  if (isMixPipeConnected()) return true
  if (backend !== 'native' || !started || !child?.pid) return false
  mixSuppressReconnect = false
  mixReconnectAttempts = 0
  try {
    const ping = await sendPluginHostCommand({ type: 'ping' }, 3000)
    if (!ping.ok) return false
    const fromPing = String(ping.mixPipe || '')
    const ok = await connectMixPipe(fromPing, child.pid)
    if (ok) return true
    // Fallback: nombre canónico por PID (por si el JSON del ping viene mal escapado).
    const byPid = `\\\\.\\pipe\\jaswave-mix-${child.pid}`
    if (fromPing !== byPid) return await connectMixPipe(byPid, child.pid)
    return false
  } catch {
    return false
  }
}

/** PCM interleaved f32le → named pipe del host.
 * Rate-limit a ~realtime+2 bloques ASIO (evita saturación del ring).
 * Sin cola profunda: encolar JWST distintos desincroniza stems.
 */
export function pushPluginHostPcm(data: Buffer | ArrayBuffer | Float32Array | ArrayBufferView): void {
  if (!mixSock || mixSock.destroyed || !mixSock.writable) return
  let buf: Buffer
  if (Buffer.isBuffer(data)) buf = Buffer.from(data)
  else if (ArrayBuffer.isView(data)) {
    if (data.byteLength === 0) return
    buf = Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  } else {
    buf = Buffer.from(data)
  }
  if (buf.byteLength === 0) return

  const frames = framesInMixPacket(buf)
  if (frames > 0) {
    const now = Date.now()
    if (!mixPaceEpochMs) {
      mixPaceEpochMs = now
      mixPaceFrames = 0
    }
    const elapsedSec = Math.max(0, (now - mixPaceEpochMs) / 1000)
    // Tras freeze UI: resync con catch-up limitado (no 1 frame → underrun eterno).
    if (elapsedSec > 0.35) {
      mixPaceEpochMs = now
      mixPaceFrames = Math.min(frames, mixPaceMaxAhead)
    } else {
      const expected = elapsedSec * mixPaceSr
      if (mixPaceFrames > expected + mixPaceMaxAhead) {
        return
      }
      mixPaceFrames += frames
      if (elapsedSec > 1.25) {
        const ahead = Math.max(0, mixPaceFrames - expected)
        mixPaceEpochMs = now
        mixPaceFrames = Math.min(ahead, mixPaceMaxAhead)
      }
    }
  }

  if (mixBackpressure || mixQueue.length > 0) {
    // Cola elástica acotada por duración: un atasco breve no corta el audio.
    mixQueue.encolar(buf, Math.max(1, frames))
    return
  }
  const ok = writeMixPipe(buf)
  if (!ok) mixBackpressure = true
}

function findUp(startDir: string, relative: string, maxLevels = 10): string | null {
  let dir = startDir
  for (let i = 0; i < maxLevels; i++) {
    const candidate = path.join(dir, relative)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function resolveNativeBinary(): string | null {
  const names =
    process.platform === 'win32'
      ? ['jaswave-plugin-host.exe', 'jaswave-plugin-host']
      : ['jaswave-plugin-host']

  // App empaquetada: SOLO el host incluido en resources (nunca binarios de un árbol de desarrollo
  // cercano, que pueden estar desactualizados o no ser de confianza).
  if (app.isPackaged) {
    for (const name of names) {
      const p = path.join(process.resourcesPath, 'plugin-host', name)
      if (fs.existsSync(p)) return p
    }
    return null
  }

  const relativeDirs = [
    path.join('native', 'plugin-host', 'build-release', 'Release'),
    path.join('native', 'plugin-host', 'build-vs', 'Release'),
    path.join('native', 'plugin-host', 'build-vst3', 'Release'),
    path.join('native', 'plugin-host', 'build-vst3', 'Debug'),
    path.join('native', 'plugin-host', 'build-vst3', 'bin', 'Release'),
    path.join('native', 'plugin-host', 'build-vst3', 'bin', 'Debug'),
    path.join('native', 'plugin-host', 'build', 'Release'),
    path.join('native', 'plugin-host', 'build', 'Debug'),
    path.join('native', 'plugin-host', 'build'),
  ]

  for (const rel of relativeDirs) {
    for (const name of names) {
      const found = findUp(__dirname, path.join(rel, name))
      if (found) return found
    }
  }

  if (process.resourcesPath) {
    for (const name of names) {
      const p = path.join(process.resourcesPath, 'plugin-host', name)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

function resolveNodeHost(): string | null {
  const candidates = [
    findUp(__dirname, path.join('native', 'plugin-host', 'node-host.cjs')),
    findUp(__dirname, path.join('resources', 'plugin-host', 'node-host.cjs')),
    path.join(__dirname, 'plugin-host', 'node-host.cjs'),
    path.join(__dirname, '..', 'plugin-host', 'node-host.cjs'),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'plugin-host', 'node-host.cjs')
      : null,
    (() => {
      try {
        return path.join(app.getAppPath(), 'resources', 'plugin-host', 'node-host.cjs')
      } catch {
        return null
      }
    })(),
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function audioPrefsPath(): string {
  return path.join(app.getPath('userData'), 'audio-device.json')
}

function pluginQuarantinePath(): string {
  return path.join(app.getPath('userData'), 'plugin-crash-quarantine.json')
}

function pluginKey(p: string): string {
  return p.trim().replace(/\//g, '\\').toLowerCase()
}

/** Huella del binario de un plugin (fecha + tamaño del .vst3 o de su DLL interna): cambia al recompilar o actualizar. */
function huellaPlugin(ruta: string): string {
  try {
    let objetivo = ruta
    const st = fs.statSync(ruta)
    if (st.isDirectory()) {
      const dir = path.join(ruta, 'Contents', 'x86_64-win')
      const interno = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /\.vst3$/i.test(f)) : undefined
      if (interno) objetivo = path.join(dir, interno)
    }
    const f = fs.statSync(objetivo)
    return `${Math.round(f.mtimeMs)}:${f.size}`
  } catch {
    return ''
  }
}

/** Huellas guardadas al apartar cada plugin (clave normalizada → huella). */
let huellasCuarentena: Record<string, string> = {}

function loadQuarantine(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(pluginQuarantinePath(), 'utf8')) as { paths?: string[]; huellas?: Record<string, string> }
    huellasCuarentena = { ...(raw.huellas || {}) }
    return new Set((raw.paths || []).map(pluginKey).filter(Boolean))
  } catch {
    huellasCuarentena = {}
    return new Set()
  }
}

function saveQuarantine(set: Set<string>) {
  try {
    fs.mkdirSync(path.dirname(pluginQuarantinePath()), { recursive: true })
    const huellas: Record<string, string> = {}
    for (const k of set) if (huellasCuarentena[k]) huellas[k] = huellasCuarentena[k]!
    fs.writeFileSync(pluginQuarantinePath(), JSON.stringify({ paths: [...set], huellas }, null, 2), 'utf8')
    quarantineFileMtime = quarantineFileStamp()
  } catch (e) {
    console.error('[plugin-host] no se pudo guardar cuarentena de plugins', e)
  }
}

let quarantinedPlugins: Set<string> | null = null
let quarantineFileMtime = 0

function quarantineFileStamp(): number {
  try {
    return fs.statSync(pluginQuarantinePath()).mtimeMs
  } catch {
    return 0
  }
}

function getQuarantine(): Set<string> {
  const stamp = quarantineFileStamp()
  // Si el usuario borró el JSON (o cambió), honrar disco — no quedarse con Set en RAM.
  if (!quarantinedPlugins || stamp !== quarantineFileMtime) {
    quarantinedPlugins = loadQuarantine()
    quarantineFileMtime = stamp
  }
  return quarantinedPlugins
}

/** Aparta un plugin recordando la huella de su binario, para poder rehabilitarlo si cambia. */
function apartarPlugin(ruta: string): void {
  const clave = pluginKey(ruta)
  if (!clave) return
  const q = getQuarantine()
  q.add(clave)
  const h = huellaPlugin(ruta)
  if (h) huellasCuarentena[clave] = h
  saveQuarantine(q)
}

/**
 * ¿Sigue vetado? Un plugin recompilado o actualizado (huella distinta a la de cuando se apartó) vuelve a tener
 * una oportunidad: la cuarentena es por versión del binario, no para siempre.
 */
function estaEnCuarentena(ruta: string): boolean {
  const clave = pluginKey(ruta)
  if (!clave) return false
  const q = getQuarantine()
  if (!q.has(clave)) return false
  const guardada = huellasCuarentena[clave]
  const actual = huellaPlugin(ruta)
  if (guardada && actual && guardada !== actual) {
    q.delete(clave)
    delete huellasCuarentena[clave]
    saveQuarantine(q)
    logLine('info', 'plugin-host', `cuarentena levantada: el binario cambió (${ruta})`)
    return false
  }
  return true
}

/** Aparta un plugin vivo que el watchdog detectó inestable (próximas cargas se rechazan). */
export function ponerPluginEnCuarentena(ruta: string): void {
  apartarPlugin(ruta)
}

const alLimpiarCuarentena = new Set<() => void>()
/** Avisa cuando el usuario limpia la cuarentena (la vigilancia vuelve a empezar de cero). */
export function suscribirLimpiezaCuarentena(cb: () => void): () => void {
  alLimpiarCuarentena.add(cb)
  return () => alLimpiarCuarentena.delete(cb)
}

/** Limpia cuarentena en RAM + disco (reintento de VST tras crash). */
export function clearPluginQuarantine(): { cleared: number } {
  for (const cb of alLimpiarCuarentena) cb()
  const n = getQuarantine().size
  quarantinedPlugins = new Set()
  huellasCuarentena = {}
  quarantineFileMtime = 0
  try {
    if (fs.existsSync(pluginQuarantinePath())) fs.unlinkSync(pluginQuarantinePath())
  } catch {
    /* ignore */
  }
  return { cleared: n }
}

function quarantineMessage(pluginPath: string): string {
  return (
    `«${pluginPath}» tumbó el Plugin Host (protección tipo Ableton/Bitwig: el plugin se aísla y no se recarga). ` +
    `El audio del device se restaura; el mix nativo sigue disponible. ` +
    `Reintenta con el botón «Limpiar cuarentena y reintentar» en la UI del plugin, ` +
    `Configuración → Limpiar cuarentena VST, o borra plugin-crash-quarantine.json.`
  )
}

export function readAudioDevicePrefs(): AudioDevicePrefs | null {
  try {
    const raw = fs.readFileSync(audioPrefsPath(), 'utf8')
    const p = JSON.parse(raw) as AudioDevicePrefs
    if (!p || typeof p !== 'object') return null
    return {
      backend: String(p.backend || 'auto'),
      deviceId: String(p.deviceId || ''),
      sampleRate: Number(p.sampleRate) || 48000,
      bufferSize: Number(p.bufferSize) || 256,
      exclusive: !!p.exclusive,
    }
  } catch {
    return null
  }
}

function applyMixPaceFromPrefs(prefs: AudioDevicePrefs | null | undefined): void {
  if (!prefs) return
  configureMixPcmPace(prefs.sampleRate, prefs.bufferSize)
}

export function writeAudioDevicePrefs(prefs: AudioDevicePrefs): void {
  try {
    fs.mkdirSync(path.dirname(audioPrefsPath()), { recursive: true })
    fs.writeFileSync(audioPrefsPath(), JSON.stringify(prefs, null, 2), 'utf8')
    configureMixPcmPace(prefs.sampleRate, prefs.bufferSize)
  } catch (e) {
    console.error('[plugin-host] no se pudo guardar audio-device.json', e)
  }
}

export function isEditorHostCommand(type: string): boolean {
  return (
    type === 'openEditor' ||
    type === 'openEditorFloating' ||
    type === 'focusEditor' ||
    type === 'closeEditor' ||
    type === 'setEditorBounds'
  )
}

/** Resuelve una petición en vuelo (la indicada por `rid`, o la más antigua si la respuesta no trae id). */
function settlePending(result: PluginHostRpcResult, rid?: number) {
  let key = rid
  if (key === undefined) {
    const oldest = inFlight.keys().next()
    if (oldest.done) return
    key = oldest.value
  }
  const p = inFlight.get(key)
  if (!p) {
    // Respuesta de una petición ya resuelta por timeout: se descarta (antes resolvía la siguiente).
    logLine('info', 'plugin-host', `respuesta tardía descartada (rid=${key})`)
    return
  }
  inFlight.delete(key)
  clearTimeout(p.timer)
  p.resolve(result)
  pumpQueue()
}

/** Resuelve todas las peticiones en vuelo con el mismo resultado (host caído, stdin cerrado). */
function settleAllInFlight(result: PluginHostRpcResult) {
  const all = [...inFlight.values()]
  inFlight.clear()
  for (const p of all) {
    clearTimeout(p.timer)
    p.resolve(result)
  }
}

function onChunk(chunk: Buffer) {
  buffer += chunk.toString('utf8')
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    if (line[0] !== '{') continue
    try {
      const parsed = JSON.parse(line) as PluginHostRpcResult & { type?: string; rid?: unknown; ridEcho?: unknown }
      if (parsed && parsed.type === 'midiIn') continue
      const rid = typeof parsed.rid === 'number' ? parsed.rid : undefined
      if (rid !== undefined || parsed.ridEcho === true) hostEchoesRid = true
      // Con un host que devuelve `rid`, una respuesta sin él es de un comando sin espera (setTrackGraph,
      // setSlotMix… rechazados durante un bounce): no pertenece a ninguna petición en vuelo.
      if (rid === undefined && hostEchoesRid && parsed.ridEcho !== true) {
        if (parsed.ok === false) logLine('info', 'plugin-host', `aviso sin petición: ${String(parsed.message ?? parsed.code ?? '')}`)
        continue
      }
      settlePending(parsed, rid)
    } catch {
      settlePending({
        ok: false,
        code: 'PluginLoadFailed',
        message: `Respuesta no JSON del plugin-host: ${line.slice(0, 120)}`,
      })
    }
  }
}

/** `tNs`: instante QPC (ns) en que el host recibió el evento (mismo reloj para todos los eventos). */
type NativeMidiListener = (msg: { id: string; data: number[]; tNs?: number }) => void
const nativeMidiListeners = new Set<NativeMidiListener>()

export type { AudioDeviceNotice } from './audio-device-notice'

export function subscribeAudioDeviceNotice(cb: (notice: AudioDeviceNotice) => void): () => void {
  audioDeviceNoticeListeners.add(cb)
  return () => audioDeviceNoticeListeners.delete(cb)
}

const audioDeviceNoticeListeners = new Set<(notice: AudioDeviceNotice) => void>()

/** Traduce un aviso del host nativo a un evento para la UI. */
function notifyAudioDevice(notice: AudioDeviceNotice) {
  logLine('warn', 'plugin-host', `audio device ${notice}`)
  for (const l of audioDeviceNoticeListeners) {
    try {
      l(notice)
    } catch {
      /* ignore */
    }
  }
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('jaswave-audio-device-notice', { notice })
    }
  } catch {
    /* ignore */
  }
}

export function subscribeNativeMidi(cb: NativeMidiListener): () => void {
  nativeMidiListeners.add(cb)
  return () => nativeMidiListeners.delete(cb)
}

function emitNativeMidi(id: string, data: number[], tNs?: number) {
  for (const l of nativeMidiListeners) {
    try {
      l(tNs != null ? { id, data, tNs } : { id, data })
    } catch {
      /* ignore */
    }
  }
}

function parseHostLogLine(raw: string) {
  const text = raw.trimEnd()
  const parts = text.split('\n')
  for (const line of parts) {
    const t = line.trim()
    if (t === 'JW_ENGINE_RELEASE_REQUEST') {
      solicitudCederMotor()
      continue
    }
    if (t === 'JW_TRANSPORT_TOGGLE') {
      // Barra espaciadora en la ventana nativa de un plugin: Play/Stop en la ventana principal.
      enviarATodas('host-transport-toggle', {})
      continue
    }
    if (t.startsWith('JW_MIDI ')) {
      try {
        const payload = JSON.parse(t.slice(8)) as { id?: string; data?: number[]; tNs?: number }
        const tNs = typeof payload?.tNs === 'number' && payload.tNs > 0 ? payload.tNs : undefined
        if (payload?.id && Array.isArray(payload.data)) emitNativeMidi(payload.id, payload.data, tNs)
      } catch {
        /* ignore */
      }
      continue
    }
    if (!t) continue
    console.error('[plugin-host]', t)
    // U6: el host avisa de reinicios y pérdidas del dispositivo de audio.
    const notice = parseAudioDeviceNotice(t)
    if (notice) {
      notifyAudioDevice(notice)
      continue
    }
    // Bounce offline y fallos del host: al log persistente (la consola no siempre se captura).
    if (/offline|render|error|fail|crash/i.test(t)) logLine('info', 'plugin-host', t)
  }
}

function wireChild(proc: ChildProcessWithoutNullStreams) {
  buffer = ''
  // Cada proceso nuevo empieza en serie hasta que confirme que devuelve el rid.
  hostEchoesRid = false
  proc.stdout.on('data', onChunk)
  proc.stderr.on('data', (d: Buffer) => {
    parseHostLogLine(d.toString('utf8'))
  })
  // Sin esto, write EPIPE tras muerte del host tumba el main process.
  proc.stdin.on('error', (err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[plugin-host] stdin error:', msg)
    if (child !== proc) return
    closeMixPipe()
    lastError = `Plugin Host stdin: ${msg}`
    failAllRpc(lastError)
  })
  proc.on('error', (err) => {
    console.error('[plugin-host] process error:', err instanceof Error ? err.message : err)
  })
  proc.on('exit', (code, signal) => {
    // El exit del host anterior no debe tumbar el RPC ni el puntero del host nuevo.
    if (child !== proc) return
    started = false
    child = null
    backend = 'none'
    closeMixPipe()
    lastError = `Plugin Host Process salió (code=${code}, signal=${signal})`
    logLine('warn', 'plugin-host', lastError, lastLoadPluginPath ? `último load: ${lastLoadPluginPath}` : '')
    // U7: solo se aparta (cuarentena) el plugin si el host murió con su carga en
    // curso o dentro de su primer bloque en este proceso. Antes bastaba con que
    // el último load fuera reciente y el plugin acababa apartado sin ser culpable.
    const decision = evaluarCuarentena({
      ahora: Date.now(),
      cargaEnCurso: cargaEnCursoActual,
      pluginCargado: pluginCargadoEnProceso,
      cargadoEn: pluginCargadoEn,
      bloqueAbierto: bloquePluginAbierto,
      codigoSalida: signal ? null : code,
    })
    if (decision) {
      const key = pluginKey(decision.plugin)
      if (key && !estaEnCuarentena(decision.plugin)) {
        apartarPlugin(decision.plugin)
        const motivo = mensajeMotivoCuarentena(decision.motivo)
        console.error('[plugin-host] quarantine after host exit:', decision.plugin, motivo)
        logLine('warn', 'plugin-host', `plugin en cuarentena: ${decision.plugin} (${motivo})`)
        lastError = quarantineMessage(decision.plugin)
      }
    } else {
      logLine('info', 'plugin-host', 'sin cuarentena: la muerte del host no es atribuible a un plugin')
    }
    cargaEnCursoActual = null
    pluginCargadoEnProceso = null
    pluginCargadoEn = 0
    bloquePluginAbierto = false
    lastLoadPluginPath = ''
    settleAllInFlight({
      ok: false,
      code: 'HostNotReady',
      message: lastError,
    })
    while (queue.length) {
      const job = queue.shift()!
      job.resolve({ ok: false, code: 'HostNotReady', message: lastError! })
    }
    if (process.env.JASWAVE_DEBUG_PLUGIN_HOST) {
      console.error('[plugin-host]', lastError)
    }
    // Aviso a la UI para rearmar audio (metrónomo / Soft Pad / VSTs).
    try {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('plugin-host-exited', { code, signal })
      }
    } catch {
      /* ignore */
    }
    scheduleAutoRespawnAfterCrash()
  })
}

/** stdin.write que nunca lanza (EPIPE async + sync). */
function writeHostStdin(line: string): boolean {
  if (!child || child.killed || !child.stdin || !child.stdin.writable) return false
  try {
    // write() devuelve false con backpressure (buffer lleno tras lotes grandes, p. ej. clip.load):
    // el dato queda encolado y se envía; NO es stdin cerrado. Los errores reales llegan al callback.
    child.stdin.write(line, (err) => {
      if (!err) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[plugin-host] stdin write callback:', msg)
      closeMixPipe()
      lastError = `Plugin Host stdin: ${msg}`
      failAllRpc(lastError)
    })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[plugin-host] stdin write sync:', msg)
    return false
  }
}

/** Tras crash inesperado: reabrir host (sin matar Electron) + avisar UI. */
function scheduleAutoRespawnAfterCrash() {
  const now = Date.now()
  unexpectedExitTimes = registrarSalidaInesperada(unexpectedExitTimes, now)
  if (hayCrashLoop(unexpectedExitTimes)) {
    lastError =
      'Plugin Host entró en crash-loop (¿plugin incompatible?). Reinicia JasWave o quita el VST problemático.'
    console.error('[plugin-host]', lastError)
    // U7: en vez de rendirse, la UI ofrece "Reiniciar motor" (plugin-host-reset).
    notifyCrashLoop(true, lastError)
    return
  }
  if (autoRespawnTimer) clearTimeout(autoRespawnTimer)
  autoRespawnTimer = setTimeout(() => {
    autoRespawnTimer = null
    void (async () => {
      if (child && !child.killed && started) return
      const ok = await ensurePluginHostStarted()
      if (!ok) return
      const saved = readAudioDevicePrefs()
      applyMixPaceFromPrefs(saved)
      await applyAudioDeviceOrFallback(saved ?? wasapiPrefs(), {
        persist: false,
        sessionFallbackOk: true,
      })
      notifyHostRestarted()
    })()
  }, 500)
}

function spawnNative(bin: string): ChildProcessWithoutNullStreams {
  // windowsHide false: el proceso debe poder crear HWND hijos en la ventana de Electron.
  return spawn(bin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: false,
  })
}

function spawnNodeHost(script: string): ChildProcessWithoutNullStreams {
  // Preferir Electron-as-Node (misma runtime); fallback a `node` del PATH.
  const useSystemNode = process.env.JASWAVE_PLUGIN_HOST_NODE === 'system'
  if (useSystemNode) {
    return spawn('node', [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
  }
  return spawn(process.execPath, [script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
}

function pumpQueue() {
  while (queue.length) {
    const idx = siguienteRpcEnviable(queue, [...inFlight.values()], {
      paralelo: hostEchoesRid,
      maxEnVuelo: MAX_IN_FLIGHT,
    })
    if (idx < 0) return
    if (!dispatchQueued(idx)) return
  }
}

/** Envía el comando `queue[idx]`. Devuelve false si el host no está disponible (cola vaciada). */
function dispatchQueued(idx: number): boolean {
  if (!child || child.killed || !child.stdin.writable) {
    while (queue.length) {
      const job = queue.shift()!
      job.resolve({
        ok: false,
        code: 'HostNotReady',
        message: lastError || 'Plugin Host Process no está en ejecución.',
      })
    }
    return false
  }

  const job = queue.splice(idx, 1)[0]!
  const type = typeof job.cmd.type === 'string' ? job.cmd.type : ''
  const rid = nextRid++
  const timer = setTimeout(() => {
    if (inFlight.get(rid)?.resolve !== job.resolve) return
    const soft =
      type === 'openEditor' ||
      type === 'openEditorFloating' ||
      type === 'listAudioDevices' ||
      type === 'setAudioDevice' ||
      type === 'getAudioDevice' ||
      type === 'testTone' ||
      type === 'ensureAudio' ||
      type === 'asioControlPanel' ||
      type === 'load' ||
      type === 'unload' ||
      type === 'prepare' ||
      type === 'setParameter' ||
      type === 'getPluginState' ||
      type === 'setPluginState' ||
      // Cargar un clip largo (remuestreo) puede tardar: un timeout no debe matar el host ni cortar el audio.
      type === 'clip.load' ||
      type === 'clip.loadBegin' ||
      type === 'clip.loadChunk' ||
      type === 'clip.loadEnd' ||
      type === 'clip.has' ||
      // Pin de editores: un timeout (UI del host ocupada con un editor lento) no debe matar el host.
      type === 'pinEditor' ||
      type === 'setPinsVisible'
    lastError = soft
      ? `Timeout Plugin Host (${type}). El host sigue vivo.`
      : 'Timeout Plugin Host (posible freeze). Proceso de audio detenido; el siguiente ping puede reiniciar.'
    if (soft) {
      // La respuesta tardía de este rid se descartará al llegar (no resuelve otra petición).
      settlePending({ ok: false, code: 'HostNotReady', message: lastError }, rid)
      return
    }
    failAllRpc(lastError)
    killAudioChild()
  }, job.timeoutMs)

  inFlight.set(rid, {
    resolve: job.resolve,
    timer,
    type,
    slotKey: claveSerieRpc(job.cmd),
    barrier: esBarreraRpc(type),
  })
  if (!writeHostStdin(JSON.stringify({ ...job.cmd, rid }) + '\n')) {
    clearTimeout(timer)
    inFlight.delete(rid)
    job.resolve({
      ok: false,
      code: 'HostNotReady',
      message: lastError || 'No se pudo escribir al plugin-host (stdin cerrado)',
    })
  }
  return true
}

/** MIDI sin esperar reply (el host no responde noteOn/noteOff/allNotesOff). */
export function sendPluginHostMidi(cmd: Record<string, unknown>): void {
  if (!child || child.killed || !child.stdin.writable) return
  const type = typeof cmd.type === 'string' ? cmd.type : ''
  if (
    type !== 'noteOn' &&
    type !== 'noteOff' &&
    type !== 'allNotesOff' &&
    type !== 'panic' &&
    type !== 'midiCc' &&
    type !== 'setTransport' &&
    type !== 'setLiveMidiTargets' &&
    type !== 'metronome.set' &&
    type !== 'clip.schedule' &&
    type !== 'clip.stopAll'
  ) {
    return
  }
  try {
    writeHostStdin(JSON.stringify(cmd) + '\n')
  } catch {
    /* ignore */
  }
}

/**
 * Mata hosts huérfanos de arranques previos (su app ya no existe). Nunca el motor de otra instancia
 * viva: matarlo por nombre provocaba el crash-loop cruzado entre instancias (ver host-huerfanos.ts).
 */
async function killOrphanPluginHosts() {
  try {
    const muertos = await matarHostsHuerfanos(child?.pid ? [child.pid] : [])
    if (muertos.length) logLine('info', 'plugin-host', `hosts huérfanos terminados: ${muertos.join(', ')}`)
  } catch {
    /* sin permisos o sin PowerShell: la reserva del motor evita igualmente el doble audio */
  }
}

const ASIO_WRAPPER_RE = /fl studio|generic low latency/i

function asioDriverName(prefs: AudioDevicePrefs): string {
  const raw = prefs.deviceId || ''
  return raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
}

function wasapiPrefs(from?: AudioDevicePrefs): AudioDevicePrefs {
  return {
    backend: 'wasapi',
    deviceId: '',
    sampleRate: from?.sampleRate || 48000,
    bufferSize: from?.bufferSize || 512,
    exclusive: false,
  }
}

function isRiskyAsioPrefs(prefs: AudioDevicePrefs): boolean {
  if (prefs.backend !== 'asio') return false
  const name = asioDriverName(prefs)
  return !name.trim() || name === 'default' || ASIO_WRAPPER_RE.test(name)
}

function isSelfKillMessage(message: string): boolean {
  return /signal=SIGTERM|signal=SIGKILL|reiniciado/i.test(message)
}

let applyLock: Promise<unknown> = Promise.resolve()

async function withApplyLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = applyLock
  let release!: () => void
  applyLock = new Promise<void>((r) => {
    release = r
  })
  await prev.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
  }
}

function shouldReapplySavedPrefs(saved: AudioDevicePrefs): boolean {
  if (isRiskyAsioPrefs(saved)) return false
  if (saved.backend === 'wasapi_exclusive') return false
  if (saved.backend === 'wasapi' && !saved.exclusive) return false
  if (saved.backend === 'asio') return true
  if (saved.backend === 'auto' || !saved.backend) return false
  return true
}

async function respawnNativeHost(): Promise<boolean> {
  logLine('info', 'plugin-host', 'respawn', new Error('origen').stack?.split('\n').slice(2, 5).join(' <- ') ?? '')
  const bin = resolveNativeBinary()
  if (!bin) return false
  // Mientras child es null (kill → spawn) un ensurePluginHostStarted() de la UI lanzaría un segundo host y
  // dejaría dos procesos vivos (el que tiene ASIO se pierde). Se reserva startPromise durante el relevo,
  // salvo que ya lo tenga el arranque en curso (respawn llamado desde doStart).
  let liberar: ((ok: boolean) => void) | null = null
  if (!startPromise) {
    startPromise = new Promise<boolean>((resolve) => {
      liberar = resolve
    })
  }
  let ok = false
  try {
    failAllRpc('Plugin Host Process reiniciado.')
    killAudioChild()
    await sleepMs(80)
    child = spawnNative(bin)
    backend = 'native'
    wireChild(child)
    started = true
    lastError = undefined
    const ping = await sendPluginHostCommand({ type: 'ping' }, 4000)
    if (!ping.ok) {
      lastError = ping.message
      stopPluginHost()
      return false
    }
    await connectMixPipe(String(ping.mixPipe || ''), child?.pid)
    ok = true
    return true
  } finally {
    if (liberar) {
      startPromise = null
      ;(liberar as (ok: boolean) => void)(ok)
    }
  }
}

function notifyHostRestarted() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('plugin-host-restarted', { pid: child?.pid ?? 0 })
    }
  } catch {
    /* ignore */
  }
}

/** U7: avisa a la UI del bucle de fallos del motor (o de que se ha resuelto). */
function notifyCrashLoop(activo: boolean, mensaje?: string) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('plugin-host-crash-loop', { activo, mensaje })
    }
  } catch {
    /* ignore */
  }
}

/**
 * U7: "Reiniciar motor" — limpia el contador de fallos y rearranca el host.
 * No carga plugins: el ciclo de vida los recarga uno a uno al recibir el aviso
 * de reinicio (y los que están en cuarentena siguen apartados).
 */
export async function resetPluginHost(): Promise<{ ok: boolean; message?: string }> {
  unexpectedExitTimes = limpiarSalidas()
  if (autoRespawnTimer) {
    clearTimeout(autoRespawnTimer)
    autoRespawnTimer = null
  }
  lastError = undefined
  const ok = await ensurePluginHostStarted()
  if (!ok) {
    const message = lastError || 'No se pudo reiniciar el motor de audio'
    logLine('warn', 'plugin-host', `reset falló: ${message}`)
    notifyCrashLoop(true, message)
    return { ok: false, message }
  }
  const saved = readAudioDevicePrefs()
  applyMixPaceFromPrefs(saved)
  await applyAudioDeviceOrFallback(saved ?? wasapiPrefs(), {
    persist: false,
    sessionFallbackOk: true,
  })
  logLine('info', 'plugin-host', 'motor de audio reiniciado a mano (contador de fallos limpio)')
  notifyCrashLoop(false)
  notifyHostRestarted()
  return { ok: true }
}

export async function setPluginHostAudioDevice(
  prefs: AudioDevicePrefs,
): Promise<PluginHostRpcResult> {
  return withApplyLock(async () => {
    const ok = await ensurePluginHostStarted()
    if (!ok) {
      return {
        ok: false,
        code: 'HostNotReady',
        message: lastError || 'Plugin Host Process no está en ejecución.',
      }
    }
    if (isRiskyAsioPrefs(prefs)) {
      const fallback = await applyAudioDeviceOrFallback(wasapiPrefs(prefs), { persist: false })
      const why = !prefs.deviceId || prefs.deviceId === 'default'
        ? 'Elige un driver ASIO x64 de tu interfaz; «Predeterminado» no abre ASIO.'
        : `«${prefs.deviceId}» es un wrapper y no se aplica (suele tumbar el host). Audio en WASAPI.`
      if (fallback.ok) {
        return { ok: false, code: 'AudioDeviceFailed', message: why, audio: fallback.audio }
      }
      return { ok: false, code: 'AudioDeviceFailed', message: why }
    }
    return applyAudioDeviceOrFallback(prefs)
  })
}

/**
 * Último fallo de ASIO por dispositivo ausente (interfaz desconectada).
 * Evita el bucle: reintento ASIO → respawn del host (descarga plugins) → falla → WASAPI →
 * la UI reaplica prefs al recibir "host reiniciado" → reintento ASIO…
 */
const ASIO_ABSENT_COOLDOWN_MS = 30_000
let asioAbsent: { deviceId: string; at: number; message: string } | null = null

function isAsioDeviceAbsent(message: string): boolean {
  return /no device is connected|device not (present|connected)|no se encuentra|desconectad/i.test(message)
}

// ── Motor de audio ocupado por otra instancia ────────────────────────────────
// El host reserva el motor de la sesión (objeto con nombre en Windows): si otra JasWave (otro perfil,
// la versión instalada junto a la de desarrollo…) ya lo tiene, esta no abre el driver — antes ambas
// peleaban por el ASIO, el driver tumbaba un host, venía el bucle de reinicios y la cuarentena de
// plugins inocentes. Esta instancia queda sin sonido, lo avisa y reintenta hasta que el motor se libere.
// «Usar audio aquí» (tomarMotorAudio) pide a la dueña que lo ceda sin cerrarse (cederMotorAudio).
const REINTENTO_MOTOR_OCUPADO_MS = 4000
/** Cada cuánto, como mucho, se buscan hosts huérfanos que retengan la reserva (lanza PowerShell). */
const HUERFANOS_CADA_MS = 60_000
/** La ventana que cede tiene este margen para parar el transporte y cerrar una grabación. */
const CEDER_MARGEN_MS = 4000
/** Cuánto espera «Usar audio aquí» a que la otra instancia suelte el motor. */
const TOMAR_ESPERA_MS = 8000
export const MENSAJE_MOTOR_OCUPADO =
  'Otra ventana de JasWave está usando el motor de audio. Esta queda sin sonido: pulsa «Usar audio aquí» para traerlo o cierra la otra y volverá solo.'
export const MENSAJE_MOTOR_CEDIDO =
  'Cediste el motor de audio a otra ventana de JasWave. Pulsa «Usar audio aquí» para recuperarlo.'
let motorOcupado: { prefs: AudioDevicePrefs; cedido: boolean } | null = null
let reintentoMotorTimer: ReturnType<typeof setTimeout> | null = null
let ultimaBusquedaHuerfanos = 0
let cesionEnCurso: Promise<{ ok: boolean; message?: string }> | null = null
let cesionTimer: ReturnType<typeof setTimeout> | null = null

export function audioEngineBusy(): boolean {
  return motorOcupado != null
}

function mensajeMotorOcupado(): string {
  return motorOcupado?.cedido ? MENSAJE_MOTOR_CEDIDO : MENSAJE_MOTOR_OCUPADO
}

function enviarATodas(canal: string, datos: unknown) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(canal, datos)
    }
  } catch {
    /* ignore */
  }
}

function notifyAudioEngineBusy(activo: boolean) {
  enviarATodas('audio-engine-busy', { activo, mensaje: activo ? mensajeMotorOcupado() : undefined })
}

function marcarMotorOcupado(prefs: AudioDevicePrefs, cedido = false): PluginHostRpcResult {
  const nuevo = !motorOcupado || motorOcupado.cedido !== cedido
  if (!motorOcupado) {
    logLine('warn', 'plugin-host', cedido
      ? 'motor de audio cedido a otra instancia: esta queda sin sonido'
      : 'motor de audio ocupado por otra instancia: esta queda sin sonido y reintenta')
  }
  motorOcupado = { prefs, cedido: cedido || (motorOcupado?.cedido ?? false) }
  if (nuevo) notifyAudioEngineBusy(true)
  programarReintentoMotor()
  return { ok: false, code: 'AudioEngineBusy', message: mensajeMotorOcupado() }
}

function liberarMarcaMotorOcupado() {
  if (!motorOcupado) return
  motorOcupado = null
  if (reintentoMotorTimer) clearTimeout(reintentoMotorTimer)
  reintentoMotorTimer = null
  logLine('info', 'plugin-host', 'motor de audio recuperado')
  notifyAudioEngineBusy(false)
}

function programarReintentoMotor() {
  if (reintentoMotorTimer) return
  reintentoMotorTimer = setTimeout(() => {
    reintentoMotorTimer = null
    const pendiente = motorOcupado
    if (!pendiente) return
    void withApplyLock(async () => {
      // Host caído: el auto-respawn vuelve a aplicar el dispositivo (y pasa otra vez por aquí).
      if (!child || !started) {
        programarReintentoMotor()
        return
      }
      // Si la reserva la tiene un host colgado cuya app ya cerró, se libera aquí (sin lanzar PowerShell a cada vuelta).
      if (Date.now() - ultimaBusquedaHuerfanos > HUERFANOS_CADA_MS) {
        ultimaBusquedaHuerfanos = Date.now()
        await killOrphanPluginHosts()
      }
      await applyAudioDeviceOrFallback(pendiente.prefs, { persist: false, sessionFallbackOk: true })
    })
  }, REINTENTO_MOTOR_OCUPADO_MS)
}

/**
 * Otra instancia pidió el motor (el host lo avisa por stderr). La UI para el transporte y cierra una toma en
 * curso y después llama a `cederMotorAudio`; si no contesta a tiempo, se cede igualmente.
 */
function solicitudCederMotor() {
  if (motorOcupado || cesionEnCurso) return
  logLine('info', 'plugin-host', 'otra instancia pidió el motor de audio')
  enviarATodas('audio-engine-release-requested', {})
  if (cesionTimer) clearTimeout(cesionTimer)
  cesionTimer = setTimeout(() => {
    cesionTimer = null
    void cederMotorAudio()
  }, CEDER_MARGEN_MS)
}

/** Suelta dispositivo y reserva sin cerrar el host: los plugins siguen cargados para cuando vuelva. */
export function cederMotorAudio(): Promise<{ ok: boolean; message?: string }> {
  if (cesionTimer) {
    clearTimeout(cesionTimer)
    cesionTimer = null
  }
  if (motorOcupado) return Promise.resolve({ ok: true })
  cesionEnCurso ??= withApplyLock(async () => {
    const prefs = readAudioDevicePrefs() ?? wasapiPrefs()
    const r = await sendPluginHostCommand({ type: 'releaseAudioEngine' }, 8000)
    if (!r.ok) {
      logLine('warn', 'plugin-host', `no se pudo ceder el motor: ${r.message}`)
      return { ok: false, message: r.message }
    }
    marcarMotorOcupado(prefs, true)
    return { ok: true }
  }).finally(() => {
    cesionEnCurso = null
  })
  return cesionEnCurso
}

/** «Usar audio aquí»: pide el motor a la instancia que suena, espera a que lo suelte y abre el dispositivo. */
export async function tomarMotorAudio(): Promise<{ ok: boolean; message?: string }> {
  const pendiente = motorOcupado
  if (!pendiente) return { ok: true }
  const pedido = await sendPluginHostCommand({ type: 'requestAudioEngine' }, 4000)
  if (!pedido.ok) return { ok: false, message: pedido.message }
  const limite = Date.now() + TOMAR_ESPERA_MS
  for (;;) {
    await sleepMs(200)
    const reserva = await sendPluginHostCommand({ type: 'acquireAudioEngine' }, 4000)
    if (reserva.ok) break
    if (Date.now() > limite) {
      return {
        ok: false,
        message:
          'La otra ventana de JasWave no soltó el motor (puede ser una versión anterior sin traspaso). Ciérrala para usar el audio aquí.',
      }
    }
  }
  const r = await withApplyLock(() =>
    applyAudioDeviceOrFallback(pendiente.prefs, { persist: false, sessionFallbackOk: true }),
  )
  if (!r.ok) return { ok: false, message: r.message }
  logLine('info', 'plugin-host', 'motor de audio traído a esta instancia')
  return { ok: true }
}

async function applyAudioDeviceOrFallback(
  prefs: AudioDevicePrefs,
  opts?: { sessionFallbackOk?: boolean; persist?: boolean },
): Promise<PluginHostRpcResult> {
  // Reserva antes de tocar el driver. Un host sin el comando (binario viejo) responde otro código y se sigue.
  const reserva = await sendPluginHostCommand({ type: 'acquireAudioEngine' }, 6000)
  if (!reserva.ok && reserva.code === 'AudioEngineBusy') return marcarMotorOcupado(prefs)
  const r = await aplicarDispositivoAudio(prefs, opts)
  if (!r.ok && r.code === 'AudioEngineBusy') return marcarMotorOcupado(prefs)
  if (r.ok || r.audio?.running) liberarMarcaMotorOcupado()
  return r
}

async function aplicarDispositivoAudio(
  prefs: AudioDevicePrefs,
  opts?: { sessionFallbackOk?: boolean; persist?: boolean },
): Promise<PluginHostRpcResult> {
  const persist = opts?.persist !== false

  if (
    prefs.backend === 'asio' &&
    asioAbsent &&
    asioAbsent.deviceId === String(prefs.deviceId || '') &&
    Date.now() - asioAbsent.at < ASIO_ABSENT_COOLDOWN_MS
  ) {
    // Interfaz ausente hace segundos: WASAPI sin reiniciar el host ni persistir (las prefs ASIO se conservan).
    const fallback = await applyAudioDeviceOrFallback(wasapiPrefs(prefs), { persist: false })
    const msg = `${asioAbsent.message} Audio en WASAPI (se reintentará ASIO al reconectar la interfaz).`
    if (fallback.ok && opts?.sessionFallbackOk) return { ...fallback, message: msg }
    return { ok: false, code: 'AudioDeviceFailed', message: msg, audio: fallback.audio }
  }

  if (prefs.backend === 'asio' && !isRiskyAsioPrefs(prefs)) {
    const current = await sendPluginHostCommand({ type: 'getAudioDevice' }, 8000)
    let didRespawn = false
    if (current.ok && current.audio?.running) {
      const a = current.audio
      const sameDevice =
        String(a.backend || '') === 'asio' &&
        String(a.deviceId || '') === String(prefs.deviceId || '') &&
        Number(a.sampleRate || 0) === Number(prefs.sampleRate || 0) &&
        Number(a.bufferSize || 0) === Number(prefs.bufferSize || 0)
      if (sameDevice) {
        if (persist) writeAudioDevicePrefs(prefs)
        await ensureMixPipeConnected()
        return current
      }
      console.error(
        '[plugin-host] ASIO: se abre en proceso limpio (como REAPER), sin WASAPI previo en la tarjeta.',
      )
      if (!(await respawnNativeHost())) {
        return { ok: false, code: 'HostNotReady', message: lastError || 'No se pudo reiniciar el host.' }
      }
      didRespawn = true
    }
    const applied = await sendPluginHostCommand(
      {
        type: 'setAudioDevice',
        backend: prefs.backend,
        deviceId: prefs.deviceId,
        sampleRate: prefs.sampleRate,
        bufferSize: prefs.bufferSize,
        exclusive: false,
      },
      20_000,
    )
    if (applied.ok) {
      asioAbsent = null
      if (persist) writeAudioDevicePrefs(prefs)
      await ensureMixPipeConnected()
      // Solo avisar a la UI si el proceso murió: si no, forgetHostPlugins tumba el MIDI en play.
      if (didRespawn) notifyHostRestarted()
      return applied
    }
    // Otra instancia tiene el motor: ni reintento, ni respawn, ni WASAPI (fallarían igual y tocarían las prefs).
    if (applied.code === 'AudioEngineBusy') return applied
    console.error('[plugin-host] setAudioDevice ASIO falló:', applied.message)
    if (isAsioDeviceAbsent(String(applied.message || ''))) {
      asioAbsent = { deviceId: String(prefs.deviceId || ''), at: Date.now(), message: String(applied.message) }
    }
    if (isSelfKillMessage(String(applied.message || ''))) {
      const alive = await sendPluginHostCommand({ type: 'ping' }, 4000)
      if (alive.ok) {
        const retry = await sendPluginHostCommand(
          {
            type: 'setAudioDevice',
            backend: prefs.backend,
            deviceId: prefs.deviceId,
            sampleRate: prefs.sampleRate,
            bufferSize: prefs.bufferSize,
            exclusive: false,
          },
          20_000,
        )
        if (retry.ok) {
          if (persist) writeAudioDevicePrefs(prefs)
          await ensureMixPipeConnected()
          if (didRespawn) notifyHostRestarted()
          return retry
        }
      }
    }
    const crashed = /salió \(code=/.test(String(applied.message || '')) &&
      !isSelfKillMessage(String(applied.message || ''))
    if (crashed) {
      if (!(await respawnNativeHost())) {
        return { ...applied, ok: false, code: 'HostNotReady' }
      }
    }
    const second = await sendPluginHostCommand({ type: 'setAudioDevice', ...wasapiPrefs(prefs) }, 20_000)
    const msg = `${applied.message || 'ASIO no se pudo abrir.'} Audio en WASAPI.`
    if (second.ok) {
      writeAudioDevicePrefs(wasapiPrefs(prefs))
      if (didRespawn) notifyHostRestarted()
    }
    if (second.ok && opts?.sessionFallbackOk) {
      return { ...second, ok: true, message: msg }
    }
    return {
      ok: false,
      code: 'AudioDeviceFailed',
      message: msg,
      audio: second.ok ? second.audio : applied.audio,
    }
  }

  const current = await sendPluginHostCommand({ type: 'getAudioDevice' }, 8000)
  const alreadySharedWasapi =
    current.ok &&
    current.audio?.running &&
    current.audio.backend === 'wasapi' &&
    !current.audio.exclusive
  // Solo se reutiliza si es la misma salida: elegir otra WASAPI la abre (antes se ignoraba y se guardaba la vieja).
  const mismaSalida =
    !prefs.deviceId || prefs.deviceId === 'default' || prefs.deviceId === String(current.audio?.deviceId || '')
  if (alreadySharedWasapi && wantsSharedWasapi(prefs) && mismaSalida) {
    if (persist) {
      writeAudioDevicePrefs({
        backend: 'wasapi',
        deviceId: current.audio?.deviceId || prefs.deviceId || '',
        sampleRate: current.audio?.sampleRate || prefs.sampleRate,
        bufferSize: current.audio?.bufferSize || prefs.bufferSize,
        exclusive: false,
      })
    }
    return {
      ...current,
      ok: true,
      message: 'WASAPI compartido ya está abierto; no se reinicia el device.',
    }
  }

  const applied = await sendPluginHostCommand(
    {
      type: 'setAudioDevice',
      backend: prefs.backend,
      deviceId: prefs.deviceId,
      sampleRate: prefs.sampleRate,
      bufferSize: prefs.bufferSize,
      exclusive: !!prefs.exclusive,
    },
    20_000,
  )
  if (applied.ok) {
    if (persist) writeAudioDevicePrefs(prefs)
    return applied
  }
  if (applied.code === 'AudioEngineBusy') return applied
  console.error('[plugin-host] setAudioDevice falló:', applied.message)

  const crashed = /salió \(code=/.test(String(applied.message || ''))
  const fallback = wasapiPrefs(prefs)

  if (!crashed && applied.audio?.running) {
    return {
      ok: false,
      code: 'AudioDeviceFailed',
      message: `${applied.message || 'No se pudo abrir el driver.'} Audio restaurado en ${applied.audio.backend}.`,
      audio: applied.audio,
    }
  }

  const openWasapi = async (): Promise<PluginHostRpcResult> => {
    const second = await sendPluginHostCommand({ type: 'setAudioDevice', ...fallback }, 20_000)
    if (!second.ok) return second
    const msg = `${applied.message || 'No se pudo abrir el driver.'} Audio en WASAPI.`
    if (opts?.sessionFallbackOk) {
      return { ...second, ok: true, message: msg }
    }
    return {
      ok: false,
      code: 'AudioDeviceFailed',
      message: `${msg} Elige WASAPI o el ASIO x64 de tu interfaz y pulsa Aplicar.`,
      audio: second.audio,
    }
  }

  if (crashed) {
    console.error('[plugin-host] host muerto al aplicar driver; respawn → WASAPI')
    if (!(await respawnNativeHost())) {
      return { ...applied, ok: false, code: 'HostNotReady' }
    }
    return openWasapi()
  }

  if (prefs.backend !== 'wasapi' || prefs.exclusive) {
    return openWasapi()
  }
  return applied
}

async function tryStart(kind: 'native' | 'node'): Promise<boolean> {
  logLine('info', 'plugin-host', `start ${kind}`, new Error('origen').stack?.split('\n').slice(2, 5).join(' <- ') ?? '')
  stopPluginHost()
  if (kind === 'native') await killOrphanPluginHosts()

  if (kind === 'native') {
    const bin = resolveNativeBinary()
    if (!bin) return false
    child = spawnNative(bin)
    backend = 'native'
  } else {
    const script = resolveNodeHost()
    if (!script) {
      lastError = 'node-host.cjs no encontrado'
      return false
    }
    child = spawnNodeHost(script)
    backend = 'node'
  }

  wireChild(child)
  started = true
  lastError = undefined

  const ping = await sendPluginHostCommand({ type: 'ping' }, 4000)
  if (!ping.ok) {
    lastError = ping.message
    stopPluginHost()
    return false
  }
  if (kind === 'native') {
    const mixPipe = ping.mixPipe || ''
    await connectMixPipe(mixPipe, child?.pid)
    const saved = readAudioDevicePrefs()
    applyMixPaceFromPrefs(saved)
    let applied: PluginHostRpcResult
    if (saved && saved.backend === 'asio' && !isRiskyAsioPrefs(saved)) {
      // Como REAPER: ASIO en host virgen, sin abrir WASAPI antes en la misma tarjeta.
      applied = await applyAudioDeviceOrFallback(saved, { sessionFallbackOk: true, persist: true })
    } else {
      const listed = await sendPluginHostCommand({ type: 'listAudioDevices' }, 12_000)
      const preferredWasapi = pickPreferredWasapi(listed.ok ? listed.devices : undefined, saved)
      applied = await applyAudioDeviceOrFallback(preferredWasapi, {
        sessionFallbackOk: true,
        persist: !saved,
      })
      if (applied.ok && saved && shouldReapplySavedPrefs(saved)) {
        applied = await applyAudioDeviceOrFallback(saved, { sessionFallbackOk: true })
      } else if (applied.ok && applied.audio) {
        writeAudioDevicePrefs({
          backend: 'wasapi',
          deviceId: applied.audio.deviceId || preferredWasapi.deviceId,
          sampleRate: applied.audio.sampleRate || preferredWasapi.sampleRate,
          bufferSize: applied.audio.bufferSize || preferredWasapi.bufferSize,
          exclusive: false,
        })
      }
    }
    // Reconectar pipe al host vivo tras setAudioDevice (evita pipe de un spawn anterior).
    if (applied.ok && child?.pid) {
      const ping3 = await sendPluginHostCommand({ type: 'ping' }, 4000)
      if (ping3.ok) {
        await connectMixPipe(String(ping3.mixPipe || ''), child.pid)
      }
      notifyHostRestarted()
    }
    if (!applied.ok) {
      console.error('[plugin-host] audio al arrancar no disponible:', applied.message)
    }
  }
  return true
}

async function doStart(): Promise<boolean> {
  const force = process.env.JASWAVE_PLUGIN_HOST
  // Con SDK compilado preferimos nativo (audio + editor embed).
  const nativeBin = resolveNativeBinary()
  const order: Array<'native' | 'node'> =
    force === 'node'
      ? ['node']
      : force === 'native'
        ? ['native', 'node']
        : nativeBin
          ? ['native', 'node']
          : ['node', 'native']

  for (const kind of order) {
    try {
      if (await tryStart(kind)) return true
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      stopPluginHost()
    }
  }
  backend = 'none'
  started = false
  return false
}

export function getPluginHostStatus() {
  return {
    isolationPolicy: 'hybrid' as const,
    builtinInProcess: true,
    thirdPartyOutOfProcess: true,
    vst3HostProcessAvailable: started && !!child && !child.killed,
    vst3EditorAvailable: backend === 'native',
    vst3AudioAvailable: backend === 'native',
    mixPipeConnected: isMixPipeConnected(),
    mixQueueDepth: mixQueue.length,
    mixQueueDropped: mixQueue.descartados,
    mixBackpressure,
    mixPipePath: mixPipePath || '',
    nativePid: child?.pid ?? 0,
    openEditors: 0,
    backend,
    lastError,
    note:
      backend === 'native'
        ? 'Plugin Host nativo: misma instancia UI+audio. Mixer DAW (clips/Roles) + VST en el device elegido.'
        : backend === 'node'
          ? 'Plugin Host Node (solo discovery). Compila build-vst3 para audio/UI nativa.'
          : lastError
            ? `Plugin Host no iniciado: ${lastError}`
            : 'Plugin Host Process no iniciado.',
  }
}

export function ensurePluginHostStarted(): Promise<boolean> {
  if (startPromise) return startPromise
  // Si estamos en node-host (solo discover) pero hay binario nativo, subir a native.
  if (child && !child.killed && started) {
    if (backend === 'native') return Promise.resolve(true)
    if (backend === 'node' && resolveNativeBinary() && process.env.JASWAVE_PLUGIN_HOST !== 'node') {
      stopPluginHost()
    } else {
      return Promise.resolve(true)
    }
  }
  startPromise = doStart().finally(() => {
    startPromise = null
  })
  return startPromise
}

function killAudioChild() {
  cancelMixReconnect()
  closeMixPipe()
  const proc = child
  child = null
  started = false
  backend = 'none'
  buffer = ''
  if (proc && !proc.killed) {
    try {
      proc.stdin.end()
      proc.kill()
    } catch {
      /* ignore */
    }
  }
}

function failAllRpc(reason: string) {
  settleAllInFlight({ ok: false, code: 'HostNotReady', message: reason })
  while (queue.length) {
    const job = queue.shift()!
    job.resolve({ ok: false, code: 'HostNotReady', message: reason })
  }
}

export function stopPluginHost() {
  if (autoRespawnTimer) {
    clearTimeout(autoRespawnTimer)
    autoRespawnTimer = null
  }
  const reason = lastError || 'Plugin Host Process detenido.'
  failAllRpc(reason)
  killAudioChild()
}

export function sendPluginHostCommand(
  cmd: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<PluginHostRpcResult> {
  const type = cmd.type
  if (type !== 'ensureAudio' && type !== 'testTone') return enviarComandoHost(cmd, timeoutMs)
  // Motor en manos de otra instancia: no se encola un arranque de dispositivo que fallará igual.
  if (motorOcupado) {
    return Promise.resolve({ ok: false, code: 'AudioEngineBusy', message: MENSAJE_MOTOR_OCUPADO })
  }
  return enviarComandoHost(cmd, timeoutMs).then((r) => {
    if (!r.ok && r.code === 'AudioEngineBusy') return marcarMotorOcupado(readAudioDevicePrefs() ?? wasapiPrefs())
    return r
  })
}

function enviarComandoHost(cmd: Record<string, unknown>, timeoutMs: number): Promise<PluginHostRpcResult> {
  const type = typeof cmd.type === 'string' ? cmd.type : ''
  if (type === 'clearPluginQuarantine') {
    const r = clearPluginQuarantine()
    return Promise.resolve({
      ok: true,
      processId: 'jaswave-plugin-host',
      message: `Cuarentena limpia (${r.cleared} plugins)`,
      count: r.cleared,
    })
  }

  const long =
    type === 'load' ||
    type === 'prepare' ||
    type === 'setAudioDevice' ||
    type === 'listAudioDevices' ||
    type === 'ensureAudio' ||
    type === 'listParameters' ||
    // Estado/parámetros de samplers pesados: un timeout corto mataba el host y todos los plugins.
    type === 'getPluginState' ||
    type === 'setPluginState' ||
    type === 'setParameter' ||
    type === 'getSlotStats' ||
    type === 'unload' ||
    type === 'openEditor' ||
    type === 'clip.load' ||
    type === 'clip.loadEnd'
      ? Math.max(timeoutMs, 90_000)
      : timeoutMs

  // MIDI: host no responde — no usar la cola RPC (bloquearía load/ping).
  if (type === 'noteOn' || type === 'noteOff' || type === 'allNotesOff' || type === 'panic' || type === 'midiCc' || type === 'setTransport' || type === 'setMixInputRate' || type === 'setSlotMix' || type === 'setMasterMix' || type === 'setMonitorMix' || type === 'setMasterSafety' || type === 'setTrackGraph' || type === 'setMeterTrackOrder' || type === 'setLiveMidiTargets' || type === 'metronome.set' || type === 'clip.schedule' || type === 'clip.stopAll') {
    if (type === 'noteOn' || type === 'noteOff' || type === 'allNotesOff' || type === 'panic' || type === 'midiCc' || type === 'setTransport' || type === 'setLiveMidiTargets' || type === 'metronome.set' || type === 'clip.schedule' || type === 'clip.stopAll') {
      sendPluginHostMidi(cmd)
      return Promise.resolve({
        ok: true,
        processId: 'jaswave-plugin-host',
        slotId: String(cmd.slotId ?? ''),
      })
    }
    if (child && !child.killed && child.stdin.writable) {
      writeHostStdin(JSON.stringify(cmd) + '\n')
    }
    return Promise.resolve({ ok: true, processId: 'jaswave-plugin-host' })
  }

  const enqueueRaw = () =>
    new Promise<PluginHostRpcResult>((resolve) => {
      queue.push({ cmd, timeoutMs: long, resolve })
      pumpQueue()
    })
  // Sondeos (reloj, medidores): si ya hay uno igual en cola o en vuelo se comparte su respuesta, así no
  // se acumulan detrás de una operación lenta (load, getPluginState…) ni retrasan el resto de la cola.
  const sondeo = type === 'getTransportClock' || type === 'getMixMeters'
  const sondeoKey = sondeo ? JSON.stringify(cmd) : ''
  const enqueue = () => {
    if (!sondeo) return enqueueRaw()
    const previo = sondeosEnCurso.get(sondeoKey)
    if (previo) return previo
    const p = enqueueRaw().finally(() => sondeosEnCurso.delete(sondeoKey))
    sondeosEnCurso.set(sondeoKey, p)
    return p
  }

  // U7: marcar la carga en vuelo (para saber a quién culpar si el host muere).
  if (type === 'load' || type === 'prepare') {
    const ruta =
      type === 'load'
        ? String(cmd.path || '')
        : slotPluginPath.get(String(cmd.slotId ?? '')) || ''
    if (ruta) cargaEnCursoActual = { tipo: type, ruta }
  }

  if (type === 'load' || type === 'openEditor') {
    const pluginPath = String(cmd.path || '')
    const key = pluginKey(pluginPath)
    if (type === 'load' && pluginPath) {
      lastLoadPluginPath = pluginPath
    }
    if (type === 'load' && /\.dll$/i.test(pluginPath)) {
      return Promise.resolve({
        ok: false,
        processId: 'jaswave-plugin-host',
        code: 'Vst2Deprecated',
        message: 'JasWave soporta exclusivamente plugins VST3 (.vst3). El soporte de plugins legacy VST2 (.dll) fue retirado para garantizar la estabilidad del motor.',
      })
    }
    if (key && estaEnCuarentena(pluginPath)) {
      return Promise.resolve({
        ok: false,
        code: 'PluginCrashedHost',
        message: quarantineMessage(pluginPath),
      })
    }
    return enqueue().then(async (result) => {
      if (result.ok) {
        if (type === 'load') {
          lastLoadPluginPath = ''
          // U7: el plugin entra en su primer bloque dentro de este proceso.
          abrirPrimerBloquePlugin(pluginPath, result.slotId)
        }
        return result
      }
      const msg = String(result.message || '')
      const crashed =
        /salió \(code=/.test(msg) ||
        /Plugin Host stdin/i.test(msg) ||
        /tumbó el Plugin Host/i.test(msg) ||
        result.code === 'PluginCrashedHost'
      if (!crashed) return result
      if (key) apartarPlugin(pluginPath)
      console.error('[plugin-host] plugin firewall (Ableton-style):', pluginPath, result.message)
      // El exit handler ya programa auto-respawn; solo forzar si aún no hay host.
      if (!child || child.killed || !started) {
        if (autoRespawnTimer) {
          clearTimeout(autoRespawnTimer)
          autoRespawnTimer = null
        }
        await respawnNativeHost()
        // Restaurar device preferido (ASIO), no forzar WASAPI — Soft Pad necesita mix pipe.
        const saved = readAudioDevicePrefs()
        await applyAudioDeviceOrFallback(saved ?? wasapiPrefs(), {
          persist: false,
          sessionFallbackOk: true,
        })
        notifyHostRestarted()
      }
      return {
        ok: false as const,
        code: 'PluginCrashedHost',
        message: quarantineMessage(pluginPath || 'plugin VST3'),
      }
    }).finally(() => {
      if (cargaEnCursoActual?.tipo === 'load') cargaEnCursoActual = null
    })
  }

  return enqueue().finally(() => {
    if (cargaEnCursoActual?.tipo === 'prepare') cargaEnCursoActual = null
  })
}

/**
 * U7: el plugin acaba de cargarse en este proceso → abre su "primer bloque".
 * Si el host muere dentro de esa ventana, el plugin es el sospechoso.
 */
function abrirPrimerBloquePlugin(pluginPath: string, slotId?: string): void {
  if (!pluginPath) return
  pluginCargadoEnProceso = pluginPath
  pluginCargadoEn = Date.now()
  bloquePluginAbierto = true
  if (slotId) slotPluginPath.set(slotId, pluginPath)
  if (bloquePluginTimer) clearTimeout(bloquePluginTimer)
  bloquePluginTimer = setTimeout(() => {
    bloquePluginTimer = null
    bloquePluginAbierto = false
  }, VENTANA_PRIMER_BLOQUE_MS)
}
