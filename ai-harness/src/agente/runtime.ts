import { ejecutarLeerHabilidad, H_LEER_HABILIDAD, herramientaLeerHabilidad } from './habilidades'
import { sistemaSubagente } from './prompts'
import { buscarHerramientas, seleccionarIniciales } from './seleccion'
import type {
  ClaseHerramienta,
  ChatAgente,
  EsquemaHerramienta,
  EstadoTarea,
  EventoAgente,
  HerramientaAgente,
  LlamadaAgente,
  MensajeAgente,
  PerfilSubagente,
  RegistroLlamada,
  ResultadoAgente,
  ResultadoHerramienta,
  Tarea,
} from './tipos'

/**
 * Bucle del agente de JasWave, al estilo de los agentes de código: el modelo decide en cada paso qué
 * consultar o ejecutar; las herramientas corren en caliente y su resultado vuelve al hilo; puede
 * planificar (`tareas`), ampliar su caja de herramientas (`buscar_herramientas`), repartir trabajo en
 * subagentes paralelos (`delegar`) y pedir un dato al usuario (`preguntar`).
 */

export type EjecutorHerramienta = (
  llamada: LlamadaAgente,
  herramienta: HerramientaAgente,
  ctx: { agente: string; profundidad: number },
) => Promise<ResultadoHerramienta>

export type ConfigAgente = {
  pedido: string
  historial?: MensajeAgente[]
  /** Catálogo completo; el agente ve un subconjunto y amplía con `buscar_herramientas`. */
  catalogo: HerramientaAgente[]
  /** Herramientas visibles desde el primer paso (si falta, se eligen por relevancia). */
  iniciales?: string[]
  /** Herramientas que siempre se incluyen en la selección automática (consultas básicas). */
  base?: string[]
  sistema: string
  chat: ChatAgente
  ejecutar: EjecutorHerramienta
  soloLectura?: boolean
  subagentes?: PerfilSubagente[]
  /** Contexto breve del proyecto para los subagentes. */
  contextoSubagentes?: string
  maxPasos?: number
  maxSubagentes?: number
  onEvento?: (e: EventoAgente) => void
  signal?: AbortSignal
  /**
   * Indicaciones del usuario que llegan mientras el agente trabaja (él ve y oye el DAW; el agente no). Se
   * consultan antes de cada paso y las nuevas entran en la conversación como mensaje del usuario.
   */
  notas?: () => string[]
  /** Uso interno (subagentes). */
  profundidad?: number
  nombreAgente?: string
  /** Uso interno: candado compartido para serializar escrituras de subagentes paralelos. */
  candado?: Candado
}

export const META = {
  tareas: 'tareas',
  buscar: 'buscar_herramientas',
  delegar: 'delegar',
  preguntar: 'preguntar',
} as const

const MAX_RESULTADO = 1800
const MAX_REPETICIONES = 2
/** Fallos seguidos de una misma herramienta: al 3.º se le pide cambiar de enfoque; al 5.º se corta el turno. */
const AVISO_FALLOS_SEGUIDOS = 3
const MAX_FALLOS_SEGUIDOS = 5
/** Escrituras por paso: un modelo que emite 50 `track.create` de golpe no las ejecuta todas. */
const MAX_ESCRITURAS_POR_PASO = 24
/** Listas más largas se resumen en el resultado de una escritura (el modelo necesita los ids, no las notas). */
const MAX_LISTA_ESCRITURA = 6

export class Candado {
  private cola: Promise<void> = Promise.resolve()
  async con<T>(fn: () => Promise<T>): Promise<T> {
    const previo = this.cola
    let liberar!: () => void
    this.cola = new Promise<void>((r) => (liberar = r))
    await previo
    try {
      return await fn()
    } finally {
      liberar()
    }
  }
}

