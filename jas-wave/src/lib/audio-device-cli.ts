/**
 * Configuración de dispositivo de audio vía host nativo (misma vía que Ajustes).
 * Persiste en project + notifica a la UI.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { audioEngine } from '@/lib/audio-engine'

export type AudioDeviceInfo = {
  id: string
  backend: string
  name: string
  isDefault?: boolean
  available?: boolean
}

export type AudioRuntime = {
  backend: string
  deviceId: string
  deviceName: string
  sampleRate: number
  bufferSize: number
  exclusive: boolean
  running: boolean
  lastError?: string
}

function notifyUi(detail: Record<string, unknown>): void {
  try {
    window.dispatchEvent(new CustomEvent('jaswave-audio-device-changed', { detail }))
  } catch {
    /* ignore */
  }
}

export async function listAudioDevices(): Promise<{
  ok: boolean
  message?: string
  backends?: Array<{ id: string; name: string; available: boolean; hint?: string }>
  devices?: AudioDeviceInfo[]
  audio?: AudioRuntime
}> {
  await window.electron?.pluginHostEnsure?.()
  const raw = (await window.electron?.pluginHostSend?.({ type: 'listAudioDevices' })) as {
    ok?: boolean
    message?: string
    backends?: Array<{ id: string; name: string; available: boolean; hint?: string }>
    devices?: AudioDeviceInfo[]
    audio?: AudioRuntime
  }
  return {
    ok: Boolean(raw?.ok),
    message: raw?.message,
    backends: raw?.backends,
    devices: raw?.devices,
    audio: raw?.audio,
  }
}

export async function getAudioDevice(): Promise<{
  ok: boolean
  message?: string
  audio?: AudioRuntime
}> {
  await window.electron?.pluginHostEnsure?.()
  const raw = (await window.electron?.pluginHostSend?.({ type: 'getAudioDevice' })) as {
    ok?: boolean
    message?: string
    audio?: AudioRuntime
  }
  return { ok: Boolean(raw?.ok), message: raw?.message, audio: raw?.audio }
}

export async function setAudioDevice(
  tienda: TiendaDAW,
  opts: {
    backend: string
    deviceId?: string
    sampleRate?: number
    bufferSize?: number
    exclusive?: boolean
  },
): Promise<{ ok: boolean; message: string; audio?: AudioRuntime }> {
  const backend = opts.backend || 'asio'
  if (backend === 'asio' && (!opts.deviceId || opts.deviceId === 'default')) {
    return {
      ok: false,
      message: 'ASIO requiere deviceId (ej. driver UMC ASIO). Usa audio.listDevices.',
    }
  }
  await window.electron?.pluginHostEnsure?.()
  const raw = (await window.electron?.pluginHostSend?.({
    type: 'setAudioDevice',
    backend,
    deviceId: opts.deviceId,
    sampleRate: opts.sampleRate,
    bufferSize: opts.bufferSize,
    exclusive: opts.exclusive ?? backend === 'wasapi_exclusive',
  })) as { ok?: boolean; message?: string; audio?: AudioRuntime }

  const audio = raw?.audio
  if (audio) {
    const st = tienda.obtenerEstado()
    await tienda.executor.execute('project.update', {
      datos: {
        sampleRate: audio.sampleRate || opts.sampleRate,
        configuracion: {
          ...st.project?.configuracion,
          bufferSize: audio.bufferSize || opts.bufferSize,
          dispositivoSalida: audio.deviceId || opts.deviceId || '',
          audioBackend: audio.backend || backend,
        },
      },
    })
    void audioEngine.rearmAfterDeviceChange(audio.sampleRate)
    notifyUi({ audio, source: 'cli' })
  }

  const ok = Boolean(raw?.ok && audio?.running)
  return {
    ok,
    message: ok
      ? `Audio OK: ${audio?.backend} · ${audio?.deviceName || audio?.deviceId} · ${audio?.sampleRate} Hz / ${audio?.bufferSize}`
      : raw?.message || 'No se pudo aplicar el dispositivo',
    audio,
  }
}

/** Elige ASIO preferido (UMC / nombre) o el primer ASIO disponible; fallback WASAPI. */
export async function ensureBestAudioDevice(
  tienda: TiendaDAW,
  preferName?: string,
): Promise<{ ok: boolean; message: string; audio?: AudioRuntime }> {
  const listed = await listAudioDevices()
  if (!listed.ok) {
    return { ok: false, message: listed.message || 'listAudioDevices falló' }
  }
  const current = listed.audio
  if (current?.running && current.backend === 'asio') {
    // Ya hay ASIO corriendo — sincroniza proyecto/UI
    const st = tienda.obtenerEstado()
    await tienda.executor.execute('project.update', {
      datos: {
        sampleRate: current.sampleRate,
        configuracion: {
          ...st.project?.configuracion,
          bufferSize: current.bufferSize,
          dispositivoSalida: current.deviceId,
          audioBackend: current.backend,
        },
      },
    })
    notifyUi({ audio: current, source: 'cli-ensure' })
    return {
      ok: true,
      message: `Ya en uso: ${current.backend} · ${current.deviceName} · ${current.sampleRate} Hz / ${current.bufferSize}`,
      audio: current,
    }
  }

  const devices = listed.devices ?? []
  const prefer = (preferName || 'UMC').toLowerCase()
  const asio = devices.filter((d) => d.backend === 'asio' && d.available !== false)
  const pick =
    asio.find((d) => d.name.toLowerCase().includes(prefer)) ||
    asio.find((d) => /umc|focusrite|yamaha|steinberg|rme|m-wave/i.test(d.name)) ||
    asio[0]

  if (pick) {
    // Prefer buffer del driver (pref ~1024 en UMC) y 48k si el proyecto lo pide, si no 44.1
    const sr = tienda.obtenerEstado().project?.sampleRate || 48000
    return setAudioDevice(tienda, {
      backend: 'asio',
      deviceId: pick.id,
      sampleRate: sr >= 48000 ? 48000 : 44100,
      bufferSize: 512,
    })
  }

  const wasapi = devices.find((d) => d.backend === 'wasapi' && d.isDefault) || devices.find((d) => d.backend === 'wasapi')
  if (wasapi) {
    return setAudioDevice(tienda, {
      backend: 'wasapi',
      deviceId: wasapi.id,
      sampleRate: 48000,
      bufferSize: 512,
    })
  }
  return { ok: false, message: 'No hay dispositivos ASIO/WASAPI disponibles' }
}
