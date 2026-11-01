/**
 * G7: núcleo del dictado por voz, sin React (lo usa `hooks/use-voice-dictation.ts`).
 *
 * Dos motores de reconocimiento:
 *  - `windows`: reconocedor local de Windows (System.Speech) a través de main (`window.electron.dictado`).
 *    Es el preferido en Electron, donde la Web Speech API de Chromium falla con `network` (sin claves de Google).
 *  - `web`: Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) con resultados provisionales.
 * Si un motor no arranca se prueba el siguiente; si ninguno sirve, el botón queda deshabilitado con el motivo.
 *
 * El texto del campo es siempre ancla + finales + provisional, recalculado entero en cada resultado
 * (`componerTextoDictado`), así la hipótesis provisional nunca deja palabras duplicadas.
 */
import { componerTextoDictado } from '../../../shared/src/voice/voice-text-formatter'

export type TipoMotorDictado = 'windows' | 'web'
export type EstadoDictado = 'inactivo' | 'iniciando' | 'escuchando'
export type ModoDictado = 'transcribir' | 'auto-enviar'

/** Silencio tras el que «Dictar y enviar al pausar» envía el mensaje. */
export const AUTO_ENVIO_MS_POR_DEFECTO = 2000

/** API del preload (`window.electron.dictado`). */
export interface PuenteDictadoEscritorio {
  disponible: () => Promise<{ disponible: boolean; motor?: string; motivo?: string }>
  iniciar: (cultura: string) => Promise<{ ok: boolean; codigo?: string; error?: string; cultura?: string; motor?: string }>
  detener: () => Promise<unknown>
  onEvento: (callback: (evento: { tipo: string; texto?: string; codigo?: string; mensaje?: string }) => void) => () => void
}

export interface ManejadoresMotor {
  alParcial: (texto: string) => void
  alFinal: (texto: string) => void
  alError: (codigo: string, mensaje?: string) => void
  /** El motor dejó de escuchar (silencio largo, cierre del proceso…). */
  alFin: () => void
}

export interface MotorReconocimiento {
  tipo: TipoMotorDictado
  /** Resuelve cuando escucha; rechaza con `ErrorDictado` si no pudo arrancar. */
  iniciar: (m: ManejadoresMotor) => Promise<void>
  detener: () => void
}

export class ErrorDictado extends Error {
  constructor(readonly codigo: string, mensaje?: string) {
    super(mensaje ?? codigo)
    this.name = 'ErrorDictado'
  }
}

// ── Mensajes ──────────────────────────────────────────────────────────────────

/** Error del reconocedor → texto para el usuario (null = no es un error que mostrar). */
export function mensajeErrorDictado(codigo: string): string | null {
  switch (codigo) {
    case 'aborted':
    case 'no-speech':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permiso de micrófono denegado. Actívalo en Configuración de Windows → Privacidad → Micrófono.'
    case 'audio-capture':
    case 'sin-microfono':
      return 'No se encontró ningún micrófono. Conecta uno o elige la entrada por defecto en Windows.'
    case 'network':
      return 'El reconocimiento de voz del navegador necesita el servicio de Google y no está disponible aquí.'
    case 'sin-reconocedor':
      return 'Windows no tiene instalado el reconocimiento de voz en español (Configuración → Hora e idioma → Voz).'
    case 'language-not-supported':
      return 'El reconocedor de voz no admite este idioma.'
    case 'tiempo':
      return 'El reconocedor de voz no respondió a tiempo. Vuelve a intentarlo.'
    case 'no-soportado':
      return 'Este entorno no tiene reconocimiento de voz.'
    default:
      return `No se pudo usar el dictado por voz (${codigo}).`
  }
}

/** Fallos que no dependen del motor (permiso, micrófono): no tiene sentido probar otro. */
const ERRORES_SIN_ALTERNATIVA = new Set(['not-allowed', 'audio-capture', 'sin-microfono', 'aborted', 'no-speech'])

/** Fallos que dejan el motor inservible en esta sesión de la app (no se vuelve a intentar). */
const ERRORES_DESCARTAN_MOTOR = new Set(['network', 'sin-reconocedor', 'no-soportado', 'service-not-allowed', 'language-not-supported'])

export function errorPermiteOtroMotor(codigo: string): boolean {
  return !ERRORES_SIN_ALTERNATIVA.has(codigo)
}

// ── Disponibilidad (compartida por todos los botones) ─────────────────────────

const descartados = new Map<TipoMotorDictado, string>()
const oyentesDisponibilidad = new Set<() => void>()
let versionDisponibilidad = 0

export function descartarMotor(tipo: TipoMotorDictado, codigo: string): void {
  if (descartados.get(tipo) === codigo) return
  descartados.set(tipo, codigo)
  versionDisponibilidad++
  for (const o of oyentesDisponibilidad) o()
}

