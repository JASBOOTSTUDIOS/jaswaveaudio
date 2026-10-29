/**
 * Detección automática de hasta dónde llega el contenido del proyecto, para que un export
 * no termine antes de la música ni arrastre minutos de silencio al final.
 *
 * Unidades: los clips guardan `inicio`/`duracion` en beats; el resultado se da en beats y segundos
 * con el tempo del proyecto (tempo constante, igual que la reproducción).
 */

type ClipFin = {
  inicio?: number
  duracion?: number
  /** Clip silenciado: no suena, no alarga el export. */
  silenciado?: boolean
}

type PistaFin = {
  id: string
  silenciada?: boolean
  soloActiva?: boolean
  clips?: ClipFin[] | null
}

export type ProyectoFin = {
  bpm?: { valor?: number } | null
  tracks?: PistaFin[] | null
}

export type FinProyecto = {
  /** true si no hay ningún clip audible: no hay nada que exportar. */
  vacio: boolean
  /** Primer instante con contenido audible (beats / segundos). */
  inicioBeats: number
  inicioSegundos: number
  /** Final del último clip audible (beats / segundos). */
  finBeats: number
  finSegundos: number
  /** Pistas que cuentan (respeta mute y solo). */
  pistasConContenido: string[]
}

/** Cola máxima que se renderiza tras el último clip para no cortar reverbs y delays. */
export const COLA_MAXIMA_SEGUNDOS = 10
/** Umbral bajo el que la cola se considera silencio (dBFS) y cuánto debe durar ese silencio. */
export const UMBRAL_SILENCIO_DB = -60
export const SILENCIO_MINIMO_SEGUNDOS = 0.5

function bpmDe(p: ProyectoFin): number {
  const v = Number(p.bpm?.valor)
  return Number.isFinite(v) && v > 0 ? v : 120
}

/**
 * Fin del contenido audible. Respeta solo (si hay pistas en solo, solo cuentan esas) y mute
 * de pista y de clip. La región visible del clip manda (no las notas que caigan fuera de él).
 */
export function detectarFinProyecto(proyecto: ProyectoFin): FinProyecto {
  const bpm = bpmDe(proyecto)
  const pistas = proyecto.tracks ?? []
  const haySolo = pistas.some((t) => t.soloActiva)
  let inicio = Number.POSITIVE_INFINITY
  let fin = 0
  const conContenido: string[] = []
  for (const t of pistas) {
    if (haySolo ? !t.soloActiva : t.silenciada) continue
    let suena = false
    for (const c of t.clips ?? []) {
      if (c.silenciado) continue
      const ini = Number(c.inicio ?? 0)
      const dur = Number(c.duracion ?? 0)
      if (!Number.isFinite(ini) || !Number.isFinite(dur) || dur <= 0) continue
      inicio = Math.min(inicio, Math.max(0, ini))
      fin = Math.max(fin, ini + dur)
      suena = true
    }
    if (suena) conContenido.push(t.id)
  }
  const vacio = conContenido.length === 0
  const aSeg = (beats: number) => (beats * 60) / bpm
  const inicioBeats = vacio ? 0 : inicio
  return {
    vacio,
    inicioBeats,
    inicioSegundos: aSeg(inicioBeats),
    finBeats: fin,
    finSegundos: aSeg(fin),
    pistasConContenido: conContenido,
  }
}

/**
 * Último frame que conserva un render con cola: tras `finContenidoFrame` se busca el último
 * instante por encima del umbral y se le suman `silencioMinimo` segundos. Nunca recorta antes
 * del final del contenido ni pasa del largo renderizado.
 */
export function framesConCola(
  canales: ArrayLike<number>[],
  sampleRate: number,
  finContenidoFrame: number,
  opts?: { umbralDb?: number; silencioMinimoSegundos?: number },
): number {
  const largo = canales[0]?.length ?? 0
  const desde = Math.max(0, Math.min(largo, Math.floor(finContenidoFrame)))
  const umbral = Math.pow(10, (opts?.umbralDb ?? UMBRAL_SILENCIO_DB) / 20)
  let ultimoAudible = desde
  for (let i = largo - 1; i >= desde; i--) {
    let audible = false
    for (const ch of canales) {
      if (Math.abs(Number(ch[i] ?? 0)) > umbral) {
        audible = true
        break
      }
    }
    if (audible) {
      ultimoAudible = i + 1
      break
    }
  }
  const margen = Math.round((opts?.silencioMinimoSegundos ?? SILENCIO_MINIMO_SEGUNDOS) * sampleRate)
  return Math.min(largo, Math.max(desde, ultimoAudible + (ultimoAudible > desde ? margen : 0)))
}

/** "3:42" / "1:02:05" para mostrar duraciones al usuario. */
export function formatearDuracion(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "3:42", "03:42.5", "1:02:05" o segundos sueltos ("222") → segundos. null si no se entiende. */
export function parsearDuracion(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (!t) return null
  const partes = t.split(':')
  if (partes.length > 3) return null
  let total = 0
  for (const p of partes) {
    if (!/^\d+(\.\d+)?$/.test(p)) return null
    total = total * 60 + Number(p)
  }
  return Number.isFinite(total) ? total : null
}
