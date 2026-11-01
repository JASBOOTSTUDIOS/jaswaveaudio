/**
 * Sincronización de la biblioteca de grooves con el catálogo del servidor (M).
 *
 * Qué hace: pide el índice (`GET /grooves/indice`), compara con `.sync.json` y descarga solo lo nuevo o cambiado
 * (`GET /grooves/:id/archivo`), verificando tamaño y SHA-256 antes de escribir (temporal + renombrado atómico).
 * Retira lo que el administrador quitó. Solo toca lo de origen «catalogo» (lo que está en `.sync.json`); nunca los
 * grooves del usuario. Si el usuario editó a mano uno del catálogo y el catálogo lo cambia o lo retira, su copia se
 * conserva como suya (origen «usuario») y se avisa.
 *
 * Tolerante a fallos: sin conexión o con el servidor caído devuelve un resultado (nunca lanza ni bloquea) y no
 * toca el estado; el reintento con espera creciente lo gobierna el renderer (`src/lib/grooves/sync-auto.ts`).
 *
 * El main no importa `shared/`: `diferenciasSync` replica `aplicarDiferencias` (un test comprueba que dan lo mismo).
 */

import * as crypto from 'node:crypto'
import { MAX_BYTES_MIDI, type ServicioGrooves } from './grooves-service'

export type EntradaSync = { id: string; ruta: string; sha256: string; revision: number }

export type GrooveRemoto = EntradaSync & {
  estilo: string
  nombre: string
  tipo: string
  compas: string
  tempo: number
  compases: number
  intensidad: number
  etiquetas: string[]
  autor: string
  licencia: string
  tamano: number
}

export type DiferenciasSync = {
  descargar: EntradaSync[]
  actualizar: Array<{ anterior: EntradaSync; nuevo: EntradaSync }>
  borrar: EntradaSync[]
  sinCambios: string[]
}

