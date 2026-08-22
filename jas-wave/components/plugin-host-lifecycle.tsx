/**
 * Mantiene Plugin Host alineado con track.plugins (unload al borrar FX).
 */

import { useEffect, useRef } from 'react'
import { useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { syncLoadedSlotsWithProject } from '@/src/lib/plugin/track-vst-runtime'

export function PluginHostLifecycle() {
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void syncLoadedSlotsWithProject(tracks)
    }, 150)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [signature, tracks])

  return null
}
