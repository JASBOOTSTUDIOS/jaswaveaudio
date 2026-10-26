/**
 * JasWave Voice-to-Melody: Motor DSP de detección de tono fundamental (f0)
 * basado en el algoritmo YIN con corrección de escala y segmentación de notas MIDI.
 */

export type NotaMelodiaMidi = {
  id: string
  tiempoSeg: number
  beat: number
  pitch: number // 0..127 (ej. 60 = C4, 69 = A4)
  notaNombre: string // ej. 'C4', 'D#4', 'A4'
  velocidad: number // 1..127
  duracionSeg: number
  duracionBeats: number
  confianza: number // 0..1
}

export type OpcionesVoiceToMelody = {
  sampleRate?: number
  bpmProyecto?: number
  cuantizar?: 'off' | '1/16' | '1/8' | '1/4'
  sensibilidad?: number // 0.5 .. 2.0 (por defecto 1.0)
  umbralVoiced?: number // Umbral YIN aperiodicidad (0.10 .. 0.25, por defecto 0.15)
  ajusteEscala?: boolean
  tonalidadRaiz?: string // ej. 'C', 'D', 'Eb', 'F#', 'G', 'A', 'Bb'
  tonalidadEscala?: 'mayor' | 'menor' | 'dórica' | 'pentatónica' | 'cromática'
  rangoMinHz?: number // Min f0 a buscar (por defecto 65 Hz ~ C2)
  rangoMaxHz?: number // Max f0 a buscar (por defecto 1050 Hz ~ C6)
}

const NOMBRES_NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// Intervalos en semitonos desde la tónica (0..11)
const INTERVALOS_ESCALAS: Record<string, number[]> = {
  mayor: [0, 2, 4, 5, 7, 9, 11],
  menor: [0, 2, 3, 5, 7, 8, 10], // Menor natural
  dórica: [0, 2, 3, 5, 7, 9, 10],
  pentatónica: [0, 2, 4, 7, 9],
  cromática: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/**
 * Convierte un número de nota MIDI a nombre legible (ej. 60 -> "C4", 69 -> "A4").
 */
export function midiANombreNota(pitch: number): string {
  const p = Math.max(0, Math.min(127, Math.round(pitch)))
  const nombre = NOMBRES_NOTAS[p % 12] ?? 'C'
  const octava = Math.floor(p / 12) - 1
  return `${nombre}${octava}`
}

/**
 * Convierte frecuencia Hz a número MIDI flotante.
 */
export function hzAMidiFloat(freqHz: number): number {
  if (freqHz <= 0) return 0
  return 69 + 12 * Math.log2(freqHz / 440)
}

/**
 * Ajusta un número MIDI al semitono más cercano y opcionalmente a la escala activa.
 */
export function ajustarMidiAEscala(
  pitchFloat: number,
  ajustarEscala = true,
  raiz = 'C',
  tipoEscala: keyof typeof INTERVALOS_ESCALAS = 'menor',
): number {
  const pitchRedondeado = Math.round(pitchFloat)
  if (!ajustarEscala) {
    return Math.max(0, Math.min(127, pitchRedondeado))
  }

  const intervalos = INTERVALOS_ESCALAS[tipoEscala] ?? INTERVALOS_ESCALAS.menor!
  const raizUpper = raiz.trim().toUpperCase().replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#').replace('AB', 'G#').replace('BB', 'A#')
  let indiceRaiz = NOMBRES_NOTAS.indexOf(raizUpper as any)
  if (indiceRaiz === -1) indiceRaiz = 0

  const claseTono = (pitchRedondeado % 12 + 12) % 12
  const semitonoRelativo = (claseTono - indiceRaiz + 12) % 12

  if (intervalos.includes(semitonoRelativo)) {
    return pitchRedondeado
  }

  // Buscar el grado de la escala más cercano
  let minDiff = 12
  let mejorOffset = 0
  for (const grado of intervalos) {
    const diff = Math.abs(grado - semitonoRelativo)
    const diffCiclica = Math.min(diff, 12 - diff)
    if (diffCiclica < minDiff) {
      minDiff = diffCiclica
      mejorOffset = grado - semitonoRelativo
    }
  }

  const pitchAjustado = pitchRedondeado + mejorOffset
  return Math.max(0, Math.min(127, pitchAjustado))
}

/**
 * Algoritmo YIN para estimar la frecuencia fundamental en una ventana de audio.
 * Devuelve la frecuencia en Hz y la confianza (0..1).
 */
export function estimarFrecuenciaYIN(
  buffer: Float64Array | Float32Array,
  offset: number,
  ventanaTamano: number,
  sampleRate: number,
  umbral = 0.15,
  minHz = 65,
  maxHz = 1050,
): { freqHz: number; confianza: number } {
  const mitadVentana = Math.floor(ventanaTamano / 2)
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz))
  const tauMax = Math.min(mitadVentana - 1, Math.floor(sampleRate / minHz))

  if (offset + ventanaTamano > buffer.length || tauMax <= tauMin) {
    return { freqHz: 0, confianza: 0 }
  }

  // Paso 1: Función de diferencia d(tau)
  const d = new Float64Array(tauMax + 1)
  for (let tau = 0; tau <= tauMax; tau++) {
    let sum = 0
    for (let j = 0; j < mitadVentana; j++) {
      const delta = (buffer[offset + j] as number) - (buffer[offset + j + tau] as number)
      sum += delta * delta
    }
    d[tau] = sum
  }

  // Paso 2: Normalización acumulativa d'(tau)
  const dPrime = new Float64Array(tauMax + 1)
  dPrime[0] = 1
  let runningSum = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau]!
    dPrime[tau] = runningSum > 0 ? (d[tau]! * tau) / runningSum : 1
  }

  // Paso 3: Búsqueda del primer valle por debajo del umbral absoluto
  let tauElegido = 0
  let mejorValor = 1.0

  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dPrime[tau]! < umbral) {
      while (tau + 1 <= tauMax && dPrime[tau + 1]! < dPrime[tau]!) {
        tau++
      }
      tauElegido = tau
      mejorValor = dPrime[tau]!
      break
    }
  }

  // Fallback al mínimo global si no cruzó el umbral
  if (tauElegido === 0) {
    let minVal = Infinity
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (dPrime[tau]! < minVal) {
        minVal = dPrime[tau]!
        tauElegido = tau
      }
    }
    mejorValor = minVal
    if (mejorValor > 0.40) {
      // Audio claramente aperiódico / ruido / no-voz
      return { freqHz: 0, confianza: 0 }
    }
  }

  // Paso 4: Interpolación parabólica refinada
  let tauRefinado = tauElegido
  if (tauElegido > 1 && tauElegido < tauMax) {
    const s0 = dPrime[tauElegido - 1]!
    const s1 = dPrime[tauElegido]!
    const s2 = dPrime[tauElegido + 1]!
    const denom = 2 * (s0 - 2 * s1 + s2)
    if (Math.abs(denom) > 1e-9) {
      tauRefinado = tauElegido + (s0 - s2) / denom
    }
  }

  const freqHz = sampleRate / tauRefinado
  const confianza = Math.max(0, Math.min(1, 1 - mejorValor))

  return { freqHz, confianza }
}

