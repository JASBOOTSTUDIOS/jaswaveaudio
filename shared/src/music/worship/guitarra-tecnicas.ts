/**
 * Técnicas de guitarra para JasWave Electric Guitar (`plugins/com.jaswave.plugin.electric-guitar`): funciones PURAS y
 * deterministas que, a partir de las notas de guitarra de una composición, generan los keyswitches, CC y solapes que el
 * plugin interpreta (slides, hammer-on/pull-off, rasgueo con dirección, palm mute, tremolo picking, armónicos, bends,
 * vibrato y volume swell). Prohibido Math.random / Date.now (usa `crearRng`).
 *
 * CONTRATO MIDI del plugin (números de nota con C4 = 60, es decir C0 = 12; los keyswitches están por debajo del
 * registro de la guitarra, no suenan y no necesitan note-off; se emiten como notas cortas, `DURACION_KS` beats):
 *   FIJOS (siguen activos hasta otro keyswitch; 12 los reinicia todos):
 *     12 normal/reset · 13 palm mute · 14 nota muerta · 15 armónico natural · 16 armónico artificial · 17 tremolo picking
 *     23 modo LEGATO (nota solapada: ≤3 st hammer-on/pull-off, 4..12 st slide) · 24 modo SLIDE (toda nota solapada se desliza)
 *     25 rasgueo abajo · 26 rasgueo arriba · 27 rasgueo alterno · 11 auto-swell por nota
 *   SOLO LA SIGUIENTE NOTA: 18 slide-in desde abajo · 19 slide-out hacia abajo · 20 slide-out hacia arriba
 *                           21 pre-bend · 22 bend-up
 *   CC: 1 vibrato (con retardo de entrada), 11 expresión (swell de pedal), 64 sustain, 80 articulación
 *       (0 normal, 25 palm mute, 51 muerta, 76 armónico natural, 102 armónico artificial, 127 tremolo picking),
 *       81 legato (0 off, 64 legato, 127 slide), 82 dirección de rasgueo (0 abajo, 64 arriba, 127 alterno),
 *       83 slide in/out permanente (0 off, 42 slide-in, 85 slide-out abajo, 127 slide-out arriba).
 *
 * Importante: SIN keyswitch 23/24 (o CC81) las notas solapadas NO se ligan (los arpegios de guitarra solapan sus notas
 * largas a propósito). Las funciones de este archivo solo activan el modo en las parejas que quieren ligar y lo desactivan
 * después (keyswitch 12) mediante el `Conmutador`, que emite el mínimo de keyswitches necesario.
 */

import type { EventoCC } from './expresion';
import { crearRng, hashSemilla } from './prng';

// ------------------------------------------------------------------------------------------------------------------
// Contrato
// ------------------------------------------------------------------------------------------------------------------

export const KS_GUITARRA = {
  autoSwell: 11,
  normal: 12,
  palmMute: 13,
  muerta: 14,
  armonicoNatural: 15,
  armonicoArtificial: 16,
  tremolo: 17,
  slideIn: 18,
  slideOutAbajo: 19,
  slideOutArriba: 20,
  preBend: 21,
  bendUp: 22,
  legato: 23,
  slide: 24,
  rasgueoAbajo: 25,
  rasgueoArriba: 26,
  rasgueoAlterno: 27,
} as const;
export type NombreKs = keyof typeof KS_GUITARRA;
export const KS_MIN = 11;
export const KS_MAX = 27;

export const CC_GUITARRA = {
  vibrato: 1,
  expresion: 11,
  sustain: 64,
  articulacion: 80,
  legato: 81,
  direccionRasgueo: 82,
  slideInOut: 83,
} as const;

/** Duración (beats) de las notas que representan un keyswitch. */
export const DURACION_KS = 0.05;
/** Antelación (beats) con que se emite un keyswitch respecto a la nota a la que afecta. */
export const ANTELACION_KS = 0.02;
/** Rango MIDI de la guitarra real del plugin; por debajo de 28 solo hay keyswitches. */
export const NOTA_MIN_GUITARRA = 28;

export interface NotaGuitarra {
  pitch: number;
  /** Beats absolutos (negra = 1). */
  inicio: number;
  duracion: number;
  /** 1..127 */
  velocidad: number;
  /** Etiqueta libre de quien llama (se conserva en las copias). */
  articulacion?: string;
  /** Desviación inicial en semitonos (convención de NotaWorship): −2 = empieza 2 st por debajo y sube. */
  bend?: number;
}

