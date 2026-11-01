/**
 * Biblioteca de grooves MIDI por estilos (M): tipos del dominio. Lógica pura, sin acceso a disco.
 * Las posiciones de las notas están en beats (negras), igual que los clips del proyecto.
 */

export const TIPOS_GROOVE = ['groove', 'fill', 'intro', 'outro', 'transicion'] as const
export type TipoGroove = (typeof TIPOS_GROOVE)[number]

export type OrigenGroove = 'usuario' | 'catalogo'

export type CompasGroove = { numerador: number; denominador: number }

/** Metadatos tal como se escriben en `groove.json` / sidecar `<nombre>.json` (todo opcional). */
export type MetadatosCrudos = {
  id?: string
  nombre?: string
  estilo?: string
  subestilo?: string
  tempo?: number
  /** «4/4», «6/8», «12/8» o {numerador, denominador}. */
  compas?: string | CompasGroove
  compases?: number
  tipo?: string
  etiquetas?: string[]
  intensidad?: number
  autor?: string
  licencia?: string
  origen?: string
  revision?: number
}

/** Contenido de `groove.json` de una carpeta: valores por defecto para sus .mid y, opcionalmente, por archivo. */
export type ArchivoGrooveJson = MetadatosCrudos & { archivos?: Record<string, MetadatosCrudos> }

/** Metadatos completos y normalizados de un groove. */
export type MetadatosGroove = {
  /** Estable, distinto de la ruta (sobrevive a mover o renombrar el archivo). */
  id: string
  nombre: string
  estilo: string
  subestilo?: string
  tempo: number
  compas: CompasGroove
  compases: number
  tipo: TipoGroove
  etiquetas: string[]
  intensidad: number
  autor?: string
  licencia?: string
  origen: OrigenGroove
  /** Entero >= 1; sube cuando el catálogo cambia el contenido. */
  revision: number
  /** SHA-256 hex del .mid. */
  sha256: string
}

/** Entrada del índice local. `ruta` relativa a la carpeta de grooves, con «/». */
export type EntradaGroove = MetadatosGroove & {
  ruta: string
  notas: number
  favorito?: boolean
}

export type NotaGroove = { pitch: number; velocidad: number; inicio: number; duracion: number }

export type FiltroGrooves = {
  texto?: string
  estilo?: string
  subestilo?: string
  tipo?: TipoGroove | string
  /** «6/8». */
  compas?: string
  /** Debe tener todas. */
  etiquetas?: string[]
  intensidadMin?: number
  intensidadMax?: number
  soloFavoritos?: boolean
  origen?: OrigenGroove
}

export type NodoEstilo = { estilo: string; total: number; subestilos: Array<{ subestilo: string; total: number }> }

// ── Contrato para sincronización ─────────────────────────────────────────────

export type EntradaSync = { id: string; ruta: string; sha256: string; revision: number }

/** `.sync.json` en la raíz de la carpeta de grooves: solo lo que vino del catálogo. */
export type ArchivoSync = {
  version: 1
  /** Revisión global del catálogo recibido por última vez (opcional). */
  catalogoRevision?: number
  grooves: EntradaSync[]
}

export type DiferenciasSync = {
  descargar: EntradaSync[]
  actualizar: Array<{ anterior: EntradaSync; nuevo: EntradaSync }>
  borrar: EntradaSync[]
  sinCambios: string[]
}
