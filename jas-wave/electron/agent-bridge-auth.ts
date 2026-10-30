/**
 * Reglas de acceso del puente HTTP local (CLI / agentes).
 * Sin dependencias de Electron para poder testearlas con node:test.
 */

import { timingSafeEqual } from 'node:crypto'

export type BridgeAuthResult = { ok: true } | { ok: false; status: number; error: string }

/** Rutas que no requieren token (solo informan si el bridge está vivo). */
const PUBLIC_PATHS = new Set(['/', '/health'])

export const MAX_BRIDGE_BODY_BYTES = 2 * 1024 * 1024

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Valida una petición al bridge:
 * - nunca desde un navegador (cabecera Origin → 403, sin CORS);
 * - Host debe ser loopback con el puerto real (bloquea DNS rebinding);
 * - Bearer token obligatorio salvo en /health.
 */
export function checkBridgeRequest(opts: {
  method: string
  pathname: string
  headers: Record<string, string | string[] | undefined>
  port: number
  token: string
}): BridgeAuthResult {
  const { headers, port, token } = opts
  const method = opts.method.toUpperCase()

  if (headers.origin !== undefined || method === 'OPTIONS') {
    return { ok: false, status: 403, error: 'Peticiones de navegador no permitidas' }
  }

  const host = String(headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    return { ok: false, status: 403, error: 'Host no permitido' }
  }

  if (method === 'GET' && PUBLIC_PATHS.has(opts.pathname)) return { ok: true }

  const auth = String(headers.authorization ?? '')
  const m = /^Bearer\s+(.+)$/i.exec(auth)
  if (!token || !m || !safeEqual(m[1]!.trim(), token)) {
    return { ok: false, status: 401, error: 'Token inválido o ausente (ver agent-bridge.json en userData)' }
  }

  if (method === 'POST') {
    const ct = String(headers['content-type'] ?? '').toLowerCase()
    if (!ct.startsWith('application/json')) {
      return { ok: false, status: 415, error: 'Content-Type debe ser application/json' }
    }
  }
  return { ok: true }
}

/**
 * El bridge solo arranca en desarrollo o si se habilita explícitamente
 * (JASWAVE_AGENT_BRIDGE=1 o ajuste de "control por CLI").
 */
export function shouldStartAgentBridge(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
  settingEnabled: boolean
}): boolean {
  if (opts.env.JASWAVE_AGENT_BRIDGE === '0') return false
  if (opts.env.JASWAVE_AGENT_BRIDGE === '1') return true
  if (opts.settingEnabled) return true
  return !opts.isPackaged
}

/** Campos de payload que llevan rutas de disco (audio.import, render.start, score.export, plugin.insert…). */
const PATH_FIELDS = new Set(['filePath', 'outputPath', 'outPath', 'folderPath', 'path', 'ruta', 'dir', 'directory'])

/**
 * Rutas absolutas presentes en acciones enviadas por la CLI autenticada.
 * El token solo lo puede leer el usuario local, así que sus rutas cuentan como elegidas por él.
 */
export function collectActionPaths(body: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length >= 64 || !body || typeof body !== 'object') return out
  if (Array.isArray(body)) {
    for (const item of body) collectActionPaths(item, out, depth + 1)
    return out
  }
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (PATH_FIELDS.has(key) && value.length < 1024 && /^([a-zA-Z]:[\\/]|\/)/.test(value)) out.push(value)
    } else if (value && typeof value === 'object') {
      collectActionPaths(value, out, depth + 1)
    }
  }
  return out
}
