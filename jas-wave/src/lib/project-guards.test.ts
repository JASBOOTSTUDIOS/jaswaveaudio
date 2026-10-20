/**
 * npx tsx --test src/lib/project-guards.test.ts
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import {
  _reiniciarGuardasProyecto,
  conGuardadoUnico,
  confirmarDescartarCambios,
  hayGuardadoEnCurso,
  obtenerSolicitudConfirmacion,
  responderSolicitudConfirmacion,
  solicitarEleccionCambios,
  suscribirSolicitudConfirmacion,
  type EleccionCambios,
} from './project-guards'
import { executeDawActions } from './ai-daw-agent'

function tiendaCon(modificado: boolean) {
  return { obtenerEstado: () => ({ project: { modificado } }) }
}

const guardarOk = async () => ({ success: true })

describe('confirmarDescartarCambios', () => {
  beforeEach(() => _reiniciarGuardasProyecto())

  it('sin cambios no pregunta y continúa', async () => {
    let preguntas = 0
    const r = await confirmarDescartarCambios(tiendaCon(false), {
      motivo: 'nuevo',
      guardar: guardarOk,
      preguntar: async () => {
        preguntas++
        return 'cancelar'
      },
    })
    assert.equal(r.continuar, true)
    assert.equal(preguntas, 0)
  })

  it('Cancelar detiene sin guardar', async () => {
    let guardados = 0
    const r = await confirmarDescartarCambios(tiendaCon(true), {
      motivo: 'abrir',
      guardar: async () => {
        guardados++
        return { success: true }
      },
      preguntar: async () => 'cancelar',
    })
    assert.deepEqual(r, { continuar: false, eleccion: 'cancelar' })
    assert.equal(guardados, 0)
  })

  it('No guardar continúa sin guardar', async () => {
    let guardados = 0
    const r = await confirmarDescartarCambios(tiendaCon(true), {
      motivo: 'cerrar-app',
      guardar: async () => {
        guardados++
        return { success: true }
      },
      preguntar: async () => 'descartar',
    })
    assert.equal(r.continuar, true)
    assert.equal(guardados, 0)
  })

  it('Guardar guarda y continúa; si el guardado se cancela o falla, no continúa', async () => {
    const ok = await confirmarDescartarCambios(tiendaCon(true), {
      motivo: 'nuevo',
      guardar: guardarOk,
      preguntar: async () => 'guardar',
    })
    assert.equal(ok.continuar, true)

    const cancelado = await confirmarDescartarCambios(tiendaCon(true), {
      motivo: 'nuevo',
      guardar: async () => ({ success: false, canceled: true }),
      preguntar: async () => 'guardar',
    })
    assert.equal(cancelado.continuar, false)

    const fallo = await confirmarDescartarCambios(tiendaCon(true), {
      motivo: 'nuevo',
      guardar: async () => ({ success: false, error: { message: 'disco lleno' } }),
      preguntar: async () => 'guardar',
    })
    assert.equal(fallo.continuar, false)
    assert.equal(fallo.error, 'disco lleno')
  })

  it('el diálogo por defecto queda pendiente hasta que el usuario responde', async () => {
    let avisos = 0
    suscribirSolicitudConfirmacion(() => avisos++)
    const p = confirmarDescartarCambios(tiendaCon(true), { motivo: 'abrir', origen: 'ia', guardar: guardarOk })
    await Promise.resolve()
    const sol = obtenerSolicitudConfirmacion()
    assert.ok(sol)
    assert.equal(sol.motivo, 'abrir')
    assert.equal(sol.origen, 'ia')
    responderSolicitudConfirmacion('descartar')
    assert.equal((await p).continuar, true)
    assert.equal(obtenerSolicitudConfirmacion(), null)
    assert.equal(avisos, 2)
  })

  it('dos solicitudes seguidas comparten un solo diálogo', async () => {
    const a = solicitarEleccionCambios('cerrar-app')
    const b = solicitarEleccionCambios('cerrar-app')
    assert.equal(a, b)
    responderSolicitudConfirmacion('cancelar')
    const [ra, rb] = await Promise.all([a, b])
    assert.equal(ra, 'cancelar' satisfies EleccionCambios)
    assert.equal(rb, 'cancelar')
  })
})

describe('conGuardadoUnico', () => {
  beforeEach(() => _reiniciarGuardasProyecto())

  it('doble llamada concurrente = un solo guardado', async () => {
    let llamadas = 0
    let soltar!: () => void
    const bloqueo = new Promise<void>((r) => {
      soltar = r
    })
    const guardar = async () => {
      llamadas++
      await bloqueo
      return { success: true, n: llamadas }
    }
    const p1 = conGuardadoUnico(guardar)
    const p2 = conGuardadoUnico(guardar)
    assert.equal(p1, p2)
    assert.equal(hayGuardadoEnCurso(), true)
    soltar()
    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(llamadas, 1)
    assert.deepEqual(r1, r2)
    assert.equal(hayGuardadoEnCurso(), false)

    await conGuardadoUnico(guardar)
    assert.equal(llamadas, 2, 'tras terminar, un nuevo guardado vuelve a ejecutarse')
  })

  it('un fallo (incluso síncrono) libera el guard', async () => {
    await assert.rejects(
      conGuardadoUnico(() => {
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal(hayGuardadoEnCurso(), false)
    assert.equal(await conGuardadoUnico(async () => 7), 7)
  })
})

describe('IA y cambios sin guardar', () => {
  beforeEach(() => _reiniciarGuardasProyecto())

  it('project.new de la IA con cambios pregunta y, si se cancela, no descarta (needsUser)', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    tienda.establecerEstado((s) => ({ ...s, project: { ...s.project, nombre: 'Mío', modificado: true } }))
    const unsub = suscribirSolicitudConfirmacion(() => {
      if (obtenerSolicitudConfirmacion()) responderSolicitudConfirmacion('cancelar')
    })
    const [r] = await executeDawActions(tienda, [{ type: 'project.new', payload: { nombre: 'Otro' } }], {
      source: 'cli',
    })
    unsub()
    assert.equal(r!.success, false)
    assert.deepEqual(r!.data, { needsUser: true, motivo: 'cambios-sin-guardar' })
    assert.equal(tienda.obtenerEstado().project.nombre, 'Mío')
    assert.equal(tienda.obtenerEstado().project.modificado, true)
  })

  it('project.new de la IA con “No guardar” crea el proyecto', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    tienda.establecerEstado((s) => ({ ...s, project: { ...s.project, nombre: 'Mío', modificado: true } }))
    const unsub = suscribirSolicitudConfirmacion(() => {
      if (obtenerSolicitudConfirmacion()) responderSolicitudConfirmacion('descartar')
    })
    const [r] = await executeDawActions(tienda, [{ type: 'project.new', payload: { nombre: 'Otro' } }], {
      source: 'cli',
    })
    unsub()
    assert.equal(r!.success, true, r!.message)
    assert.equal(tienda.obtenerEstado().project.nombre, 'Otro')
  })
})
