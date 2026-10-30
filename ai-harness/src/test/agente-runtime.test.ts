import { describe, expect, it } from 'vitest'
import {
  ejecutarAgente,
  buscarHerramientas,
  limpiarTextoUsuario,
  sistemaAgente,
  type ChatAgente,
  type HerramientaAgente,
  type RespuestaModelo,
  type EventoAgente,
} from '../agente'

const CATALOGO: HerramientaAgente[] = [
  { nombre: 'project.getSummary', descripcion: 'Resumen del proyecto', parametros: { type: 'object' }, clase: 'lectura', titulo: 'Revisando el proyecto' },
  { nombre: 'track.list', descripcion: 'Lista las pistas', parametros: { type: 'object' }, clase: 'lectura' },
  { nombre: 'project.setBpm', descripcion: 'Cambia el tempo del proyecto', parametros: { type: 'object' }, clase: 'escritura', titulo: 'Cambiando el tempo' },
  { nombre: 'track.create', descripcion: 'Crea una pista nueva', parametros: { type: 'object' }, clase: 'escritura' },
  { nombre: 'midi.quantize', descripcion: 'Cuantiza las notas de un clip', parametros: { type: 'object' }, clase: 'escritura' },
  { nombre: 'track.delete', descripcion: 'Elimina una pista', parametros: { type: 'object' }, clase: 'destructiva' },
]

/** Modelo guionizado: devuelve las respuestas en orden y guarda lo que recibió. */
function guion(respuestas: Array<RespuestaModelo | ((o: Parameters<ChatAgente>[0]) => RespuestaModelo)>) {
  const vistos: Parameters<ChatAgente>[0][] = []
  let i = 0
  const chat: ChatAgente = async (o) => {
    vistos.push({ ...o, mensajes: [...o.mensajes] })
    const r = respuestas[i++] ?? { ok: true, texto: 'fin', llamadas: [] }
    return typeof r === 'function' ? r(o) : r
  }
  return { chat, vistos }
}
const llamada = (nombre: string, argumentos: Record<string, unknown> = {}, id = nombre) => ({ id, nombre, argumentos })