function esquemasMeta(o: { delegar: boolean; preguntar: boolean; perfiles: PerfilSubagente[] }): EsquemaHerramienta[] {
  const out: EsquemaHerramienta[] = [
    {
      name: META.tareas,
      description: 'Crea o actualiza tu lista de tareas visible para el usuario. Envía la lista completa cada vez.',
      parameters: {
        type: 'object',
        properties: {
          tareas: {
            type: 'array',
            items: {
              type: 'object',
              properties: { titulo: { type: 'string' }, estado: { type: 'string', enum: ['pendiente', 'en_curso', 'hecha'] } },
              required: ['titulo', 'estado'],
            },
          },
        },
        required: ['tareas'],
      },
    },
    {
      name: META.buscar,
      description: 'Busca herramientas del DAW por palabras clave (p. ej. "cuantizar notas", "añadir reverb", "exportar"). Las encontradas quedan disponibles.',
      parameters: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] },
    },
  ]
  if (o.delegar) {
    const perfil: Record<string, unknown> = { type: 'string', description: 'Id del especialista (opcional).' }
    if (o.perfiles.length) perfil.enum = o.perfiles.map((p) => p.id)
    out.push({
      name: META.delegar,
      description: 'Reparte partes independientes del trabajo entre subagentes que trabajan en paralelo. Cada encargo debe ser autosuficiente (pista, compases, estilo, ids).',
      parameters: {
        type: 'object',
        properties: {
          encargos: {
            type: 'array',
            items: { type: 'object', properties: { tarea: { type: 'string' }, perfil: perfil }, required: ['tarea'] },
          },
        },
        required: ['encargos'],
      },
    })
  }
  if (o.preguntar) {
    out.push({
      name: META.preguntar,
      description: 'Pregunta al usuario un dato imprescindible que no puedes decidir tú. Termina tu turno.',
      parameters: {
        type: 'object',
        properties: { pregunta: { type: 'string' }, opciones: { type: 'array', items: { type: 'string' } } },
        required: ['pregunta'],
      },
    })
  }
  return out
}

/** Etiqueta legible para la UI: nunca expone el identificador técnico de la herramienta. */
export function tituloHerramienta(h: HerramientaAgente): string {
  if (h.titulo?.trim()) return h.titulo.trim()
  if (h.clase === 'lectura') return 'Revisando el proyecto'
  if (h.clase === 'destructiva') return 'Preparando un cambio importante'
  return 'Editando el proyecto'
}

const ES_ID = /(^id$|Id$|_id$|^ids?$|Ids$|^nombre$|^name$)/

/**
 * Datos de una escritura con los ids primero y las listas largas resumidas: así el recorte nunca se
 * come el `clipId` que va detrás de cien notas.
 */
export function resumirDatosEscritura(d: unknown, nivel = 0): unknown {
  if (Array.isArray(d)) {
    if (d.length <= MAX_LISTA_ESCRITURA) return d.map((x) => resumirDatosEscritura(x, nivel + 1))
    return { total: d.length, primeros: d.slice(0, 2).map((x) => resumirDatosEscritura(x, nivel + 1)) }
  }
  if (!d || typeof d !== 'object' || nivel > 4) return d
  const o = d as Record<string, unknown>
  const claves = Object.keys(o)
  const orden = [...claves.filter((k) => ES_ID.test(k)), ...claves.filter((k) => !ES_ID.test(k))]
  return Object.fromEntries(orden.map((k) => [k, resumirDatosEscritura(o[k], nivel + 1)]))
}

/** Listas más largas se resumen en el historial de llamadas del propio agente. */
const MAX_LISTA_HISTORIAL = 8

/** Argumentos de una llamada tal y como quedan en el historial: las listas largas, resumidas. */
export function compactarArgumentosHistorial(v: unknown, nivel = 0): unknown {
  if (Array.isArray(v)) {
    if (v.length > MAX_LISTA_HISTORIAL) return `[${v.length} elementos]`
    return v.map((x) => compactarArgumentosHistorial(x, nivel + 1))
  }
  if (!v || typeof v !== 'object' || nivel > 4) return v
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, compactarArgumentosHistorial(x, nivel + 1)]))
}

/** Serializa un resultado para el modelo, recortando lo que sobra. */
export function compactarResultado(r: ResultadoHerramienta, max = MAX_RESULTADO, clase?: ClaseHerramienta | 'meta'): string {
  const cuerpo: Record<string, unknown> = { ok: r.ok }
  if (r.error) cuerpo.error = r.error
  if (r.pendienteConfirmacion) cuerpo.pendiente = 'Requiere confirmación del usuario; no se ha ejecutado todavía.'
  if (r.datos !== undefined) cuerpo.datos = clase === 'escritura' || clase === 'destructiva' ? resumirDatosEscritura(r.datos) : r.datos
  else if (r.resumen) cuerpo.resumen = r.resumen
  let s: string
  try {
    s = JSON.stringify(cuerpo)
  } catch {
    s = JSON.stringify({ ok: r.ok, resumen: r.resumen ?? String(r.datos) })
  }
  return s.length > max ? `${s.slice(0, max)}…(recortado)` : s
}

