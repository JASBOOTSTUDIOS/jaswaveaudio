/**
 * Transporte del asistente (M1): en escritorio habla con el gateway de Electron (IPC); en la web,
 * con el gateway `/ia` del backend usando el JWT de la sesión. El modelo y las claves los decide el
 * servidor, así que del lado web solo viajan mensajes, herramientas y opciones.
 */

import type { AiChatRequest, AiChatResult, AiErrorCode, AiHealthResult } from '../ai-settings'

export type EventoStreamIA = { type: 'delta' | 'done' | string; text?: string; success?: boolean }

export type TransporteIA = {
  origen: 'electron' | 'backend'
  chat(req: AiChatRequest): Promise<AiChatResult>
  chatStream?(req: AiChatRequest, onEvent: (e: EventoStreamIA) => void): Promise<AiChatResult>
  cancelar(requestId: string): Promise<boolean>
  salud(payload?: unknown): Promise<AiHealthResult>
}

export type EstadoIABackend = { disponible: boolean; proveedor?: string; modelo?: string; modelos?: string[]; motivo?: string }

export type OpcionesTransporteBackend = {
  base: string
  token: () => Promise<string | null>
  fetch?: typeof fetch
}

/** Solo los campos que el backend acepta; host, clave y modelo del perfil local no salen del navegador. */
function cuerpoChat(req: AiChatRequest) {
  return {
    messages: req.messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    ...(req.tools?.length ? { tools: req.tools } : {}),
    ...(req.toolChoice ? { toolChoice: req.toolChoice } : {}),
    ...(req.requestId && /^[\w-]{1,80}$/.test(req.requestId) ? { requestId: req.requestId } : {}),
    ...(req.meta ? { meta: req.meta } : {}),
  }
}

function fallo(error: string, errorCode: AiErrorCode, hint?: string): AiChatResult {
  return { success: false, error, errorCode, ...(hint ? { hint } : {}) }
}

export function crearTransporteBackend(o: OpcionesTransporteBackend): TransporteIA {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  async function pedir(ruta: string, init: { method: string; body?: unknown }): Promise<Response | AiChatResult> {
    const token = await o.token()
    if (!token) return fallo('Inicia sesión para usar el asistente en la web.', 'unauthorized', 'Cuenta → Iniciar sesión')
    try {
      return await f(`${o.base}${ruta}`, {
        method: init.method,
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })
    } catch {
      return fallo('No se pudo contactar con el servidor de JasWave.', 'connection')
    }
  }

  async function errorHttp(r: Response): Promise<AiChatResult> {
    const datos = (await r.json().catch(() => null)) as { error?: { codigo?: string; mensaje?: string } } | null
    const mapa: Record<number, AiErrorCode> = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 429: 'rate_limit', 503: 'not_available' }
    return fallo(datos?.error?.mensaje ?? `error ${r.status}`, mapa[r.status] ?? 'provider_error')
  }

  const t: TransporteIA = {
    origen: 'backend',
    async chat(req) {
      const r = await pedir('/ia/chat', { method: 'POST', body: cuerpoChat(req) })
      if (!(r instanceof Response)) return r
      if (!r.ok) return errorHttp(r)
      return (await r.json()) as AiChatResult
    },
    async chatStream(req, onEvent) {
      const r = await pedir('/ia/chat/stream', { method: 'POST', body: cuerpoChat(req) })
      if (!(r instanceof Response)) return r
      if (!r.ok) return errorHttp(r)
      if (!r.body) return t.chat(req)
      const lector = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let final: AiChatResult | null = null
      for (;;) {
        const { value, done } = await lector.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let corte: number
        while ((corte = buf.indexOf('\n\n')) >= 0) {
          const bloque = buf.slice(0, corte)
          buf = buf.slice(corte + 2)
          if (!bloque.startsWith('data: ')) continue
          const e = JSON.parse(bloque.slice(6)) as { type: string; text?: string; result?: AiChatResult }
          if (e.type === 'delta') onEvent({ type: 'delta', text: e.text })
          else if (e.type === 'done') {
            final = e.result ?? fallo('Respuesta vacía', 'unknown')
            onEvent({ type: 'done', success: final.success })
          }
        }
      }
      return final ?? fallo('La conexión con el asistente se cortó.', 'connection')
    },
    async cancelar(requestId) {
      const r = await pedir('/ia/cancelar', { method: 'POST', body: { requestId } })
      return r instanceof Response && r.ok && Boolean(((await r.json()) as { cancelada?: boolean }).cancelada)
    },
    async salud() {
      const r = await pedir('/ia/estado', { method: 'GET' })
      if (!(r instanceof Response)) return { status: r.errorCode === 'unauthorized' ? 'misconfigured' : 'disconnected', models: [], ...(r.error ? { error: r.error } : {}), ...(r.hint ? { hint: r.hint } : {}) }
      if (!r.ok) {
        const e = await errorHttp(r)
        return { status: 'disconnected', models: [], ...(e.error ? { error: e.error } : {}) }
      }
      const est = (await r.json()) as EstadoIABackend
      return {
        status: est.disponible ? 'healthy' : est.motivo === 'ia_no_configurada' ? 'misconfigured' : 'disconnected',
        models: est.modelos ?? [],
        ...(est.proveedor ? { provider: est.proveedor } : {}),
        ...(est.motivo ? { error: est.motivo === 'ia_no_configurada' ? 'El servidor no tiene IA configurada.' : est.motivo } : {}),
      }
    },
  }
  return t
}

function transporteElectron(): TransporteIA | null {
  const e = typeof window !== 'undefined' ? window.electron : undefined
  if (!e?.aiChat) return null
  return {
    origen: 'electron',
    chat: (req) => e.aiChat(req),
    ...(e.aiChatStream ? { chatStream: (req: AiChatRequest, onEvent: (ev: EventoStreamIA) => void) => e.aiChatStream!(req, onEvent) } : {}),
    cancelar: async (id) => Boolean(await e.aiChatCancel?.(id)),
    salud: async (payload) => (await e.aiHealth(payload)) as AiHealthResult,
  }
}

let backend: TransporteIA | null = null
let sustituto: TransporteIA | null | undefined

/** Pruebas: fija el transporte (null = ninguno; undefined = detección normal). */
export function fijarTransporteIA(t: TransporteIA | null | undefined): void {
  sustituto = t
}

function transporteWeb(): TransporteIA | null {
  if (backend) return backend
  // Import diferido de la sesión (Supabase) para no cargarla en escritorio ni en pruebas.
  const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {})
  if (!env.VITE_SUPABASE_ANON_KEY) return null
  const base = (env.VITE_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
  backend = crearTransporteBackend({
    base,
    token: async () => (await import('../backend/sesion')).tokenSesion(),
  })
  return backend
}

/** Transporte activo: Electron si existe; si no, el backend (web con sesión configurada). */
export function transporteIA(): TransporteIA | null {
  if (sustituto !== undefined) return sustituto
  return transporteElectron() ?? transporteWeb()
}

export function iaRemotaDisponible(): boolean {
  return transporteIA() !== null
}
