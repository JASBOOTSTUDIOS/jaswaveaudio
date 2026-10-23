/**
 * Arranque de módulos (M3): instala el runtime del SDK y registra los módulos disponibles.
 * - Escritorio: los paquetes instalados llegan con el escaneo de plugins (cargarPluginsInstalados).
 * - Web: catálogo firmado del backend; la firma Ed25519 se verifica aquí con WebCrypto antes de usarlo.
 */

import { configBackend } from '../lib/backend/config'
import { sincronizarModulosCatalogo, type ModuloCatalogo } from './cargador'
import { CLAVE_PUBLICA_CATALOGO } from './clave-catalogo'
import { registrarModulosIntegrados } from './integrados'
import { instalarSdkHost } from './sdk-host'

function base64urlABytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function pemADer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Verifica `jwc1.<payload>.<firma>` y devuelve el catálogo; lanza si la firma no es válida. */
export async function verificarCatalogoWeb(token: string, clavePem = CLAVE_PUBLICA_CATALOGO): Promise<{ paquetes: ModuloCatalogo[] }> {
  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== 'jwc1') throw new Error('catálogo con formato inválido')
  const [, payload, firma] = partes as [string, string, string]
  const clave = await crypto.subtle.importKey('spki', pemADer(clavePem) as BufferSource, { name: 'Ed25519' }, false, ['verify'])
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, clave, base64urlABytes(firma) as BufferSource, new TextEncoder().encode(`jwc1.${payload}`))
  if (!ok) throw new Error('la firma del catálogo no es válida')
  const catalogo = JSON.parse(new TextDecoder().decode(base64urlABytes(payload))) as { paquetes?: ModuloCatalogo[] }
  if (!Array.isArray(catalogo.paquetes)) throw new Error('catálogo sin paquetes')
  return { paquetes: catalogo.paquetes }
}

/** Web: pide el catálogo y registra sus módulos con plataforma web. */
export async function sincronizarCatalogoWeb(apiBase = configBackend().apiUrl, f: typeof fetch = fetch): Promise<number> {
  const r = await f(`${apiBase.replace(/\/+$/, '')}/catalogo`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`el servidor respondió ${r.status} al pedir el catálogo`)
  const { token } = (await r.json()) as { token?: unknown }
  if (typeof token !== 'string') throw new Error('respuesta de catálogo sin firma')
  const { paquetes } = await verificarCatalogoWeb(token)
  sincronizarModulosCatalogo(apiBase, paquetes)
  return paquetes.length
}

export function iniciarModulos(): void {
  instalarSdkHost()
  registrarModulosIntegrados()
  if (typeof window !== 'undefined' && !window.electron?.pluginsListar) {
    void sincronizarCatalogoWeb().catch((e) => console.warn('[modulos] no se pudo cargar el catálogo de módulos', e))
  }
}
