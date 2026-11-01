/**
 * Guía de interfaz (U-maestra F4). SOLO cambia la interfaz (resaltar / avanzar pasos); nunca el proyecto.
 *
 * Seguridad: el resaltado NO acepta selectores libres. Solo ids de ayuda registrados (`registrarIdsAyuda`
 * o la tabla de serie) con forma `[a-z0-9][a-z0-9:._-]{0,63}`; el selector CSS lo construye este módulo.
 * Lógica pura y sin dependencias de React ni del DOM (testeable en node:test).
 */

export const MAX_TEXTO_GUIA = 140
export const DURACION_RESALTADO_DEFECTO_MS = 12_000
const RE_ID_AYUDA = /^[a-z0-9][a-z0-9:._-]{0,63}$/

/** Paneles del núcleo y de módulos: se resaltan con el fallback `data-tool-viewport`. */
const PANELES_DE_SERIE = [
  'arrange', 'mixer', 'library', 'track-detail', 'meters', 'routing', 'instruments', 'fx-chain', 'automation',
  'plugin-editor', 'midi-map', 'midi-zones', 'grooves', 'piano-roll', 'terminal', 'settings', 'project-files',
  'cuenta', 'modulos', 'coproducer', 'progress', 'banda-virtual', 'docs', 'docs-explorer', 'midi-md', 'score-editor',
] as const

/** Controles con `data-testid` ya existentes en el código (ver plan §0.5). */
const TESTIDS_DE_SERIE = ['mi-estilo-panel', 'mi-estilo-analizar', 'mi-estilo-nombre', 'mi-estilo-guardar'] as const

export interface DestinoAyuda {
  id: string
  /** Selectores construidos por el host (nunca vienen del modelo), por orden de preferencia. */
  selectores: string[]
}

const registro = new Map<string, DestinoAyuda>()

function sembrar(): void {
  registro.clear()
  for (const id of PANELES_DE_SERIE) {
    registro.set(id, { id, selectores: [`[data-ayuda="${id}"]`, `[data-testid="${id}"]`, `[data-tool-viewport="${id}"]`] })
    registro.set(`panel:${id}`, { id: `panel:${id}`, selectores: [`[data-ayuda="panel:${id}"]`, `[data-tool-viewport="${id}"]`] })
  }
  for (const id of TESTIDS_DE_SERIE) {
    registro.set(id, { id, selectores: [`[data-ayuda="${id}"]`, `[data-testid="${id}"]`] })
  }
}
sembrar()

export function idAyudaValido(id: unknown): id is string {
  return typeof id === 'string' && RE_ID_AYUDA.test(id)
}

/**
 * Registra ids de ayuda adicionales (p. ej. los de la KB generada). `toolViewport` los liga a un panel
 * como fallback. Los ids inválidos se ignoran y se devuelven en `rechazados`.
 */
export function registrarIdsAyuda(
  ids: Array<string | { id: string; toolViewport?: string }>,
): { registrados: string[]; rechazados: string[] } {
  const registrados: string[] = []
  const rechazados: string[] = []
  for (const e of ids) {
    const id = typeof e === 'string' ? e : e.id
    const tv = typeof e === 'string' ? undefined : e.toolViewport
    if (!idAyudaValido(id) || (tv !== undefined && !idAyudaValido(tv))) {
      rechazados.push(String(id))
      continue
    }
    const sel = [`[data-ayuda="${id}"]`, `[data-testid="${id}"]`]
    if (tv) sel.push(`[data-tool-viewport="${tv}"]`)
    registro.set(id, { id, selectores: sel })
    registrados.push(id)
  }
  return { registrados, rechazados }
}

export function reiniciarRegistroAyuda(): void {
  sembrar()
}

/** Resuelve un id de ayuda a sus selectores. `null` si no está registrado (incluye cualquier selector libre). */
export function resolverIdAyuda(id: unknown): DestinoAyuda | null {
  if (!idAyudaValido(id)) return null
  return registro.get(id) ?? null
}

export function listarIdsAyuda(): string[] {
  return [...registro.keys()].sort()
}

/** Busca el primer elemento que cumpla algún selector del destino (consulta inyectada para poder probarlo). */
export function localizarElemento<T>(destino: DestinoAyuda, consulta: (selector: string) => T | null): T | null {
  for (const s of destino.selectores) {
    const el = consulta(s)
    if (el) return el
  }
  return null
}

