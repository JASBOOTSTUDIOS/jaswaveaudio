/** Pad: acordes largos sus/add9 en registro alto, cambios suaves con notas comunes ligadas (sin re-ataques innecesarios). */

import { elegirVoces, type Acorde } from './armonia';
import type { Ctx } from './estructura';
import { Acum, vel, type NotaBruta } from './util-gen';

/** Pitch class de la novena (segundo grado sobre la fundamental) respetando la escala. */
export function pcNovena(ctx: Ctx, a: Acorde): number {
  const n9 = a.tonos.find((t) => t.fn === '9' || t.fn === '2');
  if (n9) return n9.pc;
  return (ctx.tonal.raizPc + ctx.tonal.escala[(a.spec.grado + 1) % 7]!) % 12;
}

export function generarPad(ctx: Ctx): NotaBruta[] {
  const rng = ctx.rng('pad');
  const out = new Acum();
  const activas = new Map<number, NotaBruta>();
  let prev: number[] | null = null;
  const ultimo = ctx.eventos[ctx.eventos.length - 1];

  for (const ev of ctx.eventos) {
    const sec = ctx.secciones[ev.seccion]!;
    const entrada = sec.entradas.pad;
    if (entrada === undefined) {
      activas.clear();
      prev = null;
      continue;
    }
    const entradaBeat = sec.inicioBeat + entrada * ctx.bpc;
    const t = Math.max(ev.inicio, entradaBeat);
    if (t >= ev.fin - 1e-9) {
      activas.clear();
      continue;
    }
    const a = ev.acorde;
    const r = a.tonos.find((x) => x.fn === 'r')!.pc;
    const quinta = a.tonos.find((x) => x.fn === '5')!.pc;
    const tercera = a.tonos.find((x) => x.fn === '3' || x.fn === '4' || x.fn === '2')?.pc;
    const extra = rng.prob(0.5) ? pcNovena(ctx, a) : tercera ?? pcNovena(ctx, a);
    const pcs = [...new Set([r, quinta, extra])];
    const voces = elegirVoces(pcs, [62, 86], prev, 74);
    prev = voces;

    const compas = Math.floor(t / ctx.bpc + 1e-9);
    const nivel = ctx.intensidadEn(compas);
    const entrando = Math.abs(t - entradaBeat) < 1e-9 && activas.size === 0;
    const base = (30 + 40 * nivel) * (entrando ? 0.7 : 1);
    const esFinal = ev === ultimo;
    const finNota = ev.fin + (esFinal ? 4 : 0.3);
    const nuevas = new Set(voces);

    for (const [p, nota] of [...activas]) {
      if (nuevas.has(p)) {
        nota.duracion = finNota - nota.inicio; // nota común: se mantiene
      } else {
        nota.duracion = Math.max(0.1, t + 0.25 - nota.inicio);
        activas.delete(p);
      }
    }
    voces.forEach((p, i) => {
      if (activas.has(p)) return;
      const nota: NotaBruta = {
        pitch: p,
        inicio: t,
        duracion: finNota - t,
        velocidad: vel(base * (0.9 + 0.06 * i)),
      };
      out.notas.push(nota);
      activas.set(p, nota);
    });
  }
  return out.notas;
}
