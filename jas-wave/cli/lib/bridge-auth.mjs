/**
 * Autenticación de la CLI contra el agent bridge de JasWave.
 *
 * El bridge escribe { port, token } en <userData>/agent-bridge.json al arrancar.
 * Importar este módulo (efecto lateral) añade `Authorization: Bearer <token>` a las
 * peticiones fetch/http hacia 127.0.0.1:<puerto del bridge>.
 *
 * Overrides: JASWAVE_AGENT_TOKEN, JASWAVE_AGENT_PORT, JASWAVE_USER_DATA.
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

function userDataCandidates() {
  if (process.env.JASWAVE_USER_DATA) return [process.env.JASWAVE_USER_DATA]
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'))
  // En desarrollo (app sin empaquetar) Electron usa «Electron» como userData.
  const dirs = ['JasWave', 'jaswave', 'Electron'].map((n) => path.join(appData, n))
  const mtime = (d) => {
    try {
      return fs.statSync(path.join(d, 'agent-bridge.json')).mtimeMs
    } catch {
      return 0
    }
  }
  // El bridge reescribe el archivo en cada arranque: el más reciente es el de la app abierta.
  return dirs.sort((a, b) => mtime(b) - mtime(a))
}

export function readBridgeCredentials() {
  const envPort = Number(process.env.JASWAVE_AGENT_PORT) || 0
  if (process.env.JASWAVE_AGENT_TOKEN) {
    return { port: envPort || 18787, token: process.env.JASWAVE_AGENT_TOKEN }
  }
  for (const dir of userDataCandidates()) {
    try {
      const raw = fs.readFileSync(path.join(dir, 'agent-bridge.json'), 'utf8')
      const j = JSON.parse(raw)
      if (j && typeof j.token === 'string') return { port: envPort || Number(j.port) || 18787, token: j.token }
    } catch {
      /* siguiente candidato */
    }
  }
  return { port: envPort || 18787, token: '' }
}

const creds = readBridgeCredentials()

export const BRIDGE_PORT = creds.port
export const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`

export function bridgeHeaders(extra = {}) {
  return creds.token ? { Authorization: `Bearer ${creds.token}`, ...extra } : { ...extra }
}

function isBridgeUrl(u) {
  try {
    const url = typeof u === 'string' ? new URL(u) : u instanceof URL ? u : new URL(u.url)
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && Number(url.port) === BRIDGE_PORT
  } catch {
    return false
  }
}

if (creds.token && !globalThis.__jaswaveBridgeAuthPatched) {
  globalThis.__jaswaveBridgeAuthPatched = true

  const origFetch = globalThis.fetch
  globalThis.fetch = (input, init = {}) => {
    if (!isBridgeUrl(input)) return origFetch(input, init)
    const headers = new Headers(init.headers || {})
    if (!headers.has('authorization')) headers.set('Authorization', `Bearer ${creds.token}`)
    return origFetch(input, { ...init, headers })
  }

  const origRequest = http.request
  http.request = function patchedRequest(...args) {
    const opts = args.find((a) => a && typeof a === 'object' && !(a instanceof URL))
    const host = opts?.hostname || opts?.host
    if (opts && (host === '127.0.0.1' || host === 'localhost') && Number(opts.port) === BRIDGE_PORT) {
      opts.headers = { Authorization: `Bearer ${creds.token}`, ...(opts.headers || {}) }
    }
    return origRequest.apply(this, args)
  }
}
