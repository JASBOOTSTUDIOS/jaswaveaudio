/**
 * U6: avisos del dispositivo de audio emitidos por el host nativo en stderr.
 * El host escribe marcas `[jaswave-plugin-host] ...`; aquí se convierten en
 * avisos para la UI ("Interfaz desconectada · Reintentar").
 */

export type AudioDeviceNotice = 'reset' | 'lost'

const RESET_MARK = '[jaswave-plugin-host] audio-device-reset'
const LOST_MARK = '[jaswave-plugin-host] device-lost'

/** Devuelve el aviso de una línea del log del host, o null si no es un aviso. */
export function parseAudioDeviceNotice(line: string): AudioDeviceNotice | null {
  const t = line.trim()
  if (!t) return null
  if (t.includes(LOST_MARK)) return 'lost'
  if (t.includes(RESET_MARK)) return 'reset'
  return null
}

/** Extrae todos los avisos de un bloque de stderr (puede traer varias líneas). */
export function parseAudioDeviceNotices(raw: string): AudioDeviceNotice[] {
  const out: AudioDeviceNotice[] = []
  for (const line of raw.split('\n')) {
    const notice = parseAudioDeviceNotice(line)
    if (notice) out.push(notice)
  }
  return out
}
