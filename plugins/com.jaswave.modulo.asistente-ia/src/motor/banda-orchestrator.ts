import { limpiarTextoUsuario } from '@jaswave/host-sdk'
import type { EtapaProduccion, EventoProduccion, NotaUsuario, ParticipanteProduccion, ResultadoProduccionAgentes } from '@jaswave/host-sdk'
import { cargarEspecialistas } from './especialistas-storage'

export type FaseBanda =
  | 'idle'
  | 'planificacion'
  | 'direccion'
  | 'grabacion_musicos'
  | 'ensayo'
  | 'coherencia'
  | 'qa_musicos'
  | 'mezcla'
  | 'qa_mezcla'
  | 'mastering'
  | 'qa_final'
  | 'completado'
  | 'error'

export interface EventoOrquestador {
  id: string
  timestamp: number
  fase: FaseBanda
  agenteId: string
  agenteNombre: string
  rol: string
  color?: string
  mensaje: string
  accionDetalle?: string
  estadoQA?: 'aprobado' | 'corrigiendo' | 'pendiente'
  /** Ronda de corrección (0 = primera revisión). */
  ronda?: number
}

export interface ParticipanteBanda {
  id: string
  nombre: string
  rol: string
  color?: string
}

export interface BandaLiveState {
  activo: boolean
  faseActual: FaseBanda
  promptUsuario: string
  agenteActivoId: string | null
  /** Quiénes forman la banda (para escribirle a uno en particular). */
  participantes: ParticipanteBanda[]
  eventos: EventoOrquestador[]
  qaReporte: {
    musicosAprobados: number
    musicosTotal: number
    mezclaAprobada: boolean
    masterAprobado: boolean
    rondas: number
    detalles: string[]
  }
}

type ListenerLive = (state: BandaLiveState) => void

const ESTADO_INICIAL = (prompt: string): BandaLiveState => ({
  activo: false,
  faseActual: 'idle',
  promptUsuario: prompt,
  agenteActivoId: null,
  participantes: [],
  eventos: [],
  qaReporte: { musicosAprobados: 0, musicosTotal: 0, mezclaAprobada: false, masterAprobado: false, rondas: 0, detalles: [] },
})

const FASE: Record<EtapaProduccion, FaseBanda> = {
  plan: 'planificacion',
  direccion: 'direccion',
  musicos: 'grabacion_musicos',
  ensayo: 'ensayo',
  coherencia: 'coherencia',
  qa_musicos: 'qa_musicos',
  mezcla: 'mezcla',
  qa_mezcla: 'qa_mezcla',
  master: 'mastering',
  qa_master: 'qa_final',
  entrega: 'completado',
}

const INICIO_ETAPA: Partial<Record<EtapaProduccion, string>> = {
  plan: 'Planificando la canción…',
  direccion: 'Preparando el proyecto y repartiendo el trabajo…',
  musicos: 'Los músicos están grabando sus partes a la vez…',
  ensayo: 'Ensayo: la banda se escucha y se pone de acuerdo…',
  coherencia: 'Revisando que todo encaje en tiempo, armonía y ritmo…',
  qa_musicos: 'Revisando lo que grabaron…',
  mezcla: 'Mezclando…',
  qa_mezcla: 'Revisando la mezcla…',
  master: 'Preparando el máster…',
  qa_master: 'Revisión final del máster…',
}

const MAX_EVENTOS = 200
let contadorEventos = 0

/**
 * Canal entre ventanas: la producción corre en la ventana principal y su panel puede estar en una ventana
 * flotante (otro renderer, otro singleton). Sin esto el panel flotante se veía vacío.
 */
export const CANAL_BANDA = 'jaswave-banda-v1'
type MensajeBanda = { tipo: 'estado'; state: BandaLiveState } | { tipo: 'pedir' } | { tipo: 'detener' } | { tipo: 'nota'; texto: string; para?: string }

