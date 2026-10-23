/**
 * npx tsx --test src/modulos/registro-modulos.test.ts
 * M1: módulos opcionales del DAW (activar/desactivar, descarga diferida, herramientas del núcleo intactas).
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  cargarModulo,
  estadoCarga,
  fijarModuloActivo,
  herramientaDisponible,
  moduloActivo,
  moduloDeHerramienta,
  registrarModulo,
  reiniciarModulosParaPruebas,
} from './registro-modulos'
import { herramientasDisponibles } from './herramientas'

// El registro lee localStorage en cada operación: basta con instalar el sustituto antes de reiniciar.
const memoria = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, v),
}

const Panel = () => null

describe('M1 — registro de módulos', () => {
  beforeEach(() => {
    memoria.clear()
    reiniciarModulosParaPruebas()
  })

  it('las herramientas del núcleo siempre están disponibles; las de un módulo siguen su activación', () => {
    registrarModulo({ id: 'asistente-ia', nombre: 'IA', descripcion: '', version: '1', herramientas: ['coproducer', 'progress'], cargar: async () => ({}) })
    assert.equal(herramientaDisponible('arrange'), true)
    assert.equal(herramientaDisponible('coproducer'), true)
    fijarModuloActivo('asistente-ia', false)
    assert.equal(herramientaDisponible('coproducer'), false)
    assert.equal(herramientaDisponible('mixer'), true)
    assert.ok(!herramientasDisponibles().includes('progress'))
    assert.ok(herramientasDisponibles().includes('piano-roll'))
    assert.equal(moduloDeHerramienta('progress')?.id, 'asistente-ia')
  })

  it('la activación se persiste y sobrevive a un reinicio', () => {
    registrarModulo({ id: 'partitura', nombre: 'P', descripcion: '', version: '1', herramientas: ['score-editor'], cargar: async () => ({}) })
    fijarModuloActivo('partitura', false)
    reiniciarModulosParaPruebas()
    registrarModulo({ id: 'partitura', nombre: 'P', descripcion: '', version: '1', herramientas: ['score-editor'], cargar: async () => ({}) })
    assert.equal(moduloActivo('partitura'), false)
    fijarModuloActivo('partitura', true)
    assert.equal(moduloActivo('partitura'), true)
  })

  it('un módulo inactivo por defecto se puede añadir después', () => {
    registrarModulo({ id: 'extra', nombre: 'E', descripcion: '', version: '1', herramientas: ['terminal'], activoPorDefecto: false, cargar: async () => ({ terminal: Panel }) })
    assert.equal(herramientaDisponible('terminal'), false)
    fijarModuloActivo('extra', true)
    assert.equal(herramientaDisponible('terminal'), true)
  })

  it('el código se descarga una sola vez; un fallo de descarga se puede reintentar', async () => {
    let llamadas = 0
    let fallar = true
    registrarModulo({
      id: 'midi-md',
      nombre: 'M',
      descripcion: '',
      version: '1',
      herramientas: ['midi-md'],
      cargar: async () => {
        llamadas++
        if (fallar) throw new Error('sin red')
        return { 'midi-md': Panel }
      },
    })
    assert.equal(estadoCarga('midi-md').estado, 'sin-cargar')
    await assert.rejects(cargarModulo('midi-md'), /sin red/)
    assert.deepEqual(estadoCarga('midi-md'), { estado: 'error', error: 'sin red' })
    fallar = false
    const [a, b] = await Promise.all([cargarModulo('midi-md'), cargarModulo('midi-md')])
    assert.equal(a['midi-md'], Panel)
    assert.equal(a, b)
    assert.equal(llamadas, 2)
    assert.equal(estadoCarga('midi-md').estado, 'listo')
  })

  it('rechaza ids inválidos y herramientas ya reclamadas por otro módulo', () => {
    assert.throws(() => registrarModulo({ id: 'Mal Id', nombre: '', descripcion: '', version: '1', herramientas: [], cargar: async () => ({}) }))
    registrarModulo({ id: 'uno', nombre: '', descripcion: '', version: '1', herramientas: ['docs'], cargar: async () => ({}) })
    assert.throws(() => registrarModulo({ id: 'dos', nombre: '', descripcion: '', version: '1', herramientas: ['docs'], cargar: async () => ({}) }), /ya pertenece/)
  })
})
