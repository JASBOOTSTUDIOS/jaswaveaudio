/** Cuerdas: notas largas con voice-leading en pre-coro/coro/puente, arcos de 2 compases con crescendo y contramelodía en el coro final. */

import { elegirVoces } from './armonia';
import type { Ctx } from './estructura';
import { Acum, vel, type NotaBruta } from './util-gen';

export function generarCuerdas(ctx: Ctx): NotaBruta[] {
  const rng = ctx.rng('cuerdas');
  const out = new Acum();
  const bpc = ctx.bpc;
  let prev: number[] | null = null;
  let cp = 74; // última nota de la contramelodía
  let dir = rng.prob(0.5) ? 1 : -1;

  for (const ev of ctx.eventos) {
    const sec = ctx.secciones[ev.seccion]!;
    const entrada = sec.entradas.cuerdas;
    if (entrada === undefined) {
      prev = null;
      continue;
    }
    const entradaBeat = sec.inicioBeat + entrada * bpc;
    const ini = Math.max(ev.inicio, entradaBeat);
    if (ini >= ev.fin - 1e-9) continue;

    // Voicing de 3-4 voces (sin la fundamental grave: la lleva el bajo) con movimiento mínimo.
    const a = ev.acorde;
    const pcs = a.tonos.map((t) => t.pc);
    // Máx. 3 voces de acorde (sin la quinta en acordes de 4 notas): la contramelodía hace la cuarta.
    const pcsVoz = a.tonos.length > 3 ? a.tonos.filter((t) => t.fn !== '5').map((t) => t.pc) : pcs;
    const voces = elegirVoces(pcsVoz, [55, 79], prev, 66);
    prev = voces;

    // Arcos: segmentos de hasta 2 compases; cada arco re-ataca con velocidad creciente.
    for (let t = ini; t < ev.fin - 1e-9; t += 2 * bpc) {
      const fin = Math.min(ev.fin, t + 2 * bpc);
      const compas = Math.floor(t / bpc + 1e-9);
      const nivel = ctx.intensidadEn(compas);
      const entrando = t === entradaBeat;
      const base = (26 + 52 * nivel) * (entrando ? 0.75 : 1);
      const esFinal = ev === ctx.eventos[ctx.eventos.length - 1];
      voces.forEach((p, i) => {
        out.add(p, t, fin - t + (esFinal ? 3 : 0.12), vel(base * (0.88 + 0.05 * i)));
      });
    }

    // Contramelodía en el coro final: una nota por mitad de compás, movimiento por tonos del acorde.
    if (sec.tipo === 'coroFinal') {
      const paso = bpc / 2;
      for (let t = ini; t < ev.fin - 1e-9; t += paso) {
        const compasLocal = Math.floor((t - sec.inicioBeat) / bpc + 1e-9);
        if (compasLocal % 2 === 0 && Math.abs(((t - sec.inicioBeat) / bpc) % 1) < 1e-9) dir = -dir;
        const lo = compasLocal >= 8 ? 72 : 67;
        const candidatos: number[] = [];
        for (let p = lo; p <= 84; p++) if (pcs.includes(p % 12)) candidatos.push(p);
        const meta = cp + dir * 3;
        let mejor = candidatos[0]!;
        let d = Infinity;
        for (const p of candidatos) {
          if ((p === cp || voces.includes(p)) && candidatos.length > 1) continue;
          const dd = Math.abs(p - meta);
          if (dd < d) {
            d = dd;
            mejor = p;
          }
        }
        cp = mejor;
        const nivel = ctx.intensidadEn(Math.floor(t / bpc + 1e-9));
        const dur = Math.min(paso, ev.fin - t) + 0.1;
        out.add(mejor, t, dur, vel(40 + 48 * nivel));
      }
    }
  }
  return out.notas;
}
