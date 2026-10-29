/**
 * Utilidades puras compartidas por aprender/aplicar el toque: agrupación de notas casi simultáneas,
 * posición métrica, frases y arpegios melódicos.
 */

import type { Estadistica, NotaToque, PosicionMetrica } from './tipos';

const EPS = 1e-6;

export const VELOCIDAD_POR_DEFECTO = 100;

export function velocidadDe(n: NotaToque): number {
  const v = Number(n.velocidad);
  return Number.isFinite(v) ? Math.max(1, Math.min(127, v)) : VELOCIDAD_POR_DEFECTO;
}

/** Índices (sobre el array ordenado) de cada grupo de notas casi simultáneas. */
export interface GrupoNotas {
  /** Índices en el array ordenado, por orden de entrada. */
  idx: number[];
  /** Inicio (beats) de la primera nota. */
  ancla: number;
}

export function notasValidas<T extends NotaToque>(notas: readonly T[]): Array<{ nota: T; original: number }> {
  return notas
    .map((nota, original) => ({ nota, original }))
    .filter(({ nota }) => Number.isFinite(nota.pitch) && Number.isFinite(nota.inicio) && Number.isFinite(nota.duracion))
    .sort((a, b) => a.nota.inicio - b.nota.inicio || a.nota.pitch - b.nota.pitch);
}

/**
 * Agrupa notas ordenadas en «ataques»: encadena notas separadas < ventanaMs, con un span máximo
 * (un acorde arpegiado muy lento sigue siendo acorde hasta `spanMaxMs`).
 */
export function agruparAtaques(
  inicios: readonly number[],
  msPorBeat: number,
  ventanaMs = 35,
  spanMaxMs = 160,
): GrupoNotas[] {
  const grupos: GrupoNotas[] = [];
  for (let i = 0; i < inicios.length; i++) {
    const t = inicios[i]!;
    const g = grupos[grupos.length - 1];
    if (g) {
      const ultimo = inicios[g.idx[g.idx.length - 1]!]!;
      if ((t - ultimo) * msPorBeat < ventanaMs && (t - g.ancla) * msPorBeat <= spanMaxMs) {
        g.idx.push(i);
        continue;
      }
    }
    grupos.push({ idx: [i], ancla: t });
  }
  return grupos;
}

export function ajustarARejilla(beat: number, rejilla: number): number {
  return Math.round(beat / rejilla) * rejilla;
}

/** Posición métrica de un instante ya cuantizado (beats absolutos). */
export function posicionMetrica(beatCuantizado: number, beatsPorCompas: number): PosicionMetrica {
  const enCompas = ((beatCuantizado % beatsPorCompas) + beatsPorCompas) % beatsPorCompas;
  if (enCompas < EPS * 100 || beatsPorCompas - enCompas < EPS * 100) return 'fuerte';
  const frac = beatCuantizado - Math.floor(beatCuantizado + EPS * 100);
  if (Math.abs(frac) < EPS * 100 || Math.abs(frac - 1) < EPS * 100) return 'debil';
  if (Math.abs(frac - 0.5) < EPS * 100) return 'contratiempo';
  return 'subdivision';
}

export function estadistica(xs: readonly number[]): Estadistica {
  if (xs.length === 0) return { media: 0, sd: 0, n: 0 };
  const media = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - media) ** 2, 0) / xs.length);
  return { media: r2(media), sd: r2(sd), n: xs.length };
}

/**
 * Mezcla una estadística con pocas muestras hacia una global: peso lineal n / nPleno
 * (con ≥ nPleno muestras se usa tal cual).
 */
export function contraer(e: Estadistica | undefined, global: Estadistica, nPleno = 12): { media: number; sd: number } {
  if (!e || e.n === 0) return { media: global.media, sd: global.sd };
  const w = Math.min(1, e.n / nPleno);
  return { media: w * e.media + (1 - w) * global.media, sd: w * e.sd + (1 - w) * global.sd };
}

export function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Índices de grupo que abren frase: el primero y los que llegan tras un silencio
 * ≥ max(200 ms, medio beat) desde el final de todo lo anterior.
 */
export function iniciosDeFrase(
  grupos: readonly GrupoNotas[],
  notas: readonly NotaToque[],
  msPorBeat: number,
): Set<number> {
  const res = new Set<number>();
  let finMax = -Infinity;
  const umbralBeats = Math.max(200 / msPorBeat, 0.5);
  grupos.forEach((g, k) => {
    if (k === 0 || g.ancla - finMax >= umbralBeats - EPS) res.add(k);
    for (const i of g.idx) finMax = Math.max(finMax, notas[i]!.inicio + notas[i]!.duracion);
  });
  return res;
}

/**
 * Arpegios melódicos: secuencias de ≥3 grupos de UNA nota, separados ≤ 1 beat, con saltos de 1..9
 * semitonos en la misma dirección. Devuelve, por grupo, su tramo (0 inicio · 1 medio · 2 fin).
 */
export function tramosDeArpegio(
  grupos: readonly GrupoNotas[],
  notas: readonly NotaToque[],
): { tramo: Map<number, 0 | 1 | 2>; corridas: number[][] } {
  const tramo = new Map<number, 0 | 1 | 2>();
  const corridas: number[][] = [];
  let actual: number[] = [];
  let dir = 0;
  const cerrar = () => {
    if (actual.length >= 3) {
      corridas.push(actual);
      actual.forEach((k, i) => {
        const f = i / (actual.length - 1);
        tramo.set(k, f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2);
      });
    }
    actual = [];
    dir = 0;
  };
  for (let k = 0; k < grupos.length; k++) {
    const g = grupos[k]!;
    if (g.idx.length !== 1) {
      cerrar();
      continue;
    }
    if (actual.length === 0) {
      actual = [k];
      continue;
    }
    const prev = grupos[actual[actual.length - 1]!]!;
    const salto = notas[g.idx[0]!]!.pitch - notas[prev.idx[0]!]!.pitch;
    const d = Math.sign(salto);
    const encaja = g.ancla - prev.ancla <= 1 + EPS && Math.abs(salto) >= 1 && Math.abs(salto) <= 9 && (dir === 0 || d === dir);
    if (encaja) {
      dir = d;
      actual.push(k);
    } else {
      // El último de la corrida rota puede empezar la siguiente.
      const ultimo = actual[actual.length - 1]!;
      cerrar();
      if (Math.abs(salto) >= 1 && Math.abs(salto) <= 9 && g.ancla - prev.ancla <= 1 + EPS) {
        actual = [ultimo, k];
        dir = d;
      } else actual = [k];
    }
  }
  cerrar();
  return { tramo, corridas };
}
