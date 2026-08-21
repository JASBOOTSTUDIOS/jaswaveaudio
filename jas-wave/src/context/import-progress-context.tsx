import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ImportProgress = {
  active: boolean
  fileName: string
  phase: 'reading' | 'decoding' | 'peaks' | 'creating' | 'done' | 'error'
  progress: number // 0..1
  error?: string
}

type ImportProgressContextValue = {
  state: ImportProgress
  start: (fileName: string) => void
  setProgress: (progress: number, phase?: ImportProgress['phase']) => void
  finish: () => void
  fail: (error: string) => void
}

const DEFAULT: ImportProgress = {
  active: false,
  fileName: '',
  phase: 'reading',
  progress: 0,
}

const ImportProgressContext = createContext<ImportProgressContextValue | null>(null)

export function ImportProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportProgress>(DEFAULT)

  const start = useCallback((fileName: string) => {
    setState({ active: true, fileName, phase: 'reading', progress: 0.02 })
  }, [])

  const setProgress = useCallback((progress: number, phase?: ImportProgress['phase']) => {
    setState((s) => ({
      ...s,
      active: true,
      progress: Math.max(0, Math.min(1, progress)),
      ...(phase ? { phase } : {}),
    }))
  }, [])

  const finish = useCallback(() => {
    setState((s) => ({ ...s, phase: 'done', progress: 1 }))
    setTimeout(() => setState(DEFAULT), 400)
  }, [])

  const fail = useCallback((error: string) => {
    setState((s) => ({ ...s, phase: 'error', error, progress: 1 }))
    setTimeout(() => setState(DEFAULT), 2500)
  }, [])

  const value = useMemo(
    () => ({ state, start, setProgress, finish, fail }),
    [state, start, setProgress, finish, fail],
  )

  return (
    <ImportProgressContext.Provider value={value}>
      {children}
      {state.active && <ImportProgressOverlay state={state} />}
    </ImportProgressContext.Provider>
  )
}

export function useImportProgress() {
  const ctx = useContext(ImportProgressContext)
  if (!ctx) throw new Error('useImportProgress dentro de ImportProgressProvider')
  return ctx
}

const PHASE_LABEL: Record<ImportProgress['phase'], string> = {
  reading: 'Leyendo archivo…',
  decoding: 'Decodificando audio…',
  peaks: 'Calculando waveform…',
  creating: 'Creando clip…',
  done: 'Listo',
  error: 'Error',
}

function ImportProgressOverlay({ state }: { state: ImportProgress }) {
  const pct = Math.round(state.progress * 100)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[100] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md rounded-lg border border-border bg-panel/95 p-3 shadow-xl backdrop-blur-sm">
        <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
          <span className="truncate font-medium text-foreground">{state.fileName}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-panel-raised">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ${
              state.phase === 'error' ? 'bg-red-500' : 'bg-accent-amber'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {state.error ?? PHASE_LABEL[state.phase]}
        </p>
      </div>
    </div>
  )
}
