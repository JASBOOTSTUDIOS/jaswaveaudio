/**
 * Guitarra eléctrica limpia: arpegios con feel de delay punteado (corchea con puntillo), acordes abiertos
 * con ring en el coro (quinta + octava + novena) y lead ambient con bends en puente/outro.
 */

import { elegirVoces, pitchCercano, type Acorde } from './armonia';
import type { Ctx, EventoAcorde } from './estructura';
import { pcNovena } from './rol-pad';
import { Acum, compasesActivos, elegirDistinto, vel, type NotaBruta } from './util-gen';

const RITMOS_DELAY: number[][] = [
  [0, 0.75, 1.5, 2.25, 3, 3.75],
  [0, 0.75, 1.5, 2, 2.75, 3.5],
  [0, 0.75, 1.5, 2, 2.75, 3.5, 3.75],
  [0, 0.5, 1.25, 2, 2.5, 3.25],
];
const ORDENES: number[][] = [
  [0, 1, 2, 3, 2, 1],
  [0, 2, 1, 3, 1, 2],
  [1, 0, 2, 1, 3, 2],
  [0, 1, 3, 2, 1, 2],
];
const RASGUEOS: number[][] = [[0, 2], [0, 1.5, 2.5], [0, 1.5, 2], [0, 2.5], [0, 0.75, 2, 3]];

