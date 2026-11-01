import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detenerTransporteYFinalizarGrabacion } from './project-io'
import {
  _reiniciarSesionGrabacion,
  cerrarFinalizacionGrabacion,
  iniciarFinalizacionGrabacion,
} from './recording-session'

type EstadoFake = {
  transport: { reproduciendo: boolean; grabacion: string }
}

function crearTiendaFake(transport: EstadoFake['transport']) {
  const ejecutados: string[] = []
  const estado: EstadoFake = { transport }
  const tienda = {
    obtenerEstado: () => estado,
    executor: {
      execute: async (tipo: string) => {
        ejecutados.push(tipo)
        if (tipo === 'transport.stop') {
          estado.transport = { reproduciendo: false, grabacion: 'inactiva' }
        }
        if (tipo === 'transport.toggleRecord') {
          estado.transport = { ...estado.transport, grabacion: 'inactiva' }
        }
        return { success: true, result: {} }
      },
    },
  }
  return { tienda: tienda as never, ejecutados, estado }
}

describe('project-io: detener transporte y finalizar grabación (U6)', () => {
  it('detiene la reproducción', async () => {
    _reiniciarSesionGrabacion()
    const { tienda, ejecutados } = crearTiendaFake({ reproduciendo: true, grabacion: 'inactiva' })
    await detenerTransporteYFinalizarGrabacion(tienda)
    assert.deepEqual(ejecutados, ['transport.stop'])
  })

  it('no hace nada si el transporte está parado', async () => {
    _reiniciarSesionGrabacion()
    const { tienda, ejecutados } = crearTiendaFake({ reproduciendo: false, grabacion: 'inactiva' })
    await detenerTransporteYFinalizarGrabacion(tienda)
    assert.deepEqual(ejecutados, [])
  })

  it('corta la grabación y espera a que la toma esté escrita', async () => {
    _reiniciarSesionGrabacion()
    const { tienda, ejecutados } = crearTiendaFake({ reproduciendo: false, grabacion: 'grabando' })
    iniciarFinalizacionGrabacion()
    let cerrada = false
    setTimeout(() => {
      cerrada = true
      cerrarFinalizacionGrabacion()
    }, 80)
    await detenerTransporteYFinalizarGrabacion(tienda)
    assert.deepEqual(ejecutados, ['transport.toggleRecord'])
    assert.equal(cerrada, true, 'debe esperar a que la toma esté escrita')
  })
})
