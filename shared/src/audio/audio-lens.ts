/**
 * JasWave AudioLens: Motor de análisis descriptivo musical y clasificador de beatbox/voz a batería.
 *
 * Funciones principales:
 * - Extracción de cromagrama (12 pitch classes) y detección de progresión de acordes y tonalidad.
 * - Análisis de transitorios con descomposición espectral multi-banda (Kick, Snare, Hi-Hat).
 * - Conversión de percusión vocal / beatbox a eventos MIDI con cálculo de velocidad y cuantización opcional.
 * - Generador de descriptor semántico para modelos de lenguaje e IA de producción musical.
 */

import { fftEnLugar, ventanaHann } from './fft'

export type NotaBateriaMidi = {
  tiempoSeg: number
  beat: number
  instrumento: 'kick' | 'snare' | 'hihat_closed' | 'hihat_open' | 'percussion'
  notaMidi: number
  velocidad: number // 1..127
  duracionBeats: number
  duracionSeg: number
}

export type EventoAcorde = {
  tiempoSeg: number
  beat: number
  acorde: string // ej. 'C', 'Am', 'G7', 'F#m'
  confianza: number // 0..1
}

export type AnalisisMusicalDescriptivo = {
  duracionSeg: number
  bpmEstimado: number
  tonalidad: {
    raiz: string // ej. 'C', 'A', 'F#'
    escala: 'mayor' | 'menor'
    confianza: number
  }
  progresionAcordes: EventoAcorde[]
  bateriaDetectada: {
    totalGolpes: number
    kicks: number
    snares: number
    hihats: number
    notas: NotaBateriaMidi[]
  }
  metricasEspectrales: {
    energiaSub: number
    energiaMedios: number
    energiaAltos: number
    pausasDetectadasSeg: { inicio: number; fin: number; duracion: number }[]
  }
  resumenParaIA: string
}

export type OpcionesBeatboxADrums = {
  sampleRate?: number
  bpmProyecto?: number
  cuantizar?: 'off' | '1/16' | '1/8' | '1/4'
  sensibilidad?: number // 0.5 .. 2.0 (por defecto 1.0)
  umbralSilencioDb?: number // umbral para considerar pausa/silencio (ej. -45 dB)
}

// Bins de frecuencia y tonos musicales
const NOTAS_OCCIDENTALES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// Perfiles tonales de Krumhansl-Schmuckler
const PERFIL_MAYOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const PERFIL_MENOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

// Plantillas de acordes básicos (tríadas en 12 semitonos)
const PLANTILLAS_ACORDES: { tipo: string; semitonos: number[] }[] = [
  { tipo: '', semitonos: [0, 4, 7] }, // Mayor
  { tipo: 'm', semitonos: [0, 3, 7] }, // Menor
  { tipo: '7', semitonos: [0, 4, 7, 10] }, // Dominante 7
  { tipo: 'maj7', semitonos: [0, 4, 7, 11] }, // Mayor 7
  { tipo: 'm7', semitonos: [0, 3, 7, 10] }, // Menor 7
  { tipo: 'dim', semitonos: [0, 3, 6] }, // Disminuido
  { tipo: 'sus4', semitonos: [0, 5, 7] }, // Sus4
]

/**
 * Convierte un array de audio mono en cromagrama por tramas de tiempo.
 */
