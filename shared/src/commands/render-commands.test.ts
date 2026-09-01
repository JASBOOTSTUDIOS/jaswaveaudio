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

  it('reject end <= start', () => {
    const estado = crearEstadoInicial()
    expect(() =>
      crearComandoRenderStart().handler(estado, { startSec: 5, endSec: 5 }),
    ).toThrow()
  })
})
