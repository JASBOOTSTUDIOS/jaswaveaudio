/**
 * Biblioteca de grooves (M): normalización de metadatos, inferencia desde el .mid y la ruta, filtros, árbol de
 * estilos, conversión a notas de clip y diferencias de sincronización. Todo puro y determinista.
 */

import {
  TIPOS_GROOVE,
  type ArchivoGrooveJson,
  type ArchivoSync,
  type CompasGroove,
  type DiferenciasSync,
  type EntradaGroove,
  type EntradaSync,
  type FiltroGrooves,
  type MetadatosCrudos,
  type MetadatosGroove,
  type NodoEstilo,
  type NotaGroove,
  type OrigenGroove,
  type TipoGroove,
} from './tipos'

// ── Utilidades ───────────────────────────────────────────────────────────────

export function slugGroove(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function validarCompas(n: number, d: number): CompasGroove | null {
  if (!Number.isInteger(n) || n < 1 || n > 32) return null
  if (![1, 2, 4, 8, 16, 32].includes(d)) return null
  return { numerador: n, denominador: d }
}

export function parsearCompas(valor: unknown): CompasGroove | null {
  if (typeof valor === 'string') {
    const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(valor)
    if (!m) return null
    return validarCompas(Number(m[1]), Number(m[2]))
  }
  if (valor && typeof valor === 'object') {
    const v = valor as Partial<CompasGroove>
    return validarCompas(Number(v.numerador), Number(v.denominador))
  }
  return null
}

export const compasATexto = (c: CompasGroove): string => `${c.numerador}/${c.denominador}`

/** Duración de un compás en beats (negras). */
export const beatsPorCompas = (c: CompasGroove): number => (c.numerador * 4) / c.denominador

export function normalizarTipo(valor: unknown): TipoGroove | null {
  if (typeof valor !== 'string') return null
  const v = slugGroove(valor)
  if (v === 'relleno') return 'fill'
  if (v === 'transition') return 'transicion'
  if ((TIPOS_GROOVE as readonly string[]).includes(v)) return v as TipoGroove
  return null
}

const limpiarTexto = (v: unknown, max = 80): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
  return t || undefined
}

export function normalizarEtiquetas(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out = new Set<string>()
  for (const e of v) {
    const t = typeof e === 'string' ? slugGroove(e).slice(0, 30) : ''
    if (t) out.add(t)
  }
  return [...out].slice(0, 20)
}

/** Nombre legible a partir del archivo: «01_verso-suave.mid» → «verso suave». */
export function nombreDesdeArchivo(archivo: string): string {
  const base = archivo.replace(/^.*[\\/]/, '').replace(/\.(mid|midi)$/i, '')
  return base.replace(/^\d+[\s._-]+/, '').replace(/[_-]+/g, ' ').trim() || base
}

/** Estilo y subestilo según la ruta relativa («Worship/6-8/archivo.mid»). */
export function estiloDesdeRuta(ruta: string): { estilo: string; subestilo?: string } {
  const partes = ruta.split(/[\\/]/).filter(Boolean)
  const carpetas = partes.slice(0, -1)
  return { estilo: carpetas[0] ?? 'Sin estilo', subestilo: carpetas.length > 1 ? carpetas.slice(1).join(' / ') : undefined }
}

// ── Inferencia y fusión de metadatos ─────────────────────────────────────────

export type DatosMidiGroove = {
  bpm: number
  compas?: CompasGroove
  /** Último final de nota, en beats. */
  duracionBeats: number
  notas: number
}

/** Metadatos deducibles del .mid y de la ruta (sin sidecar). */
export function inferirMetadatos(ruta: string, midi: DatosMidiGroove): MetadatosCrudos {
  const { estilo, subestilo } = estiloDesdeRuta(ruta)
  const compas = midi.compas ?? { numerador: 4, denominador: 4 }
  const bar = beatsPorCompas(compas)
  const compases = Math.max(1, Math.round(midi.duracionBeats / bar - 1e-6))
  const nombre = nombreDesdeArchivo(ruta)
  const tiene = (re: string) => new RegExp(`(^|[\\s_-])(${re})([\\s_-]|$)`, 'i').test(nombre)
  const tipo: TipoGroove = tiene('fill|relleno')
    ? 'fill'
    : tiene('intro')
      ? 'intro'
      : tiene('outro|final|ending')
        ? 'outro'
        : tiene('trans|transicion')
          ? 'transicion'
          : 'groove'
  return { nombre, estilo, subestilo, tempo: Math.round(midi.bpm), compas, compases, tipo }
}

