/**
 * Almacén de producciones de la banda (plan Q): diario JSON-lines por producción y puntos de control del proyecto.
 *
 *   <producciones>/<proyectoId>/<runId>.jsonl        diario (append + fsync); `JASWAVE_PRODUCCIONES_DIR` lo cambia
 *   <recuperacion>/<proyectoId>/punto-{0,1,2}.json   3 copias rotativas del proyecto; `JASWAVE_RECUPERACION_DIR` lo cambia
 *
 * Por defecto cuelgan de `%APPDATA%\JasWave\`. El renderer pasa solo identificadores (`[A-Za-z0-9_-]{1,80}`), nunca
 * rutas: todo destino se construye aquí y se comprueba que queda dentro de la raíz.
 *
 * Este módulo es deliberadamente «tonto»: guarda y devuelve texto. Interpretar el diario (estado, reanudación) lo hace
 * el renderer con `ai-harness/src/agente/diario.ts`. Solo reconoce lo mínimo para el cierre de emergencia: qué
 * producciones siguen abiertas, para marcarlas como interrumpidas de forma síncrona.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

const RE_ID = /^[A-Za-z0-9_-]{1,80}$/
export const COPIAS_PUNTO = 3
export const PRODUCCIONES_A_CONSERVAR = 10
/** Un candado más viejo que esto se considera abandonado (quien lo tomó murió). */
export const CANDADO_CADUCA_MS = 5 * 60_000
/** Tope de un diario y de un punto de control (protege el disco ante un bucle). */
export const MAX_BYTES_DIARIO = 20 * 1024 * 1024
export const MAX_BYTES_PUNTO = 256 * 1024 * 1024

export function idValido(id: unknown): id is string {
  return typeof id === 'string' && RE_ID.test(id)
}

export function carpetasProducciones(env: NodeJS.ProcessEnv, appData: string): { producciones: string; recuperacion: string } {
  const raiz = path.join(appData, 'JasWave')
  return {
    producciones: env.JASWAVE_PRODUCCIONES_DIR?.trim() || path.join(raiz, 'producciones'),
    recuperacion: env.JASWAVE_RECUPERACION_DIR?.trim() || path.join(raiz, 'recuperacion'),
  }
}

export type CabeceraPunto = { v: 1; seq: number; t: number; que: string; huella: string; bytes: number }
export type PuntoCargado = { proyecto: string; cabecera: CabeceraPunto; /** Se usó una copia anterior porque la última estaba dañada. */ usoCopiaAnterior: boolean; descartadas: number }

export const sha256 = (texto: string | Buffer): string => crypto.createHash('sha256').update(texto).digest('hex')

