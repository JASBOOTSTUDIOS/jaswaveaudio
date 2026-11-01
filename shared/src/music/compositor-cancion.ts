/**
 * Compositor letra → canción (K4): lógica pura y determinista que usa la habilidad «compositor de canciones».
 *
 *  1. Entrevista: ficha de la canción y siguiente pregunta (género, voz del banco, modo IA/voz cantada, tono, tempo, letra).
 *  2. Voz → melodía con sliders 0–100 % (afinación a la escala, cuantización, legato, limpieza) sobre las notas que
 *     devuelve `extraerMelodiaMidiDeAudio` / `analysis.voiceToMelody`.
 *  3. Alineación de la letra (sílabas) sobre las notas, con melismas y subdivisión de notas largas.
 *  4. Armonización por LLM: prompt, lectura estricta de la respuesta (JSON) y respaldo diatónico por voz.
 *  5. Plan de volcado multipista (lead con letra, coros → Vocal Choir, acompañamiento y pista de referencia silenciada).
 * No toca el proyecto: devuelve datos; las mutaciones las hace el agente con los comandos habituales.
 */
import type { NotaMelodiaMidi } from '../audio/pitch-tracking';
import { silabasDeLinea } from './letra';

// ------------------------------------------------------------------------------------------------
// Tonalidad
// ------------------------------------------------------------------------------------------------
export type EscalaCancion = 'mayor' | 'menor' | 'dórica' | 'pentatónica';
const GRADOS: Record<EscalaCancion, readonly number[]> = {
  mayor: [0, 2, 4, 5, 7, 9, 11],
  menor: [0, 2, 3, 5, 7, 8, 10],
  dórica: [0, 2, 3, 5, 7, 9, 10],
  pentatónica: [0, 2, 4, 7, 9],
};
const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const EQUIV: Record<string, string> = { DB: 'C#', EB: 'D#', GB: 'F#', AB: 'G#', BB: 'A#' };

export function indiceTonica(raiz: string): number {
  const r = raiz.trim().toUpperCase();
  const i = (NOMBRES as readonly string[]).indexOf(EQUIV[r] ?? r);
  return i < 0 ? 0 : i;
}
const enEscala = (pitch: number, tonica: number, escala: EscalaCancion): boolean => GRADOS[escala].includes((((pitch - tonica) % 12) + 12) % 12);

/** Nota de la escala más cercana (empate: la inferior). */
export function ajustarAEscala(pitch: number, tonica: number, escala: EscalaCancion): number {
  if (enEscala(pitch, tonica, escala)) return pitch;
  for (let d = 1; d <= 6; d++) {
    if (enEscala(pitch - d, tonica, escala)) return pitch - d;
    if (enEscala(pitch + d, tonica, escala)) return pitch + d;
  }
  return pitch;
}

/** Sube/baja `pasos` grados diatónicos desde una nota (que se ajusta antes a la escala). */
export function moverGrados(pitch: number, pasos: number, tonica: number, escala: EscalaCancion): number {
  let p = ajustarAEscala(pitch, tonica, escala);
  const dir = pasos < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(pasos); i++) {
    p += dir;
    while (!enEscala(p, tonica, escala)) p += dir;
  }
  return Math.max(0, Math.min(127, p));
}

// ------------------------------------------------------------------------------------------------
// Entrevista
// ------------------------------------------------------------------------------------------------
export interface FichaCancion {
  titulo?: string;
  genero?: string;
  /** id de la voz del banco `.jwvoice` (o «ninguna»). */
  vozBancoId?: string;
  /** `ia`: la IA compone la melodía; `cantada`: el usuario canta/tararea y se extrae la melodía. */
  modo?: 'ia' | 'cantada';
  tonica?: string;
  escala?: EscalaCancion;
  bpm?: number;
  letra?: string;
  conCoros?: boolean;
}

export type CampoFicha = 'genero' | 'vozBancoId' | 'modo' | 'tonica' | 'escala' | 'bpm' | 'letra' | 'conCoros';

