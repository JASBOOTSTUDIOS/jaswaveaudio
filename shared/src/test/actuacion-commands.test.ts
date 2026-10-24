/**
 * Pruebas de los comandos de actuación con valores reales (A7c).
 *
 * Cada comando lee una medición real del proveedor de análisis (A7b, mockeado
 * aquí) y aplica un valor físico real (dB, Hz, ms) al proyecto. Todo es
 * deshacible vía Command System y queda en el registro de auditoría.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { crearRegistroComandos } from '../state/registro-comandos'
import { registrarComandosBuiltin } from '../state/comandos-builtin'
import { CommandExecutor } from '../state/ejecutor-comandos'
import { crearPilaDeshacerRehacer } from '../state/pila-deshacer-rehacer'
import { crearRegistroAuditoria } from '../state/registro-auditoria'
import { crearEstadoInicial } from '../state/estado-inicial'
import { BusEventosMemoria } from '../events/event-bus'
import { registrarProveedorAnalisis, type AnalisisProyecto, type RequerimientoAnalisis } from '../audio/analysis-provider'
import type { MedidaPista } from '../audio/diagnosis'
import type { DAWState } from '../types/state'
import type { Track } from '../types/tracks'
import {
  crearComandoTrackGanancia,
  crearComandoPistaPan,
  crearComandoPistaEqAgregar,
  crearComandoPistaEqEditar,
  crearComandoPistaEqQuitar,
  crearComandoPistaCompresorAgregar,
  crearComandoPistaCompresorEditar,
  crearComandoPistaCompresorQuitar,
  crearComandoPistaLimite,
  crearComandoMasterNormalizar,
} from '../commands/actuacion-commands'

function pistaAudio(id = 't-bajo', nombre = 'Bajo', plugins: unknown[] = []): Track {
  return {
    id,
    nombre,
    nombreOriginal: nombre,
    color: '#808080',
    tipo: 'audio',
    rol: 'normal',
    estado: 'activo',
    volumen: 1,
    volumenOriginal: 1,
    paneo: 0,
    paneoOriginal: 0,
    silenciada: false,
    soloActiva: false,
    armada: false,
    frozen: false,
    soloSeguro: false,
    muteSeguro: false,
    orden: 0,
    profundidad: 0,
    hijos: [],
    clips: [],
    plugins: plugins as never,
    automatizaciones: [],
    envios: [],
    receives: [],
    fades: [],
    marcadores: [],
    medios: [],
    tags: [],
    comentario: '',
    notas: '',
    modificado: false,
    fechaCreacion: Date.now(),
    fechaModificacion: Date.now(),
    estadisticas: {
      clipsTotales: 0,
      clipsAudio: 0,
      clipsMidi: 0,
      duracionTotal: 0,
      duracionUtil: 0,
      pluginsTotales: 0,
      automatizacionesTotales: 0,
      puntosAutomatizacion: 0,
      enviosTotales: 0,
      receivesTotales: 0,
      fadesTotales: 0,
      marcadoresTotales: 0,
      mediosTotales: 0,
      eventosTotales: 0,
    },
    configuracion: {
      cuantizacion: 0,
      delayCompensacion: 0,
      retardoSincronizacion: 0,
      filtroEntrada: false,
      filtroSalida: false,
      monitorizarEntrada: false,
      grabacionAutomática: false,
      sobrescrituraAutomatica: false,
      cuantizarGrabacion: false,
      loop: false,
      punchIn: 0,
      punchOut: 0,
      metronomo: false,
      click: false,
      preRoll: false,
      postRoll: false,
    },
    colorDefecto: '#808080',
    visible: true,
    bloqueada: false,
    seleccionada: false,
    enRuta: false,
    enSidechain: false,
    enLoop: false,
    enEscena: false,
    controladoresVinculados: [],
    superficiesVinculadas: [],
    metadatos: {},
    entrada: undefined,
    salida: undefined,
    waveform: undefined,
    formato: 'stereo',
    canales: 2,
    sampleRate: 44100,
    bitDepth: 24,
    latenciaEntrada: 0,
    latenciaSalida: 0,
    bufferSize: 512,
    dispositivoEntrada: '',
    dispositivoSalida: '',
    gainStaging: 0,
    headroom: 0,
    phase: 0,
    stereoCorrelation: 1,
    frecuenciaFundamental: undefined,
    notaFundamental: undefined,
    lufs: -23,
    rangoDinamico: 0,
    clipping: false,
    xruns: 0,
    ultimoXrun: 0,
  } as unknown as Track
}

function estadoConPista(): DAWState {
  const base = crearEstadoInicial() as DAWState
  const pista = pistaAudio()
  return { ...base, project: { ...base.project, tracks: [pista] } }
}

function pistaEstado(estado: DAWState, trackId: string): Track {
  return estado.project.tracks.find((t) => t.id === trackId)!
}

function medidaPista(trackId: string, over: Partial<MedidaPista> = {}): MedidaPista {
  return {
    trackId,
    nombre: trackId,
    integrated: -20,
    truePeakDb: -3,
    peakDb: -6,
    rmsDb: -30,
    crestFactorDb: 10,
    lraDb: 8,
    clipping: false,
    bandas: [],
    ...over,
  } as MedidaPista
}

function analisisFake(over: Partial<AnalisisProyecto> = {}): AnalisisProyecto {
  return {
    revision: 'rev1',
    rango: { inicioSeg: 0, finSeg: 8 },
    pistas: [medidaPista('t-bajo', { integrated: -20 })],
    master: medidaPista('master', { integrated: -20 }),
    metadatos: {
      backend: 'fake',
      tap: 'post',
      bypassMaster: false,
      sampleRate: 44100,
      duracionSeg: 8,
    },
    ...over,
  } as AnalisisProyecto
}

function crearExecutor(estado: DAWState): CommandExecutor {
  const registro = crearRegistroComandos()
  registrarComandosBuiltin(registro)
  return new CommandExecutor({
    busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
    pila: crearPilaDeshacerRehacer(100),
    registro,
    auditoria: crearRegistroAuditoria(),
    estadoInicial: estado,
  })
}

const bandaBajo = { freq: 100, gain: 3, q: 1.4, type: 'bell' as const, enabled: true }

describe('comandos de actuación con valores reales (A7c)', () => {
  let estado: DAWState
  let pedidos: RequerimientoAnalisis[] = []

  beforeEach(() => {
    estado = estadoConPista()
    pedidos = []
    registrarProveedorAnalisis(async (req) => {
      pedidos.push(req)
      return analisisFake()
    })
  })

  afterEach(() => {
    registrarProveedorAnalisis(null)
  })

  describe('track.ganancia', () => {
    it('aplica una ganancia real en dB (lineal = 10^(dB/20))', async () => {
      const cmd = crearComandoTrackGanancia()
      const r = await cmd.handler(estado, { trackId: 't-bajo', db: 6 })
      const pista = pistaEstado(r.state, 't-bajo')
      expect(pista.volumen).toBeCloseTo(Math.pow(10, 6 / 20), 4)
      // El comando leyó una medición real antes de actuar
      expect(pedidos.length).toBeGreaterThan(0)
      expect(pedidos[0]!.pistas).toContain('t-bajo')
    })

    it('se deshace y rehace vía Command System', async () => {
      const exec = crearExecutor(estado)
      const aplicado = await exec.execute('track.ganancia', { trackId: 't-bajo', db: 6 }, 'ai')
      expect(aplicado.success).toBe(true)
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').volumen).toBeCloseTo(Math.pow(10, 6 / 20), 4)
      expect(exec.canUndo()).toBe(true)

      const deshecho = await exec.undo()
      expect(deshecho.success).toBe(true)
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').volumen).toBe(1)

      const rehacido = await exec.redo()
      expect(rehacido.success).toBe(true)
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').volumen).toBeCloseTo(Math.pow(10, 6 / 20), 4)
    })

    it('clampa la ganancia a rangos reales', async () => {
      const exec = crearExecutor(estado)
      const r = await exec.execute('track.ganancia', { trackId: 't-bajo', db: 100 }, 'ai')
      expect(r.success).toBe(true)
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').volumen).toBeCloseTo(Math.pow(10, 24 / 20), 4)
    })
  })

  describe('pista.pan', () => {
    it('aplica un paneo real y es deshacible', async () => {
      const cmd = crearComandoPistaPan()
      const r = await cmd.handler(estado, { trackId: 't-bajo', pan: 0.5 })
      expect(pistaEstado(r.state, 't-bajo').paneo).toBe(0.5)

      const exec = crearExecutor(estado)
      await exec.execute('pista.pan', { trackId: 't-bajo', pan: -0.8 }, 'ai')
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').paneo).toBe(-0.8)
      await exec.undo()
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').paneo).toBe(0)
    })
  })

  describe('pista.eq.*', () => {
    it('eq.agregar crea ecualizador con parámetros reales (Hz/dB/Q)', async () => {
      const exec = crearExecutor(estado)
      const r = await exec.execute(
        'pista.eq.agregar',
        { trackId: 't-bajo', bandas: [bandaBajo] },
        'ai',
      )
      expect(r.success).toBe(true)
      const plugins = pistaEstado(exec.obtenerEstado(), 't-bajo').plugins
      const eq = plugins.find((p) => p.tipo === 'eq')
      expect(eq).toBeDefined()
      expect(eq!.parametros.find((x) => x.id === 'eq.band.0.freq')!.valor).toBe(100)
      expect(eq!.parametros.find((x) => x.id === 'eq.band.0.gain')!.valor).toBe(3)
      expect(eq!.parametros.find((x) => x.id === 'eq.band.0.q')!.valor).toBe(1.4)

      // Deshacer quita el ecualizador
      await exec.undo()
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'eq')).toBeUndefined()

      // Rehacer lo restaura
      await exec.redo()
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'eq')).toBeDefined()
    })

    it('eq.editar reemplaza las ganancias reales y se deshace', async () => {
      const exec = crearExecutor(estado)
      await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: [bandaBajo] }, 'ai')
      await exec.execute(
        'pista.eq.editar',
        { trackId: 't-bajo', bandas: [{ ...bandaBajo, gain: 6 }] },
        'ai',
      )
      const plugins = pistaEstado(exec.obtenerEstado(), 't-bajo').plugins
      const eq = plugins.find((p) => p.tipo === 'eq')!
      expect(eq.parametros.find((x) => x.id === 'eq.band.0.gain')!.valor).toBe(6)

      await exec.undo()
      const despuesUndo = pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'eq')!
      expect(despuesUndo.parametros.find((x) => x.id === 'eq.band.0.gain')!.valor).toBe(3)
    })

    it('eq.quitar elimina el ecualizador y lo deshace', async () => {
      const exec = crearExecutor(estado)
      await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: [bandaBajo] }, 'ai')
      await exec.execute('pista.eq.quitar', { trackId: 't-bajo' }, 'ai')
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'eq')).toBeUndefined()

      await exec.undo()
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'eq')).toBeDefined()
    })

    const eqDe = (exec: ReturnType<typeof crearExecutor>) =>
      pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'eq')
    const valor = (exec: ReturnType<typeof crearExecutor>, id: string) =>
      eqDe(exec)?.parametros.find((x) => x.id === id)?.valor

    it('eq.agregar sobre un EQ existente: deshacer RESTAURA las bandas previas (antes quitaba el EQ)', async () => {
      const exec = crearExecutor(estado)
      await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: [bandaBajo] }, 'ai')
      await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: [{ ...bandaBajo, gain: -5, freq: 250 }] }, 'ai')
      expect(valor(exec, 'eq.band.0.gain')).toBe(-5)
      await exec.undo()
      expect(eqDe(exec)).toBeDefined()
      expect(valor(exec, 'eq.band.0.gain')).toBe(3)
      expect(valor(exec, 'eq.band.0.freq')).toBe(100)
    })

    it('admite hasta 24 bandas y rechaza la 25ª con un error claro', async () => {
      const exec = crearExecutor(estado)
      const muchas = Array.from({ length: 24 }, (_, i) => ({ ...bandaBajo, freq: 100 + i * 100 }))
      expect((await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: muchas }, 'ai')).success).toBe(true)
      const r = await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: [...muchas, bandaBajo] }, 'ai')
      expect(r.success).toBe(false)
      expect(JSON.stringify(r.error)).toMatch(/24/)
    })

    it('tipos nuevos (notch, bandPass), alias de la IA y parámetros extra por banda', async () => {
      const exec = crearExecutor(estado)
      const r = await exec.execute(
        'pista.eq.agregar',
        {
          trackId: 't-bajo',
          bandas: [
            { freq: 60, gain: 0, q: 0.7, type: 'hpf', enabled: true, slope: 48 },
            { freq: 2000, gain: 0, q: 6, type: 'notch', enabled: true, mode: 'mid' },
            { freq: 5000, gain: 0, q: 1, type: 'bandPass', enabled: true, solo: true },
          ],
        },
        'ai',
      )
      expect(r.success).toBe(true)
      expect(valor(exec, 'eq.band.0.type')).toBe(0) // hpf → lowCut = código 0 del VST
      expect(valor(exec, 'eq.band.0.slope')).toBe(48)
      expect(valor(exec, 'eq.band.1.type')).toBe(5)
      expect(valor(exec, 'eq.band.1.mode')).toBe(1)
      expect(valor(exec, 'eq.band.2.type')).toBe(6)
      expect(valor(exec, 'eq.band.2.solo')).toBe(1)
    })

    it('un tipo desconocido falla con un mensaje que dice qué usar', async () => {
      const exec = crearExecutor(estado)
      const r = await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: [{ ...bandaBajo, type: 'raro' }] }, 'ai')
      expect(r.success).toBe(false)
      expect(JSON.stringify(r.error)).toMatch(/bandPass/)
    })

    it('eq.banda.agregar / editar / quitar: una banda a la vez, con undo', async () => {
      const exec = crearExecutor(estado)
      // crea el EQ con la primera banda
      expect((await exec.execute('pista.eq.banda.agregar', { trackId: 't-bajo', banda: bandaBajo }, 'ai')).success).toBe(true)
      expect(valor(exec, 'eq.band.0.freq')).toBe(100)
      // segunda banda
      await exec.execute('pista.eq.banda.agregar', { trackId: 't-bajo', banda: { ...bandaBajo, freq: 3000, gain: -2 } }, 'ai')
      expect(valor(exec, 'eq.band.1.freq')).toBe(3000)
      // editar solo la ganancia de la segunda
      await exec.execute('pista.eq.banda.editar', { trackId: 't-bajo', indice: 1, cambios: { gain: -6 } }, 'ai')
      expect(valor(exec, 'eq.band.1.gain')).toBe(-6)
      expect(valor(exec, 'eq.band.1.freq')).toBe(3000) // el resto intacto
      expect(valor(exec, 'eq.band.0.gain')).toBe(3)
      // quitar la primera
      await exec.execute('pista.eq.banda.quitar', { trackId: 't-bajo', indice: 0 }, 'ai')
      expect(valor(exec, 'eq.band.0.freq')).toBe(3000)
      expect(valor(exec, 'eq.band.1.freq')).toBeUndefined()

      // deshacer paso a paso
      await exec.undo()
      expect(valor(exec, 'eq.band.1.freq')).toBe(3000)
      expect(valor(exec, 'eq.band.0.freq')).toBe(100)
      await exec.undo()
      expect(valor(exec, 'eq.band.1.gain')).toBe(-2)
      await exec.undo()
      expect(valor(exec, 'eq.band.1.freq')).toBeUndefined()
      await exec.undo()
      expect(eqDe(exec)).toBeUndefined() // el EQ lo creó el primer comando: se retira

      // errores accionables
      const sinEq = await exec.execute('pista.eq.banda.editar', { trackId: 't-bajo', indice: 0, cambios: { gain: 1 } }, 'ai')
      expect(sinEq.success).toBe(false)
    })

    it('eq.banda.editar con índice inexistente falla indicando cuántas bandas hay', async () => {
      const exec = crearExecutor(estado)
      await exec.execute('pista.eq.banda.agregar', { trackId: 't-bajo', banda: bandaBajo }, 'ai')
      const r = await exec.execute('pista.eq.banda.editar', { trackId: 't-bajo', indice: 5, cambios: { gain: 1 } }, 'ai')
      expect(r.success).toBe(false)
      expect(JSON.stringify(r.error)).toMatch(/hay 1/)
    })

    it('lee proyectos con el esquema anterior (códigos de tipo heredados) y los migra', async () => {
      const exec = crearExecutor(estado)
      await exec.execute('pista.eq.agregar', { trackId: 't-bajo', bandas: [bandaBajo] }, 'ai')
      // simula un proyecto antiguo: sin eq.version y con tipo highShelf = 2 (esquema 1)
      const viejo = eqDe(exec)!
      const parametros = viejo.parametros
        .filter((x) => x.id !== 'eq.version')
        .map((x) => (x.id === 'eq.band.0.type' ? { ...x, valor: 2 } : x))
      const est = exec.obtenerEstado()
      const nuevoEstado = {
        ...est,
        project: {
          ...est.project,
          tracks: est.project.tracks.map((t) =>
            t.id === 't-bajo' ? { ...t, plugins: t.plugins.map((p) => (p.tipo === 'eq' ? { ...p, parametros } : p)) } : t,
          ),
        },
      }
      const exec2 = crearExecutor(nuevoEstado as typeof estado)
      await exec2.execute('pista.eq.banda.editar', { trackId: 't-bajo', indice: 0, cambios: { gain: 1 } }, 'ai')
      const tras = pistaEstado(exec2.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'eq')!
      // el esquema 1 con código 2 = highShelf → en el esquema nuevo es el código 3
      expect(tras.parametros.find((x) => x.id === 'eq.band.0.type')!.valor).toBe(3)
      expect(tras.parametros.find((x) => x.id === 'eq.version')!.valor).toBe(2)
    })
  })

  describe('pista.compresor.*', () => {
    it('compresor.agregar aplica umbral/ratio/ataque reales', async () => {
      const exec = crearExecutor(estado)
      const r = await exec.execute(
        'pista.compresor.agregar',
        { trackId: 't-bajo', threshold: -18, ratio: 4, attack: 10, release: 100, knee: 6, makeup: 3 },
        'ai',
      )
      expect(r.success).toBe(true)
      const plugins = pistaEstado(exec.obtenerEstado(), 't-bajo').plugins
      const comp = plugins.find((p) => p.tipo === 'compresor')
      expect(comp).toBeDefined()
      expect(comp!.parametros.find((x) => x.id === 'comp.threshold')!.valor).toBe(-18)
      expect(comp!.parametros.find((x) => x.id === 'comp.ratio')!.valor).toBe(4)
      expect(comp!.parametros.find((x) => x.id === 'comp.attack')!.valor).toBe(10)

      await exec.undo()
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'compresor')).toBeUndefined()
    })

    it('compresor.editar cambia el umbral real y se deshace', async () => {
      const exec = crearExecutor(estado)
      await exec.execute('pista.compresor.agregar', { trackId: 't-bajo', threshold: -18, ratio: 4 }, 'ai')
      await exec.execute('pista.compresor.editar', { trackId: 't-bajo', threshold: -12, ratio: 8 }, 'ai')
      const comp = pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'compresor')!
      expect(comp.parametros.find((x) => x.id === 'comp.threshold')!.valor).toBe(-12)
      expect(comp.parametros.find((x) => x.id === 'comp.ratio')!.valor).toBe(8)

      await exec.undo()
      const despuesUndo = pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'compresor')!
      expect(despuesUndo.parametros.find((x) => x.id === 'comp.threshold')!.valor).toBe(-18)
    })

    it('compresor.quitar elimina el compresor', async () => {
      const exec = crearExecutor(estado)
      await exec.execute('pista.compresor.agregar', { trackId: 't-bajo', threshold: -18, ratio: 4 }, 'ai')
      await exec.execute('pista.compresor.quitar', { trackId: 't-bajo' }, 'ai')
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'compresor')).toBeUndefined()
    })
  })

  describe('pista.limite', () => {
    it('aplica el techo (ceiling) real del limitador y se deshace', async () => {
      const exec = crearExecutor(estado)
      const r = await exec.execute('pista.limite', { trackId: 't-bajo', ceiling: -1, gainIn: 3 }, 'ai')
      expect(r.success).toBe(true)
      const plugins = pistaEstado(exec.obtenerEstado(), 't-bajo').plugins
      const lim = plugins.find((p) => p.tipo === 'limite')
      expect(lim).toBeDefined()
      expect(lim!.parametros.find((x) => x.id === 'limit.ceiling')!.valor).toBe(-1)
      expect(lim!.parametros.find((x) => x.id === 'limit.gainIn')!.valor).toBe(3)

      await exec.undo()
      expect(pistaEstado(exec.obtenerEstado(), 't-bajo').plugins.find((p) => p.tipo === 'limite')).toBeUndefined()
    })
  })

  describe('master.normalizar', () => {
    it('normaliza el master a un objetivo LUFS real usando la medición', async () => {
      const exec = crearExecutor(estado)
      const r = await exec.execute('master.normalizar', { objetivoLufs: -14 }, 'ai')
      expect(r.success).toBe(true)
      const master = exec.obtenerEstado().project.master
      // integrado -20 → objetivo -14 → delta +6 dB → volumen 1 * 10^(6/20)
      expect(master.volumen).toBeCloseTo(Math.pow(10, 6 / 20), 4)
      expect(exec.canUndo()).toBe(true)

      await exec.undo()
      expect(exec.obtenerEstado().project.master.volumen).toBe(1)

      await exec.redo()
      expect(exec.obtenerEstado().project.master.volumen).toBeCloseTo(Math.pow(10, 6 / 20), 4)
    })

    it('falla sin medición del master disponible', async () => {
      registrarProveedorAnalisis(null)
      const exec = crearExecutor(estado)
      const r = await exec.execute('master.normalizar', { objetivoLufs: -14 }, 'ai')
      expect(r.success).toBe(false)
      expect(r.error?.message).toContain('medición del master')
    })
  })
})
