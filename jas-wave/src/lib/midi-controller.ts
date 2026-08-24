/**
 * Entrada MIDI hardware: Web MIDI si el permiso lo permite, y WinMM nativo
 * (plugin-host) en Windows — el mismo API que usa REAPER.
 * Un solo cliente: el host React en la ventana principal.
 */

import { channelFilterAllows, parseMidiMessage, type MidiParsed } from './midi-bytes'

export type MidiInputInfo = {
  id: string
  name: string
  manufacturer: string
}

export type MidiControllerStatus = {
  ready: boolean
  error?: string
  inputId: string
  inputName: string
  channel: number | 'omni'
  quantizeGrid: number
  devices: MidiInputInfo[]
  activityAt: number
}

const STORAGE_INPUT = 'jaswave.midi.inputId'
const STORAGE_CHANNEL = 'jaswave.midi.channel'
const STORAGE_GRID = 'jaswave.midi.quantizeGrid'

export type MidiSource = 'web' | 'native'
type MsgListener = (msg: MidiParsed, timeSec: number, source?: MidiSource, deviceId?: string) => void

let access: MIDIAccess | null = null
let starting: Promise<boolean> | null = null
let selectedId = loadInputId()
let channelFilter: number | 'omni' = loadChannel()
let quantizeGrid = loadGrid()
let runningStatus = 0
let activityAt = 0
let lastError: string | undefined
const inputsBound = new Set<string>()
let nativeDevices: MidiInputInfo[] = []
let nativeAttached = false

const deviceListeners = new Set<() => void>()
const msgListeners = new Set<MsgListener>()
const activityListeners = new Set<(at: number) => void>()

function electronApi(): Window['electron'] | undefined {
  return typeof window === 'undefined' ? undefined : window.electron
}

function loadInputId(): string {
  try {
    return localStorage.getItem(STORAGE_INPUT) ?? 'all'
  } catch {
    return 'all'
  }
}

function loadChannel(): number | 'omni' {
  try {
    const raw = localStorage.getItem(STORAGE_CHANNEL)
    if (raw === 'omni' || raw == null || raw === '') return 'omni'
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0 && n <= 15) return n
  } catch {
    /* ignore */
  }
  return 'omni'
}

function loadGrid(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_GRID))
    if (Number.isFinite(n) && n >= 0) return n
  } catch {
    /* ignore */
  }
  return 0
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_INPUT, selectedId)
    localStorage.setItem(STORAGE_CHANNEL, String(channelFilter))
    localStorage.setItem(STORAGE_GRID, String(quantizeGrid))
  } catch {
    /* ignore */
  }
}

function emitDevices(): void {
  for (const l of deviceListeners) l()
}

function emitActivity(): void {
  activityAt = performance.now()
  for (const l of activityListeners) l(activityAt)
}

function dispatchParsed(
  data: ArrayLike<number>,
  timeSec: number,
  source: MidiSource,
  deviceId: string,
): void {
  const parsed = parseMidiMessage(data, runningStatus)
  runningStatus = parsed.runningStatus
  if (!parsed.msg) return
  if (!channelFilterAllows(channelFilter, parsed.msg.channel)) return
  emitActivity()
  for (const l of msgListeners) l(parsed.msg, timeSec, source, deviceId)
}

function onNativeMidi(msg: { id: string; data: number[] }): void {
  if (!msg.data?.length) return
  dispatchParsed(msg.data, performance.now() / 1000, 'native', msg.id)
}

function unbindAll(): void {
  if (!access) return
  access.inputs.forEach((input) => {
    input.onmidimessage = null
  })
  inputsBound.clear()
}

function bindSelected(): void {
  if (!access) return
  unbindAll()
  if (nativeDevices.length > 0) return
  access.inputs.forEach((input) => {
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      const data = ev.data
      if (!data || data.length === 0) return
      const t = typeof ev.timeStamp === 'number' ? ev.timeStamp / 1000 : performance.now() / 1000
      dispatchParsed(data, t, 'web', input.id)
    }
    inputsBound.add(input.id)
  })
}

