/**
 * Carpeta de configuración del asistente vista desde el renderer.
 *
 * En el escritorio son archivos reales en `<userData>/asistente/` (main: `electron/asistente-config.ts`),
 * que el usuario puede abrir y editar con cualquier editor. En la web (o sin Electron) se guardan en el
 * navegador con la misma forma. La caché permite leer de forma síncrona en cada turno del asistente.
 *
 * Formato común de habilidades, prompts y planes:
 *
 *   # Nombre
 *   > Cuándo usarla / para qué sirve
 *   <!-- desactivada -->        (opcional)
 *
 *   Contenido…
 */

export type CarpetaAsistente = 'habilidades' | 'prompts' | 'planes'
export const CARPETAS_ASISTENTE: readonly CarpetaAsistente[] = ['habilidades', 'prompts', 'planes']
export const RUTA_REGLAS = 'reglas.md'
export const EVENTO_CARPETA_ASISTENTE = 'jaswave-asistente-carpeta-cambiada'
const MAX_BYTES = 64 * 1024
const CLAVE_WEB = 'jaswave-asistente-carpeta-v1'

export type ArchivoAsistente = {
  ruta: string
  carpeta: CarpetaAsistente | null
  nombre: string
  contenido: string
  modificado: number
}

export type ResultadoCarpeta = { ok: boolean; error?: string }

/** Lo que expone el preload (`window.electron.asistenteCarpeta`). */
export type PuenteCarpetaAsistente = {
  listar: () => Promise<{ ok: boolean; archivos?: ArchivoAsistente[]; carpeta?: string; error?: string }>
  escribir: (ruta: string, contenido: string) => Promise<ResultadoCarpeta>
  eliminar: (ruta: string) => Promise<ResultadoCarpeta & { existia?: boolean }>
  restaurar: (ruta: string) => Promise<ResultadoCarpeta & { restaurado?: boolean }>
  abrir: () => Promise<ResultadoCarpeta>
}

const RE_RUTA = /^(?:reglas\.md|(?:habilidades|prompts|planes)\/[a-z0-9][a-z0-9-]{0,63}\.md)$/

export function rutaAsistenteValida(rel: unknown): string | null {
  if (typeof rel !== 'string') return null
  const r = rel.trim().replace(/\\/g, '/').toLowerCase()
  return RE_RUTA.test(r) ? r : null
}

export function slugAsistente(nombre: string): string {
  return (
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/, '') || 'sin-nombre'
  )
}

export function rutaAsistente(carpeta: CarpetaAsistente, nombre: string): string {
  return `${carpeta}/${slugAsistente(nombre)}.md`
}

export type DocumentoAsistente = { titulo: string; descripcion: string; activo: boolean; cuerpo: string }

const RE_DESACTIVADA = /^<!--\s*desactivad[ao]\s*-->$/i

export function leerDocumentoAsistente(contenido: string, nombreArchivo = ''): DocumentoAsistente {
  const lineas = contenido.replace(/\r\n/g, '\n').split('\n')
  let titulo = ''
  let descripcion = ''
  let activo = true
  const cuerpo: string[] = []
  let cabecera = true
  for (const l of lineas) {
    if (cabecera && !titulo && /^#\s+/.test(l)) titulo = l.replace(/^#\s+/, '').trim()
    else if (cabecera && !descripcion && /^>\s*/.test(l)) descripcion = l.replace(/^>\s*/, '').trim()
    else if (cabecera && RE_DESACTIVADA.test(l.trim())) activo = false
    else if (cabecera && !l.trim()) continue
    else {
      cabecera = false
      cuerpo.push(l)
    }
  }
  return {
    titulo: titulo || nombreArchivo.replace(/-/g, ' '),
    descripcion,
    activo,
    cuerpo: cuerpo.join('\n').trim(),
  }
}

export function escribirDocumentoAsistente(d: DocumentoAsistente): string {
  return [
    `# ${d.titulo.trim() || 'Sin nombre'}`,
    d.descripcion.trim() ? `> ${d.descripcion.trim().replace(/\n+/g, ' ')}` : '',
    d.activo ? '' : '<!-- desactivada -->',
    '',
    d.cuerpo.trim(),
    '',
  ]
    .filter((l, i) => l !== '' || i >= 3)
    .join('\n')
}

// ── Almacén ───────────────────────────────────────────────────────────────

function puente(): PuenteCarpetaAsistente | null {
  const w = typeof window !== 'undefined' ? (window as unknown as { electron?: { asistenteCarpeta?: PuenteCarpetaAsistente } }) : null
  return w?.electron?.asistenteCarpeta ?? null
}

function leerWeb(): Record<string, { contenido: string; modificado: number }> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CLAVE_WEB) : null
    const p = raw ? (JSON.parse(raw) as unknown) : null
    return p && typeof p === 'object' ? (p as Record<string, { contenido: string; modificado: number }>) : {}
  } catch {
    return {}
  }
}

function guardarWeb(m: Record<string, { contenido: string; modificado: number }>): void {
  try {
    localStorage.setItem(CLAVE_WEB, JSON.stringify(m))
  } catch {
    /* sin almacenamiento */
  }
}

