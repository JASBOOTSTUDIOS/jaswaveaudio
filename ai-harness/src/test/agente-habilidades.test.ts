import { describe, expect, it } from 'vitest'
import {
  buscarHabilidad,
  ejecutarAgente,
  ejecutarProduccion,
  H_ENCARGOS,
  H_LEER_HABILIDAD,
  H_VEREDICTO,
  habilidadDesdeMarkdown,
  listadoHabilidades,
  unirHabilidades,
  type ChatAgente,
  type HabilidadAgente,
  type HerramientaAgente,
  type ParticipanteProduccion,
  type RespuestaModelo,
} from '../agente'

const CATALOGO: HerramientaAgente[] = [
  { nombre: 'project.getSummary', descripcion: 'Resumen del proyecto', parametros: { type: 'object' }, clase: 'lectura' },
  { nombre: 'midi.addNotes', descripcion: 'Escribe notas', parametros: { type: 'object' }, clase: 'escritura' },
]

const GROOVE: HabilidadAgente = {
  id: 'bateria-groove',
  nombre: 'Groove de batería',
  descripcion: 'Cuando grabes la base rítmica de una canción.',
  contenido: 'Bombo en 1 y 3, caja en 2 y 4, hi-hat en corcheas. Fill al final de cada sección.',
  origen: 'base',
}

let n = 0
const ll = (nombre: string, argumentos: Record<string, unknown> = {}) => ({ id: `${nombre}-${++n}`, nombre, argumentos })
const hecho = (texto: string): RespuestaModelo => ({ ok: true, texto, llamadas: [] })

describe('habilidades: documento, unión y búsqueda', () => {
  it('lee el formato de la carpeta del asistente y el frontmatter', () => {
    const a = habilidadDesdeMarkdown('# Línea de bajo\n> Cuando grabes el bajo.\n<!-- agente: bajista -->\n\nFundamental en el primer tiempo.\nSigue al bombo.', { origen: 'usuario' })
    expect(a).toMatchObject({ id: 'linea-de-bajo', nombre: 'Línea de bajo', descripcion: 'Cuando grabes el bajo.', origen: 'usuario' })
    expect(a?.contenido).toBe('Fundamental en el primer tiempo.\nSigue al bombo.')
    const b = habilidadDesdeMarkdown('---\nname: Voicings\ndescription: "Acordes de piano"\n---\nTres o cuatro notas, sin la fundamental si el bajo la toca.')
    expect(b).toMatchObject({ id: 'voicings', nombre: 'Voicings', descripcion: 'Acordes de piano' })
    expect(habilidadDesdeMarkdown('# Sin cuerpo\n> solo título')).toBeNull()
    expect(habilidadDesdeMarkdown('solo texto', { nombrePorDefecto: 'archivo' })?.nombre).toBe('archivo')
  })

  it('une sin repetir id (la última gana) y busca tolerando acentos y mayúsculas', () => {
    const propia = { ...GROOVE, contenido: 'Mi groove', origen: 'usuario' as const }
    const lista = unirHabilidades([GROOVE], [propia, { id: 'otra', nombre: 'Otra', descripcion: '', contenido: 'x' }])
    expect(lista.map((h) => h.id)).toEqual(['bateria-groove', 'otra'])
    expect(lista[0]?.contenido).toBe('Mi groove')
    expect(buscarHabilidad(lista, 'groove de bateria')?.id).toBe('bateria-groove')
    expect(buscarHabilidad(lista, 'GROOVE')?.id).toBe('bateria-groove')
    expect(listadoHabilidades(lista)).toMatch(/leer_habilidad[\s\S]*- Groove de batería: Cuando grabes la base rítmica/)
    expect(listadoHabilidades([])).toBe('')
  })
})

