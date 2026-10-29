/**
 * Producción worship de punta a punta contra el ejecutor real y una medición simulada que reacciona a los
 * volúmenes de pista y del master.   npx tsx --test src/lib/worship-build.test.ts
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import { executeDawActions, type DawAction } from './ai-daw-agent'
import { reportProjectBuffersSettled, reportProjectDevice, reportProjectHost, reportProjectPluginsSettled } from './project-ready'
import { registrarProveedorAnalisis, type AnalisisProyecto } from '../../../shared/src/audio/analysis-provider'
import type { MedidaPista } from '../../../shared/src/audio/diagnosis'
import {
  OBJETIVO_LUFS_POR_ROL,
  PLUGIN_POR_ROL,
  calcularAjustesBalance,
  especDesdePrompt,
  producirWorship,
  sinAudicion,
  type AccionBuild,
  type EjecutarAcciones,
  type MedicionMezcla,
  type PasoBuild,
} from './worship-build'
import type { RolWorship } from '../../../shared/src/music/worship'

const db = (l: number) => 20 * Math.log10(l)

function entorno(opts: { pluginsInstalados?: string[] } = {}) {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  const instalados = new Set(opts.pluginsInstalados ?? Object.values(PLUGIN_POR_ROL))
  const log: AccionBuild[] = []
  const ejecutar: EjecutarAcciones = async (acciones) => {
    const out = []
    for (const a of acciones) {
      log.push(a)
      if (a.type === 'plugin.insert') {
        const nombre = String(a.payload.nombre)
        out.push({ type: a.type, success: instalados.has(nombre), message: instalados.has(nombre) ? undefined : `Plugin no está en el catálogo: ${nombre}` })
        continue
      }
      const r = await tienda.executor.execute(a.type, a.payload)
      out.push({ type: a.type, success: r.success, message: r.error?.message, data: r.result })
    }
    return out
  }
  const leerVolumen = (id: string) => tienda.obtenerEstado().project.tracks.find((t) => t.id === id)?.volumen ?? 1
  return { tienda, ejecutar, leerVolumen, log }
}

/** Medición simulada: cada pista suena `base` LUFS a volumen 1; el master es la suma con su ganancia. */
function medirSimulado(tienda: ReturnType<typeof entorno>['tienda'], base: Record<RolWorship, number>, rolDe: (id: string) => RolWorship | undefined) {
  return async (): Promise<MedicionMezcla> => {
    const st = tienda.obtenerEstado().project
    const pistas = st.tracks.map((t) => {
      const rol = rolDe(t.id)
      return { trackId: t.id, integrated: rol ? base[rol] + db(t.volumen) : -120 }
    })
    const potencia = pistas.reduce((a, p) => a + (p.integrated > -100 ? Math.pow(10, p.integrated / 10) : 0), 0)
    const suma = 10 * Math.log10(Math.max(potencia, 1e-12))
    const integrated = suma + db(st.master.volumen)
    return { pistas, master: { integrated, truePeakDb: integrated + 11 } } // crest fijo de 11 dB
  }
}

function medidaCompleta(trackId: string, integrated: number, truePeakDb: number): MedidaPista {
  return { trackId, nombre: trackId, integrated, truePeakDb, peakDb: truePeakDb, rmsDb: integrated, crestFactorDb: 11, bandas: [] }
}

/** Registra el proveedor global de análisis (lo que usa master.normalizar) apoyado en la medición simulada. */
function registrarProveedor(medir: () => Promise<MedicionMezcla>) {
  registrarProveedorAnalisis(async (req): Promise<AnalisisProyecto> => {
    const m = await medir()
    return {
      revision: req.revision,
      rango: { inicioSeg: 0, finSeg: 10 },
      pistas: m.pistas.map((p) => medidaCompleta(p.trackId, p.integrated, p.integrated + 11)),
      master: medidaCompleta('master', m.master.integrated, m.master.truePeakDb),
      metadatos: { backend: 'simulado', tap: 'post', bypassMaster: false, sampleRate: 48000, duracionSeg: 10 },
    }
  })
}
afterEach(() => registrarProveedorAnalisis(null))

const BASE: Record<RolWorship, number> = { bateria: -14, bajo: -19, melodia: -20, piano: -22, guitarra: -18, cuerdas: -33, pad: -24 }

