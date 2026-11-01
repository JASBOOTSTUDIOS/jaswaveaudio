/**
 * Configuración del agente al estilo de un IDE con IA:
 *  - Carpeta de configuración del usuario (`carpetaAsistente`, archivos Markdown que puede editar a mano
 *    o con ayuda de la IA en /configurar): `reglas.md`, `habilidades/`, `prompts/` y `planes/`.
 *  - Reglas aprendidas del proyecto (`conocimiento.md`) y `AGENTS.md` del proyecto.
 *  - Habilidades del proyecto: documentos `habilidad-*.md`.
 *  - Agentes: los especialistas (`especialistas-storage.ts`) actúan como subagentes.
 * El agente ve la lista de habilidades, prompts y planes, y lee el completo solo cuando lo necesita.
 */
import {
  CONOCIMIENTO_SLUG,
  RUTA_REGLAS,
  carpetaAsistente,
  escribirDocumentoAsistente,
  getAgentDoc,
  leerDocumentoAsistente,
  listAgentDocs,
  rutaAsistente,
  rutaAsistenteValida,
  slugAsistente,
} from '@jaswave/host-sdk'
import type { ArchivoAsistente, CarpetaAsistente } from '@jaswave/host-sdk'

export type HabilidadUsuario = {
  id: string
  nombre: string
  /** Cuándo usarla: el agente decide con esto si la lee. */
  descripcion: string
  instrucciones: string
  activa: boolean
}

export type ConfigAgenteUsuario = {
  version: 1
  reglas: string
  habilidades: HabilidadUsuario[]
}

export type HabilidadDisponible = HabilidadUsuario & { origen: 'usuario' | 'proyecto' }

/** Habilidad, prompt o plan de la carpeta de configuración (`id` = ruta del archivo). */
export type DocumentoConfig = HabilidadUsuario & { carpeta: CarpetaAsistente }

/** Configuración antigua (antes de la carpeta): solo se lee para migrarla. */
const CLAVE_ANTIGUA = 'jaswave-agente-config-v1'
const CLAVE_MIGRADA = 'jaswave-agente-config-migrada-v1'
export const AGENTS_SLUG = 'agents.md'
export const PREFIJO_DOC_HABILIDAD = 'habilidad-'
export { EVENTO_CARPETA_ASISTENTE as EVENTO_CONFIG_AGENTE } from '@jaswave/host-sdk'

const MAX_REGLAS = 6000
const MAX_AGENTS_MD = 8000
const MAX_INSTRUCCIONES = 12000

export const NOMBRE_CARPETA: Record<CarpetaAsistente, { singular: string; plural: string }> = {
  habilidades: { singular: 'habilidad', plural: 'habilidades' },
  prompts: { singular: 'prompt', plural: 'prompts' },
  planes: { singular: 'plan', plural: 'planes' },
}

