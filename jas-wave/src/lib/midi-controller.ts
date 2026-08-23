/**
 * Entrada MIDI hardware vía Web MIDI (Chromium/Electron).
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

type MsgListener = (msg: MidiParsed, timeSec: number) => void

let access: MIDIAccess | null = null
let starting: Promise<boolean> | null = null
let selectedId = loadInputId()
let channelFilter: number | 'omni' = loadChannel()
let quantizeGrid = loadGrid()
let runningStatus = 0
let activityAt = 0
let lastError: string | undefined
const inputsBound = new Set<string>()

const deviceListeners = new Set<() => void>()
const msgListeners = new Set<MsgListener>()
const activityListeners = new Set<(at: number) => void>()

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

function onMidiEvent(ev: MIDIMessageEvent): void {
  const data = ev.data
  if (!data || data.length === 0) return
  const parsed = parseMidiMessage(data, runningStatus)
  runningStatus = parsed.runningStatus
  if (!parsed.msg) return
  if (!channelFilterAllows(channelFilter, parsed.msg.channel)) return
  emitActivity()
  const t = typeof ev.timeStamp === 'number' ? ev.timeStamp / 1000 : performance.now() / 1000
  for (const l of msgListeners) l(parsed.msg, t)
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
  access.inputs.forEach((input) => {
    const match = selectedId === 'all' || input.id === selectedId
    if (!match) return
    input.onmidimessage = onMidiEvent
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

export const midiController = {
  async start(): Promise<boolean> {
    if (access) return true
    if (starting) return starting
    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      lastError = 'Este entorno no expone Web MIDI.'
      emitDevices()
      return false
    }
    starting = (async () => {
      try {
        access = await navigator.requestMIDIAccess({ sysex: false })
        lastError = undefined
        access.onstatechange = () => {
          bindSelected()
          emitDevices()
        }
        bindSelected()
        emitDevices()
        return true
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'No se pudo abrir MIDI'
        access = null
        emitDevices()
        return false
      } finally {
        starting = null
      }
    })()
    return starting
  },

  stop(): void {
    unbindAll()
    if (access) access.onstatechange = null
    access = null
  },

  listInputs(): MidiInputInfo[] {
    return listFromAccess()
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
    const devices = listFromAccess()
    const sel =
      selectedId === 'all'
        ? devices.length
          ? `Todos (${devices.length})`
          : 'Ningún controlador'
        : devices.find((d) => d.id === selectedId)?.name ?? 'No conectado'
    return {
      ready: !!access,
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
