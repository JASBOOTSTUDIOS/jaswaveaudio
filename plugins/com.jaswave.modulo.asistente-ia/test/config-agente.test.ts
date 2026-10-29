/**
 * Configuración del agente al estilo IDE: reglas, AGENTS.md, habilidades (usuario y proyecto) y modos de sesión.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

const mem = new Map<string, string>()
beforeEach(() => {
  mem.clear()
  const g = globalThis as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  }
  g.window ??= { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined }
  if (typeof g.CustomEvent === 'undefined') g.CustomEvent = class extends Event {}
})

describe('config-agente', () => {
  beforeEach(async () => {
    const { carpetaAsistente } = await import('@jaswave/host-sdk')
    carpetaAsistente.reiniciar()
  })

  it('guarda y carga reglas y habilidades, descartando las que no tienen nombre', async () => {
    const c = await import('../src/motor/config-agente')
    await c.guardarConfigAgente({
      version: 1,
      reglas: 'Responde breve.',
      habilidades: [
        { id: 'a', nombre: 'Batería worship', descripcion: 'ritmos de adoración', instrucciones: 'Usa cross-stick en versos.', activa: true },
        { id: 'b', nombre: '  ', descripcion: '', instrucciones: 'x', activa: true },
      ],
    })
    const cfg = c.cargarConfigAgente()
    assert.equal(cfg.reglas, 'Responde breve.')
    assert.deepEqual(cfg.habilidades.map((h) => h.nombre), ['Batería worship'])
    // Cada habilidad es un archivo de la carpeta de configuración
    const { carpetaAsistente } = await import('@jaswave/host-sdk')
    assert.match(carpetaAsistente.archivo('habilidades/bateria-worship.md')?.contenido ?? '', /^# Batería worship\n> ritmos de adoración\n\nUsa cross-stick/)
  })

  it('la primera vez pasa a la carpeta la configuración que estaba en el navegador', async () => {
    mem.set('jaswave-agente-config-v1', JSON.stringify({ version: 1, reglas: 'Antigua regla.', habilidades: [{ id: 'x', nombre: 'Coros', descripcion: 'd', instrucciones: 'i', activa: false }] }))
    const c = await import('../src/motor/config-agente')
    await c.prepararConfigAgente()
    const cfg = c.cargarConfigAgente()
    assert.equal(cfg.reglas, 'Antigua regla.')
    assert.deepEqual(cfg.habilidades.map((h) => [h.nombre, h.activa]), [['Coros', false]])
  })

  it('los prompts y planes activos aparecen en las instrucciones', async () => {
    const c = await import('../src/motor/config-agente')
    await c.prepararConfigAgente()
    await c.guardarDocumentosConfig('prompts', [{ id: 'n', nombre: 'Intro épica', descripcion: 'empezar temas', instrucciones: 'pad + piano', activa: true }])
    await c.guardarDocumentosConfig('planes', [{ id: 'n', nombre: 'Mezcla rápida', descripcion: '', instrucciones: '- [ ] volúmenes', activa: false }])
    const txt = c.instruccionesConfiguradas('p-prompts')
    assert.match(txt, /Prompts guardados del usuario[\s\S]*- Intro épica: empezar temas/)
    assert.doesNotMatch(txt, /Mezcla rápida/)
  })

  it('una habilidad del proyecto se lee de un documento habilidad-*.md', async () => {
    const c = await import('../src/motor/config-agente')
    const h = c.habilidadDesdeDoc('habilidad-coros.md', '# Coros\n> cuando pidan coros\nDobla la voz una octava arriba.')
    assert.equal(h?.nombre, 'Coros')
    assert.equal(h?.descripcion, 'cuando pidan coros')
    assert.equal(h?.instrucciones, 'Dobla la voz una octava arriba.')
    assert.equal(c.habilidadDesdeDoc('habilidad-vacia.md', '# Solo título'), null)
  })

  it('instruccionesConfiguradas incluye reglas, AGENTS.md y la lista de habilidades; la búsqueda ignora acentos', async () => {
    const c = await import('../src/motor/config-agente')
    const { writeAgentDoc } = await import('@jaswave/host-sdk')
    await c.guardarConfigAgente({
      version: 1,
      reglas: 'Nunca cambies el tempo sin preguntar.',
      habilidades: [{ id: 'a', nombre: 'Batería worship', descripcion: 'ritmos de adoración', instrucciones: 'x', activa: true }],
    })
    writeAgentDoc('p-cfg', c.AGENTS_SLUG, '# Proyecto\nTonalidad: Re mayor.', { origin: 'user' })
    const txt = c.instruccionesConfiguradas('p-cfg')
    assert.match(txt, /Nunca cambies el tempo/)
    assert.match(txt, /Tonalidad: Re mayor/)
    assert.match(txt, /- Batería worship: ritmos de adoración/)
    const lista = c.habilidadesDisponiblesAgente('p-cfg')
    assert.equal(c.buscarHabilidadAgente(lista, 'bateria WORSHIP')?.id, 'habilidades/bateria-worship.md')
  })
})

describe('/configurar: la IA crea, edita, elimina y recupera la configuración', () => {
  it('afirmaCambioConfig detecta «lo hice» sin confundirlo con preguntas o negaciones', async () => {
    const { afirmaCambioConfig, sinAvisoModoConfigurar } = await import('../src/motor/turno/herramientas-ide')
    assert.equal(afirmaCambioConfig('He borrado la habilidad «Batería lenta».'), true)
    assert.equal(afirmaCambioConfig('Listo: guardé tu habilidad.'), true)
    assert.equal(afirmaCambioConfig('Ya está guardada.'), true)
    assert.equal(afirmaCambioConfig('¿Quieres que la guarde?'), false)
    assert.equal(afirmaCambioConfig('No he borrado nada todavía.'), false)
    assert.equal(afirmaCambioConfig('Cree que suena bien.'), false)
    assert.equal(afirmaCambioConfig('¿Qué quieres crear primero?'), false)
    assert.equal(
      sinAvisoModoConfigurar('Hecho. Sigues en el modo configurar: pídeme más cambios o escribe «/configurar salir» para volver a la música.'),
      'Hecho.',
    )
  })

  it('pideConfigurar distingue pedidos sobre la configuración de los musicales', async () => {
    const { pideConfigurar } = await import('../src/motor/turno/herramientas-ide')
    assert.equal(pideConfigurar('créame una habilidad para baterías lentas'), true)
    assert.equal(pideConfigurar('borra mi prompt de intro'), true)
    assert.equal(pideConfigurar('crea una batería'), false)
  })

  it('las herramientas config_* trabajan sobre la carpeta y dejan un resumen legible', async () => {
    const { carpetaAsistente } = await import('@jaswave/host-sdk')
    carpetaAsistente.reiniciar()
    const ide = await import('../src/motor/turno/herramientas-ide')
    const efectos = { reglas: [], tareas: [], config: [] as string[] }
    const run = (nombre: string, argumentos: Record<string, unknown>) =>
      ide.ejecutarHerramientaIde({ id: nombre, nombre, argumentos }, { projectId: 'p', habilidades: [], efectos })

    assert.deepEqual(ide.herramientasConfig({ escribir: false }).map((h) => h.nombre), ['config_listar', 'config_leer'])
    assert.ok((await run('config_escribir', { carpeta: 'prompts', nombre: 'Intro épica', descripcion: 'empezar', contenido: 'pad y piano' }))?.ok)
    assert.ok((await run('config_escribir', { carpeta: 'prompts', nombre: 'Intro épica', contenido: 'pad, piano y cuerdas' }))?.ok)
    const leido = await run('config_leer', { carpeta: 'prompts', nombre: 'intro epica' })
    assert.deepEqual(leido?.datos, { nombre: 'Intro épica', descripcion: 'empezar', activo: true, contenido: 'pad, piano y cuerdas' })
    assert.ok((await run('config_escribir', { carpeta: 'reglas', contenido: 'Responde breve.' }))?.ok)
    const lista = await run('config_listar', {})
    assert.equal((lista?.datos as { reglas: string }).reglas, 'Responde breve.')

    assert.ok((await run('config_eliminar', { carpeta: 'prompts', nombre: 'Intro épica' }))?.ok)
    assert.equal((await run('config_leer', { carpeta: 'prompts', nombre: 'Intro épica' }))?.ok, false)
    assert.ok((await run('config_restaurar', { carpeta: 'prompts', nombre: 'Intro épica' }))?.ok)
    assert.equal((await run('config_eliminar', { carpeta: 'planes', nombre: 'No existe' }))?.ok, false)
    assert.equal((await run('config_escribir', { carpeta: 'otra', contenido: 'x' }))?.ok, false)

    assert.deepEqual(efectos.config, [
      'Creé el prompt «Intro épica»',
      'Actualicé el prompt «Intro épica»',
      'Actualicé tus reglas',
      'Eliminé el prompt «Intro épica» (se puede recuperar)',
      'Recuperé el prompt «Intro épica»',
    ])
  })

  it('el modo configurar dura en la conversación', async () => {
    const s = await import('../src/motor/turno/sesion-agente')
    s.fijarModoSesion('c-cfg', { tipo: 'configurar', tema: '', inicio: Date.now() })
    assert.equal(s.modoSesion('c-cfg')?.tipo, 'configurar')
  })
})

describe('herramientas IDE y modos de sesión', () => {
  it('pideAprender detecta cuándo el usuario enseña una preferencia', async () => {
    const { pideAprender } = await import('../src/motor/turno/herramientas-ide')
    assert.equal(pideAprender('a partir de ahora usa Re mayor'), true)
    assert.equal(pideAprender('recuerda que prefiero pads suaves'), true)
    assert.equal(pideAprender('crea una batería'), false)
  })

  it('la meta y la entrevista duran por conversación y se pueden quitar', async () => {
    const s = await import('../src/motor/turno/sesion-agente')
    s.fijarModoSesion('c1', { tipo: 'meta', objetivo: 'mezcla lista', inicio: Date.now() })
    s.fijarModoSesion('c2', { tipo: 'entrevista', tema: 'estilo', inicio: Date.now() })
    assert.equal(s.modoSesion('c1')?.tipo, 'meta')
    assert.equal(s.modoSesion('c2')?.tipo, 'entrevista')
    s.fijarModoSesion('c1', null)
    assert.equal(s.modoSesion('c1'), null)
    assert.equal(s.modoSesion('c2')?.tipo, 'entrevista')
  })

  it('los grupos permitidos de un especialista limitan sus herramientas (las consultas siempre van)', async () => {
    const { herramientasDeGrupos } = await import('../src/motor/turno/catalogo-agente')
    const h = (nombre: string, clase: 'lectura' | 'escritura' | 'destructiva') => ({ nombre, descripcion: '', parametros: {}, clase })
    const catalogo = [h('track.list', 'lectura'), h('midi.addNotes', 'escritura'), h('mix.setVolume', 'escritura'), h('project.setBpm', 'escritura')]
    assert.equal(herramientasDeGrupos(undefined, catalogo), undefined)
    assert.equal(herramientasDeGrupos([], catalogo), undefined)
    assert.deepEqual(herramientasDeGrupos(['notas'], catalogo), ['track.list', 'midi.addNotes'])
  })

  it('una sesión vieja (más de 7 días) caduca', async () => {
    const s = await import('../src/motor/turno/sesion-agente')
    s.fijarModoSesion('c3', { tipo: 'meta', objetivo: 'x', inicio: Date.now() - 8 * 24 * 3600_000 })
    assert.equal(s.modoSesion('c3'), null)
  })
})
