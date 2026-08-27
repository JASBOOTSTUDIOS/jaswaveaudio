/**
 * Comandos automation.* — curvas vol/pan/params en pistas.
 */

import type { CommandDefinition, StateTransition } from '../types/command'
import type { DAWState } from '../types/state'
import type { AutomatizacionInfo, PuntoAutomatizacion } from '../types/entidades'
import type { EventoDominio } from '../events/evento-dominio'
import { sampleAutomation } from '../midi/expression'
import type { MidiAutomationPoint } from '../types/clips'

function ev(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: Date.now(),
    fuente: 'builtin',
    payload: payload as EventoDominio['payload'],
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function toMidiPoints(puntos: PuntoAutomatizacion[]): MidiAutomationPoint[] {
  return puntos.map((p) => ({
    id: String((p as { id?: string }).id ?? newId('ap')),
    tiempo: p.tiempo,
    valor: p.valor,
    curva: p.tipoCurva === 'sostenido' ? 'step' : p.tipoCurva === 'sine' ? 'smooth' : 'linear',
  }))
}

export function sampleTrackAutomation(
  lane: AutomatizacionInfo,
  tiempoSec: number,
): number | null {
  if (!lane.habilitada || !lane.puntos.length) return null
  return sampleAutomation(toMidiPoints(lane.puntos), tiempoSec)
}

export function crearComandoAutomationSetCurve(): CommandDefinition<any> {
  return {
    type: 'automation.setCurve',
    description: 'Define curva de automatización (volumen|paneo|paramId) en una pista',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['trackId', 'parametro', 'puntos'],
      properties: {
        trackId: { type: 'string' },
        parametro: { type: 'string' },
        puntos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tiempo: { type: 'number' },
              valor: { type: 'number' },
              tipoCurva: { type: 'string' },
            },
          },
        },
        habilitada: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ laneId: string }> => {
      const trackId = String(payload.trackId)
      const parametro = String(payload.parametro || 'volumen')
      const rawPuntos = Array.isArray(payload.puntos) ? payload.puntos : []
      if (rawPuntos.length < 1) throw new Error('Se necesitan puntos de automatización')
      const tracks = estado.project.tracks.map((t) => {
        if (t.id !== trackId) return t
        const puntos: PuntoAutomatizacion[] = rawPuntos.map((p: Record<string, unknown>) => ({
          tiempo: Number(p.tiempo ?? 0),
          valor: Number(p.valor ?? 0),
          tipoCurva: (p.tipoCurva as PuntoAutomatizacion['tipoCurva']) || 'lineal',
          suavizado: 0,
          tension: 0,
          seleccionado: false,
        }))
        const existing = (t.automatizaciones ?? []).filter((a) => a.parametro !== parametro)
        const lane: AutomatizacionInfo = {
          id: newId('auto'),
          trackId,
          parametro,
          puntos,
          grabando: false,
          modo: 'touch',
          escalaMinima: 0,
          escalaMaxima: 1,
          suavizado: 0,
          resolucion: 0.01,
          interpolacion: 'lineal',
          habilitada: payload.habilitada !== false,
          color: '#38bdf8',
        }
        return { ...t, automatizaciones: [...existing, lane] }
      })
      const laneId =
        tracks.find((t) => t.id === trackId)?.automatizaciones?.find((a) => a.parametro === parametro)?.id ??
        ''
      return {
        state: {
          ...estado,
          project: { ...estado.project, tracks },
        },
        events: [ev('automation.curveSet', { trackId, parametro, laneId })],
        result: { laneId },
      }
    },
  }
}

export function crearComandoAutomationClear(): CommandDefinition<any> {
  return {
    type: 'automation.clear',
    description: 'Elimina automatización de un parámetro (o todas) en una pista',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['trackId'],
      properties: {
        trackId: { type: 'string' },
        parametro: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ removed: number }> => {
      const trackId = String(payload.trackId)
      const parametro = payload.parametro ? String(payload.parametro) : null
      let removed = 0
      const tracks = estado.project.tracks.map((t) => {
        if (t.id !== trackId) return t
        const before = t.automatizaciones ?? []
        const next = parametro ? before.filter((a) => a.parametro !== parametro) : []
        removed = before.length - next.length
        return { ...t, automatizaciones: next }
      })
      return {
        state: { ...estado, project: { ...estado.project, tracks } },
        events: [ev('automation.cleared', { trackId, parametro, removed })],
        result: { removed },
      }
    },
  }
}

/** Añade/actualiza un punto en la curva (write-on-play / touch). */
export function crearComandoAutomationWritePoint(): CommandDefinition<any> {
  return {
    type: 'automation.writePoint',
    description: 'Escribe un punto de automatización (merge en la curva existente)',
    risk: 'write',
    schema: {
      type: 'object',
      required: ['trackId', 'parametro', 'tiempo', 'valor'],
      properties: {
        trackId: { type: 'string' },
        parametro: { type: 'string' },
        tiempo: { type: 'number' },
        valor: { type: 'number' },
        tolSec: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: (estado: DAWState, payload): StateTransition<{ laneId: string }> => {
      const trackId = String(payload.trackId)
      const parametro = String(payload.parametro || 'volumen')
      const tiempo = Number(payload.tiempo ?? 0)
      const valor = Number(payload.valor ?? 0)
      const tol = Math.max(0.01, Number(payload.tolSec ?? 0.05))
      const tracks = estado.project.tracks.map((t) => {
        if (t.id !== trackId) return t
        const existing = (t.automatizaciones ?? []).filter((a) => a.parametro !== parametro)
        const prev = (t.automatizaciones ?? []).find((a) => a.parametro === parametro)
        let puntos: PuntoAutomatizacion[] = prev?.puntos ? [...prev.puntos] : []
        const hit = puntos.findIndex((p) => Math.abs(p.tiempo - tiempo) <= tol)
        const point: PuntoAutomatizacion = {
          tiempo,
          valor,
          tipoCurva: 'lineal',
          suavizado: 0,
          tension: 0,
          seleccionado: false,
        }
        if (hit >= 0) puntos[hit] = point
        else {
          puntos.push(point)
          puntos.sort((a, b) => a.tiempo - b.tiempo)
        }
        const lane: AutomatizacionInfo = {
          id: prev?.id ?? newId('auto'),
          trackId,
          parametro,
          puntos,
          grabando: true,
          modo: 'touch',
          escalaMinima: parametro === 'paneo' ? -1 : 0,
          escalaMaxima: 1,
          suavizado: 0,
          resolucion: 0.01,
          interpolacion: 'lineal',
          habilitada: true,
          color: '#38bdf8',
        }
        return { ...t, automatizaciones: [...existing, lane] }
      })
      const laneId =
        tracks.find((t) => t.id === trackId)?.automatizaciones?.find((a) => a.parametro === parametro)?.id ??
        ''
      return {
        state: { ...estado, project: { ...estado.project, tracks } },
        events: [ev('automation.pointWritten', { trackId, parametro, tiempo, valor, laneId })],
        result: { laneId },
      }
    },
  }
}