const PREGUNTAS: ReadonlyArray<{ campo: CampoFicha; pregunta: string }> = [
  { campo: 'genero', pregunta: '¿Qué género quieres (worship, balada, R&B, pop…)?' },
  { campo: 'vozBancoId', pregunta: '¿Qué voz de tu banco canta la melodía principal? Responde con el nombre o «ninguna».' },
  { campo: 'modo', pregunta: '¿Compongo yo la melodía, o prefieres cantarla/tararearla tú? (ia / cantada)' },
  { campo: 'tonica', pregunta: '¿En qué tono (C, D, F#, Bb…)?' },
  { campo: 'escala', pregunta: '¿Mayor, menor, dórica o pentatónica?' },
  { campo: 'bpm', pregunta: '¿A qué tempo (BPM)?' },
  { campo: 'letra', pregunta: 'Pégame la letra (una frase por línea).' },
  { campo: 'conCoros', pregunta: '¿Añado coros armónicos en el estribillo? (sí/no)' },
];

export function siguientePreguntaEntrevista(f: FichaCancion): { campo: CampoFicha; pregunta: string } | null {
  for (const p of PREGUNTAS) if (f[p.campo] === undefined || f[p.campo] === '') return p;
  return null;
}

/** Aplica una respuesta de texto libre a un campo; devuelve la ficha nueva o un error legible. */
export function aplicarRespuestaEntrevista(f: FichaCancion, campo: CampoFicha, respuesta: string): { ok: true; ficha: FichaCancion } | { ok: false; error: string } {
  const r = respuesta.trim();
  if (!r) return { ok: false, error: 'La respuesta está vacía.' };
  switch (campo) {
    case 'modo': {
      const m = /cant|tarare|mi voz|yo/i.test(r) ? 'cantada' : /ia|tú|tu |compon|aut/i.test(r) ? 'ia' : null;
      return m ? { ok: true, ficha: { ...f, modo: m } } : { ok: false, error: 'Responde «ia» o «cantada».' };
    }
    case 'tonica': {
      const t = /^([A-Ga-g])([#b♯♭]?)/.exec(r);
      if (!t) return { ok: false, error: 'No reconozco el tono (ejemplos: C, F#, Bb).' };
      const letra = t[1]!.toUpperCase();
      const alt = t[2] === '♯' ? '#' : t[2] === '♭' ? 'b' : (t[2] ?? '');
      const nombre = NOMBRES[indiceTonica(letra + alt.toUpperCase())]!;
      return { ok: true, ficha: { ...f, tonica: nombre } };
    }
    case 'escala': {
      const e: EscalaCancion | null = /dóric|doric/i.test(r) ? 'dórica' : /pentat/i.test(r) ? 'pentatónica' : /menor/i.test(r) ? 'menor' : /mayor/i.test(r) ? 'mayor' : null;
      return e ? { ok: true, ficha: { ...f, escala: e } } : { ok: false, error: 'Elige mayor, menor, dórica o pentatónica.' };
    }
    case 'bpm': {
      const n = Number(/\d+(?:[.,]\d+)?/.exec(r)?.[0]?.replace(',', '.'));
      return Number.isFinite(n) && n >= 40 && n <= 220 ? { ok: true, ficha: { ...f, bpm: Math.round(n) } } : { ok: false, error: 'El tempo debe estar entre 40 y 220 BPM.' };
    }
    case 'conCoros':
      return { ok: true, ficha: { ...f, conCoros: /^(s[ií]|claro|ok|vale|yes|con)/i.test(r) } };
    case 'letra':
      return { ok: true, ficha: { ...f, letra: r } };
    default:
      return { ok: true, ficha: { ...f, [campo]: r } };
  }
}

// ------------------------------------------------------------------------------------------------
// Voz → melodía con sliders 0–100 %
// ------------------------------------------------------------------------------------------------
export interface SlidersMelodia {
  /** % de notas fuera de escala que se corrigen (empezando por las de menor confianza). */
  afinacion: number;
  /** % de acercamiento del inicio y la duración a la rejilla (1/8 por defecto). */
  cuantizacion: number;
  /** % en que cada nota se alarga hacia la siguiente (legato). */
  legato: number;
  /** % de limpieza: elimina notas muy cortas y de poca confianza. */
  limpieza: number;
}
export const SLIDERS_POR_DEFECTO: SlidersMelodia = { afinacion: 70, cuantizacion: 50, legato: 30, limpieza: 40 };

const p01 = (v: number): number => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)) / 100;

