/**
 * Aviso de «la IA acaba de tocar esto»: tras cada herramienta aplicada se emite un evento de ventana con
 * la pista y los controles tocados; la app ilumina esa perilla, fader o FX durante un momento para que el
 * usuario vea en tiempo real qué hace la IA (contrato con `jas-wave/src/lib/ia-resaltado.ts`).
 */
export const EVENTO_CAMBIO_IA = 'jaswave-ia-toca'

/** Controles que se pueden iluminar: campos de la pista (volumen, paneo, mute, solo…), 'fx', 'envios' o 'notas'. */
export type CambioIA = { trackId: string; campos: string[] }

const FX = /^(mix\.(eq|compress|limit)|plugin\.|track\.addVstLayer$|fxChain\.)/

export function cambiosDeHerramienta(tool: string, args: Record<string, unknown>): CambioIA[] {
  const pista = String(args.trackId ?? args.pistaId ?? '')
  const datos = (args.datos && typeof args.datos === 'object' ? args.datos : {}) as Record<string, unknown>
  if (tool === 'track.update' && pista) return [{ trackId: pista, campos: Object.keys(datos) }]
  if (tool === 'master.update') return [{ trackId: 'master', campos: Object.keys(datos) }]
  if (tool === 'send.set') {
    const origen = String(args.trackId ?? args.fromTrackId ?? args.origenId ?? args.pistaId ?? '')
    return origen ? [{ trackId: origen, campos: ['envios'] }] : []
  }
  if (tool === 'automation.writePoint' && pista) return [{ trackId: pista, campos: [String(args.param ?? args.parametro ?? 'automatizacion')] }]
  if (FX.test(tool)) return [{ trackId: pista && !/^(master|__master__|máster)$/i.test(pista) ? pista : 'master', campos: ['fx'] }]
  if (/^midi\./.test(tool) && pista) return [{ trackId: pista, campos: ['notas'] }]
  return []
}

export function avisarCambioIA(tool: string, args: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  for (const c of cambiosDeHerramienta(tool, args)) {
    if (!c.campos.length) continue
    try {
      window.dispatchEvent(new CustomEvent<CambioIA>(EVENTO_CAMBIO_IA, { detail: c }))
    } catch {
      /* sin ventana (tests) */
    }
  }
}