export function calcularCromagrama(
  muestras: Float64Array | Float32Array,
  sampleRate: number,
  tamanioFft = 2048,
  salto = 1024,
): { cromas: Float64Array[]; tiemposSeg: number[] } {
  const n = muestras.length
  const nTramas = n >= tamanioFft ? Math.floor((n - tamanioFft) / salto) + 1 : 0
  if (nTramas === 0) return { cromas: [], tiemposSeg: [] }

  const w = ventanaHann(tamanioFft)
  const mitad = tamanioFft >> 1
  const re = new Float64Array(tamanioFft)
  const im = new Float64Array(tamanioFft)

  // Mapeo de cada bin de frecuencia a la clase de tono 0..11 (A4 = 440 Hz = nota MIDI 69)
  const binAPitchClass = new Int8Array(mitad)
  for (let k = 1; k < mitad; k++) {
    const freq = (k * sampleRate) / tamanioFft
    if (freq >= 65.4 && freq <= 4000) {
      // De C2 a B7
      const midiFloat = 69 + 12 * Math.log2(freq / 440)
      const pitchClass = Math.round(midiFloat) % 12
      binAPitchClass[k] = (pitchClass + 12) % 12
    } else {
      binAPitchClass[k] = -1
    }
  }

  const cromas: Float64Array[] = []
  const tiemposSeg: number[] = []

  for (let t = 0; t < nTramas; t++) {
    const inicio = t * salto
    for (let i = 0; i < tamanioFft; i++) {
      re[i] = (muestras[inicio + i] as number) * (w[i] as number)
      im[i] = 0
    }
    fftEnLugar(re, im)

    const cromaTrama = new Float64Array(12)
    const binsPorPc = new Uint16Array(12)
    for (let k = 1; k < mitad; k++) {
      const pc = binAPitchClass[k] as number
      if (pc >= 0) {
        const mag = Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!)
        cromaTrama[pc] += mag
        binsPorPc[pc]++
      }
    }
    for (let c = 0; c < 12; c++) {
      if (binsPorPc[c]! > 0) cromaTrama[c] /= binsPorPc[c]!
    }

    // Normalizar vector croma
    let norma = 0
    for (let c = 0; c < 12; c++) norma += cromaTrama[c]! * cromaTrama[c]!
    norma = Math.sqrt(norma)
    if (norma > 1e-6) {
      for (let c = 0; c < 12; c++) cromaTrama[c] /= norma
    }

    cromas.push(cromaTrama)
    tiemposSeg.push((inicio + tamanioFft / 2) / sampleRate)
  }

  return { cromas, tiemposSeg }
}

/**
 * Estima la tonalidad global calculando el coeficiente de correlación de Pearson
 * entre el croma promedio y los perfiles de Krumhansl-Schmuckler (Mayor y Menor).
 */
export function estimarTonalidad(cromas: Float64Array[]): {
  raiz: string
  escala: 'mayor' | 'menor'
  confianza: number
} {
  if (cromas.length === 0) {
    return { raiz: 'C', escala: 'mayor', confianza: 0 }
  }

  // Croma global promedio
  const global = new Float64Array(12)
  for (const c of cromas) {
    for (let i = 0; i < 12; i++) global[i] += c[i]!
  }
  for (let i = 0; i < 12; i++) global[i] /= cromas.length

  // Media del croma global
  let meanC = 0
  for (let i = 0; i < 12; i++) meanC += global[i]!
  meanC /= 12

  let mejorCorr = -Infinity
  let mejorRaiz = 0
  let mejorEscala: 'mayor' | 'menor' = 'mayor'

  const mediaPerfilMayor = PERFIL_MAYOR.reduce((a, b) => a + b, 0) / 12
  const mediaPerfilMenor = PERFIL_MENOR.reduce((a, b) => a + b, 0) / 12

  for (let r = 0; r < 12; r++) {
    // Correlación con perfil Mayor
    let numM = 0
    let denC_M = 0
    let denP_M = 0
    for (let i = 0; i < 12; i++) {
      const pIdx = (i - r + 12) % 12
      const diffC = global[i]! - meanC
      const diffP = PERFIL_MAYOR[pIdx]! - mediaPerfilMayor
      numM += diffC * diffP
      denC_M += diffC * diffC
      denP_M += diffP * diffP
    }
    const corrM = numM / (Math.sqrt(denC_M * denP_M) + 1e-9)

    // Correlación con perfil Menor
    let numMen = 0
    let denC_Men = 0
    let denP_Men = 0
    for (let i = 0; i < 12; i++) {
      const pIdx = (i - r + 12) % 12
      const diffC = global[i]! - meanC
      const diffP = PERFIL_MENOR[pIdx]! - mediaPerfilMenor
      numMen += diffC * diffP
      denC_Men += diffC * diffC
      denP_Men += diffP * diffP
    }
    const corrMen = numMen / (Math.sqrt(denC_Men * denP_Men) + 1e-9)

    if (corrM > mejorCorr) {
      mejorCorr = corrM
      mejorRaiz = r
      mejorEscala = 'mayor'
    }
    if (corrMen > mejorCorr) {
      mejorCorr = corrMen
      mejorRaiz = r
      mejorEscala = 'menor'
    }
  }

  const confianza = Math.min(1, Math.max(0.1, (mejorCorr + 1) / 2))
  return {
    raiz: NOTAS_OCCIDENTALES[mejorRaiz] ?? 'C',
    escala: mejorEscala,
    confianza: Math.round(confianza * 100) / 100,
  }
}