function carpetaDe(ruta: string): CarpetaAsistente | null {
  const c = ruta.split('/')[0]
  return (CARPETAS_ASISTENTE as readonly string[]).includes(c ?? '') ? (c as CarpetaAsistente) : null
}

function archivoWeb(ruta: string, v: { contenido: string; modificado: number }): ArchivoAsistente {
  return { ruta, carpeta: carpetaDe(ruta), nombre: ruta.split('/').pop()!.replace(/\.md$/, ''), contenido: v.contenido, modificado: v.modificado }
}

class AlmacenCarpetaAsistente {
  private cache: ArchivoAsistente[] = []
  private cargada = false
  private enCurso: Promise<void> | null = null
  private papeleraWeb = new Map<string, string>()
  ubicacion = ''

  /** ¿Hay archivos reales en disco (escritorio)? */
  get enDisco(): boolean {
    return puente() !== null
  }

  get lista(): boolean {
    return this.cargada
  }

  /** Copia síncrona de lo último leído (vacía hasta la primera carga). */
  archivos(): ArchivoAsistente[] {
    return this.cache
  }

  archivo(ruta: string): ArchivoAsistente | undefined {
    const r = rutaAsistenteValida(ruta)
    return r ? this.cache.find((a) => a.ruta === r) : undefined
  }

  /** Relee la carpeta (cambios hechos a mano fuera de la app incluidos). */
  cargar(): Promise<void> {
    if (this.enCurso) return this.enCurso
    this.enCurso = (async () => {
      const p = puente()
      if (p) {
        const r = await p.listar().catch((e: unknown) => ({ ok: false, error: String(e) }) as Awaited<ReturnType<PuenteCarpetaAsistente['listar']>>)
        if (r.ok && r.archivos) {
          this.cache = r.archivos
          this.ubicacion = r.carpeta ?? ''
        }
      } else {
        const m = leerWeb()
        this.cache = Object.keys(m)
          .filter((k) => rutaAsistenteValida(k) === k)
          .sort((a, b) => (a === RUTA_REGLAS ? -1 : b === RUTA_REGLAS ? 1 : a.localeCompare(b)))
          .map((k) => archivoWeb(k, m[k]!))
      }
      this.cargada = true
    })().finally(() => {
      this.enCurso = null
    })
    return this.enCurso
  }

  private avisar(): void {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(EVENTO_CARPETA_ASISTENTE))
    }
  }

  async escribir(ruta: string, contenido: string): Promise<ArchivoAsistente> {
    const r = rutaAsistenteValida(ruta)
    if (!r) throw new Error('Nombre de archivo no válido: usa reglas.md o habilidades/, prompts/ o planes/ con un nombre sencillo')
    if (new TextEncoder().encode(contenido).byteLength > MAX_BYTES) throw new Error('El archivo es demasiado grande (máx. 64 KB)')
    const p = puente()
    if (p) {
      const res = await p.escribir(r, contenido)
      if (!res.ok) throw new Error(res.error ?? 'No se pudo guardar el archivo')
    } else {
      const m = leerWeb()
      m[r] = { contenido, modificado: Date.now() }
      guardarWeb(m)
    }
    const nuevo = archivoWeb(r, { contenido, modificado: Date.now() })
    this.cache = [...this.cache.filter((a) => a.ruta !== r), nuevo].sort((a, b) =>
      a.ruta === RUTA_REGLAS ? -1 : b.ruta === RUTA_REGLAS ? 1 : a.ruta.localeCompare(b.ruta),
    )
    this.cargada = true
    this.avisar()
    return nuevo
  }

  /** Mueve el archivo a la papelera (recuperable con `restaurar`). */
  async eliminar(ruta: string): Promise<boolean> {
    const r = rutaAsistenteValida(ruta)
    if (!r) throw new Error('Nombre de archivo no válido')
    const p = puente()
    let existia: boolean
    if (p) {
      const res = await p.eliminar(r)
      if (!res.ok) throw new Error(res.error ?? 'No se pudo eliminar el archivo')
      existia = res.existia !== false
    } else {
      const m = leerWeb()
      existia = r in m
      if (existia) this.papeleraWeb.set(r, m[r]!.contenido)
      delete m[r]
      guardarWeb(m)
    }
    this.cache = this.cache.filter((a) => a.ruta !== r)
    this.avisar()
    return existia
  }

  async restaurar(ruta: string): Promise<boolean> {
    const r = rutaAsistenteValida(ruta)
    if (!r) throw new Error('Nombre de archivo no válido')
    const p = puente()
    if (p) {
      const res = await p.restaurar(r)
      if (!res.ok) throw new Error(res.error ?? 'No se pudo recuperar el archivo')
      await this.cargar()
      this.avisar()
      return res.restaurado === true
    }
    const previo = this.papeleraWeb.get(r)
    if (previo === undefined) return false
    this.papeleraWeb.delete(r)
    await this.escribir(r, previo)
    return true
  }

  async abrirEnExplorador(): Promise<boolean> {
    const p = puente()
    if (!p) return false
    const r = await p.abrir()
    return r.ok
  }

  /** Solo tests. */
  reiniciar(): void {
    this.cache = []
    this.cargada = false
    this.papeleraWeb.clear()
  }
}

export const carpetaAsistente = new AlmacenCarpetaAsistente()
