/**
 * Electron main: Plugin Host Process (ADR-0011 C).
 *
 * VST3: misma instancia para process() y createView (UI nativa).
 * Device de audio: WASAPI / Exclusive / DirectSound / WinMM / ASIO (seleccionable).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import type { Socket } from 'net'
import * as path from 'path'
import { app } from 'electron'

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
    }
  | { ok: false; code: string; message: string }

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
let queue: QueuedCmd[] = []
let started = false
let backend: 'native' | 'node' | 'none' = 'none'
let startPromise: Promise<boolean> | null = null
let lastError: string | undefined
let mixSock: Socket | null = null
let mixBackpressure = false
let mixPipePath = ''
let mixPending: Buffer | null = null
let mixReconnectTimer: ReturnType<typeof setTimeout> | null = null
let mixReconnectAttempts = 0
let mixSuppressReconnect = false

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
  mixPending = null
  if (!mixSock) return
  const s = mixSock
  mixSock = null
  try {
    s.removeAllListeners()
    s.destroy()
  } catch {
    /* ignore */
  }
}

function flushMixPending() {
  if (!mixSock || mixSock.destroyed || !mixSock.writable || !mixPending) return
  const p = mixPending
  mixPending = null
  const ok = mixSock.write(p)
  if (!ok) mixBackpressure = true
}

function scheduleMixReconnect() {
  if (mixSuppressReconnect || backend !== 'native' || !started) return
  if (mixReconnectTimer || mixSock) return
  if (mixReconnectAttempts >= 16) return
  mixReconnectAttempts += 1
  const delay = Math.min(1500, 50 * mixReconnectAttempts)
  mixReconnectTimer = setTimeout(() => {
    mixReconnectTimer = null
    if (mixSuppressReconnect || mixSock || !started) return
    void connectMixPipe(mixPipePath, child?.pid).then((ok) => {
      if (ok) mixReconnectAttempts = 0
      else scheduleMixReconnect()
    })
  }, delay)
}

function connectMixPipeOnce(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ path: name })
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!ok) {
        try {
          sock.removeAllListeners()
          sock.destroy()
        } catch {
          /* ignore */
        }
        if (mixSock === sock) mixSock = null
      }
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), 1500)
    sock.on('connect', () => {
      mixSock = sock
      mixBackpressure = false
      mixPending = null
      done(true)
    })
    sock.on('error', () => done(false))
    sock.on('close', () => {
      if (mixSock === sock) {
        mixSock = null
        mixBackpressure = false
        if (!settled) {
          done(false)
          return
        }
        if (!mixSuppressReconnect) scheduleMixReconnect()
      }
    })
    sock.on('drain', () => {
      mixBackpressure = false
      flushMixPending()
    })
  })
}

async function connectMixPipe(pipeName: string, pid?: number): Promise<boolean> {
  closeMixPipe()
  if (process.platform !== 'win32') return false
  const name =
    pipeName || (typeof pid === 'number' && pid > 0 ? `\\\\.\\pipe\\jaswave-mix-${pid}` : '')
  if (!name) return false
  mixPipePath = name
  mixSuppressReconnect = false
  for (let i = 0; i < 8; i++) {
    if (mixSuppressReconnect) return false
    const ok = await connectMixPipeOnce(name)
    if (ok) {
      mixReconnectAttempts = 0
      return true
    }
    await sleepMs(40 + i * 20)
  }
  return false
}

export function isMixPipeConnected(): boolean {
  return !!mixSock && !mixSock.destroyed && mixSock.writable
}

/** PCM interleaved f32le → named pipe del host. Latest-wins si hay backpressure. */
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
  if (mixBackpressure) {
    mixPending = buf
    return
  }
  const ok = mixSock.write(buf)
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

export function readAudioDevicePrefs(): AudioDevicePrefs | null {
  try {
    const raw = fs.readFileSync(audioPrefsPath(), 'utf8')
    const p = JSON.parse(raw) as AudioDevicePrefs
    if (!p || typeof p !== 'object') return null
    return {
      backend: String(p.backend || 'auto'),
      deviceId: String(p.deviceId || ''),
      sampleRate: Number(p.sampleRate) || 48000,
      bufferSize: Number(p.bufferSize) || 512,
      exclusive: !!p.exclusive,
    }
  } catch {
    return null
  }
}

export function writeAudioDevicePrefs(prefs: AudioDevicePrefs): void {
  try {
    fs.mkdirSync(path.dirname(audioPrefsPath()), { recursive: true })
    fs.writeFileSync(audioPrefsPath(), JSON.stringify(prefs, null, 2), 'utf8')
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
    // Ignorar logs no-JSON en stdout
    if (line[0] !== '{') continue
    try {
      settlePending(JSON.parse(line) as PluginHostRpcResult)
    } catch {
      settlePending({
        ok: false,
        code: 'PluginLoadFailed',
        message: `Respuesta no JSON del plugin-host: ${line.slice(0, 120)}`,
      })
    }
  }
}

