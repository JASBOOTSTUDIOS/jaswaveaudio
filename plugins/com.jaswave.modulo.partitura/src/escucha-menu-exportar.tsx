/**
 * Escucha menú Archivo → exportar partituras (debe vivir dentro de DAWProvider).
 */

import { useEffect } from 'react'

import { exportProjectScoresToFolder } from './exportar'
import { useDAWOptional, archivosDeEscritorio, elegirCarpeta } from '@jaswave/host-sdk'

export function ScoreExportMenuListener() {
  const tienda = useDAWOptional()

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id !== 'archivo.exportarPartituras' && id !== 'archivo.exportarProyectoConPartituras') return
      if (!tienda) {
        window.alert('DAW no listo')
        return
      }
      void (async () => {
        if (!archivosDeEscritorio()) {
          window.alert('Exportar a una carpeta solo está disponible en JasWave Desktop.')
          return
        }
        const folder = await elegirCarpeta()
        if (!folder) return
        const r = await exportProjectScoresToFolder(
          tienda,
          folder,
          id === 'archivo.exportarProyectoConPartituras',
        )
        window.alert(r.message)
      })()
    }
    window.addEventListener('jaswave-menu-action', handler)
    return () => window.removeEventListener('jaswave-menu-action', handler)
  }, [tienda])

  return null
}
