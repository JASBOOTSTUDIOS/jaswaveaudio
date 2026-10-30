/**
 * Batería GM: groove distinto por sección, builds con toms, fills variados, notas fantasma,
 * flams, silencios deliberados antes de entradas fuertes y variación compás a compás.
 */

import type { Ctx, SeccionInt } from './estructura';
import type { Rng } from './prng';
import { GM, type ArticulacionWorship } from './tipos';
import { Acum, compasesActivos, elegirDistinto, vel, type NotaBruta } from './util-gen';

interface Golpe {
  t: number;
  pitch: number;
  v: number;
  art?: ArticulacionWorship;
}

interface VarSec {
  kick: number[];
  /** Patrón de bombo de la segunda mitad (secciones largas). */
  kick2: number[];
  kickAlt: number;
  hat: 'cuartos' | 'corcheas' | 'semis';
  media: boolean;
  rimEnVerso: boolean;
  abiertos: number[];
  ghostP: number;
  variantePuente: number;
  /** Conducción del coro: hi-hat, tom de suelo en corcheas (himno worship) o ride con campana. */
  conduccion: 'hats' | 'toms' | 'ride';
}

const KICK_VERSO = [[0], [0, 2.5], [0, 1.75, 2.5], [0, 2], [0, 3.5]];
const KICK_CORO = [
  [0, 2, 3.5], [0, 1.5, 2.5], [0, 0.75, 2, 3.5], [0, 1.5, 2, 3.5], [0, 0.75, 1.5, 2.75], [0, 2.5, 3.5],
  [0, 0.75, 1.75, 2.5], [0, 1.75, 2.5, 3.75], [0, 0.5, 2.25, 3.5],
];
const KICK_FINAL = [
  [0, 1.5, 2, 3.5], [0, 0.75, 1.5, 2.5, 3.5], [0, 1, 2, 2.75, 3.5], [0, 0.75, 2, 2.5, 3.5],
  [0, 0.75, 1.75, 2.5, 3.25], [0, 0.5, 1.75, 2.25, 3.5],
];
const ABIERTOS = [[3.5], [1.5, 3.5], [2.5], [1.5, 2.5, 3.5], [0.5, 3.5]];
// Solo los tres toms que comparten el mapa GM y los kits de 3 toms de los VST de batería (BFD Player: 47 tom alto,
// 45 medio, 43 de suelo; en su kit la 41 y la 48 no tienen pieza y la 50 dispara un crash).
const TOM_ALTO = GM.tomMedioAlto;
const TOM_MEDIO = GM.tomMedio;
const TOM_SUELO = GM.tomSuelo;
const TOMS_PUENTE = [
  [TOM_SUELO, TOM_MEDIO],
  [TOM_SUELO, TOM_ALTO],
  [TOM_MEDIO, TOM_ALTO],
];

// Celdas de un tiempo (4 semicorcheas) para fills y solos: 'K' bombo, 0 silencio. Mezclan caja, toms y bombo
// de forma lineal (una sola voz por semicorchea), como los fills de batería de worship en vivo.
type Celda = Array<number | 'K' | 0>;
const CELDAS: Celda[] = [
  [GM.caja, GM.caja, TOM_ALTO, TOM_ALTO],
  [TOM_ALTO, TOM_MEDIO, TOM_MEDIO, TOM_SUELO],
  [GM.caja, 'K', TOM_ALTO, 'K'],
  [TOM_SUELO, TOM_SUELO, 'K', 'K'],
  [GM.caja, TOM_ALTO, TOM_MEDIO, TOM_SUELO],
  ['K', GM.caja, GM.caja, TOM_ALTO],
  [TOM_SUELO, 'K', TOM_SUELO, 'K'],
  [GM.caja, 0, GM.caja, TOM_ALTO],
  [TOM_MEDIO, TOM_MEDIO, TOM_SUELO, 'K'],
  [TOM_ALTO, 'K', TOM_MEDIO, 'K'],
];
/** Celdas de remate (último tiempo del fill): bajan al tom de suelo y al bombo para caer fuerte en el 1. */
const CELDAS_CIERRE: Celda[] = [
  [TOM_SUELO, TOM_SUELO, 'K', 'K'],
  [TOM_MEDIO, TOM_SUELO, 'K', TOM_SUELO],
  [GM.caja, TOM_MEDIO, TOM_SUELO, 'K'],
  [TOM_SUELO, 'K', TOM_SUELO, 'K'],
];

