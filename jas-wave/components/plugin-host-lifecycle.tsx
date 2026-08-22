/**
 * Alinea Plugin Host con track.plugins / master.plugins: unload huérfanos +
 * load de toda la cadena VST (instrumento + efectos). UI = mismo slot que process().
 */

import { useEffect, useRef } from 'react'
import { useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { isUndockWindow } from '@/lib/undock-window'
import {
  syncLoadedSlotsWithProject,
  ensureProjectVstInstruments,
} from '@/src/lib/plugin/track-vst-runtime'

export function PluginHostLifecycle() {
  const satellite = isUndockWindow()
  const signature = useDAWState((s: DAWState) => {
    const parts: string[] = []
    for (const t of s.project?.tracks ?? []) {
      for (const p of t.plugins ?? []) {
        parts.push(`${t.id}:${p.id}`)
      }
    }
    const master = s.project?.master?.plugins ?? []
    for (const p of master) parts.push(`master:${p.id}`)
    return parts.sort().join('|')
  })

  const tracks = useDAWState((s: DAWState) => s.project?.tracks ?? [])
  const masterPlugins = useDAWState((s: DAWState) => s.project?.master?.plugins ?? [])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (satellite) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void (async () => {
        await syncLoadedSlotsWithProject(tracks, masterPlugins)
        await ensureProjectVstInstruments(
          tracks.map((t) => ({ id: t.id, plugins: t.plugins })),
          masterPlugins,
        )
      })()
    }, 400)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // signature es la SSOT; tracks se lee al disparar el timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, satellite])

  return null
}