export function suscribirDisponibilidad(oyente: () => void): () => void {
  oyentesDisponibilidad.add(oyente)
  return () => oyentesDisponibilidad.delete(oyente)
}

/** Cambia cada vez que se descarta un motor (para `useSyncExternalStore`). */
export function versionDeDisponibilidad(): number {
  return versionDisponibilidad
}

/** Solo para tests. */
export function reiniciarDisponibilidad(): void {
  descartados.clear()
  versionDisponibilidad++
}

export interface EntornoDictado {
  puente?: PuenteDictadoEscritorio | null
  reconocimientoWeb?: ConstructorReconocimientoWeb | null
}

/** Orden de motores: en Electron primero el de Windows; la Web Speech API como respaldo (o única en navegador). */
export function motoresDisponibles(entorno: EntornoDictado): TipoMotorDictado[] {
  const out: TipoMotorDictado[] = []
  if (entorno.puente && !descartados.has('windows')) out.push('windows')
  if (entorno.reconocimientoWeb && !descartados.has('web')) out.push('web')
  return out
}

/** null si hay algún motor; si no, el motivo (para el título del botón deshabilitado). */
export function motivoNoDisponible(entorno: EntornoDictado): string | null {
  if (motoresDisponibles(entorno).length) return null
  const ultimo = descartados.get('web') ?? descartados.get('windows')
  return (ultimo && mensajeErrorDictado(ultimo)) || 'El dictado por voz no está disponible en este entorno.'
}

export function entornoDelNavegador(): EntornoDictado {
  if (typeof window === 'undefined') return {}
  const w = window as unknown as {
    electron?: { dictado?: PuenteDictadoEscritorio }
    SpeechRecognition?: ConstructorReconocimientoWeb
    webkitSpeechRecognition?: ConstructorReconocimientoWeb
  }
  return { puente: w.electron?.dictado ?? null, reconocimientoWeb: w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null }
}

export function idiomaDictado(): string {
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  return nav?.toLowerCase().startsWith('es') ? nav : 'es-ES'
}

// ── Motores ───────────────────────────────────────────────────────────────────

export function crearMotorWindows(puente: PuenteDictadoEscritorio, cultura: string): MotorReconocimiento {
  let quitar: (() => void) | null = null
  const soltar = () => {
    quitar?.()
    quitar = null
  }
  return {
    tipo: 'windows',
    async iniciar(m) {
      const disp = await puente.disponible().catch(() => ({ disponible: false }))
      if (!disp.disponible) throw new ErrorDictado('no-soportado')
      soltar()
      quitar = puente.onEvento((ev) => {
        if (ev.tipo === 'parcial') m.alParcial(ev.texto ?? '')
        else if (ev.tipo === 'final') m.alFinal(ev.texto ?? '')
        else if (ev.tipo === 'error') m.alError(ev.codigo ?? 'motor', ev.mensaje)
        else if (ev.tipo === 'fin') {
          soltar()
          m.alFin()
        }
      })
      const r = await puente.iniciar(cultura).catch((err: unknown) => ({ ok: false, codigo: 'motor', error: String(err) }))
      if (!r.ok) {
        soltar()
        throw new ErrorDictado(r.codigo ?? 'motor', r.error)
      }
    },
    detener() {
      soltar()
      void puente.detener().catch(() => undefined)
    },
  }
}