function listFromAccess(): MidiInputInfo[] {
  if (!access) return []
  const out: MidiInputInfo[] = []
  access.inputs.forEach((input) => {
    out.push({
      id: input.id,
      name: input.name || input.id,
      manufacturer: input.manufacturer || '',
    })
  })
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

function listAllInputs(): MidiInputInfo[] {
  if (nativeDevices.length > 0) {
    return [...nativeDevices].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }
  return listFromAccess()
}

function attachNativeOnce(): void {
  if (nativeAttached) return
  const api = electronApi()
  if (!api?.onNativeMidi) return
  nativeAttached = true
  api.onNativeMidi(onNativeMidi)
  api.onPluginHostRestarted?.(() => {
    void refreshNative().then(() => {
      bindSelected()
      emitDevices()
    })
  })
}

async function refreshNative(): Promise<void> {
  const api = electronApi()
  if (!api?.pluginHostSend) {
    nativeDevices = []
    return
  }
  try {
    await api.pluginHostEnsure?.()
    const raw = (await api.pluginHostSend({ type: 'listMidiDevices' })) as {
      ok?: boolean
      devices?: Array<{ id?: string; name?: string; manufacturer?: string }>
    }
    if (raw?.ok && Array.isArray(raw.devices)) {
      nativeDevices = raw.devices
        .filter((d): d is { id: string; name?: string; manufacturer?: string } => typeof d.id === 'string' && d.id.length > 0)
        .map((d) => ({
          id: d.id,
          name: d.name || d.id,
          manufacturer: d.manufacturer || 'WinMM',
        }))
    } else {
      nativeDevices = []
    }
    await api.pluginHostSend({ type: 'openMidiInputs' })
  } catch {
    nativeDevices = []
  }
}

export const midiController = {
  async start(): Promise<boolean> {
    if (starting) return starting
    starting = (async () => {
      attachNativeOnce()
      await refreshNative()
      const hasNative = nativeDevices.length > 0

      if (typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function') {
        try {
          if (!access) {
            access = await navigator.requestMIDIAccess({ sysex: false })
            access.onstatechange = () => {
              bindSelected()
              emitDevices()
            }
          }
          lastError = undefined
        } catch (e) {
          access = null
          if (!hasNative) {
            lastError = e instanceof Error ? e.message : 'No se pudo abrir MIDI'
          } else {
            lastError = undefined
          }
        }
      } else if (!hasNative) {
        lastError = 'Este entorno no expone Web MIDI.'
      } else {
        lastError = undefined
      }

      bindSelected()
      emitDevices()
      return !!access || hasNative
    })()
    try {
      return await starting
    } finally {
      starting = null
    }
  },

  stop(): void {
    unbindAll()
    if (access) access.onstatechange = null
    access = null
  },

  listInputs(): MidiInputInfo[] {
    return listAllInputs()
  },

  getSelectedId(): string {
    return selectedId
  },

  setSelectedId(id: string): void {
    selectedId = id || 'all'
    persist()
    bindSelected()
    emitDevices()
  },

  getChannel(): number | 'omni' {
    return channelFilter
  },

  setChannel(ch: number | 'omni'): void {
    channelFilter = ch
    persist()
    emitDevices()
  },

  getQuantizeGridBeats(): number {
    return quantizeGrid
  },

  setQuantizeGridBeats(grid: number): void {
    quantizeGrid = Math.max(0, grid)
    persist()
    emitDevices()
  },

  getStatus(): MidiControllerStatus {
    const devices = listAllInputs()
    const sel =
      selectedId === 'all'
        ? devices.length
          ? `Todos (${devices.length})`
          : 'Ningún controlador'
        : devices.find((d) => d.id === selectedId)?.name ?? 'No conectado'
    return {
      ready: !!access || nativeDevices.length > 0,
      error: lastError,
      inputId: selectedId,
      inputName: sel,
      channel: channelFilter,
      quantizeGrid,
      devices,
      activityAt,
    }
  },

  subscribeDevices(cb: () => void): () => void {
    deviceListeners.add(cb)
    return () => deviceListeners.delete(cb)
  },

  subscribeMessages(cb: MsgListener): () => void {
    msgListeners.add(cb)
    return () => msgListeners.delete(cb)
  },

  subscribeActivity(cb: (at: number) => void): () => void {
    activityListeners.add(cb)
    return () => activityListeners.delete(cb)
  },
}

export type { MidiParsed }
