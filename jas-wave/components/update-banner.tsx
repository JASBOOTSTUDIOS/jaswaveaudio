'use client'

/**
 * Aviso discreto de actualización descargada (electron/updater.ts → 'update-status').
 * Solo aparece en la app empaquetada cuando hay una versión lista para instalar.
 */

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useDAWState } from '@/src/context/daw-context'

export function UpdateBanner() {
  const [readyVersion, setReadyVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [confirmUnsaved, setConfirmUnsaved] = useState(false)
  const unsaved = useDAWState((s) => (s.estadisticasUso?.cambiosNoGuardados ?? 0) > 0)

  useEffect(() => {
    const off = window.electron?.onUpdateStatus?.((status) => {
      if (status.state === 'downloaded') {
        setReadyVersion(status.version ?? '')
        setDismissed(false)
      }
    })
    return () => off?.()
  }, [])

  if (readyVersion === null || dismissed) return null

  const restart = async () => {
    // Con cambios sin guardar: pedir un segundo clic en vez de cerrar sin avisar.
    if (unsaved && !confirmUnsaved) {
      setConfirmUnsaved(true)
      return
    }
    setInstalling(true)
    const ok = await window.electron?.updateInstallNow?.().catch(() => false)
    if (!ok) setInstalling(false)
  }

  return (
    <div
      role="status"
      className="fixed bottom-10 left-16 z-[70] flex items-center gap-2 rounded-lg border border-accent-cyan/40 bg-panel-raised/95 px-3 py-2 text-[12px] text-foreground shadow-lg backdrop-blur-sm"
    >
      <Download className="size-3.5 shrink-0 text-accent-cyan" />
      <span className="font-medium">
        Actualización {readyVersion ? `v${readyVersion} ` : ''}lista
      </span>
      <button
        type="button"
        disabled={installing}
        onClick={() => void restart()}
        className="ml-1 rounded bg-accent-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-accent-cyan hover:bg-accent-cyan/25 disabled:opacity-50"
        title="Guarda tu proyecto antes: JasWave se cerrará e instalará la actualización"
      >
        {installing ? 'Reiniciando…' : confirmUnsaved ? '¿Reiniciar sin guardar?' : 'Reiniciar'}
      </button>
      <button
        type="button"
        aria-label="Más tarde"
        title="Más tarde (se instalará al cerrar JasWave)"
        onClick={() => setDismissed(true)}
        className="shrink-0 opacity-60 hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
