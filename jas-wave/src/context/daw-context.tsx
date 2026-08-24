import {
  createContext,
  useContext,
  useSyncExternalStore,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  crearTiendaDAW,
  crearEstadoInicial,
  type TiendaDAW,
  type DAWState,
  toolRegistry,
  registrarMidiAiTools,
  registrarPluginTools,
  registrarAnalysisTools,
} from '../../../shared/src'
import { configurarFileService } from '../../../shared/src/commands/project-commands'
import { FileServiceElectron } from '@/src/lib/file-service'
import {
  attachSessionAutosave,
  hydrateSession,
  type HydrateProgress,
} from '@/src/lib/session-persist'
import { JasWaveLogo } from '@/components/brand'
import { isUndockWindow } from '@/lib/undock-window'

const DAWContext = createContext<TiendaDAW | null>(null)

let sharedStore: TiendaDAW | null = null

export { isUndockWindow }

function getSharedStore() {
  if (!sharedStore) {
    const estado = crearEstadoInicial()

    sharedStore = crearTiendaDAW({
      estadoInicial: estado,
      maximoListeners: 100,
    })

    try {
      registrarMidiAiTools(toolRegistry, () => sharedStore!.obtenerEstado())
      registrarPluginTools(toolRegistry, () => sharedStore!.obtenerEstado())
      registrarAnalysisTools(toolRegistry)
    } catch {
      /* HMR */
    }

    if (typeof window !== 'undefined' && window.electron) {
      configurarFileService(new FileServiceElectron())
    }
  }
  return sharedStore
}

function SessionSplash({ progress }: { progress: HydrateProgress }) {
  const pct = Math.round(progress.progress * 100)
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-5 bg-background px-6">
      <JasWaveLogo className="h-34 w-auto max-w-[220px] opacity-95" alt="JasWave" />
      <div className="w-full max-w-xs space-y-2">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{progress.label}</span>
          <span className="font-mono tabular-nums">{pct}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-panel-raised ring-1 ring-border"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Progreso de restauración"
        >
          <div
            className="h-full rounded-full bg-accent-amber transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        {progress.detail ? (
          <p className="text-center text-[10px] text-muted-foreground/80">{progress.detail}</p>
        ) : null}
      </div>
    </div>
  )
}

export function DAWProvider({ children }: { children: ReactNode }) {
  const store = getSharedStore()
  const undock = isUndockWindow()
  const [ready, setReady] = useState(undock)
  const [progress, setProgress] = useState<HydrateProgress>({
    phase: undock ? 'done' : 'idle',
    label: undock ? 'Sincronizando ventana…' : 'Iniciando…',
    progress: undock ? 0.3 : 0,
  })

  useEffect(() => {
    let cancelled = false
    let detachAutosave: (() => void) | undefined

    // Si IndexedDB se atasca, no dejar la splash para siempre
    const failsafe = window.setTimeout(() => {
      if (cancelled) return
      console.warn('[DAWProvider] timeout de hidratación — entrando a la UI')
      setProgress({
        phase: 'done',
        label: 'Arranque forzado',
        progress: 1,
        detail: 'La sesión tardó demasiado; se omite la restauración',
      })
      setReady(true)
    }, 8_000)

    void (async () => {
      if (undock) {
        window.clearTimeout(failsafe)
        setReady(true)
        return
      }

      try {
        await hydrateSession(store, {
          audioBackground: true,
          onProgress: (p) => {
            if (!cancelled) setProgress(p)
          },
        })
      } catch (err) {
        console.warn('[DAWProvider] session hydrate failed', err)
      }
      if (cancelled) return
      window.clearTimeout(failsafe)
      detachAutosave = attachSessionAutosave(store)
      setReady(true)
    })()

    return () => {
      cancelled = true
      window.clearTimeout(failsafe)
      detachAutosave?.()
    }
  }, [store, undock])

  if (!ready) {
    return <SessionSplash progress={progress} />
  }

  return <DAWContext.Provider value={store}>{children}</DAWContext.Provider>
}

export function useDAW() {
  const store = useContext(DAWContext)
  if (!store) {
    throw new Error('useDAW debe usarse dentro de DAWProvider')
  }
  return store
}

export function useDAWState<T>(selector: (state: DAWState) => T): T {
  const store = useDAW()
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const cachedRef = useRef<{ snapshot: T } | null>(null)

  return useSyncExternalStore(
    (onStoreChange) => store.suscribir(onStoreChange),
    () => {
      const next = selectorRef.current(store.obtenerEstado())
      const prev = cachedRef.current
      if (prev && snapshotsEqual(prev.snapshot, next)) return prev.snapshot
      cachedRef.current = { snapshot: next }
      return next
    },
    () => selectorRef.current(store.obtenerEstado()),
  )
}

/** Evita bucles en useSyncExternalStore cuando el selector crea objetos/arrays nuevos. */
function snapshotsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a == null || b == null) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i]) && !shallowPlainEqual(a[i], b[i])) return false
    }
    return true
  }
  return shallowPlainEqual(a, b)
}

function shallowPlainEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) || Array.isArray(b)) return false
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const k of keys) {
    if (!Object.is(ao[k], bo[k])) return false
  }
  return true
}

type EventBinding = {
  nombre: string
  manejador: (payload: unknown) => void
  once?: boolean
}

export function useEventBus(
  nombreOrBindings: string | EventBinding[],
  manejador?: (payload: unknown) => void,
  once?: boolean,
) {
  const store = useDAW()
  const bindings = useMemo((): EventBinding[] => {
    if (typeof nombreOrBindings === 'string') {
      return [{ nombre: nombreOrBindings, manejador: manejador ?? (() => {}), once }]
    }
    return nombreOrBindings
  }, [nombreOrBindings, manejador, once])

  useEffect(() => {
    const subs = bindings.map((b) =>
      b.once ? store.busEventos.once(b.nombre, b.manejador) : store.busEventos.on(b.nombre, b.manejador),
    )
    return () => {
      for (const s of subs) s.cancelarSuscripcion()
    }
  }, [store, bindings])
}