function normalizarTareas(v: unknown): Tarea[] {
  if (!Array.isArray(v)) return []
  const estados: EstadoTarea[] = ['pendiente', 'en_curso', 'hecha']
  return v
    .map((t) => {
      if (typeof t === 'string') return { titulo: t, estado: 'pendiente' as EstadoTarea }
      const o = (t ?? {}) as Record<string, unknown>
      const titulo = String(o.titulo ?? o.title ?? '').trim()
      const e = String(o.estado ?? o.status ?? 'pendiente')
      const estado = (estados as string[]).includes(e) ? (e as EstadoTarea) : e === 'done' || e === 'completada' ? 'hecha' : 'pendiente'
      return { titulo, estado }
    })
    .filter((t) => t.titulo)
    .slice(0, 12)
}

/** JSON con las claves ordenadas: los mismos argumentos en otro orden son la misma llamada. */
function estable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estable)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(
    Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => [k, estable((v as Record<string, unknown>)[k])]),
  )
}

function firma(l: LlamadaAgente): string {
  let a = ''
  try {
    a = JSON.stringify(estable(l.argumentos))
  } catch {
    /* argumentos no serializables */
  }
  return `${l.nombre}|${a}`
}

/** Texto con el que las indicaciones del usuario llegan al agente en mitad de su trabajo. */
export function textoNotasUsuario(notas: string[]): string {
  return [
    'Indicaciones del usuario mientras trabajas (él ve y oye el DAW, tú no). Tenlas en cuenta desde ahora: mandan sobre el plan y sobre tu encargo. Si una indicación no es de tu oficio, díselo en tu informe final.',
    ...notas.map((n) => `- ${n}`),
  ].join('\n')
}

