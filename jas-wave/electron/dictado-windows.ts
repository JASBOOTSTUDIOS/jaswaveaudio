/**
 * G7: sesión de dictado con el reconocedor local de Windows (System.Speech) en un PowerShell hijo.
 * Una sola sesión a la vez: iniciar otra detiene la anterior. Los eventos (parcial/final/error/fin) van al
 * renderer que la pidió; el script del reconocedor y el parseo están en `dictado-windows-parser.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { argumentosPowerShell, crearLectorEventos, culturaValida, scriptReconocedorWindows, type EventoDictado } from './dictado-windows-parser'

export type { EventoDictado } from './dictado-windows-parser'

/** Tiempo máximo hasta «listo» (PowerShell + carga de System.Speech tardan 2–5 s en frío). */
const ESPERA_LISTO_MS = 15_000

type Lanzador = (args: string[]) => ChildProcess

const lanzarPowerShell: Lanzador = (args) =>
  spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

export type ResultadoInicioDictado = { ok: true; cultura?: string; motor?: string } | { ok: false; codigo: string; error: string }

export class SesionDictadoWindows {
  private hijo: ChildProcess | null = null
  private alEvento: ((e: EventoDictado) => void) | null = null

  constructor(private readonly lanzar: Lanzador = lanzarPowerShell, private readonly plataforma: string = process.platform) {}

  /** Solo hay reconocedor local en Windows. */
  get soportado(): boolean {
    return this.plataforma === 'win32'
  }

  get activa(): boolean {
    return this.hijo != null
  }

  /** Arranca el reconocedor; resuelve cuando escucha («listo») o con el error que lo impidió. */
  iniciar(cultura: unknown, alEvento: (e: EventoDictado) => void): Promise<ResultadoInicioDictado> {
    if (!this.soportado) return Promise.resolve({ ok: false, codigo: 'no-soportado', error: 'El dictado local solo está disponible en Windows' })
    this.detener()
    let hijo: ChildProcess
    try {
      hijo = this.lanzar(argumentosPowerShell(scriptReconocedorWindows({ cultura: culturaValida(cultura), pidPadre: process.pid })))
    } catch (err) {
      return Promise.resolve({ ok: false, codigo: 'motor', error: err instanceof Error ? err.message : String(err) })
    }
    this.hijo = hijo
    this.alEvento = alEvento

    return new Promise<ResultadoInicioDictado>((resolve) => {
      let resuelto = false
      const resolver = (r: ResultadoInicioDictado) => {
        if (resuelto) return
        resuelto = true
        clearTimeout(temporizador)
        resolve(r)
      }
      const temporizador = setTimeout(() => {
        resolver({ ok: false, codigo: 'tiempo', error: 'El reconocedor de voz de Windows no respondió a tiempo' })
        this.detener()
      }, ESPERA_LISTO_MS)

      const lector = crearLectorEventos((ev) => {
        if (this.hijo !== hijo) return
        if (ev.tipo === 'listo') {
          resolver({ ok: true, ...(ev.cultura ? { cultura: ev.cultura } : {}), ...(ev.motor ? { motor: ev.motor } : {}) })
          return
        }
        if (!resuelto && ev.tipo === 'error') {
          resolver({ ok: false, codigo: ev.codigo, error: ev.mensaje })
          return
        }
        if (ev.tipo === 'fin') {
          this.cerrarSesion()
          return
        }
        this.alEvento?.(ev)
      })
      hijo.stdout?.setEncoding('utf8')
      hijo.stdout?.on('data', (d: string) => lector.empujar(d))
      hijo.on('error', (err) => {
        resolver({ ok: false, codigo: 'motor', error: err.message })
        if (this.hijo === hijo) this.cerrarSesion()
      })
      hijo.on('exit', () => {
        lector.cerrar()
        resolver({ ok: false, codigo: 'motor', error: 'El reconocedor de voz de Windows se cerró al arrancar' })
        // Salida inesperada (no pedida con detener): avisar al renderer de que ya no escucha.
        if (this.hijo === hijo) this.cerrarSesion()
      })
    })
  }

  /** Para el reconocedor (matar el proceso libera el micrófono al instante). */
  detener(): void {
    const hijo = this.hijo
    if (!hijo) return
    this.cerrarSesion()
    try {
      hijo.kill()
    } catch {
      /* ya había salido */
    }
  }

  private cerrarSesion(): void {
    const alEvento = this.alEvento
    this.hijo = null
    this.alEvento = null
    alEvento?.({ tipo: 'fin' })
  }
}
