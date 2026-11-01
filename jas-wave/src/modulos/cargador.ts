/**
 * Carga de módulos instalables (M3).
 *
 * - Escritorio: paquetes instalados en el equipo (o, en desarrollo, los de plugins/ del repositorio).
 *   El proceso main los sirve por `jaswave-modulo://<id>/<ruta>` solo si su integridad es correcta.
 * - Web: módulos publicados en el catálogo del backend, servidos en URLs versionadas e inmutables
 *   (`<api>/modulos/<id>/<versión>/<ruta>`).
 *
 * En ambos casos el código se evalúa con `import()` (la CSP solo permite esos orígenes) y su hoja de
 * estilos se añade al documento. El módulo exporta por defecto `definirModulo(...)`.
 */

import type { DefinicionModulo } from '@jaswave/host-sdk/contrato'
import type { ManifiestoPlugin } from '@jaswave/shared'
import { quitarModulo, registrarModulo, listarModulos } from './registro-modulos'

export const PROTOCOLO_MODULOS = 'jaswave-modulo:'

export function esModulo(m: Pick<ManifiestoPlugin, 'category' | 'entrypoints'>): boolean {
  return (m.category === 'ui-extension' || m.category === 'ai-skill') && Boolean(m.entrypoints.ui)
}

const estilos = new Map<string, HTMLLinkElement>()

function cargarEstilos(id: string, url: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  estilos.get(id)?.remove()
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.dataset.moduloJaswave = id
  estilos.set(id, link)
  return new Promise((ok) => {
    link.onload = () => ok()
    // Sin estilos el módulo sigue funcionando (con los del DAW).
    link.onerror = () => ok()
    document.head.appendChild(link)
  })
}

/** Importa el ESM del módulo y devuelve su definición. */
export async function importarModulo(id: string, urlCodigo: string, urlEstilos?: string): Promise<DefinicionModulo> {
  if (urlEstilos) await cargarEstilos(id, urlEstilos)
  const mod = (await import(/* @vite-ignore */ urlCodigo)) as { default?: DefinicionModulo }
  if (!mod.default) throw new Error('el paquete no exporta un módulo por defecto')
  return mod.default
}

function urlInstalado(id: string, ruta: string): string {
  return `${PROTOCOLO_MODULOS}//${encodeURIComponent(id)}/${ruta.split('/').map(encodeURIComponent).join('/')}`
}

/** Registra los módulos de los paquetes instalados (escritorio) y quita los que ya no están. */
export function sincronizarModulosInstalados(paquetes: { manifiesto: ManifiestoPlugin }[]): void {
  const vigentes = new Set<string>()
  for (const { manifiesto: m } of paquetes) {
    if (!esModulo(m) || !m.targetPlatforms.includes('win-x64')) continue
    vigentes.add(m.id)
    const ui = m.entrypoints.ui!
    const css = m.entrypoints.uiEstilos
    void registrarModulo({
      id: m.id,
      nombre: m.name,
      descripcion: m.description,
      version: m.version,
      origen: 'instalado',
      cargar: () => importarModulo(m.id, urlInstalado(m.id, ui), css ? urlInstalado(m.id, css) : undefined),
    })
  }
  for (const v of listarModulos()) if (v.fuente.origen === 'instalado' && !vigentes.has(v.fuente.id)) quitarModulo(v.fuente.id)
}

/** Entrada del catálogo web de módulos (backend `/catalogo`). */
export type ModuloCatalogo = {
  id: string
  nombre: string
  descripcion?: string
  version: string
  categoria?: string
  plataformas?: string[]
  ui?: string
  uiEstilos?: string
}

/** Web: registra los módulos del catálogo del backend (se descargan al activarlos). */
export function sincronizarModulosCatalogo(apiBase: string, entradas: ModuloCatalogo[]): void {
  const base = apiBase.replace(/\/+$/, '')
  const vigentes = new Set<string>()
  for (const e of entradas) {
    if (!e.ui || !(e.plataformas ?? []).includes('web') || !(e.categoria === 'ui-extension' || e.categoria === 'ai-skill')) continue
    vigentes.add(e.id)
    const url = (ruta: string) =>
      `${base}/modulos/${encodeURIComponent(e.id)}/${encodeURIComponent(e.version)}/${ruta.split('/').map(encodeURIComponent).join('/')}`
    const ui = e.ui
    const css = e.uiEstilos
    void registrarModulo({
      id: e.id,
      nombre: e.nombre,
      descripcion: e.descripcion ?? '',
      version: e.version,
      origen: 'catalogo',
      cargar: () => importarModulo(e.id, url(ui), css ? url(css) : undefined),
    })
  }
  for (const v of listarModulos()) if (v.fuente.origen === 'catalogo' && !vigentes.has(v.fuente.id)) quitarModulo(v.fuente.id)
}
