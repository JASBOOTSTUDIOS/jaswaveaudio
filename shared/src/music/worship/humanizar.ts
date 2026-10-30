/**
 * Humanización: micro-timing gaussiano acotado por rol (batería laid-back: caja atrasada, bombo preciso),
 * strum de acordes, contorno de frase + jitter de velocidad, legato/overlap controlado y rubato leve
 * en intro/outro. Usa un flujo PRNG propio por rol (independiente de la composición): con
 * humanizacion = 0 las notas salen exactamente en la rejilla.
 */

import type { Ctx } from './estructura';
import { clamp } from './prng';
import { GM, HUMANIZACION_SD_MS, type EventoPitchBend, type NotaWorship, type RolWorship } from './tipos';
import type { NotaBruta } from './util-gen';

const MIN_DUR = 1 / 64;
const EPS = 0.004;

/** Media y desviación (ms a humanizacion = 1) del micro-timing. */
export function paramsTiming(rol: RolWorship, pitch: number): { media: number; sd: number } {
  if (rol === 'bateria') {
    if (pitch === GM.bombo) return { media: 0, sd: 3.5 };
    if (pitch === GM.caja || pitch === GM.rim) return { media: 9, sd: 5.5 };
    if (pitch === GM.hhCerrado || pitch === GM.hhAbierto || pitch === GM.hhPie) return { media: 2, sd: 5 };
    return { media: 4, sd: HUMANIZACION_SD_MS.bateria };
  }
  const media: Record<string, number> = { piano: 0, pad: 8, cuerdas: 10, bajo: 2, guitarra: 2, melodia: 4 };
  return { media: media[rol] ?? 0, sd: HUMANIZACION_SD_MS[rol] };
}

const SD_VEL: Record<RolWorship, number> = { piano: 3.5, pad: 2.5, cuerdas: 2.5, bajo: 3, bateria: 4.5, guitarra: 3, melodia: 3 };

export function humanizarRol(rol: RolWorship, brutas: NotaBruta[], ctx: Ctx): { notas: NotaWorship[]; bends: EventoPitchBend[] } {
  const rng = ctx.rng(`hum:${rol}`);
  const h = ctx.humanizacion;
  const msABeats = ctx.bpm / 60000;
  const bpc = ctx.bpc;

  // Strum por grupo (piano / guitarra).
  const strum = new Map<number, number>();
  if ((rol === 'piano' || rol === 'guitarra') && h > 0) {
    const grupos = new Map<number, number[]>();
    brutas.forEach((n, i) => {
      if (n.grupo === undefined) return;
      const l = grupos.get(n.grupo) ?? [];
      l.push(i);
      grupos.set(n.grupo, l);
    });
    for (const idxs of grupos.values()) {
      const gap = (5 + 20 * Math.pow(rng.next(), 1.5)) * h * (rol === 'guitarra' ? 1 : 0.55);
      const abajo = rng.prob(0.7);
      const orden = [...idxs].sort((a, b) => (abajo ? brutas[a]!.pitch - brutas[b]!.pitch : brutas[b]!.pitch - brutas[a]!.pitch));
      orden.forEach((i, k) => strum.set(i, k * gap));
    }
  }

  const res: NotaWorship[] = [];
  brutas.forEach((n, i) => {
    const esGracia = n.articulacion === 'flam-gracia';
    const { media, sd } = paramsTiming(rol, n.pitch);
    const z = rng.gauss(2.2);
    const zv = rng.gauss(2.2);
    const zd = rng.gauss(2.2);
    const desfaseMs = esGracia ? 0 : h * (media + sd * z);
    const strumMs = strum.get(i) ?? 0;

    let rub = 0;
    if (ctx.rubato && h > 0) {
      const sec = ctx.seccionDeCompas(Math.floor(n.inicio / bpc + 1e-9));
      const prog = clamp((n.inicio - sec.inicioBeat) / sec.duracionBeats, 0, 1);
      if (sec.tipo === 'intro') rub = 0.03 * h * Math.sin(Math.PI * prog);
      else if (sec.tipo === 'outro') rub = 0.1 * h * prog * prog;
    }

    const inicio = Math.max(0, n.inicio + (desfaseMs + strumMs) * msABeats + rub);

    const compasFrac = (n.inicio / bpc) % 4;
    const arco = Math.sin(Math.PI * (compasFrac / 4));
    let v = n.velocidad + h * (4 * arco + SD_VEL[rol] * zv);
    if (n.articulacion === 'fantasma') v = clamp(v, 14, 44);
    const velocidad = Math.round(clamp(v, 1, 127));

    let duracion = n.duracion;
    if (!n.fija) duracion = n.duracion * (1 + 0.05 * h * zd);
    duracion = Math.max(duracion, MIN_DUR);

    const nota: NotaWorship = { pitch: n.pitch, inicio, duracion, velocidad };
    if (n.bend !== undefined) nota.bend = n.bend;
    if (n.articulacion) nota.articulacion = n.articulacion;
    nota.desfaseMs = Math.round(desfaseMs * 100) / 100 + 0;
    if (strumMs > 0) nota.strumMs = Math.round(strumMs * 100) / 100;
    res.push(nota);
  });

  const notas = limpiarSolapes(res, rol === 'bajo' || rol === 'melodia');
  const bends: EventoPitchBend[] = [];
  if (rol === 'guitarra') {
    for (const n of notas) {
      if (n.bend === undefined) continue;
      bends.push({ inicio: r5(n.inicio), semitonos: n.bend });
      bends.push({ inicio: r5(n.inicio + Math.min(0.5, n.duracion * 0.4)), semitonos: 0 });
    }
  }
  return { notas, bends };
}

const r5 = (x: number) => Math.round(x * 100000) / 100000;

/** Ordena y elimina solapes: monofónico = ninguna nota solapa; polifónico = ninguna con el mismo pitch. */
export function limpiarSolapes(notas: NotaWorship[], mono: boolean): NotaWorship[] {
  const ord = [...notas].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch);
  const grupos = mono ? [ord] : [...agruparPorPitch(ord).values()];
  for (const lista of grupos) {
    for (let i = 0; i < lista.length - 1; i++) {
      const a = lista[i]!;
      const b = lista[i + 1]!;
      if (b.inicio - a.inicio < MIN_DUR + EPS) {
        b.inicio = a.inicio + MIN_DUR + EPS;
        a.duracion = MIN_DUR + 1e-4;
        continue;
      }
      if (a.inicio + a.duracion > b.inicio - EPS) a.duracion = b.inicio - EPS - a.inicio;
    }
  }
  for (const n of ord) {
    n.inicio = r5(n.inicio);
    n.duracion = Math.max(r5(n.duracion), r5(MIN_DUR + 1e-4));
  }
  return ord.sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch);
}

function agruparPorPitch(ord: NotaWorship[]): Map<number, NotaWorship[]> {
  const m = new Map<number, NotaWorship[]>();
  for (const n of ord) {
    const l = m.get(n.pitch) ?? [];
    l.push(n);
    m.set(n.pitch, l);
  }
  return m;
}
