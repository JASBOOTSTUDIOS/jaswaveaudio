/**
 * Tipos del «toque» del intérprete: perfil estadístico de micro-timing, microdinámica, dispersión de
 * acordes, articulación y ataque aprendido de sus interpretaciones MIDI (clips o captura del teclado).
 *
 * El perfil NO guarda las notas: solo distribuciones (media, desviación, nº de muestras) que luego se
 * reproducen sobre notas nuevas con un PRNG con semilla.
 */

/** Nota mínima que entiende el módulo. Tiempos en beats (negra = 1); velocidad MIDI 1..127. */
export interface NotaToque {
  pitch: number;
  /** Inicio en beats (relativo al clip o a la captura). */
  inicio: number;
  /** Duración en beats. */
  duracion: number;
  velocidad?: number;
}

/**
 * Posición métrica de un ataque una vez llevado a la rejilla:
 * - fuerte: primer tiempo del compás.
 * - debil: resto de tiempos (negras).
 * - contratiempo: corchea entre tiempos (x.5).
 * - subdivision: semicorcheas / tresillos (resto de la rejilla).
 */
export type PosicionMetrica = 'fuerte' | 'debil' | 'contratiempo' | 'subdivision';

export const POSICIONES_METRICAS: readonly PosicionMetrica[] = ['fuerte', 'debil', 'contratiempo', 'subdivision'];

export interface Estadistica {
  media: number;
  /** Desviación típica (poblacional). */
  sd: number;
  /** Número de muestras. 0 = sin datos (media/sd = 0). */
  n: number;
}

export type ConfianzaToque = 'baja' | 'media' | 'alta';

export interface PerfilToque {
  version: 1;
  instrumento?: string;
  /** Instrumento de percusión: el timing y la dinámica se aplican por pitch (bombo, caja, hi-hat…). */
  percusivo: boolean;
  /** Tempo con el que se midieron los ms. */
  bpmReferencia: number;
  /** Rejilla (beats) respecto a la que se mide el micro-timing. */
  rejillaBeats: number;
  beatsPorCompas: number;
  muestras: { notas: number; grupos: number; acordes: number; arpegios: number; frases: number };
  confianza: ConfianzaToque;
  /** 0..1 (≈ grupos útiles / 48). */
  confianzaNum: number;
  /** Micro-timing del ataque de cada grupo en ms respecto a la rejilla (+ = tarde / laid-back). */
  timing: { global: Estadistica; porPosicion: Record<PosicionMetrica, Estadistica> };
  /**
   * Microdinámica. `porPosicion` mide la velocidad media de cada ataque (grupo) según su posición métrica;
   * `global` la de todas las notas.
   */
  dinamica: { global: Estadistica; porPosicion: Record<PosicionMetrica, Estadistica>; min: number; max: number };
  /** Notas casi simultáneas (acordes / dobles notas). */
  acordes: {
    /** Proporción de acordes tocados con dispersión audible (arpegiados / strum). */
    probArpegiado: number;
    /** De los arpegiados: proporción que entra grave→agudo. */
    ordenAscendente: number;
    /** De los arpegiados: proporción que entra agudo→grave (el resto, orden mixto). */
    ordenDescendente: number;
    /** ms entre notas consecutivas de un acorde arpegiado. */
    msEntreNotas: Estadistica;
    /** ms entre la primera y la última nota del acorde arpegiado. */
    spanMs: Estadistica;
    /** Velocidad de la voz superior respecto a la media del acorde. */
    enfasisSuperior: number;
    /** Velocidad del bajo respecto a la media del acorde. */
    enfasisBajo: number;
    /** Velocidad media de las voces interiores respecto a la media del acorde. */
    enfasisMedio: number;
    /** Dispersión de la velocidad de las voces interiores. */
    sdVelocidadInterna: number;
  };
  /** Arpegios melódicos (≥3 notas sueltas en la misma dirección): curva de velocidad inicio/medio/fin. */
  arpegios: { n: number; curva: [number, number, number] };
  /** Articulación: duración / distancia al siguiente ataque (≥1 = legato con solape, <0.5 = staccato). */
  articulacion: { ratio: Estadistica; legato: number; staccato: number; solapeMs: Estadistica };
  /** Ataque: refuerzo de la primera nota de cada frase y acentos. */
  ataque: {
    /** Velocidad del primer ataque de frase menos la esperada por su posición métrica. */
    inicioFraseDelta: Estadistica;
    acentos: { proporcion: number; deltaMedio: number };
  };
  /** Timing y velocidad por nota MIDI (sobre todo para batería). Solo pitches con ≥4 muestras. */
  porPitch: Record<string, { timing: Estadistica; velocidad: Estadistica }>;
  rango: { pitchMin: number; pitchMax: number } | null;
}

export interface OpcionesAprenderToque {
  bpm: number;
  /** Rejilla en beats (0.25 = semicorchea). Sin indicar: se elige entre semicorchea y tresillo de corchea. */
  rejillaBeats?: number;
  instrumento?: string;
  /** Posición del inicio de las notas en el proyecto (inicio del clip) para la métrica. */
  offsetBeats?: number;
  /** Beats (negras) por compás. 4 por defecto. */
  beatsPorCompas?: number;
  /** Separación máxima (ms) entre notas consecutivas de un mismo acorde. 35 por defecto. */
  ventanaAcordeMs?: number;
}

export interface OpcionesAplicarToque {
  /** Tempo del destino (para convertir ms ↔ beats). Por defecto, el de referencia del perfil. */
  bpm?: number;
  /** 0 = notas intactas · 1 = toque completo. 1 por defecto. */
  intensidad?: number;
  semilla?: number;
  offsetBeats?: number;
  beatsPorCompas?: number;
  /** Cuánto del contorno dinámico de las notas de entrada se conserva (0..1). 0.3 por defecto. */
  conservarDinamica?: number;
  /** Partir de la rejilla (quita humanización previa) antes de aplicar el toque. true por defecto. */
  partirDeRejilla?: boolean;
}
