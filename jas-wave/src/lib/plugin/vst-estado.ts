/**
 * Persistencia del estado de plugins VST3 (kit, mezcla, ajustes del usuario): lógica pura, sin dependencias de
 * Electron ni del motor de audio, para poder probarla con node:test.
 *
 * Reglas que protege este módulo (causas reales de «el VST me bota la configuración»):
 *  1. Un slot recién cargado con un estado guardado está "pendiente de restaurar": mientras lo esté NO se
 *     captura su estado vivo (sería el de fábrica) ni se sobrescribe el chunk bueno del proyecto.
 *  2. La restauración se reintenta (el plugin puede tardar en estar listo) y se reintenta también desde el
 *     autoguardado; solo se rinde tras MAX_INTENTOS_RESTAURACION.
 *  3. Si un plugin cambia de cadena/pista (el slot se descarga y se recarga con otro slotId), su estado vivo se
 *     guarda antes de descargar y se aplica al recargar, en lugar del chunk (más viejo) del proyecto.
 *  4. El autoguardado periódico no corre durante el play, no se solapa consigo mismo y nunca lanza.
 */

export const MAX_INTENTOS_RESTAURACION = 5
const ESPERAS_RESTAURACION_MS = [0, 400, 1500]
const TTL_ESTADO_MOVER_MS = 120_000

const pendientes = new Map<string, { intentos: number }>()
const paraMover = new Map<string, { chunk: string; hasta: number }>()

export function marcarRestauracionPendiente(slotId: string): void {
  if (!pendientes.has(slotId)) pendientes.set(slotId, { intentos: 0 })
}

export function restauracionPendiente(slotId: string): boolean {
  return pendientes.has(slotId)
}

export function listarRestauracionesPendientes(): string[] {
  return [...pendientes.keys()]
}

export function marcarRestaurado(slotId: string): void {
  pendientes.delete(slotId)
}

/** Cuenta un intento fallido. Devuelve true si se agotaron (se desbloquea la captura del slot). */
export function registrarIntentoFallido(slotId: string): boolean {
  const p = pendientes.get(slotId)
  if (!p) return false
  p.intentos += 1
  if (p.intentos >= MAX_INTENTOS_RESTAURACION) {
    pendientes.delete(slotId)
    return true
  }
  return false
}

export function olvidarRestauraciones(slotId?: string): void {
  if (slotId) pendientes.delete(slotId)
  else pendientes.clear()
}

export function guardarEstadoParaMover(pluginId: string, chunk: string, ahora = Date.now()): void {
  paraMover.set(pluginId, { chunk, hasta: ahora + TTL_ESTADO_MOVER_MS })
}

/** Estado vivo guardado al descargar el slot de este plugin (si sigue vigente). No lo consume. */
export function verEstadoParaMover(pluginId: string, ahora = Date.now()): string | undefined {
  const e = paraMover.get(pluginId)
  if (!e) return undefined
  if (e.hasta < ahora) {
    paraMover.delete(pluginId)
    return undefined
  }
  return e.chunk
}

export function descartarEstadoParaMover(pluginId: string): void {
  paraMover.delete(pluginId)
}

export function limpiarEstadoParaMover(): void {
  paraMover.clear()
}

export type RestauracionDeps = {
  slotId: string
  /** Chunk a aplicar (el más reciente: estado "para mover" o el del proyecto). */
  chunk: string | undefined
  /** Aplica el chunk en el host (setPluginState). */
  aplicar: (slotId: string, chunk: string) => Promise<boolean>
  /** Fallback sin chunk / si el chunk nunca se aceptó: overlay de parámetros. */
  aplicarParametros?: () => Promise<void>
  esperar?: (ms: number) => Promise<void>
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Restaura el estado de un slot ya cargado. Devuelve true si el chunk fue aceptado (o no había chunk).
 * Si falla, el slot SIGUE pendiente (no se captura su estado de fábrica sobre el del proyecto).
 */
export async function restaurarEstadoSlot(deps: RestauracionDeps): Promise<boolean> {
  const esperar = deps.esperar ?? dormir
  if (!deps.chunk) {
    if (deps.aplicarParametros) await deps.aplicarParametros()
    marcarRestaurado(deps.slotId)
    return true
  }
  for (const ms of ESPERAS_RESTAURACION_MS) {
    if (ms > 0) await esperar(ms)
    let ok = false
    try {
      ok = await deps.aplicar(deps.slotId, deps.chunk)
    } catch {
      ok = false
    }
    if (ok) {
      marcarRestaurado(deps.slotId)
      return true
    }
  }
  registrarIntentoFallido(deps.slotId)
  if (deps.aplicarParametros) {
    try {
      await deps.aplicarParametros()
    } catch {
      /* best-effort */
    }
  }
  return false
}

export type AutosaveDeps = {
  intervaloMs?: number
  /** true si no conviene hacer RPC al host ahora (play en curso, cierre de app…). */
  ocupado: () => boolean
  /** Reintenta restauraciones pendientes (slots cuyo setPluginState falló o llegó tarde). */
  reintentarPendientes: () => Promise<void>
  /** Captura el estado de los slots cargados hacia el proyecto. */
  capturar: () => Promise<unknown>
  /** Inyectables para pruebas. */
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (h: unknown) => void
}

export type AutosaveEstadoVst = {
  start: () => void
  stop: () => void
  /** Un ciclo ahora. Devuelve false si se omitió (ocupado / ya en curso). */
  tick: () => Promise<boolean>
}

export const INTERVALO_AUTOGUARDADO_VST_MS = 15_000

export function crearAutoguardadoEstadoVst(deps: AutosaveDeps): AutosaveEstadoVst {
  let handle: unknown = null
  let enCurso = false
  const setI = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms))
  const clearI = deps.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>))
  const tick = async (): Promise<boolean> => {
    if (enCurso) return false
    let ocupado = false
    try {
      ocupado = deps.ocupado()
    } catch {
      ocupado = true
    }
    if (ocupado) return false
    enCurso = true
    try {
      try {
        await deps.reintentarPendientes()
      } catch (err) {
        console.warn('[vst-autosave] reintento de restauración falló', err)
      }
      try {
        await deps.capturar()
      } catch (err) {
        console.warn('[vst-autosave] captura falló', err)
      }
      return true
    } finally {
      enCurso = false
    }
  }
  return {
    start: () => {
      if (handle) return
      handle = setI(() => void tick(), deps.intervaloMs ?? INTERVALO_AUTOGUARDADO_VST_MS)
    },
    stop: () => {
      if (!handle) return
      clearI(handle)
      handle = null
    },
    tick,
  }
}
