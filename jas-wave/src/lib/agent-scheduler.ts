/**
 * Planificador de `/programar`: tareas del asistente que se ejecutan más tarde o de forma periódica.
 *
 * - Persisten en localStorage por proyecto (sobreviven a recargas).
 * - Al vencer, el planificador llama al ejecutor registrado (el chat las lanza como un turno normal del
 *   motor, con sus mismas políticas de permisos). Sin ejecutor registrado (panel cerrado) la tarea queda
 *   vencida y se lanza al registrarse uno: nunca se pierde ni se ejecuta a escondidas.
 * - El reloj es inyectable para poder probarlo sin esperar.
 */

export type TareaProgramada = {
  id: string
  proyectoId: string
  prompt: string
  /** Próxima ejecución (ms epoch). */
  proxima: number
  /** Si > 0, se repite cada tantos ms. */
  cadaMs: number
  creada: number
  ultimaEjecucion?: number
  ejecuciones: number
}

export type CuandoParseado = { proxima: number; cadaMs: number; prompt: string }

const UNIDADES_MS: Record<string, number> = {
  s: 1000,
  seg: 1000,
  segundo: 1000,
  segundos: 1000,
  m: 60_000,
  min: 60_000,
  minuto: 60_000,
  minutos: 60_000,
  h: 3_600_000,
  hora: 3_600_000,
  horas: 3_600_000,
  d: 86_400_000,
  dia: 86_400_000,
  dias: 86_400_000,
  día: 86_400_000,
  días: 86_400_000,
}
const MIN_INTERVALO_MS = 10_000
const MAX_TAREAS_POR_PROYECTO = 20

function numero(txt: string): number {
  return Number(txt.replace(',', '.'))
}

/**
 * Interpreta «en 10 minutos …», «cada 30 min …», «a las 18:30 …» y «mañana a las 9[:30] …».
 * El resto del texto es lo que debe hacer el asistente. Lanza si no entiende cuándo.
 */
export function parsearCuando(entrada: string, ahora: number): CuandoParseado {
  const texto = entrada.trim()
  let m = /^en\s+(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m|horas?|h|d[ií]as?|d)\b\s*(.*)$/i.exec(texto)
  if (m) {
    const ms = Math.round(numero(m[1]!) * (UNIDADES_MS[m[2]!.toLowerCase()] ?? 0))
    if (!(ms >= 1000)) throw new Error('El plazo debe ser de al menos 1 segundo')
    return { proxima: ahora + ms, cadaMs: 0, prompt: m[3]!.trim() }
  }
  m = /^cada\s+(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m|horas?|h|d[ií]as?|d)\b\s*(.*)$/i.exec(texto)
  if (m) {
    const ms = Math.round(numero(m[1]!) * (UNIDADES_MS[m[2]!.toLowerCase()] ?? 0))
    if (!(ms >= MIN_INTERVALO_MS)) throw new Error(`El intervalo mínimo es ${MIN_INTERVALO_MS / 1000} s`)
    return { proxima: ahora + ms, cadaMs: ms, prompt: m[3]!.trim() }
  }
  m = /^(ma[ñn]ana\s+)?a\s+las\s+(\d{1,2})(?::(\d{2}))?\s*(?:h|hs|horas)?\b\s*(.*)$/i.exec(texto)
  if (m) {
    const h = Number(m[2])
    const min = m[3] ? Number(m[3]) : 0
    if (h > 23 || min > 59) throw new Error(`Hora no válida: ${m[2]}${m[3] ? ':' + m[3] : ''}`)
    const d = new Date(ahora)
    d.setHours(h, min, 0, 0)
    if (m[1]) d.setDate(d.getDate() + 1)
    else if (d.getTime() <= ahora) d.setDate(d.getDate() + 1)
    return { proxima: d.getTime(), cadaMs: 0, prompt: m[4]!.trim() }
  }
  throw new Error('No entendí cuándo. Usa «en 10 minutos …», «cada 30 minutos …», «a las 18:30 …» o «mañana a las 9 …»')
}

/** Devuelve `false` si no puede ejecutar ahora (ocupado): la tarea se conserva y se reintenta. */
export type EjecutorTarea = (tarea: TareaProgramada) => void | boolean | Promise<void | boolean>

export type OpcionesPlanificador = {
  ahora?: () => number
  almacen?: Pick<Storage, 'getItem' | 'setItem'>
  clave?: string
}

export class PlanificadorTareas {
  private readonly ahora: () => number
  private readonly almacen: Pick<Storage, 'getItem' | 'setItem'> | null
  private readonly clave: string
  private tareas: TareaProgramada[]
  private ejecutor: EjecutorTarea | null = null
  private proyectoEjecutor: string | null = null
  private enCurso = new Set<string>()
  private contador = 0
  private temporizador: ReturnType<typeof setInterval> | null = null
  private readonly oyentes = new Set<() => void>()

  constructor(o: OpcionesPlanificador = {}) {
    this.ahora = o.ahora ?? (() => Date.now())
    this.clave = o.clave ?? 'jaswave-tareas-programadas-v1'
    this.almacen = o.almacen ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    this.tareas = this.cargar()
  }

