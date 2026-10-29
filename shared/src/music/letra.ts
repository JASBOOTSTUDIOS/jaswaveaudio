/**
 * Letra: silabeo del español y reparto automático de líneas en la línea de tiempo (por secciones o
 * por compases). Puro y determinista: lo usan los comandos `lyrics.*` y la UI.
 */

import type { AcordeCarril, FraseLetra, SilabaLetra } from '../types/lyrics';
import { intentarParsearAcorde } from './acordes';

const FUERTES = new Set(['a', 'e', 'o', 'á', 'é', 'ó', 'à', 'è', 'ò']);
const DEBILES = new Set(['i', 'u', 'ü']);
const DEBILES_ACENTUADAS = new Set(['í', 'ú']);
const INSEPARABLES = new Set(['qu', 'gu', 'pr', 'br', 'tr', 'dr', 'cr', 'gr', 'fr', 'kr', 'pl', 'bl', 'cl', 'gl', 'fl', 'kl', 'tl', 'ch', 'll', 'rr']);

const esVocal = (ch: string) => FUERTES.has(ch) || DEBILES.has(ch) || DEBILES_ACENTUADAS.has(ch);

/** Posiciones (índices) de las letras que son núcleo vocálico; agrupa diptongos/triptongos y separa hiatos. */
function nucleos(letras: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < letras.length) {
    const ch = letras[i]!;
    const prev = letras[i - 1] ?? '';
    // «qu»/«gu» + e/i: la u es muda.
    const uMuda = ch === 'u' && (prev === 'q' || prev === 'g') && (letras[i + 1] === 'e' || letras[i + 1] === 'i' || letras[i + 1] === 'é' || letras[i + 1] === 'í');
    const esY = ch === 'y' && i === letras.length - 1 && letras.length > 1 && esVocal(prev);
    if (!uMuda && (esVocal(ch) || esY)) {
      let fin = i;
      while (fin + 1 < letras.length) {
        const a = letras[fin]!;
        const b = letras[fin + 1]!;
        const bEsY = b === 'y' && fin + 1 === letras.length - 1;
        if (!esVocal(b) && !bEsY) break;
        // Hiato: dos fuertes, o débil acentuada junto a otra vocal.
        if (FUERTES.has(a) && FUERTES.has(b)) break;
        if (DEBILES_ACENTUADAS.has(a) || DEBILES_ACENTUADAS.has(b)) break;
        if (a === b) break;
        fin++;
      }
      out.push([i, fin]);
      i = fin + 1;
    } else i++;
  }
  return out;
}

/** Silabeo básico del español: `silabear('presencia') → ['pre','sen','cia']`. Conserva la grafía original. */
export function silabear(palabra: string): string[] {
  const original = palabra.trim();
  if (!original) return [];
  const letras = [...original.toLowerCase()];
  const nuc = nucleos(letras);
  if (nuc.length <= 1) return [original];
  const cortes: number[] = [];
  for (let k = 0; k < nuc.length - 1; k++) {
    const finA = nuc[k]![1];
    const iniB = nuc[k + 1]![0];
    const cons = letras.slice(finA + 1, iniB);
    const n = cons.length;
    let corte: number;
    if (n === 0) corte = finA + 1;
    else if (n === 1) corte = finA + 1;
    else if (n === 2) corte = INSEPARABLES.has(cons.join('')) ? finA + 1 : finA + 2;
    else if (n === 3) corte = INSEPARABLES.has(cons.slice(1).join('')) ? finA + 2 : finA + 3;
    else corte = finA + 3;
    cortes.push(corte);
  }
  const chars = [...original];
  const out: string[] = [];
  let ini = 0;
  for (const c of cortes) {
    out.push(chars.slice(ini, c).join(''));
    ini = c;
  }
  out.push(chars.slice(ini).join(''));
  return out.filter((s) => s.length > 0);
}

/** Separa una línea en palabras (conserva la puntuación pegada a la palabra). */
export function palabrasDe(linea: string): string[] {
  return linea.trim().split(/\s+/).filter(Boolean);
}

/** Sílabas de una línea completa con marca de fin de palabra. */
export function silabasDeLinea(linea: string): Array<{ texto: string; finPalabra: boolean }> {
  const out: Array<{ texto: string; finPalabra: boolean }> = [];
  for (const palabra of palabrasDe(linea)) {
    const nucleo = palabra.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const prefijo = palabra.slice(0, palabra.indexOf(nucleo));
    const sufijo = palabra.slice(prefijo.length + nucleo.length);
    const sil = nucleo ? silabear(nucleo) : [palabra];
    sil.forEach((s, i) => {
      const texto = (i === 0 ? prefijo : '') + s + (i === sil.length - 1 ? sufijo : '');
      out.push({ texto, finPalabra: i === sil.length - 1 });
    });
  }
  return out;
}

export interface OpcionesReparto {
  /** Beats por compás (numerador). */
  numerador: number;
  /** Beat de inicio del reparto (si no hay secciones). Por defecto 0. */
  inicioBeat?: number;
  /** Compases por frase cuando no hay secciones. Por defecto 2. */
  compasesPorFrase?: number;
  /** Secciones del proyecto (marcadores): la estrofa i va a la sección i. Deben venir ordenadas por beat. */
  secciones?: Array<{ nombre: string; beat: number; finBeat?: number }>;
  /** Generador de ids (determinista en los comandos). */
  id: () => string;
}

