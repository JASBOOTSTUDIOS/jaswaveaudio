import { useEffect, useState } from 'react'
import { useSesion } from '../backend/sesion'
import { catalogoIA, EVENTO_CATALOGO_IA, refrescarCatalogoIA, type CatalogoIA } from './catalogo-ia'

/**
 * Catálogo de IA de la cuenta actual: se vuelve a pedir al iniciar o cerrar sesión, y se puede
 * refrescar a mano (p. ej. después de que el admin cambie permisos).
 */
export function useCatalogoIA(): { catalogo: CatalogoIA; refrescar: () => Promise<void>; error: string | null; sesion: ReturnType<typeof useSesion> } {
  const sesion = useSesion()
  const [catalogo, setCatalogo] = useState<CatalogoIA>(() => catalogoIA())
  const [error, setError] = useState<string | null>(null)
  const usuario = sesion.identidad?.userId ?? null

  const refrescar = async () => {
    try {
      await refrescarCatalogoIA()
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (sesion.cargando) return
    void refrescar()
  }, [usuario, sesion.cargando])

  useEffect(() => {
    const al = () => setCatalogo(catalogoIA())
    window.addEventListener(EVENTO_CATALOGO_IA, al)
    return () => window.removeEventListener(EVENTO_CATALOGO_IA, al)
  }, [])

  return { catalogo, refrescar, error, sesion }
}
