/**
 * Escucha menú Archivo → exportar partituras (debe vivir dentro de DAWProvider).
 */

import { useEffect } from 'react'
import { useDAWOptional } from '@/src/context/daw-context'
import { exportProjectScoresToFolder } from '@/src/lib/midi-score-export'

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
        if (!window.electron?.dialogOpenDirectory) {
          window.alert('Elegir carpeta solo está disponible en Electron.')
          return
        }
        const dirResult = await window.electron.dialogOpenDirectory()
        const folder =
          dirResult && !dirResult.canceled && dirResult.filePaths?.[0]
            ? dirResult.filePaths[0]
            : undefined
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
