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
    await audioEngine.rearmAfterDeviceChange(audio.sampleRate)
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

/** Elige ASIO preferido (UMC / nombre) o el primer ASIO disponible; fallback WASAPI.
 * Preferencia estable: 48 kHz + buffer 1024 (menos underruns / menos crackle en el SO).
 */
export async function ensureBestAudioDevice(
  tienda: TiendaDAW,
  preferName?: string,
): Promise<{ ok: boolean; message: string; audio?: AudioRuntime }> {
  const listed = await listAudioDevices()
  if (!listed.ok) {
    return { ok: false, message: listed.message || 'listAudioDevices falló' }
  }

  const devices = listed.devices ?? []
  const prefer = (preferName || 'UMC').toLowerCase()
  const asio = devices.filter((d) => d.backend === 'asio' && d.available !== false)
  const pick =
    asio.find((d) => d.name.toLowerCase().includes(prefer)) ||
    asio.find((d) => /umc|focusrite|yamaha|steinberg|rme|m-wave/i.test(d.name)) ||
    asio[0]

  const TARGET_SR = 48000
  const TARGET_BUF = 1024

  if (pick) {
    const current = listed.audio
    const alreadyOk =
      current?.running &&
      current.backend === 'asio' &&
      current.deviceId === pick.id &&
      Number(current.sampleRate) === TARGET_SR &&
      Number(current.bufferSize) >= TARGET_BUF
    if (alreadyOk) {
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
        message: `Ya estable: ${current.backend} · ${current.deviceName} · ${current.sampleRate} Hz / ${current.bufferSize}`,
        audio: current,
      }
    }
    return setAudioDevice(tienda, {
      backend: 'asio',
      deviceId: pick.id,
      sampleRate: TARGET_SR,
      bufferSize: TARGET_BUF,
    })
  }

  const wasapi = devices.find((d) => d.backend === 'wasapi' && d.isDefault) || devices.find((d) => d.backend === 'wasapi')
  if (wasapi) {
    return setAudioDevice(tienda, {
      backend: 'wasapi',
      deviceId: wasapi.id,
      sampleRate: TARGET_SR,
      bufferSize: TARGET_BUF,
    })
  }
  return { ok: false, message: 'No hay dispositivos ASIO/WASAPI disponibles' }
}

/** Fuerza Soft Pad/clips → pipe → ASIO (un solo device). */
export async function armNativeAudioOutput(): Promise<{
  ok: boolean
  message: string
  timing?: ReturnType<typeof audioEngine.getTimingDiagnostics>
}> {
  const ok = await audioEngine.armNativeMixOutput()
  const timing = audioEngine.getTimingDiagnostics()
  return {
    ok,
    message: ok
      ? `Native mix armado · ahead ${timing.pathAheadMs.toFixed(0)} ms · buf ${timing.bufferSize}`
      : `Native mix NO armado: ${timing.lastArmError || 'desconocido'}`,
    timing,
  }
}

/** Limpia plugins aislados tras crash del host (RAM + disco) y reintenta ASIO. */
export async function clearPluginQuarantineAndRestore(tienda: TiendaDAW): Promise<{
  ok: boolean
  message: string
  cleared?: number
}> {
  const send = window.electron?.pluginHostSend
  if (!send) return { ok: false, message: 'Sin pluginHostSend' }
  const raw = (await send({ type: 'clearPluginQuarantine' })) as {
    ok?: boolean
    message?: string
    count?: number
  }
  const cleared = Number(raw.count ?? 0)
  const ensure = await ensureBestAudioDevice(tienda, 'UMC')
  const arm = await armNativeAudioOutput()
  return {
    ok: Boolean(raw.ok) && ensure.ok && arm.ok,
    message: `${raw.message || `Cuarentena: ${cleared}`} · ${ensure.message} · ${arm.message}`,
    cleared,
  }
}