function leerNotas(fuente: ConfigAgente['notas']): string[] {
  if (!fuente) return []
  try {
    return (fuente() ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** Añade las notas como mensaje del usuario (o al último mensaje del usuario, si es el que va a enviarse). */
function incorporarNotas(mensajes: MensajeAgente[], notas: string[]): void {
  const texto = textoNotasUsuario(notas)
  const ultimo = mensajes[mensajes.length - 1]
  if (ultimo?.role === 'user') mensajes[mensajes.length - 1] = { role: 'user', content: `${ultimo.content}\n\n${texto}` }
  else mensajes.push({ role: 'user', content: texto })
}

export async function ejecutarAgente(cfg: ConfigAgente): Promise<ResultadoAgente> {
  const profundidad = cfg.profundidad ?? 0
  const agente = cfg.nombreAgente ?? 'jas'
  const maxPasos = cfg.maxPasos ?? (profundidad === 0 ? 12 : 6)
  const candado = cfg.candado ?? new Candado()
  const emitir = (e: EventoAgente) => {
    try {
      cfg.onEvento?.(e)
    } catch {
      /* la UI no debe romper el bucle */
    }
  }
  const porNombre = new Map(cfg.catalogo.map((h) => [h.nombre, h]))
  const permitida = (h: HerramientaAgente) => !cfg.soloLectura || h.clase === 'lectura'
  const visibles = new Set(
    (cfg.iniciales ?? seleccionarIniciales(cfg.pedido, cfg.catalogo, { base: cfg.base })).filter((n) => {
      const h = porNombre.get(n)
      return h && permitida(h)
    }),
  )
  const puedeDelegar = profundidad === 0 && (cfg.maxSubagentes ?? 4) > 0
  const puedePreguntar = profundidad === 0
  const meta = esquemasMeta({ delegar: puedeDelegar, preguntar: puedePreguntar, perfiles: cfg.subagentes ?? [] })

  const mensajes: MensajeAgente[] = [...(cfg.historial ?? []), { role: 'user', content: cfg.pedido }]
  const llamadas: RegistroLlamada[] = []
  let tareas: Tarea[] = []
  let texto = ''
  const repeticiones = new Map<string, number>()
  /** Fallos seguidos por herramienta (se reinicia cuando algo sale bien): corta los bucles de insistir en lo mismo. */
  const fallosSeguidos = new Map<string, number>()

  const fin = (estado: ResultadoAgente['estado'], extra: Partial<ResultadoAgente> = {}, pasos = 0): ResultadoAgente => ({
    estado,
    texto: texto.trim(),
    tareas,
    llamadas,
    pasos,
    ...extra,
  })

  for (let paso = 1; paso <= maxPasos; paso++) {
    if (cfg.signal?.aborted) return fin('cancelado', {}, paso - 1)
    emitir({ tipo: 'paso', agente, paso })
    // Lo que el usuario escribió mientras el agente trabajaba entra antes de pedirle el siguiente paso.
    const nuevas = leerNotas(cfg.notas)
    if (nuevas.length) incorporarNotas(mensajes, nuevas)
    const herramientas: EsquemaHerramienta[] = [
      ...meta,
      ...[...visibles].map((n) => porNombre.get(n)!).map((h) => ({ name: h.nombre, description: h.descripcion, parameters: h.parametros })),
    ]
    let r
    try {
      r = await cfg.chat({
        sistema: cfg.sistema,
        mensajes,
        herramientas,
        profundidad,
        onDelta: (d) => emitir({ tipo: 'texto', delta: d, agente }),
      })
    } catch (e) {
      r = { ok: false, texto: '', llamadas: [], error: e instanceof Error ? e.message : String(e) }
    }
    if (cfg.signal?.aborted) return fin('cancelado', {}, paso)
    if (!r.ok) return fin('fallo', { error: r.error ?? 'el modelo no respondió' }, paso)
    if (r.texto.trim()) texto = r.texto
    if (!r.llamadas.length) return fin('completado', {}, paso)

    // En el historial, las listas largas de los argumentos (cien notas de un clip) se resumen: el modelo ya
    // las escribió y puede releerlas con una herramienta; arrastrarlas en cada llamada agotaba el presupuesto.
    mensajes.push({
      role: 'assistant',
      content: r.texto,
      toolCalls: r.llamadas.map((l) => ({ id: l.id, name: l.nombre, arguments: compactarArgumentosHistorial(l.argumentos) as Record<string, unknown> })),
    })

    let detener: { estado: 'pregunta' | 'confirmar'; pregunta?: ResultadoAgente['pregunta'] } | null = null
    const responder = (l: LlamadaAgente, contenido: string) =>
      mensajes.push({ role: 'tool', content: contenido, toolCallId: l.id, name: l.nombre })

    let escrituras = 0
    // Las delegaciones de un mismo paso se lanzan juntas; el resto, en orden.
    for (const l of r.llamadas) {
      if (cfg.signal?.aborted) return fin('cancelado', {}, paso)
      const f = firma(l)
      const n = repeticiones.get(f) ?? 0
      // Una escritura idéntica que YA salió bien duplicaría el cambio (dos clips iguales): solo una vez.
      // Las que fallaron no cuentan: repetirla tras corregir la causa (crear la pista que faltaba) es legítimo.
      const clase = porNombre.get(l.nombre)?.clase
      const escribe = clase === 'escritura' || clase === 'destructiva'
      const limite = escribe ? 1 : MAX_REPETICIONES
      if (n >= limite && l.nombre !== META.tareas) {
        responder(
          l,
          JSON.stringify({
            ok: false,
            error: limite === 1 ? 'Ya hiciste este mismo cambio en este turno y salió bien; no lo repitas.' : 'Ya ejecutaste esta misma llamada. Usa el resultado anterior o cambia de enfoque.',
          }),
        )
        continue
      }
      if (!escribe) repeticiones.set(f, n + 1)
      // Argumentos que no llegaron como JSON válido (respuesta cortada): no se ejecuta nada a medias.
      if (l.argumentos && typeof l.argumentos === 'object' && '__raw' in l.argumentos) {
        llamadas.push({ agente, nombre: l.nombre, argumentos: {}, ok: false, error: 'argumentos cortados', clase })
        responder(
          l,
          JSON.stringify({
            ok: false,
            error:
              'Tus argumentos llegaron cortados (JSON incompleto), así que no se ejecutó nada. Divide el trabajo en llamadas más pequeñas: por ejemplo, crea el clip con pocas notas y añade el resto con midi.createNotes en tandas de hasta 64 notas.',
          }),
        )
        continue
      }
      if (escribe && detener?.estado === 'confirmar') {
        responder(l, JSON.stringify({ ok: false, error: 'No se ejecutó: hay un cambio anterior de este paso esperando la confirmación del usuario.' }))
        continue
      }
      if (escribe && ++escrituras > MAX_ESCRITURAS_POR_PASO) {
        responder(l, JSON.stringify({ ok: false, error: `Demasiados cambios en un solo paso (máximo ${MAX_ESCRITURAS_POR_PASO}). Revisa el resultado de los anteriores y sigue en el siguiente paso.` }))
        continue
      }

      if (l.nombre === META.tareas) {
        tareas = normalizarTareas(l.argumentos.tareas)
        emitir({ tipo: 'tareas', tareas })
        llamadas.push({ agente, nombre: l.nombre, argumentos: l.argumentos, ok: true, clase: 'meta' })
        responder(l, JSON.stringify({ ok: true }))
        continue
      }

      if (l.nombre === META.buscar) {
        const consulta = String(l.argumentos.consulta ?? l.argumentos.query ?? '')
        const halladas = buscarHerramientas(consulta, cfg.catalogo, 8).filter(permitida)
        for (const h of halladas) visibles.add(h.nombre)
        llamadas.push({ agente, nombre: l.nombre, argumentos: l.argumentos, ok: true, clase: 'meta', resumen: `${halladas.length} herramientas` })
        responder(
          l,
          JSON.stringify({
            ok: true,
            herramientas: halladas.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion.slice(0, 160) })),
            nota: halladas.length ? 'Ya están disponibles: llámalas directamente.' : 'Nada encontrado; prueba otras palabras.',
          }),
        )
        continue
      }

      if (l.nombre === META.preguntar && puedePreguntar) {
        const pregunta = String(l.argumentos.pregunta ?? '').trim()
        const opciones = Array.isArray(l.argumentos.opciones) ? l.argumentos.opciones.map(String).slice(0, 6) : []
        llamadas.push({ agente, nombre: l.nombre, argumentos: l.argumentos, ok: true, clase: 'meta' })
        responder(l, JSON.stringify({ ok: true }))
        if (pregunta) {
          texto = pregunta
          detener = { estado: 'pregunta', pregunta: { texto: pregunta, opciones } }
        }
        continue
      }

      if (l.nombre === META.delegar && puedeDelegar) {
        const encargos = (Array.isArray(l.argumentos.encargos) ? l.argumentos.encargos : [])
          .map((e) => (typeof e === 'string' ? { tarea: e } : ((e ?? {}) as { tarea?: unknown; perfil?: unknown })))
          .filter((e) => typeof e.tarea === 'string' && e.tarea.trim())
          .slice(0, cfg.maxSubagentes ?? 4)
        const informes = await Promise.all(
          encargos.map(async (e, i) => {
            const perfil = (cfg.subagentes ?? []).find((p) => p.id === e.perfil)
            const id = `${agente}.${paso}.${i + 1}`
            const tarea = String(e.tarea)
            emitir({ tipo: 'subagente', id, nombre: perfil?.nombre ?? `Subagente ${i + 1}`, fase: 'inicio', tarea })
            const permitidas = perfil?.herramientas?.length ? perfil.herramientas : undefined
            // Sus habilidades (conocimiento de oficio) se leen bajo demanda con `leer_habilidad`.
            const habilidades = perfil?.habilidades ?? []
            const extrasHab = habilidades.length ? [herramientaLeerHabilidad(habilidades)] : []
            const sub = await ejecutarAgente({
              pedido: tarea,
              catalogo: [...extrasHab, ...(permitidas ? cfg.catalogo.filter((h) => permitidas.includes(h.nombre)) : cfg.catalogo)],
              iniciales: permitidas ? [...extrasHab.map((h) => h.nombre), ...permitidas] : undefined,
              base: [...(cfg.base ?? []), ...extrasHab.map((h) => h.nombre)],
              sistema: sistemaSubagente({ perfil, tarea, soloLectura: !!cfg.soloLectura, contexto: cfg.contextoSubagentes }),
              chat: cfg.chat,
              ejecutar: habilidades.length ? async (l, h, c) => (h.nombre === H_LEER_HABILIDAD ? ejecutarLeerHabilidad(l, habilidades) : cfg.ejecutar(l, h, c)) : cfg.ejecutar,
              soloLectura: cfg.soloLectura,
              maxPasos: 6,
              maxSubagentes: 0,
              onEvento: cfg.onEvento,
              signal: cfg.signal,
              profundidad: profundidad + 1,
              nombreAgente: id,
              candado,
            })
            const ok = sub.estado === 'completado'
            emitir({ tipo: 'subagente', id, nombre: perfil?.nombre ?? `Subagente ${i + 1}`, fase: 'fin', ok, resumen: sub.texto.slice(0, 200), tarea })
            return { id, tarea, sub }
          }),
        )
        for (const inf of informes) llamadas.push(...inf.sub.llamadas)
        llamadas.push({ agente, nombre: l.nombre, argumentos: l.argumentos, ok: true, clase: 'meta', resumen: `${informes.length} subagentes` })
        responder(
          l,
          JSON.stringify({
            ok: true,
            informes: informes.map((x) => ({
              tarea: x.tarea.slice(0, 120),
              estado: x.sub.estado,
              informe: x.sub.texto.slice(0, 600),
              acciones: x.sub.llamadas.filter((c) => c.clase !== 'meta').map((c) => `${c.nombre}:${c.ok ? 'ok' : 'error'}`).slice(0, 12),
            })),
          }),
        )
        if (informes.some((x) => x.sub.estado === 'confirmar')) detener = { estado: 'confirmar' }
        continue
      }

      // Herramienta del DAW. Si existe pero no estaba visible, se acepta igualmente (modelos débiles).
      const h = porNombre.get(l.nombre)
      if (!h) {
        const parecidas = buscarHerramientas(l.nombre.replace(/[._]/g, ' '), cfg.catalogo, 3).filter(permitida)
        for (const p of parecidas) visibles.add(p.nombre)
        llamadas.push({ agente, nombre: l.nombre, argumentos: l.argumentos, ok: false, error: 'no existe' })
        responder(l, JSON.stringify({ ok: false, error: `No existe la herramienta «${l.nombre}».`, parecidas: parecidas.map((p) => p.nombre) }))
        continue
      }
      if (!permitida(h)) {
        llamadas.push({ agente, nombre: l.nombre, argumentos: l.argumentos, ok: false, error: 'solo lectura', clase: h.clase })
        responder(l, JSON.stringify({ ok: false, error: 'En este modo solo puedes consultar. Describe el cambio en tu respuesta en lugar de ejecutarlo.' }))
        continue
      }
      visibles.add(h.nombre)
      const titulo = tituloHerramienta(h)
      emitir({ tipo: 'herramienta', agente, nombre: h.nombre, titulo, fase: 'inicio' })
      let res: ResultadoHerramienta
      try {
        const correr = () => cfg.ejecutar(l, h, { agente, profundidad })
        res = h.clase === 'lectura' ? await correr() : await candado.con(correr)
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      if (escribe && res.ok) repeticiones.set(f, n + 1)
      llamadas.push({ agente, nombre: h.nombre, argumentos: l.argumentos, ok: res.ok, resumen: res.resumen, error: res.error, clase: h.clase })
      // Si falló, el motivo manda sobre la etiqueta: la UI y la traza necesitan saber POR QUÉ, no qué intentaba.
      emitir({ tipo: 'herramienta', agente, nombre: h.nombre, titulo, fase: 'fin', ok: res.ok, resumen: res.ok ? res.resumen : (res.error ?? res.resumen) })
      // Insistir con la misma herramienta que falla una y otra vez (un músico probó 15 veces seguidas en una
      // producción real) gasta minutos y créditos sin avanzar: al 3.º fallo se le pide cambiar de enfoque y al
      // 5.º se corta su turno con el motivo, para que el equipo siga (el QA o el director lo recogerán).
      if (res.ok) fallosSeguidos.delete(h.nombre)
      else {
        const seguidos = (fallosSeguidos.get(h.nombre) ?? 0) + 1
        fallosSeguidos.set(h.nombre, seguidos)
        if (seguidos >= MAX_FALLOS_SEGUIDOS) {
          const motivo = `«${h.nombre}» falló ${seguidos} veces seguidas (último error: ${String(res.error ?? '').slice(0, 200)})`
          responder(l, compactarResultado(res, MAX_RESULTADO, h.clase))
          texto = texto.trim() ? `${texto.trim()}\n\nNo pude terminar: ${motivo}.` : `No pude terminar: ${motivo}.`
          return fin('limite', { error: motivo }, paso)
        }
        if (seguidos >= AVISO_FALLOS_SEGUIDOS) {
          res = {
            ...res,
            error: `${res.error ?? 'falló'} | Llevas ${seguidos} fallos seguidos con ${h.nombre}: no repitas lo mismo. Lee el error, cambia los argumentos o la herramienta (o consulta el estado con una de lectura) y, si no hay forma, termina explicando qué no pudiste hacer.`,
          }
        }
      }
      responder(l, compactarResultado(res, MAX_RESULTADO, h.clase))
      if (res.pendienteConfirmacion) detener = { estado: 'confirmar' }
    }

    if (detener) return fin(detener.estado, detener.pregunta ? { pregunta: detener.pregunta } : {}, paso)
  }
  return fin('limite', {}, maxPasos)
}