function quitarIndefinidos<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {}
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>
}

/**
 * Fusiona (de menor a mayor prioridad): inferido < groove.json de la carpeta < entrada `archivos` < sidecar.
 * Valida y normaliza. Si nadie fija un id se usa un prefijo del SHA-256 (estable aunque se mueva el archivo).
 */
export function fusionarMetadatos(args: {
  ruta: string
  inferidos: MetadatosCrudos
  carpeta?: ArchivoGrooveJson
  sidecar?: MetadatosCrudos
  sha256: string
}): MetadatosGroove {
  const { carpeta, sidecar, inferidos, sha256, ruta } = args
  const porArchivo = carpeta?.archivos?.[ruta.replace(/^.*[\\/]/, '')]
  const defCarpeta: MetadatosCrudos = { ...(carpeta ?? {}) }
  delete (defCarpeta as ArchivoGrooveJson).archivos
  // `id` y `nombre` de la carpeta no se heredan (son por archivo).
  delete defCarpeta.id
  delete defCarpeta.nombre
  // El origen y la revisión solo los fija el propio archivo (así lo añadido por el usuario en una carpeta del catálogo sigue siendo suyo).
  delete defCarpeta.origen
  delete defCarpeta.revision
  const m: MetadatosCrudos = {
    ...inferidos,
    ...quitarIndefinidos(defCarpeta),
    ...quitarIndefinidos(porArchivo),
    ...quitarIndefinidos(sidecar),
  }
  const compas = parsearCompas(m.compas) ?? parsearCompas(inferidos.compas) ?? { numerador: 4, denominador: 4 }
  const tempo = Number(m.tempo)
  const origen: OrigenGroove = m.origen === 'catalogo' ? 'catalogo' : 'usuario'
  const revision = Number.isInteger(m.revision) && (m.revision as number) >= 1 ? (m.revision as number) : 1
  const idDado = limpiarTexto(m.id, 80) ? slugGroove(m.id as string) : ''
  return {
    id: idDado || `usr-${sha256.slice(0, 12)}`,
    nombre: limpiarTexto(m.nombre) ?? nombreDesdeArchivo(ruta),
    estilo: limpiarTexto(m.estilo, 60) ?? estiloDesdeRuta(ruta).estilo,
    subestilo: limpiarTexto(m.subestilo, 60),
    tempo: Number.isFinite(tempo) && tempo >= 20 && tempo <= 400 ? Math.round(tempo) : 100,
    compas,
    compases: Number.isInteger(m.compases) && (m.compases as number) >= 1 ? (m.compases as number) : (inferidos.compases ?? 1),
    tipo: normalizarTipo(m.tipo) ?? 'groove',
    etiquetas: normalizarEtiquetas(m.etiquetas),
    intensidad: Math.max(1, Math.min(5, Math.round(Number(m.intensidad) || 3))),
    autor: limpiarTexto(m.autor),
    licencia: limpiarTexto(m.licencia),
    origen,
    revision,
    sha256,
  }
}

/** Garantiza ids únicos en un índice (el repetido recibe un sufijo con su hash). */
export function desduplicarIds(entradas: EntradaGroove[]): EntradaGroove[] {
  const vistos = new Set<string>()
  return entradas.map((e) => {
    let id = e.id
    let n = 1
    while (vistos.has(id)) id = `${e.id}-${e.sha256.slice(0, 6)}${n > 1 ? `-${n}` : ''}`, n++
    vistos.add(id)
    return id === e.id ? e : { ...e, id }
  })
}

// ── Consulta ─────────────────────────────────────────────────────────────────

const plano = (s: string) => slugGroove(s).replace(/-/g, ' ')

