/**
 * Abre JasWave Admin como app aparte del DAW: en JasWave Desktop, una ventana propia (IPC
 * `admin-window-open`); en la web, una pestaña nueva con admin.html (mismo origen ⇒ misma sesión).
 */

type ApiVentanaAdmin = { abrirAdmin?: () => Promise<unknown> }

/** URL de admin.html junto al index.html actual (respeta `base: './'` y subrutas de despliegue). */
export function urlAppAdmin(href: string = window.location.href, seccion?: string): string {
  const u = new URL('admin.html', href)
  u.search = ''
  u.hash = seccion ? `#/${seccion}` : ''
  return u.toString()
}

export async function abrirAppAdmin(): Promise<void> {
  const api = (window as unknown as { electronAPI?: ApiVentanaAdmin }).electronAPI
  if (api?.abrirAdmin) {
    await api.abrirAdmin()
    return
  }
  window.open(urlAppAdmin(), '_blank', 'noopener')
}
