/**
 * Piano orgánico de worship: arpegios espaciados con pedal (intro/outro), acordes rotos con respiración (verso),
 * bloques que crecen (pre-coro), acordes abiertos de quinta que alternan con arpegios de corcheas (coro) y
 * un puente de tensión que se vacía antes del coro final.
 * Registro: mano izquierda en [PIANO_LH_MIN, PIANO_LH_MAX] (siempre por encima del bajo, que tiene tope en
 * BAJO_MAX_PITCH), mano derecha en C4-C6; a lo sumo PIANO_MAX_VOCES notas por ataque.
 */

import { encadenarVoces, pitchCercano } from './armonia';
import type { Ctx, EventoAcorde } from './estructura';
import { BAJO_MAX_PITCH } from './rol-bajo';
import { Acum, compasesActivos, elegirDistinto, segmentosDeCompas, vel, type NotaBruta } from './util-gen';

type Paso = number | null; // -1 = bajo (mano izquierda), 0.. = voz de la mano derecha

/** Mano izquierda: nunca en la octava del bajo (el bajo llega como mucho a BAJO_MAX_PITCH). */
export const PIANO_LH_MIN = BAJO_MAX_PITCH + 6;
export const PIANO_LH_MAX = 56;
/** Máximo de notas que el piano ataca a la vez. */
export const PIANO_MAX_VOCES = 4;

const PATRONES_VERSO: Paso[][] = [
  [-1, 0, 1, 2, 1, 0, 1, 2],
  [-1, null, 1, 2, null, 1, 2, 1],
  [-1, 2, 1, 2, 0, 2, 1, 2],
  [-1, 0, null, 2, 1, null, 2, 1],
  [-1, 1, 2, 1, 0, 1, 2, 3],
];
/** Compás de respiración (cierre de frase de 8): la mano izquierda y apenas dos notas de la derecha. */
const PATRON_RESPIRO: Paso[] = [-1, null, null, 2, null, null, 1, null];

const ACENTOS = [
  [1, 0.7, 0.8, 0.7, 0.9, 0.7, 0.8, 0.7],
  [1, 0.6, 0.7, 0.6, 0.85, 0.6, 0.95, 0.65],
  [1, 0.7, 0.85, 0.7, 0.8, 0.7, 0.7, 0.9],
];

const PATRONES_INTRO: Array<Array<[number, number]>> = [
  [[0, -1], [1, 0], [2, 1], [3, 2]],
  [[0, -1], [1.5, 1], [2.5, 2]],
  [[0, -1], [1, 1], [2, 0], [2.5, 2], [3.5, 1]],
  [[0, -1], [0.5, 0], [1.5, 2], [3, 1]],
];

/** Golpes de acorde del coro (≤ 3 por compás): [inicio, acento]. El resto lo llena el arpegio o el pedal. */
const STABS_CORO: Array<Array<[number, number]>> = [
  [[0, 1], [1.5, 0.75], [2.5, 0.85]],
  [[0, 1], [2, 0.8], [3.5, 0.7]],
  [[0, 1], [1, 0.6], [2.5, 0.85]],
  [[0, 1], [1.5, 0.8], [3, 0.7]],
];
/** Arpegios de corcheas del coro sobre las 3 voces superiores de la mano derecha (índices 0..2). */
const ARPEGIOS_CORO: number[][] = [
  [0, 1, 2, 1, 0, 1, 2, 1],
  [0, 2, 1, 2, 0, 2, 1, 2],
  [0, 1, 2, 2, 1, 2, 1, 0],
];