function normalizarHabilidad(raw: unknown): HabilidadUsuario | null {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as Partial<HabilidadUsuario>
  const nombre = String(h.nombre ?? '').trim().slice(0, 80)
  if (!nombre) return null
  return {
    id: String(h.id || `hab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
    nombre,
    descripcion: String(h.descripcion ?? '').trim().slice(0, 300),
    instrucciones: String(h.instrucciones ?? '').slice(0, MAX_INSTRUCCIONES),
    activa: h.activa !== false,
  }
}

function documentoDesdeArchivo(a: ArchivoAsistente): DocumentoConfig | null {
  if (!a.carpeta) return null
  const d = leerDocumentoAsistente(a.contenido, a.nombre)
  return { id: a.ruta, carpeta: a.carpeta, nombre: d.titulo, descripcion: d.descripcion, instrucciones: d.cuerpo.slice(0, MAX_INSTRUCCIONES), activa: d.activo }
}

/** Habilidades, prompts o planes de la carpeta (en orden de archivo). */
export function documentosConfig(carpeta: CarpetaAsistente): DocumentoConfig[] {
  return carpetaAsistente
    .archivos()
    .filter((a) => a.carpeta === carpeta)
    .map(documentoDesdeArchivo)
    .filter((d): d is DocumentoConfig => !!d)
}

function cargarAntigua(): ConfigAgenteUsuario | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CLAVE_ANTIGUA) : null
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<ConfigAgenteUsuario>
    return {
      version: 1,
      reglas: String(p.reglas ?? '').slice(0, MAX_REGLAS),
      habilidades: (Array.isArray(p.habilidades) ? p.habilidades : []).map(normalizarHabilidad).filter((h): h is HabilidadUsuario => !!h),
    }
  } catch {
    return null
  }
}

export function cargarConfigAgente(): ConfigAgenteUsuario {
  if (!carpetaAsistente.lista) return cargarAntigua() ?? { version: 1, reglas: '', habilidades: [] }
  return {
    version: 1,
    reglas: (carpetaAsistente.archivo(RUTA_REGLAS)?.contenido ?? '').slice(0, MAX_REGLAS),
    habilidades: documentosConfig('habilidades').map(({ carpeta: _c, ...h }) => h),
  }
}

/** Ruta del archivo de un documento: conserva la suya; si es nuevo, una a partir del nombre que no pise otro. */
function rutaPara(carpeta: CarpetaAsistente, d: Pick<HabilidadUsuario, 'id' | 'nombre'>, ocupadas: Set<string>): string {
  const propia = rutaAsistenteValida(d.id)
  if (propia?.startsWith(`${carpeta}/`)) return propia
  let ruta = rutaAsistente(carpeta, d.nombre)
  for (let i = 2; ocupadas.has(ruta); i++) ruta = rutaAsistente(carpeta, `${d.nombre}-${i}`)
  return ruta
}

/** Guarda una lista completa de documentos de una carpeta: escribe los cambiados y elimina los quitados. */
export async function guardarDocumentosConfig(carpeta: CarpetaAsistente, lista: HabilidadUsuario[]): Promise<void> {
  const previos = documentosConfig(carpeta)
  const ocupadas = new Set(previos.map((d) => d.id))
  const conservadas = new Set<string>()
  for (const raw of lista) {
    const h = normalizarHabilidad(raw)
    if (!h) continue
    const ruta = rutaPara(carpeta, h, ocupadas)
    ocupadas.add(ruta)
    conservadas.add(ruta)
    const texto = escribirDocumentoAsistente({ titulo: h.nombre, descripcion: h.descripcion, activo: h.activa, cuerpo: h.instrucciones })
    if (carpetaAsistente.archivo(ruta)?.contenido !== texto) await carpetaAsistente.escribir(ruta, texto)
  }
  for (const p of previos) if (!conservadas.has(p.id)) await carpetaAsistente.eliminar(p.id)
}

export async function guardarConfigAgente(c: ConfigAgenteUsuario): Promise<void> {
  await prepararConfigAgente()
  const reglas = c.reglas.slice(0, MAX_REGLAS)
  if ((carpetaAsistente.archivo(RUTA_REGLAS)?.contenido ?? '') !== reglas) {
    if (reglas.trim()) await carpetaAsistente.escribir(RUTA_REGLAS, reglas)
    else if (carpetaAsistente.archivo(RUTA_REGLAS)) await carpetaAsistente.eliminar(RUTA_REGLAS)
  }
  await guardarDocumentosConfig('habilidades', c.habilidades)
}

let preparada: Promise<void> | null = null

/**
 * Lee la carpeta (incluidos cambios hechos a mano) y, la primera vez, pasa a ella la configuración que
 * estaba guardada antes en el navegador. Se llama al abrir el panel y al empezar cada turno.
 */
export function prepararConfigAgente(): Promise<void> {
  const p = (async () => {
    if (preparada) await preparada.catch(() => undefined)
    await carpetaAsistente.cargar()
    let migrada = true
    try {
      migrada = localStorage.getItem(CLAVE_MIGRADA) === '1'
    } catch {
      /* sin almacenamiento: nada que migrar */
    }
    if (migrada) return
    const antigua = cargarAntigua()
    if (antigua && carpetaAsistente.archivos().length === 0) {
      if (antigua.reglas.trim()) await carpetaAsistente.escribir(RUTA_REGLAS, antigua.reglas)
      await guardarDocumentosConfig('habilidades', antigua.habilidades)
    }
    try {
      localStorage.setItem(CLAVE_MIGRADA, '1')
    } catch {
      /* sin almacenamiento */
    }
  })()
  preparada = p
  return p
}

/**
 * Habilidad guardada como documento del proyecto: `# Nombre`, una línea `> descripción` y el resto son
 * las instrucciones. Así se editan desde el panel Docs y viajan con el proyecto.
 */
export function habilidadDesdeDoc(slug: string, contenido: string): HabilidadUsuario | null {
  const d = leerDocumentoAsistente(contenido, slug.replace(PREFIJO_DOC_HABILIDAD, '').replace(/\.md$/i, ''))
  if (!d.titulo || !d.cuerpo) return null
  return { id: `doc:${slug}`, nombre: d.titulo, descripcion: d.descripcion, instrucciones: d.cuerpo.slice(0, MAX_INSTRUCCIONES), activa: true }
}

export function habilidadesDisponiblesAgente(projectId: string, config = cargarConfigAgente()): HabilidadDisponible[] {
  const out: HabilidadDisponible[] = config.habilidades.filter((h) => h.activa).map((h) => ({ ...h, origen: 'usuario' as const }))
  try {
    for (const d of listAgentDocs(projectId)) {
      if (!d.slug.startsWith(PREFIJO_DOC_HABILIDAD)) continue
      const h = habilidadDesdeDoc(d.slug, d.content)
      if (h) out.push({ ...h, origen: 'proyecto' })
    }
  } catch {
    /* docs no disponibles */
  }
  return out
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Busca una habilidad por nombre o id, tolerando mayúsculas y acentos. */
export function buscarHabilidadAgente<T extends HabilidadUsuario>(lista: T[], nombre: string): T | undefined {
  const q = normal(nombre)
  if (!q) return undefined
  return (
    lista.find((h) => normal(h.nombre) === q || normal(h.id) === q || slugAsistente(h.nombre) === slugAsistente(nombre)) ??
    lista.find((h) => normal(h.nombre).includes(q) || q.includes(normal(h.nombre)))
  )
}

function recortar(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Bloque de instrucciones del usuario y del proyecto para el sistema del agente. */
export function instruccionesConfiguradas(projectId: string, config = cargarConfigAgente()): string {
  const partes: string[] = []
  if (config.reglas.trim()) partes.push(`## Reglas del usuario (síguelas siempre)\n${recortar(config.reglas, MAX_REGLAS)}`)
  try {
    const agents = getAgentDoc(projectId, AGENTS_SLUG)?.content
    if (agents?.trim()) partes.push(`## AGENTS.md del proyecto\n${recortar(agents, MAX_AGENTS_MD)}`)
    const conocimiento = getAgentDoc(projectId, CONOCIMIENTO_SLUG)?.content
    if (conocimiento?.trim()) partes.push(`## Conocimiento y reglas aprendidas del proyecto\n${recortar(conocimiento, 4000)}`)
  } catch {
    /* docs no disponibles */
  }
  const habilidades = habilidadesDisponiblesAgente(projectId, config)
  if (habilidades.length) {
    partes.push(
      [
        '## Habilidades del usuario',
        'Si el pedido encaja con una, léela con `leer_habilidad` antes de actuar y sigue sus instrucciones.',
        ...habilidades.slice(0, 30).map((h) => `- ${h.nombre}: ${h.descripcion || 'sin descripción'}`),
      ].join('\n'),
    )
  }
  for (const carpeta of ['prompts', 'planes'] as const) {
    const docs = carpetaAsistente.lista ? documentosConfig(carpeta).filter((d) => d.activa) : []
    if (!docs.length) continue
    partes.push(
      [
        `## ${carpeta === 'prompts' ? 'Prompts guardados del usuario' : 'Planes guardados del usuario'}`,
        `Si el usuario nombra uno o el pedido encaja, léelo con \`config_leer\` (carpeta «${carpeta}») y síguelo.`,
        ...docs.slice(0, 30).map((d) => `- ${d.nombre}: ${d.descripcion || 'sin descripción'}`),
      ].join('\n'),
    )
  }
  return partes.join('\n\n')
}
