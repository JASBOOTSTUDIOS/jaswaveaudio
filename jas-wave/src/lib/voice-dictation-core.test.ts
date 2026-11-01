import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  ControladorDictado,
  ErrorDictado,
  alternarDictadoEnfocado,
  crearMotorWindows,
  mensajeErrorDictado,
  motivoNoDisponible,
  motoresDisponibles,
  registrarObjetivoDictado,
  reiniciarDisponibilidad,
  type EntornoDictado,
  type ManejadoresMotor,
  type MotorReconocimiento,
  type PuenteDictadoEscritorio,
  type TipoMotorDictado,
} from './voice-dictation-core'

/** Motor falso: el test decide si arranca y qué «oye». */
function motorFalso(tipo: TipoMotorDictado, fallo?: string) {
  let m: ManejadoresMotor | null = null
  const motor: MotorReconocimiento & { m: () => ManejadoresMotor; detenido: number } = {
    tipo,
    detenido: 0,
    m: () => m!,
    async iniciar(h) {
      if (fallo) throw new ErrorDictado(fallo)
      m = h
    },
    detener() {
      motor.detenido++
    },
  }
  return motor
}

const PUENTE_FALSO = {} as PuenteDictadoEscritorio
const ELECTRON: EntornoDictado = { puente: PUENTE_FALSO, reconocimientoWeb: class {} as never }

/** Temporizador manual para el auto-envío. */
function reloj() {
  const pendientes = new Map<number, () => void>()
  let n = 0
  return {
    set: (fn: () => void) => {
      pendientes.set(++n, fn)
      return n
    },
    clear: (id: unknown) => {
      pendientes.delete(id as number)
    },
    disparar() {
      const fns = [...pendientes.values()]
      pendientes.clear()
      for (const f of fns) f()
    },
    get pendientes() {
      return pendientes.size
    },
  }
}

afterEach(() => reiniciarDisponibilidad())

describe('elección de motor', () => {
  it('Electron: primero Windows y la Web Speech API de respaldo; navegador: solo Web Speech', () => {
    assert.deepEqual(motoresDisponibles(ELECTRON), ['windows', 'web'])
    assert.deepEqual(motoresDisponibles({ reconocimientoWeb: class {} as never }), ['web'])
    assert.deepEqual(motoresDisponibles({}), [])
    assert.match(motivoNoDisponible({}) ?? '', /no está disponible/)
  })

  it('si Windows no arranca prueba la Web Speech API; si esta falla con «network» queda deshabilitado con el motivo', async () => {
    const win = motorFalso('windows', 'sin-reconocedor')
    const web = motorFalso('web', 'network')
    const sonidos: string[] = []
    const c = new ControladorDictado({
      entorno: () => ELECTRON,
      crearMotor: (t) => (t === 'windows' ? win : web),
      alCambiarTexto: () => undefined,
      alSonar: (s) => sonidos.push(s),
    })
    await c.iniciar('')
    assert.equal(c.estado, 'inactivo')
    assert.match(c.error ?? '', /Google/)
    assert.deepEqual(motoresDisponibles(ELECTRON), [])
    assert.match(motivoNoDisponible(ELECTRON) ?? '', /Google/)
    assert.deepEqual(sonidos, ['inicio'])
  })

  it('sin permiso de micrófono no prueba otro motor', async () => {
    const win = motorFalso('windows', 'not-allowed')
    let webCreado = false
    const c = new ControladorDictado({
      entorno: () => ELECTRON,
      crearMotor: (t) => {
        if (t === 'web') webCreado = true
        return win
      },
      alCambiarTexto: () => undefined,
    })
    await c.iniciar('')
    assert.equal(webCreado, false)
    assert.match(c.error ?? '', /Permiso de micrófono/)
    // El permiso no descarta el motor: se puede reintentar tras concederlo.
    assert.deepEqual(motoresDisponibles(ELECTRON), ['windows', 'web'])
  })
})

