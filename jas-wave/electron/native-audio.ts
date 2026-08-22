/**
 * Carga el addon C++ en el proceso main de Electron.
 */
const path = require('path')

type NativeBinding = {
  initialize: (cfg: unknown) => void
  shutdown: () => void
  loadBuffer: (id: string, samples: Float32Array, sr: number, ch: number) => void
  unloadBuffer: (id: string) => void
  setGraph: (graph: unknown) => void
  transportPlay: () => void
  transportPause: () => void
  transportStop: () => void
  transportSeek: (s: number) => void
  getPlayheadSeconds: () => number
  isPlaying: () => boolean
  getMeterPeak: () => number
}

let binding: NativeBinding | null = null
let loadAttempted = false

function resolveNativeRoots(): string[] {
  const roots: string[] = []
  try {
    // monorepo: <repo>/native/audio-engine
    roots.push(path.resolve(__dirname, '../../../../native/audio-engine'))
    roots.push(path.resolve(__dirname, '../../../native/audio-engine'))
    roots.push(path.resolve(process.cwd(), 'native/audio-engine'))
    roots.push(path.resolve(process.cwd(), '../native/audio-engine'))
  } catch {
    /* ignore */
  }
  return roots
}

export function getNativeAudio(): NativeBinding | null {
  if (loadAttempted) return binding
  loadAttempted = true
  for (const root of resolveNativeRoots()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(root) as {
        isAvailable?: () => boolean
        raw?: NativeBinding | null
        initialize?: NativeBinding['initialize']
      }
      if (mod?.raw) {
        binding = mod.raw
        break
      }
      if (typeof mod?.initialize === 'function') {
        binding = mod as unknown as NativeBinding
        break
      }
    } catch {
      /* try next */
    }
  }
  return binding
}

export function nativeAudioAvailable(): boolean {
  // Addon stub (playhead, sin salida HW). No reportar available: el DAW usa Web Audio.
  // Opt-in: JASWAVE_NATIVE_AUDIO=1 cuando el device miniaudio sea real (ADR-0009 fase 2).
  if (process.env.JASWAVE_NATIVE_AUDIO !== '1') return false
  return getNativeAudio() != null
}