/**
 * Detecta la secuencia de acordes por ventanas temporales.
 */
export function detectarSecuenciaAcordes(
  cromas: Float64Array[],
  tiemposSeg: number[],
  bpm = 120,
): EventoAcorde[] {
  if (cromas.length === 0) return []

  const resultados: EventoAcorde[] = []
  let ultimoAcorde = ''
  let ultimoTiempo = 0

  for (let t = 0; t < cromas.length; t++) {
    const croma = cromas[t]!
    const tiempo = tiemposSeg[t]!

    let mejorScore = -1
    let mejorNombre = 'N.C.' // No chord

    // Comparar contra todas las fundamentales y tipos de acorde
    for (let r = 0; r < 12; r++) {
      for (const p of PLANTILLAS_ACORDES) {
        let dot = 0
        for (const st of p.semitonos) {
          const pc = (r + st) % 12
          dot += croma[pc]!
        }
        const score = dot / Math.sqrt(p.semitonos.length)
        if (score > mejorScore) {
          mejorScore = score
          mejorNombre = `${NOTAS_OCCIDENTALES[r]}${p.tipo}`
        }
      }
    }

    // Filtrar cambios espurios: emitir solo si cambia o si transcurrió al menos 1 segundo
    if (mejorScore > 0.45 && (mejorNombre !== ultimoAcorde || tiempo - ultimoTiempo >= 2.0)) {
      const beat = Math.round((tiempo * (bpm / 60)) * 100) / 100
      resultados.push({
        tiempoSeg: Math.round(tiempo * 1000) / 1000,
        beat,
        acorde: mejorNombre,
        confianza: Math.round(Math.min(1, mejorScore) * 100) / 100,
      })
      ultimoAcorde = mejorNombre
      ultimoTiempo = tiempo
    }
  }

  return resultados
}

/**
 * Analizador de transitorios y clasificador espectral especializado en Beatbox / Percusión Vocal.
 *
 * Mapeo de frecuencias del aparato fonador para percusión:
 * - Kick: oclusivas bilabiales ("b", "p", "dum"), energía concentrada < 150 Hz.
 * - Snare: oclusivas velares / chasquidos ("k", "tsh"), cuerpo en 300-2500 Hz y alto nivel de transitorio.
 * - Hi-Hat: fricativas dentales/alveolares ("ts", "t", "ch"), concentración > 5000 Hz, rápida disipación.
 */
