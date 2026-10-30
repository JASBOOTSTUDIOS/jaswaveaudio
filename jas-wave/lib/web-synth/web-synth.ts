/**
 * WebSynth por pista (W2): en el navegador no hay plugin host, así que las pistas MIDI con instrumento
 * VST suenan con un sintetizador AudioWorklet. Cada pista tiene su nodo conectado a la entrada de su
 * canal (volumen, paneo y medidores del DAW siguen aplicando).
 */

import procesadorUrl from './web-synth-processor.js?url'

export type PresetGenerico = 'pad' | 'bajo' | 'lead' | 'cuerdas' | 'fm' | 'piano' | 'bateria'
/** `jw:<slug>`: réplica web del VST3 independiente `com.jaswave.plugin.<slug>` (su propio AudioWorklet). */
export type PresetWebSynth = PresetGenerico | `jw:${string}`

/**
 * Worklets de los instrumentos JasWave independientes, descubiertos en `plugins/<id>/web/<slug>-worklet.js`.
 * Cada uno registra el procesador `jaswave-<slug>` y habla el mismo protocolo (on/off/param/bend/cc/panico).
 */
let WORKLETS_INSTRUMENTO: Record<string, string> = {}
try {
  // Vite sustituye esta llamada por un objeto en tiempo de compilación. Fuera de Vite (tests con tsx) no
  // existe `import.meta.glob`: no hay worklets de instrumento y se usan los presets genéricos.
  WORKLETS_INSTRUMENTO = import.meta.glob('../../../plugins/com.jaswave.plugin.*/web/*-worklet.js', {
    query: '?url',
    import: 'default',
    eager: true,
  }) as Record<string, string>
} catch {
  /* sin Vite */
}

export const INSTRUMENTOS_WEB: ReadonlyArray<{ slug: string; procesador: string; url: string }> = Object.entries(WORKLETS_INSTRUMENTO)
  .map(([ruta, url]) => {
    const m = /com\.jaswave\.plugin\.([\w-]+)\/web\/[\w-]+-worklet\.js$/.exec(ruta)
    return m ? { slug: m[1]!, procesador: `jaswave-${m[1]}`, url } : null
  })
  .filter((x): x is { slug: string; procesador: string; url: string } => x !== null)

export function esPresetInstrumentoJasWave(p: PresetWebSynth): p is `jw:${string}` {
  return p.startsWith('jw:')
}

const REGLAS: ReadonlyArray<[RegExp, PresetWebSynth]> = [
  // Instrumentos JasWave independientes: su propio motor (se usa si su worklet está disponible)
  [/jaswave\s*worship\s*drums/i, 'jw:worship-drums'],
  [/jaswave\s*electric\s*bass/i, 'jw:electric-bass'],
  [/jaswave\s*electric\s*guitar/i, 'jw:electric-guitar'],
  [/jaswave\s*grand\s*piano/i, 'jw:grand-piano'],
  [/jaswave\s*strings\s*section/i, 'jw:strings-section'],
  [/jaswave\s*shimmer\s*pad/i, 'jw:shimmer-pad'],
  [/jaswave\s*ambient\s*atmos/i, 'jw:ambient-atmos'],
  [/bater|drum|perc|kit|beat|roles.*bater|worship.*drum/i, 'bateria'],
  [/bajo|bass|sub\b|electric.*bass/i, 'bajo'],
  [/piano|keys|teclad|rhodes|epiano|grand.*piano/i, 'piano'],
  [/cuerda|string|violin|cello|orquest|strings.*section/i, 'cuerdas'],
  [/lead|melod|solo|synth lead|sierra|guitar|guitarra|electric.*guitar/i, 'lead'],
  [/fm|bell|campana|pluck|arpa/i, 'fm'],
  [/pad|ambient|atmos|coro|choir|shimmer/i, 'pad'],
]

/** Elige el preset a partir del nombre de la pista, sus etiquetas y los nombres de sus plugins. */
export function presetParaPista(textos: ReadonlyArray<string | undefined>): PresetWebSynth {
  const blob = textos.filter(Boolean).join(' ')
  return REGLAS.find(([re]) => re.test(blob))?.[1] ?? 'piano'
}

/** True en el cliente web (sin plugin host): ahí se usa el WebSynth. */
export function usarWebSynth(): boolean {
  return typeof window !== 'undefined' && !window.electron?.pluginHostSend
}

type NodoPista = { nodo: AudioWorkletNode; preset: PresetWebSynth; procesador: string; destino: AudioNode }

/** Si el worklet de un instrumento JasWave no está disponible se usa el preset genérico equivalente. */
const GENERICO_DE_INSTRUMENTO: Record<string, PresetGenerico> = {
  'grand-piano': 'piano',
  'worship-drums': 'bateria',
  'electric-bass': 'bajo',
  'electric-guitar': 'lead',
  'shimmer-pad': 'pad',
  'strings-section': 'cuerdas',
  'ambient-atmos': 'pad',
}

