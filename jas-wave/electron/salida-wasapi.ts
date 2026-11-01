/** Preferencias del dispositivo de audio (userData/audio-device.json) y elección de la salida WASAPI. */
export type AudioDevicePrefs = {
  backend: string
  deviceId: string
  sampleRate: number
  bufferSize: number
  exclusive?: boolean
}

export function isUmcName(value: string | undefined): boolean {
  return /umc|behringer/i.test(value || '')
}

export function wantsSharedWasapi(prefs: AudioDevicePrefs): boolean {
  if (prefs.exclusive || prefs.backend === 'wasapi_exclusive' || prefs.backend === 'asio') return false
  return !prefs.backend || prefs.backend === 'wasapi' || prefs.backend === 'auto'
}

/**
 * Salida WASAPI del arranque: la que eligió el usuario si sigue conectada; si no, la UMC (o la predeterminada).
 * Antes se abría siempre la UMC y se sobrescribía la elección guardada.
 */
export function pickPreferredWasapi(
  devices?: Array<{ id: string; backend: string; name: string }>,
  saved?: AudioDevicePrefs | null,
): AudioDevicePrefs {
  const lista = devices ?? []
  const guardada =
    saved && wantsSharedWasapi(saved) && saved.deviceId
      ? lista.find((d) => d.backend === 'wasapi' && d.id === saved.deviceId)
      : undefined
  const umc = lista.find((d) => d.backend === 'wasapi' && (isUmcName(d.name) || isUmcName(d.id)))
  return {
    backend: 'wasapi',
    deviceId: guardada?.id || umc?.id || '',
    sampleRate: (guardada && saved?.sampleRate) || 48000,
    bufferSize: (guardada && saved?.bufferSize) || 512,
    exclusive: false,
  }
}