export function filtrarGrooves(lista: readonly EntradaGroove[], f: FiltroGrooves = {}): EntradaGroove[] {
  const palabras = f.texto ? plano(f.texto).split(' ').filter(Boolean) : []
  const estilo = f.estilo ? plano(f.estilo) : ''
  const sub = f.subestilo ? plano(f.subestilo) : ''
  const tipo = f.tipo ? normalizarTipo(f.tipo) : null
  const compas = f.compas ? parsearCompas(f.compas) : null
  const etiquetas = normalizarEtiquetas(f.etiquetas ?? [])
  return lista.filter((g) => {
    if (estilo && plano(g.estilo) !== estilo) return false
    if (sub && plano(g.subestilo ?? '') !== sub) return false
    if (f.tipo && g.tipo !== tipo) return false
    if (f.compas && (!compas || g.compas.numerador !== compas.numerador || g.compas.denominador !== compas.denominador)) return false
    if (etiquetas.length && !etiquetas.every((e) => g.etiquetas.includes(e))) return false
    if (f.intensidadMin != null && g.intensidad < f.intensidadMin) return false
    if (f.intensidadMax != null && g.intensidad > f.intensidadMax) return false
    if (f.soloFavoritos && !g.favorito) return false
    if (f.origen && g.origen !== f.origen) return false
    if (palabras.length) {
      const pajar = plano([g.nombre, g.estilo, g.subestilo ?? '', g.tipo, compasATexto(g.compas), ...g.etiquetas].join(' '))
      if (!palabras.every((p) => pajar.includes(p))) return false
    }
    return true
  })
}

export function ordenarGrooves(lista: readonly EntradaGroove[]): EntradaGroove[] {
  return [...lista].sort(
    (a, b) =>
      a.estilo.localeCompare(b.estilo, 'es') ||
      (a.subestilo ?? '').localeCompare(b.subestilo ?? '', 'es') ||
      a.ruta.localeCompare(b.ruta, 'es'),
  )
}

export function arbolDeEstilos(lista: readonly EntradaGroove[]): NodoEstilo[] {
  const mapa = new Map<string, NodoEstilo>()
  for (const g of lista) {
    const n = mapa.get(g.estilo) ?? { estilo: g.estilo, total: 0, subestilos: [] }
    n.total++
    if (g.subestilo) {
      const s = n.subestilos.find((x) => x.subestilo === g.subestilo)
      if (s) s.total++
      else n.subestilos.push({ subestilo: g.subestilo, total: 1 })
    }
    mapa.set(g.estilo, n)
  }
  return [...mapa.values()].sort((a, b) => a.estilo.localeCompare(b.estilo, 'es'))
}

/** Busca por id exacto o, si no, elige uno que cumpla los criterios (para la IA; `semilla` reparte la elección). */
export function elegirGroove(
  lista: readonly EntradaGroove[],
  criterios: { grooveId?: string } & FiltroGrooves,
  semilla = 0,
): EntradaGroove | undefined {
  if (criterios.grooveId) return lista.find((g) => g.id === criterios.grooveId)
  const { grooveId: _omitido, ...f } = criterios
  const c = filtrarGrooves(lista, { tipo: 'groove', ...f })
  return c.length ? c[Math.abs(Math.trunc(semilla)) % c.length] : undefined
}

// ── Del groove a las notas de un clip ────────────────────────────────────────

export type OpcionesInsercion = {
  /** Compases totales del clip (se repite el patrón). Por defecto, los del groove. */
  compases?: number
  /** Fill para el final del clip (notas relativas a su inicio). */
  fillFinal?: { notas: readonly NotaGroove[]; compases: number }
  variacion?: 'ninguna' | 'ligera'
  semilla?: number
  /** Con `escalarAlTempo`, mantiene la duración real del groove en segundos al tempo del proyecto. */
  tempoProyecto?: number
  escalarAlTempo?: boolean
  compasProyecto?: CompasGroove
}

export type ResultadoInsercion = {
  notas: NotaGroove[]
  /** Duración total del clip en beats. */
  duracion: number
  compases: number
  aviso?: string
}

