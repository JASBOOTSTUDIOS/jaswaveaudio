/**
 * Producción resiliente (plan Q), lado del renderer: escribe el diario de la banda, guarda puntos de control del
 * proyecto y encuentra producciones interrumpidas para reanudarlas. El disco lo toca el proceso principal
 * (`electron/produccion-diario.ts`); aquí solo hay lógica y un puerto fino sobre `window.electron.producciones`.
 *
 * Sin Electron (web) no hay diario: todo degrada a «no hacer nada» sin romper la producción.
 */

import {
  INTERVALO_VIDA_MS,
  debeRegistrarse,
  esReanudable,
  estadoEfectivo,
  parsearDiario,
  reconstruirEstado,
  serializarRegistro,
  textoInterrupcion,
  type EntradaDiario,
  type EtapaProduccion,
  type EstadoDiario,
  type EventoProduccion,
  type ResumenDiario,
  type RolProduccion,
} from '@jaswave/ai-harness'
import { proyectoParaGuardar } from '../../../shared/src/project/ciclo-vida'
import type { TiendaDAW } from '../../../shared/src/state/tienda'

type Resp<T> = ({ ok: true } & T) | { ok: false; error: string }
export type PuntoCargado = { proyecto: string; cabecera: { seq: number; t: number; que: string; huella: string }; usoCopiaAnterior: boolean; descartadas: number }

/** Lo que expone el preload (`window.electron.producciones`). */
export type PuertoProducciones = {
  iniciar: (proyectoId: string, runId: string) => Promise<Resp<object>>
  anexar: (proyectoId: string, runId: string, texto: string) => Promise<Resp<{ escrito: boolean }>>
  listar: (proyectoId: string) => Promise<Resp<{ producciones: Array<{ runId: string; modificado: number; bytes: number }> }>>
  leer: (proyectoId: string, runId: string) => Promise<Resp<{ texto: string | null }>>
  puntoGuardar: (proyectoId: string, json: string, que: string) => Promise<Resp<{ huella: string; archivo: string; seq: number }>>
  puntoCargar: (proyectoId: string) => Promise<Resp<{ punto: PuntoCargado | null }>>
  puntoInfo: (proyectoId: string) => Promise<Resp<{ cabecera: PuntoCargado['cabecera'] | null }>>
  candadoTomar: (proyectoId: string, runId: string) => Promise<Resp<{ testigo: string | null }>>
  candadoSoltar: (proyectoId: string, runId: string, testigo: string) => Promise<Resp<{ soltado: boolean }>>
  onAviso?: (cb: (aviso: { tipo: 'emergencia' | 'memoria'; [k: string]: unknown }) => void) => () => void
}

export function puertoProducciones(): PuertoProducciones | null {
  const w = (typeof window !== 'undefined' ? window : globalThis) as unknown as { electron?: { producciones?: PuertoProducciones } }
  return w.electron?.producciones ?? null
}