  private cargar(): TareaProgramada[] {
    try {
      const raw = this.almacen?.getItem(this.clave)
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(parsed) ? (parsed as TareaProgramada[]).filter((t) => t && typeof t.id === 'string' && typeof t.proxima === 'number') : []
    } catch {
      return []
    }
  }

  private guardar(): void {
    try {
      this.almacen?.setItem(this.clave, JSON.stringify(this.tareas))
    } catch {
      /* cuota llena o almacenamiento bloqueado: las tareas siguen en memoria */
    }
    for (const o of this.oyentes) o()
  }

  suscribir(fn: () => void): () => void {
    this.oyentes.add(fn)
    return () => this.oyentes.delete(fn)
  }

  lista(proyectoId: string): TareaProgramada[] {
    return this.tareas.filter((t) => t.proyectoId === proyectoId).sort((a, b) => a.proxima - b.proxima)
  }

  /** Crea una tarea a partir del texto del comando (`en 5 minutos revisar la mezcla`). */
  programar(proyectoId: string, texto: string): TareaProgramada {
    const cuando = parsearCuando(texto, this.ahora())
    if (!cuando.prompt) throw new Error('Falta qué debo hacer. Ejemplo: /programar en 10 minutos revisar la mezcla')
    if (this.lista(proyectoId).length >= MAX_TAREAS_POR_PROYECTO) {
      throw new Error(`Máximo ${MAX_TAREAS_POR_PROYECTO} tareas programadas por proyecto: cancela alguna con /programar cancelar <id>`)
    }
    const t: TareaProgramada = {
      id: `t${this.ahora().toString(36)}${(this.contador++).toString(36)}`,
      proyectoId,
      prompt: cuando.prompt.slice(0, 2000),
      proxima: cuando.proxima,
      cadaMs: cuando.cadaMs,
      creada: this.ahora(),
      ejecuciones: 0,
    }
    this.tareas.push(t)
    this.guardar()
    return t
  }

  cancelar(proyectoId: string, id: string): boolean {
    const antes = this.tareas.length
    this.tareas = this.tareas.filter((t) => !(t.proyectoId === proyectoId && t.id === id))
    if (this.tareas.length === antes) return false
    this.guardar()
    return true
  }

  /**
   * Registra quién ejecuta las tareas vencidas (el chat) y, opcionalmente, de qué proyecto. Devuelve la
   * función para quitarlo. El ejecutor devuelve `false` si está ocupado: la tarea no se consume y se
   * reintenta en el siguiente ciclo.
   */
  registrarEjecutor(fn: EjecutorTarea, proyectoId?: string): () => void {
    this.ejecutor = fn
    this.proyectoEjecutor = proyectoId ?? null
    void this.revisar()
    return () => {
      if (this.ejecutor === fn) {
        this.ejecutor = null
        this.proyectoEjecutor = null
      }
    }
  }

  /**
   * Lanza las tareas vencidas. Una tarea repetitiva se reprograma hacia delante (sin acumular ejecuciones
   * atrasadas); una única se elimina. Si el ejecutor falla o está ocupado, la tarea se conserva.
   */
  async revisar(): Promise<number> {
    const ejecutor = this.ejecutor
    if (!ejecutor) return 0
    const ahora = this.ahora()
    const vencidas = this.tareas.filter(
      (t) => t.proxima <= ahora && !this.enCurso.has(t.id) && (this.proyectoEjecutor === null || t.proyectoId === this.proyectoEjecutor),
    )
    let lanzadas = 0
    for (const t of vencidas) {
      this.enCurso.add(t.id)
      try {
        const resultado = await ejecutor({ ...t })
        if (resultado === false) continue // ocupado: reintento en el próximo ciclo
        t.ultimaEjecucion = ahora
        t.ejecuciones++
        if (t.cadaMs > 0) {
          const saltos = Math.floor((ahora - t.proxima) / t.cadaMs) + 1
          t.proxima += saltos * t.cadaMs
        } else {
          this.tareas = this.tareas.filter((x) => x.id !== t.id)
        }
        this.guardar()
        lanzadas++
      } catch (e) {
        console.warn('[agent-scheduler] la tarea', t.id, 'falló y se conserva:', e)
      } finally {
        this.enCurso.delete(t.id)
      }
    }
    return lanzadas
  }

  iniciar(intervaloMs = 5000): void {
    if (this.temporizador) return
    this.temporizador = setInterval(() => void this.revisar(), intervaloMs)
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
  }
}

export const planificadorTareas = new PlanificadorTareas()

export function describirCuando(t: TareaProgramada, ahora: number): string {
  const resta = Math.max(0, t.proxima - ahora)
  const mins = Math.round(resta / 60_000)
  const en = resta < 90_000 ? `en ${Math.round(resta / 1000)} s` : mins < 120 ? `en ${mins} min` : `el ${new Date(t.proxima).toLocaleString()}`
  if (t.cadaMs <= 0) return en
  const cada = t.cadaMs >= 60_000 ? `${Math.round(t.cadaMs / 60_000)} min` : `${Math.round(t.cadaMs / 1000)} s`
  return `${en} y luego cada ${cada}`
}