/** Quien escribe las indicaciones durante la producción (fila propia en la consola de la banda). */
export const USUARIO_BANDA = { id: 'usuario', nombre: 'Tú', rol: 'usuario', color: '#f5d0a9' } as const
const MAX_NOTA = 600

/**
 * Estado en vivo de la banda virtual. La producción la hacen agentes reales por etapas (turno «banda»,
 * `motor/turno/turno-banda.ts`); este objeto traduce sus eventos al panel: etapa, quién trabaja, qué
 * hace, veredictos del QA y rondas de corrección.
 */
export class BandaOrchestrator {
  private listeners = new Set<ListenerLive>()
  private state: BandaLiveState = ESTADO_INICIAL('')
  private abortar: (() => void) | null = null
  private participantes: ParticipanteProduccion[] = []
  private colores = new Map<string, string>()
  private canal: { postMessage: (m: MensajeBanda) => void } | null = null
  /** Esta instancia solo refleja la producción de otra ventana (panel flotante). */
  private reflejo = false
  /** Indicaciones del usuario que la producción aún no ha recogido (`tomarNotas`). */
  private notasPendientes: NotaUsuario[] = []

  constructor(canal?: { postMessage: (m: MensajeBanda) => void; onmessage?: ((ev: { data: unknown }) => void) | null } | null) {
    if (canal !== undefined) {
      this.canal = canal
      if (canal) canal.onmessage = (ev) => this.recibir(ev.data)
      this.canal?.postMessage({ tipo: 'pedir' })
      return
    }
    // Solo en el renderer: en Node (pruebas) un BroadcastChannel abierto mantendría vivo el proceso.
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
    try {
      const bc = new BroadcastChannel(CANAL_BANDA)
      bc.onmessage = (ev: MessageEvent) => this.recibir(ev.data)
      // En Node (pruebas con `window` simulado) el canal no debe mantener vivo el proceso.
      ;(bc as unknown as { unref?: () => void }).unref?.()
      this.canal = bc
      bc.postMessage({ tipo: 'pedir' } satisfies MensajeBanda)
    } catch {
      this.canal = null
    }
  }

  /** Lo que llega de otra ventana (dato, no orden: solo se refleja si aquí no hay producción propia). */
  public recibir(m: unknown): void {
    const msg = (m ?? null) as MensajeBanda | null
    if (!msg || typeof msg !== 'object') return
    if (msg.tipo === 'pedir') {
      if (!this.reflejo && (this.abortar || this.state.eventos.length)) this.publicar()
      return
    }
    if (msg.tipo === 'detener') {
      this.abortar?.()
      return
    }
    if (msg.tipo === 'nota') {
      // Escrita en un panel flotante: la recoge la ventana que lleva la producción.
      if (this.abortar && typeof msg.texto === 'string') this.enviarNota(msg.texto, typeof msg.para === 'string' ? msg.para : undefined)
      return
    }
    if (msg.tipo === 'estado' && msg.state && typeof msg.state === 'object') {
      if (this.abortar) return
      this.reflejo = true
      // El estado viene de otra ventana (quizá de una versión sin `participantes`): nunca dejar huecos
      // que tumben el panel.
      const recibido = msg.state as Partial<BandaLiveState>
      this.state = {
        ...ESTADO_INICIAL(typeof recibido.promptUsuario === 'string' ? recibido.promptUsuario : ''),
        ...recibido,
        participantes: Array.isArray(recibido.participantes) ? recibido.participantes : [],
        eventos: Array.isArray(recibido.eventos) ? recibido.eventos : [],
      }
      for (const l of this.listeners) l(this.state)
    }
  }

  public esReflejo(): boolean {
    return this.reflejo
  }

  private publicar() {
    try {
      this.canal?.postMessage({ tipo: 'estado', state: this.state })
    } catch {
      /* canal cerrado */
    }
  }