function wireChild(proc: ChildProcessWithoutNullStreams) {
  buffer = ''
  proc.stdout.on('data', onChunk)
  proc.stderr.on('data', (d: Buffer) => {
    console.error('[plugin-host]', d.toString('utf8').trimEnd())
  })
  proc.on('exit', (code, signal) => {
    const wasStarted = started
    child = null
    started = false
    backend = 'none'
    lastError = `Plugin Host Process salió (code=${code}, signal=${signal})`
    settlePending({
      ok: false,
      code: 'HostNotReady',
      message: lastError,
    })
    // Drenar cola pendiente
    while (queue.length) {
      const job = queue.shift()!
      job.resolve({ ok: false, code: 'HostNotReady', message: lastError! })
    }
    if (wasStarted && process.env.JASWAVE_DEBUG_PLUGIN_HOST) {
      console.error('[plugin-host]', lastError)
    }
  })
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
  try {
    child.stdin.write(JSON.stringify(job.cmd) + '\n')
  } catch (e) {
    clearTimeout(timer)
    pending = null
    job.resolve({
      ok: false,
      code: 'HostNotReady',
      message: e instanceof Error ? e.message : 'No se pudo escribir al plugin-host',
    })
    pumpQueue()
  }
}

/** MIDI sin esperar reply (el host no responde noteOn/noteOff/allNotesOff). */
export function sendPluginHostMidi(cmd: Record<string, unknown>): void {
  if (!child || child.killed || !child.stdin.writable) return
  const type = typeof cmd.type === 'string' ? cmd.type : ''
  if (type !== 'noteOn' && type !== 'noteOff' && type !== 'allNotesOff') return
  try {
    child.stdin.write(JSON.stringify(cmd) + '\n')
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

export async function setPluginHostAudioDevice(
  prefs: AudioDevicePrefs,
): Promise<PluginHostRpcResult> {
  const ok = await ensurePluginHostStarted()
  if (!ok) {
    return {
      ok: false,
      code: 'HostNotReady',
      message: lastError || 'Plugin Host Process no está en ejecución.',
    }
  }
  return applyAudioDeviceOrFallback(prefs)
}

async function applyAudioDeviceOrFallback(
  prefs: AudioDevicePrefs,
): Promise<PluginHostRpcResult> {
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
    writeAudioDevicePrefs(prefs)
    return applied
  }
  console.error('[plugin-host] setAudioDevice falló:', applied.message)

  const crashed = /salió \(code=/.test(String(applied.message || ''))
  const fallback: AudioDevicePrefs = {
    backend: 'wasapi',
    deviceId: '',
    sampleRate: prefs.sampleRate || 48000,
    bufferSize: prefs.bufferSize || 512,
    exclusive: false,
  }

  // Host muerto: persistir WASAPI para el próximo arranque (sin reentrar en ensure*).
  if (crashed) {
    writeAudioDevicePrefs(fallback)
    return { ...applied, ok: false, code: 'HostNotReady' }
  }

  // ASIO / exclusive vivos pero fallaron al abrir: intentar WASAPI en el mismo proceso.
  if (prefs.backend !== 'wasapi' || prefs.exclusive) {
    const second = await sendPluginHostCommand(
      { type: 'setAudioDevice', ...fallback },
      20_000,
    )
    if (second.ok) {
      writeAudioDevicePrefs(fallback)
      console.error(
        '[plugin-host] Fallback WASAPI tras fallo de',
        prefs.backend,
        ':',
        applied.message,
      )
      return {
        ...second,
        ok: true,
        message: `Fallback WASAPI (${applied.message || 'driver anterior no abrió'})`,
      } as PluginHostRpcResult
    }
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
    const defaultWasapi: AudioDevicePrefs = {
      backend: 'wasapi',
      deviceId: '',
      sampleRate: 48000,
      bufferSize: 512,
      exclusive: false,
    }
    let prefs = readAudioDevicePrefs() ?? defaultWasapi
    // ASIO CoCreate falla a menudo (E_NOINTERFACE); preferir WASAPI al arrancar.
    // El usuario puede volver a ASIO desde Configuración → Audio.
    if (prefs.backend === 'asio' || prefs.backend === 'wasapi_exclusive') {
      console.error(
        '[plugin-host] prefs',
        prefs.backend,
        '→ WASAPI al arrancar (más estable; ASIO sigue en Configuración)',
      )
      prefs = { ...defaultWasapi, sampleRate: prefs.sampleRate || 48000, bufferSize: prefs.bufferSize || 512 }
      writeAudioDevicePrefs(prefs)
    }
    let applied = await applyAudioDeviceOrFallback(prefs)
    // Crash (p.ej. heap 0xC0000374): prefs ya son WASAPI; respawnear una vez.
    if (!applied.ok && /salió \(code=/.test(String(applied.message || ''))) {
      console.error('[plugin-host] respawn tras crash de setAudioDevice → WASAPI')
      const bin = resolveNativeBinary()
      if (!bin) return false
      killAudioChild()
      child = spawnNative(bin)
      backend = 'native'
      wireChild(child)
      started = true
      lastError = undefined
      const ping2 = await sendPluginHostCommand({ type: 'ping' }, 4000)
      if (!ping2.ok) {
        lastError = ping2.message
        stopPluginHost()
        return false
      }
      await connectMixPipe(ping2.mixPipe || '', child?.pid)
      prefs = readAudioDevicePrefs() ?? defaultWasapi
      applied = await applyAudioDeviceOrFallback(prefs)
    }
    // Reconectar pipe al host vivo tras setAudioDevice (evita pipe de un spawn anterior).
    if (applied.ok && child?.pid) {
      const ping3 = await sendPluginHostCommand({ type: 'ping' }, 4000)
      if (ping3.ok) {
        await connectMixPipe(String(ping3.mixPipe || ''), child.pid)
      }
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
    openEditors: 0,
    backend,
    lastError,
    note:
      backend === 'native'
        ? 'Plugin Host nativo: misma instancia UI+audio. Mixer DAW (clips/Soft Pad) + VST en el device elegido.'
        : backend === 'node'
          ? 'Plugin Host Node (solo discovery). Compila build-vst3 para audio/UI nativa.'
          : lastError
            ? `Plugin Host no iniciado: ${lastError}`
            : 'Plugin Host Process no iniciado.',
  }
}

export function ensurePluginHostStarted(): Promise<boolean> {
  if (child && !child.killed && started) return Promise.resolve(true)
  if (startPromise) return startPromise
  startPromise = doStart().finally(() => {
    startPromise = null
  })
  return startPromise
}

function killAudioChild() {
  cancelMixReconnect()
  closeMixPipe()
  if (child && !child.killed) {
    try {
      child.stdin.end()
      child.kill()
    } catch {
      /* ignore */
    }
  }
  child = null
  started = false
  backend = 'none'
  buffer = ''
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
  const reason = lastError || 'Plugin Host Process detenido.'
  failAllRpc(reason)
  killAudioChild()
}

export function sendPluginHostCommand(
  cmd: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<PluginHostRpcResult> {
  const type = typeof cmd.type === 'string' ? cmd.type : ''

  // Prefs solo se escriben tras ok (ver send + applyAudioDeviceOrFallback).

  const long =
    type === 'load' ||
    type === 'prepare' ||
    type === 'setAudioDevice' ||
    type === 'listAudioDevices' ||
    type === 'ensureAudio'
      ? Math.max(timeoutMs, 90_000)
      : timeoutMs

  // MIDI: host no responde — no usar la cola RPC (bloquearía load/ping).
  if (type === 'noteOn' || type === 'noteOff' || type === 'allNotesOff' || type === 'setMixInputRate' || type === 'setSlotMix' || type === 'setMasterMix' || type === 'setTrackGraph') {
    if (type === 'noteOn' || type === 'noteOff' || type === 'allNotesOff') {
      sendPluginHostMidi(cmd)
      return Promise.resolve({
        ok: true,
        processId: 'jaswave-plugin-host',
        slotId: String(cmd.slotId ?? ''),
      })
    }
    if (child && !child.killed && child.stdin.writable) {
      try {
        child.stdin.write(JSON.stringify(cmd) + '\n')
      } catch {
        /* ignore */
      }
    }
    return Promise.resolve({ ok: true, processId: 'jaswave-plugin-host' })
  }

  return new Promise((resolve) => {
    const wrap =
      type === 'setAudioDevice'
        ? (result: PluginHostRpcResult) => {
            if (result.ok && cmd.backend) {
              writeAudioDevicePrefs({
                backend: String(cmd.backend),
                deviceId: String(cmd.deviceId ?? ''),
                sampleRate: Number(cmd.sampleRate) || 48000,
                bufferSize: Number(cmd.bufferSize) || 512,
                exclusive: !!cmd.exclusive || String(cmd.backend) === 'wasapi_exclusive',
              })
            }
            resolve(result)
          }
        : resolve
    queue.push({ cmd, timeoutMs: long, resolve: wrap })
    pumpQueue()
  })
}
