/** Adaptador del chat del motor de turnos al formato del agente (herramientas nativas). */
import { claveLlamada, esperarConexion } from '@jaswave/host-sdk'
import type { ChatAgente, EngineChatMessage, OpcionesEsperaRed, TurnContext } from '@jaswave/host-sdk'

import { transporteIA } from '../../ia/transporte-ia'
import type { AiSettings } from '../ai-settings'

export type UltimoErrorIA = { error?: string; codigo?: string }

/** Fallos pasajeros del servicio: se reintentan tras esperar (no la cuota agotada ni lo que el pedido hizo mal). */
const PASAJEROS = new Set(['service_unavailable', 'rate_limit', 'timeout', 'connection', 'empty_response'])
/** Espera antes de cada reintento (ms). */
export const ESPERAS_REINTENTO = [4_000, 12_000]
/**
 * Una producción de la banda dura minutos y mueve cientos de llamadas: si el servicio se satura (429, claves en
 * pausa), tirar toda la producción a los 15 s sería absurdo. Se espera como lo haría una persona, cada vez más,
 * pero con un total de unos 2 min 45 s por petición (antes ~7 min): el presupuesto de tiempo de la producción
 * (15 min, tope 30) no admite que una sola petición se coma la mitad. El usuario puede detenerla cuando quiera.
 */
export const ESPERAS_REINTENTO_BANDA = [3_000, 8_000, 20_000, 45_000, 90_000]

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

/** Sondeo real del backend: responde, aunque sea con un error de configuración, = hay conexión. */
export async function sondearConexionIA(): Promise<boolean> {
  try {
    const t = transporteIA()
    if (!t) return false
    const r = await t.salud()
    return r.status !== 'disconnected' && r.errorCode !== 'connection'
  } catch {
    return false
  }
}

/** Pausa por falta de red con los eventos del navegador (`online`) y el sondeo del backend cada 10 s. */
export function redDelNavegador(extra: Partial<Pick<OpcionesEsperaRed, 'alPausar' | 'alReanudar'>> = {}): RedChat {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator
  const ev = globalThis as unknown as { addEventListener?: (n: string, f: () => void) => void; removeEventListener?: (n: string, f: () => void) => void }
  return {
    enLinea: () => nav?.onLine !== false,
    sondear: sondearConexionIA,
    alVolver: (cb) => {
      ev.addEventListener?.('online', cb)
      return () => ev.removeEventListener?.('online', cb)
    },
    ...extra,
  }
}

/** Plan Q: si se pierde internet, la petición NO gasta reintentos: la producción espera y continúa sola al volver. */
export type RedChat = Pick<OpcionesEsperaRed, 'enLinea' | 'sondear' | 'alVolver' | 'alPausar' | 'alReanudar' | 'intervaloMs' | 'dormir'>

export function chatDelMotor(
  ctx: TurnContext,
  cfg: AiSettings,
  ultimoError: UltimoErrorIA,
  o: { delta?: 'principal' | 'nunca'; esperas?: number[]; red?: RedChat } = {},
): ChatAgente {
  const esperas = o.esperas ?? ESPERAS_REINTENTO
  /** Llamadas de herramienta ya entregadas al agente: tras una pausa por red no se vuelven a entregar. */
  const entregadas = new Set<string>()
  return async (p) => {
    let res
    let trasPausa = false
    for (let intento = 0; ; intento++) {
      let conTexto = false
      const onDelta = o.delta !== 'nunca' && p.profundidad === 0 && p.onDelta ? (d: string) => ((conTexto = true), p.onDelta!(d)) : undefined
      try {
        res = await ctx.chat({
          purpose: 'agent',
          system: p.sistema,
          messages: p.mensajes as EngineChatMessage[],
          tools: p.herramientas,
          temperature: cfg.temperature,
          maxTokens: Math.min(Math.max(cfg.maxTokens, 1024), 4096),
          onDelta,
        })
      } catch (e) {
        // Un fallo de red que escapa como excepción se trata igual que uno devuelto.
        if (!o.red || ctx.signal?.aborted) throw e
        res = { success: false, errorCode: 'connection', error: e instanceof Error ? e.message : String(e) } as Awaited<ReturnType<TurnContext['chat']>>
      }
      const sinRed = !res.success && !conTexto && !ctx.signal?.aborted && !!o.red && (res.errorCode === 'connection' || (res.errorCode === 'timeout' && !o.red.enLinea()))
      if (sinRed) {
        console.info('[agente] sin conexión: la producción queda en pausa hasta que vuelva internet')
        const volvio = await esperarConexion({ ...o.red!, signal: ctx.signal })
        if (!volvio || ctx.signal?.aborted) break
        trasPausa = true
        intento-- // la pausa no gasta reintentos
        continue
      }
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
    let llamadas = (res.toolCalls ?? []).map((c) => ({ id: c.id, nombre: c.name, argumentos: (c.arguments ?? {}) as Record<string, unknown> }))
    // Tras una pausa, lo ya entregado antes del corte no se repite (misma herramienta, mismo id y mismos argumentos).
    if (trasPausa) llamadas = llamadas.filter((l) => !entregadas.has(claveLlamada(l)))
    for (const l of llamadas) entregadas.add(claveLlamada(l))
    return {
      ok: res.success,
      texto: res.content ?? '',
      llamadas,
      error: res.budgetMessage ?? res.error,
    }
  }
}