describe('ControladorDictado', () => {
  it('ancla + finales + provisional sin duplicar, con formato', async () => {
    const win = motorFalso('windows')
    const textos: Array<[string, boolean]> = []
    const c = new ControladorDictado({ entorno: () => ELECTRON, crearMotor: () => win, alCambiarTexto: (t, f) => textos.push([t, f]) })
    await c.iniciar('Hola.')
    assert.equal(c.estado, 'escuchando')
    assert.equal(c.motor, 'windows')
    win.m().alParcial('agrega')
    win.m().alParcial('agrega una pista')
    win.m().alFinal('Agrega una pista midi coma')
    win.m().alParcial('a 120')
    win.m().alParcial('a 120 bpm')
    win.m().alFinal('a 120 bpm punto')
    assert.deepEqual(textos, [
      ['Hola. Agrega', false],
      ['Hola. Agrega una pista', false],
      ['Hola. Agrega una pista MIDI,', true],
      ['Hola. Agrega una pista MIDI, a 120', false],
      ['Hola. Agrega una pista MIDI, a 120 BPM', false],
      ['Hola. Agrega una pista MIDI, a 120 BPM.', true],
    ])
  })

  it('detener confirma lo provisional, suena y libera el motor', async () => {
    const win = motorFalso('windows')
    const textos: string[] = []
    const sonidos: string[] = []
    const c = new ControladorDictado({
      entorno: () => ELECTRON,
      crearMotor: () => win,
      alCambiarTexto: (t) => textos.push(t),
      alSonar: (s) => sonidos.push(s),
    })
    await c.iniciar('')
    win.m().alParcial('sube la reverb')
    c.detener()
    assert.equal(c.estado, 'inactivo')
    assert.equal(win.detenido, 1)
    assert.equal(textos.at(-1), 'Sube la Reverb')
    assert.deepEqual(sonidos, ['inicio', 'fin'])
    // Eventos tardíos del motor ya parado: se ignoran.
    win.m().alFinal('otra cosa')
    assert.equal(textos.at(-1), 'Sube la Reverb')
  })

  it('lo tecleado durante el dictado pasa a ser el ancla', async () => {
    const win = motorFalso('windows')
    let valor = ''
    const c = new ControladorDictado({ entorno: () => ELECTRON, crearMotor: () => win, alCambiarTexto: (t) => (valor = t) })
    await c.iniciar('')
    win.m().alFinal('primera frase')
    c.sincronizarValor('Primera frase editada')
    win.m().alFinal('y sigue')
    assert.equal(valor, 'Primera frase editada y sigue')
  })

  it('auto-enviar: tras el silencio para y envía el texto completo una sola vez', async () => {
    const win = motorFalso('windows')
    const tm = reloj()
    const enviados: string[] = []
    const c = new ControladorDictado({
      entorno: () => ELECTRON,
      crearMotor: () => win,
      autoEnvioMs: 2000,
      temporizador: tm,
      alCambiarTexto: () => undefined,
      alAutoEnviar: (t) => enviados.push(t),
    })
    await c.iniciar('')
    win.m().alParcial('crea una pista')
    win.m().alFinal('crea una pista de bajo')
    assert.equal(tm.pendientes, 1, 'cada resultado reinicia el temporizador')
    tm.disparar()
    assert.deepEqual(enviados, ['Crea una pista de bajo'])
    assert.equal(c.estado, 'inactivo')
    tm.disparar()
    assert.equal(enviados.length, 1)
  })

  it('solo transcribir no envía nunca', async () => {
    const win = motorFalso('windows')
    const tm = reloj()
    const enviados: string[] = []
    const c = new ControladorDictado({
      entorno: () => ELECTRON,
      crearMotor: () => win,
      autoEnvioMs: null,
      temporizador: tm,
      alCambiarTexto: () => undefined,
      alAutoEnviar: (t) => enviados.push(t),
    })
    await c.iniciar('')
    win.m().alFinal('hola')
    assert.equal(tm.pendientes, 0)
    assert.equal(c.estado, 'escuchando')
  })

  it('un error del motor mientras escucha se muestra y para; «no-speech» no', async () => {
    const win = motorFalso('windows')
    const c = new ControladorDictado({ entorno: () => ELECTRON, crearMotor: () => win, alCambiarTexto: () => undefined })
    await c.iniciar('')
    win.m().alError('no-speech')
    assert.equal(c.estado, 'escuchando')
    win.m().alError('sin-microfono')
    assert.equal(c.estado, 'inactivo')
    assert.match(c.error ?? '', /micrófono/)
  })

  it('solo un dictado a la vez: empezar otro para el anterior', async () => {
    const a = motorFalso('windows')
    const b = motorFalso('windows')
    const ca = new ControladorDictado({ entorno: () => ELECTRON, crearMotor: () => a, alCambiarTexto: () => undefined })
    const cb = new ControladorDictado({ entorno: () => ELECTRON, crearMotor: () => b, alCambiarTexto: () => undefined })
    await ca.iniciar('')
    await cb.iniciar('')
    assert.equal(ca.estado, 'inactivo')
    assert.equal(a.detenido, 1)
    assert.equal(cb.estado, 'escuchando')
    cb.detener()
  })
})