// ─── Pasos y condiciones cerradas ────────────────────────────────────────────────

export type HastaQue =
  | { manual: true }
  | { evento: 'tool-abierta'; id: string }
  | { clic: string }
  | { estado: string }

export interface PasoGuia {
  texto: string
  /** Id de pantalla a abrir (lo resuelve `abrir-pantalla.ts`). */
  abrir?: string
  /** Id de ayuda a resaltar. */
  resaltar?: string
  hastaQue?: HastaQue
}

export type SenalGuia =
  | { tipo: 'tool-abierta'; id: string }
  | { tipo: 'clic'; id: string }
  | { tipo: 'manual' }

export interface ResaltadoActivo {
  id: string
  texto: string
  desdeMs: number
  duracionMs: number
}

export interface EstadoGuia {
  resaltado: ResaltadoActivo | null
  pasos: PasoGuia[]
  /** Índice del paso actual; -1 si no hay guía. */
  paso: number
  pausada: boolean
  terminada: boolean
}

const VACIO: EstadoGuia = { resaltado: null, pasos: [], paso: -1, pausada: false, terminada: false }

export function recortarTexto(t: unknown): string {
  const s = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : ''
  return s.length > MAX_TEXTO_GUIA ? s.slice(0, MAX_TEXTO_GUIA - 1) + '…' : s
}

const PREDICADOS = new Map<string, () => boolean>()
/** Catálogo cerrado de predicados de estado (lo registra el host; el modelo solo elige el nombre). */
export function registrarPredicadoEstado(nombre: string, fn: () => boolean): void {
  if (idAyudaValido(nombre)) PREDICADOS.set(nombre, fn)
}
export function predicadoEstadoExiste(nombre: string): boolean {
  return PREDICADOS.has(nombre)
}
export function evaluarPredicadoEstado(nombre: string): boolean {
  try {
    return PREDICADOS.get(nombre)?.() === true
  } catch {
    return false
  }
}

/** Valida un paso entrante: ids registrados, texto no vacío, hastaQue de tipos cerrados. Devuelve error o null. */
export function validarPaso(p: PasoGuia): string | null {
  if (!recortarTexto(p?.texto)) return 'el paso necesita texto'
  if (p.resaltar !== undefined && !resolverIdAyuda(p.resaltar)) {
    return `id de ayuda no registrado: ${String(p.resaltar).slice(0, 40)}`
  }
  const h = p.hastaQue as Record<string, unknown> | undefined
  if (h !== undefined) {
    if (h === null || typeof h !== 'object') return 'hastaQue inválido'
    const claves = Object.keys(h).sort().join(',')
    if (claves === 'manual') {
      if (h.manual !== true) return 'hastaQue inválido'
    } else if (claves === 'evento,id') {
      if (h.evento !== 'tool-abierta' || !idAyudaValido(h.id)) return 'hastaQue inválido'
    } else if (claves === 'clic') {
      if (!resolverIdAyuda(h.clic)) return 'hastaQue: id de clic no registrado'
    } else if (claves === 'estado') {
      if (typeof h.estado !== 'string' || !PREDICADOS.has(h.estado)) return 'hastaQue: predicado de estado desconocido'
    } else {
      return 'hastaQue inválido'
    }
  }
  return null
}

/** ¿La señal cumple la condición del paso? Pura. (`estado` se evalúa con `evaluarEstadoPaso`.) */
export function cumpleHastaQue(h: HastaQue | undefined, senal: SenalGuia): boolean {
  if (!h) return false
  if ('manual' in h) return senal.tipo === 'manual'
  if ('evento' in h) return senal.tipo === 'tool-abierta' && senal.id === h.id
  if ('clic' in h) return senal.tipo === 'clic' && senal.id === h.clic
  return false
}

/** Avanza un paso (o termina). Pura. */
export function avanzarEstado(e: EstadoGuia): EstadoGuia {
  if (e.paso < 0 || e.terminada) return e
  const sig = e.paso + 1
  if (sig >= e.pasos.length) return { ...e, paso: e.pasos.length - 1, terminada: true, resaltado: null }
  return { ...e, paso: sig, resaltado: null }
}

// ─── Store ───────────────────────────────────────────────────────────────────────

export interface DepsGuia {
  ahora: () => number
  /** Abre una pantalla por id (la conecta el host con `abrirPantalla`). */
  abrir?: (idPantalla: string) => void
}