/** Igual que `aplicarDiferencias` de shared (misma semántica, sin importarlo). */
export function diferenciasSync(
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

export type EventoSync =
  | { tipo: 'inicio' }
  | { tipo: 'progreso'; hecho: number; total: number; nombre?: string }
  | { tipo: 'fin'; resultado: ResultadoSync }

export type ResultadoSync = {
  ok: boolean
  /** No se pudo hablar con el servidor (sin internet, caído o sesión caducada). */
  sinConexion?: boolean
  error?: string
  sinCambios?: boolean
  revision?: number
  descargados: number
  actualizados: number
  retirados: number
  /** Nombres de grooves del catálogo editados por el usuario que se conservaron como suyos. */
  conservados: string[]
  errores: Array<{ nombre: string; error: string }>
  novedades?: Array<{ tipo: string; nombre: string; fecha: string }>
  fecha: string
}

export type OpcionesSync = {
  servicio: ServicioGrooves
  apiBase: string
  token: string
  fetch?: typeof fetch
  emitir?: (e: EventoSync) => void
  ahora?: () => Date
  /** Descargas a la vez. */
  concurrencia?: number
  /** Tiempo máximo por petición. */
  tiempoMs?: number
}

const ID = /^[a-z0-9][a-z0-9-]{2,79}$/
const SHA = /^[0-9a-f]{64}$/
const MAX_REMOTOS = 5000

const vacio = (ahora: Date): ResultadoSync => ({ ok: true, descargados: 0, actualizados: 0, retirados: 0, conservados: [], errores: [], fecha: ahora.toISOString() })

/** Valida la ruta anunciada por el servidor: relativa, 1–2 carpetas, solo .mid, sin nada raro. No se confía en él. */
// eslint-disable-next-line no-control-regex
const PROHIBIDOS_RUTA = /[<>:"\\|?*\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/
export function rutaRemotaValida(ruta: unknown): ruta is string {
  if (typeof ruta !== 'string' || ruta.length > 200 || !/\.mid$/i.test(ruta)) return false
  const partes = ruta.split('/')
  if (partes.length < 2 || partes.length > 3) return false
  return partes.every((p) => p.length > 0 && p.length <= 80 && !p.startsWith('.') && !p.endsWith('.') && !p.endsWith(' ') && !p.includes('..') && !PROHIBIDOS_RUTA.test(p) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))
}

/** Convierte lo que dice el servidor en entradas fiables; descarta las malformadas. */
export function normalizarIndiceRemoto(crudo: unknown): { revision: number; grooves: GrooveRemoto[]; descartados: number } {
  const o = (crudo ?? {}) as { revision?: unknown; grooves?: unknown }
  if (typeof o.revision !== 'number' || !Number.isInteger(o.revision) || !Array.isArray(o.grooves)) throw new Error('respuesta del servidor no válida')
  const grooves: GrooveRemoto[] = []
  const ids = new Set<string>()
  const rutas = new Set<string>()
  let descartados = 0
  for (const g of o.grooves.slice(0, MAX_REMOTOS)) {
    const e = g as Partial<GrooveRemoto> | null
    const ok =
      !!e &&
      typeof e.id === 'string' &&
      ID.test(e.id) &&
      !ids.has(e.id) &&
      rutaRemotaValida(e.ruta) &&
      !rutas.has(String(e.ruta).toLowerCase()) &&
      typeof e.sha256 === 'string' &&
      SHA.test(e.sha256) &&
      typeof e.tamano === 'number' &&
      Number.isInteger(e.tamano) &&
      e.tamano >= 14 &&
      e.tamano <= MAX_BYTES_MIDI &&
      typeof e.revision === 'number' &&
      Number.isInteger(e.revision) &&
      e.revision >= 1
    if (!ok) {
      descartados++
      continue
    }
    const x = e as GrooveRemoto
    ids.add(x.id)
    rutas.add(x.ruta.toLowerCase())
    grooves.push({
      id: x.id,
      ruta: x.ruta,
      sha256: x.sha256,
      revision: x.revision,
      tamano: x.tamano,
      estilo: String(x.estilo ?? ''),
      nombre: String(x.nombre ?? '').slice(0, 80),
      tipo: String(x.tipo ?? 'groove'),
      compas: String(x.compas ?? '4/4'),
      tempo: Number(x.tempo) || 100,
      compases: Number(x.compases) || 1,
      intensidad: Number(x.intensidad) || 3,
      etiquetas: Array.isArray(x.etiquetas) ? x.etiquetas.filter((t): t is string => typeof t === 'string').slice(0, 20) : [],
      autor: String(x.autor ?? '').slice(0, 60),
      licencia: String(x.licencia ?? '').slice(0, 40),
    })
  }
  return { revision: o.revision, grooves, descartados }
}

const metaSidecar = (g: GrooveRemoto) => ({
  id: g.id,
  nombre: g.nombre,
  tempo: g.tempo,
  compas: g.compas,
  compases: g.compases,
  tipo: g.tipo,
  etiquetas: g.etiquetas,
  intensidad: g.intensidad,
  autor: g.autor,
  licencia: g.licencia,
  revision: g.revision,
})

function mensajeDeRed(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return /abort|timeout/i.test(m) ? 'el servidor tardó demasiado en responder' : m
}

let enCurso: Promise<ResultadoSync> | null = null

/** Sincroniza ahora. Si ya hay una en marcha, devuelve esa misma. Nunca lanza. */
export function sincronizarGrooves(o: OpcionesSync): Promise<ResultadoSync> {
  if (enCurso) return enCurso
  enCurso = ejecutar(o).finally(() => {
    enCurso = null
  })
  return enCurso
}

async function ejecutar(o: OpcionesSync): Promise<ResultadoSync> {
  const ahora = (o.ahora ?? (() => new Date()))()
  const res = vacio(ahora)
  const emitir = (e: EventoSync) => {
    try {
      o.emitir?.(e)
    } catch {
      /* el renderer puede haberse cerrado */
    }
  }
  const f = o.fetch ?? fetch
  const base = o.apiBase.replace(/\/+$/, '')
  const cabeceras = { Authorization: `Bearer ${o.token}` }
  const s = o.servicio
  emitir({ tipo: 'inicio' })
  const terminar = (r: ResultadoSync): ResultadoSync => {
    try {
      const estado = s.leerEstadoSync()
      if (r.ok) {
        const fecha = r.fecha
        const conservados = r.conservados.map((nombre) => ({ tipo: 'conservado', nombre, fecha }))
        s.guardarEstadoSync({
          ultima: fecha,
          ultimoResultado: { ...r, novedades: undefined },
          novedades: [...(r.novedades ?? []), ...conservados, ...estado.novedades].slice(0, 50),
        })
      }
    } catch {
      /* no poder guardar el estado no debe romper la sincronización */
    }
    emitir({ tipo: 'fin', resultado: r })
    return r
  }

  try {
    s.asegurarRaiz()
    const sync = s.leerSync()
    // 1. Índice. Con la revisión que ya tenemos, el servidor responde 304 si no hay nada nuevo.
    const desde = sync.catalogoRevision
    let r: Response
    try {
      r = await f(`${base}/grooves/indice${typeof desde === 'number' ? `?desde=${desde}` : ''}`, { headers: cabeceras, cache: 'no-store', signal: AbortSignal.timeout(o.tiempoMs ?? 20_000) })
    } catch (e) {
      return terminar({ ...res, ok: false, sinConexion: true, error: `Sin conexión con el servidor (${mensajeDeRed(e)})` })
    }
    if (r.status === 304) return terminar({ ...res, sinCambios: true, revision: desde })
    if (r.status === 401 || r.status === 403) return terminar({ ...res, ok: false, sinConexion: true, error: 'Inicia sesión para actualizar los grooves' })
    if (!r.ok) return terminar({ ...res, ok: false, sinConexion: r.status >= 500, error: `El servidor respondió ${r.status}` })
    let remoto: ReturnType<typeof normalizarIndiceRemoto>
    try {
      remoto = normalizarIndiceRemoto(await r.json())
    } catch (e) {
      return terminar({ ...res, ok: false, error: `Respuesta del servidor no válida (${mensajeDeRed(e)})` })
    }
    res.revision = remoto.revision
    if (remoto.descartados) res.errores.push({ nombre: '(índice)', error: `${remoto.descartados} grooves del servidor se ignoraron por datos no válidos` })

    // 2. Lo que ya tenemos del catálogo y qué rutas son del usuario (para no pisarlas).
    const local = sync.grooves.map((g) => ({ ...g }))
    const enSync = new Set(local.map((g) => g.ruta.toLowerCase()))
    const ocupadas = s.rutasMid().filter((p) => !enSync.has(p.toLowerCase()))
    const diff = diferenciasSync({ grooves: local }, { grooves: remoto.grooves }, { rutasOcupadas: ocupadas })
    const remotoPorId = new Map(remoto.grooves.map((g) => [g.id, g]))
    const nuevoSync = new Map(local.map((g) => [g.id, g]))
    const total = diff.descargar.length + diff.actualizar.length + diff.borrar.length
    let hecho = 0
    const avanzar = (nombre?: string) => emitir({ tipo: 'progreso', hecho: ++hecho, total, ...(nombre ? { nombre } : {}) })

    // 3. Retiradas y actualizaciones: primero se respeta lo que el usuario editó.
    const editado = (g: EntradaSync): string | null => {
      const h = s.hashArchivo(g.ruta)
      return h && h !== g.sha256 ? h : null
    }
    const conservar = (g: EntradaSync, h: string, nombre: string) => {
      s.conservarComoUsuario(g.ruta, h)
      nuevoSync.delete(g.id)
      res.conservados.push(nombre)
    }
    const nombreDe = (g: EntradaSync) => remotoPorId.get(g.id)?.nombre || g.ruta.split('/').pop()!.replace(/\.mid$/i, '')
    const novedades: Array<{ tipo: string; nombre: string; fecha: string }> = []
    const aviso = (tipo: string, nombre: string) => novedades.push({ tipo, nombre, fecha: ahora.toISOString() })

    for (const g of diff.borrar) {
      try {
        const h = editado(g)
        if (h) conservar(g, h, nombreDe(g))
        else {
          await s.quitarCatalogo(g.ruta)
          nuevoSync.delete(g.id)
          res.retirados++
          aviso('retirado', nombreDe(g))
        }
      } catch (e) {
        res.errores.push({ nombre: nombreDe(g), error: mensajeDeRed(e) })
      }
      avanzar(nombreDe(g))
    }

    // 4. Descargas (nuevas y actualizaciones), unas pocas a la vez.
    type Tarea = { nuevo: EntradaSync; anterior?: EntradaSync }
    const tareas: Tarea[] = [...diff.descargar.map((nuevo) => ({ nuevo })), ...diff.actualizar.map((a) => ({ nuevo: a.nuevo, anterior: a.anterior }))]
    const descargar = async (t: Tarea) => {
      const g = remotoPorId.get(t.nuevo.id)!
      const nombre = g.nombre || g.id
      try {
        let ruta = t.nuevo.ruta
        if (t.anterior) {
          const h = editado(t.anterior)
          if (h) {
            // El usuario lo editó: su copia se queda como suya y lo del catálogo se baja aparte.
            conservar(t.anterior, h, nombre)
            const libres = new Set([...s.rutasMid()].map((p) => p.toLowerCase()))
            let k = 1
            while (libres.has(ruta.toLowerCase())) {
              ruta = t.nuevo.ruta.replace(/\.mid$/i, `-catalogo${k > 1 ? k : ''}.mid`)
              k++
            }
          } else if (s.hashArchivo(t.anterior.ruta) === null) {
            // El usuario borró este del catálogo: no lo resucitamos; solo anotamos la revisión nueva.
            nuevoSync.set(g.id, { ...t.nuevo, ruta: t.anterior.ruta })
            return
          }
        }
        const resp = await f(`${base}/grooves/${encodeURIComponent(g.id)}/archivo`, { headers: cabeceras, cache: 'no-store', signal: AbortSignal.timeout(o.tiempoMs ?? 20_000) })
        if (!resp.ok) throw new Error(`el servidor respondió ${resp.status}`)
        const declarado = Number(resp.headers.get('content-length') ?? g.tamano)
        if (declarado > g.tamano) throw new Error('el archivo es más grande de lo anunciado')
        const bytes = new Uint8Array(await resp.arrayBuffer())
        if (bytes.byteLength !== g.tamano) throw new Error(`tamaño distinto del anunciado (${bytes.byteLength} en lugar de ${g.tamano})`)
        const hash = crypto.createHash('sha256').update(bytes).digest('hex')
        if (hash !== g.sha256) throw new Error('la huella SHA-256 no coincide: se descarta el archivo')
        s.escribirCatalogo(ruta, bytes, g.sha256, metaSidecar(g))
        if (t.anterior && t.anterior.ruta !== ruta) {
          const sigueSiendoSuyo = nuevoSync.has(t.anterior.id)
          if (sigueSiendoSuyo) await s.quitarCatalogo(t.anterior.ruta)
        }
        nuevoSync.set(g.id, { id: g.id, ruta, sha256: g.sha256, revision: g.revision })
        if (t.anterior) {
          res.actualizados++
          aviso('actualizado', nombre)
        } else {
          res.descargados++
          aviso('nuevo', nombre)
        }
      } catch (e) {
        res.errores.push({ nombre, error: mensajeDeRed(e) })
      } finally {
        avanzar(nombre)
      }
    }
    const cola = [...tareas]
    const trabajadores = Array.from({ length: Math.max(1, Math.min(o.concurrencia ?? 4, 8)) }, async () => {
      for (let t = cola.shift(); t; t = cola.shift()) await descargar(t)
    })
    await Promise.all(trabajadores)

    // 5. Estado: la revisión global solo se anota si todo salió bien (si no, la próxima vez se reintenta).
    const fallosDeGroove = res.errores.filter((e) => e.nombre !== '(índice)').length
    s.escribirSync({
      ...(fallosDeGroove === 0 ? { catalogoRevision: remoto.revision } : sync.catalogoRevision !== undefined ? { catalogoRevision: sync.catalogoRevision } : {}),
      grooves: [...nuevoSync.values()],
    })
    if (fallosDeGroove > 0) res.ok = false
    res.sinCambios = total === 0
    res.novedades = novedades
    return terminar(res)
  } catch (e) {
    return terminar({ ...res, ok: false, error: mensajeDeRed(e) })
  }
}

// ── Propuestas al catálogo (con consentimiento) ──────────────────────────────

export type MetaPropuesta = {
  nombre: string
  estilo: string
  tipo?: string
  compas?: string
  tempo?: number
  compases?: number
  intensidad?: number
  etiquetas?: string[]
  autor?: string
}

export type ResultadoPropuesta = { ok: boolean; error?: string; repetida?: boolean; mensaje?: string; estado?: string }

/**
 * Envía un groove del usuario como propuesta. Solo se llama cuando el usuario lo pidió o activó compartir. Registra
 * el SHA-256 en `propuestos` para no reenviarlo. El servidor guarda además la versión del texto aceptado.
 */
export async function enviarPropuesta(o: {
  servicio: ServicioGrooves
  apiBase: string
  token: string
  ruta: string
  meta: MetaPropuesta
  consentimiento: { aceptado: boolean; version: string }
  fetch?: typeof fetch
}): Promise<ResultadoPropuesta> {
  try {
    if (!o.consentimiento.aceptado) return { ok: false, error: 'Falta tu permiso para compartir el groove' }
    const bytes = o.servicio.leerBytes(o.ruta)
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')
    const estado = o.servicio.leerEstadoSync()
    if (estado.propuestos.includes(sha)) return { ok: true, repetida: true, mensaje: 'Ya habías propuesto este groove.' }
    const f = o.fetch ?? fetch
    let r: Response
    try {
      r = await f(`${o.apiBase.replace(/\/+$/, '')}/grooves/propuestas`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...o.meta, base64: Buffer.from(bytes).toString('base64'), consentimiento: o.consentimiento }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (e) {
      return { ok: false, error: `Sin conexión con el servidor (${mensajeDeRed(e)})` }
    }
    const cuerpo = (await r.json().catch(() => ({}))) as { mensaje?: string; repetida?: boolean; propuesta?: { estado?: string }; error?: { mensaje?: string } }
    if (!r.ok) return { ok: false, error: cuerpo.error?.mensaje ?? `El servidor respondió ${r.status}` }
    o.servicio.guardarEstadoSync({ propuestos: [...estado.propuestos, sha] })
    return { ok: true, repetida: cuerpo.repetida === true, ...(cuerpo.mensaje ? { mensaje: cuerpo.mensaje } : {}), ...(cuerpo.propuesta?.estado ? { estado: cuerpo.propuesta.estado } : {}) }
  } catch (e) {
    return { ok: false, error: mensajeDeRed(e) }
  }
}
