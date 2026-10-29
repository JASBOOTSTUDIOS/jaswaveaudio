/** Adaptador del chat del motor de turnos al formato del agente (herramientas nativas). */
import type { ChatAgente, EngineChatMessage, TurnContext } from '@jaswave/host-sdk'

import type { AiSettings } from '../ai-settings'

export type UltimoErrorIA = { error?: string; codigo?: string }

/** Fallos pasajeros del servicio: se reintentan tras esperar (no la cuota agotada ni lo que el pedido hizo mal). */
const PASAJEROS = new Set(['service_unavailable', 'rate_limit', 'timeout', 'connection', 'empty_response'])
/** Espera antes de cada reintento (ms). */
export const ESPERAS_REINTENTO = [4_000, 12_000]
/**
 * Una producción de la banda dura una hora y mueve cientos de llamadas: si el servicio se satura (429, claves en
 * pausa), tirar toda la producción a los 16 s sería absurdo. Se espera como lo haría una persona: cada vez más,
 * hasta unos 7 minutos en total; el usuario puede detenerla cuando quiera.
 */
export const ESPERAS_REINTENTO_BANDA = [4_000, 12_000, 30_000, 60_000, 120_000, 180_000]

export function esFalloPasajero(res: { success: boolean; errorCode?: string; budgetMessage?: string; error?: string }): boolean {
  if (res.success || res.budgetMessage) return false
  if (/cr[eé]ditos|cuota/i.test(res.error ?? '')) return false
  return PASAJEROS.has(res.errorCode ?? '')
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok) => {
    if (signal?.aborted) return ok()
    const t = setTimeout(ok, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), ok()), { once: true })
  })
}

export function chatDelMotor(
  ctx: TurnContext,
  cfg: AiSettings,
  ultimoError: UltimoErrorIA,
  o: { delta?: 'principal' | 'nunca'; esperas?: number[] } = {},
): ChatAgente {
  const esperas = o.esperas ?? ESPERAS_REINTENTO
  return async (p) => {
    let res
    for (let intento = 0; ; intento++) {
      let conTexto = false
      const onDelta = o.delta !== 'nunca' && p.profundidad === 0 && p.onDelta ? (d: string) => ((conTexto = true), p.onDelta!(d)) : undefined
      res = await ctx.chat({
        purpose: 'agent',
        system: p.sistema,
        messages: p.mensajes as EngineChatMessage[],
        tools: p.herramientas,
        temperature: cfg.temperature,
        maxTokens: Math.min(Math.max(cfg.maxTokens, 1024), 4096),
        onDelta,
      })
      // Una producción larga no debe caerse entera por un pico de carga: se espera y se repite
      // (salvo si ya se mostró texto o el usuario detuvo el turno).
      if (!esFalloPasajero(res) || conTexto || intento >= esperas.length || ctx.signal?.aborted) break
      console.info(`[agente] el modelo no respondió (${res.errorCode}); reintento ${intento + 1} en ${esperas[intento]! / 1000} s`)
      await esperar(esperas[intento]!, ctx.signal)
      if (ctx.signal?.aborted) break
    }
    if (!res.success) {
      ultimoError.error = res.budgetMessage ?? res.error
      ultimoError.codigo = res.errorCode
    }
    return {
      ok: res.success,
      texto: res.content ?? '',
      llamadas: (res.toolCalls ?? []).map((c) => ({ id: c.id, nombre: c.name, argumentos: c.arguments ?? {} })),
      error: res.budgetMessage ?? res.error,
    }
  }
}