export class WebSynthPistas {
  private nodos = new Map<string, NodoPista>()
  private carga: Promise<void> | null = null
  private ctxCargado: BaseAudioContext | null = null
  /** Procesadores registrados en el contexto actual (el genérico y los de instrumentos JasWave que cargaron). */
  private procesadoresListos = new Set<string>()

  constructor(
    private readonly ctx: () => AudioContext,
    private readonly destino: (trackId: string) => AudioNode,
  ) {}

  /** Carga los módulos de worklet una vez por AudioContext; un instrumento que falle no impide los demás. */
  preparar(): Promise<void> {
    const ctx = this.ctx()
    if (this.carga && this.ctxCargado === ctx) return this.carga
    this.ctxCargado = ctx
    this.nodos.clear()
    this.procesadoresListos = new Set()
    const generico = ctx.audioWorklet.addModule(procesadorUrl).then(() => void this.procesadoresListos.add('jaswave-websynth'))
    const instrumentos = INSTRUMENTOS_WEB.map((i) =>
      ctx.audioWorklet
        .addModule(i.url)
        .then(() => void this.procesadoresListos.add(i.procesador))
        .catch((e) => console.warn(`[web-synth] no se pudo cargar el worklet de ${i.slug}:`, e)),
    )
    this.carga = Promise.all([generico, ...instrumentos]).then(() => undefined)
    return this.carga
  }

  get listo(): boolean {
    return !!this.carga && this.ctxCargado === this.ctx()
  }

  /** Procesador y preset efectivos: el del instrumento JasWave si cargó; si no, el genérico equivalente. */
  private resolver(preset: PresetWebSynth): { procesador: string; presetGenerico: PresetGenerico | null } {
    if (esPresetInstrumentoJasWave(preset)) {
      const slug = preset.slice(3)
      const procesador = `jaswave-${slug}`
      if (this.procesadoresListos.has(procesador)) return { procesador, presetGenerico: null }
      return { procesador: 'jaswave-websynth', presetGenerico: GENERICO_DE_INSTRUMENTO[slug] ?? 'piano' }
    }
    return { procesador: 'jaswave-websynth', presetGenerico: preset }
  }

  private nodoDe(trackId: string, preset: PresetWebSynth): AudioWorkletNode | null {
    if (!this.listo) return null
    const ctx = this.ctx()
    const destino = this.destino(trackId)
    const { procesador, presetGenerico } = this.resolver(preset)
    let p = this.nodos.get(trackId)
    if (p && (p.destino !== destino || p.procesador !== procesador)) {
      p.nodo.port.postMessage({ tipo: 'panico' })
      p.nodo.disconnect()
      p = undefined
    }
    if (!p) {
      const nodo = new AudioWorkletNode(ctx, procesador, { numberOfOutputs: 1, outputChannelCount: [2] })
      nodo.connect(destino)
      p = { nodo, preset: '' as PresetWebSynth, procesador, destino }
      this.nodos.set(trackId, p)
    }
    if (p.preset !== preset) {
      if (presetGenerico) p.nodo.port.postMessage({ tipo: 'preset', preset: presetGenerico })
      p.preset = preset
    }
    return p.nodo
  }

  /** Cambia un parámetro de un instrumento JasWave (id VST3, valor plano). No hace nada en los presets genéricos. */
  parametro(trackId: string, id: number, valor: number): void {
    const p = this.nodos.get(trackId)
    if (p && p.procesador !== 'jaswave-websynth') p.nodo.port.postMessage({ tipo: 'param', id, valor })
  }

  /** Programa una nota con inicio/fin en tiempo del AudioContext (sample-accurate en el worklet). */
  nota(trackId: string, preset: PresetWebSynth, pitch: number, velocidad: number, inicioCtx: number, duracionSec: number): boolean {
    const nodo = this.nodoDe(trackId, preset)
    if (!nodo) return false
    nodo.port.postMessage({ tipo: 'on', nota: pitch, vel: velocidad, cuando: inicioCtx })
    nodo.port.postMessage({ tipo: 'off', nota: pitch, cuando: inicioCtx + Math.max(0.02, duracionSec) })
    return true
  }

  /** Previsualización inmediata (teclas del piano roll, MIDI en vivo). */
  inmediata(trackId: string, preset: PresetWebSynth, on: boolean, pitch: number, velocidad: number): void {
    const nodo = this.nodoDe(trackId, preset)
    if (!nodo) return
    nodo.port.postMessage({ tipo: on ? 'on' : 'off', nota: pitch, vel: velocidad, cuando: this.ctx().currentTime })
  }

  /** Corta todo (stop, cambio de proyecto). */
  silenciarTodo(): void {
    for (const p of this.nodos.values()) p.nodo.port.postMessage({ tipo: 'panico' })
  }
}
