import { describe, expect, it } from 'vitest'
import { crearEstadoInicial } from '../state/estado-inicial'
import { crearTiendaDAW } from '../state/tienda'
import { diagnosticarSonidoPistas, registrarSondaPlugins, type SondaPlugins } from '../audio/diagnostico-sonido'
import type { DAWState } from '../types/state'

async function proyecto(): Promise<{ estado: () => DAWState; ids: string[] }> {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  for (const nombre of ['Piano', 'Bajo']) {
    await tienda.executor.execute('track.create', { nombre, tipo: 'midi' }, 'user')
  }
  const ids = tienda.obtenerEstado().project.tracks.map((t) => t.id)
  for (const id of ids) {
    const r = await tienda.executor.execute(
      'midi.clip.create',
      { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas: [{ pitch: 60, inicio: 0, duracion: 1, velocidad: 90 }] },
      'user',
    )
    expect(r.success).toBe(true)
  }
  return { estado: () => tienda.obtenerEstado(), ids }
}

const conInstrumento: SondaPlugins = () => ({ plugin: { id: 'p1', nombre: 'Piano VST' } as never, listo: true })

describe('diagnosticarSonidoPistas', () => {
  it('detecta notas MIDI sin instrumento y dice cómo cargarlo', async () => {
    const { estado, ids } = await proyecto()
    const d = diagnosticarSonidoPistas(estado(), { sonda: null })
    expect(d.ok).toBe(false)
    const p = d.problemas.find((x) => x.trackId === ids[0] && x.tipo === 'sin_instrumento')
    expect(p?.responsable).toBe('musico')
    expect(p?.solucion).toMatch(/track\.addVstLayer/)
  })

  it('la solución nombra los instrumentos instalados que la app registró', async () => {
    const { estado } = await proyecto()
    registrarSondaPlugins(() => ({ plugin: null }), () => ['JasWave Grand Piano', 'JasWave Electric Bass', 'JasWave Grand Piano'])
    try {
      const p = diagnosticarSonidoPistas(estado()).problemas.find((x) => x.tipo === 'sin_instrumento')
      expect(p?.solucion).toMatch(/Instrumentos instalados: «JasWave Grand Piano», «JasWave Electric Bass»\./)
    } finally {
      registrarSondaPlugins(null)
    }
  })

  it('instrumento que no cargó o sigue cargando', async () => {
    const { estado, ids } = await proyecto()
    const d = diagnosticarSonidoPistas(estado(), {
      sonda: (t) => (t.id === ids[0] ? { plugin: { id: 'x', nombre: 'Roto' } as never, error: 'Plugin en cuarentena.' } : { plugin: { id: 'y', nombre: 'Lento' } as never, listo: false }),
    })
    expect(d.problemas.map((p) => p.tipo).sort()).toEqual(['instrumento_cargando', 'instrumento_error'])
    expect(d.problemas.find((p) => p.tipo === 'instrumento_error')?.solucion).toMatch(/track\.addVstLayer.*pluginInstanceId "x"/)
    expect(d.ok).toBe(false)
  })

  it('mute, solo de otra pista y faders bajos o desequilibrados', async () => {
    const { estado, ids } = await proyecto()
    const st = estado()
    const [a, b] = st.project.tracks
    const mod = (x: object, y: object): DAWState => ({ ...st, project: { ...st.project, tracks: [{ ...a!, ...x }, { ...b!, ...y }] } }) as DAWState
    const tipos = (s: DAWState) => diagnosticarSonidoPistas(s, { sonda: conInstrumento }).problemas.map((p) => `${p.trackId === ids[0] ? 'A' : 'B'}:${p.tipo}`)
    expect(diagnosticarSonidoPistas(st, { sonda: conInstrumento })).toMatchObject({ ok: true, problemas: [] })
    expect(tipos(mod({ silenciada: true }, {}))).toEqual(['A:silenciada'])
    expect(tipos(mod({}, { soloActiva: true }))).toEqual(['A:tapada_por_solo'])
    expect(tipos(mod({ volumen: 0.01 }, {}))).toEqual(['A:volumen_muy_bajo'])
    const des = diagnosticarSonidoPistas(mod({ volumen: 0.08 }, {}), { sonda: conInstrumento })
    expect(des.problemas.map((p) => p.tipo)).toEqual(['volumen_desequilibrado'])
    expect(des.ok).toBe(true)
  })

  it('pistas sin partes no se revisan y el comando está registrado', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { nombre: 'Vacía', tipo: 'midi' }, 'user')
    const r = await tienda.executor.execute('analysis.trackSound', {}, 'ai')
    expect(r.success).toBe(true)
    expect(r.result).toMatchObject({ ok: true, pistasRevisadas: 0 })
  })
})
