/**
 * Bajo profundo de worship: redondas/blancas sobre la fundamental en el verso (con anticipación en el «y» del 4),
 * negras y síncopas suaves que siguen al bombo en el coro; nunca un pulso continuo de corcheas. Tesitura grave
 * (E1-D#2) para dejar el registro medio al piano. Monofónico.
 */

import { escaleraDeEscala, pitchCercano } from './armonia';
import type { Ctx, EventoAcorde } from './estructura';
import { vel, type NotaBruta } from './util-gen';

type Slot = 'R' | 'O' | 'F' | 'P' | '-' | 'N';

// Patrones por corchea (8 por compás en 4/4). Worship: el bajo es un colchón profundo, no un pulso de sintetizador.
// L0 verso íntimo: redonda sobre la fundamental (a veces con anticipación al acorde siguiente).
const L0: Slot[][] = [['R', '-', '-', '-', '-', '-', '-', '-'], ['R', '-', '-', '-', '-', '-', '-', 'N']];
// L1 verso con más cuerpo: blancas (≤ 3 ataques por compás, contando la anticipación).
const L1: Slot[][] = [
  ['R', '-', '-', '-', 'R', '-', '-', '-'],
  ['R', '-', '-', '-', '-', '-', '-', 'N'],
  ['R', '-', '-', '-', 'R', '-', '-', 'N'],
];
// L2 pre-coro que sube: negras/blancas con pequeñas anticipaciones (≤ 4 ataques).
const L2: Slot[][] = [
  ['R', '-', '-', '-', 'R', '-', '-', 'P'],
  ['R', '-', '-', 'R', '-', '-', 'R', 'N'],
  ['R', '-', 'R', '-', 'R', '-', '-', 'P'],
];
// L3 coro abierto: sigue al bombo, notas largas con síncopas suaves (≤ 4 ataques).
const L3: Slot[][] = [
  ['R', '-', '-', 'R', '-', 'R', '-', 'P'],
  ['R', '-', '-', '-', 'R', '-', 'F', 'P'],
  ['R', '-', 'O', '-', 'R', '-', '-', 'P'],
  ['R', '-', '-', 'R', '-', '-', 'R', 'P'],
];
// L4 clímax (coro final / puente alto): algo más de movimiento, nunca corcheas continuas (≤ 5 ataques).
const L4: Slot[][] = [
  ['R', '-', '-', 'R', '-', 'R', 'O', 'P'],
  ['R', '-', 'R', '-', 'F', 'R', '-', 'P'],
  ['R', '-', 'O', '-', 'R', 'F', '-', 'P'],
];

/** Tope de la tesitura del bajo: la mano izquierda del piano arranca por encima (ver rol-piano). */
export const BAJO_MAX_PITCH = 39;

interface Ataque {
  t: number;
  pitch: number;
  v: number;
  limite: number;
}

