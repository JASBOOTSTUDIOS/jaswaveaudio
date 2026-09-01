/**
 * Enumeración de entradas de audio (getUserMedia / enumerateDevices).
 */

export type AudioInputInfo = {
  id: string
  name: string
}

let cached: AudioInputInfo[] = []
let permissionOk = false
const listeners = new Set<() => void>()
let deviceListenerBound = false

function emit(): void {
  for (const cb of listeners) cb()
}

function fromMediaList(list: MediaDeviceInfo[]): AudioInputInfo[] {
  return list
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({
      id: d.deviceId,
      name: (d.label || '').trim() || `Entrada ${d.deviceId.slice(0, 8)}`,
    }))
}

export function listAudioInputs(): AudioInputInfo[] {
  return cached
}

export function subscribeAudioInputs(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export async function ensureMicPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false
  // No abrir el mic del sistema si el Plugin Host ya tiene ASIO/WASAPI nativo:
  // getUserMedia sobre la misma interfaz (UMC) activa eco / monitor hardware.
  try {
    const { audioEngine } = await import('@/lib/audio-engine')
    if (audioEngine.usesNativeOutput()) return permissionOk
  } catch {
    /* ignore */
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    for (const t of stream.getTracks()) t.stop()
    permissionOk = true
    await refreshAudioInputs()
    return true
  } catch {
    permissionOk = false
    return false
  }
}

export async function refreshAudioInputs(): Promise<AudioInputInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    cached = []
    emit()
    return cached
  }
  try {
    if (!deviceListenerBound) {
      deviceListenerBound = true
      navigator.mediaDevices.addEventListener('devicechange', () => {
        void refreshAudioInputs()
      })
    }
    const list = await navigator.mediaDevices.enumerateDevices()
    cached = fromMediaList(list)
    if (!permissionOk && cached.some((d) => d.name.startsWith('Entrada '))) {
      /* labels vacíos: el permiso aún no se concedió */
    }
    emit()
    return cached
  } catch {
    cached = []
    emit()
    return cached
  }
}
