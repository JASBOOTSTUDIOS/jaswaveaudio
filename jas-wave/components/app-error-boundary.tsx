import { Component, type ErrorInfo, type ReactNode } from 'react'
import { WindowTitleBar } from '@/components/window-title-bar'
import { proyectoParaGuardar } from '../../shared/src/project/ciclo-vida'
import type { ProjectState } from '../../shared/src/types/proyecto'

type Props = {
  children: ReactNode
  /** Nombre del área (log y mensaje). Si es un panel, el resto de la app sigue operativa. */
  area?: string
  /** Proyecto actual para la copia de emergencia (lectura tardía: no re-renderiza). */
  getProject?: () => ProjectState | undefined
  /** Panel embebido: muestra una tarjeta compacta en lugar de la pantalla completa. */
  compact?: boolean
}

type State = { error: Error | null; savedPath: string | null; saveError: string | null }

export function reportRendererError(scope: string, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error))
  try {
    window.electron?.logError?.(scope, err.message, err.stack)
  } catch {
    /* sin Electron */
  }
}

/** Guarda el proyecto en userData/recovery/ (siempre concedido) para no perder trabajo. */
export async function saveEmergencyCopy(project: ProjectState | undefined): Promise<string> {
  if (!project) throw new Error('No hay proyecto que guardar')
  const dir = await window.electron?.userDataPath?.()
  if (!dir || !window.electron?.fileSave) throw new Error('Guardado no disponible')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeName = (project.nombre || 'proyecto').replace(/[^\w.-]+/g, '_').slice(0, 60)
  const ruta = `${dir}/recovery/${safeName}-${stamp}.jaswave`
  const result = await window.electron.fileSave(ruta, JSON.stringify(proyectoParaGuardar(project)))
  if (!result?.success) throw new Error(result?.error || 'No se pudo escribir la copia')
  return ruta
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, savedPath: null, saveError: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererError(this.props.area ?? 'app', new Error(`${error.message}\n${info.componentStack ?? ''}`))
    if (!this.props.compact) void this.save()
  }

  private save = async () => {
    try {
      const savedPath = await saveEmergencyCopy(this.props.getProject?.())
      this.setState({ savedPath, saveError: null })
    } catch (e) {
      this.setState({ saveError: e instanceof Error ? e.message : String(e) })
    }
  }

  private retry = () => this.setState({ error: null })

  render(): ReactNode {
    const { error, savedPath, saveError } = this.state
    if (!error) return this.props.children

    if (this.props.compact) {
      return (
        <div role="alert" className="m-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-medium">El panel «{this.props.area}» falló y se detuvo.</p>
          <p className="mt-1 text-muted-foreground">{error.message}</p>
          <button type="button" onClick={this.retry} className="mt-2 rounded border border-border px-2 py-1 hover:bg-muted">
            Reintentar
          </button>
        </div>
      )
    }

    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Sin marco: aun tras un fallo, minimizar / maximizar / cerrar tienen que verse */}
        <WindowTitleBar soloEscritorio>
          <span className="px-3 text-[12px] font-semibold text-foreground">JasWave</span>
        </WindowTitleBar>
        <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8">
          <h1 className="text-lg font-semibold">JasWave encontró un error inesperado</h1>
          <p className="max-w-xl text-center text-sm text-muted-foreground">{error.message}</p>
          <p className="max-w-xl text-center text-sm">
            {savedPath
              ? `Se guardó una copia de emergencia del proyecto en: ${savedPath}`
              : saveError
                ? `No se pudo guardar la copia de emergencia: ${saveError}`
                : 'Guardando copia de emergencia…'}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={this.retry} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Volver a intentar
            </button>
            <button type="button" onClick={() => location.reload()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Recargar la app
            </button>
            <button type="button" onClick={() => void this.save()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Guardar otra copia
            </button>
            <button type="button" onClick={() => void window.electron?.openLogsFolder?.()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Abrir logs
            </button>
          </div>
        </div>
      </div>
    )
  }
}