export function generarBajo(ctx: Ctx): NotaBruta[] {
  const rng = ctx.rng('bajo');
  const bpc = ctx.bpc;
  const [LO, HI] = [28, BAJO_MAX_PITCH];
  const escalera = escaleraDeEscala(ctx.tonal, 28, BAJO_MAX_PITCH);

  // Pitch del bajo por evento, encadenado por cercanía.
  const bp: number[] = [];
  let prev = 40;
  for (const ev of ctx.eventos) {
    const p = pitchCercano(ev.acorde.bajoPc, prev, LO, HI);
    bp.push(p);
    prev = p;
  }
  const quinta = (ev: EventoAcorde): number => {
    const q = ev.acorde.tonos.find((t) => t.fn === '5');
    const base = bp[ev.idx]!;
    if (!q) return base;
    for (let p = base + 1; p <= base + 12; p++) if (p % 12 === q.pc && p <= BAJO_MAX_PITCH) return p;
    return base;
  };
  const vecino = (pitch: number, arriba: boolean): number => {
    const i = escalera.indexOf(pitch);
    if (i < 0) return pitch;
    const j = arriba ? i + 1 : i - 1;
    return escalera[j] ?? escalera[i - (j - i)] ?? pitch;
  };
  const activoEn = (beat: number): boolean => {
    const c = Math.floor(beat / bpc + 1e-9);
    if (c >= ctx.totalCompases) return false;
    const s = ctx.seccionDeCompas(c);
    return ctx.activo(s, 'bajo', c - s.inicioCompas);
  };

  const ataques: Ataque[] = [];
  let carryN = false;
  let baseB = rng.int(0, 3);

  for (const sec of ctx.secciones) {
    if (!sec.roles.includes('bajo')) {
      carryN = false;
      continue;
    }
    baseB = (baseB + 1) % 4;
    for (let b = 0; b < sec.compases; b++) {
      if (!ctx.activo(sec, 'bajo', b)) {
        carryN = false;
        continue;
      }
      const g = sec.inicioCompas + b;
      const t0 = g * bpc;
      const nivel = sec.intensidadPorCompas[b]!;
      const p = sec.compases > 1 ? b / (sec.compases - 1) : 1;

      let nivelPat: number;
      switch (sec.tipo) {
        case 'verso': nivelPat = nivel < 0.45 ? 0 : 1; break;
        case 'precoro': nivelPat = p < 0.5 ? 1 : 2; break;
        case 'coro': nivelPat = 3; break;
        case 'coroFinal': nivelPat = b < 4 ? 3 : 4; break;
        case 'puente': nivelPat = nivel < 0.62 ? 1 : nivel < 0.8 ? 2 : nivel < 0.92 ? 3 : 4; break;
        default: nivelPat = 0;
      }
      const lib = [L0, L1, L2, L3, L4][nivelPat]!;
      let pat = lib[(baseB + sec.repeticion + (b >> 2)) % lib.length]!;
      if (ctx.cpc === 6) pat = [...pat.slice(0, 5), pat[7]!];

      for (let s = 0; s < ctx.cpc; s++) {
        const t = t0 + s * 0.5;
        const ev = ctx.eventoEn(t);
        const cambio = Math.abs(t - ev.inicio) < 1e-9;
        let tag: Slot = pat[s]!;
        const raiz = bp[ev.idx]!;
        const siguiente = ctx.siguienteEvento(ev);
        const ultimoSlot = s === ctx.cpc - 1;
        const v0 = 50 + 42 * nivel;

        if (s === 0 && carryN) {
          carryN = false;
          if (cambio) continue; // la anticipación ya suena sobre el tiempo 1
        }
        if (cambio && (tag === '-' || tag === 'F' || tag === 'P' || tag === 'N')) tag = 'R';
        if (tag === 'N') {
          // Anticipación del acorde siguiente en el «y» del 4 (sólo si cambia el bajo y sigue activo).
          const nextT = t0 + bpc;
          const nev = ctx.eventoEn(nextT);
          const ok = ultimoSlot && nev !== ev && Math.abs(nev.inicio - nextT) < 1e-9 && bp[nev.idx] !== raiz && activoEn(nextT) && rng.prob(0.75);
          if (ok) {
            ataques.push({ t, pitch: bp[nev.idx]!, v: vel(v0 - 4), limite: nev.fin });
            carryN = true;
          }
          continue;
        }
        if (tag === '-') continue;
        let pitch = raiz;
        let v = v0;
        if (tag === 'O') pitch = raiz + 12 <= BAJO_MAX_PITCH ? raiz + 12 : quinta(ev);
        else if (tag === 'F') pitch = quinta(ev);
        else if (tag === 'P') {
          const base = siguiente && ultimoSlot ? bp[siguiente.idx]! : raiz;
          pitch = vecino(base, rng.prob(0.5));
          v -= 6;
        } else {
          v += s === 0 ? 6 : 0;
        }
        ataques.push({ t, pitch, v: vel(v), limite: ev.fin });
      }
    }
  }

  const notas: NotaBruta[] = [];
  ataques.sort((a, b) => a.t - b.t);
  ataques.forEach((a, i) => {
    const sig = ataques[i + 1];
    let fin = a.limite;
    if (sig && sig.t < fin) fin = sig.t;
    const esFinal = i === ataques.length - 1;
    if (esFinal) fin = a.limite;
    const dur = Math.max(0.1, fin - a.t - 0.04);
    notas.push({ pitch: a.pitch, inicio: a.t, duracion: dur, velocidad: a.v });
  });
  return notas;
}
