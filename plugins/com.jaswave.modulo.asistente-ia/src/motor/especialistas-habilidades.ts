/**
 * Habilidades ejecutables de los especialistas: compilación (lenguaje natural → procedimiento JSON)
 * y conversión a `Habilidad` para que el turno del agente las elija con `elegirHabilidad`.
 */
import {
  AGENT_ONLY_ACTIONS,
  compilarHabilidad,
  habilidadDesdeProcedimiento,
  instruccionesCompactasProcedimiento,
  mensajesCompilarHabilidad,
  validarProcedimiento,
} from '@jaswave/host-sdk'
import type { Habilidad, HerramientaCatalogo, ProcedimientoHabilidad, ResultadoCompilacion } from '@jaswave/host-sdk'

import { iaRemotaDisponible, transporteIA } from '../ia/transporte-ia'
import { allAgentToolSchemas } from './agent-tool-schemas'
import { aiChatWithFallback, loadAiSettings } from './ai-settings'
import { cargarEspecialistas, type EspecialistaConfig } from './especialistas-storage'

/** Catálogo real de herramientas del agente (nombre, descripción, schema y ejemplo). */
export function catalogoHerramientasAgente(): HerramientaCatalogo[] {
  const ejemplos = new Map(AGENT_ONLY_ACTIONS.map((a) => [a.type, a.examplePayload]))
  return allAgentToolSchemas().map((t) => {
    const h: HerramientaCatalogo = { type: t.name, description: t.description }
    if (t.parameters && typeof t.parameters === 'object') h.schema = t.parameters as Record<string, unknown>
    const ej = ejemplos.get(t.name)
    if (ej) h.examplePayload = ej
    return h
  })
}

export type OpcionesCompilar = {
  catalogo?: HerramientaCatalogo[]
  signal?: AbortSignal
  /** Inyectable en pruebas; por defecto el proveedor activo con fallback. */
  chat?: (mensajes: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string | null>
}

async function chatPorDefecto(mensajes: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal): Promise<string | null> {
  const transporte = iaRemotaDisponible() ? transporteIA() : null
  if (!transporte) return null
  const cfg = loadAiSettings()
  try {
    const r = await aiChatWithFallback((x) => transporte.chat(x), mensajes, {
      temperature: 0.1,
      maxTokens: Math.min(Math.max(cfg.maxTokens, 1200), 2500),
      settings: cfg,
      abort: signal,
      meta: { purpose: 'reasoning', role: 'compilador-habilidades' },
    })
    return r.success ? (r.content ?? null) : null
  } catch {
    return null
  }
}

/**
 * Compila una habilidad descrita en lenguaje natural con UNA llamada al modelo activo; si no hay
 * modelo o la respuesta no sirve, usa el compilador local. Nunca devuelve herramientas inventadas.
 */
export async function compilarHabilidadConModelo(texto: string, opciones: OpcionesCompilar = {}): Promise<ResultadoCompilacion> {
  const catalogo = opciones.catalogo ?? catalogoHerramientasAgente()
  const mensajes = mensajesCompilarHabilidad(texto, catalogo)
  const respuesta = await (opciones.chat ? opciones.chat(mensajes) : chatPorDefecto(mensajes, opciones.signal)).catch(() => null)
  return compilarHabilidad(texto, catalogo, respuesta)
}

/**
 * Habilidades ejecutables de los especialistas activos, listas para
 * `elegirHabilidad(ctx, [...HABILIDADES, ...habilidadesDeEspecialistas()])`.
 * Re-valida cada procedimiento contra el catálogo actual (descarta herramientas que ya no existan).
 */
export function habilidadesDeEspecialistas(
  config: readonly EspecialistaConfig[] = cargarEspecialistas(),
  catalogo?: HerramientaCatalogo[],
): Habilidad[] {
  const out: Habilidad[] = []
  const vistos = new Set<string>()
  let cat = catalogo
  for (const esp of config) {
    if (!esp.activo || !esp.procedimientos?.length) continue
    for (const guardado of esp.procedimientos) {
      cat ??= catalogoHerramientasAgente()
      const { procedimiento } = validarProcedimiento(guardado, cat, { textoUsuario: guardado.descripcionOriginal })
      if (!procedimiento) continue
      const id = `${esp.id}:${procedimiento.id}`
      if (vistos.has(id)) continue
      vistos.add(id)
      const base = habilidadDesdeProcedimiento({ ...procedimiento, id: guardado.id || procedimiento.id })
      out.push({ ...base, id, nombre: `${procedimiento.nombre} (@${esp.nombre})` })
    }
  }
  return out
}

/** Bloque compacto (para el prompt de sistema) con las instrucciones de las habilidades del especialista. */
export function instruccionesHabilidadesEspecialista(esp: EspecialistaConfig, max = 900): string {
  const procs: ProcedimientoHabilidad[] = esp.procedimientos ?? []
  if (!procs.length) return ''
  const txt = procs.map((p) => instruccionesCompactasProcedimiento(p, 420)).join('\n')
  return txt.length > max ? `${txt.slice(0, max - 1)}…` : txt
}