describe('motor de Windows (puente del preload)', () => {
  it('traduce los eventos de main y suelta la suscripción al parar', async () => {
    let oyente: ((e: { tipo: string; texto?: string }) => void) | null = null
    let detenido = 0
    const puente: PuenteDictadoEscritorio = {
      disponible: async () => ({ disponible: true }),
      iniciar: async () => ({ ok: true }),
      detener: async () => {
        detenido++
      },
      onEvento: (cb) => {
        oyente = cb
        return () => {
          oyente = null
        }
      },
    }
    const recibidos: string[] = []
    const motor = crearMotorWindows(puente, 'es-ES')
    await motor.iniciar({
      alParcial: (t) => recibidos.push(`p:${t}`),
      alFinal: (t) => recibidos.push(`f:${t}`),
      alError: (c) => recibidos.push(`e:${c}`),
      alFin: () => recibidos.push('fin'),
    })
    oyente!({ tipo: 'parcial', texto: 'ho' })
    oyente!({ tipo: 'final', texto: 'Hola' })
    motor.detener()
    assert.equal(oyente, null)
    assert.equal(detenido, 1)
    assert.deepEqual(recibidos, ['p:ho', 'f:Hola'])
  })

  it('un fallo al arrancar rechaza con el código de main', async () => {
    const puente: PuenteDictadoEscritorio = {
      disponible: async () => ({ disponible: true }),
      iniciar: async () => ({ ok: false, codigo: 'sin-reconocedor', error: 'no hay' }),
      detener: async () => undefined,
      onEvento: () => () => undefined,
    }
    await assert.rejects(
      crearMotorWindows(puente, 'es-ES').iniciar({ alParcial() {}, alFinal() {}, alError() {}, alFin() {} }),
      (e: unknown) => e instanceof ErrorDictado && e.codigo === 'sin-reconocedor',
    )
  })
})

describe('Alt+V: objetivo del atajo', () => {
  it('elige el campo enfocado, si no el que escucha, si no el predeterminado', () => {
    const log: string[] = []
    const campoA = {} as Element
    const quitarAsistente = registrarObjetivoDictado({
      contiene: () => false,
      escuchando: () => false,
      alternar: () => log.push('asistente'),
      predeterminado: true,
    })
    let notasEscucha = false
    const quitarNotas = registrarObjetivoDictado({
      contiene: (el) => el === campoA,
      escuchando: () => notasEscucha,
      alternar: () => log.push('notas'),
    })
    assert.equal(alternarDictadoEnfocado(campoA), true)
    assert.equal(alternarDictadoEnfocado(null), true)
    notasEscucha = true
    assert.equal(alternarDictadoEnfocado(null), true)
    assert.deepEqual(log, ['notas', 'asistente', 'notas'])
    quitarNotas()
    quitarAsistente()
    assert.equal(alternarDictadoEnfocado(null), false)
  })
})

describe('mensajes', () => {
  it('legibles en español y silenciosos para «no-speech»/«aborted»', () => {
    assert.equal(mensajeErrorDictado('no-speech'), null)
    assert.equal(mensajeErrorDictado('aborted'), null)
    assert.match(mensajeErrorDictado('sin-reconocedor') ?? '', /español/)
    assert.match(mensajeErrorDictado('raro') ?? '', /raro/)
  })
})
