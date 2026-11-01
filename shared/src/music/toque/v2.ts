/**
 * Medidas v2 del toque: micro-tiempo por voz del acorde, microdinámica por mano, rubato por compás y pedal
 * de sustain. Puras y deterministas; cada una devuelve «no medido» (n = 0) cuando no hay datos suficientes,
 * nunca inventa.
 */

import { ajustarARejilla, estadistica, r2, UMBRAL_ARPEGIADO_MS, type GrupoNotas } from './analisis';
import type { EventoPedalToque, ManosToque, NotaToque, PedalToque, RubatoToque, VocesToque } from './tipos';

const VACIA = { media: 0, sd: 0, n: 0 };

/** Pitch del corte entre manos con 2-medias en una dimensión; null si el registro no se separa en dos. */
export function estimarSplitManos(pitches: readonly number[]): number | null {
  if (pitches.length < 8) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of pitches) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (max - min < 12) return null;
  let m1 = min;
  let m2 = max;
  for (let it = 0; it < 12; it++) {
    let s1 = 0;
    let n1 = 0;
    let s2 = 0;
    let n2 = 0;
    for (const p of pitches) {
      if (Math.abs(p - m1) <= Math.abs(p - m2)) {
        s1 += p;
        n1++;
      } else {
        s2 += p;
        n2++;
      }
    }
    if (!n1 || !n2) return null;
    const nm1 = s1 / n1;
    const nm2 = s2 / n2;
    if (Math.abs(nm1 - m1) < 1e-6 && Math.abs(nm2 - m2) < 1e-6) break;
    m1 = nm1;
    m2 = nm2;
  }
  if (Math.abs(m2 - m1) < 7) return null;
  return Math.round((m1 + m2) / 2);
}

/**
 * Voces del acorde: en los acordes de 3+ notas con dispersión audible (span > umbral de arpegiado), cuánto
 * entra cada voz después del bajo. Los plaqués (todas las voces dentro del umbral) no cuentan.
 */
export function medirVoces(grupos: readonly GrupoNotas[], notas: readonly NotaToque[], msPorBeat: number): VocesToque {
  const medias: number[] = [];
  const superior: number[] = [];
  let n = 0;
  let bajoPrimero = 0;
  for (const g of grupos) {
    if (g.idx.length < 3) continue;
    const span = (notas[g.idx[g.idx.length - 1]!]!.inicio - notas[g.idx[0]!]!.inicio) * msPorBeat;
    if (span <= UMBRAL_ARPEGIADO_MS) continue;
    const porPitch = [...g.idx].sort((a, b) => notas[a]!.pitch - notas[b]!.pitch);
    const bajo = notas[porPitch[0]!]!;
    const resto = porPitch.slice(1);
    n += 1;
    if (resto.every((i) => notas[i]!.inicio >= bajo.inicio)) bajoPrimero += 1;
    superior.push((notas[porPitch[porPitch.length - 1]!]!.inicio - bajo.inicio) * msPorBeat);
    for (const i of porPitch.slice(1, -1)) medias.push((notas[i]!.inicio - bajo.inicio) * msPorBeat);
  }
  return { medias: estadistica(medias), superior: estadistica(superior), bajoPrimero: n ? r2(bajoPrimero / n) : 0, n };
}

export function medirManos(
  grupos: readonly GrupoNotas[],
  notas: readonly NotaToque[],
  vels: readonly number[],
  desvNotaMs: ReadonlyArray<number | null>,
): ManosToque {
  const split = estimarSplitManos(notas.map((n) => n.pitch));
  const izq = { v: [] as number[], t: [] as number[] };
  const der = { v: [] as number[], t: [] as number[] };
  const esIzq = (i: number) => split != null && notas[i]!.pitch < split;
  // El micro-timing por mano se mide en los ataques de una sola mano: en los acordes a dos manos el desfase
  // ya lo describen las voces del acorde.
  const unaMano = new Set<number>();
  for (const g of grupos) if (g.idx.every((i) => esIzq(i) === esIzq(g.idx[0]!))) for (const i of g.idx) unaMano.add(i);
  notas.forEach((n, i) => {
    const mano = esIzq(i) ? izq : der;
    mano.v.push(vels[i]!);
    const d = desvNotaMs[i];
    if (d != null && unaMano.has(i)) mano.t.push(d);
  });
  const melodia: number[] = [];
  const interna: number[] = [];
  const bajo: number[] = [];
  for (const g of grupos) {
    const porPitch = [...g.idx].sort((a, b) => notas[a]!.pitch - notas[b]!.pitch);
    if (porPitch.length === 1) {
      const i = porPitch[0]!;
      (split != null && notas[i]!.pitch < split ? bajo : melodia).push(vels[i]!);
      continue;
    }
    melodia.push(vels[porPitch[porPitch.length - 1]!]!);
    bajo.push(vels[porPitch[0]!]!);
    for (const i of porPitch.slice(1, -1)) interna.push(vels[i]!);
  }
  return {
    split,
    izquierda: { notas: izq.v.length, velocidad: estadistica(izq.v), timing: estadistica(izq.t) },
    derecha: { notas: der.v.length, velocidad: estadistica(der.v), timing: estadistica(der.t) },
    relacion: { melodia: estadistica(melodia), armoniaInterna: estadistica(interna), bajo: estadistica(bajo) },
  };
}