export interface SeccionGuitarra {
  inicioBeat: number;
  duracionBeats: number;
  tipo?: string;
}

export interface ResultadoTecnica {
  /** Notas de guitarra (con solapes/pitch modificados si procede) MÁS las notas de keyswitch, ordenadas por inicio. */
  notas: NotaGuitarra[];
  /** Eventos CC (valor 0..1, tiempos en beats absolutos), ordenados por tiempo. */
  cc: EventoCC[];
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export const esKeyswitch = (n: { pitch: number }): boolean => n.pitch >= KS_MIN && n.pitch <= KS_MAX;

function ordenar<T extends { inicio: number; pitch: number }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch);
}
function ordenarCc(xs: readonly EventoCC[]): EventoCC[] {
  return [...xs].sort((a, b) => a.tiempo - b.tiempo || a.cc - b.cc);
}

/** Nota de keyswitch que activa `nombre` en `inicio` (beats, ≥ 0). */
export function notaKeyswitch(nombre: NombreKs, inicio: number, velocidad = 100): NotaGuitarra {
  return { pitch: KS_GUITARRA[nombre], inicio: r4(Math.max(0, inicio)), duracion: DURACION_KS, velocidad, articulacion: `ks:${nombre}` };
}

// ------------------------------------------------------------------------------------------------------------------
// Conmutador: estado de los keyswitches FIJOS y emisión mínima
// ------------------------------------------------------------------------------------------------------------------

export type ArticulacionFija = 'normal' | 'palmMute' | 'muerta' | 'armonicoNatural' | 'armonicoArtificial' | 'tremolo';
export type ModoLegato = 'off' | 'legato' | 'slide';
export type DireccionRasgueo = 'abajo' | 'arriba' | 'alterno';

export interface EstadoGuitarra {
  articulacion: ArticulacionFija;
  legato: ModoLegato;
  direccion: DireccionRasgueo;
  autoSwell: boolean;
}
export const ESTADO_INICIAL: Readonly<EstadoGuitarra> = { articulacion: 'normal', legato: 'off', direccion: 'abajo', autoSwell: false };

const KS_ARTICULACION: Record<ArticulacionFija, NombreKs> = {
  normal: 'normal',
  palmMute: 'palmMute',
  muerta: 'muerta',
  armonicoNatural: 'armonicoNatural',
  armonicoArtificial: 'armonicoArtificial',
  tremolo: 'tremolo',
};
const KS_DIRECCION: Record<DireccionRasgueo, NombreKs> = { abajo: 'rasgueoAbajo', arriba: 'rasgueoArriba', alterno: 'rasgueoAlterno' };

/**
 * Lleva el estado del plugin y emite solo los keyswitches necesarios. Como el keyswitch 12 reinicia TODO el estado, volver a un
 * valor por defecto (normal / legato off / abajo / sin auto-swell) cuesta un 12 y reponer lo demás que debiera seguir activo.
 */
