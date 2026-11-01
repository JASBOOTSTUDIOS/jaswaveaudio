/**
 * Letra y acordes del proyecto (carriles de la cabecera del arreglo).
 *
 * Los tiempos van en beats del proyecto (misma unidad que los clips y los marcadores). Toda mutación
 * pasa por los comandos `lyrics.*` / `chords.*` (undo por instantánea parcial del proyecto).
 */

export interface SilabaLetra {
  /** Texto de la sílaba tal y como se canta («pre», «sen», «cia»). */
  texto: string;
  /** Beat absoluto en el que empieza. */
  beat: number;
  /** Duración en beats. */
  duracion: number;
  /** Pitch MIDI de la melodía en esa sílaba, si se conoce. */
  nota?: number;
  /** true si la sílaba cierra una palabra (para dibujar el espacio / guion). */
  finPalabra?: boolean;
}

export interface FraseLetra {
  id: string;
  /** Texto completo de la frase (una línea de la letra). */
  texto: string;
  silabas: SilabaLetra[];
  /** Nombre de la sección a la que pertenece (Verso, Coro…), si se conoce. */
  seccion?: string;
}

export interface AcordeCarril {
  id: string;
  /** Cifrado normalizado («Cmaj9», «D/F#»). */
  nombre: string;
  beat: number;
  duracion: number;
  /** Pitches MIDI del voicing, si se fijaron (p. ej. detectados del teclado). */
  pitches?: number[];
}

export interface LetraProyecto {
  frases: FraseLetra[];
  acordes: AcordeCarril[];
}

export const LETRA_VACIA: LetraProyecto = Object.freeze({ frases: [], acordes: [] }) as LetraProyecto;
