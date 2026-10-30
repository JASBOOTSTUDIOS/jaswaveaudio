import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  agruparActividad,
  colapsarConsecutivos,
  esAlerta,
  estadosEtapas,
  itemsDeEventos,
  numeroEtapa,
  textoAcciones,
  type ItemActividad,
} from '../src/ui/actividad-agrupada'
import {
  agentesParaMenu,
  componerMensaje,
  destinosDeMenciones,
  nombreCorto,
  separarMenciones,
  tokenMencion,
  type AgenteMencionable,
} from '../src/ui/menciones-chat'

const AGENTES: AgenteMencionable[] = [
  { id: 'director', nombre: 'Director de Banda', rol: 'director' },
  { id: 'pianista', nombre: 'Pianista / Teclista', rol: 'musico', instrumento: 'Piano / Keys', color: '#3b82f6' },
  { id: 'bajista', nombre: 'Bajista', rol: 'musico', instrumento: 'Bajo', color: '#10b981' },
  { id: 'qa', nombre: 'QA / Auditor de Calidad Musical', rol: 'qa' },
]

function item(i: number, agente: string, texto: string, estado: ItemActividad['estado'] = 'ok'): ItemActividad {
  return { id: `i${i}`, agente, nombre: agente, texto, estado }
}

describe('agruparActividad', () => {
  it('60 líneas del bajista y 30 del baterista quedan en dos filas con su contador', () => {
    const items: ItemActividad[] = []
    for (let i = 0; i < 90; i++) items.push(i % 3 === 0 ? item(i, 'Baterista', 'Escribiendo notas MIDI') : item(i, 'Bajista', 'Revisando las notas MIDI'))
    const filas = agruparActividad(items)
    assert.equal(filas.length, 2)
    const bajista = filas.find((f) => f.agente === 'Bajista')!
    assert.equal(bajista.total, 60)
    assert.equal(bajista.texto, 'Revisando las notas MIDI')
    assert.equal(filas.find((f) => f.agente === 'Baterista')!.total, 30)
    assert.equal(bajista.items.length, 60, 'el detalle completo sigue disponible')
  })

  it('conserva el orden de primera aparición y el último estado de cada agente', () => {
    const filas = agruparActividad([item(1, 'A', 'uno', 'en_curso'), item(2, 'B', 'dos'), item(3, 'A', 'tres', 'ok')])
    assert.deepEqual(filas.map((f) => f.agente), ['A', 'B'])
    assert.equal(filas[0]!.texto, 'tres')
    assert.equal(filas[0]!.estado, 'ok')
  })

  it('los errores y avisos no se pierden y no se repiten', () => {
    const filas = agruparActividad([
      item(1, 'Bajista', 'Revisando'),
      item(2, 'Bajista', 'No se pudo escribir el clip', 'error'),
      item(3, 'Bajista', 'No se pudo escribir el clip', 'error'),
      item(4, 'Bajista', 'Aviso: notas fuera de tonalidad', 'aviso'),
      item(5, 'Bajista', 'Revisando'),
    ])
    assert.equal(filas[0]!.alertas.length, 2)
    assert.deepEqual(filas[0]!.alertas.map((a) => a.estado), ['error', 'aviso'])
  })

  it('textoAcciones usa singular y plural', () => {
    assert.equal(textoAcciones(1), '1 acción')
    assert.equal(textoAcciones(12), '12 acciones')
  })
})

describe('colapsarConsecutivos', () => {
  const clave = (s: string) => s.replace('!', '')
  it('«Revisar las notas» ×87 seguidas es un solo grupo', () => {
    const lista = Array.from({ length: 87 }, () => 'Revisar las notas')
    const g = colapsarConsecutivos(lista, clave)
    assert.equal(g.length, 1)
    assert.equal(g[0]!.veces, 87)
  })

  it('solo une las consecutivas: A A B A son tres grupos', () => {
    const g = colapsarConsecutivos(['A', 'A', 'B', 'A'], clave)
    assert.deepEqual(g.map((x) => [x.clave, x.veces]), [['A', 2], ['B', 1], ['A', 1]])
  })

  it('los especiales (fallos) nunca se funden', () => {
    const g = colapsarConsecutivos(['A!', 'A!', 'A', 'A'], clave, (t) => t.endsWith('!'))
    assert.deepEqual(g.map((x) => x.veces), [1, 1, 2])
  })
})

describe('eventos de la banda', () => {
  const ev = (id: string, agenteId: string, mensaje: string, extra: Record<string, unknown> = {}) => ({ id, agenteId, agenteNombre: agenteId, mensaje, ...extra })

  it('esAlerta detecta fallos y correcciones del QA', () => {
    assert.equal(esAlerta('No se pudo conectar'), true)
    assert.equal(esAlerta('Revisando las notas MIDI'), false)
    assert.equal(esAlerta('Revisando', 'corrigiendo'), true)
  })

  it('el último evento de quien trabaja ahora está en curso; un error conserva su gravedad', () => {
    const items = itemsDeEventos(
      [ev('1', 'bajista', 'Revisando'), ev('2', 'bajista', 'Escribiendo'), ev('3', 'pianista', 'Falló la escritura'), ev('4', 'qa', 'Revisando', { estadoQA: 'corrigiendo' })],
      { activo: true, agenteActivoId: 'bajista' },
    )
    assert.deepEqual(items.map((i) => i.estado), ['ok', 'en_curso', 'error', 'aviso'])
  })

  it('terminada la producción nada queda «en curso»', () => {
    const items = itemsDeEventos([ev('1', 'bajista', 'Listo')], { activo: false, agenteActivoId: 'bajista' })
    assert.equal(items[0]!.estado, 'ok')
  })
})

