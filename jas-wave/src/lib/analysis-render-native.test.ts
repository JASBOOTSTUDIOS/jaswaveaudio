/**
 * Medidor con el motor real: solo entra cuando hay plugins que oír y host; si no, respaldo (Web Audio).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearBackendAnalisisNativo, necesitaMotorReal, ventanaRepresentativa } from './analysis-render-native'
import type { BackendAnalisis } from './analysis-render'
import type { DAWState } from '../../../shared/src/types/state'

const estado = (tracks: Array<Record<string, unknown>>, masterPlugins: unknown[] = []) =>
  ({ project: { id: 'p', tracks, master: { plugins: masterPlugins } } }) as unknown as DAWState

describe('analysis-render-native', () => {
  it('necesitaMotorReal: solo con instrumentos o efectos (en pistas o en el máster)', () => {
    assert.equal(necesitaMotorReal(estado([{ id: 'a', plugins: [] }])), false)
    assert.equal(necesitaMotorReal(estado([{ id: 'a', plugins: [{ id: 'vst' }] }])), true)
    assert.equal(necesitaMotorReal(estado([{ id: 'a' }], [{ id: 'lim' }])), true)
  })

  it('ventanaRepresentativa: elige el tramo con más notas; los rangos cortos se miden enteros', () => {
    // 120 BPM (1 beat = 0,5 s): coro denso entre 100 y 130 s (beats 200–260), intro rala.
    const notas = (desde: number, hasta: number, paso: number) => Array.from({ length: Math.floor((hasta - desde) / paso) }, (_, i) => ({ pitch: 60, inicio: i * paso, duracion: 0.25 }))
    const st = {
      project: {
        id: 'p',
        bpm: { valor: 120 },
        tracks: [{ id: 'a', plugins: [], clips: [{ inicio: 0, duracion: 200, notas: notas(0, 200, 8) }, { inicio: 200, duracion: 60, notas: notas(0, 60, 0.5) }] }],
        master: { plugins: [] },
      },
    } as unknown as DAWState
    const v = ventanaRepresentativa(st, 0, 270, 40)
    // Cualquier ventana que cubra el coro entero (empieza entre 90 y 100 s) vale; en empate, la primera.
    assert.ok(v.inicio >= 90 && v.inicio <= 100, `inicio ${v.inicio}`)
    assert.equal(v.fin - v.inicio, 40)
    assert.deepEqual(ventanaRepresentativa(st, 0, 30, 40), { inicio: 0, fin: 30 })
  })

  it('sin host (tests, web) usa el respaldo con la misma petición', async () => {
    const vistas: unknown[] = []
    const respaldo: BackendAnalisis = async (req) => {
      vistas.push(req)
      const vacio = { l: new Float32Array(1), r: new Float32Array(1) }
      return { sampleRate: req.sampleRate, pistas: new Map(), mezcla: vacio, suma: vacio, backend: 'falso' }
    }
    const backend = crearBackendAnalisisNativo({ respaldo })
    const req = { estado: estado([{ id: 'a', plugins: [{ id: 'vst' }] }]), rango: { inicioSeg: 0, finSeg: 2 }, sampleRate: 48000, bypassMaster: false }
    const r = await backend(req)
    assert.equal(r.backend, 'falso')
    assert.equal(vistas[0], req)
  })
})