export class Conmutador {
  private estado: EstadoGuitarra = { ...ESTADO_INICIAL };
  readonly notas: NotaGuitarra[] = [];
  actual(): Readonly<EstadoGuitarra> {
    return this.estado;
  }
  /** Pide el estado `deseado` (parcial) justo antes de `t`. Devuelve true si emitió algún keyswitch. */
  fijar(t: number, deseado: Partial<EstadoGuitarra>): boolean {
    const d: EstadoGuitarra = { ...this.estado, ...deseado };
    const e = this.estado;
    if (d.articulacion === e.articulacion && d.legato === e.legato && d.direccion === e.direccion && d.autoSwell === e.autoSwell) return false;
    const vuelveADefecto =
      (d.articulacion === 'normal' && e.articulacion !== 'normal') ||
      (d.legato === 'off' && e.legato !== 'off') ||
      (d.direccion === 'abajo' && e.direccion !== 'abajo') ||
      (!d.autoSwell && e.autoSwell);
    let ts = t - ANTELACION_KS;
    const paso = 0.004;
    let base: EstadoGuitarra = e;
    if (vuelveADefecto) {
      this.emitir('normal', ts);
      ts += paso;
      base = { ...ESTADO_INICIAL };
    }
    if (d.articulacion !== base.articulacion) { this.emitir(KS_ARTICULACION[d.articulacion], ts); ts += paso; }
    if (d.legato !== base.legato) { this.emitir(d.legato === 'legato' ? 'legato' : 'slide', ts); ts += paso; }
    if (d.direccion !== base.direccion) { this.emitir(KS_DIRECCION[d.direccion], ts); ts += paso; }
    if (d.autoSwell && !base.autoSwell) { this.emitir('autoSwell', ts); ts += paso; }
    this.estado = d;
    return true;
  }
  /** Keyswitch de una sola nota (slide-in/out, pre-bend, bend-up): no cambia el estado fijo. */
  siguienteNota(t: number, nombre: 'slideIn' | 'slideOutAbajo' | 'slideOutArriba' | 'preBend' | 'bendUp', desplazamiento = 0): void {
    this.emitir(nombre, t - ANTELACION_KS - desplazamiento);
  }
  private emitir(nombre: NombreKs, t: number): void {
    this.notas.push(notaKeyswitch(nombre, Math.max(0, t)));
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Decisiones por nota -> keyswitches mínimos
// ------------------------------------------------------------------------------------------------------------------

/** Estado fijo deseado EN EL INSTANTE de una nota (solo los campos presentes; el resto se mantiene como está). */
type Intencion = Partial<EstadoGuitarra>;

/**
 * Recorre las notas (agrupando las que empiezan juntas) y emite con un único `Conmutador` los keyswitches fijos que hacen falta
 * para que cada nota se encuentre con el estado que `intencion` pide. Es el único punto que emite keyswitches fijos, de modo que
 * varias técnicas combinadas (palm mute + rasgueo + slides…) nunca se pisan.
 */
function emitirPorNota(notas: readonly NotaGuitarra[], intencion: (n: NotaGuitarra) => Intencion | undefined): NotaGuitarra[] {
  const con = new Conmutador();
  let ultimoGrupo = -Infinity;
  for (const n of ordenar(notas)) {
    if (n.inicio - ultimoGrupo <= 0.06) continue;      // el estado se fija con la primera nota del golpe
    ultimoGrupo = n.inicio;
    const d = intencion(n);
    if (d) con.fijar(n.inicio, d);
  }
  return con.notas;
}

const sinKs = (xs: readonly NotaGuitarra[]): NotaGuitarra[] => ordenar(xs.filter((n) => !esKeyswitch(n))).map((n) => ({ ...n }));

// ------------------------------------------------------------------------------------------------------------------
// 1) Slides y ligaduras entre notas de una melodía
// ------------------------------------------------------------------------------------------------------------------

export interface OpcionesSlides {
  semilla: number;
  /** Probabilidad de ligar cada pareja candidata (0..1). Por defecto 0.5. */
  probabilidad?: number;
  /** Hueco máximo (beats) entre el final de la nota y el inicio de la siguiente para considerarlas una línea. Por defecto 0.26. */
  huecoMax?: number;
  /** Duración mínima (beats) de la primera nota para ligar. Por defecto 0.4. */
  duracionMin?: number;
  /** Intervalo mínimo / máximo (semitonos, valor absoluto) a deslizar. Por defecto 4..12. */
  intervaloMin?: number;
  intervaloMax?: number;
  /** Ligar también hammer-on/pull-off en intervalos de 1..3 st (modo legato). Por defecto true. */
  hammerPull?: boolean;
  /** Solape (beats) que se da a la nota que se liga: la primera sigue sonando `solape` tras empezar la segunda. Por defecto 0.08. */
  solape?: number;
}

export interface ParejaLigada {
  /** Índices en el array de notas de guitarra ordenado por inicio (sin keyswitches) de la salida. */
  desde: number;
  hasta: number;
  tipo: 'slide' | 'hammer' | 'pull';
}

/** Decide las parejas ligadas y alarga la primera nota de cada una (muta `notas`, que deben estar ordenadas y ser copias). */
function decidirSlides(notas: NotaGuitarra[], opc: OpcionesSlides): { parejas: ParejaLigada[]; modo: Map<NotaGuitarra, ModoLegato> } {
  const rng = crearRng(hashSemilla(opc.semilla, 'guitarra-slides'));
  const prob = opc.probabilidad ?? 0.5;
  const huecoMax = opc.huecoMax ?? 0.26;
  const durMin = opc.duracionMin ?? 0.4;
  const iMin = opc.intervaloMin ?? 4;
  const iMax = opc.intervaloMax ?? 12;
  const hp = opc.hammerPull ?? true;
  const solape = opc.solape ?? 0.08;
  const esAcorde = (i: number) => notas.some((m, j) => j !== i && Math.abs(m.inicio - notas[i]!.inicio) < 0.06);
  const parejas: ParejaLigada[] = [];
  const modo = new Map<NotaGuitarra, ModoLegato>();
  for (let i = 0; i + 1 < notas.length; i++) {
    const a = notas[i]!;
    const b = notas[i + 1]!;
    if (esAcorde(i) || esAcorde(i + 1) || parejas.some((p) => p.hasta === i)) continue; // una nota no es destino y origen a la vez
    if (b.inicio - (a.inicio + a.duracion) > huecoMax || a.duracion < durMin || a.pitch === b.pitch) continue;
    const d = b.pitch - a.pitch;
    const ad = Math.abs(d);
    let tipo: ParejaLigada['tipo'] | null = null;
    if (ad >= iMin && ad <= iMax) tipo = 'slide';
    else if (hp && ad >= 1 && ad <= 3) tipo = d > 0 ? 'hammer' : 'pull';
    if (!tipo || !rng.prob(prob)) continue;
    // la primera nota sigue sonando `solape` beats después de empezar la segunda, sin sobrepasar el final de la segunda
    a.duracion = r4(Math.min(Math.max(a.duracion, b.inicio - a.inicio + solape), b.inicio + b.duracion - a.inicio - 0.02));
    parejas.push({ desde: i, hasta: i + 1, tipo });
    const m: ModoLegato = tipo === 'slide' ? 'slide' : 'legato';
    modo.set(a, m);
    modo.set(b, m);
  }
  return { parejas, modo };
}

/**
 * Convierte parejas consecutivas de una línea melódica en slides (intervalo `intervaloMin..intervaloMax`) o hammer-on/pull-off
 * (1..3 st): alarga la primera nota para que solape con la segunda y rodea la pareja con el modo del plugin (keyswitch 24 slide /
 * 23 legato … 12). Las notas que no se ligan quedan intactas y el modo vuelve a "off", de modo que ningún otro solape se liga
 * sin querer. Solo considera notas monofónicas: un inicio compartido por varias notas (±0.06 beat) es un acorde y se ignora.
 */
export function slidesEnMelodia(notasIn: readonly NotaGuitarra[], opc: OpcionesSlides): ResultadoTecnica & { parejas: ParejaLigada[] } {
  const notas = sinKs(notasIn);
  const { parejas, modo } = decidirSlides(notas, opc);
  const ks = emitirPorNota(notas, (n) => ({ legato: modo.get(n) ?? 'off' }));
  return { notas: ordenar([...notas, ...ks]), cc: [], parejas };
}

// ------------------------------------------------------------------------------------------------------------------
// 2) Rasgueo con dirección
// ------------------------------------------------------------------------------------------------------------------

export interface OpcionesRasgueo {
  /** 'alterno' (por defecto): abajo en los tiempos (parte entera del beat) y arriba en los contratiempos. */
  patron?: 'alterno' | 'abajo' | 'arriba' | readonly ('abajo' | 'arriba')[];
  /** Notas mínimas para considerar un grupo un rasgueo. Por defecto 3. */
  minNotas?: number;
  /** Tolerancia de inicio (beats) para agrupar las notas de un mismo golpe. Por defecto 0.06. */
  tolerancia?: number;
}

/** Agrupa notas que empiezan juntas (un golpe de acorde) y se queda con los grupos de al menos `minNotas`. */
export function gruposDeAcorde(notasIn: readonly NotaGuitarra[], minNotas = 3, tol = 0.06): NotaGuitarra[][] {
  const grupos: NotaGuitarra[][] = [];
  for (const n of ordenar(notasIn.filter((m) => !esKeyswitch(m)))) {
    const g = grupos[grupos.length - 1];
    if (g && n.inicio - g[0]!.inicio <= tol) g.push(n); else grupos.push([n]);
  }
  return grupos.filter((g) => g.length >= minNotas);
}

function decidirDirecciones(notas: readonly NotaGuitarra[], opc: OpcionesRasgueo): Map<NotaGuitarra, DireccionRasgueo> {
  const patron = opc.patron ?? 'alterno';
  const out = new Map<NotaGuitarra, DireccionRasgueo>();
  gruposDeAcorde(notas, opc.minNotas ?? 3, opc.tolerancia ?? 0.06).forEach((g, k) => {
    const t = g[0]!.inicio;
    let d: DireccionRasgueo;
    if (patron === 'abajo') d = 'abajo';
    else if (patron === 'arriba') d = 'arriba';
    else if (patron === 'alterno') d = Math.abs(t - Math.round(t)) < 0.13 ? 'abajo' : 'arriba';
    else d = patron[k % patron.length] ?? 'abajo';
    for (const n of g) out.set(n, d);
  });
  return out;
}

/**
 * Elige la dirección de cada golpe de acorde y emite los keyswitches de rasgueo (25 abajo / 26 arriba) solo cuando cambia.
 * El plugin ordena las cuerdas (graves primero en abajo, agudos primero en arriba) y reparte velocidad por cuerda.
 */
export function rasgueosConDireccion(notasIn: readonly NotaGuitarra[], opc: OpcionesRasgueo = {}): ResultadoTecnica & { direcciones: DireccionRasgueo[] } {
  const notas = sinKs(notasIn);
  const dir = decidirDirecciones(notas, opc);
  const ks = emitirPorNota(notas, (n) => (dir.has(n) ? { direccion: dir.get(n)! } : undefined));
  const direcciones = gruposDeAcorde(notas, opc.minNotas ?? 3, opc.tolerancia ?? 0.06).map((g) => dir.get(g[0]!)!);
  return { notas: ordenar([...notas, ...ks]), cc: [], direcciones };
}

// ------------------------------------------------------------------------------------------------------------------
// 3) Palm mute en versos (o en cualquier sección / tipo de nota)
// ------------------------------------------------------------------------------------------------------------------

export interface OpcionesPalmMute {
  /** Tipos de sección donde se silencia con la palma. Por defecto ['verso', 'intro']. */
  tipos?: readonly string[];
  /** Solo las notas con pitch ≤ este valor (típicamente las cuerdas graves). Por defecto 64. */
  pitchMax?: number;
  /** Solo las notas más cortas que esto (beats). Por defecto 1.01 (negra y menores). */
  duracionMax?: number;
}

function decidirPalm(notas: readonly NotaGuitarra[], secciones: readonly SeccionGuitarra[], opc: OpcionesPalmMute): Set<NotaGuitarra> {
  const tipos = opc.tipos ?? ['verso', 'intro'];
  const pMax = opc.pitchMax ?? 64;
  const dMax = opc.duracionMax ?? 1.01;
  const sec = secciones.filter((s) => (s.tipo ? tipos.includes(s.tipo) : false));
  const enSeccion = (n: NotaGuitarra) => sec.some((s) => n.inicio >= s.inicioBeat - 1e-6 && n.inicio < s.inicioBeat + s.duracionBeats - 1e-6);
  return new Set(notas.filter((n) => enSeccion(n) && n.pitch <= pMax && n.duracion <= dMax));
}

/**
 * Palm mute (keyswitch 13) en las notas graves y cortas de las secciones elegidas. Las rachas de notas que cumplen la regla se
 * rodean con 13 … 12; una nota que no cumple (larga o aguda) corta la racha para que suene abierta.
 */
export function palmMutesEnSecciones(notasIn: readonly NotaGuitarra[], secciones: readonly SeccionGuitarra[], opc: OpcionesPalmMute = {}): ResultadoTecnica {
  const notas = sinKs(notasIn);
  const mute = decidirPalm(notas, secciones, opc);
  const ks = emitirPorNota(notas, (n) => ({ articulacion: mute.has(n) ? 'palmMute' : 'normal' }));
  return { notas: ordenar([...notas, ...ks]), cc: [] };
}

// ------------------------------------------------------------------------------------------------------------------
// 4) Volume swell al entrar secciones (CC11)
// ------------------------------------------------------------------------------------------------------------------

export interface OpcionesSwell {
  /** Tipos de sección que entran con swell. Por defecto ['intro', 'puente', 'coroFinal']. */
  tipos?: readonly string[];
  /** Duración de la subida en beats. Por defecto 4. */
  duracion?: number;
  /** Forma de la curva (1 lineal, >1 lenta al inicio como un pedal real). Por defecto 1.6. */
  curva?: number;
  /** Puntos CC por beat (máx. 8). Por defecto 4. */
  puntosPorBeat?: number;
  /** Expresión de reposo al terminar el swell (0..1). Por defecto 1. */
  reposo?: number;
}

/**
 * Swells de pedal de volumen (CC11) que arrancan en 0 un instante antes de cada sección elegida y suben monótonamente hasta
 * `reposo`. Antes de la primera sección con swell emite CC11 = reposo en el beat 0 para que el inicio parta de un estado conocido.
 */
export function swellsAlEntrar(secciones: readonly SeccionGuitarra[], opc: OpcionesSwell = {}): EventoCC[] {
  const tipos = opc.tipos ?? ['intro', 'puente', 'coroFinal'];
  const dur = opc.duracion ?? 4;
  const curva = opc.curva ?? 1.6;
  const ppb = clamp(opc.puntosPorBeat ?? 4, 1, 8);
  const reposo = clamp(opc.reposo ?? 1, 0, 1);
  const out: EventoCC[] = [];
  const elegidas = secciones.filter((s) => s.tipo && tipos.includes(s.tipo));
  if (elegidas.length === 0) return out;
  out.push({ cc: CC_GUITARRA.expresion, tiempo: 0, valor: reposo });
  for (const s of elegidas) {
    const d = Math.min(dur, s.duracionBeats);
    const n = Math.max(2, Math.round(d * ppb));
    const t0 = Math.max(0, s.inicioBeat - 0.03);
    out.push({ cc: CC_GUITARRA.expresion, tiempo: r4(t0), valor: 0 });
    for (let i = 1; i <= n; i++) {
      const x = i / n;
      out.push({ cc: CC_GUITARRA.expresion, tiempo: r4(s.inicioBeat + x * d), valor: r4(reposo * Math.pow(x, curva)) });
    }
  }
  // el cero inicial de una sección y el reposo previo pueden coincidir en tiempo si la sección empieza en 0: se queda el último
  return ordenarCc(out).filter((e, i, a) => !(i + 1 < a.length && a[i + 1]!.tiempo === e.tiempo && a[i + 1]!.cc === e.cc));
}

// ------------------------------------------------------------------------------------------------------------------
// 5) Slide-in / slide-out, bends, armónicos, tremolo picking y vibrato
// ------------------------------------------------------------------------------------------------------------------

export interface OpcionesAdornos {
  semilla: number;
  /** Silencio mínimo (beats) antes de una nota para que entre con slide-in. Por defecto 1.5. */
  silencioSlideIn?: number;
  /** Probabilidad de slide-in en esas notas / slide-out en finales de frase. Por defecto 0.5. */
  probabilidad?: number;
  /** Duración mínima (beats) de una nota de final de frase para terminar con slide-out. Por defecto 1.5. */
  duracionSlideOut?: number;
}

/**
 * Slide-in (18) en notas que arrancan tras un silencio y slide-out (19 abajo, 20 arriba) en notas largas que cierran una frase
 * (seguidas de un silencio). Son keyswitches de SOLO LA SIGUIENTE NOTA: no hay que reiniciarlos.
 */
export function slidesDeEntradaYSalida(notasIn: readonly NotaGuitarra[], opc: OpcionesAdornos): ResultadoTecnica {
  const rng = crearRng(hashSemilla(opc.semilla, 'guitarra-slide-io'));
  const sil = opc.silencioSlideIn ?? 1.5;
  const prob = opc.probabilidad ?? 0.5;
  const dMin = opc.duracionSlideOut ?? 1.5;
  const notas = ordenar(notasIn.filter((n) => !esKeyswitch(n))).map((n) => ({ ...n }));
  const ks: NotaGuitarra[] = [];
  const mono = (i: number) => !notas.some((m, j) => j !== i && Math.abs(m.inicio - notas[i]!.inicio) < 0.06);
  for (let i = 0; i < notas.length; i++) {
    const n = notas[i]!;
    if (!mono(i)) continue;
    const prev = notas[i - 1];
    const sig = notas[i + 1];
    const finPrev = prev ? Math.max(...notas.filter((m) => m.inicio < n.inicio - 0.06).map((m) => m.inicio + m.duracion), 0) : 0;
    if ((!prev || n.inicio - finPrev >= sil) && rng.prob(prob)) ks.push(notaKeyswitch('slideIn', n.inicio - ANTELACION_KS));
    const fin = n.inicio + n.duracion;
    const hueco = sig ? sig.inicio - fin : Infinity;
    if (n.duracion >= dMin && hueco >= sil && rng.prob(prob)) {
      ks.push(notaKeyswitch(rng.prob(0.7) ? 'slideOutAbajo' : 'slideOutArriba', n.inicio - ANTELACION_KS - 0.005));
    }
  }
  return { notas: ordenar([...notas, ...ks]), cc: [] };
}

/**
 * Convierte las notas con `bend: -2` (empiezan 2 st por debajo y suben hasta el pitch, como las genera rol-guitarra) en la nota
 * grave + keyswitch 22 (bend-up de 2 st, parámetro Bend Amount por defecto). Otros valores de bend se dejan como están.
 */
export function bendsComoKeyswitch(notasIn: readonly NotaGuitarra[]): ResultadoTecnica {
  const out: NotaGuitarra[] = [];
  const ks: NotaGuitarra[] = [];
  for (const n of notasIn) {
    if (esKeyswitch(n)) continue;
    if (n.bend !== undefined && Math.abs(n.bend + 2) < 0.01 && n.pitch - 2 >= NOTA_MIN_GUITARRA) {
      out.push({ ...n, pitch: n.pitch - 2, bend: undefined });
      ks.push(notaKeyswitch('bendUp', n.inicio - ANTELACION_KS));
    } else out.push({ ...n });
  }
  return { notas: ordenar([...out, ...ks]), cc: [] };
}

export interface OpcionesArmonicos {
  /** Alturas que suenan como armónico natural (trastes 12/7/5 de la mi aguda y la si: 76, 83, 88). */
  pitches?: readonly number[];
  /** Duración mínima (beats). Por defecto 1. */
  duracionMin?: number;
}

function decidirArmonicos(notas: readonly NotaGuitarra[], opc: OpcionesArmonicos): Set<NotaGuitarra> {
  const alturas = opc.pitches ?? [76, 83, 88];
  const dMin = opc.duracionMin ?? 1;
  return new Set(notas.filter((n) => alturas.includes(n.pitch) && n.duracion >= dMin));
}

/** Notas largas en alturas de armónico natural → keyswitch 15 (y 12 al terminar). */
export function armonicosNaturales(notasIn: readonly NotaGuitarra[], opc: OpcionesArmonicos = {}): ResultadoTecnica {
  const notas = sinKs(notasIn);
  const arm = decidirArmonicos(notas, opc);
  const ks = emitirPorNota(notas, (n) => ({ articulacion: arm.has(n) ? 'armonicoNatural' : 'normal' }));
  return { notas: ordenar([...notas, ...ks]), cc: [] };
}

export interface OpcionesTremolo {
  /** Notas más largas que esto (beats) se tocan con tremolo picking. Por defecto 3. */
  duracionMin?: number;
  /** Solo en secciones de estos tipos (omitido = todas). */
  tipos?: readonly string[];
}

function decidirTremolo(notas: readonly NotaGuitarra[], secciones: readonly SeccionGuitarra[], opc: OpcionesTremolo): Set<NotaGuitarra> {
  const dMin = opc.duracionMin ?? 3;
  const enTipo = (n: NotaGuitarra) =>
    !opc.tipos || secciones.some((s) => s.tipo && opc.tipos!.includes(s.tipo) && n.inicio >= s.inicioBeat && n.inicio < s.inicioBeat + s.duracionBeats);
  return new Set(notas.filter((n) => n.duracion >= dMin && enTipo(n)));
}

/** Notas largas en secciones intensas → tremolo picking (keyswitch 17 … 12). */
export function tremoloEnNotasLargas(notasIn: readonly NotaGuitarra[], secciones: readonly SeccionGuitarra[] = [], opc: OpcionesTremolo = {}): ResultadoTecnica {
  const notas = sinKs(notasIn);
  const trem = decidirTremolo(notas, secciones, opc);
  const ks = emitirPorNota(notas, (n) => ({ articulacion: trem.has(n) ? 'tremolo' : 'normal' }));
  return { notas: ordenar([...notas, ...ks]), cc: [] };
}

/** Vibrato (CC1) en las notas largas: sube al empezar la nota (el plugin lo retarda) y vuelve a 0 al terminar. */
export function vibratoEnNotasLargas(notasIn: readonly NotaGuitarra[], duracionMin = 1.5, profundidad = 0.6): EventoCC[] {
  const out: EventoCC[] = [];
  for (const n of ordenar(notasIn.filter((m) => !esKeyswitch(m)))) {
    if (n.duracion < duracionMin) continue;
    out.push({ cc: CC_GUITARRA.vibrato, tiempo: r4(n.inicio), valor: r4(clamp(profundidad, 0, 1)) });
    out.push({ cc: CC_GUITARRA.vibrato, tiempo: r4(n.inicio + n.duracion), valor: 0 });
  }
  return ordenarCc(out);
}

// ------------------------------------------------------------------------------------------------------------------
// 6) Combinación de todas las técnicas
// ------------------------------------------------------------------------------------------------------------------

export interface PlanTecnicas {
  semilla: number;
  secciones: readonly SeccionGuitarra[];
  /** Cada bloque se activa con `true` o con sus opciones (`false` lo apaga). Por defecto activos: slides, rasgueos, palm mute, swell, slide-in/out y vibrato. */
  slides?: boolean | Omit<OpcionesSlides, 'semilla'>;
  rasgueos?: boolean | OpcionesRasgueo;
  palmMute?: boolean | OpcionesPalmMute;
  swell?: boolean | OpcionesSwell;
  slideInOut?: boolean | Omit<OpcionesAdornos, 'semilla'>;
  /** Por defecto false. */
  bends?: boolean;
  armonicos?: boolean | OpcionesArmonicos;
  tremolo?: boolean | OpcionesTremolo;
  vibrato?: boolean;
}

/**
 * Aplica todas las técnicas pedidas sobre las notas de guitarra y devuelve las notas (guitarra + keyswitches) y los CC.
 * Los bloques que dejan estado FIJO en el plugin (palm mute, armónicos, tremolo, modo legato/slide, dirección de rasgueo) deciden
 * por nota y un único `Conmutador` emite los keyswitches resultantes, de modo que no se pisan entre sí. Prioridad de articulación
 * cuando varias coinciden en una nota: armónico > tremolo > palm mute.
 */
export function aplicarTecnicasGuitarra(notasIn: readonly NotaGuitarra[], plan: PlanTecnicas): ResultadoTecnica {
  const cfg = <T extends object>(v: boolean | T | undefined, porDefecto: boolean): T | null => (v === undefined ? (porDefecto ? ({} as T) : null) : v === true ? ({} as T) : v === false ? null : v);
  let notas = sinKs(notasIn);
  const unicos: NotaGuitarra[] = [];     // keyswitches de SOLO LA SIGUIENTE NOTA (no tienen estado)
  const cc: EventoCC[] = [];

  if (plan.bends) {
    const r = bendsComoKeyswitch(notas);
    notas = sinKs(r.notas);
    unicos.push(...r.notas.filter(esKeyswitch));
  }
  const slidesCfg = cfg<Omit<OpcionesSlides, 'semilla'>>(plan.slides, true);
  const modo = slidesCfg ? decidirSlides(notas, { semilla: plan.semilla, ...slidesCfg }).modo : null;
  const rasgCfg = cfg<OpcionesRasgueo>(plan.rasgueos, true);
  const dir = rasgCfg ? decidirDirecciones(notas, rasgCfg) : null;
  const palmCfg = cfg<OpcionesPalmMute>(plan.palmMute, true);
  const palm = palmCfg ? decidirPalm(notas, plan.secciones, palmCfg) : null;
  const armCfg = cfg<OpcionesArmonicos>(plan.armonicos, false);
  const arm = armCfg ? decidirArmonicos(notas, armCfg) : null;
  const tremCfg = cfg<OpcionesTremolo>(plan.tremolo, false);
  const trem = tremCfg ? decidirTremolo(notas, plan.secciones, tremCfg) : null;
  // los slide-in/out se deciden sobre las notas YA alargadas por los slides
  const ioCfg = cfg<Omit<OpcionesAdornos, 'semilla'>>(plan.slideInOut, true);
  if (ioCfg) unicos.push(...slidesDeEntradaYSalida(notas, { semilla: plan.semilla, ...ioCfg }).notas.filter(esKeyswitch));

  const fijos = emitirPorNota(notas, (n) => {
    const d: Intencion = {};
    if (modo) d.legato = modo.get(n) ?? 'off';
    if (dir?.has(n)) d.direccion = dir.get(n)!;
    if (arm || trem || palm) d.articulacion = arm?.has(n) ? 'armonicoNatural' : trem?.has(n) ? 'tremolo' : palm?.has(n) ? 'palmMute' : 'normal';
    return d;
  });

  const swellCfg = cfg<OpcionesSwell>(plan.swell, true);
  if (swellCfg) cc.push(...swellsAlEntrar(plan.secciones, swellCfg));
  if (cfg<object>(plan.vibrato, true)) cc.push(...vibratoEnNotasLargas(notas));
  return { notas: ordenar([...notas, ...fijos, ...unicos]), cc: ordenarCc(cc) };
}