describe('calcularAjustesBalance', () => {
  it('acota el paso, respeta la tolerancia y omite pistas silenciosas', () => {
    const med: MedicionMezcla = {
      pistas: [
        { trackId: 'a', integrated: -10 }, // objetivo bateria -21 → −11 dB, acotado a −9
        { trackId: 'b', integrated: OBJETIVO_LUFS_POR_ROL.bajo + 0.5 }, // dentro de tolerancia
        { trackId: 'c', integrated: -120 }, // silenciosa
        { trackId: 'd', integrated: Number.NaN },
        { trackId: 'e', integrated: -40 }, // pad objetivo −31 → +9
      ],
      master: { integrated: -14, truePeakDb: -3 },
    }
    const aj = calcularAjustesBalance(med, { a: 'bateria', b: 'bajo', c: 'piano', d: 'guitarra', e: 'pad' })
    assert.deepEqual(aj.map((x) => [x.trackId, x.deltaDb]), [['a', -9], ['e', 9]])
  })
})

describe('especDesdePrompt', () => {
  it('lee tonalidad, tempo, estilo y compás; la semilla es estable', () => {
    const s = especDesdePrompt('Canción de adoración en Re mayor a 72 bpm, estilo ambient')
    assert.equal(s.bpm, 72)
    assert.deepEqual(s.tonalidad, { raiz: 'D', escala: 'mayor' })
    assert.equal(s.estilo, 'ambient')
    assert.equal(especDesdePrompt('mismo texto').semilla, especDesdePrompt('mismo texto').semilla)
    assert.notEqual(especDesdePrompt('uno').semilla, especDesdePrompt('otro').semilla)
    assert.equal(especDesdePrompt('x', 42).semilla, 42)
    assert.equal(especDesdePrompt('un tema en 6/8').compas, '6/8')
  })
})

describe('producirWorship', () => {
  it('crea una pista por rol con su clip, carga un VST independiente en cada una y todo se puede deshacer', async () => {
    const e = entorno()
    const pasos: PasoBuild[] = []
    const antes = e.tienda.obtenerEstado().project.tracks.length
    const r = await producirWorship({ semilla: 7 }, { ...e, mezcla: false, onPaso: (p) => pasos.push(p) })
    assert.deepEqual(r.errores, [])
    assert.equal(r.pistas.length, 7)
    assert.ok(r.pistas.every((p) => p.instrumentoCargado))
    // un plugin por pista, y el piano y la melodía usan el mismo VST pero en pistas independientes
    const insertados = e.log.filter((a) => a.type === 'plugin.insert')
    assert.equal(insertados.length, 7)
    assert.equal(new Set(insertados.map((a) => a.payload.trackId)).size, 7)
    const tracks = e.tienda.obtenerEstado().project.tracks
    assert.equal(tracks.length, antes + 7)
    for (const t of tracks.slice(antes)) assert.ok(t.clips.length >= 1, `${t.nombre} sin clip`)
    assert.ok(pasos.some((p) => p.fase === 'composicion'))
    assert.equal(pasos.at(-1)?.fase, 'completado')
    assert.ok(pasos.every((p, i) => i === 0 || p.progreso >= pasos[i - 1]!.progreso))
  })

  it('un instrumento no instalado se informa (no se da por bueno) pero la música se crea igual', async () => {
    const e = entorno({ pluginsInstalados: Object.values(PLUGIN_POR_ROL).filter((n) => n !== 'JasWave Electric Bass') })
    const r = await producirWorship({ semilla: 3 }, { ...e, mezcla: false })
    const bajo = r.pistas.find((p) => p.rol === 'bajo')!
    assert.equal(bajo.instrumentoCargado, false)
    assert.ok(r.errores.some((m) => m.includes('Electric Bass')))
    assert.ok(e.tienda.obtenerEstado().project.tracks.some((t) => t.id === bajo.trackId && t.clips.length > 0))
  })

  it('la misma semilla produce lo mismo y semillas distintas, canciones distintas', async () => {
    const a = await producirWorship({ semilla: 5 }, { ...entorno(), mezcla: false, instrumentos: false })
    const b = await producirWorship({ semilla: 5 }, { ...entorno(), mezcla: false, instrumentos: false })
    const c = await producirWorship({ semilla: 6 }, { ...entorno(), mezcla: false, instrumentos: false })
    assert.deepEqual(a.arreglo.partes, b.arreglo.partes)
    assert.notDeepEqual(a.arreglo.partes.piano, c.arreglo.partes.piano)
  })

  it('mezcla por medición: el balance converge a los objetivos por rol y el master cumple −14 LUFS y el techo de pico', async () => {
    const e = entorno()
    const rolDe = (id: string) => (Object.keys(BASE) as RolWorship[]).find((r) => id.endsWith(`-${r}`))
    const medir = medirSimulado(e.tienda, BASE, rolDe)
    registrarProveedor(medir)
    const r = await producirWorship({ semilla: 7 }, { ...e, medir, instrumentos: false })
    assert.ok(r.mezcla?.medible)
    assert.ok(r.mezcla!.rondas >= 1)
    // cada pista medida en solitario queda cerca de su objetivo
    const final = await medir()
    for (const p of final.pistas) {
      const rol = rolDe(p.trackId)
      if (!rol) continue
      assert.ok(Math.abs(p.integrated - OBJETIVO_LUFS_POR_ROL[rol]) <= 1.6, `${rol}: ${p.integrated.toFixed(1)} vs ${OBJETIVO_LUFS_POR_ROL[rol]}`)
    }
    assert.ok(Math.abs(final.master.integrated - -14) <= 1.5 || final.master.truePeakDb <= -0.9, 'master en objetivo')
    assert.ok(final.master.truePeakDb <= -0.9, `true-peak ${final.master.truePeakDb.toFixed(2)}`)
    assert.equal(r.mezcla!.cumpleTruePeak, true)
    // el paneo por rol se aplicó
    const guitarra = e.tienda.obtenerEstado().project.tracks.find((t) => t.id.endsWith('-guitarra'))!
    assert.ok(guitarra.paneo > 0.2)
  })

  it('un master con pico alto baja el objetivo de loudness para respetar el techo (el pico manda)', async () => {
    const e = entorno()
    const rolDe = (id: string) => (Object.keys(BASE) as RolWorship[]).find((r) => id.endsWith(`-${r}`))
    const base = medirSimulado(e.tienda, BASE, rolDe)
    const medir = async () => {
      const m = await base()
      return { ...m, master: { ...m.master, truePeakDb: m.master.integrated + 16 } } // mezcla muy picuda
    }
    registrarProveedor(medir)
    const r = await producirWorship({ semilla: 7 }, { ...e, medir, instrumentos: false })
    const m = r.mezcla!.master!
    assert.ok(m.truePeakDb <= -0.9, `pico ${m.truePeakDb.toFixed(2)}`)
    assert.ok(m.integrated < -14, 'el loudness bajó para respetar el pico')
    assert.equal(r.mezcla!.cumpleTruePeak, true)
  })

  it('sin medición lo dice y no da la mezcla por aprobada', async () => {
    const r = await producirWorship({ semilla: 2 }, { ...entorno(), instrumentos: false })
    assert.equal(r.mezcla?.medible, false)
    assert.equal(r.mezcla?.cumpleLoudness, undefined)
    assert.ok(r.errores.some((m) => m.includes('Sin medición')))
  })

  it('si el motor de análisis no devuelve datos tampoco se aprueba', async () => {
    const r = await producirWorship({ semilla: 2 }, { ...entorno(), instrumentos: false, medir: async () => null })
    assert.equal(r.mezcla?.medible, false)
    assert.ok(r.errores.some((m) => m.includes('no devolvió medidas')))
  })

  it('cancelar con AbortSignal detiene la producción antes de crear nada', async () => {
    const e = entorno()
    const ac = new AbortController()
    ac.abort()
    const r = await producirWorship({ semilla: 1 }, { ...e, signal: ac.signal })
    assert.deepEqual(r.errores, ['Cancelado'])
    assert.equal(e.log.length, 0)
  })
})