/** Identificador apto para nombres de archivo (el proceso principal solo acepta `[A-Za-z0-9_-]{1,80}`). */
export function idSeguro(texto: string | undefined | null, respaldo = 'sin-proyecto'): string {
  const s = String(texto ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
  return s || respaldo
}

export function nuevoRunId(ahora = Date.now()): string {
  return `${new Date(ahora).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
}

export type OpcionesDiario = {
  /** Cada cuánto se escribe la señal de vida (por defecto 15 s). */
  intervaloVidaMs?: number
  reloj?: () => number
  /** Inyectables para pruebas. */
  setIntervalo?: (fn: () => void, ms: number) => unknown
  clearIntervalo?: (id: unknown) => void
}

/** Escritor del diario de una producción: serializa las escrituras en orden y emite la señal de vida. */
export class DiarioProduccion {
  private cola: Promise<unknown> = Promise.resolve()
  private temporizador: unknown = null
  private etapa: EtapaProduccion = 'plan'
  private cerrado = false
  private ultimaEstado: EstadoDiario = 'en_curso'
  readonly reloj: () => number

  constructor(
    private readonly puerto: PuertoProducciones,
    readonly proyectoId: string,
    readonly runId: string,
    private readonly opts: OpcionesDiario = {},
  ) {
    this.reloj = opts.reloj ?? Date.now
  }

  private anexar(r: EntradaDiario): Promise<void> {
    if (this.cerrado && r.k !== 'estado') return this.cola.then(() => undefined)
    const texto = serializarRegistro(r, this.reloj())
    this.cola = this.cola.then(() => this.puerto.anexar(this.proyectoId, this.runId, texto)).catch(() => undefined)
    return this.cola.then(() => undefined)
  }

  async iniciar(info: { pedido: string; config?: Record<string, unknown>; participantes: Array<{ id: string; nombre: string; rol: RolProduccion }>; reanudaDe?: string }): Promise<void> {
    await this.puerto.iniciar(this.proyectoId, this.runId).catch(() => undefined)
    await this.anexar({ k: 'inicio', runId: this.runId, proyectoId: this.proyectoId, pedido: info.pedido, config: info.config, participantes: info.participantes, ...(info.reanudaDe ? { reanudaDe: info.reanudaDe } : {}) })
    const cada = this.opts.intervaloVidaMs ?? INTERVALO_VIDA_MS
    const set = this.opts.setIntervalo ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
    this.temporizador = set(() => void this.anexar({ k: 'vida', etapa: this.etapa }), cada)
    ;(this.temporizador as { unref?: () => void } | null)?.unref?.()
  }

  evento(e: EventoProduccion, huella?: string): void {
    if (e.tipo === 'etapa' && e.fase === 'inicio') this.etapa = e.etapa
    if (!debeRegistrarse(e)) return
    void this.anexar({ k: 'evento', e, ...(huella ? { huella } : {}) })
  }

  estado(estado: EstadoDiario, motivo?: string): void {
    if (estado === this.ultimaEstado && !motivo) return
    this.ultimaEstado = estado
    void this.anexar({ k: 'estado', estado, ...(motivo ? { motivo } : {}) })
  }

  control(que: string, huella: string, archivo?: string): Promise<void> {
    return this.anexar({ k: 'control', que, huella, ...(archivo ? { archivo } : {}) })
  }

  /** Cierra la producción con un estado final y espera a que todo esté en disco. */
  async cerrar(estado: Extract<EstadoDiario, 'completada' | 'detenida' | 'interrumpida'>, motivo?: string): Promise<void> {
    if (this.temporizador != null) (this.opts.clearIntervalo ?? ((id: unknown) => clearInterval(id as never)))(this.temporizador)
    this.temporizador = null
    await this.anexar({ k: 'estado', estado, ...(motivo ? { motivo } : {}) })
    this.cerrado = true
    await this.cola
  }
}

/** Guarda una copia del proyecto (también si no tiene ruta). Devuelve la huella SHA-256 o null si no se pudo. */
export async function guardarPuntoProyecto(
  puerto: PuertoProducciones | null,
  tienda: Pick<TiendaDAW, 'obtenerEstado'>,
  que: string,
): Promise<{ huella: string; archivo: string } | null> {
  if (!puerto) return null
  try {
    const project = tienda.obtenerEstado().project
    if (!project) return null
    const r = await puerto.puntoGuardar(idSeguro(project.id), JSON.stringify(proyectoParaGuardar(project)), que)
    return r.ok ? { huella: r.huella, archivo: r.archivo } : null
  } catch {
    return null
  }
}

export type ProduccionInterrumpida = {
  resumen: ResumenDiario
  texto: string
  /** Hay un punto de control válido más reciente que la última actividad del proyecto abierto. */
  hayPunto: boolean
}

/**
 * Busca la producción interrumpida más reciente del proyecto (las 3 últimas se inspeccionan). Una completada o
 * descartada no se ofrece; la que está «en curso» con señal de vida reciente tampoco (sigue viva, quizá en otra ventana).
 */
export async function buscarProduccionInterrumpida(puerto: PuertoProducciones | null, proyectoId: string, ahora = Date.now()): Promise<ProduccionInterrumpida | null> {
  if (!puerto) return null
  try {
    const l = await puerto.listar(proyectoId)
    if (!l.ok) return null
    for (const x of l.producciones.slice(0, 3)) {
      const t = await puerto.leer(proyectoId, x.runId)
      if (!t.ok || !t.texto) continue
      const res = reconstruirEstado(parsearDiario(t.texto))
      if (!res) continue
      if (res.estado === 'detenida' || res.estado === 'completada') {
        // Lo más reciente manda: si la última producción terminó bien o la detuvo el usuario, no hay nada que reanudar.
        return null
      }
      if (esReanudable(res, ahora)) {
        const info = await puerto.puntoInfo(proyectoId)
        return { resumen: res, texto: textoInterrupcion(res, ahora), hayPunto: info.ok && !!info.cabecera }
      }
      if (estadoEfectivo(res, ahora) === 'en_curso') return null
    }
  } catch {
    /* sin diario: nada que ofrecer */
  }
  return null
}

/** Marca una producción interrumpida como descartada (detenida por el usuario): no se vuelve a ofrecer. */
export async function descartarProduccion(puerto: PuertoProducciones | null, proyectoId: string, runId: string): Promise<void> {
  if (!puerto) return
  await puerto.anexar(proyectoId, runId, serializarRegistro({ k: 'estado', estado: 'detenida', motivo: 'descartada por el usuario' })).catch(() => undefined)
}

/** Lee el estado reanudable de una producción concreta. */
export async function leerProduccion(puerto: PuertoProducciones | null, proyectoId: string, runId: string): Promise<ResumenDiario | null> {
  if (!puerto) return null
  const t = await puerto.leer(proyectoId, runId)
  return t.ok && t.texto ? reconstruirEstado(parsearDiario(t.texto)) : null
}

/**
 * Restaura el proyecto abierto desde el último punto de control válido (huella SHA-256 y JSON verificados; si la
 * última copia está dañada se usa la anterior). Devuelve cuál se usó.
 */
export async function restaurarUltimoPunto(
  puerto: PuertoProducciones | null,
  tienda: Pick<TiendaDAW, 'obtenerEstado' | 'establecerEstado'>,
  proyectoId: string,
): Promise<{ ok: boolean; usoCopiaAnterior?: boolean; que?: string; error?: string }> {
  if (!puerto) return { ok: false, error: 'La recuperación solo está disponible en la aplicación de escritorio.' }
  const r = await puerto.puntoCargar(proyectoId)
  if (!r.ok || !r.punto) return { ok: false, error: 'No hay ninguna copia de seguridad válida de este proyecto.' }
  try {
    const archivo = JSON.parse(r.punto.proyecto) as { project?: ReturnType<TiendaDAW['obtenerEstado']>['project'] }
    if (!archivo.project) throw new Error('copia sin proyecto')
    const proyecto = { ...archivo.project, modificado: true }
    tienda.establecerEstado((s) => ({ ...s, project: proyecto }))
    return { ok: true, usoCopiaAnterior: r.punto.usoCopiaAnterior, que: r.punto.cabecera.que }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type AvisoProduccion = { tipo: 'memoria' | 'emergencia'; texto?: string }

/**
 * Atiende los avisos del proceso principal: ante un cierre inminente o poca memoria guarda una copia extra del
 * proyecto; el aviso de memoria se muestra al usuario en lenguaje llano (vía `alAvisar`).
 */
export function instalarAvisosProduccion(
  puerto: PuertoProducciones | null,
  tienda: Pick<TiendaDAW, 'obtenerEstado'>,
  alAvisar: (a: AvisoProduccion) => void,
): () => void {
  if (!puerto?.onAviso) return () => undefined
  return puerto.onAviso((a) => {
    void guardarPuntoProyecto(puerto, tienda, a.tipo === 'memoria' ? 'memoria baja' : `emergencia: ${String(a.motivo ?? '')}`)
    if (a.tipo === 'memoria' && typeof a.texto === 'string') alAvisar({ tipo: 'memoria', texto: a.texto })
  })
}