export function clasificarPercusionVocal(
  muestras: Float64Array | Float32Array,
  sampleRate: number,
  opciones: OpcionesBeatboxADrums = {},
): {
  notas: NotaBateriaMidi[]
  metricas: {
    energiaSub: number
    energiaMedios: number
    energiaAltos: number
    pausas: { inicio: number; fin: number; duracion: number }[]
  }
} {
  const bpm = opciones.bpmProyecto ?? 120
  const sensibilidad = opciones.sensibilidad ?? 1.0
  const cuantizar = opciones.cuantizar ?? 'off'

  const n = muestras.length
  if (n === 0) {
    return {
      notas: [],
      metricas: { energiaSub: 0, energiaMedios: 0, energiaAltos: 0, pausas: [] },
    }
  }

  // 1. Detección de pausas / silencios
  const tamanoBloqueRms = Math.floor(sampleRate * 0.05) // 50 ms
  const umbralSilencioLin = Math.pow(10, (opciones.umbralSilencioDb ?? -45) / 20)
  const pausas: { inicio: number; fin: number; duracion: number }[] = []
  let enSilencio = false
  let inicioSilencio = 0

  for (let i = 0; i < n; i += tamanoBloqueRms) {
    let sumSqr = 0
    const limite = Math.min(n, i + tamanoBloqueRms)
    for (let j = i; j < limite; j++) {
      const s = muestras[j] as number
      sumSqr += s * s
    }
    const rms = Math.sqrt(sumSqr / (limite - i))
    const tSeg = i / sampleRate

    if (rms < umbralSilencioLin) {
      if (!enSilencio) {
        enSilencio = true
        inicioSilencio = tSeg
      }
    } else {
      if (enSilencio) {
        enSilencio = false
        const dur = tSeg - inicioSilencio
        if (dur >= 0.15) {
          // Pausa relevante mayor a 150ms
          pausas.push({
            inicio: Math.round(inicioSilencio * 1000) / 1000,
            fin: Math.round(tSeg * 1000) / 1000,
            duracion: Math.round(dur * 1000) / 1000,
          })
        }
      }
    }
  }

  // 2. STFT corta para detección de transitorios y separación por bandas
  const nFft = 512
  const salto = 128
  const w = ventanaHann(nFft)
  const nTramas = n >= nFft ? Math.floor((n - nFft) / salto) + 1 : 0

  const re = new Float64Array(nFft)
  const im = new Float64Array(nFft)

  const binSubMax = Math.min(nFft >> 1, Math.floor((180 * nFft) / sampleRate))
  const binMidMin = Math.floor((250 * nFft) / sampleRate)
  const binMidMax = Math.min(nFft >> 1, Math.floor((3000 * nFft) / sampleRate))
  const binHiMin = Math.floor((4500 * nFft) / sampleRate)
  const binHiMax = (nFft >> 1) - 1

  const numBinsSub = Math.max(1, binSubMax)
  const numBinsMid = Math.max(1, binMidMax - binMidMin + 1)
  const numBinsHi = Math.max(1, binHiMax - binHiMin + 1)

  let energiaSubTotal = 0
  let energiaMediosTotal = 0
  let energiaAltosTotal = 0

  // Curva de flujo y energía por banda
  const flujo = new Float64Array(nTramas)
  const magSub = new Float64Array(nTramas)
  const magMid = new Float64Array(nTramas)
  const magHi = new Float64Array(nTramas)
  const espectroPrevio = new Float64Array(nFft >> 1)

  for (let t = 0; t < nTramas; t++) {
    const pos = t * salto
    for (let i = 0; i < nFft; i++) {
      re[i] = (muestras[pos + i] as number) * (w[i] as number)
      im[i] = 0
    }
    fftEnLugar(re, im)

    let sub = 0
    let mid = 0
    let hi = 0
    let diffPositiva = 0

    const mitad = nFft >> 1
    for (let k = 1; k < mitad; k++) {
      const mag = Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!)
      const prev = espectroPrevio[k]!
      espectroPrevio[k] = mag

      if (mag > prev) diffPositiva += mag - prev

      if (k <= binSubMax) sub += mag
      else if (k >= binMidMin && k <= binMidMax) mid += mag
      else if (k >= binHiMin && k <= binHiMax) hi += mag
    }

    sub /= numBinsSub
    mid /= numBinsMid
    hi /= numBinsHi

    flujo[t] = diffPositiva
    magSub[t] = sub
    magMid[t] = mid
    magHi[t] = hi

    energiaSubTotal += sub
    energiaMediosTotal += mid
    energiaAltosTotal += hi
  }

  // 3. Localización de picos de onset
  const notas: NotaBateriaMidi[] = []
  const separacionMinTramas = Math.floor((0.07 * sampleRate) / salto) // Mínimo 70 ms entre golpes
  let ultimaTrama = -separacionMinTramas

  // Umbral adaptativo de flujo espectral
  let sumaFlujo = 0
  for (let t = 0; t < nTramas; t++) sumaFlujo += flujo[t]!
  const mediaFlujo = nTramas > 0 ? sumaFlujo / nTramas : 0
  const umbralFlujo = (mediaFlujo * 1.4) / Math.max(0.2, sensibilidad)

  for (let t = 1; t < nTramas - 1; t++) {
    const val = flujo[t]!
    if (
      val > umbralFlujo &&
      val >= flujo[t - 1]! &&
      val >= flujo[t + 1]! &&
      t - ultimaTrama >= separacionMinTramas
    ) {
      ultimaTrama = t
      const tiempoSeg = (t * salto) / sampleRate

      // Clasificación del golpe según predominancia espectral local
      const eSub = magSub[t]!
      const eMid = magMid[t]!
      const eHi = magHi[t]!
      const totalLocal = eSub + eMid + eHi + 1e-9

      const ratioSub = eSub / totalLocal
      const ratioMid = eMid / totalLocal
      const ratioHi = eHi / totalLocal

      let instrumento: NotaBateriaMidi['instrumento'] = 'percussion'
      let notaMidi = 36 // General MIDI default kick
      let duracionBeats = 0.25

      if (ratioSub > 0.38 || (ratioSub > 0.28 && ratioSub > ratioHi * 1.5)) {
        // Sonido grave dominante -> BOMBO / KICK
        instrumento = 'kick'
        notaMidi = 36
        duracionBeats = 0.5
      } else if (ratioHi > 0.35 && ratioHi > ratioMid && ratioHi > ratioSub) {
        // Sonido agudo sibilante (hi-hat / charles)
        const postHi = t + 3 < nTramas ? magHi[t + 3]! : 0
        if (postHi > eHi * 0.45) {
          instrumento = 'hihat_open'
          notaMidi = 46
          duracionBeats = 0.5
        } else {
          instrumento = 'hihat_closed'
          notaMidi = 42
          duracionBeats = 0.25
        }
      } else if (ratioMid >= 0.20 || ratioMid + ratioHi > 0.50) {
        // Sonido con cuerpo de medios (chasquido/impacto de caja/snare)
        instrumento = 'snare'
        notaMidi = 38
        duracionBeats = 0.25
      }

      // Cálculo de velocidad MIDI (1 a 127) según energía relativa del golpe
      const energiaMax = Math.max(eSub, eMid, eHi)
      const velFloat = 40 + Math.min(87, Math.sqrt(energiaMax) * 15 * sensibilidad)
      const velocidad = Math.max(1, Math.min(127, Math.round(velFloat)))

      // Cálculo del beat con o sin cuantización
      let beatCalculado = (tiempoSeg * bpm) / 60
      if (cuantizar === '1/16') {
        beatCalculado = Math.round(beatCalculado * 4) / 4
      } else if (cuantizar === '1/8') {
        beatCalculado = Math.round(beatCalculado * 2) / 2
      } else if (cuantizar === '1/4') {
        beatCalculado = Math.round(beatCalculado)
      } else {
        beatCalculado = Math.round(beatCalculado * 1000) / 1000
      }

      notas.push({
        tiempoSeg: Math.round(tiempoSeg * 1000) / 1000,
        beat: beatCalculado,
        instrumento,
        notaMidi,
        velocidad,
        duracionBeats,
        duracionSeg: (duracionBeats * 60) / bpm,
      })
    }
  }

  return {
    notas,
    metricas: {
      energiaSub: Math.round(energiaSubTotal),
      energiaMedios: Math.round(energiaMediosTotal),
      energiaAltos: Math.round(energiaAltosTotal),
      pausas,
    },
  }
}

