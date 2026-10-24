/**
 * Banco de pruebas de diseño (solo desarrollo): muestra una herramienta en una caja de tamaño fijo para
 * comprobar que no se deforma al hacerse pequeña. Se controla con un evento:
 *   window.dispatchEvent(new CustomEvent('jaswave-layout-lab', { detail: { toolId: 'mixer', w: 260, h: 200 } }))
 * y se cierra con detail = null. Lo usa e2e/layout-robustness.spec.ts y el barrido de diseño.
 */
import { useEffect, useState } from 'react'
import { ToolHost } from './tool-host'
import type { ToolId } from '@/src/workspace/types'

type Lab = { toolId: ToolId; w: number; h: number } | null

export function LayoutLab() {
  const [lab, setLab] = useState<Lab>(null)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const on = (e: Event) => setLab((e as CustomEvent<Lab>).detail ?? null)
    window.addEventListener('jaswave-layout-lab', on)
    return () => window.removeEventListener('jaswave-layout-lab', on)
  }, [])
  if (!import.meta.env.DEV || !lab) return null
  return (
    <div
      data-testid="layout-lab"
      className="fixed left-0 top-0 z-[99999] overflow-hidden border border-accent-amber bg-panel"
      style={{ width: lab.w, height: lab.h }}
    >
      <ToolHost toolId={lab.toolId} />
    </div>
  )
}