function prng(semilla: number) {
  let s = semilla >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * Repite el patrón del groove `compases` veces. Las notas quedan en beats (el tempo del proyecto manda).
 * Un compás con otra duración en beats que el del proyecto se avisa pero se respeta.
 */
export function construirNotasDeGroove(
  meta: Pick<MetadatosGroove, 'compas' | 'compases' | 'tempo'>,
  notas: readonly NotaGroove[],
  op: OpcionesInsercion = {},
): ResultadoInsercion {
  const bar = beatsPorCompas(meta.compas)
  const base = Math.max(1, meta.compases)
  const total = Math.max(1, Math.min(256, Math.round(op.compases ?? base)))
  const largoPatron = base * bar
  const rnd = prng(op.semilla ?? 1)
  const out: NotaGroove[] = []
  const conFill = op.fillFinal && total > 1 ? op.fillFinal : undefined
  const inicioFill = conFill ? (total - Math.min(Math.max(1, conFill.compases), total - 1)) * bar : Infinity
  for (let r = 0; r * largoPatron < total * bar - 1e-9; r++) {
    for (const n of notas) {
      const inicio = r * largoPatron + n.inicio
      if (inicio >= total * bar - 1e-9 || inicio >= inicioFill - 1e-9) continue
      out.push({ ...n, inicio, duracion: Math.min(n.duracion, total * bar - inicio) })
    }
  }
  if (conFill) for (const n of conFill.notas) out.push({ ...n, inicio: inicioFill + n.inicio })
  let res = out
  if (op.variacion === 'ligera') {
    res = out.map((n) => ({
      ...n,
      velocidad: Math.max(1, Math.min(127, Math.round(n.velocidad + (rnd() - 0.5) * 8))),
      inicio: Math.max(0, n.inicio + (rnd() - 0.5) * 0.012),
    }))
  }
  let duracion = total * bar
  if (op.escalarAlTempo && op.tempoProyecto && op.tempoProyecto > 0 && meta.tempo > 0) {
    const f = op.tempoProyecto / meta.tempo
    res = res.map((n) => ({ ...n, inicio: n.inicio * f, duracion: n.duracion * f }))
    duracion *= f
  }
  res.sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
  let aviso: string | undefined
  if (op.compasProyecto && Math.abs(beatsPorCompas(op.compasProyecto) - bar) > 1e-9) {
    aviso = `El groove es ${compasATexto(meta.compas)} y el proyecto ${compasATexto(op.compasProyecto)}: los compases no coinciden con la cuadrícula del proyecto.`
  }
  return { notas: res, duracion, compases: total, aviso }
}

// ── Sincronización ───────────────────────────────────────────────────────────

/** Extrae del índice local lo registrable en `.sync.json` (solo origen «catalogo»). */
export function aEntradasSync(lista: readonly EntradaGroove[]): EntradaSync[] {
  return lista
    .filter((g) => g.origen === 'catalogo')
    .map((g) => ({ id: g.id, ruta: g.ruta, sha256: g.sha256, revision: g.revision }))
}

export function normalizarArchivoSync(crudo: unknown): ArchivoSync {
  const c = (crudo ?? {}) as Partial<ArchivoSync>
  const grooves = Array.isArray(c.grooves) ? c.grooves : []
  return {
    version: 1,
    catalogoRevision: typeof c.catalogoRevision === 'number' ? c.catalogoRevision : undefined,
    grooves: grooves
      .filter((e): e is EntradaSync => !!e && typeof e.id === 'string' && typeof e.ruta === 'string' && typeof e.sha256 === 'string')
      .map((e) => ({ id: e.id, ruta: e.ruta.replace(/\\/g, '/'), sha256: e.sha256, revision: Number.isInteger(e.revision) ? e.revision : 1 })),
  }
}

/**
 * Qué hacer para que lo de origen «catalogo» coincida con el índice remoto. Nunca habla de lo del usuario:
 * `indiceLocal` solo contiene entradas del catálogo (.sync.json). `rutasOcupadas` son rutas de archivos del
 * usuario: si una descarga cae en una, se desvía a «<nombre>-catalogo.mid» para no pisarla.
 */
export function aplicarDiferencias(
  indiceLocal: { grooves: readonly EntradaSync[] },
  indiceRemoto: { grooves: readonly EntradaSync[] },
  opciones: { rutasOcupadas?: Iterable<string> } = {},
): DiferenciasSync {
  const local = new Map(indiceLocal.grooves.map((e) => [e.id, e]))
  const remoto = new Map(indiceRemoto.grooves.map((e) => [e.id, e]))
  const ocupadas = new Set([...(opciones.rutasOcupadas ?? [])].map((r) => r.toLowerCase()))
  const libre = (ruta: string): string => {
    let r = ruta
    let n = 1
    while (ocupadas.has(r.toLowerCase())) {
      r = ruta.replace(/(\.[^./]+)?$/, `-catalogo${n > 1 ? n : ''}$1`)
      n++
    }
    return r
  }
  const res: DiferenciasSync = { descargar: [], actualizar: [], borrar: [], sinCambios: [] }
  for (const r of indiceRemoto.grooves) {
    const l = local.get(r.id)
    if (!l) res.descargar.push({ ...r, ruta: libre(r.ruta) })
    else if (r.revision > l.revision || r.sha256 !== l.sha256 || r.ruta !== l.ruta) res.actualizar.push({ anterior: l, nuevo: r })
    else res.sinCambios.push(r.id)
  }
  for (const l of indiceLocal.grooves) if (!remoto.has(l.id)) res.borrar.push(l)
  return res
}