describe('agente JasWave', () => {
  it('una escritura idéntica repetida no se ejecuta dos veces (evita clips duplicados)', async () => {
    const ejecutadas: string[] = []
    const { chat } = guion([
      { ok: true, texto: '', llamadas: [llamada('track.create', { nombre: 'Bajo' }, 'a'), llamada('track.create', { nombre: 'Bajo' }, 'b')] },
      { ok: true, texto: 'Listo.', llamadas: [] },
    ])
    const r = await ejecutarAgente({
      pedido: 'crea un bajo',
      catalogo: CATALOGO,
      sistema: 'sys',
      chat,
      ejecutar: async (l) => {
        ejecutadas.push(l.nombre)
        return { ok: true }
      },
    })
    expect(r.estado).toBe('completado')
    expect(ejecutadas).toEqual(['track.create'])
  })

  it('insistir con una herramienta que falla: aviso al 3.º fallo y corte del turno al 5.º, con el motivo', async () => {
    let intentos = 0
    // El modelo «terco»: repite la misma herramienta con argumentos distintos cada vez (no es la guardia de duplicados).
    const { chat, vistos } = guion(
      Array.from({ length: 8 }, (_, i) => ({ ok: true, texto: '', llamadas: [llamada('midi.quantize', { clipId: `c${i}`, pistaId: 'p' }, `q${i}`)] })),
    )
    const r = await ejecutarAgente({
      pedido: 'cuantiza',
      catalogo: CATALOGO,
      sistema: 'sys',
      chat,
      maxPasos: 12,
      ejecutar: async () => {
        intentos++
        return { ok: false, error: 'Clip no encontrado' }
      },
    })
    expect(intentos).toBe(5)
    expect(r.estado).toBe('limite')
    expect(r.error).toMatch(/«midi\.quantize» falló 5 veces seguidas \(último error: Clip no encontrado\)/)
    expect(r.texto).toMatch(/No pude terminar/)
    // En el 3.º y 4.º fallo el resultado de la herramienta lleva el aviso de cambiar de enfoque.
    const respuestas = vistos.flatMap((v) => v.mensajes.filter((m) => m.role === 'tool').map((m) => m.content))
    const conAviso = [...new Set(respuestas)].filter((c) => /fallos seguidos con midi\.quantize/.test(c))
    expect(conAviso.length).toBe(2)
    expect(respuestas.filter((c) => /Llevas 1 fallos|Llevas 2 fallos/.test(c))).toEqual([])
  })

  it('un acierto reinicia la cuenta de fallos seguidos', async () => {
    let n = 0
    const { chat } = guion([
      ...Array.from({ length: 4 }, (_, i) => ({ ok: true, texto: '', llamadas: [llamada('midi.quantize', { clipId: `c${i}` }, `q${i}`)] })),
      { ok: true, texto: '', llamadas: [llamada('midi.quantize', { clipId: 'bueno' }, 'ok')] },
      ...Array.from({ length: 4 }, (_, i) => ({ ok: true, texto: '', llamadas: [llamada('midi.quantize', { clipId: `d${i}` }, `r${i}`)] })),
      { ok: true, texto: 'Listo.', llamadas: [] },
    ])
    const r = await ejecutarAgente({
      pedido: 'cuantiza',
      catalogo: CATALOGO,
      sistema: 'sys',
      chat,
      maxPasos: 12,
      ejecutar: async (l) => (l.argumentos.clipId === 'bueno' ? { ok: true } : { ok: false, error: `falló ${++n}` }),
    })
    expect(r.estado).toBe('completado')
    expect(n).toBe(8)
  })

  it('una escritura que falló se puede repetir tras corregir la causa', async () => {
    let intentos = 0
    const { chat } = guion([
      { ok: true, texto: '', llamadas: [llamada('midi.quantize', { clipId: 'c', pistaId: 'p' }, 'a')] },
      { ok: true, texto: '', llamadas: [llamada('midi.quantize', { pistaId: 'p', clipId: 'c' }, 'b')] },
      { ok: true, texto: '', llamadas: [llamada('midi.quantize', { clipId: 'c', pistaId: 'p' }, 'c')] },
    ])
    await ejecutarAgente({
      pedido: 'cuantiza',
      catalogo: CATALOGO,
      sistema: 'sys',
      chat,
      ejecutar: async () => (++intentos === 1 ? { ok: false, error: 'Pista no encontrada' } : { ok: true }),
    })
    // 1.º falla, 2.º (mismas claves en otro orden) se ejecuta, 3.º ya es un duplicado de algo hecho.
    expect(intentos).toBe(2)
  })

  it('argumentos cortados (__raw) no se ejecutan y el modelo sabe por qué', async () => {
    const ejecutadas: string[] = []
    const { chat, vistos } = guion([{ ok: true, texto: '', llamadas: [llamada('track.create', { __raw: '{"nombre":"Ba' })] }])
    await ejecutarAgente({ pedido: 'x', catalogo: CATALOGO, sistema: 'sys', chat, ejecutar: async (l) => (ejecutadas.push(l.nombre), { ok: true }) })
    expect(ejecutadas).toEqual([])
    expect(vistos[1]!.mensajes.find((m) => m.role === 'tool')?.content).toMatch(/llegaron cortados/)
  })

  it('tras un cambio pendiente de confirmación no se ejecutan más escrituras del paso', async () => {
    const ejecutadas: string[] = []
    const { chat } = guion([{ ok: true, texto: '', llamadas: [llamada('track.delete', { trackId: 'a' }), llamada('track.create', { nombre: 'Nueva' })] }])
    const r = await ejecutarAgente({
      pedido: 'x',
      catalogo: CATALOGO,
      sistema: 'sys',
      chat,
      ejecutar: async (l) => (ejecutadas.push(l.nombre), l.nombre === 'track.delete' ? { ok: false, pendienteConfirmacion: true } : { ok: true }),
    })
    expect(r.estado).toBe('confirmar')
    expect(ejecutadas).toEqual(['track.delete'])
  })

  it('el resultado de una escritura pone los ids delante y resume listas largas', async () => {
    const notas = Array.from({ length: 80 }, (_, i) => ({ pitch: 60, inicio: i, duracion: 1, velocidad: 90 }))
    const { chat, vistos } = guion([{ ok: true, texto: '', llamadas: [llamada('track.create', { nombre: 'P' })] }])
    await ejecutarAgente({ pedido: 'x', catalogo: CATALOGO, sistema: 'sys', chat, ejecutar: async () => ({ ok: true, datos: { notas, pistaId: 'p1', clipId: 'c9' } }) })
    const txt = vistos[1]!.mensajes.find((m) => m.role === 'tool')!.content
    expect(txt).toMatch(/"clipId":"c9"/)
    expect(txt).toMatch(/"total":80/)
    expect(txt).not.toMatch(/recortado/)
  })

  it('consulta, ejecuta en caliente y responde', async () => {
    const ejecutadas: string[] = []
    const { chat, vistos } = guion([
      { ok: true, texto: '', llamadas: [llamada('tareas', { tareas: [{ titulo: 'Leer', estado: 'en_curso' }] }), llamada('project.getSummary')] },
      { ok: true, texto: '', llamadas: [llamada('project.setBpm', { bpm: 92 })] },
      { ok: true, texto: 'Listo: tempo a 92.', llamadas: [] },
    ])
    const eventos: EventoAgente[] = []
    const r = await ejecutarAgente({
      pedido: 'pon el tempo a 92',
      catalogo: CATALOGO,
      sistema: 'sys',
      chat,
      ejecutar: async (l) => {
        ejecutadas.push(l.nombre)
        return { ok: true, datos: { hecho: l.nombre } }
      },
      onEvento: (e) => eventos.push(e),
    })
    expect(r.estado).toBe('completado')
    expect(r.texto).toBe('Listo: tempo a 92.')
    expect(ejecutadas).toEqual(['project.getSummary', 'project.setBpm'])
    expect(r.tareas).toEqual([{ titulo: 'Leer', estado: 'en_curso' }])
    // El segundo paso recibe los resultados de herramientas como mensajes `tool`.
    expect(vistos[1]!.mensajes.filter((m) => m.role === 'tool')).toHaveLength(2)
    // La UI recibe títulos legibles, no identificadores técnicos.
    const titulos = eventos.flatMap((e) => (e.tipo === 'herramienta' ? [e.titulo] : []))
    expect(titulos).toContain('Cambiando el tempo')
    expect(titulos.join(' ')).not.toMatch(/\./)
  })

  it('selecciona pocas herramientas y amplía con buscar_herramientas', async () => {
    const { chat, vistos } = guion([
      { ok: true, texto: '', llamadas: [llamada('buscar_herramientas', { consulta: 'cuantizar notas' })] },
      { ok: true, texto: 'ok', llamadas: [] },
    ])
    await ejecutarAgente({ pedido: 'hola', catalogo: CATALOGO, iniciales: ['project.getSummary'], sistema: 's', chat, ejecutar: async () => ({ ok: true }) })
    const nombres = (i: number) => vistos[i]!.herramientas.map((h) => h.name)
    expect(nombres(0)).not.toContain('midi.quantize')
    expect(nombres(1)).toContain('midi.quantize')
  })

  it('en modo solo lectura oculta y rechaza escrituras', async () => {
    const ejecutadas: string[] = []
    const { chat, vistos } = guion([{ ok: true, texto: '', llamadas: [llamada('project.setBpm', { bpm: 100 })] }, { ok: true, texto: 'plan', llamadas: [] }])
    const r = await ejecutarAgente({
      pedido: 'tempo',
      catalogo: CATALOGO,
      sistema: 's',
      chat,
      soloLectura: true,
      ejecutar: async (l) => {
        ejecutadas.push(l.nombre)
        return { ok: true }
      },
    })
    expect(vistos[0]!.herramientas.map((h) => h.name)).not.toContain('project.setBpm')
    expect(ejecutadas).toEqual([])
    expect(r.llamadas[0]!.ok).toBe(false)
  })

  it('delega en subagentes en paralelo y serializa sus escrituras', async () => {
    let activos = 0
    let maxActivos = 0
    const chat: ChatAgente = async (o) => {
      const ultimo = o.mensajes[o.mensajes.length - 1]!
      if (o.profundidad === 0) {
        if (ultimo.role === 'user')
          return { ok: true, texto: '', llamadas: [llamada('delegar', { encargos: [{ tarea: 'crea pista batería' }, { tarea: 'crea pista bajo', perfil: 'bajista' }] })] }
        return { ok: true, texto: 'Arreglo listo.', llamadas: [] }
      }
      if (ultimo.role === 'user') return { ok: true, texto: '', llamadas: [llamada('track.create', { nombre: ultimo.content })] }
      return { ok: true, texto: 'pista creada', llamadas: [] }
    }
    const subEventos: string[] = []
    const r = await ejecutarAgente({
      pedido: 'arma batería y bajo',
      catalogo: CATALOGO,
      sistema: 's',
      chat,
      subagentes: [{ id: 'bajista', nombre: 'Bajista', descripcion: 'líneas de bajo', instrucciones: 'groove' }],
      onEvento: (e) => e.tipo === 'subagente' && subEventos.push(`${e.nombre}:${e.fase}`),
      ejecutar: async () => {
        activos++
        maxActivos = Math.max(maxActivos, activos)
        await new Promise((res) => setTimeout(res, 5))
        activos--
        return { ok: true }
      },
    })
    expect(r.estado).toBe('completado')
    expect(r.llamadas.filter((c) => c.nombre === 'track.create')).toHaveLength(2)
    expect(maxActivos).toBe(1)
    expect(subEventos).toContain('Bajista:inicio')
    expect(subEventos).toContain('Bajista:fin')
  })

  it('se detiene para preguntar o confirmar', async () => {
    const q = guion([{ ok: true, texto: '', llamadas: [llamada('preguntar', { pregunta: '¿En qué tonalidad?', opciones: ['Do', 'Sol'] })] }])
    const r1 = await ejecutarAgente({ pedido: 'x', catalogo: CATALOGO, sistema: 's', chat: q.chat, ejecutar: async () => ({ ok: true }) })
    expect(r1.estado).toBe('pregunta')
    expect(r1.pregunta).toEqual({ texto: '¿En qué tonalidad?', opciones: ['Do', 'Sol'] })

    const c = guion([{ ok: true, texto: '', llamadas: [llamada('track.delete', { id: 't1' })] }])
    const r2 = await ejecutarAgente({ pedido: 'borra', catalogo: CATALOGO, sistema: 's', chat: c.chat, ejecutar: async () => ({ ok: true, pendienteConfirmacion: true }) })
    expect(r2.estado).toBe('confirmar')
  })

  it('corta repeticiones, herramientas inexistentes y el límite de pasos', async () => {
    const siempre: ChatAgente = async () => ({ ok: true, texto: '', llamadas: [llamada('track.list')] })
    let n = 0
    const r = await ejecutarAgente({
      pedido: 'x',
      catalogo: CATALOGO,
      sistema: 's',
      chat: siempre,
      maxPasos: 4,
      ejecutar: async () => {
        n++
        return { ok: true }
      },
    })
    expect(r.estado).toBe('limite')
    expect(n).toBe(2)

    const inventa = guion([{ ok: true, texto: '', llamadas: [llamada('tempo.set')] }, { ok: true, texto: 'ok', llamadas: [] }])
    const r2 = await ejecutarAgente({ pedido: 'tempo', catalogo: CATALOGO, sistema: 's', chat: inventa.chat, ejecutar: async () => ({ ok: true }) })
    expect(r2.llamadas[0]).toMatchObject({ ok: false, nombre: 'tempo.set' })
    expect(JSON.parse(inventa.vistos[1]!.mensajes[inventa.vistos[1]!.mensajes.length - 1]!.content).parecidas).toContain('project.setBpm')
  })

  it('informa fallo del modelo y cancelación', async () => {
    const r = await ejecutarAgente({ pedido: 'x', catalogo: CATALOGO, sistema: 's', chat: async () => ({ ok: false, texto: '', llamadas: [], error: 'caído' }), ejecutar: async () => ({ ok: true }) })
    expect(r).toMatchObject({ estado: 'fallo', error: 'caído' })
    const ac = new AbortController()
    ac.abort()
    const r2 = await ejecutarAgente({ pedido: 'x', catalogo: CATALOGO, sistema: 's', chat: async () => ({ ok: true, texto: '', llamadas: [] }), ejecutar: async () => ({ ok: true }), signal: ac.signal })
    expect(r2.estado).toBe('cancelado')
  })
})

