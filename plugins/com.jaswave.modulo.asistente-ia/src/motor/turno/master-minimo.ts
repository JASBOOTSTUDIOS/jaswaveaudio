/**
 * Máster mínimo determinista (plan Q): cuando la producción supera su límite de tiempo, el máster que haría el
 * modelo se sustituye por esto, SIN modelo y con los comandos de máster que ya existen:
 *   1. `master.normalizar` al objetivo de −14 LUFS (medición real del DAW);
 *   2. `mix.limit` en el máster con techo de −1 dBTP (limitador true-peak), que corta los picos que dejó la subida.
 * Así una canción que se pasa de tiempo sale con volumen comercial y sin saturar, y no «sin limitador».
 */
import type { MedicionQA } from '@jaswave/host-sdk'

export const OBJETIVO_LUFS_MINIMO = -14
export const TECHO_DBTP_MINIMO = -1

export type EjecutarComando = (nombre: string, args: Record<string, unknown>) => Promise<{ ok: boolean; mensaje?: string }>

export async function masterMinimoDeterminista(
  ejecutar: EjecutarComando,
  medirFinal?: () => Promise<MedicionQA | null>,
): Promise<{ ok: boolean; resumen: string }> {
  const pasos: string[] = []
  let ok = true
  const probar = async (nombre: string, args: Record<string, unknown>, etiqueta: string) => {
    try {
      const r = await ejecutar(nombre, args)
      pasos.push(r.ok ? etiqueta : `${etiqueta} (no se pudo: ${String(r.mensaje ?? 'error').slice(0, 120)})`)
      if (!r.ok) ok = false
    } catch (e) {
      pasos.push(`${etiqueta} (no se pudo: ${e instanceof Error ? e.message : String(e)})`)
      ok = false
    }
  }
  // Primero el volumen, después el limitador: el limitador es lo último que toca la señal.
  await probar('master.normalizar', { objetivoLufs: OBJETIVO_LUFS_MINIMO }, `volumen a ${OBJETIVO_LUFS_MINIMO} LUFS`)
  await probar('mix.limit', { trackId: 'master', ceiling: TECHO_DBTP_MINIMO, release: 100, lookahead: 5 }, `limitador a ${TECHO_DBTP_MINIMO} dBTP`)
  let medida = ''
  if (medirFinal) {
    try {
      const m = await medirFinal()
      if (m) medida = ` Medición final: ${m.detalles.join(' · ')}`
    } catch {
      /* la medición es informativa */
    }
  }
  return { ok, resumen: `${pasos.join(', ')}.${medida}` }
}