export function ajustarMelodiaVoz(
  notas: readonly NotaMelodiaMidi[],
  sliders: SlidersMelodia,
  ctx: { bpm: number; tonica: string; escala: EscalaCancion; rejillaBeats?: number },
): NotaMelodiaMidi[] {
  const spb = 60 / Math.max(1, ctx.bpm);
  const rejilla = ctx.rejillaBeats ?? 0.5;
  const tonica = indiceTonica(ctx.tonica);
  let out = [...notas].sort((a, b) => a.beat - b.beat).map((n) => ({ ...n }));

  // limpieza: fuera notas cortas de poca confianza (umbral crece con el slider hasta 0,3 beats)
  const lim = p01(sliders.limpieza);
  if (lim > 0) out = out.filter((n) => !(n.duracionBeats < lim * 0.3 && n.confianza < 0.5 + 0.4 * lim));

  // afinación: se corrige la fracción pedida de las notas fuera de escala, las menos seguras primero
  const af = p01(sliders.afinacion);
  const fuera = out.filter((n) => !enEscala(n.pitch, tonica, ctx.escala)).sort((a, b) => a.confianza - b.confianza);
  const nCorregir = Math.round(fuera.length * af);
  for (let i = 0; i < nCorregir; i++) fuera[i]!.pitch = ajustarAEscala(fuera[i]!.pitch, tonica, ctx.escala);

  // cuantización
  const cu = p01(sliders.cuantizacion);
  if (cu > 0) {
    for (const n of out) {
      const ini = Math.round(n.beat / rejilla) * rejilla;
      const dur = Math.max(rejilla, Math.round(n.duracionBeats / rejilla) * rejilla);
      n.beat = n.beat + (ini - n.beat) * cu;
      n.duracionBeats = n.duracionBeats + (dur - n.duracionBeats) * cu;
    }
  }

  // legato: alarga hacia el inicio de la siguiente (sin solapar)
  const lg = p01(sliders.legato);
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    const siguiente = out[i + 1];
    if (siguiente && lg > 0) {
      const hueco = siguiente.beat - (n.beat + n.duracionBeats);
      if (hueco > 0) n.duracionBeats += hueco * lg;
    }
    if (siguiente && n.beat + n.duracionBeats > siguiente.beat) n.duracionBeats = Math.max(0.05, siguiente.beat - n.beat);
  }
  for (const n of out) {
    n.beat = Math.round(n.beat * 10000) / 10000;
    n.duracionBeats = Math.round(n.duracionBeats * 10000) / 10000;
    n.tiempoSeg = n.beat * spb;
    n.duracionSeg = n.duracionBeats * spb;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Letra sobre notas
// ------------------------------------------------------------------------------------------------
export interface NotaConSilaba {
  nota: NotaMelodiaMidi;
  /** Sílaba cantada en esta nota; null en un melisma (la sílaba anterior se alarga). */
  silaba: string | null;
  melisma: boolean;
  /** true si la sílaba acaba una palabra (para separar con espacio). */
  finPalabra: boolean;
}

export function silabasDeLetra(letra: string): Array<{ texto: string; finPalabra: boolean; finLinea: boolean }> {
  const out: Array<{ texto: string; finPalabra: boolean; finLinea: boolean }> = [];
  for (const linea of letra.split(/\r?\n/)) {
    const s = silabasDeLinea(linea.trim());
    s.forEach((x, i) => out.push({ texto: x.texto, finPalabra: x.finPalabra, finLinea: i === s.length - 1 }));
  }
  return out;
}

/**
 * Reparte las sílabas sobre las notas: con más notas que sílabas se hacen melismas repartidos; con más sílabas que
 * notas se parten las notas más largas (la subdivisión conserva el inicio, el tono y la suma de duraciones).
 */
export function alinearLetraANotas(letra: string, notas: readonly NotaMelodiaMidi[]): NotaConSilaba[] {
  const sil = silabasDeLetra(letra);
  let ns = [...notas].sort((a, b) => a.beat - b.beat).map((n) => ({ ...n }));
  if (!sil.length || !ns.length) return ns.map((nota) => ({ nota, silaba: null, melisma: false, finPalabra: false }));
  let guarda = 0;
  while (ns.length < sil.length && guarda++ < 5000) {
    let k = 0;
    for (let i = 1; i < ns.length; i++) if (ns[i]!.duracionBeats > ns[k]!.duracionBeats) k = i;
    const n = ns[k]!;
    const mitad = n.duracionBeats / 2;
    const segunda = { ...n, id: `${n.id}b`, beat: n.beat + mitad, tiempoSeg: n.tiempoSeg + n.duracionSeg / 2, duracionBeats: mitad, duracionSeg: n.duracionSeg / 2 };
    n.duracionBeats = mitad;
    n.duracionSeg = n.duracionSeg / 2;
    ns.splice(k + 1, 0, segunda);
  }
  ns = ns.sort((a, b) => a.beat - b.beat);
  const out: NotaConSilaba[] = ns.map((nota) => ({ nota, silaba: null, melisma: true, finPalabra: false }));
  sil.forEach((s, i) => {
    const idx = Math.min(ns.length - 1, Math.floor((i * ns.length) / sil.length));
    out[idx] = { nota: ns[idx]!, silaba: s.texto, melisma: false, finPalabra: s.finPalabra };
  });
  // la primera nota nunca es melisma
  if (out[0]!.silaba === null) out[0] = { ...out[0]!, melisma: false };
  return out;
}

// ------------------------------------------------------------------------------------------------
// Armonización (LLM con respaldo diatónico)
// ------------------------------------------------------------------------------------------------
export interface VozArmonica {
  nombre: string;
  /** Un tono MIDI por nota de la melodía, en el mismo orden. */
  pitches: number[];
  origen: 'llm' | 'diatonico';
}

const INTERVALOS_RESPALDO: ReadonlyArray<{ nombre: string; grados: number }> = [
  { nombre: '2ª voz (3ª abajo)', grados: -2 },
  { nombre: '3ª voz (3ª arriba)', grados: 2 },
  { nombre: 'Base (5ª abajo)', grados: -4 },
];

export function armonizarDiatonico(melodia: readonly number[], tonica: string, escala: EscalaCancion, voces: number): VozArmonica[] {
  const t = indiceTonica(tonica);
  return INTERVALOS_RESPALDO.slice(0, Math.max(0, Math.min(3, voces))).map((v) => ({
    nombre: v.nombre,
    pitches: melodia.map((p) => moverGrados(p, v.grados, t, escala)),
    origen: 'diatonico' as const,
  }));
}

export function construirPromptArmonizacion(o: { melodia: readonly number[]; tonica: string; escala: EscalaCancion; genero?: string; voces: number; acordes?: string[] }): string {
  return [
    'Eres arreglista vocal. Armoniza esta melodía con voces de coro.',
    `Tonalidad: ${o.tonica} ${o.escala}. Género: ${o.genero ?? 'worship'}.`,
    o.acordes?.length ? `Acordes por compás: ${o.acordes.join(' | ')}.` : '',
    `Melodía (tonos MIDI, ${o.melodia.length} notas): ${JSON.stringify(o.melodia)}.`,
    `Escribe ${o.voces} voces. Cada voz tiene EXACTAMENTE ${o.melodia.length} tonos MIDI (enteros 0–127), a no más de 12 semitonos de la melodía, dentro de la tonalidad y con movimiento mayormente por grados conjuntos.`,
    'Responde SOLO con JSON: {"voces":[{"nombre":"2ª voz","pitches":[...]}]}.',
  ].filter(Boolean).join('\n');
}

/** Lee la respuesta del LLM; descarta cada voz inválida con un motivo (nunca lanza). */
export function leerArmonizacionLLM(texto: string, melodia: readonly number[]): { voces: VozArmonica[]; descartes: string[] } {
  const descartes: string[] = [];
  const m = /\{[\s\S]*\}/.exec(texto);
  let json: unknown;
  try { json = m ? JSON.parse(m[0]) : null; } catch { json = null; }
  const lista = (json as { voces?: unknown } | null)?.voces;
  if (!Array.isArray(lista)) return { voces: [], descartes: ['La respuesta no contiene {"voces":[…]}.'] };
  const voces: VozArmonica[] = [];
  lista.slice(0, 4).forEach((v, i) => {
    const o = v as { nombre?: unknown; pitches?: unknown } | null;
    const nombre = typeof o?.nombre === 'string' && o.nombre.trim() ? o.nombre.trim().slice(0, 40) : `Voz ${i + 2}`;
    const p = o?.pitches;
    if (!Array.isArray(p) || p.length !== melodia.length) return void descartes.push(`${nombre}: debe tener ${melodia.length} tonos (tiene ${Array.isArray(p) ? p.length : 'ninguno'}).`);
    if (!p.every((x) => Number.isInteger(x) && x >= 0 && x <= 127)) return void descartes.push(`${nombre}: hay tonos que no son enteros MIDI 0–127.`);
    const lejos = p.findIndex((x, k) => Math.abs((x as number) - melodia[k]!) > 12);
    if (lejos >= 0) return void descartes.push(`${nombre}: la nota ${lejos + 1} queda a más de una octava de la melodía.`);
    voces.push({ nombre, pitches: p as number[], origen: 'llm' });
  });
  return { voces, descartes };
}

/** LLM si su respuesta es válida; completa con respaldo diatónico hasta `voces`. */
export function armonizar(o: { melodia: readonly number[]; tonica: string; escala: EscalaCancion; voces: number; respuestaLLM?: string }): { voces: VozArmonica[]; descartes: string[] } {
  const leida = o.respuestaLLM ? leerArmonizacionLLM(o.respuestaLLM, o.melodia) : { voces: [] as VozArmonica[], descartes: [] as string[] };
  const voces = leida.voces.slice(0, o.voces);
  if (voces.length < o.voces) {
    const respaldo = armonizarDiatonico(o.melodia, o.tonica, o.escala, o.voces - voces.length);
    voces.push(...respaldo);
  }
  return { voces, descartes: leida.descartes };
}

// ------------------------------------------------------------------------------------------------
// Plan de volcado multipista
// ------------------------------------------------------------------------------------------------
export interface PlanPista {
  nombre: string;
  tipo: 'midi' | 'audio';
  silenciada: boolean;
  /** Plugin sugerido (id del manifiesto). */
  plugin?: string;
  /** Pitches (MIDI) o notas con sílaba, según la pista. */
  notas?: Array<{ pitch: number; beat: number; duracionBeats: number; silaba?: string | null }>;
  nota?: string;
}

export const NOMBRE_PISTA_REFERENCIA = '[Audio Ref - Canto Original]';

export function planVolcadoMultipista(o: { ficha: FichaCancion; lead: readonly NotaConSilaba[]; coros: readonly VozArmonica[]; audioReferencia?: boolean }): PlanPista[] {
  const plan: PlanPista[] = [];
  plan.push({
    nombre: 'Voz Lead',
    tipo: 'midi',
    silenciada: false,
    plugin: 'com.jaswave.plugin.vocal-choir',
    notas: o.lead.map((x) => ({ pitch: x.nota.pitch, beat: x.nota.beat, duracionBeats: x.nota.duracionBeats, silaba: x.silaba })),
    nota: o.ficha.vozBancoId ? `Voz del banco: ${o.ficha.vozBancoId}` : undefined,
  });
  if (o.ficha.conCoros !== false) {
    for (const v of o.coros) {
      plan.push({
        nombre: `Coro · ${v.nombre}`,
        tipo: 'midi',
        silenciada: false,
        plugin: 'com.jaswave.plugin.vocal-choir',
        notas: o.lead.map((x, i) => ({ pitch: v.pitches[i] ?? x.nota.pitch, beat: x.nota.beat, duracionBeats: x.nota.duracionBeats })),
      });
    }
  }
  if (o.audioReferencia) plan.push({ nombre: NOMBRE_PISTA_REFERENCIA, tipo: 'audio', silenciada: true, nota: 'Canto original del usuario, silenciado para contrastar.' });
  return plan;
}
