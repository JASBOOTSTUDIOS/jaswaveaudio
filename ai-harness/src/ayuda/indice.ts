import type { FichaAyuda, NivelFicha, TipoFicha } from './tipos'
import { formatearErrores, validarFichas } from './validacion'

export const normalizarAyuda = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'en', 'y', 'o', 'a', 'que', 'para', 'por', 'con', 'se', 'es', 'como', 'mi', 'me', 'al', 'lo', 'su', 'hago', 'hacer', 'puedo', 'donde', 'esta', 'esto'])

/** Raíz tolerante a plurales (mezcladores, buses). */
export function raizAyuda(p: string): string {
  if (p.length > 4 && p.endsWith('es')) return p.slice(0, -2)
  if (p.length > 3 && p.endsWith('s')) return p.slice(0, -1)
  return p
}

export function palabrasAyuda(texto: string): string[] {
  return normalizarAyuda(texto)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(raizAyuda)
}

type Entrada = { ficha: FichaAyuda; titulo: Set<string>; etiquetas: Set<string>; resumen: Set<string>; cuerpo: Set<string>; tituloNorm: string }

export type IndiceAyuda = { entradas: Entrada[]; porId: Map<string, FichaAyuda> }

/** Construye el índice. Lanza con errores legibles si el esquema no es válido. */
export function crearIndiceAyuda(fichas: readonly FichaAyuda[]): IndiceAyuda {
  const errores = validarFichas(fichas)
  if (errores.length) throw new Error(`Fichas de ayuda no válidas:\n${formatearErrores(errores)}`)
  const entradas = fichas.map<Entrada>((f) => ({
    ficha: f,
    titulo: new Set(palabrasAyuda(f.titulo)),
    etiquetas: new Set((f.etiquetas ?? []).flatMap(palabrasAyuda)),
    resumen: new Set(palabrasAyuda(f.resumen)),
    cuerpo: new Set(palabrasAyuda([...(f.pasos ?? []), ...(f.controles ?? []).map((c) => `${c.etiqueta} ${c.descripcion ?? ''}`)].join(' '))),
    tituloNorm: normalizarAyuda(f.titulo),
  }))
  return { entradas, porId: new Map(fichas.map((f) => [f.id, f])) }
}

export type OpcionesBusqueda = { tipo?: TipoFicha; nivel?: NivelFicha; max?: number }
export type ResultadoBusqueda = { ficha: FichaAyuda; puntos: number }

const PESOS = { titulo: 5, etiquetas: 4, resumen: 2, cuerpo: 1 } as const

/** Búsqueda por palabras (sin tildes ni mayúsculas): título×5, etiquetas×4, resumen×2, pasos/controles×1. */
export function buscarAyuda(indice: IndiceAyuda, consulta: string, o: OpcionesBusqueda = {}): ResultadoBusqueda[] {
  const q = [...new Set(palabrasAyuda(consulta))]
  const qNorm = normalizarAyuda(consulta)
  if (!q.length) return []
  const res: ResultadoBusqueda[] = []
  for (const e of indice.entradas) {
    if (o.tipo && e.ficha.tipo !== o.tipo) continue
    if (o.nivel && e.ficha.nivel !== o.nivel) continue
    let puntos = 0
    let aciertos = 0
    for (const w of q) {
      let mejor = 0
      for (const campo of ['titulo', 'etiquetas', 'resumen', 'cuerpo'] as const) {
        const set = e[campo]
        if (set.has(w)) mejor = Math.max(mejor, PESOS[campo])
        else if (w.length >= 4 && [...set].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) mejor = Math.max(mejor, PESOS[campo] * 0.5)
      }
      if (mejor) aciertos++
      puntos += mejor
    }
    if (!puntos) continue
    puntos += (aciertos / q.length) * 2
    if (qNorm.length >= 3 && e.tituloNorm === qNorm) puntos += 10
    res.push({ ficha: e.ficha, puntos })
  }
  res.sort((a, b) => b.puntos - a.puntos || a.ficha.id.localeCompare(b.ficha.id))
  return res.slice(0, o.max ?? 5)
}
