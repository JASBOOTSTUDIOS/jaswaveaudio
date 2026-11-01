/**
 * Habilidades por agente: de serie por rol y familia de instrumento, y las del usuario asignadas por @id.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ArchivoAsistente } from '@jaswave/host-sdk'
import {
  clavesDe,
  destinatariosDeHabilidad,
  familiaDe,
  habilidadesBaseDe,
  habilidadesDelEspecialista,
  habilidadesUsuarioDe,
  plantillaHabilidad,
} from '../src/motor/habilidades-agentes'
import { ESPECIALISTAS_POR_DEFECTO, type EspecialistaConfig } from '../src/motor/especialistas-storage'
import { participantesDesdeEspecialistas } from '../src/motor/turno/turno-banda'

const esp = (id: string): EspecialistaConfig => ESPECIALISTAS_POR_DEFECTO.find((e) => e.id === id)!
const archivo = (nombre: string, contenido: string): ArchivoAsistente => ({ ruta: `habilidades/${nombre}.md`, carpeta: 'habilidades', nombre, contenido, modificado: 1 })

describe('habilidades por agente', () => {
  it('detecta la familia de instrumento por instrumento, nombre o id', () => {
    assert.equal(familiaDe(esp('baterista')), 'bateria')
    assert.equal(familiaDe(esp('bajista')), 'bajo')
    assert.equal(familiaDe(esp('pianista')), 'piano')
    assert.equal(familiaDe(esp('guitarrista')), 'guitarra')
    assert.equal(familiaDe(esp('sintetizador')), 'sinte')
    assert.equal(familiaDe({ id: 'x', nombre: 'Sección de cuerdas', skills: [] }), 'cuerdas')
    assert.equal(familiaDe({ id: 'x', nombre: 'Cantante', skills: [] }), null)
  })

  it('cada rol tiene sus habilidades de serie y los músicos además las de su instrumento, todas contra lo robótico', () => {
    const bat = habilidadesBaseDe(esp('baterista')).map((h) => h.id)
    assert.ok(bat.includes('tocar-con-vida') && bat.includes('grabar-por-secciones') && bat.includes('bateria-groove') && bat.includes('bateria-fills-y-transiciones'), bat.join())
    const piano = habilidadesBaseDe(esp('pianista'))
    assert.ok(piano.some((h) => h.id === 'piano-voicings') && !piano.some((h) => h.id.startsWith('bateria')))
    assert.match(piano.find((h) => h.id === 'tocar-con-vida')!.contenido, /misma duración[\s\S]*add9[\s\S]*micro-tiempo/i)
    assert.match(piano.find((h) => h.id === 'piano-voicings')!.contenido, /no triadas planas/i)
    assert.deepEqual(
      habilidadesBaseDe(esp('mezcla')).map((h) => h.id),
      ['mezcla-balance-y-paneo', 'mezcla-eq-correctiva', 'mezcla-compresion', 'mezcla-espacio-y-reverb'],
    )
    assert.ok(habilidadesBaseDe(esp('mastering')).some((h) => h.id === 'master-a-menos-14-lufs'))
    assert.match(habilidadesBaseDe(esp('qa')).find((h) => h.id === 'revision-de-partes')!.contenido, /robótica/)
    for (const h of habilidadesBaseDe(esp('bajista'))) {
      assert.ok(h.nombre && h.descripcion && h.contenido.length > 80, h.id)
      assert.equal(h.origen, 'base')
    }
  })

  it('una habilidad del usuario llega solo a los agentes a los que se la asigna', () => {
    const archivos = [
      archivo('mi-groove', '# Mi groove de 6/8\n> @baterista Cuando la canción vaya en 6/8.\n\nBombo en 1 y 4, caja en 4, hi-hat en corcheas con acento en 1.'),
      archivo('para-todos', '# Dinámica suave\n> Cuando el pedido diga «íntimo».\n<!-- agente: musicos, mezcla -->\n\nTodo a media velocidad y nada por encima de 90.'),
      archivo('apagada', '# Vieja\n> @baterista no usar\n<!-- desactivada -->\n\nContenido viejo.'),
      archivo('sin-destino', '# Sin destino\n> Nadie la pidió.\n\nTexto.'),
    ]
    assert.deepEqual(destinatariosDeHabilidad(archivos[1]!.contenido), ['musicos', 'mezcla'])
    assert.ok(clavesDe(esp('mastering')).has('master') && clavesDe(esp('mastering')).has('mastering'))

    const bat = habilidadesUsuarioDe(esp('baterista'), archivos)
    assert.deepEqual(bat.map((h) => [h.id, h.nombre, h.descripcion, h.origen]), [
      ['mi-groove-de-6-8', 'Mi groove de 6/8', 'Cuando la canción vaya en 6/8.', 'usuario'],
      ['dinamica-suave', 'Dinámica suave', 'Cuando el pedido diga «íntimo».', 'usuario'],
    ])
    assert.deepEqual(habilidadesUsuarioDe(esp('mezcla'), archivos).map((h) => h.id), ['dinamica-suave'])
    assert.deepEqual(habilidadesUsuarioDe(esp('mastering'), archivos), [])

    // La del usuario sustituye a la de serie del mismo nombre.
    const propia = [archivo('groove', '# Groove de batería\n> @baterista Siempre.\n\nMi forma de tocar.')]
    const todas = habilidadesDelEspecialista(esp('baterista'), propia)
    assert.equal(todas.filter((h) => h.nombre === 'Groove de batería').length, 1)
    assert.ok(!todas.some((h) => h.id === 'bateria-groove'))
    assert.ok(todas.some((h) => h.id === 'groove-de-bateria' && h.origen === 'usuario' && h.contenido === 'Mi forma de tocar.'))
    assert.ok(todas.some((h) => h.id === 'bateria-fills-y-transiciones'))
  })

  it('los participantes de la banda llevan sus habilidades; la plantilla asigna por @slug', () => {
    const ps = participantesDesdeEspecialistas(ESPECIALISTAS_POR_DEFECTO, [], [archivo('x', '# Arpegios míos\n> @pianista En baladas.\n\nArpegio lento.')])
    const pianista = ps.find((p) => p.id === 'pianista')!
    assert.ok(pianista.habilidades!.some((h) => h.id === 'piano-voicings'))
    assert.ok(pianista.habilidades!.some((h) => h.nombre === 'Arpegios míos' && h.origen === 'usuario'))
    assert.ok(!ps.find((p) => p.id === 'bajista')!.habilidades!.some((h) => h.nombre === 'Arpegios míos'))

    const t = plantillaHabilidad(esp('baterista'), 'Groove de bachata')
    assert.equal(t.ruta, 'habilidades/baterista-percusion-groove-de-bachata.md')
    assert.ok(destinatariosDeHabilidad(t.contenido).includes('baterista-percusion'))
    assert.ok(clavesDe(esp('baterista')).has('baterista-percusion'))
  })
})