describe('producirWorship por el camino real del agente (executeDawActions)', () => {
  it('conserva los ids deterministas de pistas y clips y no dispara la reproducción', async () => {
    // el agente espera «proyecto listo»: se marca listo para no esperar el failsafe de 22 s
    reportProjectHost(true)
    reportProjectDevice(true)
    reportProjectPluginsSettled(true)
    reportProjectBuffersSettled(true)
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const ejecutar: EjecutarAcciones = async (acciones) => {
      const rs = await executeDawActions(tienda, sinAudicion(acciones) as DawAction[], { source: 'user_build', agentMode: 'create', skipWorkPlan: true })
      return rs.map((r) => ({ type: r.type, success: r.success, message: r.message, data: r.data }))
    }
    const r = await producirWorship(
      { semilla: 9 },
      { ejecutar, leerVolumen: (id) => tienda.obtenerEstado().project.tracks.find((t) => t.id === id)?.volumen ?? 1, instrumentos: false, mezcla: false },
    )
    assert.deepEqual(r.errores, [])
    assert.equal(r.pistas.length, 7)
    const tracks = tienda.obtenerEstado().project.tracks
    for (const p of r.pistas) {
      const t = tracks.find((x) => x.id === p.trackId)
      assert.ok(t, `falta la pista ${p.trackId}: el agente no respetó el id pedido`)
      assert.equal(t!.clips.length, 1, `${p.rol} sin clip`)
      assert.ok((t!.clips[0] as { notas?: unknown[] }).notas!.length > 0)
    }
    assert.equal(tienda.obtenerEstado().transport?.reproduciendo ?? false, false, 'no debe arrancar la reproducción')
  })
})
