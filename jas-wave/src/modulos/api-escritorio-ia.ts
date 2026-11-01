/**
 * Puente de IA del escritorio para módulos (M4): el gateway local de Electron (modelos propios que se
 * ejecutan en el equipo), el almacén cifrado de credenciales, la persistencia de ejecuciones del agente y el
 * registro de errores. En la web devuelven null: el módulo usa el backend. Los módulos nunca usan
 * `window.electron` directamente.
 */

import type { AiChatRequest, AiChatResult, AiHealthResult } from '../lib/ia/proveedores'

export type EventoStreamEscritorio = { type: 'delta' | 'done' | string; text?: string; success?: boolean }

export type PuenteIAEscritorio = {
  chat: (req: AiChatRequest) => Promise<AiChatResult>
  chatStream?: (req: AiChatRequest, onEvent: (e: EventoStreamEscritorio) => void) => Promise<AiChatResult>
  cancelar: (requestId: string) => Promise<boolean>
  salud: (payload: unknown) => Promise<AiHealthResult>
  /** Guarda (o borra con '') la clave de un proveedor en el almacén cifrado del equipo (DPAPI). */
  guardarCredencial: (proveedorId: string, clave: string) => Promise<void>
  /** Pruebas (JASWAVE_AI_MOCK en el proceso main): usar el proveedor simulado local. */
  modoPruebas: () => Promise<boolean>
}

export function puenteIAEscritorio(): PuenteIAEscritorio | null {
  const e = typeof window !== 'undefined' ? window.electron : undefined
  if (!e?.aiChat) return null
  return {
    chat: (req) => e.aiChat(req),
    ...(e.aiChatStream ? { chatStream: (req: AiChatRequest, onEvent: (ev: EventoStreamEscritorio) => void) => e.aiChatStream!(req, onEvent) } : {}),
    cancelar: async (id) => Boolean(await e.aiChatCancel?.(id)),
    salud: async (payload) => (await e.aiHealth(payload)) as AiHealthResult,
    guardarCredencial: async (id, clave) => {
      await e.aiCredSet?.(id, clave)
    },
    modoPruebas: async () => Boolean(await e.aiMockActivo?.()),
  }
}

export type MetaEjecucionAgente = { id: string; conversationId: string; messageId?: string; status: string; mode?: string; updatedAt: number; userText: string }

export type AlmacenEjecucionesAgente = {
  guardar: (id: string, json: string) => Promise<{ ok: boolean; error?: string }>
  cargar: (id: string) => Promise<string | null>
  listar: (limite?: number) => Promise<MetaEjecucionAgente[]>
  borrar: (id: string) => Promise<boolean>
}

/** Ejecuciones del agente persistidas en el equipo (userData/agent-runs); null fuera del escritorio. */
export function almacenEjecucionesAgente(): AlmacenEjecucionesAgente | null {
  const e = typeof window !== 'undefined' ? window.electron : undefined
  if (!e?.agentRunSave || !e.agentRunLoad || !e.agentRunList || !e.agentRunDelete) return null
  return {
    guardar: (id, json) => e.agentRunSave!(id, json),
    cargar: (id) => e.agentRunLoad!(id),
    listar: async (limite) => (await e.agentRunList!(limite)) ?? [],
    borrar: (id) => e.agentRunDelete!(id),
  }
}

/** Registra un error en el log de la app (escritorio) o en la consola (web). */
export function registrarError(origen: string, mensaje: string): void {
  const e = typeof window !== 'undefined' ? window.electron : undefined
  if (e?.logError) void e.logError(origen, mensaje)
  else console.warn(`[${origen}] ${mensaje}`)
}
