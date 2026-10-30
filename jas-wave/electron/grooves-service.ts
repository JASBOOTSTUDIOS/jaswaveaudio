/**
 * Biblioteca de grooves MIDI por estilos (M) — acceso a disco en el proceso main.
 *
 * Carpeta: `%APPDATA%\JasWave\grooves\<Estilo>\[<Subestilo>\]*.mid` (JASWAVE_GROOVES_DIR la sustituye).
 * Este servicio solo hace E/S y devuelve datos «crudos» (resumen del .mid, SHA-256 y los JSON de metadatos); el
 * renderer los convierte en entradas con la lógica pura de `shared/src/grooves`. Todas las rutas que entran son
 * relativas a la raíz y se validan para no salir de ella.
 *
 * Archivos especiales de la raíz (con punto, nunca se indexan): `.sync.json` (lo que vino del catálogo) y
 * `.favoritos.json`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { resumirMidi, type ResumenMidi } from './grooves-midi'

export const MAX_BYTES_MIDI = 2 * 1024 * 1024
export const MAX_ARCHIVOS = 5000

export type GrooveCrudo = {
  /** Ruta relativa a la raíz, con «/». */
  ruta: string
  sha256: string
  tamano: number
  mtimeMs: number
  resumen: ResumenMidi
  /** Contenido de `groove.json` de la carpeta (sin validar). */
  carpeta?: unknown
  /** Contenido de `<nombre>.json` junto al .mid (sin validar). */
  sidecar?: unknown
  favorito: boolean
}

export type OpcionesServicio = {
  raiz: string
  /** Carpeta `plugins/grooves/estilos` (o su copia en resources/) para sembrar la primera vez. */
  semilla?: string
  /** Mueve a la papelera del sistema. Sin ella, el borrado falla (nunca borramos definitivamente). */
  papelera?: (ruta: string) => Promise<void>
  /** Aviso de cambios en la carpeta (vigilancia). */
  alCambiar?: () => void
}

export type EstadoSync = {
  /** «Actualizar grooves automáticamente». */
  auto: boolean
  /** «Compartir mis grooves con JasWave» (apagado por defecto). */
  compartir: boolean
  ultima: string | null
  ultimoResultado: Record<string, unknown> | null
  novedades: Array<{ tipo: string; nombre: string; fecha: string }>
  /** SHA-256 de los grooves del usuario ya propuestos (no se reenvían). */
  propuestos: string[]
}

export class ErrorGrooves extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorGrooves'
  }
}

