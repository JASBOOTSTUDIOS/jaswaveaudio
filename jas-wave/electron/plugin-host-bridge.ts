/**
 * Electron main: Plugin Host Process (ADR-0011 C).
 *
 * Discovery: Node host por defecto (FS fiable).
 * UI nativa VST3: spawnea jaswave-vst3-editor (Steinberg editorhost) en openEditor.
 * Nativo IPC solo si JASWAVE_PLUGIN_HOST=native y el binario responde ping.
 */

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

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
    }
  | { ok: false; code: string; message: string }

/** Editors nativos vivos (HWND fuera de Electron). */
const editors = new Map<string, ChildProcess>()

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

/** Steinberg editorhost renombrado / copiado como jaswave-vst3-editor. */
function resolveVst3EditorBinary(): string | null {
  const names =
    process.platform === 'win32'
      ? ['jaswave-vst3-editor.exe', 'editorhost.exe', 'jaswave-vst3-editor', 'editorhost']
      : ['jaswave-vst3-editor', 'editorhost']

  const relativeDirs = [
    path.join('native', 'plugin-host', 'build-vst3', 'Release'),
    path.join('native', 'plugin-host', 'build-vst3', 'Debug'),
    path.join('native', 'plugin-host', 'build-vst3', 'bin', 'Release'),
    path.join('native', 'plugin-host', 'build-vst3', 'bin', 'Debug'),
    path.join('native', 'plugin-host', 'build', 'vst3sdk', 'bin', 'Release'),
    path.join('native', 'plugin-host', 'build', 'vst3sdk', 'bin', 'Debug'),
    path.join('native', 'plugin-host', 'build', 'Release'),
    path.join('native', 'plugin-host', 'build', 'Debug'),
    path.join('native', 'plugin-host', 'build'),
    path.join(
      'native',
      'plugin-host',
      'build',
      'vst3sdk',
      'public.sdk',
      'samples',
      'vst-hosting',
      'editorhost',
      'Release',
    ),
    path.join(
      'native',
      'plugin-host',
      'build',
      'vst3sdk',
      'public.sdk',
      'samples',
      'vst-hosting',
      'editorhost',
      'Debug',
    ),
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

function editorReadyOnDisk(): boolean {
  return !!resolveVst3EditorBinary()
}

function killEditor(slotId: string) {
  const proc = editors.get(slotId)
  if (!proc) return
  editors.delete(slotId)
  try {
    if (!proc.killed) proc.kill()
  } catch {
    /* ignore */
  }
}

function openNativeVst3Editor(args: {
  path: string
  slotId: string
}): PluginHostRpcResult {
  const bin = resolveVst3EditorBinary()
  if (!bin) {
    return {
      ok: false,
      code: 'PluginEditorFailed',
      message:
        'No se encontró jaswave-vst3-editor (Steinberg editorhost). Compila native/plugin-host con VST3 SDK.',
    }
  }
  const pluginPath = args.path
  if (!pluginPath || !fs.existsSync(pluginPath)) {
    return {
      ok: false,
      code: 'PluginNotFound',
      message: `Ruta VST3 inválida: ${pluginPath || '(vacía)'}`,
    }
  }

  killEditor(args.slotId)

  try {
    // SUBSYSTEM:windows — sin consola; la UI del plugin es una ventana HWND nativa.
    const proc = spawn(bin, [pluginPath], {
      windowsHide: false,
      detached: false,
      stdio: 'ignore',
    })
    editors.set(args.slotId, proc)
    proc.on('exit', () => {
      if (editors.get(args.slotId) === proc) editors.delete(args.slotId)
    })
    return {
      ok: true,
      processId: `vst3-editor-${proc.pid ?? 'unknown'}`,
      slotId: args.slotId,
      editorReady: true,
    }
  } catch (e) {
    return {
      ok: false,
      code: 'PluginEditorFailed',
      message: e instanceof Error ? e.message : 'No se pudo abrir editor VST3',
    }
  }
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
  const timer = setTimeout(() => {
    if (pending?.resolve === job.resolve) {
      pending = null
      job.resolve({
        ok: false,
        code: 'PluginLoadFailed',
        message: 'Timeout esperando respuesta del Plugin Host Process.',
      })
      pumpQueue()
    }
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

async function tryStart(kind: 'native' | 'node'): Promise<boolean> {
  stopPluginHost()

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
  const editorBin = resolveVst3EditorBinary()
  return {
    isolationPolicy: 'hybrid' as const,
    builtinInProcess: true,
    thirdPartyOutOfProcess: true,
    vst3HostProcessAvailable: started && !!child && !child.killed,
    vst3EditorAvailable: backend === 'native' || !!editorBin,
    vst3AudioAvailable: backend === 'native',
    editorBinary: editorBin ?? undefined,
    openEditors: editors.size,
    backend,
    lastError,
    note:
      backend === 'native'
        ? 'Plugin Host nativo: audio VST3 + editor HWND embebido en el tab.'
        : editorBin
          ? 'Discovery Node; UI flotante (editorhost) disponible. Preferí build-vst3 nativo para audio+embed.'
          : backend === 'node'
            ? 'Plugin Host Node (solo discovery). Compila build-vst3 para audio/UI embebida.'
            : lastError
              ? `Plugin Host no iniciado: ${lastError}`
              : 'Plugin Host Process no iniciado.',
  }
}

export function ensurePluginHostStarted(): Promise<boolean> {
  if (child && !child.killed && started) return Promise.resolve(true)
  if (!startPromise) {
    startPromise = doStart().finally(() => {
      startPromise = null
    })
  }
  return startPromise
}

export function stopPluginHost() {
  if (pending) {
    clearTimeout(pending.timer)
    pending.resolve({
      ok: false,
      code: 'HostNotReady',
      message: 'Plugin Host Process detenido.',
    })
    pending = null
  }
  while (queue.length) {
    const job = queue.shift()!
    job.resolve({ ok: false, code: 'HostNotReady', message: 'Plugin Host Process detenido.' })
  }
  for (const slotId of [...editors.keys()]) killEditor(slotId)
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

export function sendPluginHostCommand(
  cmd: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<PluginHostRpcResult> {
  const type = typeof cmd.type === 'string' ? cmd.type : ''

  // UI: solo editorhost flotante (nunca createView en el host de audio → no cuelga).
  if (type === 'openEditor' || type === 'openEditorFloating') {
    const pluginPath = String(cmd.path ?? '')
    const slotId = String(cmd.slotId ?? cmd.pluginId ?? pluginPath)
    return Promise.resolve(openNativeVst3Editor({ path: pluginPath, slotId }))
  }
  if (type === 'closeEditor') {
    const slotId = String(cmd.slotId ?? cmd.pluginId ?? '')
    killEditor(slotId)
    return Promise.resolve({
      ok: true,
      processId: 'jaswave-plugin-host',
      slotId,
      editorReady: false,
    })
  }
  if (type === 'focusEditor') {
    const pluginPath = String(cmd.path ?? '')
    const slotId = String(cmd.slotId ?? cmd.pluginId ?? pluginPath)
    if (pluginPath) {
      return Promise.resolve(openNativeVst3Editor({ path: pluginPath, slotId }))
    }
    return Promise.resolve({
      ok: false,
      code: 'PluginEditorFailed',
      message: 'No hay editor abierto para ese slot.',
    })
  }
  if (type === 'setEditorBounds') {
    return Promise.resolve({
      ok: true,
      processId: 'jaswave-plugin-host',
      slotId: String(cmd.slotId ?? ''),
      editorReady: true,
    })
  }

  const long =
    type === 'load' || type === 'prepare' ? Math.max(timeoutMs, 90_000) : timeoutMs

  return new Promise((resolve) => {
    queue.push({ cmd, timeoutMs: long, resolve })
    pumpQueue()
  })
}
