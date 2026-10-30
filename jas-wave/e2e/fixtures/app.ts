/**
 * Lanzador E2E de JasWave.
 *
 * Por qué no `_electron.launch()` de Playwright: la app empaquetada tiene el fuse
 * EnableNodeCliInspectArguments=false, así que `--inspect` se ignora y Playwright se
 * queda esperando el WebSocket del inspector de Node. En su lugar arrancamos el exe
 * con el switch de Chromium `--remote-debugging-port` (sí funciona con los fuses) y
 * nos conectamos con `chromium.connectOverCDP`. El mismo camino sirve para el build
 * de desarrollo (`electron .` sin VITE_DEV_SERVER_URL → carga dist/index.html).
 *
 * Aislamiento: cada lanzamiento usa una carpeta temporal propia como userData
 * (`--user-data-dir`), un puerto CDP libre y un puerto libre para el agent bridge.
 */

import { chromium, type Browser, type ConsoleMessage, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

export const JAS_WAVE_ROOT = path.resolve(__dirname, '..', '..')

export type LaunchTarget = 'packaged' | 'dev'

export type LaunchOptions = {
  /** Arranca el agent bridge HTTP (JASWAVE_AGENT_BRIDGE=1) con token conocido. */
  bridge?: boolean
  /** Etiqueta para la carpeta temporal / logs. */
  label?: string
  /** Variables de entorno extra para el proceso (p. ej. JASWAVE_AI_MOCK). */
  env?: Record<string, string>
  /** Se llama con la carpeta userData vacía antes de arrancar (p. ej. para copiar `audio-device.json`). */
  prepararUserData?: (userDataDir: string) => void
}

export type JasWaveApp = {
  target: LaunchTarget
  proc: ChildProcess
  browser: Browser
  page: Page
  /** Carpeta temporal raíz del lanzamiento (userData + work). */
  tmpRoot: string
  /** userData real reportado por la app (window.electron.userDataPath()). */
  userData: string
  /** Carpeta de trabajo fuera de userData (proyectos, renders). */
  workDir: string
  /** Mensajes de consola de nivel error del renderer desde que nos conectamos. */
  consoleErrors: string[]
  /** stdout+stderr del proceso main. */
  mainOutput: () => string
  bridge: BridgeClient | null
  /** Puerto asignado al agent bridge (JASWAVE_AGENT_PORT), escuche o no. */
  bridgePort: number
  close: () => Promise<void>
}

export function launchTarget(): LaunchTarget {
  const t = (process.env.JASWAVE_E2E_TARGET || 'packaged').toLowerCase()
  return t === 'dev' ? 'dev' : 'packaged'
}

/** Ejecutable a lanzar y argumentos base según el destino. */
export function resolveExecutable(target: LaunchTarget): { exe: string; args: string[]; cwd: string } {
  if (target === 'dev') {
    // require('electron') desde Node devuelve la ruta al binario.
    const electronBin = require(path.join(JAS_WAVE_ROOT, 'node_modules', 'electron')) as unknown as string
    const main = path.join(JAS_WAVE_ROOT, 'build', 'electron', 'electron', 'main.js')
    if (!fs.existsSync(main) || !fs.existsSync(path.join(JAS_WAVE_ROOT, 'dist', 'index.html'))) {
      throw new Error('Build de desarrollo ausente: ejecuta `npm run build` en jas-wave/ antes de JASWAVE_E2E_TARGET=dev')
    }
    return { exe: electronBin, args: ['.'], cwd: JAS_WAVE_ROOT }
  }
  const exe = process.env.JASWAVE_E2E_EXE || path.join(JAS_WAVE_ROOT, 'release', 'win-unpacked', 'JasWave.exe')
  if (!fs.existsSync(exe)) {
    throw new Error(
      `No existe ${exe}. Empaqueta antes: \`npm run build && npm run stage:host && npx electron-builder --win dir\` (o define JASWAVE_E2E_EXE).`,
    )
  }
  return { exe, args: [], cwd: path.dirname(exe) }
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Reintenta `fn` hasta que devuelva un valor truthy o se agote el tiempo. */
export async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 60_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      lastErr = e
    }
    await sleep(intervalMs)
  }
  throw new Error(`Timeout esperando ${what}${lastErr ? `: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : ''}`)
}

/** Mata el árbol de procesos (incluye jaswave-plugin-host.exe y procesos GPU/renderer). */
function killTree(proc: ChildProcess): void {
  if (proc.exitCode != null || proc.pid == null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    proc.kill('SIGKILL')
  }
}

function waitExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode != null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/** Ventana principal: index.html sin ?undock=. */
function isMainWindowUrl(url: string): boolean {
  return /index\.html/i.test(url) && !/[?&]undock=/.test(url)
}

export async function launchJasWave(opts: LaunchOptions = {}): Promise<JasWaveApp> {
  const target = launchTarget()
  const { exe, args, cwd } = resolveExecutable(target)
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `jaswave-e2e-${opts.label ?? 'app'}-`))
  const userDataDir = path.join(tmpRoot, 'userData')
  const workDir = path.join(tmpRoot, 'work')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(workDir, { recursive: true })
  opts.prepararUserData?.(userDataDir)

  const cdpPort = await freePort()
  const bridgePort = await freePort()
  const bridgeToken = randomBytes(24).toString('hex')

  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  env.JASWAVE_AGENT_BRIDGE = opts.bridge ? '1' : '0'
  env.JASWAVE_AGENT_PORT = String(bridgePort)
  if (opts.bridge) env.JASWAVE_AGENT_TOKEN = bridgeToken
  else delete env.JASWAVE_AGENT_TOKEN
  delete env.JASWAVE_AI_MOCK
  // Los proyectos nuevos de la instancia van a su carpeta temporal, nunca a los Documentos del usuario.
  env.JASWAVE_PROYECTOS_DIR = path.join(workDir, 'proyectos')
  // El diario de producción y los puntos de control de la IA tampoco se mezclan con los del usuario real.
  env.JASWAVE_PRODUCCIONES_DIR = path.join(workDir, 'producciones')
  env.JASWAVE_RECUPERACION_DIR = path.join(workDir, 'recuperacion')
  Object.assign(env, opts.env ?? {})

  let output = ''
  const proc = spawn(exe, [...args, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })
  const append = (d: Buffer) => {
    output = (output + d.toString()).slice(-200_000)
  }
  proc.stdout?.on('data', append)
  proc.stderr?.on('data', append)

  const fail = async (e: unknown): Promise<never> => {
    killTree(proc)
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n--- salida main ---\n${output.slice(-4000)}`)
  }

  let browser: Browser
  let page: Page
  try {
    await waitFor(
      'endpoint CDP',
      async () => {
        if (proc.exitCode != null) throw new Error(`La app terminó al arrancar (exit ${proc.exitCode})`)
        const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
        return r.ok
      },
      90_000,
    )
    // JASWAVE_E2E_SLOWMO=<ms>: pausa entre acciones para que una persona pueda seguir la prueba en pantalla.
    const slowMo = Number(process.env.JASWAVE_E2E_SLOWMO ?? 0) || undefined
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 60_000, slowMo })
    page = await waitFor(
      'ventana principal',
      async () => {
        for (const ctx of browser.contexts()) {
          for (const p of ctx.pages()) if (isMainWindowUrl(p.url())) return p
        }
        return null
      },
      60_000,
    )
  } catch (e) {
    return fail(e)
  }

  const consoleErrors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
    // Trazas del asistente (habilidades): sirven para diagnosticar pruebas largas con IA.
    else if (msg.type() === 'info' && /^\[(habilidad|banda)\]/.test(msg.text())) consoleErrors.push(msg.text())
  })
  // Con las primeras líneas de la pila: sin ellas un «Maximum call stack size exceeded» no se puede ubicar.
  page.on('pageerror', (err) => {
    const pila = (err.stack ?? '').split('\n').slice(1, 6).map((l) => l.trim()).join(' <- ')
    consoleErrors.push(`pageerror: ${err.message}${pila ? ` [${pila}]` : ''}`)
  })

  let userData = userDataDir
  try {
    await page.waitForFunction(() => typeof (window as any).electron?.userDataPath === 'function', null, {
      timeout: 60_000,
    })
    userData = await page.evaluate(() => (window as any).electron.userDataPath() as Promise<string>)
  } catch (e) {
    return fail(e)
  }

  let bridge: BridgeClient | null = null
  if (opts.bridge) {
    bridge = new BridgeClient(bridgePort, bridgeToken)
    try {
      await bridge.waitReady()
    } catch (e) {
      return fail(e)
    }
  }

  const close = async () => {
    try {
      await browser.close()
    } catch {
      /* CDP ya cerrado */
    }
    // Sin cierre "amable": el renderer puede pedir confirmación por cambios sin guardar.
    killTree(proc)
    await waitExit(proc, 10_000)
    if (!process.env.JASWAVE_E2E_KEEP_TMP) {
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(tmpRoot, { recursive: true, force: true })
          break
        } catch {
          await sleep(500) // Windows: handles aún abiertos un instante tras matar el proceso
        }
      }
    }
  }

  return {
    target,
    proc,
    browser,
    page,
    tmpRoot,
    userData,
    workDir,
    consoleErrors,
    mainOutput: () => output,
    bridge,
    bridgePort,
    close,
  }
}

