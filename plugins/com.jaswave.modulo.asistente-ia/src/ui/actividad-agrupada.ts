/**
 * Agrupación del registro de actividad del chat (lógica pura, sin React).
 *
 * Una producción genera cientos de líneas casi iguales («Bajista: Revisando las notas MIDI» ×60) y otras
 * tantas tarjetas de herramientas. Aquí se reducen a una fila por agente con su estado actual y a tarjetas
 * consecutivas iguales con contador. Los errores y avisos nunca se colapsan.
 */

export type EstadoItem = 'en_curso' | 'ok' | 'error' | 'aviso'

export type ItemActividad = {
  id: string
  /** Quién lo hace (id o nombre); '' si no hay agente. */
  agente: string
  /** Nombre a mostrar (por defecto, `agente`). */
  nombre?: string
  color?: string
  texto: string
  /** Detalle extra (solo se ve al expandir). */
  detalle?: string
  estado: EstadoItem
}

export type FilaActividad = {
  agente: string
  nombre: string
  color?: string
  /** Lo último que hizo. */
  texto: string
  estado: EstadoItem
  /** Cuántas acciones registró en total. */
  total: number
  /** Errores y avisos distintos (nunca se ocultan). */
  alertas: ItemActividad[]
  /** Todo lo suyo, en orden (para el detalle expandible). */
  items: ItemActividad[]
}

const PATRON_ALERTA = /\b(error|fall[oó]|fallid|no se pudo|no pude|no hay conexi[oó]n|advertencia|aviso|rechazad|timeout|tiempo agotado)/i

/** ¿El texto de un evento habla de un problema que el usuario debe ver? */
export function esAlerta(texto: string, estadoQA?: string): boolean {
  return estadoQA === 'corrigiendo' || PATRON_ALERTA.test(texto)
}

/**
 * Una fila por agente, en el orden de su primera aparición (así las filas no saltan de sitio mientras se trabaja).
 */
export function agruparActividad(items: ItemActividad[]): FilaActividad[] {
  const filas = new Map<string, FilaActividad>()
  for (const it of items) {
    let f = filas.get(it.agente)
    if (!f) {
      f = { agente: it.agente, nombre: it.nombre ?? it.agente, ...(it.color ? { color: it.color } : {}), texto: it.texto, estado: it.estado, total: 0, alertas: [], items: [] }
      filas.set(it.agente, f)
    }
    f.total++
    f.texto = it.texto
    f.estado = it.estado
    if (it.nombre) f.nombre = it.nombre
    if (it.color) f.color = it.color
    f.items.push(it)
    if ((it.estado === 'error' || it.estado === 'aviso') && !f.alertas.some((a) => a.texto === it.texto)) f.alertas.push(it)
  }
  return [...filas.values()]
}

/** «12 acciones» / «1 acción». */
export function textoAcciones(n: number): string {
  return `${n} ${n === 1 ? 'acción' : 'acciones'}`
}

export type GrupoConsecutivo<T> = { clave: string; items: T[]; veces: number }

/**
 * Colapsa elementos consecutivos con la misma clave en uno con contador. Los «especiales» (fallos) nunca
 * se unen: cada uno es su propio grupo.
 */
export function colapsarConsecutivos<T>(lista: T[], clave: (t: T) => string, especial: (t: T) => boolean = () => false): Array<GrupoConsecutivo<T>> {
  const out: Array<GrupoConsecutivo<T>> = []
  for (const t of lista) {
    const k = clave(t)
    const ult = out.at(-1)
    if (ult && ult.clave === k && !especial(t) && !especial(ult.items[0]!)) {
      ult.items.push(t)
      ult.veces++
    } else out.push({ clave: k, items: [t], veces: 1 })
  }
  return out
}

/** Etapas de la producción para la barra compacta. */
export const ETAPAS_BANDA = ['Plan', 'Director', 'Músicos', 'Mezcla', 'Máster', 'Revisión'] as const
export type EstadoEtapa = 'hecha' | 'actual' | 'pendiente'

/** Número de etapa (1-6) de una fase de la producción; 0 si no ha empezado. */
export function numeroEtapa(fase: string): number {
  switch (fase) {
    case 'planificacion':
      return 1
    case 'direccion':
      return 2
    case 'grabacion_musicos':
    case 'ensayo':
    case 'coherencia':
    case 'qa_musicos':
      return 3
    case 'mezcla':
    case 'qa_mezcla':
      return 4
    case 'mastering':
    case 'qa_final':
      return 5
    case 'completado':
      return 6
    default:
      return 0
  }
}

export function estadosEtapas(fase: string, activo: boolean): Array<{ etiqueta: string; estado: EstadoEtapa }> {
  const actual = numeroEtapa(fase)
  return ETAPAS_BANDA.map((etiqueta, i) => {
    const n = i + 1
    const hecha = fase === 'completado' || actual > n
    return { etiqueta, estado: hecha ? 'hecha' : actual === n && activo ? 'actual' : 'pendiente' }
  })
}

export type EventoBandaLike = {
  id: string
  agenteId: string
  agenteNombre: string
  color?: string
  mensaje: string
  accionDetalle?: string
  estadoQA?: string
}

const PATRON_ERROR = /\b(error|fall[oó]|fallid|no se pudo|no pude|timeout|tiempo agotado)/i

/**
 * Eventos de la consola de la banda → actividad. Un evento es «en curso» si es el último de quien trabaja
 * ahora; un error o un aviso (QA corrigiendo) conserva su gravedad.
 */
export function itemsDeEventos(eventos: EventoBandaLike[], ctx: { activo: boolean; agenteActivoId: string | null }): ItemActividad[] {
  const ultimoDe = new Map<string, string>()
  for (const e of eventos) ultimoDe.set(e.agenteId, e.id)
  return eventos.map((e) => {
    let estado: EstadoItem = 'ok'
    if (PATRON_ERROR.test(e.mensaje)) estado = 'error'
    else if (esAlerta(e.mensaje, e.estadoQA)) estado = 'aviso'
    else if (ctx.activo && ctx.agenteActivoId === e.agenteId && ultimoDe.get(e.agenteId) === e.id && e.estadoQA !== 'aprobado') estado = 'en_curso'
    return {
      id: e.id,
      agente: e.agenteId,
      nombre: e.agenteNombre,
      ...(e.color ? { color: e.color } : {}),
      texto: e.mensaje,
      ...(e.accionDetalle ? { detalle: e.accionDetalle } : {}),
      estado,
    }
  })
}
