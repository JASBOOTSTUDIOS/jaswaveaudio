/**
 * Armonía diatónica para worship: construcción de acordes por grados de la escala
 * (todo acorde sale de la escala, así que sus/add9/maj7 y bajos invertidos son siempre diatónicos),
 * parseo de progresiones (grados romanos y símbolos), voice-leading de movimiento mínimo
 * y biblioteca de progresiones y turnarounds.
 */

import type { EscalaWorship, RaizWorship, TipoSeccionWorship } from './tipos';
import { intentarParsearAcorde } from '../acordes';

export const RAIZ_PC: Record<RaizWorship, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

const ESCALAS: Record<EscalaWorship, number[]> = {
  mayor: [0, 2, 4, 5, 7, 9, 11],
  menor: [0, 2, 3, 5, 7, 8, 10],
};

const NOMBRES_SOSTENIDOS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOMBRES_BEMOLES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface Tonal {
  raiz: RaizWorship;
  escalaNombre: EscalaWorship;
  raizPc: number;
  /** Semitonos de cada grado sobre la tónica. */
  escala: number[];
  /** Pitch classes absolutas de la escala. */
  pcsEscala: Set<number>;
  bemoles: boolean;
}

export function crearTonal(raiz: RaizWorship, escalaNombre: EscalaWorship): Tonal {
  const raizPc = RAIZ_PC[raiz];
  if (raizPc === undefined) throw new Error(`Tonalidad no soportada: ${String(raiz)}`);
  const escala = ESCALAS[escalaNombre];
  if (!escala) throw new Error(`Escala no soportada: ${String(escalaNombre)}`);
  const mayoresBemol = new Set([5, 10, 3, 8, 1]);
  const menoresBemol = new Set([0, 5, 10, 3, 8, 7, 2]);
  const bemoles = escalaNombre === 'mayor' ? mayoresBemol.has(raizPc) : menoresBemol.has(raizPc);
  return {
    raiz,
    escalaNombre,
    raizPc,
    escala,
    pcsEscala: new Set(escala.map((s) => (s + raizPc) % 12)),
    bemoles,
  };
}

export function nombrePc(tonal: Tonal, pc: number): string {
  const p = ((pc % 12) + 12) % 12;
  return (tonal.bemoles ? NOMBRES_BEMOLES : NOMBRES_SOSTENIDOS)[p]!;
}

function pcDeNombre(nombre: string): number {
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[nombre[0]!.toUpperCase() as 'C'];
  if (base === undefined) return -1;
  let pc = base;
  if (nombre[1] === '#') pc += 1;
  if (nombre[1] === 'b') pc -= 1;
  return (pc + 12) % 12;
}

/** Semitonos (sobre la tónica, sin módulo) del grado `d` (admite d>=7 y negativos). */
function semiGrado(tonal: Tonal, d: number): number {
  const o = Math.floor(d / 7);
  return tonal.escala[((d % 7) + 7) % 7]! + 12 * o;
}

/**
 * Extensiones: tríada, sus, add9, séptima y color jazz-pop (todas diatónicas):
 * `nov` = 7+9 (maj9, m9, 9), `once` = 7+9+11 (m11; en acordes mayores sin tercera → 11, o maj7#11 si la 11 es aumentada),
 * `trece` = 13sus4 (7, 9 y 13 sobre la cuarta suspendida).
 */
export type ExtAcorde = 'tri' | 'sus2' | 'sus4' | 'add9' | 'sept' | 'nov' | 'once' | 'trece';
export type FuncionTono = 'r' | '2' | '3' | '4' | '5' | '7' | '9' | '11' | '13';

export interface EspecAcorde {
  /** Grado 0..6 */
  grado: number;
  ext: ExtAcorde;
  /** Grado (0..6) de la escala que va en el bajo; por defecto la fundamental. */
  bajo?: number;
}

export interface TonoAcorde {
  pc: number;
  /** Semitonos sobre la fundamental (ascendente). */
  semi: number;
  fn: FuncionTono;
}

export interface Acorde {
  spec: EspecAcorde;
  simbolo: string;
  romano: string;
  raizPc: number;
  bajoPc: number;
  tonos: TonoAcorde[];
  /** Pitch classes del acorde (sin contar un bajo ajeno). */
  pcs: number[];
  esMenor: boolean;
}