describe('selección y textos', () => {
  it('encuentra herramientas con palabras en español', () => {
    expect(buscarHerramientas('cambia el tempo', CATALOGO)[0]!.nombre).toBe('project.setBpm')
    expect(buscarHerramientas('crear una pista', CATALOGO)[0]!.nombre).toBe('track.create')
  })

  it('el sistema lista especialistas y respeta el modo', () => {
    const s = sistemaAgente({ modo: 'plan', subagentes: [{ id: 'bajista', nombre: 'Bajista', descripcion: 'bajo', instrucciones: '' }] })
    expect(s).toContain('bajista: Bajista')
    expect(s).toContain('Modo plan')
  })

  it('limpia el texto para usuarios normales', () => {
    const sucio = 'Hecho <<<DECISION>>> usé `project.setBpm` en la pista 3f2a9c1e-1111-2222-3333-444455556666.\n```json\n{"bpm":92}\n```\n{"ok":true}\nAhora suena a 92 BPM.'
    const limpio = limpiarTextoUsuario(sucio, { nombresHerramientas: ['project.setBpm'] })
    expect(limpio).not.toMatch(/<<<|`|\{|project\.setBpm|3f2a9c1e/)
    expect(limpio).toContain('Ahora suena a 92 BPM.')
  })
})

describe('indicaciones del usuario en mitad del trabajo', () => {
  it('una nota nueva entra como mensaje del usuario antes del siguiente paso', async () => {
    const cola: string[][] = [[], ['Baja el bajo, me tapa la voz']]
    const { chat, vistos } = guion([
      { ok: true, texto: '', llamadas: [llamada('project.getSummary')] },
      { ok: true, texto: 'Listo.', llamadas: [] },
    ])
    const r = await ejecutarAgente({ pedido: 'mezcla', catalogo: CATALOGO, sistema: 'sys', chat, ejecutar: async () => ({ ok: true }), notas: () => cola.shift() ?? [] })
    expect(r.estado).toBe('completado')
    // Paso 1: todavía sin notas. Paso 2: la nota va tras el resultado de la herramienta, como mensaje del usuario.
    expect(vistos[0]!.mensajes.some((m) => String(m.content).includes('me tapa la voz'))).toBe(false)
    const ultimo = vistos[1]!.mensajes[vistos[1]!.mensajes.length - 1]!
    expect(ultimo.role).toBe('user')
    expect(String(ultimo.content)).toMatch(/Indicaciones del usuario mientras trabajas[\s\S]*- Baja el bajo, me tapa la voz/)
  })

  it('una nota que llega antes del primer paso se une al pedido (nunca dos mensajes del usuario seguidos)', async () => {
    const { chat, vistos } = guion([{ ok: true, texto: 'ok', llamadas: [] }])
    await ejecutarAgente({ pedido: 'graba', catalogo: CATALOGO, sistema: 'sys', chat, ejecutar: async () => ({ ok: true }), notas: () => ['más lento'] })
    const usuarios = vistos[0]!.mensajes.filter((m) => m.role === 'user')
    expect(usuarios).toHaveLength(1)
    expect(String(usuarios[0]!.content)).toMatch(/^graba[\s\S]*- más lento/)
  })
  it('una herramienta colgada no retiene al agente: al cortarse por señal el turno termina', async () => {
    const ctl = new AbortController()
    const { chat } = guion([{ ok: true, texto: '', llamadas: [llamada('project.getSummary')] }, { ok: true, texto: 'fin', llamadas: [] }])
    setTimeout(() => ctl.abort(), 30)
    const r = await Promise.race([
      ejecutarAgente({ pedido: 'mide', catalogo: CATALOGO, sistema: 'sys', chat, ejecutar: () => new Promise(() => undefined), signal: ctl.signal }),
      new Promise<'colgado'>((res) => setTimeout(() => res('colgado'), 2000)),
    ])
    expect(r).not.toBe('colgado')
  })
  it('en el último paso permitido el modelo recibe el aviso de cierre y sus llamadas siguen ejecutándose', async () => {
    const ejecutadas: string[] = []
    const { chat, vistos } = guion([
      { ok: true, texto: '', llamadas: [llamada('project.getSummary', {}, 'a')] },
      { ok: true, texto: 'Hice A; falta B.', llamadas: [llamada('track.create', { nombre: 'X' }, 'b')] },
    ])
    const r = await ejecutarAgente({ pedido: 'trabaja', catalogo: CATALOGO, sistema: 'sys', chat, maxPasos: 2, ejecutar: async (l) => { ejecutadas.push(l.nombre); return { ok: true } } })
    expect(String(vistos[0]!.mensajes[vistos[0]!.mensajes.length - 1]!.content)).not.toMatch(/ÚLTIMO paso/)
    expect(String(vistos[1]!.mensajes[vistos[1]!.mensajes.length - 1]!.content)).toMatch(/ÚLTIMO paso/)
    expect(ejecutadas).toEqual(['project.getSummary', 'track.create'])
    expect(r.estado).toBe('limite')
    expect(r.texto).toMatch(/falta B/)
  })
})