type TipoFill = 'dos' | 'compas' | 'redoble' | 'toms' | 'solo' | 'corto';

const redondear = (x: number) => Math.round(x * 1000) / 1000;
/** Alterna dos toms por corchea a contratiempo (0.5 → a, 1.5 → b, 2.5 → a…). */
const i2 = (a: number, b: number, t: number) => (Math.floor(t) % 2 === 0 ? a : b);

function firma(g: Golpe[]): string {
  return g
    .filter((x) => x.art !== 'flam-gracia')
    .map((x) => `${Math.round(x.t * 4)}:${x.pitch}`)
    .sort()
    .join('|');
}

export function generarBateria(ctx: Ctx): NotaBruta[] {
  const rng = ctx.rng('bateria');
  const out = new Acum();
  const bpc = ctx.bpc;
  const prevPick: Record<string, number> = {};
  const conducciones: VarSec['conduccion'][] = ['toms', 'hats', 'ride'];
  let prevFirma = '';
  let ultimoFill = '';
  let crashPendiente = false;

  const elegir = (clave: string, lista: number[][]): number[] => {
    const i = elegirDistinto(rng, lista.length, prevPick[clave] ?? -1);
    prevPick[clave] = i;
    return lista[i]!;
  };

  const crearVar = (sec: SeccionInt): VarSec => {
    const lista = sec.tipo === 'coroFinal' ? KICK_FINAL : sec.tipo === 'coro' ? KICK_CORO : KICK_VERSO;
    const kick = elegir(`k-${sec.tipo}`, lista);
    const kick2 = elegir(`k2-${sec.tipo}`, lista);
    // Sin semicorcheas constantes (suenan a caja de ritmos): el hi-hat de worship va en corcheas con acentos y aperturas.
    const hatOpciones: VarSec['hat'][] = ['corcheas'];
    return {
      kick,
      kick2,
      kickAlt: rng.pick([1.5, 2.75, 3.5, 2.5]),
      hat: sec.tipo === 'verso' ? 'cuartos' : rng.pick(hatOpciones),
      media: sec.tipo === 'verso' && (ctx.estilo === 'ambient' ? true : rng.prob(sec.repeticion === 0 ? 0.35 : 0.15)),
      rimEnVerso: sec.repeticion === 0 || rng.prob(0.4),
      abiertos: elegir(`o-${sec.tipo}`, ABIERTOS),
      ghostP: sec.tipo === 'coroFinal' ? 0.5 : sec.tipo === 'coro' ? 0.38 : sec.tipo === 'verso' ? 0.12 : 0.25,
      variantePuente: rng.int(0, TOMS_PUENTE.length - 1),
      conduccion: sec.tipo === 'coro' ? conducciones[(prevPick.cond = elegirDistinto(rng, conducciones.length, prevPick.cond ?? -1))]! : 'hats',
    };
  };

  /** Un tiempo de fill a partir de una celda: crescendo, acento al inicio de cada tiempo y flam ocasional. */
  const tocarCelda = (g: Golpe[], celda: Celda, t0: number, v0: number, v1: number) => {
    celda.forEach((p, i) => {
      if (p === 0) return;
      const t = t0 + i * 0.25;
      const v = v0 + (v1 - v0) * (i / 3) + (i === 0 ? 6 : 0) + rng.rango(-4, 4);
      g.push({ t, pitch: p === 'K' ? GM.bombo : p, v });
    });
  };

  /**
   * Adornos de platos del coro: crash alternando 1 y 2 cada dos compases, golpes sincopados de plato + bombo
   * ("hits" con la banda), splash de paso y anticipación del crash en el "y" del 4.
   */
  const adornosPlatos = (g: Golpe[], b: number, nivel: number, final: boolean) => {
    if (b > 0 && b % 2 === 0 && rng.prob(final ? 0.85 : 0.6)) g.push({ t: 0, pitch: b % 4 === 0 ? GM.crash2 : GM.crash, v: 92 + 14 * nivel + rng.rango(-5, 5) });
    if (rng.prob((final ? 0.45 : 0.3) * (0.5 + nivel))) {
      const t = rng.pick([1.5, 2.5, 1.75, 2.75]);
      g.push({ t, pitch: rng.pick([GM.crash2, GM.crash]), v: 86 + 16 * nivel + rng.rango(-4, 4) }, { t, pitch: GM.bombo, v: 84 + 16 * nivel });
    }
    if (rng.prob(0.22)) g.push({ t: rng.pick([1.75, 3.75, 0.75]), pitch: GM.splash, v: 64 + 12 * nivel + rng.rango(-4, 4) });
    if (b % 4 === 3 && rng.prob(0.35)) g.push({ t: 3.5, pitch: GM.crash, v: 96 + 12 * nivel }, { t: 3.5, pitch: GM.bombo, v: 92 });
  };

  /** Crecida de platos (ride + crash 2 en semicorcheas de menos a más) que lleva a la entrada de un coro. */
  const crecidaPlatos = (g: Golpe[], desde: number) => {
    const n = Math.round((bpc - desde) / 0.25);
    for (let i = 0; i < n; i++) g.push({ t: desde + i * 0.25, pitch: i % 2 ? GM.crash2 : GM.ride, v: 26 + (i / Math.max(1, n - 1)) * 62 + rng.rango(-3, 3) });
  };

  const fill = (tipo: TipoFill, nivel: number, grande: boolean): Golpe[] => {
    const g: Golpe[] = [];
    const base = 62 + 40 * nivel;
    if (tipo === 'solo' || tipo === 'corto') {
      // Solo de un compás (o remate de un tiempo): celdas lineales distintas, crescendo y cierre al suelo/bombo.
      const tiempos = tipo === 'solo' ? bpc : 1;
      let prev = -1;
      for (let k = 0; k < tiempos; k++) {
        const ultimo = k === tiempos - 1;
        const lista = ultimo ? CELDAS_CIERRE : CELDAS;
        const i = elegirDistinto(rng, lista.length, ultimo ? -1 : prev);
        if (!ultimo) prev = i;
        const v0 = base * (0.7 + 0.3 * (k / tiempos));
        tocarCelda(g, lista[i]!, bpc - tiempos + k, v0, Math.min(124, v0 + 14));
      }
      if (tipo === 'solo' && rng.prob(0.6)) {
        const bb = g.find((x) => x.pitch === GM.caja && x.t === bpc - tiempos);
        if (bb) g.push({ t: bb.t - 0.05, pitch: GM.caja, v: bb.v * 0.5, art: 'flam-gracia' });
      }
      return g;
    }
    const vv = (i: number, n: number) => base * (0.72 + 0.34 * (n <= 1 ? 1 : i / (n - 1))) + rng.rango(-4, 4);
    const secuencias = {
      dos: [
        [GM.caja, GM.caja, TOM_ALTO, TOM_ALTO, TOM_MEDIO, TOM_MEDIO, TOM_SUELO, TOM_SUELO],
        [GM.caja, GM.caja, GM.caja, GM.caja, TOM_ALTO, TOM_MEDIO, TOM_SUELO, TOM_SUELO],
        [TOM_ALTO, TOM_ALTO, TOM_ALTO, TOM_MEDIO, TOM_MEDIO, TOM_SUELO, TOM_SUELO, TOM_SUELO],
      ],
      compas: [
        [TOM_ALTO, TOM_ALTO, TOM_ALTO, TOM_MEDIO, TOM_MEDIO, TOM_MEDIO, TOM_SUELO, TOM_SUELO],
        [GM.caja, TOM_ALTO, GM.caja, TOM_ALTO, GM.caja, TOM_MEDIO, TOM_SUELO, TOM_SUELO],
        [TOM_ALTO, TOM_ALTO, GM.caja, TOM_MEDIO, TOM_MEDIO, GM.caja, TOM_SUELO, TOM_SUELO],
      ],
    };
    if (tipo === 'dos') {
      const s = rng.pick(secuencias.dos);
      const ini = bpc - 2;
      const paso = rng.prob(0.5) ? 0.25 : 0.25;
      s.forEach((p, i) => g.push({ t: ini + i * paso, pitch: p, v: vv(i, s.length) }));
    } else if (tipo === 'compas') {
      const s = rng.pick(secuencias.compas);
      s.forEach((p, i) => {
        const t = i * (bpc / 8);
        if (t < bpc) g.push({ t, pitch: p, v: vv(i, s.length) });
      });
    } else if (tipo === 'redoble') {
      const ini = grande ? 0 : bpc - 2;
      const paso = grande && bpc === 4 ? 0.25 : 0.25;
      const n = Math.round((bpc - ini) / paso);
      for (let i = 0; i < n; i++) g.push({ t: ini + i * paso, pitch: GM.caja, v: 40 + (i / (n - 1)) * (60 + 20 * nivel) + rng.rango(-3, 3) });
    } else {
      const s = [TOM_ALTO, TOM_ALTO, TOM_MEDIO, TOM_MEDIO, TOM_SUELO, TOM_SUELO];
      const ini = bpc - 1.5;
      s.forEach((p, i) => {
        const t = ini + i * 0.25;
        if (t < bpc) g.push({ t, pitch: p, v: vv(i, s.length) });
      });
    }
    return g;
  };

  const elegirFill = (opciones: TipoFill[]): TipoFill => {
    const cand = opciones.filter((o) => o !== ultimoFill);
    const f = rng.pick(cand.length > 0 ? cand : opciones);
    ultimoFill = f;
    return f;
  };

  /** Groove base de un compás (4/4). */
  const groove = (sec: SeccionInt, vs: VarSec, b: number, nivel: number): Golpe[] => {
    const g: Golpe[] = [];
    const p = sec.compases > 1 ? b / (sec.compases - 1) : 1;
    const hatV = (t: number, base: number) => {
      const acento = Number.isInteger(t) ? 10 : t % 1 === 0.5 ? 0 : -6;
      g.push({ t, pitch: GM.hhCerrado, v: base + acento + rng.rango(-5, 5) });
    };
    const kickOffs = (kicks: number[], base: number) => {
      const lista = [...(b >= 8 ? vs.kick2 : kicks)];
      if (b % 2 === 1 && !lista.includes(vs.kickAlt) && rng.prob(0.55)) lista.push(vs.kickAlt);
      if (b % 4 === 3 && lista.length > 1 && rng.prob(0.5)) lista.splice(lista.length - 1, 1);
      lista.forEach((t, i) => g.push({ t, pitch: GM.bombo, v: base + (i === 0 ? 8 : 0) + rng.rango(-6, 6) }));
    };

    switch (sec.tipo) {
      case 'verso':
      case 'intro':
      case 'outro': {
        const backbeat = vs.media ? [2] : [1, 3];
        const pitchBB = vs.rimEnVerso ? GM.rim : GM.caja;
        backbeat.forEach((t) => g.push({ t, pitch: pitchBB, v: (vs.rimEnVerso ? 54 : 50) + 34 * nivel + rng.rango(-5, 5) }));
        if (nivel < 0.55) for (let t = 0; t < bpc; t += 1) hatV(t, 34 + 30 * nivel);
        else {
          // corcheas que respiran: a veces falta un contratiempo, para que el verso no suene cuadrado
          const hueco = rng.prob(0.5) ? rng.pick([1.5, 2.5, 3.5]) : -1;
          for (let t = 0; t < bpc; t += 0.5) if (t !== hueco) hatV(t, 34 + 30 * nivel);
        }
        kickOffs(vs.kick, 62 + 28 * nivel);
        break;
      }
      case 'precoro': {
        [1, 3].forEach((t, i) => g.push({ t, pitch: GM.caja, v: 56 + 50 * nivel + (i ? 4 : 0) + rng.rango(-5, 5) }));
        for (let t = 0; t < bpc; t += 0.5) hatV(t, 40 + 34 * nivel);
        kickOffs(p < 0.5 ? [0, 2.5] : [0, 2, 3.5], 66 + 28 * nivel);
        if (p >= 0.5) {
          // build: toms en corcheas (suelo / medio) que crecen hacia el coro, sobre bombo en negras
          [0, 2].forEach((t) => g.push({ t, pitch: GM.caja, v: 50 + 44 * p + rng.rango(-4, 4) }));
          for (let t = 0; t < bpc; t += 0.5) g.push({ t, pitch: t % 1 === 0 ? TOM_SUELO : TOM_MEDIO, v: 58 + 36 * p + (t % 1 === 0 ? 6 : 0) + rng.rango(-4, 4) });
          for (let t = 0; t < bpc; t += 1) g.push({ t, pitch: GM.bombo, v: 70 + 24 * p + rng.rango(-4, 4) });
        }
        if (p >= 0.8) for (let t = 0.5; t < bpc; t += 1) g.push({ t, pitch: GM.caja, v: 50 + 40 * p + rng.rango(-4, 4) });
        break;
      }
      case 'coro': {
        const bb = 60 + 46 * nivel;
        [1, 3].forEach((t, i) => g.push({ t, pitch: GM.caja, v: bb + (i ? 3 : 0) + rng.rango(-6, 6) }));
        kickOffs(vs.kick, 72 + 28 * nivel);
        if (vs.conduccion === 'toms') {
          // himno worship: el tom de suelo conduce en corcheas (acento en las negras), pedal de hi-hat en 2 y 4
          for (let t = 0; t < bpc; t += 0.5) g.push({ t, pitch: TOM_SUELO, v: (Number.isInteger(t) ? 82 : 62) + 14 * nivel + rng.rango(-6, 6) });
          [1, 3].forEach((t) => g.push({ t, pitch: GM.hhPie, v: 46 + rng.rango(-5, 5) }));
          // hi-hat abierto a contratiempo sobre el tom (el "bark" que empuja el groove)
          for (const t of vs.abiertos) if (!Number.isInteger(t)) g.push({ t, pitch: GM.hhAbierto, v: 66 + 14 * nivel + rng.rango(-5, 5) });
        } else if (vs.conduccion === 'ride') {
          for (let t = 0; t < bpc; t += 0.5) {
            const campana = t % 2 === 1.5 || (t === 3.5 && b % 2 === 1);
            g.push({ t, pitch: campana ? GM.campana : GM.ride, v: (Number.isInteger(t) ? 76 : 60) + 14 * nivel + rng.rango(-6, 6) });
          }
          [1, 3].forEach((t) => g.push({ t, pitch: GM.hhPie, v: 44 + rng.rango(-5, 5) }));
        } else if (vs.hat === 'semis') {
          for (let t = 0; t < bpc; t += 0.25) {
            const esAbierto = vs.abiertos.includes(t);
            g.push({ t, pitch: esAbierto ? GM.hhAbierto : GM.hhCerrado, v: (t % 1 === 0 ? 74 : t % 0.5 === 0 ? 56 : 40) + 10 * nivel + rng.rango(-5, 5) });
          }
        } else {
          for (let t = 0; t < bpc; t += 0.5) {
            const abierto = vs.abiertos.includes(t);
            g.push({ t, pitch: abierto ? GM.hhAbierto : GM.hhCerrado, v: (Number.isInteger(t) ? 76 : 62) + 14 * nivel + rng.rango(-6, 6) });
          }
        }
        if (b === 0) g.push({ t: 0, pitch: GM.crash, v: 104 + rng.rango(-4, 4) });
        adornosPlatos(g, b, nivel, false);
        break;
      }
      case 'coroFinal': {
        const bb = 66 + 44 * nivel;
        [1, 3].forEach((t, i) => g.push({ t, pitch: GM.caja, v: bb + (i ? 4 : 0) + rng.rango(-6, 6) }));
        kickOffs(vs.kick, 80 + 24 * nivel);
        for (let t = 0; t < bpc; t += 0.5) {
          const campana = Number.isInteger(t) && (b >= 8 ? true : t % 2 === 0 && b % 2 === 0 && nivel > 0.97);
          g.push({ t, pitch: campana ? GM.campana : GM.ride, v: (Number.isInteger(t) ? 78 : 62) + 14 * nivel + rng.rango(-6, 6) });
        }
        [1, 3].forEach((t) => g.push({ t, pitch: GM.hhPie, v: 44 + rng.rango(-5, 5) }));
        if (b % 8 === 0) g.push({ t: 0, pitch: GM.crash, v: 112 + rng.rango(-4, 4) });
        adornosPlatos(g, b, nivel, true);
        // peso del coro final: el tom de suelo dobla al bombo en los tiempos fuertes
        for (const x of g.filter((y) => y.pitch === GM.bombo && Number.isInteger(y.t))) if (rng.prob(0.55)) g.push({ t: x.t, pitch: TOM_SUELO, v: x.v - 6 });
        break;
      }
      case 'puente': {
        const [t1, t2] = TOMS_PUENTE[vs.variantePuente]!;
        if (p < 0.25) {
          g.push({ t: 0, pitch: GM.bombo, v: 70 + 24 * nivel });
          [0, 2].forEach((t, i) => g.push({ t, pitch: i ? t2! : t1!, v: 56 + 38 * nivel + rng.rango(-5, 5) }));
          [1, 3].forEach((t) => g.push({ t, pitch: GM.hhPie, v: 44 + rng.rango(-4, 4) }));
        } else if (p < 0.5) {
          g.push({ t: 0, pitch: GM.bombo, v: 76 + 24 * nivel }, { t: 2, pitch: GM.bombo, v: 70 + 24 * nivel });
          [1, 3].forEach((t) => g.push({ t, pitch: GM.rim, v: 56 + 34 * nivel + rng.rango(-5, 5) }));
          [0, 1.5, 2, 3.5].forEach((t, i) => g.push({ t, pitch: i % 2 ? t2! : t1!, v: 58 + 36 * nivel + rng.rango(-5, 5) }));
          for (let t = 0; t < bpc; t += 1) hatV(t, 44 + 20 * nivel);
        } else if (p < 0.75) {
          [0, 1, 2, 3].forEach((t) => g.push({ t, pitch: GM.bombo, v: 74 + 26 * nivel + rng.rango(-5, 5) }));
          [1, 3].forEach((t) => g.push({ t, pitch: GM.caja, v: 64 + 40 * nivel + rng.rango(-5, 5) }));
          // groove tribal: los toms conducen en corcheas (suelo en las negras) y doblan semicorcheas al final
          for (let t = 0; t < bpc; t += 0.5) g.push({ t, pitch: Number.isInteger(t) ? TOM_SUELO : i2(t1!, t2!, t), v: (Number.isInteger(t) ? 74 : 60) + 30 * nivel + rng.rango(-5, 5) });
          if (rng.prob(0.6)) [3.25, 3.75].forEach((t) => g.push({ t, pitch: TOM_SUELO, v: 64 + 30 * nivel + rng.rango(-4, 4) }));
        } else {
          for (let t = 0; t < bpc; t += 0.5) g.push({ t, pitch: GM.caja, v: 54 + 54 * nivel * (0.8 + 0.2 * p) + rng.rango(-4, 4) });
          [0, 2].forEach((t) => g.push({ t, pitch: GM.bombo, v: 84 + 24 * nivel }));
          if (b % 2 === 0) g.push({ t: 0, pitch: GM.crash2, v: 90 });
        }
        break;
      }
    }

    // Notas fantasma de caja (a baja velocidad) en grooves con caja.
    const usaCaja = g.some((x) => x.pitch === GM.caja);
    if (usaCaja && sec.tipo !== 'puente' && sec.tipo !== 'precoro') {
      const cand = rng.barajar([0.75, 1.75, 2.75, 3.75, 1.25, 3.25]);
      let n = 0;
      for (const t of cand) {
        if (n >= 2 || t >= bpc) break;
        if (rng.prob(vs.ghostP * (0.5 + nivel))) {
          g.push({ t, pitch: GM.caja, v: 20 + rng.rango(0, 18), art: 'fantasma' });
          n++;
        }
      }
    }
    return g;
  };

  /** Groove simplificado para 6/8 (bpc = 3). */
  const groove68 = (sec: SeccionInt, vs: VarSec, b: number, nivel: number): Golpe[] => {
    const g: Golpe[] = [];
    const alto = sec.tipo === 'coro' || sec.tipo === 'coroFinal';
    g.push({ t: 0, pitch: GM.bombo, v: 70 + 30 * nivel + rng.rango(-5, 5) });
    if (nivel > 0.5 && b % 2 === 1) g.push({ t: 1, pitch: GM.bombo, v: 60 + 25 * nivel });
    g.push({ t: 1.5, pitch: alto || sec.tipo === 'puente' ? GM.caja : GM.rim, v: 52 + 50 * nivel + rng.rango(-5, 5) });
    for (let t = 0; t < 3; t += 0.5) {
      const abierto = alto && t === 2.5 && vs.abiertos.length > 0;
      g.push({ t, pitch: sec.tipo === 'coroFinal' ? GM.ride : abierto ? GM.hhAbierto : GM.hhCerrado, v: (t % 1.5 === 0 ? 70 : 52) + 14 * nivel + rng.rango(-5, 5) });
    }
    if (alto && b === 0) g.push({ t: 0, pitch: GM.crash, v: 104 });
    return g;
  };

  const mutar = (g: Golpe[], nivel: number, tipoSec: string) => {
    const opciones = ['ghost', 'kick', 'hat'];
    const o = rng.pick(opciones);
    const libres = [0.5, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75].filter((t) => t < bpc);
    const t = rng.pick(libres);
    if (o === 'ghost' && tipoSec !== 'precoro') g.push({ t, pitch: GM.caja, v: 22 + rng.rango(0, 16), art: 'fantasma' });
    else if (o === 'kick') g.push({ t, pitch: GM.bombo, v: 60 + 24 * nivel });
    else g.push({ t, pitch: GM.hhCerrado, v: 40 + 20 * nivel });
  };

  for (let i = 0; i < ctx.secciones.length; i++) {
    const sec = ctx.secciones[i]!;
    if (!sec.roles.includes('bateria')) {
      prevFirma = '';
      crashPendiente = false;
      continue;
    }
    const vs = crearVar(sec);
    const sigSec = ctx.secciones[i + 1];
    for (const { b, t0, nivel } of compasesActivos(ctx, sec, 'bateria')) {
      let g = bpc === 4 ? groove(sec, vs, b, nivel) : groove68(sec, vs, b, nivel);
      const finSec = b === sec.compases - 1;
      const pasoAFuerte = finSec && sigSec !== undefined && (sigSec.tipo === 'coro' || sigSec.tipo === 'coroFinal');

      // Fills
      // En worship la batería protagoniza las transiciones: solos de un compás hacia los coros, fills cada 4 y
      // remates cortos cada 2 compases en las secciones fuertes.
      let accion: TipoFill | 'ninguno' = 'ninguno';
      let stop = false;
      const en44 = bpc === 4;
      const fuerte = sec.tipo === 'coro' || sec.tipo === 'coroFinal' || sec.tipo === 'puente';
      const conSolo = (l: TipoFill[]): TipoFill[] => (en44 && fuerte ? [...l, 'solo'] : l);
      if (pasoAFuerte) {
        const pSolo = sigSec.tipo === 'coroFinal' || sec.tipo === 'puente' ? 0.7 : 0.4;
        accion = en44 && rng.prob(pSolo) ? 'solo' : rng.prob(0.5) ? 'redoble' : elegirFill(['dos', 'compas', 'toms']);
        stop = accion === 'solo' ? false : sec.tipo === 'puente' ? rng.prob(0.7) : rng.prob(0.5);
      } else if (finSec && sec.tipo !== 'intro') {
        accion = nivel > 0.4 ? elegirFill(conSolo(['dos', 'toms'])) : 'ninguno';
      } else if ((b + 1) % 8 === 0) {
        accion = rng.prob(0.75) ? elegirFill(conSolo(['compas', 'redoble', 'toms'])) : elegirFill(['dos', 'toms']);
      } else if ((b + 1) % 4 === 0 && sec.tipo !== 'puente') {
        const p = sec.tipo === 'verso' ? (nivel > 0.42 ? 0.25 : 0) : 0.75;
        if (rng.prob(p)) accion = elegirFill(sec.tipo !== 'verso' && en44 ? ['dos', 'toms', 'corto'] : ['dos', 'toms']);
      } else if (en44 && fuerte && (b + 1) % 2 === 0 && rng.prob(0.4 * (0.5 + nivel))) {
        accion = 'corto';
      }
      let inicioFill = bpc;
      if (accion !== 'ninguno') {
        const f = fill(accion === 'redoble' && !pasoAFuerte ? 'redoble' : accion, nivel, pasoAFuerte && sec.tipo === 'precoro');
        if (bpc !== 4) {
          // en 6/8 el fill se reduce a la última negra y media
          const reducido = f.filter((x) => x.t >= bpc - 1.5).map((x) => ({ ...x, t: redondear(x.t - (4 - bpc)) })).filter((x) => x.t < bpc && x.t >= bpc - 1.5);
          f.length = 0;
          f.push(...reducido);
        }
        if (f.length > 0) {
          inicioFill = Math.min(...f.map((x) => x.t));
          g = g.filter((x) => x.t < inicioFill - 1e-9 || x.pitch === GM.bombo && x.t < inicioFill + 1e-9);
          g.push(...f);
          if (stop) {
            // Silencio deliberado: el redoble muere antes del último tiempo para dejar entrar fuerte.
            const corte = bpc - 1;
            g = g.filter((x) => x.t < corte - 1e-9);
          } else if (pasoAFuerte && accion === 'redoble' && en44 && rng.prob(0.6)) {
            crecidaPlatos(g, bpc - 2); // el redoble sube con una crecida de platos hacia el coro
          }
          crashPendiente = pasoAFuerte || (sec.tipo === 'coroFinal' && finSec ? false : rng.prob(accion === 'corto' ? 0.35 : 0.6));
        }
      }
      if (b === 0 && crashPendiente) {
        if (!g.some((x) => x.pitch === GM.crash && x.t === 0)) g.push({ t: 0, pitch: GM.crash, v: 106 });
        if (!g.some((x) => x.pitch === GM.bombo && x.t === 0)) g.push({ t: 0, pitch: GM.bombo, v: 100 });
        crashPendiente = false;
      } else if (b > 0 && crashPendiente && accion === 'ninguno') {
        g.push({ t: 0, pitch: GM.crash, v: 100 });
        crashPendiente = false;
      }

      // Flams ocasionales sobre el backbeat.
      if (nivel > 0.6 && (sec.tipo === 'coro' || sec.tipo === 'coroFinal') && rng.prob(0.07)) {
        const bb = g.find((x) => x.pitch === GM.caja && x.art === undefined && (x.t === 1 || x.t === 3));
        if (bb) {
          bb.art = 'flam';
          g.push({ t: bb.t - 0.05, pitch: GM.caja, v: bb.v * 0.5, art: 'flam-gracia' });
        }
      }

      // Evitar repetir literalmente el compás anterior.
      let intentos = 0;
      while (firma(g) === prevFirma && intentos < 4) {
        mutar(g, nivel, sec.tipo);
        intentos++;
      }
      prevFirma = firma(g);

      // Quitar duplicados (mismo pitch y mismo instante) conservando el más fuerte.
      const vistos = new Map<string, Golpe>();
      for (const x of g) {
        const k = `${redondear(x.t)}:${x.pitch}`;
        const y = vistos.get(k);
        if (!y || x.v > y.v) vistos.set(k, x);
      }
      for (const x of vistos.values()) {
        if (x.t < 0 || x.t >= bpc) continue;
        const dur = x.pitch === GM.crash || x.pitch === GM.crash2 || x.pitch === GM.splash || x.pitch === GM.ride ? 0.5 : 0.12;
        const v = x.art === 'fantasma' ? Math.min(x.v, 40) : x.v;
        out.add(x.pitch, t0 + x.t, dur, vel(v), { articulacion: x.art, fija: true });
      }
    }
  }
  return out.notas;
}

export type { Rng };
