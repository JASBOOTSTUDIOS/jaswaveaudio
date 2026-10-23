/**
 * Transporte del asistente (M1/M2). Cada petición va según su proveedor (`providerId`):
 * - Proveedores del admin y propios de ejecución en servidor → gateway `/ia` del backend con el JWT de
 *   la sesión. URL y clave las pone el servidor; aquí solo viajan mensajes, herramientas, opciones, el id
 *   del proveedor y el modelo elegido.
 * - Modelos propios de ejecución local (solo escritorio) → gateway de Electron; la clave se descarga del
 *   backend al almacén cifrado de main (ver catalogo-ia.ts) y main la inyecta por `providerId`.
 */

import type { AiChatRequest, AiChatResult, AiErrorCode, AiHealthResult } from '../ai-settings'
import { esProveedorLocal, prepararCredencialLocal, proveedorDelCatalogo } from './catalogo-ia'

export type EventoStreamIA = { type: 'delta' | 'done' | string; text?: string; success?: boolean }

export type TransporteIA = {
  origen: 'electron' | 'backend' | 'mixto'
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Solo los campos que el backend acepta: nunca host ni clave. */
function cuerpoChat(req: AiChatRequest) {
  return {
    messages: req.messages,
    ...(req.providerId && UUID.test(req.providerId) ? { proveedorId: req.providerId } : {}),
    ...(req.model ? { model: req.model } : {}),
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
    async salud(payload) {
      const id = (payload as { providerId?: string } | undefined)?.providerId
      const r = await pedir(`/ia/estado${id && UUID.test(id) ? `?proveedorId=${encodeURIComponent(id)}` : ''}`, { method: 'GET' })
      if (!(r instanceof Response)) return { status: r.errorCode === 'unauthorized' ? 'misconfigured' : 'disconnected', models: [], ...(r.error ? { error: r.error } : {}), ...(r.hint ? { hint: r.hint } : {}) }
      if (!r.ok) {
        const e = await errorHttp(r)
        return { status: 'disconnected', models: [], ...(e.error ? { error: e.error } : {}) }
      }
      const est = (await r.json()) as EstadoIABackend & { mensaje?: string }
      const sinAcceso = est.motivo === 'sin_permiso' || est.motivo === 'ia_no_configurada' || est.motivo === 'proveedor_no_encontrado'
      return {
        status: est.disponible ? 'healthy' : sinAcceso ? 'misconfigured' : 'disconnected',
        models: est.modelos ?? [],
        ...(est.proveedor ? { provider: est.proveedor } : {}),
        ...(est.motivo ? { error: est.mensaje ?? est.motivo } : {}),
        ...(sinAcceso ? { hint: 'Pide a tu administrador acceso al asistente o a este modelo.' } : {}),
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

/**
 * Enruta cada petición: modelos propios locales → Electron (con su credencial preparada); el resto →
 * backend. Exportado para pruebas.
 */
export function crearTransporteMixto(
  backendT: TransporteIA | null,
  electronT: TransporteIA | null,
  preparar: typeof prepararCredencialLocal = prepararCredencialLocal,
): TransporteIA | null {
  if (!backendT && !electronT) return null
  const sinRuta = (local: boolean) =>
    local
      ? fallo('Este modelo propio se ejecuta en tu equipo: úsalo desde JasWave Desktop.', 'not_available')
      : fallo('Inicia sesión en tu cuenta JasWave para usar el asistente.', 'unauthorized', 'Cuenta → Iniciar sesión')

  /** Prepara la petición local: credencial en main y URL/tipo vigentes del catálogo. */
  async function local(req: AiChatRequest): Promise<AiChatRequest | AiChatResult> {
    const p = proveedorDelCatalogo(req.providerId)!
    const r = await preparar(p)
    if (!r.ok) return fallo(r.error, r.estado === 403 ? 'forbidden' : 'not_available', 'Pide a tu administrador permiso para usar modelos propios.')
    const { apiKey: _sin, ...sinClave } = req
    return {
      ...sinClave,
      kind: r.proveedor.tipo as AiChatRequest['kind'],
      baseUrl: r.proveedor.baseUrl ?? req.baseUrl,
      ...(r.proveedor.custom ? { custom: r.proveedor.custom as AiChatRequest['custom'] } : {}),
    }
  }
  const esLocal = (id?: string) => esProveedorLocal(proveedorDelCatalogo(id))

  return {
    origen: backendT && electronT ? 'mixto' : backendT ? 'backend' : 'electron',
    async chat(req) {
      if (!esLocal(req.providerId)) return backendT ? backendT.chat(req) : sinRuta(false)
      if (!electronT) return sinRuta(true)
      const listo = await local(req)
      return 'messages' in listo ? electronT.chat(listo) : listo
    },
    ...(backendT?.chatStream || electronT?.chatStream
      ? {
          async chatStream(req: AiChatRequest, onEvent: (e: EventoStreamIA) => void) {
            if (!esLocal(req.providerId)) {
              if (!backendT) return sinRuta(false)
              return backendT.chatStream ? backendT.chatStream(req, onEvent) : backendT.chat(req)
            }
            if (!electronT) return sinRuta(true)
            const listo = await local(req)
            if (!('messages' in listo)) return listo
            return electronT.chatStream ? electronT.chatStream(listo, onEvent) : electronT.chat(listo)
          },
        }
      : {}),
    async cancelar(id) {
      const r = await Promise.all([backendT?.cancelar(id), electronT?.cancelar(id)])
      return r.some(Boolean)
    },
    async salud(payload) {
      const id = (payload as { providerId?: string } | undefined)?.providerId
      if (!esLocal(id)) {
        if (backendT) return backendT.salud(payload)
        return { status: 'misconfigured', models: [], error: 'Inicia sesión en tu cuenta JasWave para usar el asistente.' }
      }
      if (!electronT) return { status: 'misconfigured', models: [], error: 'Este modelo propio solo funciona en JasWave Desktop.' }
      const p = proveedorDelCatalogo(id)!
      const r = await preparar(p)
      if (!r.ok) return { status: 'misconfigured', models: [], error: r.error }
      return electronT.salud({ ...(payload as object), kind: r.proveedor.tipo, baseUrl: r.proveedor.baseUrl, providerId: p.id })
    },
  }
}

let mixto: { clave: string; t: TransporteIA | null } | null = null

/** Transporte activo: backend (con sesión configurada) y, en escritorio, Electron para modelos propios locales. */
export function transporteIA(): TransporteIA | null {
  if (sustituto !== undefined) return sustituto
  const b = transporteWeb()
  const e = transporteElectron()
  const clave = `${b ? 1 : 0}${e ? 1 : 0}`
  if (mixto?.clave !== clave) mixto = { clave, t: crearTransporteMixto(b, e) }
  return mixto.t
}

export function iaRemotaDisponible(): boolean {
  return transporteIA() !== null
}