  public subscribe(fn: ListenerLive): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => {
      this.listeners.delete(fn)
    }
  }

  public getState(): BandaLiveState {
    return this.state
  }

  private emit() {
    for (const l of this.listeners) l(this.state)
    if (!this.reflejo) this.publicar()
  }

  private quien(id: string | undefined): { id: string; nombre: string; rol: string; color?: string } {
    if (id === USUARIO_BANDA.id) return { ...USUARIO_BANDA }
    const p = this.participantes.find((x) => x.id === id)
    return p ? { id: p.id, nombre: p.nombre, rol: p.rol, color: this.colores.get(p.id) } : { id: 'sistema', nombre: 'Banda', rol: 'sistema', color: '#8b5cf6' }
  }

  private push(fase: FaseBanda, quienId: string | undefined, mensaje: string, extra: Partial<EventoOrquestador> = {}) {
    const q = this.quien(quienId)
    const ev: EventoOrquestador = {
      id: `ev-${Date.now()}-${++contadorEventos}`,
      timestamp: Date.now(),
      fase,
      agenteId: q.id,
      agenteNombre: q.nombre,
      rol: q.rol,
      color: q.color,
      mensaje,
      ...extra,
    }
    // Una línea del usuario no cambia quién está trabajando.
    const agenteActivoId = q.id === USUARIO_BANDA.id ? this.state.agenteActivoId : q.id
    this.state = { ...this.state, eventos: [...this.state.eventos, ev].slice(-MAX_EVENTOS), faseActual: fase, agenteActivoId }
    this.emit()
  }

  /**
   * Indicación del usuario para el agente en turno (lo que él ve y oye y los agentes no). Queda en la consola
   * como «Tú: …» y la producción la recoge con `tomarNotas`; desde un panel flotante viaja a la ventana que
   * lleva la producción. Devuelve false si no hay producción en curso.
   */
  public enviarNota(texto: string, para?: string): boolean {
    const t = limpiarTextoUsuario(texto).replace(/\s+/g, ' ').trim().slice(0, MAX_NOTA)
    if (!t || !this.state.activo) return false
    // Destinatario: un participante concreto (por id) o toda la banda.
    const destino = para ? this.state.participantes.find((p) => p.id === para) : undefined
    if (para && !destino) return false
    if (this.abortar) {
      this.notasPendientes.push({ texto: t, ...(destino ? { para: destino.id } : {}) })
      this.push(this.state.faseActual, USUARIO_BANDA.id, destino ? `Para ${destino.nombre}: ${t}` : t)
      return true
    }
    if (!this.reflejo) return false
    try {
      this.canal?.postMessage({ tipo: 'nota', texto: t, ...(destino ? { para: destino.id } : {}) })
      return true
    } catch {
      return false
    }
  }

  /**
   * Resuelve a quién va una indicación escrita en el chat: «@Bajista …» o «Bajista: …» (nombre o id de un
   * participante, sin distinguir mayúsculas) → ese participante y el texto sin el prefijo; si no, a todos.
   */
  public destinatarioDeTexto(texto: string): { texto: string; para?: string } {
    const t = texto.trim()
    const m = /^@?\s*([^:@\n]{1,40}?)\s*[:,]\s+(.+)$/s.exec(t) ?? /^@\s*(\S+)\s+(.+)$/s.exec(t)
    if (!m) return { texto: t }
    const nombre = m[1]!.trim().toLowerCase()
    const p = this.state.participantes.find((x) => x.nombre.trim().toLowerCase() === nombre || x.id.toLowerCase() === nombre)
    return p ? { texto: m[2]!.trim(), para: p.id } : { texto: t }
  }

  /** Lo llama la producción (a menudo): indicaciones nuevas desde la última vez, en orden. */
  public tomarNotas(): NotaUsuario[] {
    if (!this.notasPendientes.length) return []
    const n = this.notasPendientes
    this.notasPendientes = []
    return n
  }

  /** Lo llama el turno al empezar: deja el panel listo y guarda cómo detenerlo. */
  public comenzar(prompt: string, participantes: ParticipanteProduccion[], abortar: () => void): void {
    this.reflejo = false
    this.participantes = participantes
    this.colores = new Map(cargarEspecialistas().map((e) => [e.id, e.color ?? '#6366f1']))
    this.abortar = abortar
    this.notasPendientes = []
    this.state = {
      ...ESTADO_INICIAL(prompt),
      activo: true,
      faseActual: 'planificacion',
      participantes: participantes.map((p) => ({ id: p.id, nombre: p.nombre, rol: p.rol, color: this.colores.get(p.id) })),
      qaReporte: { ...ESTADO_INICIAL(prompt).qaReporte, musicosTotal: participantes.filter((p) => p.rol === 'musico').length },
    }
    this.emit()
  }

  public evento(e: EventoProduccion): void {
    if (e.tipo === 'etapa') {
      if (e.etapa === 'entrega') return
      if (e.fase === 'inicio') {
        if (e.ronda) return
        const responsable = this.participantes.find((p) =>
          e.etapa === 'plan' ? p.rol === 'planificador' : e.etapa === 'direccion' ? p.rol === 'director' : e.etapa === 'coherencia' ? p.rol === 'coherencia' : e.etapa.startsWith('qa_') ? p.rol === 'qa' : e.etapa === 'mezcla' ? p.rol === 'mezcla' : e.etapa === 'master' ? p.rol === 'master' : false,
        )
        this.push(FASE[e.etapa], responsable?.id, INICIO_ETAPA[e.etapa] ?? '')
      }
      return
    }
    if (e.tipo === 'ensayo') {
      const nombre = (id: string) => this.quien(id).nombre
      if (e.conformes.length) this.push('ensayo', undefined, `Conformes con su parte: ${e.conformes.map(nombre).join(', ')}.`)
      for (const p of e.propuestas) {
        this.push('ensayo', p.de, `Propone ${p.para === p.de ? 'ajustar su parte' : `a ${nombre(p.para)}`}: ${limpiarTextoUsuario(p.ajuste).slice(0, 200)}`)
      }
      const director = this.participantes.find((p) => p.rol === 'director')
      if (e.propuestas.length) {
        this.push(
          'ensayo',
          director?.id,
          e.acordados.length ? `Acordado: ${e.acordados.map((a) => `${nombre(a.musico)} ${limpiarTextoUsuario(a.ajuste).slice(0, 120)}`).join(' · ')}` : `La banda lo deja como está.${e.nota ? ` ${limpiarTextoUsuario(e.nota)}` : ''}`,
          e.acordados.length ? { estadoQA: 'corrigiendo', accionDetalle: e.nota ? limpiarTextoUsuario(e.nota) : undefined } : {},
        )
      } else this.push('ensayo', director?.id, 'La banda está de acuerdo: cada parte encaja con las demás.', { estadoQA: 'aprobado' })
      return
    }
    if (e.tipo === 'devolucion') {
      const d = e.devolucion
      const a = d.destino === 'musicos' ? (d.musico ? this.quien(d.musico).nombre : 'los músicos') : d.destino === 'arreglista' ? 'el arreglista' : 'la mezcla'
      this.push(FASE[e.etapa], e.participante.id, `Devuelve el trabajo a ${a}: ${limpiarTextoUsuario(d.problema).slice(0, 200)}`, { estadoQA: 'corrigiendo' })
      return
    }
    if (e.tipo === 'encargos') {
      for (const x of e.encargos) this.push('direccion', x.participante, `Encargo: ${limpiarTextoUsuario(x.encargo).slice(0, 160)}`)
      return
    }
    if (e.tipo === 'nota') {
      this.push(FASE[e.etapa], e.participante.id, `Tiene en cuenta tu indicación: «${limpiarTextoUsuario(e.texto).slice(0, 120)}»`)
      return
    }
    if (e.tipo === 'agente') {
      const ev = e.evento
      if (ev.tipo === 'herramienta' && ev.fase === 'fin') {
        // El motivo real (error de la herramienta) ayuda al usuario y a quien depura a ver por qué insiste.
        const motivo = ev.ok ? '' : limpiarTextoUsuario(String(ev.resumen ?? '')).replace(/\s+/g, ' ').slice(0, 160)
        this.push(FASE[e.etapa], e.participante.id, ev.titulo, ev.ok ? {} : { accionDetalle: motivo ? `No salió bien: ${motivo}` : 'No salió bien; lo intenta de otra forma.' })
      }
      return
    }
    if (e.tipo === 'qa') {
      const v = e.veredicto
      const qa = this.participantes.find((p) => p.rol === (e.etapa === 'coherencia' ? 'coherencia' : 'qa'))
      const problemas = v.problemas.map((p) => `${p.quien ? `${this.quien(p.quien).nombre}: ` : ''}${limpiarTextoUsuario(p.problema)}`)
      this.push(
        FASE[e.etapa],
        qa?.id,
        v.aprobado ? `Aprobado. ${limpiarTextoUsuario(v.resumen)}`.trim() : `Hay que corregir${e.ronda ? ` (ronda ${e.ronda + 1})` : ''}.`,
        {
          estadoQA: v.aprobado ? 'aprobado' : 'corrigiendo',
          ronda: e.ronda,
          accionDetalle: [...new Set([...problemas, ...(e.medicion?.detalles ?? [])].filter(Boolean))].join('\n') || undefined,
        },
      )
      const r = this.state.qaReporte
      this.state = {
        ...this.state,
        qaReporte: {
          ...r,
          rondas: Math.max(r.rondas, e.ronda),
          musicosAprobados: e.etapa === 'qa_musicos' ? (v.aprobado ? r.musicosTotal : r.musicosTotal - new Set(v.problemas.map((p) => p.quien).filter(Boolean)).size) : r.musicosAprobados,
          mezclaAprobada: e.etapa === 'qa_mezcla' ? v.aprobado : r.mezclaAprobada,
          masterAprobado: e.etapa === 'qa_master' ? v.aprobado : r.masterAprobado,
        },
      }
      this.emit()
    }
  }

  /** Lo llama el turno al terminar (bien, con avisos, con fallo o detenido). */
  public terminar(r: ResultadoProduccionAgentes): void {
    this.abortar = null
    this.notasPendientes = []
    const detalles = r.etapas.filter((x) => x.etapa.startsWith('qa_')).map((x) => `${x.ok ? 'Aprobada' : 'Con avisos'}: ${limpiarTextoUsuario(x.resumen)}`)
    this.state = { ...this.state, activo: false, qaReporte: { ...this.state.qaReporte, detalles } }
    const fase: FaseBanda = r.estado === 'fallo' || r.estado === 'cancelado' ? 'error' : 'completado'
    const mensaje =
      r.estado === 'cancelado'
        ? 'Producción detenida. Lo que ya se creó se puede deshacer desde el chat.'
        : r.estado === 'fallo'
          ? 'La producción se detuvo por un problema. Lo que ya se creó se puede deshacer desde el chat.'
          : r.estado === 'completado'
            ? 'Producción terminada y revisada.'
            : 'Producción terminada con algunos avisos: revisa el informe.'
    this.push(fase, undefined, mensaje)
  }

  /** Detiene la producción propia; desde un panel flotante, se lo pide a la ventana que la lleva. */
  public detener(): void {
    if (this.abortar) {
      this.abortar()
      return
    }
    if (this.reflejo) {
      try {
        this.canal?.postMessage({ tipo: 'detener' })
      } catch {
        /* canal cerrado */
      }
    }
  }
}

export const orquestadorBandaSingleton = new BandaOrchestrator()
