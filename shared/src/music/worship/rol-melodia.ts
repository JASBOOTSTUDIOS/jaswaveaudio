/**
 * Melodía cantable: frases de 2 compases derivadas de la armonía. Verso en forma AA'BA'' (notas del acorde en
 * tiempos fuertes, grados conjuntos, saltos de 3ª-5ª en el clímax, respiraciones); coro en registro alto con un
 * gancho de 2 compases que se repite y se transforma. Rango 62-81 (D4-A5). Monofónica.
 */

import { escaleraDeEscala } from './armonia';
import type { Ctx } from './estructura';
import { clamp } from './prng';
import type { Rng } from './prng';
import { vel, type NotaBruta } from './util-gen';

type Celda = Array<[number, number]>;

const INI_VERSO: Celda[] = [
  [[0, 1.5], [1.5, 0.5], [2, 2]],
  [[0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5]],
  [[0, 1], [1, 1], [2, 1], [3, 1]],
  [[0, 2], [2, 1], [3, 0.5], [3.5, 0.5]],
];
const FIN_VERSO: Celda[] = [
  [[0, 1.5], [1.5, 0.5], [2, 1.5]],
  [[0, 1], [1, 1], [2, 1.5]],
  [[0, 2.5]],
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5]],
];
const INI_B: Celda[] = [
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]],
  [[0, 1], [1, 1], [2, 2]],
  [[0.5, 1], [1.5, 0.5], [2, 1], [3, 1]],
];
const FIN_B: Celda[] = [
  [[0, 2], [2, 1]],
  [[0, 1.5], [1.5, 1.5]],
  [[0, 1], [1, 1], [2, 1]],
];
const HOOK_INI: Celda[] = [
  [[0, 1], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 1.5], [2.5, 1.5]],
  [[0, 1.5], [1.5, 1.5], [3, 1]],
  [[0.5, 1], [1.5, 0.5], [2, 2]],
];
const HOOK_FIN: Celda[] = [
  [[0, 3]],
  [[0, 1.5], [1.5, 0.5], [2, 1.5]],
  [[0, 2], [2, 1]],
];
const PRE_INI: Celda[] = [
  [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2]],
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
];
const PRE_FIN: Celda[] = [
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5]],
  [[0, 1], [1, 1], [2, 1.5]],
];
const PUENTE_INI: Celda[] = [[[0, 2], [2, 2]], [[0, 3]], [[0, 1.5], [1.5, 2.5]]];
const PUENTE_FIN: Celda[] = [[[0, 2], [2, 1.5]], [[0, 3]], [[0, 1], [1, 1], [2, 1.5]]];

type Contorno = 'arco' | 'sube' | 'baja' | 'onda';

interface NotaFrase {
  off: number;
  dur: number;
  fuerte: boolean;
}

interface PlantillaFrase {
  cells: Celda[];
  deltas: number[];
}

function aplanar(cells: Celda[], bpc: number): NotaFrase[] {
  const r: NotaFrase[] = [];
  cells.forEach((c, k) => {
    for (const [on, dur] of c) {
      if (on >= bpc - 1e-9) continue;
      const fuerteCada = bpc === 4 ? 2 : 1.5;
      r.push({ off: k * bpc + on, dur: Math.min(dur, bpc - on), fuerte: on % fuerteCada === 0 });
    }
  });
  return r;
}

function contornoFn(c: Contorno, x: number): number {
  switch (c) {
    case 'arco': return Math.sin(Math.PI * x);
    case 'sube': return x;
    case 'baja': return 1 - x;
    case 'onda': return Math.sin(2 * Math.PI * x) * 0.8;
  }
}

