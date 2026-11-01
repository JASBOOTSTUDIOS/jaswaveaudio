import { useEffect, useState } from 'react'
import { AlertCircle, Play, WifiOff, X } from 'lucide-react'
import { buscarProduccionInterrumpida, descartarProduccion, idSeguro, puertoProducciones, requestOpenTool, useDAWState } from '@jaswave/host-sdk'
import type { ProduccionInterrumpida } from '@jaswave/host-sdk'
import { orquestadorBandaSingleton, type BandaLiveState } from '../motor/banda-orchestrator'

export const EVENTO_REANUDAR_BANDA = 'jaswave-banda-reanudar'

/** Pide al chat que reanude una producción: `/banda reanudar <runId> [copia]` (el chat lo envía como un turno más). */
export function pedirReanudar(runId: string, desdeCopia: boolean): void {
  const texto = `/banda reanudar ${runId}${desdeCopia ? ' copia' : ''}`
  const enviar = () => {
    const ev = new CustomEvent(EVENTO_REANUDAR_BANDA, { detail: { texto, manejado: false } })
    window.dispatchEvent(ev)
    return (ev.detail as { manejado: boolean }).manejado
  }
  if (enviar()) return
  // El chat no está abierto: se abre y se reintenta.
  requestOpenTool('coproducer', { zone: 'left' })
  window.setTimeout(enviar, 700)
}

/**
 * Plan Q: avisos de resiliencia en el panel de la banda. Pausa por falta de internet, poca memoria y, si una
 * producción se interrumpió (cierre forzado, caída, apagado), «dónde se quedó» con Reanudar / Descartar.
 */
export function TarjetaReanudar() {
  const projectId = useDAWState((s) => s.project?.id || 'default')
  const [banda, setBanda] = useState<BandaLiveState>(() => orquestadorBandaSingleton.getState())
  const [info, setInfo] = useState<ProduccionInterrumpida | null>(null)
  const [memoria, setMemoria] = useState<string | null>(null)

  useEffect(() => orquestadorBandaSingleton.subscribe((s) => setBanda({ ...s })), [])
  useEffect(() => {
    const alAviso = (e: Event) => {
      const d = (e as CustomEvent<{ tipo?: string; texto?: string }>).detail
      if (d?.tipo === 'memoria' && d.texto) setMemoria(d.texto)
    }
    window.addEventListener('jaswave-produccion-aviso', alAviso)
    return () => window.removeEventListener('jaswave-produccion-aviso', alAviso)
  }, [])

  // Busca producciones interrumpidas al abrir el proyecto y cuando termina/empieza una producción.
  useEffect(() => {
    let vivo = true
    if (banda.activo) {
      setInfo(null)
      return
    }
    void buscarProduccionInterrumpida(puertoProducciones(), idSeguro(projectId)).then((r) => vivo && setInfo(r))
    return () => {
      vivo = false
    }
  }, [projectId, banda.activo])

  return (
    <>
      {banda.activo && banda.pausaRed ? (
        <div data-testid="banda-sin-red" role="status" className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-500/10 p-2 text-xs text-amber-100">
          <WifiOff className="mt-0.5 size-4 shrink-0" />
          <span>Sin conexión a internet. La producción está en pausa y continuará sola en cuanto vuelva; no se pierde nada de lo hecho. Puedes detenerla cuando quieras.</span>
        </div>
      ) : null}
      {memoria ? (
        <div data-testid="banda-memoria" role="status" className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-500/10 p-2 text-xs text-amber-100">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{memoria}</span>
          <button type="button" aria-label="Cerrar el aviso" onClick={() => setMemoria(null)} className="rounded p-0.5 hover:bg-amber-500/20">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {info && !banda.activo ? (
        <div data-testid="banda-interrumpida" className="flex flex-col gap-2 rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-accent-amber" />
            <span className="leading-snug text-foreground">{info.texto}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => pedirReanudar(info.resumen.runId, false)}
              className="flex items-center gap-1 rounded bg-accent-amber px-2 py-1 font-medium text-black hover:opacity-90"
            >
              <Play className="size-3 fill-current" /> Reanudar
            </button>
            {info.hayPunto ? (
              <button
                type="button"
                title="Vuelve a la última copia de seguridad del proyecto (la de la última etapa o músico terminados) y sigue desde ahí."
                onClick={() => pedirReanudar(info.resumen.runId, true)}
                className="rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
              >
                Reanudar desde la última copia
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void descartarProduccion(puertoProducciones(), idSeguro(projectId), info.resumen.runId).then(() => setInfo(null))
              }}
              className="rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
            >
              Descartar
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