/** Reparte las sílabas de una frase uniformemente en [inicio, inicio+duracion). */
export function temporizarFrase(texto: string, inicio: number, duracion: number): SilabaLetra[] {
  const sil = silabasDeLinea(texto);
  if (sil.length === 0) return [];
  const paso = duracion / sil.length;
  return sil.map((s, i) => ({ texto: s.texto, beat: redondear(inicio + i * paso), duracion: redondear(paso), finPalabra: s.finPalabra }));
}

const redondear = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Convierte el texto pegado (líneas; estrofas separadas por línea en blanco) en frases temporizadas.
 * Con secciones: la estrofa i cae en la sección i y sus líneas se reparten por igual dentro de ella;
 * sin secciones: cada línea ocupa `compasesPorFrase` compases seguidos desde `inicioBeat`.
 */
export function repartirLetra(texto: string, op: OpcionesReparto): FraseLetra[] {
  const estrofas = texto
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((e) => e.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((e) => e.length > 0);
  const numerador = Math.max(1, op.numerador);
  const frases: FraseLetra[] = [];
  const secciones = (op.secciones ?? []).filter((s) => Number.isFinite(s.beat)).sort((a, b) => a.beat - b.beat);
  if (secciones.length > 0) {
    estrofas.forEach((lineas, i) => {
      const sec = secciones[Math.min(i, secciones.length - 1)]!;
      const fin = sec.finBeat ?? secciones[Math.min(i, secciones.length - 1) + 1]?.beat ?? sec.beat + Math.max(4, lineas.length * 2) * numerador;
      // Varias estrofas en la última sección: se encadenan detrás.
      const extra = i >= secciones.length ? (i - secciones.length + 1) * (fin - sec.beat) : 0;
      const inicio = sec.beat + extra;
      const largo = Math.max(numerador, fin - sec.beat);
      const porLinea = largo / lineas.length;
      lineas.forEach((l, k) => {
        frases.push({ id: op.id(), texto: l, seccion: sec.nombre, silabas: temporizarFrase(l, inicio + k * porLinea, porLinea) });
      });
    });
    return frases;
  }
  const compases = Math.max(1, op.compasesPorFrase ?? 2);
  let beat = op.inicioBeat ?? 0;
  for (const lineas of estrofas) {
    for (const l of lineas) {
      const dur = compases * numerador;
      frases.push({ id: op.id(), texto: l, silabas: temporizarFrase(l, beat, dur) });
      beat += dur;
    }
  }
  return frases;
}

/**
 * Acordes a partir de texto: «| D | Bm | G A |» o «D Bm G A» (un compás por barra; dentro de una barra se
 * reparten por igual). Sin barras, un acorde por compás. Devuelve null si algún símbolo no es un acorde.
 */
export function acordesDesdeTexto(
  texto: string,
  op: { numerador: number; inicioBeat?: number; id: () => string },
): AcordeCarril[] | null {
  const numerador = Math.max(1, op.numerador);
  const limpio = texto.replace(/\r\n?/g, '\n').trim();
  if (!limpio) return [];
  const compases: string[][] = [];
  if (limpio.includes('|')) {
    for (const linea of limpio.split('\n')) {
      for (const celda of linea.split('|')) {
        const t = celda.trim();
        if (!t) continue;
        compases.push(t.split(/\s+/));
      }
    }
  } else {
    for (const tok of limpio.split(/[\s,]+/).filter(Boolean)) compases.push([tok]);
  }
  const out: AcordeCarril[] = [];
  let beat = op.inicioBeat ?? 0;
  for (const celda of compases) {
    const paso = numerador / celda.length;
    for (let i = 0; i < celda.length; i++) {
      const tok = celda[i]!;
      if (tok === '%' || tok === '/' || tok === '.') {
        // Repetición del acorde anterior: se alarga.
        const prev = out[out.length - 1];
        if (prev) prev.duracion = redondear(prev.duracion + paso);
        continue;
      }
      const a = intentarParsearAcorde(tok);
      if (!a) return null;
      out.push({ id: op.id(), nombre: a.nombre, beat: redondear(beat + i * paso), duracion: redondear(paso) });
    }
    beat += numerador;
  }
  return out;
}

/** Texto de cifrado por compases a partir de los eventos («| D | Bm | G A |»). */
export function acordesComoTexto(acordes: readonly AcordeCarril[], numerador: number): string {
  if (acordes.length === 0) return '';
  const n = Math.max(1, numerador);
  const ordenados = [...acordes].sort((a, b) => a.beat - b.beat);
  const ultimo = ordenados[ordenados.length - 1]!;
  const compases = Math.ceil((ultimo.beat + ultimo.duracion) / n);
  const celdas: string[] = [];
  for (let c = 0; c < compases; c++) {
    const ini = c * n;
    const fin = ini + n;
    const dentro = ordenados.filter((a) => a.beat >= ini - 1e-6 && a.beat < fin - 1e-6);
    if (dentro.length === 0) celdas.push('%');
    else celdas.push(dentro.map((a) => a.nombre).join(' '));
  }
  return `| ${celdas.join(' | ')} |`;
}

/** Sílaba activa en un beat (o null): busca en todas las frases, binaria por frase ordenada. */
export function silabaEn(frases: readonly FraseLetra[], beat: number): { fraseId: string; indice: number } | null {
  for (const f of frases) {
    const s = f.silabas;
    if (s.length === 0) continue;
    if (beat < s[0]!.beat || beat >= s[s.length - 1]!.beat + s[s.length - 1]!.duracion) continue;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid]!.beat <= beat) lo = mid;
      else hi = mid - 1;
    }
    if (beat < s[lo]!.beat + s[lo]!.duracion) return { fraseId: f.id, indice: lo };
  }
  return null;
}