describe('habilidades en la producción', () => {
  const EQUIPO: ParticipanteProduccion[] = [
    { id: 'dir', nombre: 'Director', descripcion: 'dirige', instrucciones: '', rol: 'director' },
    { id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', rol: 'musico', habilidades: [{ id: 'mi-fill', nombre: 'Mis fills', descripcion: 'Al cambiar de sección.', contenido: 'Redoble de caja en el último tiempo.' }] },
    { id: 'qa', nombre: 'QA', descripcion: 'calidad', instrucciones: '', rol: 'qa' },
  ]

  it('cada participante ve sus habilidades (de serie + propias), lee la que aplica y recibe su contenido', async () => {
    let sistemaBat = ''
    let herramientasBat: string[] = []
    let leida: unknown = null
    const chat: ChatAgente = async (o) => {
      const rol = /^Eres (\S+)/.exec(o.sistema)?.[1] ?? '?'
      const ultimo = o.mensajes[o.mensajes.length - 1]
      if (rol === 'Director') return ultimo?.role === 'tool' ? hecho('ok') : { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }] })] }
      if (rol === 'QA') return ultimo?.role === 'tool' ? hecho('ok') : { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      if (rol === 'Batería') {
        sistemaBat = o.sistema
        herramientasBat = o.herramientas.map((h) => h.name)
        if (ultimo?.role === 'tool') {
          if (ultimo.name === H_LEER_HABILIDAD) leida = JSON.parse(ultimo.content)
          return ultimo.name === H_LEER_HABILIDAD ? { ok: true, texto: '', llamadas: [ll('midi.addNotes')] } : hecho('Grabado.')
        }
        return { ok: true, texto: '', llamadas: [ll(H_LEER_HABILIDAD, { nombre: 'Groove de batería' })] }
      }
      return hecho('ok')
    }
    const r = await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      participantes: EQUIPO,
      chat,
      ejecutar: async () => ({ ok: true }),
      habilidadesPorRol: { musico: [GROOVE] },
    })
    expect(sistemaBat).toMatch(/Tus habilidades[\s\S]*- Groove de batería: Cuando grabes la base rítmica[\s\S]*- Mis fills: Al cambiar de sección/)
    expect(herramientasBat).toContain(H_LEER_HABILIDAD)
    expect(leida).toMatchObject({ ok: true, datos: { nombre: 'Groove de batería', instrucciones: GROOVE.contenido } })
    expect(r.llamadas.find((l) => l.nombre === H_LEER_HABILIDAD)).toMatchObject({ agente: 'bat', ok: true, clase: 'lectura' })
    expect(r.estado).toBe('completado')
  })

  it('sin habilidades no aparece la herramienta ni el bloque; un nombre desconocido se rechaza con la lista', async () => {
    const sistemas: string[] = []
    const herramientas: string[][] = []
    const chat: ChatAgente = async (o) => {
      sistemas.push(o.sistema)
      herramientas.push(o.herramientas.map((h) => h.name))
      return hecho('ok')
    }
    await ejecutarProduccion({ pedido: 'tema', catalogo: CATALOGO, participantes: EQUIPO.filter((p) => p.id !== 'bat'), chat, ejecutar: async () => ({ ok: true }) })
    expect(sistemas.some((s) => /Tus habilidades/.test(s))).toBe(false)
    expect(herramientas.flat()).not.toContain(H_LEER_HABILIDAD)

    const r = await ejecutarAgente({
      pedido: 'graba',
      sistema: 'Eres el agente principal.',
      catalogo: CATALOGO,
      chat: async (o) => (o.mensajes[o.mensajes.length - 1]?.role === 'tool' ? hecho('fin') : { ok: true, texto: '', llamadas: [ll('delegar', { encargos: [{ tarea: 'toca', perfil: 'bat' }] })] }),
      ejecutar: async () => ({ ok: true }),
      subagentes: [{ id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', habilidades: [GROOVE] }],
      maxSubagentes: 1,
    })
    expect(r.estado).toBe('completado')
  })

  it('un subagente delegado también tiene sus habilidades a mano', async () => {
    let sistemaSub = ''
    let leida = ''
    const chat: ChatAgente = async (o) => {
      const ultimo = o.mensajes[o.mensajes.length - 1]
      if (/^Eres Batería/.test(o.sistema)) {
        sistemaSub = o.sistema
        if (ultimo?.role === 'tool') {
          leida = ultimo.content
          return hecho('Hecho.')
        }
        return { ok: true, texto: '', llamadas: [ll(H_LEER_HABILIDAD, { nombre: 'groove' })] }
      }
      return ultimo?.role === 'tool' ? hecho('fin') : { ok: true, texto: '', llamadas: [ll('delegar', { encargos: [{ tarea: 'graba la batería', perfil: 'bat' }] })] }
    }
    const r = await ejecutarAgente({
      pedido: 'graba',
      sistema: 'Eres el agente principal.',
      catalogo: CATALOGO,
      chat,
      ejecutar: async () => ({ ok: true }),
      subagentes: [{ id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', habilidades: [GROOVE] }],
      maxSubagentes: 1,
    })
    expect(sistemaSub).toMatch(/Tus habilidades[\s\S]*Groove de batería/)
    expect(leida).toMatch(/Bombo en 1 y 3/)
    expect(r.estado).toBe('completado')
  })
})