/** Escritura atómica síncrona: temporal + fsync + renombrado (también sirve en el cierre de emergencia). */
export function escribirAtomicoSync(destino: string, datos: string | Buffer): void {
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const tmp = `${destino}.${process.pid}.${Date.now().toString(36)}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, datos)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    fs.renameSync(tmp, destino)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

const TERMINAL = /"k":"estado","estado":"(completada|detenida|interrumpida)"/

export class AlmacenProducciones {
  /** Producciones abiertas en este proceso (sin estado terminal): `proyectoId/runId`. */
  private readonly activas = new Map<string, { proyectoId: string; runId: string }>()
  private readonly candados = new Map<string, string>()

  constructor(
    readonly raizProducciones: string,
    readonly raizRecuperacion: string,
  ) {}

  private dentro(raiz: string, ...partes: string[]): string {
    for (const p of partes) if (!idValido(p)) throw new Error('Identificador no válido')
    const destino = path.resolve(raiz, ...partes)
    if (!destino.startsWith(path.resolve(raiz) + path.sep)) throw new Error('Ruta no válida')
    return destino
  }
  private carpetaProyecto(proyectoId: string) {
    return this.dentro(this.raizProducciones, proyectoId)
  }
  private archivoDiario(proyectoId: string, runId: string) {
    return `${this.dentro(this.raizProducciones, proyectoId, runId)}.jsonl`
  }

  // ── Diario ────────────────────────────────────────────────────────────────

  /** Abre una producción: crea su carpeta, registra que sigue abierta y limpia las más antiguas. */
  iniciar(proyectoId: string, runId: string): void {
    fs.mkdirSync(this.carpetaProyecto(proyectoId), { recursive: true })
    this.activas.set(`${proyectoId}/${runId}`, { proyectoId, runId })
    this.podar(proyectoId, runId)
  }

  /** Añade líneas al diario con fsync. Devuelve false si el diario superó su tope. */
  anexar(proyectoId: string, runId: string, texto: string): boolean {
    const archivo = this.archivoDiario(proyectoId, runId)
    fs.mkdirSync(path.dirname(archivo), { recursive: true })
    let tam = 0
    try {
      tam = fs.statSync(archivo).size
    } catch {
      /* nuevo */
    }
    if (tam > MAX_BYTES_DIARIO) return false
    const fd = fs.openSync(archivo, 'a')
    try {
      fs.writeSync(fd, texto.endsWith('\n') ? texto : `${texto}\n`)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    if (TERMINAL.test(texto)) this.activas.delete(`${proyectoId}/${runId}`)
    return true
  }

  leer(proyectoId: string, runId: string): string | null {
    try {
      return fs.readFileSync(this.archivoDiario(proyectoId, runId), 'utf-8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /** Producciones del proyecto, la más reciente primero. */
  listar(proyectoId: string): Array<{ runId: string; modificado: number; bytes: number }> {
    const dir = this.carpetaProyecto(proyectoId)
    let nombres: string[] = []
    try {
      nombres = fs.readdirSync(dir)
    } catch {
      return []
    }
    return nombres
      .filter((n) => n.endsWith('.jsonl') && idValido(n.slice(0, -6)))
      .map((n) => {
        const st = fs.statSync(path.join(dir, n))
        return { runId: n.slice(0, -6), modificado: st.mtimeMs, bytes: st.size }
      })
      .sort((a, b) => b.modificado - a.modificado)
  }

  /** Conserva las últimas `PRODUCCIONES_A_CONSERVAR` producciones del proyecto (nunca borra `salvo`). */
  podar(proyectoId: string, salvo?: string): number {
    const lista = this.listar(proyectoId)
    let borradas = 0
    for (const x of lista.slice(PRODUCCIONES_A_CONSERVAR)) {
      if (x.runId === salvo || this.activas.has(`${proyectoId}/${x.runId}`)) continue
      try {
        fs.rmSync(this.archivoDiario(proyectoId, x.runId), { force: true })
        borradas++
      } catch {
        /* en uso: se limpiará la próxima vez */
      }
    }
    return borradas
  }

  /** Cierre de emergencia (síncrono): todo lo que siga abierto queda marcado como interrumpido. */
  marcarInterrumpidas(motivo: string, ahora = Date.now()): number {
    let n = 0
    for (const { proyectoId, runId } of [...this.activas.values()]) {
      try {
        const linea = JSON.stringify({ v: 1, t: ahora, k: 'estado', estado: 'interrumpida', motivo })
        this.anexar(proyectoId, runId, linea)
        n++
      } catch {
        /* disco lleno o carpeta borrada: no hay más que hacer */
      }
    }
    return n
  }

  hayActivas(): boolean {
    return this.activas.size > 0
  }

  // ── Candado de reanudación ────────────────────────────────────────────────

  /**
   * Quien reanuda una producción toma su candado: dos ventanas o instancias no la reanudan a la vez. Devuelve un
   * testigo para soltarlo, o null si otro lo tiene (y no está abandonado).
   */
  tomarCandado(proyectoId: string, runId: string, ahora = Date.now()): string | null {
    const archivo = `${this.dentro(this.raizProducciones, proyectoId, runId)}.lock`
    fs.mkdirSync(path.dirname(archivo), { recursive: true })
    const testigo = crypto.randomBytes(8).toString('hex')
    const contenido = JSON.stringify({ pid: process.pid, t: ahora, testigo })
    for (let intento = 0; intento < 2; intento++) {
      try {
        const fd = fs.openSync(archivo, 'wx')
        try {
          fs.writeSync(fd, contenido)
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
        this.candados.set(archivo, testigo)
        return testigo
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        if (!this.candadoAbandonado(archivo, ahora)) return null
        fs.rmSync(archivo, { force: true })
      }
    }
    return null
  }

  private candadoAbandonado(archivo: string, ahora: number): boolean {
    try {
      const c = JSON.parse(fs.readFileSync(archivo, 'utf-8')) as { pid?: number; t?: number }
      if (typeof c.t === 'number' && ahora - c.t > CANDADO_CADUCA_MS) return true
      if (typeof c.pid === 'number' && c.pid !== process.pid) {
        try {
          process.kill(c.pid, 0)
        } catch (e) {
          return (e as NodeJS.ErrnoException).code === 'ESRCH'
        }
      }
      return false
    } catch {
      return true // ilegible: abandonado
    }
  }

  soltarCandado(proyectoId: string, runId: string, testigo: string): boolean {
    const archivo = `${this.dentro(this.raizProducciones, proyectoId, runId)}.lock`
    if (this.candados.get(archivo) !== testigo) return false
    this.candados.delete(archivo)
    fs.rmSync(archivo, { force: true })
    return true
  }

  // ── Puntos de control del proyecto ───────────────────────────────────────

  private carpetaRecuperacion(proyectoId: string) {
    return this.dentro(this.raizRecuperacion, proyectoId)
  }

  private cabeceras(proyectoId: string): Array<{ archivo: string; cabecera: CabeceraPunto | null }> {
    const dir = this.carpetaRecuperacion(proyectoId)
    const out: Array<{ archivo: string; cabecera: CabeceraPunto | null }> = []
    for (let i = 0; i < COPIAS_PUNTO; i++) {
      const archivo = path.join(dir, `punto-${i}.json`)
      let cabecera: CabeceraPunto | null = null
      try {
        const texto = fs.readFileSync(archivo, 'utf-8')
        const c = JSON.parse(texto.slice(0, texto.indexOf('\n'))) as CabeceraPunto
        if (c && c.v === 1 && Number.isFinite(c.seq)) cabecera = c
      } catch {
        /* no existe o dañada */
      }
      out.push({ archivo, cabecera })
    }
    return out
  }

  /** Guarda una copia del proyecto (atómica) en la siguiente de las 3 ranuras. Devuelve su huella SHA-256. */
  guardarPunto(proyectoId: string, proyectoJson: string, que: string, ahora = Date.now()): { huella: string; archivo: string; seq: number } {
    if (Buffer.byteLength(proyectoJson) > MAX_BYTES_PUNTO) throw new Error('El proyecto es demasiado grande para un punto de control')
    const existentes = this.cabeceras(proyectoId)
    const seq = existentes.reduce((m, x) => Math.max(m, x.cabecera?.seq ?? 0), 0) + 1
    const huella = sha256(proyectoJson)
    const cabecera: CabeceraPunto = { v: 1, seq, t: ahora, que: String(que).slice(0, 120), huella, bytes: Buffer.byteLength(proyectoJson) }
    const archivo = path.join(this.carpetaRecuperacion(proyectoId), `punto-${seq % COPIAS_PUNTO}.json`)
    escribirAtomicoSync(archivo, `${JSON.stringify(cabecera)}\n${proyectoJson}`)
    return { huella, archivo, seq }
  }

  /** La copia más reciente que se pueda leer, con JSON válido y huella correcta; si no, la anterior, y así. */
  cargarPunto(proyectoId: string): PuntoCargado | null {
    const orden = this.cabeceras(proyectoId)
      .filter((x) => x.cabecera)
      .sort((a, b) => b.cabecera!.seq - a.cabecera!.seq)
    // Una ranura ilegible (cabecera rota) también cuenta como descartada si había algo en disco.
    let descartadas = this.cabeceras(proyectoId).filter((x) => !x.cabecera && fs.existsSync(x.archivo)).length
    for (const x of orden) {
      try {
        const texto = fs.readFileSync(x.archivo, 'utf-8')
        const cuerpo = texto.slice(texto.indexOf('\n') + 1)
        if (sha256(cuerpo) !== x.cabecera!.huella) throw new Error('huella distinta')
        JSON.parse(cuerpo)
        return { proyecto: cuerpo, cabecera: x.cabecera!, usoCopiaAnterior: descartadas > 0, descartadas }
      } catch {
        descartadas++
      }
    }
    return null
  }

  /** Fecha del último punto de control válido (sin leer los cuerpos enteros salvo el último). */
  ultimoPunto(proyectoId: string): CabeceraPunto | null {
    return this.cargarPunto(proyectoId)?.cabecera ?? null
  }
}
