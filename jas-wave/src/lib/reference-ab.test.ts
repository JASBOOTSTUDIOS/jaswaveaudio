/**
 * npx tsx --test src/lib/reference-ab.test.ts
 *
 * A/B de referencia (A7b): igualación de loudness y bypass de la cadena master.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { crearEstadoInicial } from '../../../shared/src/state/estado-inicial'
import { crearTiendaDAW, type TiendaDAW } from '../../../shared/src/state/tienda'
import {
  registrarProveedorAnalisis,
  type AnalisisProyecto,
  type RequerimientoAnalisis,
} from '../../../shared/src/audio/analysis-provider'
import type { MedidaPista } from '../../../shared/src/audio/diagnosis'
import type { PluginInfo } from '../../../shared/src/types/entidades'
import { getStateRevision } from '../../../shared/src/state/state-revision'
import { toggleReferenceAb } from './audio-import-agent'

const pluginMaster = (id: string): PluginInfo => ({
  id,
  nombre: 'Límite',
  fabricante: 'JasWave',
  tipo: 'efecto',
  bypass: false,
  parametros: [],
  estado: 'cargado',
  version: '1.0.0',
  wet: 1,
  latencia: 0,
  categoria: 'efecto',
  autor: 'JasWave',
  licencia: 'interno',
  descripcion: 'test',
  ui: { ancho: 320, alto: 180, personalizable: false },
})

function medida(trackId: string, nombre: string, lufs: number): MedidaPista {
  return {
    trackId,
    nombre,
    integrated: lufs,
    truePeakDb: -1,
    peakDb: -1,
    rmsDb: -20,
    crestFactorDb: 12,
    bandas: [],
  }
}

async function crearProyecto(): Promise<{
  tienda: TiendaDAW
  refId: string
  bajoId: string
  llamadas: RequerimientoAnalisis[]
}> {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  const ok = async (tipo: string, payload: unknown) => {
    const r = await tienda.executor.execute(tipo, payload)
    assert.ok(r.success, `${tipo}: ${r.error?.message ?? 'falló'}`)
    return r
  }

  const bajo = await ok('track.create', { nombre: 'Bajo', tipo: 'audio' })
  const bajoId = (bajo.result as { trackId: string }).trackId
  const voz = await ok('track.create', { nombre: 'Voz', tipo: 'audio' })
  const vozId = (voz.result as { trackId: string }).trackId
  const ref = await ok('track.create', { nombre: 'Referencia', tipo: 'audio' })
  const refId = (ref.result as { trackId: string }).trackId

  await ok('clip.create', { pistaId: refId, inicio: 0, duracion: 16 })
  await ok('clip.create', { pistaId: bajoId, inicio: 0, duracion: 16 })
  await ok('clip.create', { pistaId: vozId, inicio: 4, duracion: 8 })
  await ok('track.update', {
    trackId: refId,
    datos: { metadatos: { esReferencia: true, reference: true }, silenciada: true },
  })
  await ok('plugin.insert', { trackId: 'master', plugin: pluginMaster('mfx-1'), position: 0 })

  const llamadas: RequerimientoAnalisis[] = []
  registrarProveedorAnalisis(async (req): Promise<AnalisisProyecto> => {
    llamadas.push(req)
    return {
      revision: req.revision,
      rango: req.rango ?? { inicioSeg: 0, finSeg: 0 },
      pistas: [medida('bajo', 'Bajo', -18), medida('voz', 'Voz', -20), medida(refId, 'Referencia', -24)],
      master: medida('master', 'Master', -18),
      metadatos: { backend: 'falso', tap: 'post', bypassMaster: false, sampleRate: 48000, duracionSeg: 8 },
    }
  })

  return { tienda, refId, bajoId, llamadas }
}

const pista = (t: TiendaDAW, id: string) => t.obtenerEstado().project.tracks.find((x) => x.id === id)!

describe('reference.toggleAB (A7b)', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, '__jaswaveReferenceAb')
  })

  afterEach(() => {
    registrarProveedorAnalisis(null)
    Reflect.deleteProperty(globalThis, '__jaswaveReferenceAb')
  })

  it('iguala loudness, bypasea el master y silencia el resto', async () => {
    const { tienda, refId, bajoId, llamadas } = await crearProyecto()
    const volumenOriginal = pista(tienda, refId).volumen
    const revisionAntes = getStateRevision(tienda.obtenerEstado())

    const r = await toggleReferenceAb(tienda, 'reference')

    assert.equal(r.mode, 'reference')
    assert.equal(r.referenceTrackId, refId)
    // master −18 LUFS, referencia −24 LUFS ⇒ +6 dB sobre la referencia.
    assert.ok(Math.abs((r.gananciaAplicadaDb ?? 0) - 6) < 0.01, `ganancia ${r.gananciaAplicadaDb}`)
    const gananciaLineal = Math.pow(10, 6 / 20)
    assert.ok(
      Math.abs(pista(tienda, refId).volumen - volumenOriginal * gananciaLineal) < 1e-6,
      `volumen ${pista(tienda, refId).volumen}`,
    )
    assert.equal(pista(tienda, refId).silenciada, false)
    assert.equal(pista(tienda, bajoId).silenciada, true)
    assert.equal(tienda.obtenerEstado().project.master.plugins?.[0]?.bypass, true)
    assert.equal(r.bypassMaster, true)

    // Una sola medición y sobre la revisión previa al A/B.
    assert.equal(llamadas.length, 1)
    assert.equal(llamadas[0]!.revision, revisionAntes)
    assert.ok((llamadas[0]!.rango?.finSeg ?? 0) > 0)
    // Todo pasó por el Command System (fader, mute y bypass con undo/auditoría).
    const estado = tienda.obtenerEstado()
    assert.ok(estado.project.tracks.some((t) => t.silenciada))
    assert.equal(estado.project.master.plugins?.[0]?.bypass, true)
  })

  it('restaura fader, mutes y master al volver a la mezcla', async () => {
    const { tienda, refId, bajoId } = await crearProyecto()
    const volumenOriginal = pista(tienda, refId).volumen

    await toggleReferenceAb(tienda, 'reference')
    const r = await toggleReferenceAb(tienda, 'mix')

    assert.equal(r.mode, 'mix')
    assert.equal(pista(tienda, refId).volumen, volumenOriginal)
    assert.equal(r.gananciaAplicadaDb, null)
    assert.equal(pista(tienda, refId).silenciada, true)
    assert.equal(pista(tienda, bajoId).silenciada, false)
    assert.equal(tienda.obtenerEstado().project.master.plugins?.[0]?.bypass, false)
    assert.equal(r.bypassMaster, false)
  })

  it('es idempotente: dos llamadas al mismo modo no duplican la ganancia', async () => {
    const { tienda, refId, llamadas } = await crearProyecto()
    const volumenOriginal = pista(tienda, refId).volumen

    await toggleReferenceAb(tienda, 'reference')
    const segunda = await toggleReferenceAb(tienda, 'reference')

    assert.equal(llamadas.length, 1, 'no vuelve a medir si ya estaba en modo referencia')
    assert.ok(
      Math.abs(pista(tienda, refId).volumen - volumenOriginal * Math.pow(10, 6 / 20)) < 1e-6,
      'la ganancia no se aplica dos veces',
    )
    assert.equal(segunda.gananciaAplicadaDb, 6)

    await toggleReferenceAb(tienda, 'mix')
    assert.equal(pista(tienda, refId).volumen, volumenOriginal, 'el fader vuelve al original')
  })

  it('funciona sin motor de análisis: A/B sin igualación', async () => {
    const { tienda, refId } = await crearProyecto()
    registrarProveedorAnalisis(null)
    const volumenOriginal = pista(tienda, refId).volumen

    const r = await toggleReferenceAb(tienda, 'reference')
    assert.equal(r.gananciaAplicadaDb, null)
    assert.equal(pista(tienda, refId).volumen, volumenOriginal, 'el fader no se toca sin medición')
    assert.equal(r.bypassMaster, true, 'el bypass de master no depende del análisis')

    await toggleReferenceAb(tienda, 'mix')
    assert.equal(pista(tienda, refId).volumen, volumenOriginal)
    assert.equal(tienda.obtenerEstado().project.master.plugins?.[0]?.bypass, false)
  })
})