/**
 * Función principal que genera el informe descriptivo completo para la IA y JasWave.
 */
export function generarDescripcionMusicalAudio(
  muestras: Float64Array | Float32Array,
  sampleRate: number,
  opciones: OpcionesBeatboxADrums = {},
): AnalisisMusicalDescriptivo {
  const duracionSeg = muestras.length / sampleRate
  const bpmProyecto = opciones.bpmProyecto ?? 120

  // 1. Análisis armónico
  const { cromas, tiemposSeg } = calcularCromagrama(muestras, sampleRate)
  const tonalidad = estimarTonalidad(cromas)
  const progresionAcordes = detectarSecuenciaAcordes(cromas, tiemposSeg, bpmProyecto)

  // 2. Análisis rítmico y beatbox
  const { notas, metricas } = clasificarPercusionVocal(muestras, sampleRate, opciones)

  let kicks = 0
  let snares = 0
  let hihats = 0
  for (const n of notas) {
    if (n.instrumento === 'kick') kicks++
    else if (n.instrumento === 'snare') snares++
    else if (n.instrumento === 'hihat_closed' || n.instrumento === 'hihat_open') hihats++
  }

  // 3. Generación del resumen textual interpretativo para el modelo de IA
  const acordesStr =
    progresionAcordes.length > 0
      ? progresionAcordes.map((a) => `${a.acorde} (t=${a.tiempoSeg}s / beat ${a.beat})`).join(' -> ')
      : 'No se detectó progresión armónica tonal definida (posible audio percusivo o monofónico).'

  const pausasStr =
    metricas.pausas.length > 0
      ? metricas.pausas.map((p) => `[${p.inicio}s a ${p.fin}s, dur=${p.duracion}s]`).join(', ')
      : 'Sin silencios prolongados detectados.'

  const resumenParaIA = `=== REPORTE JASWAVE AUDIOLENS ===
- Duración total: ${duracionSeg.toFixed(2)} segundos.
- Tonalidad estimada: ${tonalidad.raiz} ${tonalidad.escala.toUpperCase()} (confianza: ${(tonalidad.confianza * 100).toFixed(0)}%).
- Progresión de acordes: ${acordesStr}
- Desglose de percusión detectada (Total: ${notas.length} impactos):
  * Kicks (Bombos): ${kicks}
  * Snares (Cajas/Chasquidos): ${snares}
  * Hi-Hats / Platillos: ${hihats}
- Pausas y silencios: ${pausasStr}
- Distribución de energía espectral: Sub=${metricas.energiaSub}, Medios=${metricas.energiaMedios}, Altos=${metricas.energiaAltos}.
- Recomendación de producción: ${
    notas.length > 0
      ? `Patrón rítmico listo para replicar en pista MIDI con ${kicks} bombos y ${snares} cajas adaptados a ${bpmProyecto} BPM.`
      : 'Audio melódico/armónico predominante.'
  }`

  return {
    duracionSeg: Math.round(duracionSeg * 100) / 100,
    bpmEstimado: bpmProyecto,
    tonalidad,
    progresionAcordes,
    bateriaDetectada: {
      totalGolpes: notas.length,
      kicks,
      snares,
      hihats,
      notas,
    },
    metricasEspectrales: {
      energiaSub: metricas.energiaSub,
      energiaMedios: metricas.energiaMedios,
      energiaAltos: metricas.energiaAltos,
      pausasDetectadasSeg: metricas.pausas,
    },
    resumenParaIA,
  }
}