/**
 * Transforma un búfer de audio continuo (tarareo, voz, silbido o solo)
 * en una secuencia estructurada de notas MIDI cuantizadas y afinadas.
 */
export function extraerMelodiaMidiDeAudio(
  muestras: Float64Array | Float32Array,
  opciones: OpcionesVoiceToMelody = {},
): {
  notas: NotaMelodiaMidi[]
  metricas: {
    totalNotas: number
    duracionSeg: number
    rangoPitches: { min: number; max: number }
    afinacionPromedioCents: number
  }
} {
  const sr = opciones.sampleRate ?? 44100
  const bpm = opciones.bpmProyecto ?? 120
  const cuantizar = opciones.cuantizar ?? 'off'
  const sensibilidad = opciones.sensibilidad ?? 1.0
  const umbralVoiced = opciones.umbralVoiced ?? 0.15
  const ajustarEscala = opciones.ajusteEscala ?? true
  const tonalidadRaiz = opciones.tonalidadRaiz ?? 'C'
  const tonalidadEscala = opciones.tonalidadEscala ?? 'menor'

  const n = muestras.length
  if (n === 0) {
    return {
      notas: [],
      metricas: { totalNotas: 0, duracionSeg: 0, rangoPitches: { min: 0, max: 0 }, afinacionPromedioCents: 0 },
    }
  }

  const ventanaTamano = 2048
  const salto = 512 // ~11.6 ms a 44.1 kHz
  const nTramas = n >= ventanaTamano ? Math.floor((n - ventanaTamano) / salto) + 1 : 0

  type TramaPaso = {
    tiempoSeg: number
    pitchMidi: number
    rms: number
    confianza: number
    esVoiced: boolean
  }

  const tramas: TramaPaso[] = []
  let sumaCentsDesviacion = 0
  let conteoCents = 0

  // 1. Detección trama a trama
  for (let t = 0; t < nTramas; t++) {
    const offset = t * salto
    const tiempoSeg = (offset + ventanaTamano / 2) / sr

    // Calcular RMS local
    let sumSqr = 0
    for (let i = 0; i < ventanaTamano; i++) {
      const s = muestras[offset + i] as number
      sumSqr += s * s
    }
    const rms = Math.sqrt(sumSqr / ventanaTamano)
    const umbralSilencioRms = 0.005 / Math.max(0.2, sensibilidad)

    if (rms < umbralSilencioRms) {
      tramas.push({ tiempoSeg, pitchMidi: 0, rms, confianza: 0, esVoiced: false })
      continue
    }

    const { freqHz, confianza } = estimarFrecuenciaYIN(
      muestras,
      offset,
      ventanaTamano,
      sr,
      umbralVoiced,
      opciones.rangoMinHz ?? 65,
      opciones.rangoMaxHz ?? 1050,
    )

    if (freqHz > 0 && confianza >= 0.55) {
      const midiFloat = hzAMidiFloat(freqHz)
      const cents = (midiFloat - Math.round(midiFloat)) * 100
      sumaCentsDesviacion += Math.abs(cents)
      conteoCents++

      const pitchFinal = ajustarMidiAEscala(midiFloat, ajustarEscala, tonalidadRaiz, tonalidadEscala)
      tramas.push({ tiempoSeg, pitchMidi: pitchFinal, rms, confianza, esVoiced: true })
    } else {
      tramas.push({ tiempoSeg, pitchMidi: 0, rms, confianza: 0, esVoiced: false })
    }
  }

  // 2. Segmentación de tramas en notas continuas
  const notas: NotaMelodiaMidi[] = []
  let enNota = false
  let pitchActual = 0
  let inicioTrama = 0
  let sumaRms = 0
  let sumaConfianza = 0
  let duracionTramas = 0

  const duracionMinimaTramas = 4 // ~46 ms para filtrar chasquidos o ruidos

  const cerrarNota = (finTrama: number) => {
    if (!enNota || duracionTramas < duracionMinimaTramas) {
      enNota = false
      duracionTramas = 0
      return
    }

    const tiempoInicioSeg = (inicioTrama * salto) / sr
    const duracionSeg = (duracionTramas * salto) / sr
    const avgRms = sumaRms / duracionTramas
    const avgConfianza = sumaConfianza / duracionTramas

    // Velocidad calculada de 1 a 127
    const velCalc = Math.round(Math.min(127, Math.max(20, Math.sqrt(avgRms) * 160 * sensibilidad)))

    // Cálculo métrico en beats
    let beatCalculado = (tiempoInicioSeg * bpm) / 60
    let durBeatsCalculada = (duracionSeg * bpm) / 60

    if (cuantizar === '1/16') {
      beatCalculado = Math.round(beatCalculado * 4) / 4
      durBeatsCalculada = Math.max(0.25, Math.round(durBeatsCalculada * 4) / 4)
    } else if (cuantizar === '1/8') {
      beatCalculado = Math.round(beatCalculado * 2) / 2
      durBeatsCalculada = Math.max(0.5, Math.round(durBeatsCalculada * 2) / 2)
    } else if (cuantizar === '1/4') {
      beatCalculado = Math.round(beatCalculado)
      durBeatsCalculada = Math.max(1, Math.round(durBeatsCalculada))
    }

    notas.push({
      id: `melody-note-${notas.length}`,
      tiempoSeg: Math.round(tiempoInicioSeg * 1000) / 1000,
      beat: Math.round(beatCalculado * 100) / 100,
      pitch: pitchActual,
      notaNombre: midiANombreNota(pitchActual),
      velocidad: velCalc,
      duracionSeg: Math.round(duracionSeg * 1000) / 1000,
      duracionBeats: Math.round(durBeatsCalculada * 100) / 100,
      confianza: Math.round(avgConfianza * 100) / 100,
    })

    enNota = false
    duracionTramas = 0
  }

  for (let t = 0; t < tramas.length; t++) {
    const tr = tramas[t]!
    if (tr.esVoiced) {
      if (!enNota) {
        enNota = true
        pitchActual = tr.pitchMidi
        inicioTrama = t
        duracionTramas = 1
        sumaRms = tr.rms
        sumaConfianza = tr.confianza
      } else {
        // Si el pitch cambia abruptamente, cerramos la nota anterior y empezamos la nueva
        if (tr.pitchMidi !== pitchActual) {
          cerrarNota(t)
          enNota = true
          pitchActual = tr.pitchMidi
          inicioTrama = t
          duracionTramas = 1
          sumaRms = tr.rms
          sumaConfianza = tr.confianza
        } else {
          duracionTramas++
          sumaRms += tr.rms
          sumaConfianza += tr.confianza
        }
      }
    } else {
      if (enNota) {
        cerrarNota(t)
      }
    }
  }

  if (enNota) {
    cerrarNota(tramas.length)
  }

  const pitches = notas.map((n) => n.pitch)
  const minPitch = pitches.length ? Math.min(...pitches) : 0
  const maxPitch = pitches.length ? Math.max(...pitches) : 0
  const avgCents = conteoCents > 0 ? sumaCentsDesviacion / conteoCents : 0

  return {
    notas,
    metricas: {
      totalNotas: notas.length,
      duracionSeg: Math.round((n / sr) * 100) / 100,
      rangoPitches: { min: minPitch, max: maxPitch },
      afinacionPromedioCents: Math.round(avgCents * 10) / 10,
    },
  }
}
