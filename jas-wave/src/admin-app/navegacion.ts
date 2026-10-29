/**
 * Secciones de JasWave Admin y enrutado por hash (#/ia/modelos…): recargar la página conserva la sección.
 */

import { useCallback, useEffect, useState } from 'react'
import { Cable, ChartColumn, Gem, LayoutDashboard, Puzzle, ScrollText, Sparkles, Users, type LucideIcon } from 'lucide-react'

export type IdSeccion = 'resumen' | 'usuarios' | 'ia-modelos' | 'ia-planes' | 'ia-conexiones' | 'consumo' | 'plugins' | 'auditoria'

export type Seccion = { id: IdSeccion; titulo: string; icono: LucideIcon; ruta: string }

export const SECCIONES: Record<IdSeccion, Seccion> = {
  resumen: { id: 'resumen', titulo: 'Resumen', icono: LayoutDashboard, ruta: 'resumen' },
  usuarios: { id: 'usuarios', titulo: 'Usuarios', icono: Users, ruta: 'usuarios' },
  'ia-modelos': { id: 'ia-modelos', titulo: 'Modelos JasWave', icono: Sparkles, ruta: 'ia/modelos' },
  'ia-planes': { id: 'ia-planes', titulo: 'Planes de IA', icono: Gem, ruta: 'ia/planes' },
  'ia-conexiones': { id: 'ia-conexiones', titulo: 'Conexiones', icono: Cable, ruta: 'ia/conexiones' },
  consumo: { id: 'consumo', titulo: 'Consumo', icono: ChartColumn, ruta: 'consumo' },
  plugins: { id: 'plugins', titulo: 'Plugins y roles', icono: Puzzle, ruta: 'plugins' },
  auditoria: { id: 'auditoria', titulo: 'Auditoría', icono: ScrollText, ruta: 'auditoria' },
}

/** Grupos del sidebar y del menú móvil. */
export const GRUPOS: { titulo: string; secciones: IdSeccion[] }[] = [
  { titulo: 'General', secciones: ['resumen', 'usuarios', 'consumo'] },
  { titulo: 'Inteligencia artificial', secciones: ['ia-modelos', 'ia-planes', 'ia-conexiones'] },
  { titulo: 'Sistema', secciones: ['plugins', 'auditoria'] },
]

export const esIA = (s: IdSeccion) => s.startsWith('ia-')

export function seccionDeHash(hash: string): IdSeccion {
  const ruta = hash.replace(/^#\/?/, '').replace(/\/+$/, '')
  return (Object.values(SECCIONES).find((s) => s.ruta === ruta)?.id ?? (ruta === 'ia' ? 'ia-modelos' : 'resumen')) as IdSeccion
}

export function useRuta(): [IdSeccion, (s: IdSeccion) => void] {
  const [seccion, setSeccion] = useState<IdSeccion>(() => seccionDeHash(window.location.hash))
  useEffect(() => {
    const alCambiar = () => setSeccion(seccionDeHash(window.location.hash))
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])
  const ir = useCallback((s: IdSeccion) => {
    const hash = `#/${SECCIONES[s].ruta}`
    if (window.location.hash !== hash) window.location.hash = hash
    setSeccion(s)
    window.scrollTo({ top: 0 })
  }, [])
  return [seccion, ir]
}
