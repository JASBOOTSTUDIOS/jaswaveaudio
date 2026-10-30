import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { esRutaProyecto, rutaExtensionDeArgv, rutaProyectoDeArgv, tokenHandoverDeArgv } from './instancia-unica'

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

describe('tokenHandoverDeArgv (H1)', () => {
  const tok = 'A'.repeat(43)
  it('extrae el token de jaswave://abrir', () => {
    assert.equal(tokenHandoverDeArgv(['C:\\JasWave.exe',`jaswave://abrir?token=${tok}`]), tok)
    assert.equal(tokenHandoverDeArgv([`jaswave://abrir/?token=${tok}`]), tok)
  })
  it('ignora otras acciones, otros esquemas y tokens mal formados', () => {
    assert.equal(tokenHandoverDeArgv([`jaswave://borrar?token=${tok}`]), null)
    assert.equal(tokenHandoverDeArgv([`https://abrir?token=${tok}`]), null)
    assert.equal(tokenHandoverDeArgv(['jaswave://abrir?token=corto']), null)
    assert.equal(tokenHandoverDeArgv([`jaswave://abrir?token=${tok}%22%20--inject`]), null)
    assert.equal(tokenHandoverDeArgv(['C:\\proyecto.jaswave']), null)
  })
})

describe('rutaExtensionDeArgv (X1)', () => {
  it('devuelve la extensión .jwx de los argumentos (doble clic)', () => {
    assert.equal(rutaExtensionDeArgv(['C:/JasWave.exe', 'C:/descargas/mi-modulo-1.0.0.JWX']), 'C:/descargas/mi-modulo-1.0.0.JWX')
  })
  it('ignora proyectos, enlaces y archivos que no existen', () => {
    assert.equal(rutaExtensionDeArgv(['C:/p.jaswave', 'jaswave://abrir?token=x']), null)
    assert.equal(rutaExtensionDeArgv(['C:/no-existe.jwx'], () => false), null)
    assert.equal(
      rutaExtensionDeArgv(['C:/x.jwx'], () => {
        throw new Error('EACCES')
      }),
      null,
    )
  })
})
