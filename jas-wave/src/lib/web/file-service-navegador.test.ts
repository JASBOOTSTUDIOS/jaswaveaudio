/**
 * npx tsx --test src/lib/web/file-service-navegador.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../../shared/src/state'
import { configurarFileService } from '../../../../shared/src/commands/project-commands'
import { FileServiceNavegador, almacenMemoria, rutaWebPara } from './file-service-navegador'

describe('W1 — proyectos en el navegador', () => {
  it('rutas web seguras a partir del nombre', () => {
    assert.equal(rutaWebPara('Mi tema: v2/final'), 'web://proyectos/Mi tema- v2-final.jaswave')
    assert.equal(rutaWebPara(''), 'web://proyectos/Proyecto sin nombre.jaswave')
  })

  it('rechaza rutas fuera del espacio web', async () => {
    const fs = new FileServiceNavegador(almacenMemoria())
    await assert.rejects(() => fs.guardar('C:\\Windows\\x.jaswave', '{}'), /no válida/)
    await assert.rejects(() => fs.guardar('web://proyectos/../x.jaswave', '{}'), /no válida/)
    assert.equal(await fs.existe('C:\\x.jaswave'), false)
  })

  it('project.save y project.load funcionan sin Electron y conservan el proyecto', async () => {
    const fs = new FileServiceNavegador(almacenMemoria())
    configurarFileService(fs)
    const t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const r = await t.executor.execute('track.create', { nombre: 'Bajo web', tipo: 'midi' })
    assert.ok(r.success)
    const ruta = rutaWebPara('Demo web')
    await t.executor.execute('project.update', { datos: { ruta, nombre: 'Demo web' } })
    const guardado = await t.executor.execute('project.save', { ruta })
    assert.ok(guardado.success, String(guardado.error?.message))

    const otra = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const carga = await otra.executor.execute('project.load', { ruta })
    assert.ok(carga.success, String(carga.error?.message))
    assert.deepEqual(otra.obtenerEstado().project.tracks.map((p) => p.nombre), ['Bajo web'])

    const lista = await fs.listarProyectos()
    assert.equal(lista[0]?.nombre, 'Demo web')
    assert.ok(lista[0]!.bytes > 100)
  })
})