// Web Speech API (no está en lib.dom de TypeScript)
interface ResultadoReconocimientoWeb {
  readonly isFinal: boolean
  readonly length: number
  [i: number]: { transcript: string } | undefined
}
interface EventoResultadoWeb {
  resultIndex: number
  results: { readonly length: number; [i: number]: ResultadoReconocimientoWeb | undefined }
}
interface ReconocimientoWeb {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: EventoResultadoWeb) => void) | null
  onerror: ((e: { error: string; message?: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
export type ConstructorReconocimientoWeb = new () => ReconocimientoWeb

export function crearMotorWeb(Ctor: ConstructorReconocimientoWeb, lang: string): MotorReconocimiento {
  let rec: ReconocimientoWeb | null = null
  return {
    tipo: 'web',
    iniciar(m) {
      return new Promise<void>((resolve, reject) => {
        let arrancado = false
        const r = new Ctor()
        rec = r
        r.continuous = true
        r.interimResults = true
        r.lang = lang
        r.onstart = () => {
          arrancado = true
          resolve()
        }
        r.onresult = (e) => {
          let provisional = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const item = e.results[i]
            const texto = item?.[0]?.transcript ?? ''
            if (!item || !texto) continue
            if (item.isFinal) m.alFinal(texto)
            else provisional += texto
          }
          m.alParcial(provisional)
        }
        r.onerror = (e) => {
          if (!arrancado) {
            arrancado = true
            reject(new ErrorDictado(e.error, e.message))
            return
          }
          m.alError(e.error, e.message)
        }
        r.onend = () => {
          if (rec === r) rec = null
          m.alFin()
        }
        try {
          r.start()
        } catch (err) {
          reject(new ErrorDictado('motor', err instanceof Error ? err.message : String(err)))
        }
      })
    },
    detener() {
      const r = rec
      rec = null
      if (!r) return
      r.onresult = null
      r.onerror = null
      r.onend = null
      try {
        r.stop()
      } catch {
        /* ya parado */
      }
    },
  }
}

export function crearMotor(tipo: TipoMotorDictado, entorno: EntornoDictado, lang: string): MotorReconocimiento | null {
  if (tipo === 'windows' && entorno.puente) return crearMotorWindows(entorno.puente, lang)
  if (tipo === 'web' && entorno.reconocimientoWeb) return crearMotorWeb(entorno.reconocimientoWeb, lang)
  return null
}

// ── Controlador de una sesión de dictado ──────────────────────────────────────

export interface OpcionesControlador {
  entorno: () => EntornoDictado
  lang?: string
  /** ms de silencio para auto-enviar; null = solo transcribir. */
  autoEnvioMs?: number | null
  formatear?: boolean
  alCambiarTexto: (texto: string, esFinal: boolean) => void
  alAutoEnviar?: (texto: string) => void
  alCambiarEstado?: () => void
  /** Sonido al empezar / terminar. */
  alSonar?: (tipo: 'inicio' | 'fin') => void
  /** Inyectable en tests. */
  crearMotor?: (tipo: TipoMotorDictado) => MotorReconocimiento | null
  temporizador?: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void }
}

const TEMPORIZADOR_REAL = {
  set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clear: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
}

/** Solo un dictado a la vez en toda la app (el reconocedor de Windows es uno). */
const sesionGlobal: { activo: ControladorDictado | null } = { activo: null }

export class ControladorDictado {
  estado: EstadoDictado = 'inactivo'
  error: string | null = null
  motor: TipoMotorDictado | null = null

  private ancla = ''
  private finales: string[] = []
  private provisional = ''
  private ultimoEmitido: string | null = null
  private motorActual: MotorReconocimiento | null = null
  private turno = 0
  private temporizadorEnvio: unknown = null

  constructor(private opciones: OpcionesControlador) {}

  actualizarOpciones(parcial: Partial<OpcionesControlador>): void {
    this.opciones = { ...this.opciones, ...parcial }
    if (this.opciones.autoEnvioMs == null) this.cancelarAutoEnvio()
  }

  get escuchando(): boolean {
    return this.estado !== 'inactivo'
  }

  /** Empieza a dictar a continuación de `textoActual` (el ancla). */
  async iniciar(textoActual: string): Promise<void> {
    if (this.estado !== 'inactivo') return
    if (sesionGlobal.activo && sesionGlobal.activo !== this) sesionGlobal.activo.detener()
    sesionGlobal.activo = this
    const turno = ++this.turno
    this.ancla = textoActual
    this.finales = []
    this.provisional = ''
    this.ultimoEmitido = textoActual
    this.error = null
    this.fijarEstado('iniciando')
    // El sonido va antes de abrir el micrófono: así el reconocedor no lo oye.
    this.opciones.alSonar?.('inicio')

    const entorno = this.opciones.entorno()
    const lang = this.opciones.lang ?? idiomaDictado()
    let ultimoCodigo: string | null = null
    for (const tipo of motoresDisponibles(entorno)) {
      const motor = this.opciones.crearMotor ? this.opciones.crearMotor(tipo) : crearMotor(tipo, entorno, lang)
      if (!motor) continue
      this.motorActual = motor
      try {
        await motor.iniciar(this.manejadores(turno, motor))
        if (turno !== this.turno) {
          motor.detener()
          return
        }
        this.motor = tipo
        this.fijarEstado('escuchando')
        return
      } catch (err) {
        motor.detener()
        if (turno !== this.turno) return
        const codigo = err instanceof ErrorDictado ? err.codigo : 'motor'
        ultimoCodigo = codigo
        if (ERRORES_DESCARTAN_MOTOR.has(codigo)) descartarMotor(tipo, codigo)
        if (!errorPermiteOtroMotor(codigo)) break
      }
    }
    this.motorActual = null
    this.error = ultimoCodigo ? mensajeErrorDictado(ultimoCodigo) : mensajeErrorDictado('no-soportado')
    this.terminar(false)
  }

  /** Para de escuchar y confirma lo provisional como final. */
  detener(): void {
    if (this.estado === 'inactivo') return
    this.turno++
    const motor = this.motorActual
    this.motorActual = null
    motor?.detener()
    this.confirmarProvisional()
    this.terminar(true)
  }

  alternar(textoActual: string): void {
    if (this.escuchando) this.detener()
    else void this.iniciar(textoActual)
  }

  /** El usuario editó el campo mientras se dicta: lo nuevo pasa a ser el ancla (no se pisa lo tecleado). */
  sincronizarValor(valor: string): void {
    if (this.estado === 'inactivo' || valor === this.ultimoEmitido) return
    this.ancla = valor
    this.finales = []
    this.provisional = ''
    this.ultimoEmitido = valor
  }

  /** Texto completo actual (ancla + dictado). */
  texto(): string {
    return componerTextoDictado({ ancla: this.ancla, finales: this.finales, provisional: this.provisional, formatear: this.opciones.formatear !== false })
  }

  private manejadores(turno: number, motor: MotorReconocimiento): ManejadoresMotor {
    const vigente = () => turno === this.turno && this.motorActual === motor
    return {
      alParcial: (t) => {
        if (!vigente()) return
        this.provisional = t
        this.emitir(false)
      },
      alFinal: (t) => {
        if (!vigente()) return
        if (t.trim()) this.finales.push(t.trim())
        this.provisional = ''
        this.emitir(true)
      },
      alError: (codigo) => {
        if (!vigente()) return
        const msg = mensajeErrorDictado(codigo)
        if (ERRORES_DESCARTAN_MOTOR.has(codigo)) descartarMotor(motor.tipo, codigo)
        if (msg) {
          this.error = msg
          this.detener()
        }
      },
      alFin: () => {
        if (!vigente()) return
        this.detener()
      },
    }
  }

  private emitir(esFinal: boolean): void {
    const t = this.texto()
    this.ultimoEmitido = t
    this.opciones.alCambiarTexto(t, esFinal)
    this.programarAutoEnvio()
  }

  private confirmarProvisional(): void {
    if (!this.provisional.trim()) return
    this.finales.push(this.provisional.trim())
    this.provisional = ''
    this.emitir(true)
  }

  private programarAutoEnvio(): void {
    const ms = this.opciones.autoEnvioMs
    if (ms == null || !this.opciones.alAutoEnviar) return
    this.cancelarAutoEnvio()
    const tm = this.opciones.temporizador ?? TEMPORIZADOR_REAL
    this.temporizadorEnvio = tm.set(() => {
      this.temporizadorEnvio = null
      if (this.estado !== 'escuchando') return
      const dictado = this.finales.length > 0 || this.provisional.trim() !== ''
      this.detener()
      if (dictado) this.opciones.alAutoEnviar?.(this.texto())
    }, ms)
  }

  private cancelarAutoEnvio(): void {
    if (this.temporizadorEnvio == null) return
    const tm = this.opciones.temporizador ?? TEMPORIZADOR_REAL
    tm.clear(this.temporizadorEnvio)
    this.temporizadorEnvio = null
  }

  private terminar(sonar: boolean): void {
    this.cancelarAutoEnvio()
    if (sesionGlobal.activo === this) sesionGlobal.activo = null
    this.motor = null
    this.fijarEstado('inactivo')
    if (sonar) this.opciones.alSonar?.('fin')
  }

  private fijarEstado(e: EstadoDictado): void {
    this.estado = e
    this.opciones.alCambiarEstado?.()
  }
}

// ── Alt+V: qué dictado alterna ────────────────────────────────────────────────

export interface ObjetivoDictado {
  /** ¿El elemento enfocado pertenece a este campo? */
  contiene: (el: Element | null) => boolean
  escuchando: () => boolean
  alternar: () => void
  /** Se usa cuando el foco no está en ningún campo con dictado (el asistente). */
  predeterminado?: boolean
  /** false si está deshabilitado (no se elige). */
  disponible?: () => boolean
}

const objetivos: ObjetivoDictado[] = []

export function registrarObjetivoDictado(o: ObjetivoDictado): () => void {
  objetivos.push(o)
  return () => {
    const i = objetivos.indexOf(o)
    if (i >= 0) objetivos.splice(i, 1)
  }
}

/**
 * Alt+V: el campo enfocado; si no, el que está escuchando (para pararlo); si no, el predeterminado más
 * reciente (el asistente). false si no hay ninguno.
 */
export function alternarDictadoEnfocado(activo: Element | null): boolean {
  const usable = (o: ObjetivoDictado) => o.disponible?.() !== false
  const elegido =
    objetivos.find((o) => usable(o) && o.contiene(activo)) ??
    objetivos.find((o) => o.escuchando()) ??
    [...objetivos].reverse().find((o) => usable(o) && o.predeterminado)
  if (!elegido) return false
  elegido.alternar()
  return true
}
