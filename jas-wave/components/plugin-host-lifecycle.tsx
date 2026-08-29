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
  forgetHostPlugins,
  isBuiltinInstrument,
  getLoadedInstrumentForTrack,
} from '@/src/lib/plugin/track-vst-runtime'
import { extractHostPluginPath } from '@/src/lib/plugin/plugin-info-adapter'
import {
  getProjectReadyGeneration,
  invalidateProjectPlugins,
  markProjectPluginsNotNeeded,
  reportProjectPluginProgress,
  reportProjectPluginsSettled,
} from '@/src/lib/project-ready'
import type { PluginInfo } from '../../shared/src/types/entidades'

function chainNeedsVst(plugins: PluginInfo[] | undefined): boolean {
  for (const p of plugins ?? []) {
    if (p.bypass || isBuiltinInstrument(p)) continue
    if (extractHostPluginPath(p.descripcion, p.id)) return true
  }
  return false
}

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
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runId = useRef(0)

  useEffect(() => {
    if (satellite) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void (async () => {
        const { audioEngine } = await import('@/lib/audio-engine')
        const gen = getProjectReadyGeneration()
        const needs = tracks.some((t) => chainNeedsVst(t.plugins)) || chainNeedsVst(masterPlugins)
        if (!needs) {
          markProjectPluginsNotNeeded(gen)
          await syncLoadedSlotsWithProject(tracks, masterPlugins)
          return
        }

        // Durante play: no relanzar loads (bloquean stdin); si ya hay slots, cerrar banner.
        if (audioEngine.getIsPlaying()) {
          const missing = tracks.some((t) => {
            const wants = (t.plugins ?? []).some((p) => {
              if (p.bypass || isBuiltinInstrument(p)) return false
              return Boolean(extractHostPluginPath(p.descripcion, p.id))
            })
            return wants && !getLoadedInstrumentForTrack(t.id)
          })
          if (!missing) {
            reportProjectPluginsSettled(true, 'VSTs listos (en reproducción)', gen)
          }
          return
        }

        const myRun = ++runId.current
        invalidateProjectPlugins('plugin-signature')
        try {
          await syncLoadedSlotsWithProject(tracks, masterPlugins)
          await ensureProjectVstInstruments(
            tracks.map((t) => ({ id: t.id, plugins: t.plugins })),
            masterPlugins,
            {
              onProgress: (done, total, name) => {
                if (runId.current !== myRun) return
                if (getProjectReadyGeneration() !== gen) return
                reportProjectPluginProgress(done, total, name, gen)
              },
            },
          )
          if (runId.current !== myRun) return
          if (getProjectReadyGeneration() !== gen) return
          reportProjectPluginsSettled(true, 'VSTs sincronizados', gen)
        } catch (err) {
          if (runId.current !== myRun) return
          if (getProjectReadyGeneration() !== gen) return
          reportProjectPluginsSettled(
            false,
            err instanceof Error ? err.message : 'Error cargando VSTs',
            gen,
          )
        }
      })()
    }, 80)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // signature es la SSOT; tracks se lee al disparar el timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, satellite])

  const tracksRef = useRef(tracks)
  const masterRef = useRef(masterPlugins)
  tracksRef.current = tracks
  masterRef.current = masterPlugins

  useEffect(() => {
    if (satellite) return
    const off = window.electron?.onPluginHostRestarted?.(() => {
      forgetHostPlugins()
      // Esperar a que ASIO/mix pipe estabilicen antes de re-cargar (evita stdin cerrado en cascada).
      if (restartTimer.current) clearTimeout(restartTimer.current)
      restartTimer.current = setTimeout(() => {
        const t = tracksRef.current
        const m = masterRef.current
        void (async () => {
          const gen = getProjectReadyGeneration()
          const myRun = ++runId.current
          invalidateProjectPlugins('host-restart')
          try {
            await syncLoadedSlotsWithProject(t, m)
            await ensureProjectVstInstruments(
              t.map((tr) => ({ id: tr.id, plugins: tr.plugins })),
              m,
              {
                onProgress: (done, total, name) => {
                  if (runId.current !== myRun) return
                  if (getProjectReadyGeneration() !== gen) return
                  reportProjectPluginProgress(done, total, name, gen)
                },
              },
            )
            // Mismos slotIds, proceso nuevo: reenviar MIDI o quedamos en silencio permanente.
            const { audioEngine } = await import('@/lib/audio-engine')
            for (const tr of t) {
              const slot = getLoadedInstrumentForTrack(tr.id)?.slotId
              if (slot) audioEngine.patchTrackVstInstrument(tr.id, slot)
            }
            audioEngine.rescheduleMidiAfterHostRestart()
            // Segunda pasada: slots que fallaron en el primer ensure (host aún tibio).
            const stillMissing = t.filter((tr) => {
              const needs = (tr.plugins ?? []).some((p) => {
                if (p.bypass) return false
                const d = String(p.descripcion ?? '')
                return /\.vst3|\.dll/i.test(d)
              })
              return needs && !getLoadedInstrumentForTrack(tr.id)
            })
            if (stillMissing.length) {
              await new Promise((r) => setTimeout(r, 800))
              await ensureProjectVstInstruments(
                stillMissing.map((tr) => ({ id: tr.id, plugins: tr.plugins })),
                m,
              )
              for (const tr of stillMissing) {
                const slot = getLoadedInstrumentForTrack(tr.id)?.slotId
                if (slot) audioEngine.patchTrackVstInstrument(tr.id, slot)
              }
              audioEngine.rescheduleMidiAfterHostRestart()
            }
            if (runId.current !== myRun) return
            if (getProjectReadyGeneration() !== gen) return
            const unresolved = t.filter((tr) => {
              const needs = (tr.plugins ?? []).some((p) => {
                if (p.bypass) return false
                return /\.vst3|\.dll/i.test(String(p.descripcion ?? ''))
              })
              return needs && !getLoadedInstrumentForTrack(tr.id)
            })
            if (unresolved.length) {
              reportProjectPluginsSettled(
                false,
                `VSTs tras restart: ${unresolved.length} sin slot (MIDI puede quedar en silencio)`,
                gen,
              )
            } else {
              reportProjectPluginsSettled(true, 'VSTs tras restart', gen)
            }
          } catch (err) {
            if (runId.current !== myRun) return
            if (getProjectReadyGeneration() !== gen) return
            reportProjectPluginsSettled(
              false,
              err instanceof Error ? err.message : 'Error VST post-restart',
              gen,
            )
          }
        })()
      }, 1500)
    })
    return () => {
      off?.()
      if (restartTimer.current) clearTimeout(restartTimer.current)
    }
  }, [satellite])

  return null
}
