import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { esRutaProyecto, rutaProyectoDeArgv } from './instancia-unica'

describe('instancia-unica (U7)', () => {
  it('reconoce la extensión de proyecto', () => {
    assert.equal(esRutaProyecto('C:/proyectos/cancion.jaswave'), true)
    assert.equal(esRutaProyecto('C:/proyectos/cancion.JASWAVE'), true)
    assert.equal(esRutaProyecto('C:/proyectos/cancion.wav'), false)
    assert.equal(esRutaProyecto(undefined), false)
  })

  it('extrae el proyecto de los argumentos de la app', () => {
    const argv = ['C:/Program Files/JasWave/JasWave.exe', 'C:/proyectos/cancion.jaswave']
    assert.equal(rutaProyectoDeArgv(argv), 'C:/proyectos/cancion.jaswave')
  })

  it('ignora argumentos que no son proyectos', () => {
    const argv = ['C:/Program Files/JasWave/JasWave.exe', '--inspect', 'C:/audio/intro.wav']
    assert.equal(rutaProyectoDeArgv(argv), null)
  })

  it('descarta rutas que no existen', () => {
    const argv = ['C:/proyectos/no-existe.jaswave']
    assert.equal(rutaProyectoDeArgv(argv, () => false), null)
  })

  it('no se rompe si la comprobación de existencia lanza', () => {
    const argv = ['C:/proyectos/error.jaswave']
    assert.equal(
      rutaProyectoDeArgv(argv, () => {
        throw new Error('EACCES')
      }),
      null,
    )
  })

  it('devuelve la primera ruta válida', () => {
    const argv = ['C:/proyectos/a.jaswave', 'C:/proyectos/b.jaswave']
    assert.equal(rutaProyectoDeArgv(argv), 'C:/proyectos/a.jaswave')
  })
})