const MAX_COMPASES_CURVA = 64;
const TOLERANCIA_COMPAS = 0.3;
const UMBRAL_CADENCIA = -2.5;

/** Pendiente (tiempo real / posición en rejilla) por mínimos cuadrados; null si no hay dos posiciones distintas. */
function pendiente(puntos: ReadonlyArray<[number, number]>): number | null {
  const n = puntos.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of puntos) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of puntos) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
  }
  return sxx > 1e-9 ? sxy / sxx : null;
}

/**
 * Rubato: sigue los tiempos fuertes compás a compás (el siguiente se espera a `beatsPorCompas` del anterior
 * al tempo local previo) y mide el tempo real dentro de cada compás con la pendiente de sus ataques frente a
 * la rejilla local (si el compás tiene menos de 3 ataques, entra también el tiempo fuerte siguiente). Tolera
 * que el intérprete derive respecto al tempo nominal y también que frene al final del compás y el siguiente
 * entre en su sitio (tocando con claqueta).
 */
export function medirRubato(
  grupos: readonly GrupoNotas[],
  o: { bpm: number; offsetBeats: number; beatsPorCompas: number; rejillaBeats: number },
): RubatoToque {
  const vacio: RubatoToque = { curvaBpmPorCompas: [], desvioPorciento: VACIA, cadencias: { cadaCompases: null, caidaPorciento: 0, n: 0 } };
  if (grupos.length < 4) return vacio;
  const bpc = o.beatsPorCompas;
  const anclas = grupos.map((g) => g.ancla + o.offsetBeats);
  const pasoTol = 0.42 * o.rejillaBeats;
  // Primer tiempo fuerte: el primer ataque que cae en un inicio de compás; si no hay, el primero.
  let k0 = anclas.findIndex((a) => {
    const q = ajustarARejilla(a, o.rejillaBeats);
    return Math.abs(a - q) <= pasoTol && Math.abs(q / bpc - Math.round(q / bpc)) < 1e-6;
  });
  if (k0 < 0) k0 = 0;
  const ultimo = anclas[anclas.length - 1]!;
  const curva: number[] = [];
  const desvios: number[] = [];
  let aPrev = anclas[k0]!;
  let fPrev = 1;
  let desde = k0 + 1;
  while (curva.length < 256) {
    const esperado = aPrev + bpc * fPrev;
    if (esperado > ultimo + TOLERANCIA_COMPAS) break;
    let mejor = -1;
    let mejorDist = Infinity;
    for (let k = desde; k < anclas.length; k++) {
      const d = Math.abs(anclas[k]! - esperado);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = k;
      }
      if (anclas[k]! > esperado + TOLERANCIA_COMPAS) break;
    }
    const hayDownbeat = mejor >= 0 && mejorDist <= TOLERANCIA_COMPAS;
    const finCompas = hayDownbeat ? anclas[mejor]! : esperado;
    // Ataques del compás (desde el tiempo fuerte actual hasta el siguiente) frente a su rejilla local.
    const puntos: Array<[number, number]> = [];
    const vistos = new Set<number>();
    for (let k = desde - 1; k < anclas.length; k++) {
      const a = anclas[k]!;
      if (a < aPrev - 1e-9) continue;
      if (a >= finCompas - 1e-9) break;
      // El tempo se mide sobre los tiempos (negras), no sobre la subdivisión: un ataque muy desplazado por el
      // propio rubato caería en la casilla de semicorchea equivocada.
      const rel = (a - aPrev) / fPrev;
      const q = Math.round(rel);
      if (Math.abs(rel - q) > TOLERANCIA_COMPAS || q >= bpc) continue;
      if (vistos.has(q)) continue;
      vistos.add(q);
      puntos.push([q, a - aPrev]);
    }
    if (puntos.length < 3 && hayDownbeat) puntos.push([bpc, finCompas - aPrev]);
    const f = pendiente(puntos);
    if (f != null && f > 0.5 && f < 2) {
      curva.push(r2(o.bpm / f));
      desvios.push((1 / f - 1) * 100);
    } else curva.push(0);
    if (hayDownbeat) {
      fPrev = Math.max(0.8, Math.min(1.25, (anclas[mejor]! - aPrev) / bpc));
      aPrev = anclas[mejor]!;
      desde = mejor + 1;
    } else aPrev = esperado;
  }
  if (desvios.length < 4) return { ...vacio, curvaBpmPorCompas: curva.slice(0, MAX_COMPASES_CURVA) };
  const indicesCadencia: number[] = [];
  curva.forEach((b, i) => {
    if (b > 0 && (b / o.bpm - 1) * 100 <= UMBRAL_CADENCIA) indicesCadencia.push(i);
  });
  let cadaCompases: number | null = null;
  if (indicesCadencia.length >= 2) {
    const gaps = indicesCadencia.slice(1).map((x, i) => x - indicesCadencia[i]!);
    const ordenados = [...gaps].sort((a, b) => a - b);
    const mediana = ordenados[ordenados.length >> 1]!;
    if (ordenados[ordenados.length - 1]! - ordenados[0]! <= 1 && mediana >= 2) cadaCompases = mediana;
  }
  const caida = indicesCadencia.length ? indicesCadencia.reduce((a, i) => a + Math.abs((curva[i]! / o.bpm - 1) * 100), 0) / indicesCadencia.length : 0;
  return {
    curvaBpmPorCompas: curva.slice(0, MAX_COMPASES_CURVA),
    desvioPorciento: estadistica(desvios),
    cadencias: { cadaCompases, caidaPorciento: r2(caida), n: indicesCadencia.length },
  };
}

