/**
 * Contratos del sistema de plugins (ADR-0011) — sin objetos nativos / buffers.
 * Aislamiento híbrido: builtin in-process · terceros out-of-process.
 */

export type PluginFormat = 'builtin' | 'vst3' | 'vst2' | 'au' | 'lv2' | 'clap'

/** Dónde vive el runtime de la instancia (ADR-0011 opción C). */
export type PluginIsolationMode = 'in-process' | 'out-of-process'

/** Ciclo de vida formal — no usar booleanos ambiguos. */
export type PluginLifecycleState =
  | 'discovered'
  | 'scanned'
  | 'available'
  | 'loading'
  | 'loaded'
  | 'prepared'
  | 'active'
  | 'bypassed'
  | 'unloading'
  | 'unloaded'
  | 'scan_failed'
  | 'load_failed'
  | 'crashed'
  | 'incompatible'
  | 'missing'

export type PluginDescriptor = {
  pluginId: string
  format: PluginFormat
  vendor: string
  name: string
  version: string
  uniqueId?: string
  path?: string
  architecture?: 'x64' | 'arm64' | 'universal' | 'unknown'
  category: string
  isInstrument: boolean
  isEffect: boolean
  supportsMidiInput: boolean
  supportsMidiOutput: boolean
  supportsAudioInput: boolean
  supportsAudioOutput: boolean
  supportsSidechain: boolean
  supportsEditor: boolean
  parameterCount: number
  scanStatus: 'ok' | 'failed' | 'pending' | 'blacklisted'
  scanError?: string
  /** false = no hay runtime listo (p.ej. VST3 sin proceso hijo). */
  hostReady: boolean
  /** Política de aislamiento esperada para este descriptor. */
  isolation: PluginIsolationMode
}

/** Instancia de proyecto — sin punteros C++ ni buffers. */
export type PluginInstanceRef = {
  instanceId: string
  pluginId: string
  trackId?: string
  busId?: string
  position: number
  bypass: boolean
  lifecycle: PluginLifecycleState
  latencySamples: number
  isolation: PluginIsolationMode
  /** Id del proceso hijo OOP cuando isolation === out-of-process. */
  hostProcessId?: string
  presetId?: string
  /** Referencia opaca a blob de estado (no el DSP). */
  stateBlobId?: string
}

export type PluginParameterMeta = {
  parameterId: string
  name: string
  normalizedValue: number
  plainValue?: number
  min: number
  max: number
  default: number
  unit?: string
  step?: number
  enumValues?: string[]
  automatable: boolean
  readable: boolean
  writable: boolean
}

export type PluginLoadOptions = {
  trackId?: string
  busId?: string
  position?: number
  sampleRate?: number
  blockSize?: number
  stateBlobId?: string
}

export type PluginHostErrorCode =
  | 'PluginNotFound'
  | 'PluginScanFailed'
  | 'PluginLoadFailed'
  | 'PluginInitializationFailed'
  | 'PluginIncompatible'
  | 'PluginCrashed'
  | 'PluginStateRestoreFailed'
  | 'PluginEditorFailed'
  | 'PluginParameterInvalid'
  | 'PluginBusConfigurationFailed'
  | 'HostNotReady'
  | 'Blacklisted'

export class PluginHostError extends Error {
  constructor(
    public code: PluginHostErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PluginHostError'
  }
}

/** Contrato IPC conceptual hacia el Plugin Host Process (sin payloads de audio). */
export type PluginHostProcessCommand =
  | { type: 'ping' }
  | { type: 'discover'; path: string }
  | { type: 'load'; pluginId: string; path: string; sampleRate: number; blockSize: number; slotId?: string }
  | { type: 'unload'; slotId: string }
  | { type: 'prepare'; slotId: string }
  | { type: 'setBypass'; slotId: string; bypass: boolean }
  | { type: 'getLatency'; slotId: string }
  | { type: 'crashReport'; slotId: string }
  | { type: 'openEditor'; path: string; slotId: string; pluginId?: string; parentHwnd?: string; x?: number; y?: number; w?: number; h?: number }
  | { type: 'closeEditor'; slotId: string }
  | { type: 'focusEditor'; slotId: string; path?: string }
  | { type: 'setEditorBounds'; slotId: string; x: number; y: number; w: number; h: number }
  | { type: 'noteOn'; slotId: string; pitch: number; velocity: number }
  | { type: 'noteOff'; slotId: string; pitch: number }
  | { type: 'allNotesOff'; slotId?: string }
  | { type: 'midiCc'; slotId: string; cc: number; value: number }
  | { type: 'listParameters'; slotId: string; maxCount?: number }
  | { type: 'setParameter'; slotId: string; paramId: number; normalizedValue: number }
  | { type: 'getPluginState'; slotId: string }
  | { type: 'setPluginState'; slotId: string; stateBase64: string }
  | { type: 'setTransport'; playing: boolean; tempo?: number; ppqPos?: number }
  | {
      type: 'metronome.set'
      enabled: boolean
      bpm?: number
      beatsPerBar?: number
      volume?: number
    }
  | { type: 'getTransportClock' }
  | {
      type: 'clip.load'
      clipId: string
      path?: string
      pcmBase64?: string
      frames?: number
      channels?: number
      sampleRate?: number
    }
  | {
      type: 'clip.schedule'
      clipId: string
      trackIndex: number
      startSample: number
      durationSamples: number
      sourceOffsetSamples?: number
      gain?: number
      pan?: number
    }
  | { type: 'clip.stopAll' }
  | { type: 'clip.unload'; clipId?: string }
  | { type: 'listAudioDevices' }
  | {
      type: 'setAudioDevice'
      backend: string
      deviceId?: string
      sampleRate?: number
      bufferSize?: number
      exclusive?: boolean
    }
  | { type: 'getAudioDevice' }
  | { type: 'testTone' }
  | { type: 'ensureAudio' }
  | { type: 'setMixInputRate'; sampleRate: number }
  | { type: 'setSlotMix'; slotId: string; gain: number; pan: number; muted: boolean }
  | { type: 'setMasterMix'; gain: number; muted: boolean }
  | { type: 'asioControlPanel'; deviceId?: string }

export type PluginHostDiscoveredPlugin = {
  path: string
  name: string
  format?: string
  hostReady?: boolean
  /** UI nativa (editorhost) disponible — distinto de process/audio. */
  editorReady?: boolean
}

export type PluginHostProcessReply =
  | {
      ok: true
      processId: string
      slotId?: string
      latencySamples?: number
      plugins?: PluginHostDiscoveredPlugin[]
      count?: number
      editorReady?: boolean
      editorOpening?: boolean
      audioReady?: boolean
      backends?: Array<{ id: string; name: string; available: boolean; hint?: string }>
      devices?: Array<{
        id: string
        backend: string
        name: string
        isDefault?: boolean
        available?: boolean
      }>
      audio?: {
        backend: string
        deviceId: string
        deviceName: string
        sampleRate: number
        bufferSize: number
        exclusive: boolean
        running: boolean
        lastError?: string
      }
      mixPipe?: string
      parameterCount?: number
      parameters?: Array<{
        id: number
        parameterId: string
        name: string
        shortName?: string
        unit?: string
        displayValue?: string
        normalizedValue: number
        defaultNormalizedValue?: number
        stepCount?: number
        automatable?: boolean
        readOnly?: boolean
        hidden?: boolean
        bypass?: boolean
        programChange?: boolean
      }>
    }
  | { ok: false; code: PluginHostErrorCode; message: string }
