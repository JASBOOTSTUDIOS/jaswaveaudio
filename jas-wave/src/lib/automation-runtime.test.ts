/**
 * Tests del muestreo de automatización (vol/pan/params) para bounce offline.
 * Ejecutar: npx tsx --test src/lib/automation-runtime.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AutomatizacionInfo } from '../../../shared/src/types/entidades'
import type { Track } from '../../../shared/src/types/tracks'
import {
  grafoConAutomatizacionBounce,
  hayAutomatizacion,
  publicarAutomatizacionBounce,
  type ContextoAutomatizacionBounce,
} from './automation-runtime'

function lane(parametro: string, puntos: Array<[number, number]>, habilitada = true): AutomatizacionInfo {
  return {
    id: `lane-${parametro}`,
    trackId: 'p1',
    parametro,
    puntos: puntos.map(([tiempo, valor]) => ({
      tiempo,
      valor,
      tipoCurva: 'lineal',
      suavizado: 0,
      tension: 0,
      seleccionado: false,
    })),
    grabando: false,
    modo: 'latch',
    escalaMinima: 0,
    escalaMaxima: 1,
    suavizado: 0,
    resolucion: 0,
    interpolacion: 'lineal',
    habilitada,
    color: '#ffffff',
  }
}

function pista(extra: Partial<Track> & { id: string }): Track {
  return {
    nombre: extra.id,
    tipo: 'audio',
    volumen: 0.8,
    paneo: 0,
    silenciada: false,
    soloActiva: false,
    clips: [],
    ...extra,
  } as Track
}

function ctx(
  tracks: Track[],
  volumenHorneado?: ReadonlySet<string>,
): ContextoAutomatizacionBounce {
  return { tracks, masterPlugins: [], routing: null, volumenHorneado }
}

describe('hayAutomatizacion', () => {
  it('detecta lanes habilitadas con puntos e ignora deshabilitadas o vacías', () => {
    const conVol = pista({ id: 'a', automatizaciones: [lane('volumen', [[0, 0.5]])] })
    const deshabilitada = pista({
      id: 'b',
      automatizaciones: [lane('paneo', [[0, -1]], false)],
    })
    const vacia = pista({ id: 'c', automatizaciones: [lane('paneo', [])] })
    const sinLanes = pista({ id: 'd' })

    assert.equal(hayAutomatizacion([conVol]), true)
    assert.equal(hayAutomatizacion([deshabilitada, vacia, sinLanes]), false)
    assert.equal(hayAutomatizacion([]), false)
  })
})

describe('grafoConAutomatizacionBounce', () => {
  it('muestrea volumen en pistas sin clips y deja el fader base en las que hornean PCM', () => {
    const conClip = pista({
      id: 'audio',
      volumen: 0.8,
      automatizaciones: [lane('volumen', [[0, 0], [2, 1]])],
    })
    const sinClip = pista({
      id: 'midi',
      volumen: 0.8,
      automatizaciones: [lane('volumen', [[0, 0], [2, 1]])],
    })
    const g = grafoConAutomatizacionBounce(
      ctx([conClip, sinClip], new Set(['audio'])),
      1,
    )

    assert.equal(g[0]!.volumen, 0.8)
    assert.equal(g[0]!.paneo, 0)
    assert.ok(Math.abs(g[1]!.volumen - 0.5) < 1e-9)
  })

  it('muestrea paneo siempre (el grafo es su único aplicador)', () => {
    const t = pista({
      id: 'p',
      paneo: 0,
      automatizaciones: [lane('paneo', [[0, -1], [2, 1]])],
    })
    const g = grafoConAutomatizacionBounce(ctx([t]), 1)
    assert.ok(Math.abs(g[0]!.paneo - 0) < 1e-9)

    const g0 = grafoConAutomatizacionBounce(ctx([t]), 0)
    assert.equal(g0[0]!.paneo, -1)
  })

  it('conserva mute/solo y usa valores base sin lanes', () => {
    const t = pista({ id: 'p', silenciada: true, soloActiva: true, volumen: 0.4, paneo: 0.3 })
    const g = grafoConAutomatizacionBounce(ctx([t]), 10)
    assert.equal(g[0]!.silenciada, true)
    assert.equal(g[0]!.soloActiva, true)
    assert.equal(g[0]!.volumen, 0.4)
    assert.equal(g[0]!.paneo, 0.3)
  })
})

describe('publicarAutomatizacionBounce', () => {
  it('publica el grafo y parámetros sin host nativo (sin layout Web Audio)', () => {
    const t = pista({
      id: 'p',
      automatizaciones: [
        lane('volumen', [[0, 0.25]]),
        lane('paneo', [[0, -0.5]]),
      ],
    })
    assert.doesNotThrow(() => publicarAutomatizacionBounce(ctx([t]), 1))
  })
})
