import { describe, it, expect } from 'vitest'
import { crearEstadoInicial } from '../state/estado-inicial'
import {
  crearComandoRenderCancel,
  crearComandoRenderGetStatus,
  crearComandoRenderStart,
} from './render-commands'
import { renderJobGet } from '../render/job-store'

describe('render commands', () => {
  it('start → getStatus → cancel', () => {
    const estado = crearEstadoInicial()
    const start = crearComandoRenderStart()
    const r = start.handler(estado, { format: 'wav', startSec: 0, endSec: 2 }) as {
      result: { id: string; status: string }
      events: Array<{ nombre: string }>
    }
    expect(r.result.status).toBe('pending')
    expect(r.events.some((e) => e.nombre === 'render.started')).toBe(true)
    const id = r.result.id
    const st = crearComandoRenderGetStatus().handler(estado, { renderJobId: id }) as {
      result: { id: string }
    }
    expect(st.result.id).toBe(id)
    crearComandoRenderCancel().handler(estado, { renderJobId: id })
    expect(renderJobGet(id)?.status).toBe('cancelled')
  })

  it('sin endSec detecta el final del último clip', () => {
    const base = crearEstadoInicial()
    const estado = {
      ...base,
      project: {
        ...base.project,
        bpm: { ...base.project.bpm, valor: 120 },
        tracks: [{ id: 't1', nombre: 'Bajo', clips: [{ id: 'c', inicio: 4, duracion: 60 }] }],
      },
    } as unknown as typeof base
    const r = crearComandoRenderStart().handler(estado, { format: 'mp3', bitrate: 320 }) as {
      result: { id: string; end: { segundos: number }; autoEnd: boolean; contentEndSec: number; bitDepth: number }
    }
    expect(r.result.end.segundos).toBeCloseTo(32)
    expect(r.result.autoEnd).toBe(true)
    expect(r.result.contentEndSec).toBeCloseTo(32)
    expect(r.result.bitDepth).toBe(24)
    crearComandoRenderCancel().handler(estado, { renderJobId: r.result.id })
  })

  it('proyecto vacío: mensaje claro en vez de exportar silencio', () => {
    const estado = crearEstadoInicial()
    expect(() => crearComandoRenderStart().handler({ ...estado, project: { ...estado.project, tracks: [] } }, {})).toThrow(
      /No hay contenido/,
    )
  })

  it('rechaza profundidades, frecuencias y formatos no soportados', () => {
    const estado = crearEstadoInicial()
    expect(() => crearComandoRenderStart().handler(estado, { endSec: 2, bitDepth: 20 })).toThrow(/16, 24 o 32/)
    expect(() => crearComandoRenderStart().handler(estado, { endSec: 2, sampleRate: 22050 })).toThrow(/Hz/)
    expect(() => crearComandoRenderStart().handler(estado, { endSec: 2, format: 'wma' as never })).toThrow(/Formato/)
  })

  it('reject end <= start', () => {
    const estado = crearEstadoInicial()
    expect(() =>
      crearComandoRenderStart().handler(estado, { startSec: 5, endSec: 5 }),
    ).toThrow()
  })
})
