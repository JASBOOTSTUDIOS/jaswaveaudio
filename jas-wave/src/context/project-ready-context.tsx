/**
 * Provider + banner: bloquea interacción fuerte hasta que host/device/plugins/buffers estén listos.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useDAWStateOptional } from '@/src/context/daw-context'
import { isUndockWindow } from '@/lib/undock-window'
import {
  beginProjectResourceLoad,
  getProjectReadySnapshot,
  markProjectBuffersNotNeeded,
  markProjectPluginsNotNeeded,
  reportProjectBuffersSettled,
  subscribeProjectReady,
  type ProjectReadySnapshot,
} from '@/src/lib/project-ready'
import { isBuiltinInstrument } from '@/src/lib/plugin/track-vst-runtime'
import { extractHostPluginPath } from '@/src/lib/plugin/plugin-info-adapter'

const ProjectReadyContext = createContext<ProjectReadySnapshot | null>(null)

function projectNeedsVst(
  tracks: Array<{ plugins?: Array<{ id?: string; licencia?: string; nombre?: string; descripcion?: string; bypass?: boolean }> }>,
  masterPlugins?: Array<{ id?: string; licencia?: string; nombre?: string; descripcion?: string; bypass?: boolean }>,
): boolean {
  const all = [...(tracks.flatMap((t) => t.plugins ?? [])), ...(masterPlugins ?? [])]
  for (const p of all) {
    if (!p || p.bypass) continue
    if (isBuiltinInstrument(p as never)) continue
    if (extractHostPluginPath(p.descripcion ?? '', p.id)) return true
  }
  return false
}

function projectNeedsAudioBuffers(
  tracks: Array<{ clips?: Array<{ tipo?: string; source?: { ruta?: string } }> }>,
): boolean {
  for (const t of tracks) {
    for (const c of t.clips ?? []) {
      if (c.tipo === 'audio' && c.source?.ruta) return true
    }
  }
  return false
}

function ProjectReadyBanner({ snap }: { snap: ProjectReadySnapshot }) {
  if (!snap.blocking && snap.phase !== 'degraded') return null
  const warn = snap.phase === 'degraded'
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex justify-center px-3 pt-2"
    >
      <div
        className={
          warn
            ? 'pointer-events-auto max-w-xl rounded-md border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur'
            : 'pointer-events-auto max-w-xl rounded-md border border-sky-500/40 bg-slate-950/95 px-3 py-2 text-xs text-sky-50 shadow-lg backdrop-blur'
        }
      >
        <div className="font-medium">{snap.label}</div>
        {snap.detail ? <div className="mt-0.5 opacity-80">{snap.detail}</div> : null}
        <div className="mt-1 flex flex-wrap gap-2 opacity-70">
          <span>{snap.hostOk ? '✓' : '…'} Host</span>
          <span>{snap.deviceArmed ? '✓' : '…'} Audio</span>
          <span>{snap.pluginsSettled ? '✓' : '…'} Plugins</span>
          <span>{snap.buffersSettled ? '✓' : '…'} Buffers</span>
        </div>
        {snap.errors.length > 0 ? (
          <div className="mt-1 max-h-16 overflow-auto opacity-70">
            {snap.errors.slice(-3).map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ProjectReadyProvider({ children }: { children: ReactNode }) {
  const satellite = isUndockWindow()
  const projectId = useDAWStateOptional((s) => s.project?.id ?? '', '')
  const tracks = useDAWStateOptional((s) => s.project?.tracks ?? [], [])
  const masterPlugins = useDAWStateOptional((s) => s.project?.master?.plugins ?? [], [])
  const [snap, setSnap] = useState(() => getProjectReadySnapshot())

  useEffect(() => subscribeProjectReady(setSnap), [])

  // Nuevo proyecto / cambio → reiniciar gate
  useEffect(() => {
    if (satellite) {
      beginProjectResourceLoad('undock')
      markProjectPluginsNotNeeded()
      markProjectBuffersNotNeeded()
      return
    }
    const gen = beginProjectResourceLoad(`project:${projectId || 'new'}`)
    const needsVst = projectNeedsVst(tracks, masterPlugins)
    const needsBuf = projectNeedsAudioBuffers(tracks)
    if (!needsVst) markProjectPluginsNotNeeded(gen)
    if (!needsBuf) markProjectBuffersNotNeeded(gen)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de proyecto
  }, [projectId, satellite])

  const value = useMemo(() => snap, [snap])

  return (
    <ProjectReadyContext.Provider value={value}>
      {!satellite ? <ProjectReadyBanner snap={snap} /> : null}
      {children}
    </ProjectReadyContext.Provider>
  )
}

export function useProjectReady(): ProjectReadySnapshot {
  const ctx = useContext(ProjectReadyContext)
  return ctx ?? getProjectReadySnapshot()
}

/** Marca buffers listos tras hidratar clips WAV (playback / session). */
export function notifyProjectBuffersReady(ok = true, message?: string) {
  reportProjectBuffersSettled(ok, message)
}