function generarDeltas(rng: Rng, n: number, contorno: Contorno, amp: number, climax: boolean): number[] {
  const deltas: number[] = [0];
  let pos = 0;
  const kClimax = Math.max(1, Math.floor(n * 0.6));
  for (let i = 1; i < n; i++) {
    const objetivo = Math.round(amp * contornoFn(contorno, i / Math.max(1, n - 1)));
    const diff = objetivo - pos;
    let paso: number;
    if (climax && i === kClimax) {
      paso = rng.pick([2, 3, 4]);
    } else if (diff === 0) {
      paso = rng.pick([0, 0, 1, -1, 1, -1]);
    } else {
      const m = rng.prob(0.72) ? 1 : 2;
      paso = Math.sign(diff) * Math.min(Math.abs(diff), m);
      if (rng.prob(0.15)) paso = 0;
    }
    deltas.push(paso);
    pos += paso;
  }
  return deltas;
}

export function generarMelodia(ctx: Ctx): NotaBruta[] {
  const rng = ctx.rng('melodia');
  const bpc = ctx.bpc;
  const escalera = escaleraDeEscala(ctx.tonal, 62, 81);
  const N = escalera.length;
  const out: NotaBruta[] = [];

  const plantillaFrase = (cells: Celda[], contorno: Contorno, amp: number, climax: boolean): PlantillaFrase => {
    const n = aplanar(cells, bpc).length;
    return { cells, deltas: generarDeltas(rng, n, contorno, amp, climax) };
  };

  const pcsFuertes = (t: number): Set<number> => {
    const a = ctx.eventoEn(t).acorde;
    const f = a.tonos.filter((x) => ['r', '3', '5', '4', '2'].includes(x.fn)).map((x) => x.pc);
    return new Set(f.length > 0 ? f : a.pcs);
  };

  const snap = (i: number, pcs: Set<number>, centro: number): number => {
    const ii = clamp(i, 0, N - 1);
    for (let d = 0; d < N; d++) {
      const a = ii - d;
      const b = ii + d;
      const cand = [a, b].filter((x) => x >= 0 && x < N && pcs.has(escalera[x]! % 12));
      if (cand.length === 1) return cand[0]!;
      if (cand.length === 2) return Math.abs(a - centro) <= Math.abs(b - centro) ? a : b;
    }
    return ii;
  };

  /** Renderiza una frase en el tiempo absoluto t0. */
  const frase = (
    t0: number,
    tpl: PlantillaFrase,
    centro: number,
    opc: { mut?: number; finalEstable?: 'raiz' | 'chord'; nivel: number; saltoFinal?: number; limite: number },
  ) => {
    const notas = aplanar(tpl.cells, bpc);
    const n = notas.length;
    if (n === 0) return;
    const deltas = [...tpl.deltas];
    let mut = opc.mut ?? 0;
    while (mut-- > 0 && n > 2) {
      const k = rng.int(1, n - 2);
      if (!notas[k]!.fuerte) deltas[k] = deltas[k]! + rng.pick([-1, 1]);
      else if (k + 1 < n) deltas[k + 1] = deltas[k + 1]! + rng.pick([-1, 1]);
    }
    if (opc.saltoFinal) deltas[n - 1] = deltas[n - 1]! + opc.saltoFinal;
    const idxs: number[] = [];
    let pos = clamp(centro + deltas[0]!, 0, N - 1);
    idxs.push(pos);
    for (let i = 1; i < n; i++) {
      pos = clamp(pos + deltas[i]!, 0, N - 1);
      idxs.push(pos);
    }
    const longitud = tpl.cells.length * bpc;
    for (let i = 0; i < n; i++) {
      const nf = notas[i]!;
      const t = t0 + nf.off;
      if (t >= opc.limite - 1e-9) continue;
      let idx = idxs[i]!;
      const ultima = i === n - 1;
      if (nf.fuerte || ultima) {
        let pcs = pcsFuertes(t);
        if (ultima && opc.finalEstable === 'raiz') {
          const a = ctx.eventoEn(t).acorde;
          pcs = new Set([a.pcs.includes(ctx.tonal.raizPc) ? ctx.tonal.raizPc : a.raizPc]);
        }
        idx = snap(idx, pcs, centro);
        idxs[i] = idx;
      }
      let dur = nf.dur;
      const sig = notas[i + 1];
      if (sig) dur = Math.min(dur, sig.off - nf.off);
      if (ultima) dur = Math.min(dur, longitud - 0.5 - nf.off);
      dur = Math.max(0.25, dur);
      const v = (50 + 44 * opc.nivel) + (nf.fuerte ? 6 : 0) - (ultima ? 5 : 0);
      out.push({ pitch: escalera[idxs[i]!]!, inicio: t, duracion: dur * 0.96, velocidad: vel(v) });
    }
  };

  const idxFrac = (f: number) => Math.round(clamp(f, 0, 1) * (N - 1));

  // Plantillas de la canción (fijadas por semilla; las repeticiones las transforman).
  const tplA = plantillaFrase([rng.pick(INI_VERSO), rng.pick(FIN_VERSO)], 'arco', 2, false);
  const tplB = plantillaFrase([rng.pick(INI_B), rng.pick(FIN_B)], 'sube', 3, true);
  const tplH = plantillaFrase([rng.pick(HOOK_INI), rng.pick(HOOK_FIN)], 'arco', 3, true);
  const tplP = plantillaFrase([rng.pick(PRE_INI), rng.pick(PRE_FIN)], 'sube', 3, false);
  const tplU = plantillaFrase([rng.pick(PUENTE_INI), rng.pick(PUENTE_FIN)], 'sube', 2, false);

  for (const sec of ctx.secciones) {
    if (!sec.roles.includes('melodia')) continue;
    const entrada = sec.entradas.melodia!;
    const rep = sec.repeticion;
    for (let b = 0; b < sec.compases; b += 2) {
      if (b < entrada) continue;
      const limite = (sec.inicioCompas + sec.compases) * bpc;
      const t0 = (sec.inicioCompas + b) * bpc;
      const nivel = sec.intensidadPorCompas[Math.min(b, sec.compases - 1)]!;
      const k = (b / 2) % 4;
      const k2 = Math.floor(b / 8); // bloque de 8 compases
      switch (sec.tipo) {
        case 'coro':
        case 'coroFinal': {
          const final = sec.tipo === 'coroFinal';
          const base = idxFrac((final ? 0.78 : 0.7) + (rep > 0 ? 0.04 : 0) + (final ? 0.06 * k2 : 0));
          const centros = [0, 1, 2, 0].map((x) => base + x);
          const tplLocal: PlantillaFrase = tplH;
          frase(t0, tplLocal, centros[k]!, {
            nivel,
            limite,
            mut: k === 0 ? (rep > 0 ? 1 : 0) : k === 1 ? 1 : k === 2 ? 2 : rep > 0 ? 1 : 0,
            finalEstable: k === 3 ? 'raiz' : undefined,
            saltoFinal: k === 2 ? 1 : 0,
          });
          break;
        }
        case 'precoro': {
          const base = idxFrac(0.45 + 0.08 * ((b / 2) % 2));
          frase(t0, tplP, base, { nivel, mut: rep, limite });
          break;
        }
        case 'puente': {
          const base = idxFrac(0.5 + 0.35 * (b / Math.max(1, sec.compases - 2)));
          frase(t0, tplU, base, { nivel, mut: 0, limite });
          break;
        }
        default: {
          // verso (y cualquier otro tipo): AA'BA''
          const base = idxFrac(0.36 + (rep > 0 ? 0.05 : 0));
          if (k === 0) frase(t0, tplA, base, { nivel, mut: rep > 0 ? 1 : 0, limite });
          else if (k === 1) frase(t0, tplA, base, { nivel, mut: 1, saltoFinal: -1, limite });
          else if (k === 2) frase(t0, tplB, base + 2, { nivel, mut: 0, limite });
          else frase(t0, tplA, base, { nivel, mut: 1 + rep, finalEstable: 'raiz', limite });
        }
      }
    }
  }
  return out;
}