describe('etapas de la producción', () => {
  it('marca hechas, actual y pendientes', () => {
    const e = estadosEtapas('mezcla', true)
    assert.deepEqual(e.map((x) => x.estado), ['hecha', 'hecha', 'hecha', 'actual', 'pendiente', 'pendiente'])
    assert.equal(numeroEtapa('ensayo'), 3)
  })
  it('completada: todo hecho', () => {
    assert.ok(estadosEtapas('completado', false).every((x) => x.estado === 'hecha'))
  })
  it('detenida (inactiva) no marca etapa actual', () => {
    assert.ok(estadosEtapas('grabacion_musicos', false).every((x) => x.estado !== 'actual'))
  })
})

describe('menciones @agente', () => {
  it('nombreCorto quita el apellido de oficio tras la barra', () => {
    assert.equal(nombreCorto('Pianista / Teclista'), 'Pianista')
    assert.equal(nombreCorto('Bajista'), 'Bajista')
  })

  it('componerMensaje serializa comando, menciones y texto en ese orden', () => {
    const msg = componerMensaje('/plan', [{ id: 'agent:bajista', kind: 'agent', etiqueta: 'Bajista' }], 'sube un tono')
    assert.equal(msg, '/plan @"Bajista" sube un tono')
    assert.equal(componerMensaje(undefined, [], 'hola'), 'hola')
  })

  it('una mención inicial se separa del texto y se ve como pastilla (nunca «@id»)', () => {
    const r = separarMenciones(`${tokenMencion('Pianista / Teclista')} toca más suave`, AGENTES)
    assert.equal(r.texto, 'toca más suave')
    assert.equal(r.menciones.length, 1)
    assert.equal(r.menciones[0]!.visible, 'Pianista')
    assert.equal(r.menciones[0]!.agente?.id, 'pianista')
  })

  it('«@Bajista» escrito a mano también es una mención; en medio queda el nombre en claro', () => {
    const r = separarMenciones('oye @Bajista y también @director sigan', AGENTES)
    assert.equal(r.texto, 'oye Bajista y también Director de Banda sigan')
    assert.deepEqual(r.menciones.map((m) => m.agente?.id), ['bajista', 'director'])
  })

  it('no confunde correos, @msg: ni arrobas sueltas', () => {
    assert.deepEqual(separarMenciones('escribe a yo@bajista.com', AGENTES).menciones, [])
    assert.deepEqual(separarMenciones('mira @msg:abc-1 y @nadie', AGENTES).menciones, [])
    assert.equal(separarMenciones('mira @msg:abc-1', AGENTES).texto, 'mira @msg:abc-1')
  })

  it('varias menciones iniciales y repetidas se deduplican', () => {
    const r = separarMenciones('@"Bajista" @"Pianista / Teclista" @Bajista a tempo', AGENTES)
    assert.equal(r.menciones.length, 2)
    assert.equal(r.texto, 'a tempo')
  })

  it('una cita entrecomillada desconocida es una mención genérica (pista, clip…)', () => {
    const r = separarMenciones('@"Pista 1" más grave', AGENTES)
    assert.equal(r.menciones[0]!.agente, undefined)
    assert.equal(r.menciones[0]!.visible, 'Pista 1')
  })

  it('destinosDeMenciones dirige la nota a los participantes y avisa de los ausentes', () => {
    const participantes = [{ id: 'bajista', nombre: 'Bajista' }, { id: 'pianista', nombre: 'Pianista / Teclista' }]
    const d = destinosDeMenciones('@"Bajista" @"Director de Banda" más grave', AGENTES, participantes)
    assert.deepEqual(d.para, [{ id: 'bajista', nombre: 'Bajista' }])
    assert.deepEqual(d.ausentes, ['Director de Banda'])
    assert.equal(d.texto, 'más grave')
  })

  it('agentesParaMenu usa los participantes de la producción si los hay, si no los activos', () => {
    const esp = [
      { id: 'bajista', nombre: 'Bajista', role: 'musico', instrumento: 'Bajo', color: '#10b981', activo: true },
      { id: 'viejo', nombre: 'Viejo', role: 'musico', activo: false },
    ]
    assert.deepEqual(agentesParaMenu(esp, []).map((a) => a.id), ['bajista'])
    const enBanda = agentesParaMenu(esp, [{ id: 'bajista', nombre: 'Bajista' }, { id: 'usuario', nombre: 'Tú' }])
    assert.deepEqual(enBanda.map((a) => a.id), ['bajista'])
    assert.equal(enBanda[0]!.instrumento, 'Bajo')
  })
})
