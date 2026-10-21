/**
 * npx tsx --test src/lib/analysis-render.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial } from '../../../shared/src/state/estado-inicial'
import { registrarProveedorAnalisis } from '../../../shared/src/audio/analysis-provider'
import { crearComandoAnalysisDiagnose, crearComandoAnalysisMix } from '../../../shared/src/commands/analysis-commands'
import {
  crearServicioAnalisis,
  type BackendAnalisis,
  type ResultadoBackendAnalisis,
} from './analysis-render'

function estadoConPistas(): ReturnType<typeof crearEstadoInicial> {
  const base = crearEstadoInicial() as ReturnType<typeof crearEstadoInicial>
  const pistas = [
    { id: 'bajo', nombre: 'Bajo', volumen: 0.8, paneo: 0 },
    { id: 'voz', nombre: 'Voz', volumen: 0.5, paneo: 0.2 },
  ]
  return {
    ...base,
    project: {
      ...base.project,
      tracks: pistas.map((p) => ({ id: p.id, nombre: p.nombre, volumen: p.volumen, paneo: p.paneo })) as never,
    },
  }
}

/** Backend falso: 2 s de seno por pista a distinta frecuencia y nivel. */
function backendFalso(llamadas: { count: number }): BackendAnalisis {
  return async (req): Promise<ResultadoBackendAnalisis> => {
    llamadas.count++
    const frames = Math.max(1, Math.round((req.rango.finSeg - req.rango.inicioSeg) * req.sampleRate))
    const pistas = new Map<string, { l: Float32Array; r: Float32Array }>()
    const freqs: Record<string, number> = { bajo: 60, voz: 1000 }
    const gains: Record<string, number> = { bajo: 0.2, voz: 0.1 }
    for (const [id, freq] of Object.entries(freqs)) {
      const l = new Float32Array(frames)
      const r = new Float32Array(frames)
      const g = gains[id] ?? 0.1
      for (let i = 0; i < frames; i++) {
        const v = Math.sin((2 * Math.PI * freq * i) / req.sampleRate) * g
        l[i] = v
        r[i] = v
      }
      pistas.set(id, { l, r })
    }
    const sumaL = new Float32Array(frames)
    const sumaR = new Float32Array(frames)
    for (const p of pistas.values()) {
      for (let i = 0; i < frames; i++) {
        sumaL[i] = sumaL[i]! + p.l[i]!
        sumaR[i] = sumaR[i]! + p.r[i]!
      }
    }
    return {
      sampleRate: req.sampleRate,
      pistas,
      mezcla: { l: sumaL, r: sumaR },
      suma: { l: sumaL, r: sumaR },
      backend: 'falso',
      pluginsProcesados: false,
    }
  }
}

describe('servicio de análisis (A7b)', () => {
  it('mide por pista y devuelve master y suma', async () => {
    const estado = estadoConPistas()
    const llamadas = { count: 0 }
    const servicio = crearServicioAnalisis({
      obtenerEstado: () => estado as never,
      backend: backendFalso(llamadas),
    })
    const analisis = await servicio.proveedor({
      revision: 'r1',
      rango: { inicioSeg: 0, finSeg: 2 },
    })
    assert.equal(analisis.pistas.length, 2)
    assert.deepEqual(
      analisis.pistas.map((p) => p.trackId),
      ['bajo', 'voz'],
    )
    assert.equal(analisis.master.trackId, 'master')
    assert.equal(analisis.suma?.trackId, 'suma')
    // El bajo (60 Hz, más fuerte) debe estar por encima de la voz en LUFS.
    const bajo = analisis.pistas.find((p) => p.trackId === 'bajo')!
    const voz = analisis.pistas.find((p) => p.trackId === 'voz')!
    assert.ok(bajo.integrated > voz.integrated, `bajo ${bajo.integrated} vs voz ${voz.integrated}`)
    assert.equal(llamadas.count, 1)
  })

  it('cachea por revisión: la segunda petición no vuelve a renderizar', async () => {
    const estado = estadoConPistas()
    const llamadas = { count: 0 }
    const servicio = crearServicioAnalisis({
      obtenerEstado: () => estado as never,
      backend: backendFalso(llamadas),
    })
    const req = { revision: 'r1', rango: { inicioSeg: 0, finSeg: 2 } }
    await servicio.proveedor(req)
    const segundo = await servicio.proveedor(req)
    assert.equal(llamadas.count, 1)
    assert.equal(segundo.metadatos.cache, true)
    assert.equal(servicio.tamanoCache(), 1)
  })

  it('una revisión nueva vuelve a renderizar', async () => {
    const estado = estadoConPistas()
    const llamadas = { count: 0 }
    const servicio = crearServicioAnalisis({
      obtenerEstado: () => estado as never,
      backend: backendFalso(llamadas),
    })
    await servicio.proveedor({ revision: 'r1', rango: { inicioSeg: 0, finSeg: 2 } })
    await servicio.proveedor({ revision: 'r2', rango: { inicioSeg: 0, finSeg: 2 } })
    assert.equal(llamadas.count, 2)
  })

  it('borra los temporales que deja el backend', async () => {
    const estado = estadoConPistas()
    const borrados: string[] = []
    const servicio = crearServicioAnalisis({
      obtenerEstado: () => estado as never,
      backend: async (req) => {
        const base = await backendFalso({ count: 0 })(req)
        return { ...base, temporales: ['/tmp/a.wav'] }
      },
      borrarTemporales: (rutas) => {
        borrados.push(...rutas)
      },
    })
    await servicio.proveedor({ revision: 'r1', rango: { inicioSeg: 0, finSeg: 2 } })
    assert.deepEqual(borrados, ['/tmp/a.wav'])
  })
})

describe('comandos analysis.* con el servicio real', () => {
  it('analysis.mix y analysis.diagnose funcionan con el servicio inyectado', async () => {
    const estado = estadoConPistas()
    const servicio = crearServicioAnalisis({
      obtenerEstado: () => estado as never,
      backend: backendFalso({ count: 0 }),
    })
    registrarProveedorAnalisis(servicio.proveedor)
    try {
      const mix = await crearComandoAnalysisMix().handler(estado as never, {
        inicioSeg: 0,
        finSeg: 2,
      })
      assert.equal((mix.result as { pistas: unknown[] }).pistas.length, 2)

      const diag = await crearComandoAnalysisDiagnose().handler(estado as never, {
        inicioSeg: 0,
        finSeg: 2,
      })
      const res = diag.result as { diagnostico: unknown[]; resumen: { criticos: number } }
      assert.ok(Array.isArray(res.diagnostico))
      assert.equal(typeof res.resumen.criticos, 'number')
    } finally {
      registrarProveedorAnalisis(null)
    }
  })
})