export function generarPiano(ctx: Ctx): NotaBruta[] {
  const rng = ctx.rng('piano');
  const out = new Acum();
  const acordes = ctx.eventos.map((e) => e.acorde);
  const rh = encadenarVoces(acordes, { rango: [60, 84], centro: 70, voces: 4 });
  const bpc = ctx.bpc;
  const cpc = ctx.cpc;

  const bajoLH = (ev: EventoAcorde) => pitchCercano(ev.acorde.bajoPc, 50, PIANO_LH_MIN, PIANO_LH_MAX);
  const voz = (v: number[], i: number) => {
    if (i < v.length) return v[i]!;
    const p = v[i - v.length]! + 12;
    return p <= 84 ? p : v[v.length - 1]!;
  };

  /**
   * Golpe simultáneo (acorde): mano izquierda (fundamental, o fundamental + quinta abierta) + mano derecha;
   * nunca más de PIANO_MAX_VOCES notas. El strum se aplica por grupo.
   */
  const golpe = (t: number, ev: EventoAcorde, dur: number, v: number, o: { abierto?: boolean; octRH?: boolean; voces?: number } = {}) => {
    const g = out.nuevoGrupo();
    const rhv = rh[ev.idx]!;
    const usadas = new Set<number>();
    const bajo = bajoLH(ev);
    out.add(bajo, t, dur, vel(v), { grupo: g });
    usadas.add(bajo);
    let lh = 1;
    // Quinta abierta diatónica del acorde (con bajo invertido, bajo+7 no sería de la escala).
    const q = ev.acorde.tonos.find((x) => x.fn === '5');
    if (o.abierto && q && q.pc !== ev.acorde.bajoPc) {
      const p5 = pitchCercano(q.pc, bajo + 7, bajo + 3, bajo + 10);
      if (p5 <= 64) {
        out.add(p5, t, dur, vel(v * 0.85), { grupo: g });
        usadas.add(p5);
        lh++;
      }
    }
    const cupo = PIANO_MAX_VOCES - lh - (o.octRH ? 1 : 0);
    const n = Math.max(1, Math.min(o.voces ?? rhv.length, cupo));
    const sel = rhv.slice(rhv.length - n);
    sel.forEach((p, i) => {
      if (usadas.has(p)) return;
      out.add(p, t, dur, vel(v * (0.82 + 0.05 * (i === sel.length - 1 ? 1 : 0))), { grupo: g });
      usadas.add(p);
    });
    if (o.octRH) {
      const top = sel[sel.length - 1]! + 12;
      if (top <= 84 && !usadas.has(top)) out.add(top, t, dur, vel(v * 0.7), { grupo: g });
    }
  };

  let prevIntro = -1;
  let contCoro = rng.int(0, STABS_CORO.length - 1);
  const baseVerso = rng.int(0, PATRONES_VERSO.length - 1);

  for (const sec of ctx.secciones) {
    if (!sec.roles.includes('piano')) continue;
    const rep = sec.repeticion;
    let patCoroActual = 0;
    for (const { b, g, t0, nivel } of compasesActivos(ctx, sec, 'piano')) {
      const segs = segmentosDeCompas(ctx, g);
      const progreso = sec.compases > 1 ? b / (sec.compases - 1) : 1;
      const finBarra = t0 + bpc;
      const siguiente = segs.length > 0 ? ctx.siguienteEvento(segs[segs.length - 1]!.ev) : undefined;
      const esFinGrupo = b % 4 === 3;

      switch (sec.tipo) {
        case 'intro':
        case 'outro': {
          const ultimoOutro = sec.tipo === 'outro' && b === sec.compases - 1;
          const base = 28 + 38 * nivel;
          if (ultimoOutro) {
            const ev = segs[0]!.ev;
            golpe(t0, ev, bpc + 3, base * 1.05, { abierto: true, voces: 2 });
            break;
          }
          prevIntro = elegirDistinto(rng, PATRONES_INTRO.length, prevIntro);
          for (const [o, voice] of PATRONES_INTRO[prevIntro]!) {
            if (o >= bpc) continue;
            const t = t0 + o;
            const ev = ctx.eventoEn(t);
            const dur = finBarra - t + 1.5;
            const v = base * (voice === -1 ? 1.05 : 0.85 + rng.rango(-0.05, 0.1));
            if (voice === -1) {
              out.add(bajoLH(ev), t, bpc + 1, vel(v));
            } else {
              out.add(voz(rh[ev.idx]!, voice), t, dur, vel(v));
            }
          }
          break;
        }
        case 'verso': {
          const pat = b % 8 === 7 && nivel < 0.7 ? PATRON_RESPIRO : PATRONES_VERSO[(baseVerso + rep * 2 + (b >> 2)) % PATRONES_VERSO.length]!;
          const acentos = ACENTOS[rng.int(0, ACENTOS.length - 1)]!;
          const base = 36 + 44 * nivel;
          for (let s = 0; s < cpc; s++) {
            const paso = pat[s];
            if (paso === null || paso === undefined) continue;
            const t = t0 + s * 0.5;
            const ev = ctx.eventoEn(t);
            const seg = segs.find((x) => t >= x.ini - 1e-9 && t < x.fin - 1e-9) ?? segs[0]!;
            const dur = Math.min(seg.fin - t + 0.3, 3.2);
            const v = base * acentos[s % 8]!;
            if (paso === -1) out.add(bajoLH(ev), t, Math.min(seg.fin - t + 0.6, 4), vel(v * 1.05));
            else out.add(voz(rh[ev.idx]!, paso), t, dur, vel(v));
          }
          // anticipación al final de grupo: último octavo anuncia el acorde siguiente
          if (esFinGrupo && siguiente && rng.prob(0.55)) {
            const t = finBarra - 0.5;
            out.add(voz(rh[siguiente.idx]!, 1), t, 1.2, vel(base * 0.8));
          }
          break;
        }
        case 'precoro': {
          const base = 40 + 46 * nivel;
          // crece: 2 golpes → 3 sincopados → 4 negras
          const offs = progreso < 0.34 ? (bpc === 4 ? [0, 2] : [0, 1.5]) : progreso < 0.67 ? (bpc === 4 ? [0, 1.5, 2.5] : [0, 1.5, 2]) : bpc === 4 ? [0, 1, 2, 3] : [0, 1, 2];
          offs.forEach((o, i) => {
            const t = t0 + o;
            const ev = ctx.eventoEn(t);
            const siguienteO = offs[i + 1] ?? bpc;
            golpe(t, ev, siguienteO - o + 0.2, base * (o === 0 ? 1 : 0.82), { abierto: o === 0, voces: 3 });
          });
          break;
        }
        case 'coro':
        case 'coroFinal': {
          const grupo = b >> 2;
          if (b % 4 === 0) {
            patCoroActual = (contCoro + rep) % STABS_CORO.length;
            contCoro++;
          }
          const arpegioGrupo = (grupo + rep) % 2 === 1; // alterna cada 4 compases: bloques / arpegios
          const base = 44 + 56 * nivel;
          const grande = sec.tipo === 'coroFinal' && b >= 8;
          if (arpegioGrupo && !esFinGrupo) {
            // acorde abierto sostenido (izquierda + 2 voces) y arpegio de corcheas encima, con respiraciones
            golpe(t0, ctx.eventoEn(t0), bpc + 0.3, base, { abierto: true, voces: 2 });
            const orden = ARPEGIOS_CORO[(patCoroActual + rep) % ARPEGIOS_CORO.length]!;
            for (let s = 1; s < cpc; s++) {
              if (rng.prob(0.12)) continue;
              const t = t0 + s * 0.5;
              const top = rh[ctx.eventoEn(t).idx]!.slice(-3);
              const p = top[orden[s % orden.length]! % top.length]!;
              out.add(p, t, 1.1, vel(base * (s % 2 === 0 ? 0.72 : 0.6)));
            }
            break;
          }
          const stabs = STABS_CORO[patCoroActual]!.filter(([o]) => o < bpc);
          stabs.forEach(([o, acento], i) => {
            const t = t0 + o;
            let ev = ctx.eventoEn(t);
            const ultimo = i === stabs.length - 1;
            if (ultimo && esFinGrupo && siguiente && o >= bpc - 0.75 && rng.prob(0.5)) ev = siguiente; // anticipación en el «y» del 4
            const prox = stabs[i + 1]?.[0] ?? bpc;
            const dur = Math.max(0.5, prox - o) + (prox === bpc ? 0.3 : 0.1);
            const entero = o === 0 && b % 4 === 0;
            golpe(t, ev, dur, base * acento, {
              abierto: o === 0 || (nivel > 0.8 && acento >= 0.85),
              octRH: entero || grande,
              voces: 3,
            });
          });
          break;
        }
        case 'puente': {
          const base = 30 + 80 * nivel;
          if (b === sec.compases - 1) {
            // vacío dinámico antes del coro final: una nota grave suave y silencio
            out.add(bajoLH(ctx.eventoEn(t0)), t0, 1.5, vel(base * 0.6));
            break;
          }
          if (progreso < 0.5) {
            // tensión contenida: acordes en blancas con pedal
            [0, 2].forEach((o) => {
              if (o >= bpc) return;
              golpe(t0 + o, ctx.eventoEn(t0 + o), 2.1, base * (o === 0 ? 1 : 0.8), { abierto: o === 0, voces: 3 });
            });
          } else {
            // crece: acorde en el 1 y arpegio ascendente de corcheas (notas sueltas, no bloques)
            golpe(t0, ctx.eventoEn(t0), 1.2, base, { abierto: true, voces: 2 });
            for (let s = 1; s < cpc; s++) {
              const t = t0 + s * 0.5;
              const top = rh[ctx.eventoEn(t).idx]!.slice(-3);
              out.add(top[(s - 1) % top.length]!, t, 0.9, vel(base * (0.55 + 0.35 * progreso) * (s % 2 === 0 ? 1 : 0.85)));
            }
          }
          break;
        }
      }
    }
  }
  return out.notas;
}