const EXT_MID = /\.(mid|midi)$/i
// Los caracteres de control son justo lo que se quiere rechazar en un nombre de archivo.
// eslint-disable-next-line no-control-regex
const NOMBRE_ILEGAL = /[<>:"/\\|?*\u0000-\u001f]/g

/** Nombre de carpeta o archivo seguro (sin separadores, sin puntos al inicio ni finales). */
export function nombreSeguro(texto: string, max = 60): string {
  const t = String(texto ?? '')
    .replace(NOMBRE_ILEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, max)
    .trim()
  if (!t || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) throw new ErrorGrooves(`Nombre no válido: «${texto}»`)
  return t
}

export class ServicioGrooves {
  readonly raiz: string
  private readonly opts: OpcionesServicio
  private cache = new Map<string, { mtimeMs: number; tamano: number; sha256: string; resumen: ResumenMidi }>()
  private vigilante: fs.FSWatcher | null = null
  private temporizador: NodeJS.Timeout | null = null
  private silenciar = 0

  constructor(opts: OpcionesServicio) {
    this.opts = opts
    this.raiz = path.resolve(opts.raiz)
  }

  // ── Rutas ──────────────────────────────────────────────────────────────────

  /** Resuelve una ruta relativa dentro de la raíz o lanza. */
  resolver(rel: string): string {
    if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
      throw new ErrorGrooves(`Ruta no válida: «${String(rel)}»`)
    }
    const abs = path.resolve(this.raiz, rel)
    const pref = this.raiz.endsWith(path.sep) ? this.raiz : this.raiz + path.sep
    if (!(abs + path.sep).startsWith(pref) || abs === this.raiz) throw new ErrorGrooves(`Ruta fuera de la biblioteca: «${rel}»`)
    return abs
  }

  private relativa(abs: string): string {
    return path.relative(this.raiz, abs).split(path.sep).join('/')
  }

  // ── Inicio, siembra y vigilancia ──────────────────────────────────────────

  asegurarRaiz(): void {
    fs.mkdirSync(this.raiz, { recursive: true })
  }

  private leerJson(abs: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(abs, 'utf8'))
    } catch {
      return undefined
    }
  }

  private escribirJson(abs: string, valor: unknown): void {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(valor, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, abs)
  }

  leerSync(): { version: 1; catalogoRevision?: number; grooves: Array<{ id: string; ruta: string; sha256: string; revision: number }> } {
    const c = this.leerJson(path.join(this.raiz, '.sync.json')) as { grooves?: unknown; catalogoRevision?: number } | undefined
    const grooves = Array.isArray(c?.grooves) ? (c!.grooves as Array<{ id: string; ruta: string; sha256: string; revision: number }>) : []
    return { version: 1, catalogoRevision: c?.catalogoRevision, grooves: grooves.filter((g) => g && typeof g.id === 'string' && typeof g.ruta === 'string') }
  }

  /**
   * Copia el contenido de serie la primera vez: nunca pisa un archivo que ya exista ni vuelve a crear uno que el
   * usuario borró (queda registrado en `.sync.json`), y no toca nada que el usuario haya añadido.
   */
  sembrar(): { copiados: number } {
    this.asegurarRaiz()
    const semilla = this.opts.semilla
    if (!semilla || !fs.existsSync(semilla)) return { copiados: 0 }
    const manifiesto = this.leerJson(path.join(path.dirname(semilla), 'catalogo.json')) as
      | { grooves?: Array<{ id: string; ruta: string; sha256: string; revision: number }> }
      | undefined
    const porRuta = new Map((manifiesto?.grooves ?? []).map((g) => [g.ruta, g]))
    const sync = this.leerSync()
    const conocidas = new Set(sync.grooves.map((g) => g.id))
    let copiados = 0
    this.silenciar++
    try {
      for (const rel of listarArchivos(semilla)) {
        if (!EXT_MID.test(rel)) continue
        const entrada = porRuta.get(rel)
        if (!entrada || conocidas.has(entrada.id)) continue
        const destino = this.resolver(rel)
        if (fs.existsSync(destino)) continue
        fs.mkdirSync(path.dirname(destino), { recursive: true })
        fs.copyFileSync(path.join(semilla, rel), destino)
        sync.grooves.push({ id: entrada.id, ruta: entrada.ruta, sha256: entrada.sha256, revision: entrada.revision })
        copiados++
      }
      // groove.json: se completa con las entradas que falten, sin tocar las existentes.
      for (const rel of listarArchivos(semilla)) {
        if (path.posix.basename(rel) !== 'groove.json') continue
        const destino = this.resolver(rel)
        const origen = this.leerJson(path.join(semilla, rel)) as { archivos?: Record<string, unknown> } & Record<string, unknown>
        if (!origen) continue
        const actual = (fs.existsSync(destino) ? (this.leerJson(destino) as typeof origen | undefined) : undefined) ?? undefined
        if (!actual) {
          // Solo si hay algún .mid sembrado en esa carpeta.
          const carpetaDestino = path.dirname(destino)
          if (fs.existsSync(carpetaDestino)) this.escribirJson(destino, origen)
          continue
        }
        const archivos = { ...(origen.archivos ?? {}), ...(actual.archivos ?? {}) }
        const completo = { ...origen, ...actual, archivos }
        if (JSON.stringify(completo) !== JSON.stringify(actual)) this.escribirJson(destino, completo)
      }
      if (copiados) this.escribirJson(path.join(this.raiz, '.sync.json'), sync)
    } finally {
      this.silenciar--
    }
    return { copiados }
  }

  vigilar(): void {
    if (this.vigilante) return
    this.asegurarRaiz()
    try {
      this.vigilante = fs.watch(this.raiz, { recursive: true }, (_ev, nombre) => {
        if (this.silenciar > 0) return
        if (nombre && /(^|[\\/])\.[^\\/]*\.tmp$|\.tmp$/.test(String(nombre))) return
        if (this.temporizador) clearTimeout(this.temporizador)
        this.temporizador = setTimeout(() => this.opts.alCambiar?.(), 350)
      })
      this.vigilante.on('error', () => this.cerrar())
    } catch {
      this.vigilante = null
    }
  }

  cerrar(): void {
    this.vigilante?.close()
    this.vigilante = null
    if (this.temporizador) clearTimeout(this.temporizador)
    this.temporizador = null
  }

  // ── Lectura e indexado ────────────────────────────────────────────────────

  private favoritos(): Set<string> {
    const f = this.leerJson(path.join(this.raiz, '.favoritos.json')) as { ids?: unknown } | undefined
    return new Set(Array.isArray(f?.ids) ? f!.ids.filter((x): x is string => typeof x === 'string') : [])
  }

  /** Índice crudo. Los archivos sin cambios (mtime y tamaño) reutilizan el resumen y el hash de la caché. */
  indexar(): GrooveCrudo[] {
    this.asegurarRaiz()
    const favs = this.favoritos()
    const vistos = new Set<string>()
    const salida: GrooveCrudo[] = []
    const cacheCarpeta = new Map<string, unknown>()
    for (const rel of listarArchivos(this.raiz, MAX_ARCHIVOS)) {
      if (!EXT_MID.test(rel) || rel.startsWith('.') || rel.split('/').some((p) => p.startsWith('.'))) continue
      const abs = path.join(this.raiz, rel)
      let st: fs.Stats
      try {
        st = fs.statSync(abs)
      } catch {
        continue
      }
      if (!st.isFile() || st.size > MAX_BYTES_MIDI || st.size < 14) continue
      vistos.add(rel)
      let c = this.cache.get(rel)
      if (!c || c.mtimeMs !== st.mtimeMs || c.tamano !== st.size) {
        try {
          const bin = fs.readFileSync(abs)
          c = { mtimeMs: st.mtimeMs, tamano: st.size, sha256: crypto.createHash('sha256').update(bin).digest('hex'), resumen: resumirMidi(bin) }
          this.cache.set(rel, c)
        } catch {
          this.cache.delete(rel)
          continue
        }
      }
      if (c.resumen.notas === 0) continue
      const dir = path.dirname(abs)
      if (!cacheCarpeta.has(dir)) cacheCarpeta.set(dir, this.leerJson(path.join(dir, 'groove.json')))
      salida.push({
        ruta: rel,
        sha256: c.sha256,
        tamano: c.tamano,
        mtimeMs: c.mtimeMs,
        resumen: c.resumen,
        carpeta: cacheCarpeta.get(dir),
        sidecar: this.leerJson(abs.replace(EXT_MID, '.json')),
        favorito: false,
      })
    }
    for (const k of [...this.cache.keys()]) if (!vistos.has(k)) this.cache.delete(k)
    // Los favoritos se guardan por id (que calcula el renderer): se devuelven aparte en `favoritosIds()`.
    void favs
    return salida
  }

  /** Carpetas de estilo/subestilo (también las vacías), rutas relativas con «/». */
  carpetas(): string[] {
    const out: string[] = []
    const visitar = (dir: string, prefijo: string, nivel: number) => {
      if (nivel >= 2) return
      let entradas: fs.Dirent[]
      try {
        entradas = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue
        const rel = prefijo ? `${prefijo}/${e.name}` : e.name
        out.push(rel)
        visitar(path.join(dir, e.name), rel, nivel + 1)
      }
    }
    visitar(this.raiz, '', 0)
    return out
  }

  favoritosIds(): string[] {
    return [...this.favoritos()]
  }

  alternarFavorito(id: string, valor?: boolean): string[] {
    if (typeof id !== 'string' || !id || id.length > 120) throw new ErrorGrooves('Id de groove no válido')
    const set = this.favoritos()
    const poner = valor ?? !set.has(id)
    if (poner) set.add(id)
    else set.delete(id)
    this.silenciar++
    try {
      this.escribirJson(path.join(this.raiz, '.favoritos.json'), { version: 1, ids: [...set].sort() })
    } finally {
      this.silenciar--
    }
    return [...set]
  }

  leerBytes(rel: string): Uint8Array {
    const abs = this.resolver(rel)
    if (!EXT_MID.test(abs)) throw new ErrorGrooves('Solo se leen archivos .mid')
    const st = fs.statSync(abs)
    if (!st.isFile() || st.size > MAX_BYTES_MIDI) throw new ErrorGrooves('Archivo MIDI no válido o demasiado grande')
    return new Uint8Array(fs.readFileSync(abs))
  }


  // ── Sincronización con el catálogo (ver grooves-sync.ts) ──────────────────

  /** Ajustes y novedades de la sincronización (`.sync-estado.json`, solo en esta máquina). */
  leerEstadoSync(): EstadoSync {
    const c = (this.leerJson(path.join(this.raiz, '.sync-estado.json')) ?? {}) as Partial<EstadoSync>
    return {
      auto: c.auto !== false,
      compartir: c.compartir === true,
      ultima: typeof c.ultima === 'string' ? c.ultima : null,
      ultimoResultado: c.ultimoResultado && typeof c.ultimoResultado === 'object' ? c.ultimoResultado : null,
      novedades: Array.isArray(c.novedades) ? c.novedades.slice(0, 50) : [],
      propuestos: Array.isArray(c.propuestos) ? c.propuestos.filter((x): x is string => typeof x === 'string').slice(-5000) : [],
    }
  }

  guardarEstadoSync(parcial: Partial<EstadoSync>): EstadoSync {
    const nuevo = { ...this.leerEstadoSync(), ...parcial }
    this.silenciar++
    try {
      this.escribirJson(path.join(this.raiz, '.sync-estado.json'), nuevo)
    } finally {
      this.silenciar--
    }
    return nuevo
  }

  escribirSync(sync: { catalogoRevision?: number; grooves: Array<{ id: string; ruta: string; sha256: string; revision: number }> }): void {
    this.silenciar++
    try {
      this.escribirJson(path.join(this.raiz, '.sync.json'), { version: 1, ...sync })
    } finally {
      this.silenciar--
    }
  }

  /** Rutas (relativas) de todos los .mid de la carpeta, del catálogo o del usuario. */
  rutasMid(): string[] {
    return listarArchivos(this.raiz).filter((r) => EXT_MID.test(r))
  }

  /** SHA-256 del .mid o null si no existe. */
  hashArchivo(rel: string): string | null {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(this.resolver(rel))).digest('hex')
    } catch {
      return null
    }
  }

  /**
   * Escribe un .mid del catálogo (a un temporal y renombrado atómico) junto con su sidecar de metadatos, que lo
   * marca como origen «catalogo». Antes de renombrar vuelve a comprobar el SHA-256 de lo escrito.
   */
  escribirCatalogo(rel: string, bytes: Uint8Array, sha256: string, meta: Record<string, unknown>): void {
    if (!EXT_MID.test(rel)) throw new ErrorGrooves('Solo se escriben archivos .mid')
    if (bytes.byteLength > MAX_BYTES_MIDI || bytes.byteLength < 14) throw new ErrorGrooves('Tamaño de MIDI no válido')
    const abs = this.resolver(rel)
    this.silenciar++
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      const tmp = `${abs}.${process.pid}.tmp`
      fs.writeFileSync(tmp, bytes)
      try {
        const escrito = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex')
        if (escrito !== sha256) throw new ErrorGrooves('El archivo escrito no coincide con su huella')
        fs.renameSync(tmp, abs)
      } finally {
        fs.rmSync(tmp, { force: true })
      }
      this.escribirJson(abs.replace(EXT_MID, '.json'), { ...meta, origen: 'catalogo' })
      this.cache.delete(this.relativa(abs))
    } finally {
      this.silenciar--
    }
  }

  /** Quita un .mid del catálogo (y su sidecar): a la papelera si hay, y si no, se borra tal cual (nunca es del usuario). */
  async quitarCatalogo(rel: string): Promise<void> {
    const abs = this.resolver(rel)
    this.silenciar++
    try {
      for (const f of [abs, abs.replace(EXT_MID, '.json')]) {
        if (!fs.existsSync(f)) continue
        if (this.opts.papelera) await this.opts.papelera(f)
        else fs.rmSync(f, { force: true })
      }
      this.cache.delete(this.relativa(abs))
    } finally {
      this.silenciar--
    }
  }

  /** Convierte en grooves del usuario uno del catálogo que el usuario editó: nuevo id, origen «usuario». */
  conservarComoUsuario(rel: string, sha256Actual: string): { id: string } {
    const abs = this.resolver(rel)
    const id = `usr-${sha256Actual.slice(0, 12)}`
    const previo = (this.leerJson(abs.replace(EXT_MID, '.json')) ?? {}) as Record<string, unknown>
    this.silenciar++
    try {
      this.escribirJson(abs.replace(EXT_MID, '.json'), { ...previo, id, origen: 'usuario', revision: 1 })
    } finally {
      this.silenciar--
    }
    return { id }
  }

  // ── Escritura ─────────────────────────────────────────────────────────────

  private rutaLibre(carpetaAbs: string, base: string): string {
    let n = 1
    let nombre = `${base}.mid`
    while (fs.existsSync(path.join(carpetaAbs, nombre))) nombre = `${base}-${++n}.mid`
    return path.join(carpetaAbs, nombre)
  }

  /** Importa un .mid (bytes) al estilo/subestilo indicados. Devuelve la ruta relativa creada. */
  importarBytes(nombreOriginal: string, bytes: Uint8Array, estilo: string, subestilo?: string): { ruta: string } {
    if (bytes.byteLength > MAX_BYTES_MIDI) throw new ErrorGrooves('El archivo MIDI es demasiado grande (máx. 2 MB)')
    let resumen: ResumenMidi
    try {
      resumen = resumirMidi(bytes)
    } catch (e) {
      throw new ErrorGrooves(`«${nombreOriginal}» no es un MIDI válido: ${(e as Error).message}`)
    }
    if (resumen.notas === 0) throw new ErrorGrooves(`«${nombreOriginal}» no contiene notas`)
    const partes = [nombreSeguro(estilo), ...(subestilo ? [nombreSeguro(subestilo)] : [])]
    const carpeta = this.resolver(partes.join('/'))
    fs.mkdirSync(carpeta, { recursive: true })
    const base = nombreSeguro(String(nombreOriginal).replace(EXT_MID, ''), 80)
    const destino = this.rutaLibre(carpeta, base)
    fs.writeFileSync(destino, bytes, { flag: 'wx' })
    return { ruta: this.relativa(destino) }
  }

  /** Importa archivos del disco (diálogo o arrastre). `puedeLeer` valida cada ruta (path-grants). */
  importarRutas(rutas: string[], estilo: string, subestilo: string | undefined, puedeLeer: (p: string) => boolean) {
    const importados: string[] = []
    const errores: Array<{ archivo: string; error: string }> = []
    for (const r of rutas.slice(0, 500)) {
      try {
        if (!puedeLeer(r)) throw new ErrorGrooves('Sin permiso para leer ese archivo')
        if (!EXT_MID.test(r)) throw new ErrorGrooves('No es un archivo .mid')
        const st = fs.statSync(r)
        if (!st.isFile()) throw new ErrorGrooves('No es un archivo')
        if (st.size > MAX_BYTES_MIDI) throw new ErrorGrooves('Demasiado grande (máx. 2 MB)')
        importados.push(this.importarBytes(path.basename(r), new Uint8Array(fs.readFileSync(r)), estilo, subestilo).ruta)
      } catch (e) {
        errores.push({ archivo: path.basename(String(r)), error: (e as Error).message })
      }
    }
    return { importados, errores }
  }

  crearEstilo(estilo: string, subestilo?: string): { ruta: string } {
    const partes = [nombreSeguro(estilo), ...(subestilo ? [nombreSeguro(subestilo)] : [])]
    const abs = this.resolver(partes.join('/'))
    fs.mkdirSync(abs, { recursive: true })
    return { ruta: this.relativa(abs) }
  }

  renombrarEstilo(actual: string, nuevo: string): { ruta: string } {
    const rel = actual.replace(/\\/g, '/').split('/').filter(Boolean)
    if (!rel.length || rel.length > 2) throw new ErrorGrooves('Estilo no válido')
    const origen = this.resolver(rel.join('/'))
    if (!fs.existsSync(origen) || !fs.statSync(origen).isDirectory()) throw new ErrorGrooves('El estilo no existe')
    const destino = this.resolver([...rel.slice(0, -1), nombreSeguro(nuevo)].join('/'))
    if (fs.existsSync(destino)) throw new ErrorGrooves('Ya existe un estilo con ese nombre')
    fs.renameSync(origen, destino)
    this.actualizarRutasSync(this.relativa(origen), this.relativa(destino))
    return { ruta: this.relativa(destino) }
  }

  private actualizarRutasSync(antes: string, despues: string): void {
    const sync = this.leerSync()
    let cambio = false
    for (const g of sync.grooves) {
      if (g.ruta === antes || g.ruta.startsWith(antes + '/')) {
        g.ruta = despues + g.ruta.slice(antes.length)
        cambio = true
      }
    }
    if (cambio) this.escribirJson(path.join(this.raiz, '.sync.json'), sync)
  }

  /** Mueve un groove (y su sidecar) a la papelera. */
  async borrar(rel: string): Promise<void> {
    const abs = this.resolver(rel)
    if (!EXT_MID.test(abs) || !fs.existsSync(abs)) throw new ErrorGrooves('El groove no existe')
    if (!this.opts.papelera) throw new ErrorGrooves('No hay papelera disponible: no se borra definitivamente')
    await this.opts.papelera(abs)
    const sidecar = abs.replace(EXT_MID, '.json')
    if (fs.existsSync(sidecar)) await this.opts.papelera(sidecar)
    this.cache.delete(this.relativa(abs))
  }

  /** Mueve una carpeta de estilo entera a la papelera. */
  async borrarEstilo(rel: string): Promise<void> {
    const partes = rel.replace(/\\/g, '/').split('/').filter(Boolean)
    if (!partes.length || partes.length > 2) throw new ErrorGrooves('Estilo no válido')
    const abs = this.resolver(partes.join('/'))
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new ErrorGrooves('El estilo no existe')
    if (!this.opts.papelera) throw new ErrorGrooves('No hay papelera disponible: no se borra definitivamente')
    await this.opts.papelera(abs)
  }
}

/** Lista archivos (rutas relativas con «/») sin entrar en carpetas ocultas. */
export function listarArchivos(raiz: string, max = MAX_ARCHIVOS): string[] {
  const out: string[] = []
  const visitar = (dir: string, prefijo: string, profundidad: number) => {
    if (profundidad > 4 || out.length >= max) return
    let entradas: fs.Dirent[]
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entradas.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entradas) {
      if (e.name.startsWith('.')) continue
      const rel = prefijo ? `${prefijo}/${e.name}` : e.name
      if (e.isDirectory()) visitar(path.join(dir, e.name), rel, profundidad + 1)
      else if (e.isFile()) out.push(rel)
      if (out.length >= max) return
    }
  }
  visitar(raiz, '', 0)
  return out
}

/** Carpeta de grooves del usuario. */
export function carpetaDeGrooves(env: NodeJS.ProcessEnv, appData: string): string {
  return env.JASWAVE_GROOVES_DIR && env.JASWAVE_GROOVES_DIR.trim() ? env.JASWAVE_GROOVES_DIR : path.join(appData, 'JasWave', 'grooves')
}
