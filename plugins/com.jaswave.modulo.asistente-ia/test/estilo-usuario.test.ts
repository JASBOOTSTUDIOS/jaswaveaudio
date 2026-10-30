/**
 * Skill de estilo del usuario (K1): markdown con el perfil JSON, lectura, y aplicación a la pista del músico.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ArchivoAsistente } from '@jaswave/host-sdk'
import { estiloActivoDelUsuario, estiloDesdeArchivo, estilosDelUsuario, habilidadEstiloMarkdown } from '../src/motor/habilidades-agentes'
import { aplicarEstiloAMusico } from '../src/motor/turno/turno-banda'

const archivoDe = (ruta: string, contenido: string): ArchivoAsistente => ({ ruta, carpeta: 'habilidades', nombre: ruta.replace(/^habilidades\//, '').replace(/\.md$/, ''), contenido, modificado: 1 })
const perfil = { version: 2, timing: { medioMs: 6 }, notas: [1, 2, 3] }

describe('skill de estilo del usuario', () => {
  it('ida y vuelta: markdown → estilo con perfil, id e intensidad', () => {
    const md = habilidadEstiloMarkdown({ nombre: 'Mi toque suave', resumen: 'Llega 6 ms tarde.\nLegato 92 %.', perfilId: 'toque-x', perfil, intensidad: 0.7 })
    assert.equal(md.ruta, 'habilidades/estilo-mi-toque-suave.md')
    assert.match(md.contenido, /<!-- agente: musicos -->/)
    const e = estiloDesdeArchivo(archivoDe(md.ruta, md.contenido))
    assert.ok(e)
    assert.equal(e.nombre, 'Mi toque suave')
    assert.equal(e.perfilId, 'toque-x')
    assert.equal(e.intensidad, 0.7)
    assert.equal(e.resumen, 'Llega 6 ms tarde.\nLegato 92 %.')
    assert.deepEqual(e.perfil, perfil)
    assert.equal(e.activo, true)
  })

  it('ignora habilidades que no son de estilo y respeta «desactivada»', () => {
    const md = habilidadEstiloMarkdown({ nombre: 'A', resumen: 'r', perfil })
    const otro = archivoDe('habilidades/bajo-con-el-bombo.md', '# Otro')
    const off = archivoDe(md.ruta, `${md.contenido}\n<!-- desactivada -->\n`)
    assert.equal(estiloDesdeArchivo(otro), null)
    assert.equal(estilosDelUsuario([otro, off]).length, 1)
    assert.equal(estiloActivoDelUsuario([otro, off]), null)
    assert.equal(estiloActivoDelUsuario([otro, archivoDe(md.ruta, md.contenido)])?.nombre, 'A')
  })

  it('aplicarEstiloAMusico: llama a style.touch.apply con la pista; salta la batería y pistas desconocidas', async () => {
    const tienda = { obtenerEstado: () => ({ project: { tracks: [{ id: 't1', nombre: 'Piano' }] } }) } as never
    const llamadas: Array<{ n: string; a: Record<string, unknown> }> = []
    const ej = async (n: string, a: Record<string, unknown>) => {
      llamadas.push({ n, a })
      return { ok: true }
    }
    const estilo = { nombre: 'Mi estilo', perfilId: 'toque-x', intensidad: 0.8 }
    assert.equal(await aplicarEstiloAMusico(tienda, ej, estilo, { id: 'pianista', nombre: 'Pianista' }, 'Piano', 3), true)
    assert.equal(llamadas[0]!.n, 'style.touch.apply')
    assert.equal(llamadas[0]!.a.trackId, 't1')
    assert.equal(llamadas[0]!.a.intensidad, 0.8)
    assert.equal(await aplicarEstiloAMusico(tienda, ej, estilo, { id: 'baterista', nombre: 'Baterista' }, 'Piano', 3), false)
    assert.equal(await aplicarEstiloAMusico(tienda, ej, estilo, { id: 'pianista', nombre: 'Pianista' }, 'Otra', 3), false)
    assert.equal(await aplicarEstiloAMusico(tienda, ej, estilo, { id: 'pianista', nombre: 'Pianista' }, undefined, 3), false)
    assert.equal(llamadas.length, 1)
  })
})
