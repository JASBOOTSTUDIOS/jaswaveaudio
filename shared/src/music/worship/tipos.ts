/** Tipos públicos del motor de composición de worship moderno. */

import type { EventoCC } from './expresion';

export type RolWorship = 'piano' | 'pad' | 'cuerdas' | 'bajo' | 'bateria' | 'guitarra' | 'melodia';

export const ROLES_WORSHIP: readonly RolWorship[] = ['piano', 'pad', 'cuerdas', 'bajo', 'bateria', 'guitarra', 'melodia'];

export type RaizWorship = 'C' | 'C#' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';

export type EscalaWorship = 'mayor' | 'menor';

export type TipoSeccionWorship = 'intro' | 'verso' | 'precoro' | 'coro' | 'puente' | 'coroFinal' | 'outro';

export type EstiloWorship = 'ballad' | 'anthem' | 'ambient';

export type CompasWorship = '4/4' | '6/8';

export interface SpecSeccionWorship {
  tipo: TipoSeccionWorship;
  compases: number;
  /** Grados romanos ('I', 'V/3', 'vi7', 'IVadd9/I') o símbolos ('D', 'A/C#', 'Bm7', 'Asus4'). Todos diatónicos. */
  progresion?: string[];
  /** 0..1. Es la intensidad al final de la sección; el inicio se deduce del arco por defecto del tipo. */
  intensidad?: number;
}

export interface SpecWorship {
  semilla: number;
  bpm?: number;
  tonalidad?: { raiz: RaizWorship; escala: EscalaWorship };
  compas?: CompasWorship;
  /** 0..1 (0 = mecánico, 1 = muy humano). Por defecto 0.65. */
  humanizacion?: number;
  titulo?: string;
  secciones?: SpecSeccionWorship[];
  roles?: RolWorship[];
  estilo?: EstiloWorship;
  /** Rubato leve en intro/outro (por defecto true; sólo actúa si humanizacion > 0). */
  rubato?: boolean;
  /** Capa de interpretación (pedal, legato, acentos, bajo pegado al bombo, crash...). Por defecto true; sólo actúa si humanizacion > 0. */
  expresion?: boolean;
  /** Slides, rasgueos con dirección, palm mute y swells de la guitarra (keyswitches + CC). Por defecto activo; `false` los quita. */
  tecnicasGuitarra?: boolean;
}

export type ArticulacionWorship = 'fantasma' | 'flam' | 'flam-gracia' | 'acento';

export interface NotaWorship {
  pitch: number;
  /** Beats absolutos desde 0 (negra = 1 beat). */
  inicio: number;
  duracion: number;
  /** 1..127 */
  velocidad: number;
  /** Desviación inicial en semitonos que se resuelve a 0 durante la nota (p. ej. -1 = sube un semitono hasta el pitch). */
  bend?: number;
  /** Micro-timing aplicado (ms) por humanización (gaussiano + laid-back). No incluye strum ni rubato. */
  desfaseMs?: number;
  /** Retardo (ms) por strum de acorde dentro de su grupo. */
  strumMs?: number;
  /** Etiqueta expresiva: notas fantasma, flams, etc. */
  articulacion?: ArticulacionWorship;
}

export interface EventoPitchBend {
  inicio: number;
  /** Semitonos respecto al pitch de la nota (rango -2..2). */
  semitonos: number;
}

export interface SeccionArreglo {
  tipo: TipoSeccionWorship;
  nombre: string;
  /** Posición de la sección en la forma (0..n-1). */
  indice: number;
  /** Nº de repetición de este tipo (0 = primera). */
  repeticion: number;
  inicioCompas: number;
  compases: number;
  inicioBeat: number;
  duracionBeats: number;
  /** Intensidad al final de la sección (0..1). */
  intensidad: number;
  intensidadInicial: number;
  /** Intensidad compás a compás (longitud = compases). */
  intensidadPorCompas: number[];
  /** Matriz de orquestación: roles que tocan en la sección. */
  roles: RolWorship[];
  /** Compás (relativo a la sección) en el que entra cada rol: entradas escalonadas. */
  entradas: Partial<Record<RolWorship, number>>;
}

export interface AcordeArreglo {
  simbolo: string;
  romano: string;
  inicio: number;
  duracion: number;
  /** Compás global (0-based) en que empieza. */
  compas: number;
  seccion: number;
  /** Pitch classes absolutas de las notas del acorde (0..11). */
  pcs: number[];
  raizPc: number;
  bajoPc: number;
}

export interface MarcadorArreglo {
  nombre: string;
  inicio: number;
  tipo: TipoSeccionWorship;
}

export interface ArregloWorship {
  version: 1;
  titulo: string;
  semilla: number;
  bpm: number;
  compas: CompasWorship;
  beatsPorCompas: number;
  tonalidad: { raiz: RaizWorship; escala: EscalaWorship };
  humanizacion: number;
  estilo: EstiloWorship;
  totalCompases: number;
  duracionBeats: number;
  duracionSegundos: number;
  secciones: SeccionArreglo[];
  acordes: AcordeArreglo[];
  marcadores: MarcadorArreglo[];
  partes: Record<RolWorship, NotaWorship[]>;
  pitchBend: Partial<Record<RolWorship, EventoPitchBend[]>>;
  /** Controladores MIDI (CC64 pedal del piano, CC11 expresión de pad/cuerdas) en beats absolutos. */
  cc?: Partial<Record<RolWorship, EventoCC[]>>;
}

/** Rangos MIDI permitidos por rol. */
export const RANGOS_WORSHIP: Record<RolWorship, [number, number]> = {
  piano: [45, 84],
  pad: [55, 88],
  cuerdas: [48, 86],
  bajo: [28, 45],
  bateria: [35, 81],
  guitarra: [52, 88],
  melodia: [62, 81],
};

export const NOMBRE_PISTA_ROL: Record<RolWorship, string> = {
  piano: 'Piano',
  pad: 'Pad',
  cuerdas: 'Cuerdas',
  bajo: 'Bajo',
  bateria: 'Batería',
  guitarra: 'Guitarra',
  melodia: 'Melodía',
};

export const COLOR_PISTA_ROL: Record<RolWorship, string> = {
  piano: '#60a5fa',
  pad: '#a78bfa',
  cuerdas: '#f472b6',
  bajo: '#34d399',
  bateria: '#fb923c',
  guitarra: '#facc15',
  melodia: '#f87171',
};

/** Desviación típica del micro-timing (ms) a humanizacion = 1, por rol (batería: valor base de hi-hat/toms). */
export const HUMANIZACION_SD_MS: Record<RolWorship, number> = {
  piano: 8,
  pad: 14,
  cuerdas: 14,
  bajo: 7,
  bateria: 6,
  guitarra: 9,
  melodia: 10,
};

/** Mapa GM de batería. */
export const GM = {
  bombo: 36,
  rim: 37,
  caja: 38,
  tomBajo: 41,
  hhCerrado: 42,
  tomSuelo: 43,
  hhPie: 44,
  tomMedio: 45,
  hhAbierto: 46,
  tomMedioAlto: 47,
  tomAlto: 48,
  crash: 49,
  tomAgudo: 50,
  ride: 51,
  campana: 53,
  splash: 55,
  crash2: 57,
} as const;
