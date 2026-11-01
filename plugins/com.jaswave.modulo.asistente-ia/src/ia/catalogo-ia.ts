/**
 * Catálogo de IA del usuario (M2): proveedores y modelos que el admin le permite (por rol) más sus
 * modelos propios (si tiene `ia.modelo-propio`). La fuente es el backend (`GET /ia/proveedores`); aquí
 * se guarda una copia sin claves para mostrar el selector sin red. Las claves nunca pasan por aquí.
 */

import { puenteIAEscritorio } from '@jaswave/host-sdk'
import type { PermisosIAApi, ProveedorIAApi } from '@jaswave/host-sdk'

export type CatalogoIA = { permisos: PermisosIAApi; proveedores: ProveedorIAApi[]; actualizado: number }

const CLAVE = 'jaswave-ia-catalogo-v1'
export const EVENTO_CATALOGO_IA = 'jaswave-ai-settings-changed'

const VACIO: CatalogoIA = { permisos: { usar: false, modeloPropio: false, proveedores: [] }, proveedores: [], actualizado: 0 }

let actual: CatalogoIA | null = null

function leer(): CatalogoIA {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CLAVE) : null
    if (!raw) return VACIO
    const p = JSON.parse(raw) as Partial<CatalogoIA>
    if (!p.permisos || !Array.isArray(p.proveedores)) return VACIO
    return { permisos: p.permisos, proveedores: p.proveedores, actualizado: Number(p.actualizado) || 0 }
  } catch {
    return VACIO
  }
}

export function catalogoIA(): CatalogoIA {
  return (actual ??= leer())
}

export function proveedorDelCatalogo(id: string | undefined): ProveedorIAApi | undefined {
  return id ? catalogoIA().proveedores.find((p) => p.id === id) : undefined
}

/** True si el proveedor es propio y se ejecuta en el equipo del usuario (solo escritorio). */
export function esProveedorLocal(p: ProveedorIAApi | undefined): boolean {
  return p?.origen === 'propio' && p.ejecucion === 'local'
}

/** Reemplaza el catálogo (tras pedirlo al backend, o en pruebas) y avisa a la UI. */
export function fijarCatalogoIA(c: Omit<CatalogoIA, 'actualizado'> & { actualizado?: number }): CatalogoIA {
  const previos = new Set(catalogoIA().proveedores.filter(esProveedorLocal).map((p) => p.id))
  actual = { ...c, actualizado: c.actualizado ?? Date.now() }
  try {
    localStorage.setItem(CLAVE, JSON.stringify(actual))
  } catch {
    /* sin almacenamiento: queda en memoria */
  }
  // Si un modelo propio desaparece (borrado o permiso retirado) se borra su credencial del equipo.
  const vigentes = new Set(actual.proveedores.filter(esProveedorLocal).map((p) => p.id))
  for (const id of previos) if (!vigentes.has(id)) olvidarCredencialLocal(id)
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_CATALOGO_IA))
  }
  return actual
}

/** Pide el catálogo al backend. Sin sesión o sin backend deja el catálogo vacío. */
/**
 * Pruebas (JasWave Desktop arrancado con JASWAVE_AI_MOCK): un único proveedor simulado que responde el
 * gateway local con un guion determinista. No usa backend, red ni claves.
 */
export const PROVEEDOR_PRUEBAS: ProveedorIAApi = {
  id: 'pruebas-mock',
  slug: 'pruebas-mock',
  nombre: 'Simulado (pruebas)',
  tipo: 'mock',
  baseUrl: 'mock://local',
  modelos: ['mock'],
  modeloPorDefecto: 'mock',
  maxTokens: 4096,
  herramientas: true,
  origen: 'propio',
  ejecucion: 'local',
  activo: true,
  tieneClave: false,
}

export async function refrescarCatalogoIA(
  pedir?: () => Promise<{ permisos: PermisosIAApi; proveedores: ProveedorIAApi[] }>,
): Promise<CatalogoIA> {
  const obtener =
    pedir ??
    (async () => {
      if (await puenteIAEscritorio()?.modoPruebas()) {
        return { permisos: { usar: true, modeloPropio: true, proveedores: [] }, proveedores: [PROVEEDOR_PRUEBAS] }
      }
      const { apiJasWave, tokenSesion } = await import('@jaswave/host-sdk')
      if (!(await tokenSesion())) return { permisos: VACIO.permisos, proveedores: [] }
      return apiJasWave().ia.proveedores()
    })
  try {
    return fijarCatalogoIA(await obtener())
  } catch (e) {
    const estado = (e as { estado?: number }).estado
    // 401/403: la cuenta ya no tiene acceso → catálogo vacío. Sin red: se conserva la copia.
    if (estado === 401 || estado === 403) return fijarCatalogoIA({ permisos: VACIO.permisos, proveedores: [] })
    throw e
  }
}

// ---------- Credenciales de modelos propios locales (escritorio) ----------

const credencialesListas = new Map<string, number>()
const VIGENCIA_CREDENCIAL_MS = 10 * 60_000

export function olvidarCredencialLocal(id: string): void {
  credencialesListas.delete(id)
  void puenteIAEscritorio()?.guardarCredencial(id, '')
}

/**
 * Antes de ejecutar un modelo propio en el escritorio: trae su clave del backend y la deja en el almacén
 * cifrado de Electron (main la inyecta por providerId; el renderer no la conserva). Sin backend se usa la
 * que ya hubiera (uso sin conexión). Si el backend responde 403/404 se borra y se informa.
 */
export async function prepararCredencialLocal(
  p: ProveedorIAApi,
  pedir?: (id: string) => Promise<ProveedorIAApi & { apiKey?: string }>,
): Promise<{ ok: true; proveedor: ProveedorIAApi } | { ok: false; error: string; estado?: number }> {
  if (p.tipo === 'mock') return { ok: true, proveedor: p }
  const lista = credencialesListas.get(p.id)
  if (lista && Date.now() - lista < VIGENCIA_CREDENCIAL_MS) return { ok: true, proveedor: p }
  try {
    const obtener =
      pedir ??
      (async (id: string) => {
        const { apiJasWave, tokenSesion } = await import('@jaswave/host-sdk')
        if (!(await tokenSesion())) throw Object.assign(new Error('sin sesión'), { estado: 0 })
        return apiJasWave().ia.credencialLocal(id)
      })
    const cred = await obtener(p.id)
    await puenteIAEscritorio()?.guardarCredencial(p.id, cred.apiKey ?? '')
    credencialesListas.set(p.id, Date.now())
    const { apiKey: _apiKey, ...publico } = cred
    return { ok: true, proveedor: publico }
  } catch (e) {
    const estado = (e as { estado?: number }).estado
    if (estado === 403 || estado === 404) {
      olvidarCredencialLocal(p.id)
      return { ok: false, estado, error: (e as Error).message || 'sin permiso para este modelo' }
    }
    // Sin conexión con el backend: se intenta con la credencial guardada en el equipo.
    return { ok: true, proveedor: p }
  }
}