const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const OFFSETS_EXT: Record<ExtAcorde, Array<[number, FuncionTono]>> = {
  tri: [[0, 'r'], [2, '3'], [4, '5']],
  sus2: [[0, 'r'], [1, '2'], [4, '5']],
  sus4: [[0, 'r'], [3, '4'], [4, '5']],
  add9: [[0, 'r'], [2, '3'], [4, '5'], [8, '9']],
  sept: [[0, 'r'], [2, '3'], [4, '5'], [6, '7']],
  nov: [[0, 'r'], [2, '3'], [4, '5'], [6, '7'], [8, '9']],
  once: [[0, 'r'], [2, '3'], [4, '5'], [6, '7'], [8, '9'], [10, '11']],
  trece: [[0, 'r'], [3, '4'], [4, '5'], [6, '7'], [8, '9'], [12, '13']],
};

/** Sufijo de séptima según la calidad: maj (7M), dominante o menor. */
function sufijoSeptima(septima: number | undefined, esMenor: boolean, base: string): string {
  if (septima === 11) return esMenor ? `mMaj${base}` : `maj${base}`;
  return esMenor ? `m${base}` : base;
}

export function construirAcorde(tonal: Tonal, spec: EspecAcorde): Acorde {
  const g = spec.grado;
  if (!Number.isInteger(g) || g < 0 || g > 6) throw new Error(`Grado inválido: ${g}`);
  const base = semiGrado(tonal, g);
  let tonos: TonoAcorde[] = OFFSETS_EXT[spec.ext].map(([k, fn]) => {
    const semi = semiGrado(tonal, g + k) - base;
    return { pc: (tonal.raizPc + base + semi) % 12, semi, fn };
  });
  // 11 justa sobre tercera mayor = choque de novena menor: se omite la tercera (sonido «11» / sus).
  const once = tonos.find((t) => t.fn === '11');
  const terceraMayor = tonos.find((t) => t.fn === '3')?.semi === 4;
  if (once && terceraMayor && once.semi % 12 === 5) tonos = tonos.filter((t) => t.fn !== '3');
  const raizPc = (tonal.raizPc + base) % 12;
  const bajoPc = spec.bajo === undefined ? raizPc : (tonal.raizPc + tonal.escala[spec.bajo]!) % 12;

  const tercera = OFFSETS_EXT[spec.ext].some(([, fn]) => fn === '3')
    ? semiGrado(tonal, g + 2) - base
    : undefined;
  const quinta = tonos.find((t) => t.fn === '5')!.semi;
  const septima = tonos.find((t) => t.fn === '7')?.semi;
  const esMenor = tercera === 3;
  let sufijo = '';
  switch (spec.ext) {
    case 'sus2': sufijo = 'sus2'; break;
    case 'sus4': sufijo = 'sus4'; break;
    case 'add9': sufijo = esMenor ? 'madd9' : 'add9'; break;
    case 'sept':
      if (septima === 11) sufijo = esMenor ? 'mMaj7' : 'maj7';
      else if (esMenor && quinta === 6) sufijo = 'm7b5';
      else sufijo = esMenor ? 'm7' : '7';
      break;
    case 'nov':
      sufijo = esMenor && quinta === 6 ? 'm9b5' : sufijoSeptima(septima, esMenor, '9');
      break;
    case 'once': {
      const aumentada = once !== undefined && once.semi % 12 === 6;
      if (esMenor) sufijo = quinta === 6 ? 'm11b5' : sufijoSeptima(septima, true, '11');
      else if (aumentada) sufijo = septima === 11 ? 'maj7#11' : '9#11';
      else sufijo = septima === 11 ? 'maj11' : '11';
      break;
    }
    case 'trece':
      sufijo = septima === 11 ? 'maj13sus4' : '13sus4';
      break;
    default:
      sufijo = quinta === 6 ? (esMenor ? 'dim' : 'b5') : esMenor ? 'm' : '';
  }
  const nombreRaiz = nombrePc(tonal, raizPc);
  const simbolo = `${nombreRaiz}${sufijo}${bajoPc !== raizPc ? `/${nombrePc(tonal, bajoPc)}` : ''}`;

  let romano = esMenor || quinta === 6 ? ROMANOS[g]!.toLowerCase() : ROMANOS[g]!;
  if (quinta === 6 && esMenor && spec.ext === 'tri') romano += '°';
  if (spec.ext === 'sus2') romano += 'sus2';
  if (spec.ext === 'sus4') romano += 'sus4';
  if (spec.ext === 'add9') romano += 'add9';
  if (spec.ext === 'sept') romano += septima === 11 ? 'maj7' : '7';
  if (spec.ext === 'nov') romano += septima === 11 ? 'maj9' : '9';
  if (spec.ext === 'once') romano += '11';
  if (spec.ext === 'trece') romano += '13sus4';
  if (spec.bajo !== undefined && bajoPc !== raizPc) romano += `/${ROMANOS[spec.bajo]}`;

  return { spec, simbolo, romano, raizPc, bajoPc, tonos, pcs: tonos.map((t) => t.pc), esMenor };
}

