/**
 * Electron main: Plugin Host Process (ADR-0011 C).
 *
 * VST3: misma instancia para process() y createView (UI nativa).
 * Device de audio: WASAPI / Exclusive / DirectSound / WinMM / ASIO (seleccionable).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app, BrowserWindow } from 'electron'

export type AudioDevicePrefs = {
  backend: string
  deviceId: string
  sampleRate: number
  bufferSize: number
  exclusive?: boolean
}

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
}

type QueuedCmd = {
  cmd: Record<string, unknown>
  timeoutMs: number
  resolve: (v: PluginHostRpcResult) => void
}

let child: ChildProcessWithoutNullStreams | null = null
let buffer = ''
let pending: Pending | null = null
const queue: QueuedCmd[] = []
let started = false
let backend: 'native' | 'node' | 'none' = 'none'
let startPromise: Promise<boolean> | null = null
let lastError: string | undefined
/** Último `load` (para cuarentena si el host muere justo después). */
let lastLoadPluginPath = ''
let lastLoadPluginAt = 0
let unexpectedExitTimes: number[] = []
let autoRespawnTimer: ReturnType<typeof setTimeout> | null = null
let mixSock: fs.WriteStream | null = null
let mixBackpressure = false
let mixPipePath = ''
let mixQueue: Buffer[] = []
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
  mixQueue = []
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
        mixQueue = []
      }
      if (!mixSuppressReconnect) scheduleMixReconnect()
    })
  } catch {
    if (mixSock === s) {
      mixSock = null
      mixBackpressure = false
      mixQueue = []
    }
    if (!mixSuppressReconnect) scheduleMixReconnect()
    return false
  }
}

