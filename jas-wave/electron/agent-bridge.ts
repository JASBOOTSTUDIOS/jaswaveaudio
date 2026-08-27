/**
 * Puente HTTP local (127.0.0.1) para que la CLI / agentes auditen el DAW en vivo.
 * Solo escucha localhost. El renderer aporta snapshots vía IPC.
 */

import type { BrowserWindow } from 'electron'
import * as http from 'node:http'
import { URL } from 'node:url'

export type AgentAuditSnapshot = Record<string, unknown>

const DEFAULT_PORT = 18787

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let server: http.Server | null = null
let port = DEFAULT_PORT
let getMainWindow: () => BrowserWindow | null = () => null
const pending = new Map<string, Pending>()
let reqSeq = 0

function nextId(): string {
  reqSeq += 1
  return `ab-${Date.now().toString(36)}-${reqSeq}`
}

function askRenderer(channel: string, payload: Record<string, unknown>, timeoutMs = 4000): Promise<unknown> {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    return Promise.reject(new Error('DAW no abierto (sin ventana principal)'))
  }
  const id = nextId()
  // musicBuild / bounce pueden tardar; analysis.* no debe bloquear el bridge 10 min.
  const actions = Array.isArray(payload.actions)
    ? (payload.actions as Array<{ type?: string }>)
    : payload.type
      ? [{ type: String(payload.type) }]
      : []
  const onlyAnalysis =
    actions.length > 0 &&
    actions.every((a) => String(a.type || '').startsWith('analysis.') || a.type === 'audio.armNative')
  const long =
    channel === 'actions.execute' || channel === 'command.execute'
      ? onlyAnalysis
        ? Math.max(timeoutMs, 12_000)
        : Math.max(timeoutMs, 600_000)
      : timeoutMs
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timeout esperando renderer (${channel})`))
    }, long)
    pending.set(id, { resolve, reject, timer })
    win.webContents.send('agent-bridge-request', { id, channel, payload })
  })
}

export function resolveAgentBridgeReply(id: string, result: unknown, error?: string): void {
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(id)
  if (error) p.reject(new Error(error))
  else p.resolve(result)
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  res.end(data)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const host = req.headers.host || `127.0.0.1:${port}`
  const url = new URL(req.url || '/', `http://${host}`)
  const method = (req.method || 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  try {
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      json(res, 200, {
        ok: true,
        service: 'jaswave-agent-bridge',
        port,
        window: Boolean(getMainWindow() && !getMainWindow()?.isDestroyed()),
      })
      return
    }

    if (method === 'POST' && url.pathname === '/reload') {
      const win = getMainWindow()
      if (!win || win.isDestroyed()) {
        json(res, 503, { ok: false, error: 'Sin ventana' })
        return
      }
      win.webContents.reloadIgnoringCache()
      json(res, 200, { ok: true, message: 'reload' })
      return
    }

    if (method === 'GET' && url.pathname === '/audit') {
      const snap = await askRenderer('audit.snapshot', {})
      json(res, 200, snap)
      return
    }

    if (method === 'GET' && (url.pathname === '/state' || url.pathname === '/project')) {
      const summary = await askRenderer('state.summary', {})
      json(res, 200, summary)
      return
    }

    if (method === 'GET' && (url.pathname === '/actions' || url.pathname === '/commands')) {
      const listed = await askRenderer('actions.list', {})
      json(res, 200, listed)
      return
    }

    if (method === 'GET' && url.pathname === '/audit/stream') {
      const intervalMs = Math.max(50, Math.min(1000, Number(url.searchParams.get('intervalMs') || 100)))
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      let closed = false
      req.on('close', () => {
        closed = true
      })
      const tick = async () => {
        while (!closed) {
          try {
            const snap = await askRenderer('audit.snapshot', {}, 3000)
            if (closed) break
            res.write(`${JSON.stringify(snap)}\n`)
          } catch (e) {
            if (closed) break
            res.write(
              `${JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : String(e),
                ts: Date.now(),
              })}\n`,
            )
          }
          await new Promise((r) => setTimeout(r, intervalMs))
        }
        try {
          res.end()
        } catch {
          /* ignore */
        }
      }
      void tick()
      return
    }

    if (method === 'POST' && url.pathname === '/transport') {
      const raw = await readBody(req)
      let body: { action?: string; seekSec?: number } = {}
      try {
        body = raw ? (JSON.parse(raw) as typeof body) : {}
      } catch {
        json(res, 400, { ok: false, error: 'JSON inválido' })
        return
      }
      const action = String(body.action || '').toLowerCase()
      if (!['play', 'pause', 'stop', 'toggle', 'seek'].includes(action)) {
        json(res, 400, { ok: false, error: 'action: play|pause|stop|toggle|seek' })
        return
      }
      const result = await askRenderer('transport.control', {
        action,
        seekSec: body.seekSec,
      })
      json(res, 200, result)
      return
    }

    if (method === 'POST' && url.pathname === '/command') {
      const raw = await readBody(req)
      let body: { type?: string; payload?: Record<string, unknown> } = {}
      try {
        body = raw ? (JSON.parse(raw) as typeof body) : {}
      } catch {
        json(res, 400, { ok: false, error: 'JSON inválido' })
        return
      }
      if (!body.type) {
        json(res, 400, { ok: false, error: 'Falta type' })
        return
      }
      const result = await askRenderer('actions.execute', {
        type: body.type,
        payload: body.payload ?? {},
      })
      json(res, 200, result)
      return
    }

    if (method === 'POST' && url.pathname === '/actions') {
      const raw = await readBody(req)
      let body: {
        type?: string
        payload?: Record<string, unknown>
        actions?: Array<{ type: string; payload?: Record<string, unknown> }>
      } = {}
      try {
        body = raw ? (JSON.parse(raw) as typeof body) : {}
      } catch {
        json(res, 400, { ok: false, error: 'JSON inválido' })
        return
      }
      if (Array.isArray(body.actions) && body.actions.length) {
        const result = await askRenderer('actions.execute', { actions: body.actions })
        json(res, 200, result)
        return
      }
      if (body.type) {
        const result = await askRenderer('actions.execute', {
          type: body.type,
          payload: body.payload ?? {},
        })
        json(res, 200, result)
        return
      }
      json(res, 400, { ok: false, error: 'Envía { type, payload } o { actions: [...] }' })
      return
    }

    json(res, 404, {
      ok: false,
      error: 'not found',
      routes: [
        'GET /health',
        'GET /audit',
        'GET /audit/stream',
        'GET /state',
        'GET /actions',
        'POST /transport',
        'POST /command',
        'POST /actions',
      ],
    })
  } catch (e) {
    json(res, 503, { ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

export function startAgentBridge(opts: {
  getMainWindow: () => BrowserWindow | null
  port?: number
}): { port: number } {
  getMainWindow = opts.getMainWindow
  port = opts.port ?? (Number(process.env.JASWAVE_AGENT_PORT) || DEFAULT_PORT)
  if (server) return { port }

  server = http.createServer((req, res) => {
    void handleRequest(req, res)
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`[jaswave-agent-bridge] http://127.0.0.1:${port}`)
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[jaswave-agent-bridge] puerto ${port} ocupado — CLI no disponible`)
    } else {
      console.warn('[jaswave-agent-bridge]', err.message)
    }
  })
  return { port }
}

export function stopAgentBridge(): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error('bridge stopped'))
  }
  pending.clear()
  if (server) {
    try {
      server.close()
    } catch {
      /* ignore */
    }
    server = null
  }
}

export function getAgentBridgePort(): number {
  return port
}