export function generarGuitarra(ctx: Ctx): NotaBruta[] {
  const rng = ctx.rng('guitarra');
  const out = new Acum();
  const bpc = ctx.bpc;
  const acordes = ctx.eventos.map((e) => e.acorde);

  const sel4 = (a: Acorde) => {
    const r = a.tonos.find((t) => t.fn === 'r')!.pc;
    const q = a.tonos.find((t) => t.fn === '5')!.pc;
    const t3 = a.tonos.find((t) => t.fn === '3' || t.fn === '4' || t.fn === '2')?.pc ?? q;
    return [...new Set([r, q, pcNovena(ctx, a), t3])];
  };
  const sel3 = (a: Acorde) => {
    const r = a.tonos.find((t) => t.fn === 'r')!.pc;
    const q = a.tonos.find((t) => t.fn === '5')!.pc;
    return [...new Set([r, q, pcNovena(ctx, a)])];
  };
  const v4 = (() => {
    let prev: number[] | null = null;
    return acordes.map((a) => (prev = elegirVoces(sel4(a), [55, 79], prev, 66)));
  })();
  const v3 = (() => {
    let prev: number[] | null = null;
    return acordes.map((a) => (prev = elegirVoces(sel3(a), [55, 79], prev, 66)));
  })();

  let prevRitmo = -1;
  let prevOrden = -1;
  let prevRasgueo = -1;
  let cur = 76; // lead

  const arpegio = (b: number, t0: number, nivel: number, p: number, sec: { tipo: string }) => {
    const octavos = sec.tipo === 'precoro' && p >= 0.5;
    let onsets: number[];
    if (octavos) {
      onsets = [];
      for (let t = 0; t < bpc; t += 0.5) onsets.push(t);
    } else {
      if (b % 2 === 0) prevRitmo = elegirDistinto(rng, RITMOS_DELAY.length, prevRitmo);
      onsets = RITMOS_DELAY[prevRitmo < 0 ? 0 : prevRitmo]!.filter((o) => o < bpc);
    }
    if (b % 2 === 0) prevOrden = elegirDistinto(rng, ORDENES.length, prevOrden);
    const orden = ORDENES[prevOrden < 0 ? 0 : prevOrden]!;
    const sus = b % 2 === 0 && nivel < 0.7;
    onsets.forEach((o, i) => {
      const t = t0 + o;
      const ev = ctx.eventoEn(t);
      const v = sus ? v3[ev.idx]! : v4[ev.idx]!;
      const pitch = v[orden[i % orden.length]! % v.length]!;
      const sig = onsets[i + 1] ?? bpc + 0.75;
      const dur = Math.min(sig - o + 0.9, 2.6);
      const acento = i === 0 ? 1 : i % 3 === 2 ? 0.78 : 0.9;
      out.add(pitch, t, dur, vel((44 + 40 * nivel) * acento));
    });
  };

  const abierto = (ev: EventoAcorde): number[] => {
    const raiz = pitchCercano(ev.acorde.raizPc, 55, 52, 63);
    const quinta = ev.acorde.tonos.find((t) => t.fn === '5')!.pc;
    const p5 = pitchCercano(quinta, raiz + 7, raiz + 1, raiz + 11);
    const nov = pitchCercano(pcNovena(ctx, ev.acorde), raiz + 14, raiz + 12, 80);
    return [raiz, p5, raiz + 12, nov].filter((x, i, arr) => x <= 84 && arr.indexOf(x) === i);
  };

  const rasgueo = (b: number, t0: number, nivel: number, grande: boolean) => {
    if (b % 4 === 0) prevRasgueo = elegirDistinto(rng, RASGUEOS.length, prevRasgueo);
    const ons = RASGUEOS[prevRasgueo < 0 ? 0 : prevRasgueo]!.filter((o) => o < bpc);
    ons.forEach((o, i) => {
      const t = t0 + o;
      const ev = ctx.eventoEn(t);
      const g = out.nuevoGrupo();
      const prox = ons[i + 1] ?? bpc;
      const dur = Math.min(prox - o + 0.8, 4);
      const base = 50 + 46 * nivel;
      abierto(ev).forEach((p, k) => out.add(p, t, dur, vel(base * (o === 0 ? 1 : 0.85) * (k === 0 ? 1.04 : 0.94)), { grupo: g }));
    });
    if (grande && b % 2 === 1 && !ons.some((o) => o >= bpc - 1.25) && rng.prob(0.5)) {
      // adorno agudo en el último tiempo
      const ev = ctx.eventoEn(t0 + bpc - 1);
      const pcs = ev.acorde.tonos.map((t) => t.pc);
      const altos: number[] = [];
      for (let p = 72; p <= 84; p++) if (pcs.includes(p % 12)) altos.push(p);
      const a = rng.pick(altos);
      const b2 = altos[Math.min(altos.indexOf(a) + 1, altos.length - 1)]!;
      out.add(a, t0 + bpc - 1, 0.5, vel(50 + 40 * nivel));
      out.add(b2, t0 + bpc - 0.5, 1.2, vel(54 + 40 * nivel));
    }
  };

  /**
   * Empuje de guitarra de himno worship: corcheas de quinta + octava (power chord) con acento en las negras y
   * golpes sincopados, mientras otra corchea deja sonar la novena arriba.
   */
  const empuje = (b: number, t0: number, nivel: number, crece: number) => {
    const sinc = b % 2 === 1 && rng.prob(0.5);
    for (let o = 0; o < bpc; o += 0.5) {
      if (sinc && o === 2) continue; // hueco antes del golpe sincopado: el ritmo respira
      const t = t0 + o;
      const ev = ctx.eventoEn(t);
      const raiz = pitchCercano(ev.acorde.raizPc, 55, 52, 63);
      const quinta = ev.acorde.tonos.find((x) => x.fn === '5')!.pc;
      const p5 = pitchCercano(quinta, raiz + 7, raiz + 1, raiz + 11);
      const g = out.nuevoGrupo();
      const acento = Number.isInteger(o) ? 1 : 0.82;
      const v = (54 + 44 * nivel) * acento * (0.85 + 0.15 * crece);
      for (const p of Number.isInteger(o) ? [raiz, p5, raiz + 12] : [raiz, p5]) out.add(p, t, 0.42, vel(v), { grupo: g });
    }
    if (sinc) {
      const t = t0 + 2.25 - 0.25 * Number(bpc < 4);
      const ev = ctx.eventoEn(t);
      const g = out.nuevoGrupo();
      abierto(ev).forEach((p) => out.add(p, t, 1.6, vel(64 + 40 * nivel), { grupo: g }));
    }
  };

  const lead = (b: number, t0: number, nivel: number, ultimoCompas: boolean) => {
    const formas: Array<Array<[number, number]>> = [[[0, 3.5]], [[0, 2], [2.5, 1.5]], [[1, 3]], [], [[0, 1.5], [2, 2]]];
    const f = ultimoCompas ? ([[0, 4]] as Array<[number, number]>) : formas[rng.int(0, formas.length - 1)]!;
    for (const [o, d] of f) {
      if (o >= bpc) continue;
      const t = t0 + o;
      const ev = ctx.eventoEn(t);
      const pcs = [...ev.acorde.tonos.map((x) => x.pc), pcNovena(ctx, ev.acorde)];
      const cand: number[] = [];
      for (let p = 69; p <= 88; p++) if (pcs.includes(p % 12)) cand.push(p);
      const meta = cur + rng.pick([-4, -2, 0, 2, 4]);
      let mejor = cand[0]!;
      let dm = Infinity;
      for (const p of cand) {
        if (p === cur && cand.length > 1 && rng.prob(0.6)) continue;
        const dd = Math.abs(p - meta);
        if (dd < dm) {
          dm = dd;
          mejor = p;
        }
      }
      cur = mejor;
      let bend: number | undefined;
      if (d >= 2 && rng.prob(0.45)) {
        if (ctx.tonal.pcsEscala.has(((mejor - 2) % 12 + 12) % 12)) bend = -2;
        else if (ctx.tonal.pcsEscala.has(((mejor - 1) % 12 + 12) % 12)) bend = -1;
      }
      out.add(mejor, t, Math.min(d, bpc * 2) + 0.6, vel(34 + 40 * nivel), bend !== undefined ? { bend } : {});
    }
  };

  let coros = 0;
  for (const sec of ctx.secciones) {
    if (!sec.roles.includes('guitarra')) continue;
    // la guitarra eléctrica es protagonista: un coro de acordes abiertos que suenan y otro que empuja en corcheas;
    // el coro final mezcla los dos (empuje en la segunda mitad) y el puente crece del lead al empuje
    const empujaCoro = sec.tipo === 'coro' ? coros++ % 2 === 1 || rng.prob(0.35) : false;
    for (const { b, t0, nivel } of compasesActivos(ctx, sec, 'guitarra')) {
      const p = sec.compases > 1 ? b / (sec.compases - 1) : 1;
      switch (sec.tipo) {
        case 'coro':
          if (empujaCoro && bpc === 4) empuje(b, t0, nivel, 1);
          else rasgueo(b, t0, nivel, false);
          break;
        case 'coroFinal':
          if (bpc === 4 && b >= sec.compases / 2) empuje(b, t0, nivel, 1);
          else rasgueo(b, t0, nivel, true);
          break;
        case 'puente':
          if (bpc === 4 && p >= 0.5) empuje(b, t0, nivel, p);
          else lead(b, t0, nivel, false);
          break;
        case 'outro':
          lead(b, t0, nivel, b === sec.compases - 1);
          break;
        default:
          arpegio(b, t0, nivel, p, sec);
      }
    }
  }
  return out.notas;
}