function gradoDePc(tonal: Tonal, pc: number): number {
  return tonal.escala.findIndex((s) => (tonal.raizPc + s) % 12 === pc);
}

function parsearBajo(txt: string, g: number, tonal: Tonal, token: string): number {
  if (/^[1357]$/.test(txt)) return (g + ({ '1': 0, '3': 2, '5': 4, '7': 6 } as Record<string, number>)[txt]!) % 7;
  if (/^[IiVv]+$/.test(txt)) {
    const i = ROMANOS.indexOf(txt.toUpperCase());
    if (i >= 0) return i;
  }
  if (/^[A-G](#|b)?$/.test(txt)) {
    const i = gradoDePc(tonal, pcDeNombre(txt));
    if (i >= 0) return i;
    throw new Error(`Bajo no diatónico en «${token}»`);
  }
  throw new Error(`Bajo no reconocido en «${token}»`);
}

/**
 * Convierte un token de progresión (grado romano o símbolo) en una especificación de acorde.
 * Lanza Error si el acorde no es diatónico en la tonalidad.
 */
export function parsearAcorde(token: string, tonal: Tonal): EspecAcorde {
  const t = token.trim();
  const extDe = (s: string | undefined): ExtAcorde => {
    if (!s) return 'tri';
    if (s === '7' || s === 'maj7') return 'sept';
    if (s === '9' || s === 'maj9') return 'nov';
    if (s === '11' || s === 'maj11' || s === '#11' || s === '9#11' || s === 'maj7#11') return 'once';
    if (s === '13sus' || s === '13sus4' || s === 'maj13sus4') return 'trece';
    return s as ExtAcorde;
  };
  const rom = /^([IiVv]+)(°|dim)?(sus2|sus4|add9|maj7#11|maj7|maj9|maj11|maj13sus4|9#11|#11|13sus4|13sus|7|9|11)?(?:\/(.+))?$/.exec(t);
  if (rom) {
    const g = ROMANOS.indexOf(rom[1]!.toUpperCase());
    if (g < 0) throw new Error(`Grado romano inválido: «${token}»`);
    const spec: EspecAcorde = { grado: g, ext: extDe(rom[3]) };
    if (rom[4]) spec.bajo = parsearBajo(rom[4], g, tonal, token);
    return spec;
  }
  const sim = /^([A-G](?:#|b)?)(m|dim)?(sus2|sus4|add9|maj7#11|maj7|maj9|maj11|maj13sus4|9#11|13sus4|13sus|7|9|11)?(?:\/([A-G](?:#|b)?))?$/.exec(t);
  if (!sim) throw new Error(`Acorde no reconocido: «${token}»`);
  const g = gradoDePc(tonal, pcDeNombre(sim[1]!));
  if (g < 0) throw new Error(`Acorde no diatónico en ${tonal.raiz} ${tonal.escalaNombre}: «${token}»`);
  const spec: EspecAcorde = { grado: g, ext: extDe(sim[3]) };
  if (sim[4]) {
    const gb = gradoDePc(tonal, pcDeNombre(sim[4]));
    if (gb < 0) throw new Error(`Bajo no diatónico en «${token}»`);
    spec.bajo = gb;
  }
  const construido = construirAcorde(tonal, { grado: spec.grado, ext: spec.ext });
  if (spec.ext === 'nov' || spec.ext === 'once' || spec.ext === 'trece') {
    // Extensiones de color: basta con que la calidad (mayor/menor) coincida con la del grado.
    const pideMenor = sim[2] === 'm';
    const esMenorGrado = construirAcorde(tonal, { grado: spec.grado, ext: 'tri' }).esMenor;
    if (spec.ext !== 'trece' && pideMenor !== esMenorGrado) {
      throw new Error(`Acorde no diatónico en ${tonal.raiz} ${tonal.escalaNombre}: «${token}» (aquí sería «${construido.simbolo}»)`);
    }
    return spec;
  }
  const sufijoConstruido = construido.simbolo.slice(nombrePc(tonal, construido.raizPc).length);
  const sufijoToken = `${sim[2] ?? ''}${sim[3] ?? ''}`;
  const norm = (s: string) => s.replace('madd9', 'm' + 'add9');
  if (norm(sufijoConstruido) !== norm(sufijoToken)) {
    throw new Error(`Acorde no diatónico en ${tonal.raiz} ${tonal.escalaNombre}: «${token}» (aquí sería «${construido.simbolo}»)`);
  }
  return spec;
}

/** Grado romano cromático de un pc sobre la tonalidad («bVI», «#IV», «bII»). */
function romanoCromatico(tonal: Tonal, pc: number, minuscula: boolean): string {
  const semi = (pc - tonal.raizPc + 12) % 12;
  const g = tonal.escala.indexOf(semi);
  let txt: string;
  if (g >= 0) txt = ROMANOS[g]!;
  else {
    // Bemol del grado siguiente (bII, bIII, bV, bVI, bVII).
    const siguiente = tonal.escala.findIndex((s) => s > semi);
    const idx = siguiente >= 0 ? siguiente : 0;
    txt = `b${ROMANOS[idx]}`;
  }
  return minuscula ? txt.toLowerCase() : txt;
}

/**
 * Acorde a partir de un token (romano o símbolo): diatónico por grados cuando se puede y, si no
 * (préstamos, dominantes secundarias, acordes con tensiones alteradas, bajos cromáticos), lo construye
 * el parser cromático de `music/acordes.ts`. En ese caso `spec.grado` es -1 y `romano` lleva b/#.
 */
export function acordeDesdeToken(token: string, tonal: Tonal): Acorde {
  try {
    return construirAcorde(tonal, parsearAcorde(token, tonal));
  } catch (errorDiatonico) {
    const crom = intentarParsearAcorde(token);
    if (!crom) throw errorDiatonico;
    const fnDe = (semi: number): FuncionTono => {
      const s = semi % 12;
      if (semi === 0) return 'r';
      if (semi >= 12) return semi >= 20 ? '13' : semi >= 16 ? '11' : '9';
      if (s === 2) return '2';
      if (s === 3 || s === 4) return '3';
      if (s === 5) return '4';
      if (s === 6 || s === 7 || s === 8) return '5';
      if (s === 9) return '13';
      return '7';
    };
    const tonos: TonoAcorde[] = crom.intervalos.map((semi) => ({ pc: (crom.raizPc + semi) % 12, semi, fn: fnDe(semi) }));
    const esMenor = crom.intervalos.includes(3);
    const bajoPc = crom.bajoPc ?? crom.raizPc;
    const gradoBajo = crom.bajoPc !== undefined ? gradoDePc(tonal, crom.bajoPc) : -1;
    const sufijo = crom.nombre.slice(crom.raiz.length).replace(/\/[A-G](?:#|b)?$/, '');
    // Se conserva el deletreo del usuario: en Re mayor «Bb» es un préstamo, no «A#».
    const simbolo = `${crom.raiz}${sufijo}${bajoPc !== crom.raizPc ? `/${crom.bajo ?? nombrePc(tonal, bajoPc)}` : ''}`;
    let romano = romanoCromatico(tonal, crom.raizPc, esMenor || crom.calidad === 'disminuido');
    if (sufijo) romano += sufijo;
    if (bajoPc !== crom.raizPc) romano += `/${romanoCromatico(tonal, bajoPc, false)}`;
    return {
      spec: { grado: -1, ext: 'tri', ...(gradoBajo >= 0 ? { bajo: gradoBajo } : {}) },
      simbolo,
      romano,
      raizPc: crom.raizPc,
      bajoPc,
      tonos,
      pcs: tonos.map((t) => t.pc),
      esMenor,
    };
  }
}

// ---------------------------------------------------------------------------
// Voice-leading
// ---------------------------------------------------------------------------

export interface OpcionesVoz {
  rango: [number, number];
  centro: number;
  /** Máximo de voces (se descarta primero la quinta, luego la tercera). */
  voces: number;
  /** Selección de pitch classes del acorde; por defecto todos sus tonos. */
  seleccion?: (a: Acorde) => number[];
}

/** Elige voces con movimiento mínimo respecto a `previo`. */
export function elegirVoces(pcs: number[], rango: [number, number], previo: number[] | null, centro: number): number[] {
  const unicos = [...new Set(pcs)];
  const cands: number[][] = unicos.map((pc) => {
    const l: number[] = [];
    for (let p = rango[0]; p <= rango[1]; p++) if (p % 12 === pc && Math.abs(p - centro) <= 15) l.push(p);
    if (l.length === 0) for (let p = rango[0]; p <= rango[1]; p++) if (p % 12 === pc) l.push(p);
    return l;
  });
  let mejor: number[] = [];
  let mejorCosto = Infinity;
  const actual: number[] = [];
  const rec = (i: number) => {
    if (i === cands.length) {
      const s = [...actual].sort((a, b) => a - b);
      let costo = 0;
      if (previo && previo.length > 0) {
        const n = Math.min(s.length, previo.length);
        for (let k = 0; k < n; k++) costo += Math.abs(s[k]! - previo[k]!);
        costo += 2 * Math.abs(s.length - previo.length);
        costo += 0.1 * Math.abs(s.reduce((a, b) => a + b, 0) / s.length - centro);
      } else {
        costo += 0.4 * s.reduce((a, b) => a + Math.abs(b - centro), 0);
      }
      const span = s[s.length - 1]! - s[0]!;
      if (span > 16) costo += (span - 16) * 1.5;
      for (let k = 1; k < s.length; k++) {
        if (s[k]! === s[k - 1]!) return;
        if (s[k]! - s[k - 1]! < 3) costo += 4;
      }
      if (costo < mejorCosto - 1e-9) {
        mejorCosto = costo;
        mejor = s;
      }
      return;
    }
    for (const c of cands[i]!) {
      actual[i] = c;
      rec(i + 1);
    }
  };
  rec(0);
  return mejor;
}

/** pcs elegidos para limitar a `voces`: se retira la quinta y después la tercera. */
export function tonosLimitados(a: Acorde, voces: number): number[] {
  let tonos = [...a.tonos];
  const quitar: FuncionTono[] = ['5', '11', '9', '13', '7', '3'];
  for (const fn of quitar) {
    if (tonos.length <= voces) break;
    const i = tonos.findIndex((t) => t.fn === fn);
    if (i >= 0 && tonos[i]!.fn !== 'r') tonos = tonos.filter((_, k) => k !== i);
  }
  return tonos.map((t) => t.pc);
}

export function encadenarVoces(acordes: Acorde[], op: OpcionesVoz): number[][] {
  const res: number[][] = [];
  let prev: number[] | null = null;
  for (const a of acordes) {
    const pcs = op.seleccion ? op.seleccion(a) : tonosLimitados(a, op.voces);
    const v = elegirVoces(pcs, op.rango, prev, op.centro);
    res.push(v);
    prev = v;
  }
  return res;
}

/** Pitch del pc más próximo a `objetivo` dentro de [lo, hi]. */
export function pitchCercano(pc: number, objetivo: number, lo: number, hi: number): number {
  let mejor = -1;
  let d = Infinity;
  for (let p = lo; p <= hi; p++) {
    if (p % 12 !== ((pc % 12) + 12) % 12) continue;
    const dd = Math.abs(p - objetivo);
    if (dd < d) {
      d = dd;
      mejor = p;
    }
  }
  if (mejor < 0) throw new Error(`pc ${pc} sin pitch en [${lo},${hi}]`);
  return mejor;
}

/** Escala de pitches (ascendente) de la tonalidad dentro de [lo, hi]. */
export function escaleraDeEscala(tonal: Tonal, lo: number, hi: number): number[] {
  const r: number[] = [];
  for (let p = lo; p <= hi; p++) if (tonal.pcsEscala.has(p % 12)) r.push(p);
  return r;
}

// ---------------------------------------------------------------------------
// Biblioteca de progresiones (tokens en grados romanos; siempre diatónicos)
// ---------------------------------------------------------------------------

export const PROGRESIONES_BASE: Record<TipoSeccionWorship, string[][]> = {
  intro: [
    ['Isus2', 'IVadd9', 'vi7', 'Vsus4'],
    ['I', 'V/3', 'vi7', 'IVadd9'],
    ['IVadd9', 'I/3', 'vi7', 'Vsus4'],
    ['Isus2', 'IVmaj7', 'Isus2', 'IVadd9'],
  ],
  verso: [
    ['I', 'V/3', 'vi7', 'IVadd9'],
    ['vi7', 'IVadd9', 'I', 'V'],
    ['I', 'iii7', 'IVadd9', 'V'],
    ['I', 'I/3', 'IV', 'V'],
    ['IVadd9', 'I', 'V/3', 'vi7'],
    ['I', 'IV', 'vi7', 'Vsus4'],
  ],
  precoro: [
    ['vi7', 'IVadd9', 'I/3', 'Vsus4'],
    ['I', 'IVadd9/I', 'vi7/I', 'Vsus4/I'],
    ['IV', 'V', 'vi7', 'Vsus4'],
    ['ii7', 'IV', 'I/5', 'V'],
  ],
  coro: [
    ['I', 'V', 'vi', 'IV'],
    ['vi7', 'IV', 'I', 'V'],
    ['I', 'V/3', 'IV', 'vi7'],
    ['IV', 'I', 'V', 'vi'],
    ['I', 'iii7', 'IV', 'V'],
    ['I', 'V', 'IVadd9', 'vi7'],
  ],
  puente: [
    ['vi7', 'IVadd9', 'Isus2', 'Vsus4'],
    ['IV', 'V', 'vi7', 'Vsus4'],
    ['IVadd9', 'I/3', 'vi7', 'V'],
    ['vi7', 'V/3', 'IV', 'Isus2'],
  ],
  coroFinal: [
    ['I', 'V', 'vi', 'IV'],
    ['vi7', 'IV', 'I', 'V'],
  ],
  outro: [
    ['IVadd9', 'I', 'IVadd9', 'Isus2'],
    ['vi7', 'IVadd9', 'Isus2', 'I'],
    ['IVmaj7', 'Vsus4', 'IVadd9', 'I'],
  ],
};

/** Cadencias / turnarounds del último compás de una sección (1 token = compás entero; 2 = medio compás cada uno). */
export const TURNAROUNDS: Record<TipoSeccionWorship, string[][]> = {
  intro: [['Vsus4', 'V'], ['vi7', 'Vsus4'], ['IVadd9', 'V/3'], ['Vsus4']],
  verso: [['Vsus4', 'V'], ['IV', 'V'], ['vi7', 'Vsus4'], ['IVadd9', 'Vsus4'], ['V/3']],
  precoro: [['Vsus4', 'V'], ['IV', 'V'], ['Vsus4'], ['ii7', 'Vsus4']],
  coro: [['Vsus4', 'V'], ['IV', 'V'], ['vi7', 'V'], ['IVadd9', 'Vsus4'], ['V']],
  puente: [['Vsus4', 'V'], ['IV', 'Vsus4'], ['vi7', 'Vsus4']],
  coroFinal: [['Vsus4', 'V'], ['IV', 'V'], ['IVadd9', 'Vsus4']],
  outro: [['IVadd9', 'I'], ['Vsus4', 'I'], ['IVmaj7', 'Isus2']],
};

/** Cierre plagal/auténtico del final de la canción (último compás de la última sección). */
export const CIERRES_FINALES: string[][] = [['IVadd9', 'Isus2'], ['IV', 'I'], ['Vsus4', 'I'], ['IVmaj7', 'I']];

/** Sustitución ligera de un token para variar repeticiones (siempre diatónica). */
export function variarToken(token: string, r: () => number): string {
  const sust: Record<string, string[]> = {
    IV: ['IVadd9'],
    IVadd9: ['IV'],
    I: ['Isus2'],
    V: ['V/3'],
    vi: ['vi7'],
    vi7: ['vi'],
    iii7: ['iii7'],
  };
  const opts = sust[token];
  if (!opts || r() > 0.4) return token;
  return opts[Math.floor(r() * opts.length)]!;
}