const PISADO = 64;

function conjuntoPitches(g: GrupoNotas, notas: readonly NotaToque[]): string {
  return [...new Set(g.idx.map((i) => ((notas[i]!.pitch % 12) + 12) % 12))].sort((a, b) => a - b).join(',');
}

export function medirPedal(
  grupos: readonly GrupoNotas[],
  notas: readonly NotaToque[],
  pedal: readonly EventoPedalToque[] | undefined,
  msPorBeat: number,
): PedalToque {
  const vacio: PedalToque = { medido: false, tiempoPisado: 0, cambios: 0, cambioEnAcorde: VACIA, solapePorDedos: 0, solapePorPedal: 0 };
  const eventos = (pedal ?? []).filter((e) => Number.isFinite(e.inicio) && Number.isFinite(e.valor)).sort((a, b) => a.inicio - b.inicio);
  if (!eventos.length || !notas.length) return vacio;
  // Intervalos con el pedal pisado y las pisadas (transición suelto → pisado).
  const intervalos: Array<[number, number]> = [];
  const pisadas: number[] = [];
  let abierto: number | null = null;
  for (const e of eventos) {
    const pisado = e.valor >= PISADO;
    if (pisado && abierto == null) {
      abierto = e.inicio;
      pisadas.push(e.inicio);
    } else if (!pisado && abierto != null) {
      intervalos.push([abierto, e.inicio]);
      abierto = null;
    }
  }
  const finNotas = notas.reduce((m, n) => Math.max(m, n.inicio + n.duracion), -Infinity);
  const inicioNotas = notas[0]!.inicio;
  if (abierto != null) intervalos.push([abierto, Math.max(finNotas, abierto)]);
  const pisadoEn = (t: number) => intervalos.some(([a, b]) => t >= a && t < b);
  const sueltaEntre = (a: number, b: number) => intervalos.some(([, fin]) => fin > a && fin < b);
  const span = finNotas - inicioNotas;
  let dentro = 0;
  for (const [a, b] of intervalos) dentro += Math.max(0, Math.min(b, finNotas) - Math.max(a, inicioNotas));
  const tiempoPisado = span > 0 ? Math.max(0, Math.min(1, dentro / span)) : 0;

  const ventana = 250 / msPorBeat;
  const cambioEnAcorde: number[] = [];
  let previo = grupos.length ? conjuntoPitches(grupos[0]!, notas) : '';
  for (let k = 1; k < grupos.length; k++) {
    const g = grupos[k]!;
    const actual = conjuntoPitches(g, notas);
    if (g.idx.length >= 2 && actual !== previo) {
      let mejor: number | null = null;
      for (const t of pisadas) {
        const d = t - g.ancla;
        if (Math.abs(d) <= ventana && (mejor == null || Math.abs(d) < Math.abs(mejor))) mejor = d;
      }
      if (mejor != null) cambioEnAcorde.push(mejor * msPorBeat);
    }
    previo = actual;
  }

  let total = 0;
  let dedos = 0;
  let porPedal = 0;
  for (let k = 0; k < grupos.length - 1; k++) {
    const siguiente = grupos[k + 1]!.ancla;
    for (const i of grupos[k]!.idx) {
      const n = notas[i]!;
      const fin = n.inicio + n.duracion;
      total += 1;
      if (fin > siguiente + 1 / msPorBeat) dedos += 1;
      else if (pisadoEn(fin) && pisadoEn(siguiente) && !sueltaEntre(fin, siguiente)) porPedal += 1;
    }
  }
  return {
    medido: true,
    tiempoPisado: r2(tiempoPisado),
    cambios: pisadas.length,
    cambioEnAcorde: estadistica(cambioEnAcorde),
    solapePorDedos: total ? r2(dedos / total) : 0,
    solapePorPedal: total ? r2(porPedal / total) : 0,
  };
}