const deps: DepsGuia = { ahora: () => Date.now() }
export function configurarGuia(d: Partial<DepsGuia>): void {
  Object.assign(deps, d)
}

let estado: EstadoGuia = VACIO
const oyentes = new Set<() => void>()
function emitir(nuevo: EstadoGuia): void {
  estado = nuevo
  for (const o of [...oyentes]) o()
}
export function suscribirGuia(fn: () => void): () => void {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}
export function obtenerEstadoGuia(): EstadoGuia {
  return estado
}
/** Solo para tests. */
export function reiniciarGuia(): void {
  estado = VACIO
  oyentes.clear()
  PREDICADOS.clear()
  deps.ahora = () => Date.now()
  deps.abrir = undefined
}

export type ResultadoGuia = { ok: true } | { ok: false; motivo: string }

/** Resalta un elemento por id de ayuda registrado. Reemplaza el resaltado anterior (solo hay uno). */
export function resaltarElemento(p: { id: string; texto: string; duracionMs?: number }): ResultadoGuia {
  if (!resolverIdAyuda(p?.id)) return { ok: false, motivo: 'id de ayuda no registrado (no se aceptan selectores libres)' }
  const texto = recortarTexto(p.texto)
  if (!texto) return { ok: false, motivo: 'falta el texto' }
  const dur = Math.min(Math.max(Number(p.duracionMs) || DURACION_RESALTADO_DEFECTO_MS, 1000), 60_000)
  emitir({ ...estado, resaltado: { id: p.id, texto, desdeMs: deps.ahora(), duracionMs: dur } })
  return { ok: true }
}

export function limpiarResaltado(): void {
  if (estado.resaltado) emitir({ ...estado, resaltado: null })
}

/** Descarta resaltado y guía (Esc / botón). */
export function descartarGuia(): void {
  if (estado.resaltado || estado.paso >= 0) emitir(VACIO)
}

export function expirarResaltado(): void {
  const r = estado.resaltado
  if (r && deps.ahora() - r.desdeMs >= r.duracionMs) limpiarResaltado()
}

function mostrarPaso(e: EstadoGuia): EstadoGuia {
  const p = e.pasos[e.paso]
  if (!p || e.terminada) return e
  if (p.abrir) deps.abrir?.(p.abrir)
  const r = p.resaltar
    ? { id: p.resaltar, texto: recortarTexto(p.texto), desdeMs: deps.ahora(), duracionMs: 10 * 60_000 }
    : null
  return { ...e, resaltado: r }
}

export function iniciarGuia(pasos: PasoGuia[]): ResultadoGuia {
  if (!Array.isArray(pasos) || pasos.length === 0) return { ok: false, motivo: 'sin pasos' }
  if (pasos.length > 20) return { ok: false, motivo: 'demasiados pasos (máx. 20)' }
  for (let i = 0; i < pasos.length; i++) {
    const err = validarPaso(pasos[i])
    if (err) return { ok: false, motivo: `paso ${i + 1}: ${err}` }
  }
  const limpios = pasos.map((p) => ({ ...p, texto: recortarTexto(p.texto) }))
  emitir(mostrarPaso({ resaltado: null, pasos: limpios, paso: 0, pausada: false, terminada: false }))
  return { ok: true }
}

function pasarAlSiguiente(): void {
  emitir(mostrarPaso(avanzarEstado(estado)))
}

export function siguientePaso(): void {
  if (estado.paso >= 0 && !estado.terminada) pasarAlSiguiente()
}
export function pausarGuia(pausada: boolean): void {
  if (estado.paso >= 0) emitir({ ...estado, pausada })
}

/** Notifica una señal de la UI; avanza si cumple el `hastaQue` del paso actual. */
export function notificarSenal(s: SenalGuia): boolean {
  if (estado.paso < 0 || estado.terminada || estado.pausada) return false
  if (cumpleHastaQue(estado.pasos[estado.paso]?.hastaQue, s)) {
    pasarAlSiguiente()
    return true
  }
  return false
}

/** Evalúa el predicado de estado del paso actual (la capa lo llama periódicamente). */
export function evaluarEstadoPaso(): boolean {
  if (estado.paso < 0 || estado.terminada || estado.pausada) return false
  const h = estado.pasos[estado.paso]?.hastaQue
  if (h && 'estado' in h && evaluarPredicadoEstado(h.estado)) {
    pasarAlSiguiente()
    return true
  }
  return false
}