function flushMixPending() {
  if (!mixSock || mixSock.destroyed || !mixSock.writable) {
    mixQueue = []
    return
  }
  while (mixQueue.length) {
    const p = mixQueue[0]!
    const ok = writeMixPipe(p)
    mixQueue.shift()
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
      sock = fs.createWriteStream(name, { flags: 'w', autoClose: true, emitClose: true })
    } catch {
      done(false)
      return
    }
    const stream = sock
    stream.on('open', () => {
      mixSock = stream
      mixBackpressure = false
      mixQueue = []
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
    // No crecer la cola: un solo pendiente como máximo.
    if (mixQueue.length === 0) mixQueue.push(buf)
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

  const relativeDirs = [
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

function loadQuarantine(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(pluginQuarantinePath(), 'utf8')) as { paths?: string[] }
    return new Set((raw.paths || []).map(pluginKey).filter(Boolean))
  } catch {
    return new Set()
  }
}

function saveQuarantine(set: Set<string>) {
  try {
    fs.mkdirSync(path.dirname(pluginQuarantinePath()), { recursive: true })
    fs.writeFileSync(pluginQuarantinePath(), JSON.stringify({ paths: [...set] }, null, 2), 'utf8')
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

/** Limpia cuarentena en RAM + disco (reintento de VST tras crash). */
export function clearPluginQuarantine(): { cleared: number } {
  const n = getQuarantine().size
  quarantinedPlugins = new Set()
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
    `El audio del device se restaura; el mix nativo sigue disponible. Para reintentarlo: audio.clearQuarantine o borra plugin-crash-quarantine.json.`
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

function settlePending(result: PluginHostRpcResult) {
  if (!pending) return
  clearTimeout(pending.timer)
  const p = pending
  pending = null
  p.resolve(result)
  pumpQueue()
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
      const parsed = JSON.parse(line) as PluginHostRpcResult & { type?: string }
      if (parsed && parsed.type === 'midiIn') continue
      settlePending(parsed)
    } catch {
      settlePending({
        ok: false,
        code: 'PluginLoadFailed',
        message: `Respuesta no JSON del plugin-host: ${line.slice(0, 120)}`,
      })
    }
  }
}

type NativeMidiListener = (msg: { id: string; data: number[] }) => void
const nativeMidiListeners = new Set<NativeMidiListener>()

export function subscribeNativeMidi(cb: NativeMidiListener): () => void {
  nativeMidiListeners.add(cb)
  return () => nativeMidiListeners.delete(cb)
}

function emitNativeMidi(id: string, data: number[]) {
  for (const l of nativeMidiListeners) {
    try {
      l({ id, data })
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
    if (t.startsWith('JW_MIDI ')) {
      try {
        const payload = JSON.parse(t.slice(8)) as { id?: string; data?: number[] }
        if (payload?.id && Array.isArray(payload.data)) emitNativeMidi(payload.id, payload.data)
      } catch {
        /* ignore */
      }
      continue
    }
    if (t) console.error('[plugin-host]', t)
  }
}

function wireChild(proc: ChildProcessWithoutNullStreams) {
  buffer = ''
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
    // Si un load reciente tumba el host (p.ej. 4Front Bass), aislar el plugin.
    if (lastLoadPluginPath && Date.now() - lastLoadPluginAt < 20_000) {
      const key = pluginKey(lastLoadPluginPath)
      if (key && !getQuarantine().has(key)) {
        getQuarantine().add(key)
        saveQuarantine(getQuarantine())
        console.error('[plugin-host] quarantine after host exit:', lastLoadPluginPath)
        lastError = quarantineMessage(lastLoadPluginPath)
      }
      lastLoadPluginPath = ''
    }
    settlePending({
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
    return child.stdin.write(line, (err) => {
      if (!err) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[plugin-host] stdin write callback:', msg)
      closeMixPipe()
      lastError = `Plugin Host stdin: ${msg}`
      failAllRpc(lastError)
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[plugin-host] stdin write sync:', msg)
    return false
  }
}

/** Tras crash inesperado: reabrir host (sin matar Electron) + avisar UI. */
function scheduleAutoRespawnAfterCrash() {
  const now = Date.now()
  unexpectedExitTimes = unexpectedExitTimes.filter((t) => now - t < 60_000)
  unexpectedExitTimes.push(now)
  if (unexpectedExitTimes.length >= 4) {
    lastError =
      'Plugin Host entró en crash-loop (¿plugin incompatible?). Reinicia JasWave o quita el VST problemático.'
    console.error('[plugin-host]', lastError)
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
  if (pending || !queue.length) return
  if (!child || child.killed || !child.stdin.writable) {
    while (queue.length) {
      const job = queue.shift()!
      job.resolve({
        ok: false,
        code: 'HostNotReady',
        message: lastError || 'Plugin Host Process no está en ejecución.',
      })
    }
    return
  }

  const job = queue.shift()!
  const type = typeof job.cmd.type === 'string' ? job.cmd.type : ''
  const timer = setTimeout(() => {
    if (pending?.resolve !== job.resolve) return
    const soft =
      type === 'openEditor' ||
      type === 'openEditorFloating' ||
      type === 'listAudioDevices' ||
      type === 'setAudioDevice' ||
      type === 'getAudioDevice' ||
      type === 'testTone' ||
      type === 'ensureAudio' ||
      type === 'asioControlPanel'
    lastError = soft
      ? `Timeout Plugin Host (${type}). El host sigue vivo.`
      : 'Timeout Plugin Host (posible freeze). Proceso de audio detenido; el siguiente ping puede reiniciar.'
    if (soft) {
      settlePending({ ok: false, code: 'HostNotReady', message: lastError })
      return
    }
    failAllRpc(lastError)
    killAudioChild()
  }, job.timeoutMs)

  pending = { resolve: job.resolve, timer }
  if (!writeHostStdin(JSON.stringify(job.cmd) + '\n')) {
    clearTimeout(timer)
    pending = null
    job.resolve({
      ok: false,
      code: 'HostNotReady',
      message: lastError || 'No se pudo escribir al plugin-host (stdin cerrado)',
    })
    pumpQueue()
  }
}

/** MIDI sin esperar reply (el host no responde noteOn/noteOff/allNotesOff). */
export function sendPluginHostMidi(cmd: Record<string, unknown>): void {
  if (!child || child.killed || !child.stdin.writable) return
  const type = typeof cmd.type === 'string' ? cmd.type : ''
  if (
    type !== 'noteOn' &&
    type !== 'noteOff' &&
    type !== 'allNotesOff' &&
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

/** Mata huérfanos de arranques previos (dos hosts = silencio ASIO). */
function killOrphanPluginHosts() {
  if (process.platform !== 'win32') return
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    execFileSync(
      'taskkill',
      ['/F', '/IM', 'jaswave-plugin-host.exe', '/T'],
      { stdio: 'ignore', windowsHide: true },
    )
  } catch {
    /* no había proceso, o acceso denegado */
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

function isUmcName(value: string | undefined): boolean {
  return /umc|behringer/i.test(value || '')
}

function wantsSharedWasapi(prefs: AudioDevicePrefs): boolean {
  if (prefs.exclusive || prefs.backend === 'wasapi_exclusive' || prefs.backend === 'asio') return false
  return !prefs.backend || prefs.backend === 'wasapi' || prefs.backend === 'auto'
}

function pickPreferredWasapi(
  devices?: Array<{ id: string; backend: string; name: string }>,
): AudioDevicePrefs {
  const umc = (devices ?? []).find(
    (d) => d.backend === 'wasapi' && (isUmcName(d.name) || isUmcName(d.id)),
  )
  return {
    backend: 'wasapi',
    deviceId: umc?.id || '',
    sampleRate: 48000,
    bufferSize: 512,
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
  const bin = resolveNativeBinary()
  if (!bin) return false
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
  return true
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

async function applyAudioDeviceOrFallback(
  prefs: AudioDevicePrefs,
  opts?: { sessionFallbackOk?: boolean; persist?: boolean },
): Promise<PluginHostRpcResult> {
  const persist = opts?.persist !== false

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
      if (persist) writeAudioDevicePrefs(prefs)
      await ensureMixPipeConnected()
      // Solo avisar a la UI si el proceso murió: si no, forgetHostPlugins tumba el MIDI en play.
      if (didRespawn) notifyHostRestarted()
      return applied
    }
    console.error('[plugin-host] setAudioDevice ASIO falló:', applied.message)
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
    const msg = `${applied.message || 'ASIO no se pudo abrir.'} Audio en WASAPI. Cierra REAPER/Cubase si tienen la interfaz.`
    if (second.ok) notifyHostRestarted()
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
  if (alreadySharedWasapi && wantsSharedWasapi(prefs)) {
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
  stopPluginHost()
  if (kind === 'native') killOrphanPluginHosts()

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
      const preferredWasapi = pickPreferredWasapi(listed.ok ? listed.devices : undefined)
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
  if (pending) {
    clearTimeout(pending.timer)
    pending.resolve({
      ok: false,
      code: 'HostNotReady',
      message: reason,
    })
    pending = null
  }
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
    type === 'openEditor'
      ? Math.max(timeoutMs, 90_000)
      : timeoutMs

  // MIDI: host no responde — no usar la cola RPC (bloquearía load/ping).
  if (type === 'noteOn' || type === 'noteOff' || type === 'allNotesOff' || type === 'midiCc' || type === 'setTransport' || type === 'setMixInputRate' || type === 'setSlotMix' || type === 'setMasterMix' || type === 'setTrackGraph' || type === 'setMeterTrackOrder' || type === 'setLiveMidiTargets' || type === 'metronome.set' || type === 'clip.schedule' || type === 'clip.stopAll') {
    if (type === 'noteOn' || type === 'noteOff' || type === 'allNotesOff' || type === 'midiCc' || type === 'setTransport' || type === 'setLiveMidiTargets' || type === 'metronome.set' || type === 'clip.schedule' || type === 'clip.stopAll') {
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

  const enqueue = () =>
    new Promise<PluginHostRpcResult>((resolve) => {
      queue.push({ cmd, timeoutMs: long, resolve })
      pumpQueue()
    })

  if (type === 'load' || type === 'openEditor') {
    const pluginPath = String(cmd.path || '')
    const key = pluginKey(pluginPath)
    if (type === 'load' && pluginPath) {
      lastLoadPluginPath = pluginPath
      lastLoadPluginAt = Date.now()
    }
    if (key && getQuarantine().has(key)) {
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
      if (key) {
        getQuarantine().add(key)
        saveQuarantine(getQuarantine())
      }
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
        ok: false,
        code: 'PluginCrashedHost',
        message: quarantineMessage(pluginPath || 'plugin VST3'),
      }
    })
  }

  return enqueue()
}