export type ActionResult = { type: string; success: boolean; message?: string; data?: any }
export type ActionsResponse = { ok: boolean; results: ActionResult[] }

/** Cliente mínimo del agent bridge (Bearer token, sin cabecera Origin). */
export class BridgeClient {
  constructor(
    readonly port: number,
    private readonly token: string,
  ) {}

  get base(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async request(
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    timeoutMs = 120_000,
  ): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, ...extraHeaders }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const r = await fetch(`${this.base}${route}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await r.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    return { status: r.status, json }
  }

  async state(): Promise<any> {
    const r = await this.request('GET', '/state')
    if (r.status !== 200) throw new Error(`/state ${r.status}: ${JSON.stringify(r.json)}`)
    return r.json
  }

  async actions(list: Array<{ type: string; payload?: Record<string, unknown> }>, timeoutMs?: number): Promise<ActionsResponse> {
    const r = await this.request('POST', '/actions', { actions: list }, {}, timeoutMs)
    if (r.status !== 200) throw new Error(`/actions ${r.status}: ${JSON.stringify(r.json)}`)
    return r.json as ActionsResponse
  }

  /** Ejecuta una acción y falla con su mensaje si no tuvo éxito. */
  async run(type: string, payload: Record<string, unknown> = {}, timeoutMs?: number): Promise<ActionResult> {
    const res = await this.actions([{ type, payload }], timeoutMs)
    const r = res.results?.[0]
    if (!r?.success) throw new Error(`${type} falló: ${r?.message ?? JSON.stringify(res)}`)
    return r
  }

  /** /health responde y el renderer contesta a /state (AgentAuditHost montado). */
  async waitReady(timeoutMs = 90_000): Promise<void> {
    await waitFor(
      'agent bridge',
      async () => {
        const h = await this.request('GET', '/health', undefined, {}, 3000)
        if (h.status !== 200 || !h.json?.window) return false
        const s = await this.request('GET', '/state', undefined, {}, 5000)
        return s.status === 200
      },
      timeoutMs,
      500,
    )
  }
}
