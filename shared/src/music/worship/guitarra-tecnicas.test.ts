import { describe, expect, it } from 'vitest';
import {
  ANTELACION_KS,
  CC_GUITARRA,
  Conmutador,
  KS_GUITARRA,
  KS_MAX,
  KS_MIN,
  NOTA_MIN_GUITARRA,
  aplicarTecnicasGuitarra,
  armonicosNaturales,
  bendsComoKeyswitch,
  esKeyswitch,
  gruposDeAcorde,
  palmMutesEnSecciones,
  rasgueosConDireccion,
  slidesDeEntradaYSalida,
  slidesEnMelodia,
  swellsAlEntrar,
  tremoloEnNotasLargas,
  vibratoEnNotasLargas,
  type NotaGuitarra,
  type SeccionGuitarra,
} from './index';

const n = (pitch: number, inicio: number, duracion: number, velocidad = 80): NotaGuitarra => ({ pitch, inicio, duracion, velocidad });

/** Línea melódica con saltos grandes, saltos pequeños y notas cortas, separada por silencios. */
const MELODIA: NotaGuitarra[] = [
  n(64, 0, 1), n(71, 1, 1), n(66, 2, 0.5), n(67, 2.5, 1.5), n(74, 4, 2), // 64→71 (7 st) slide; 66→67 (1 st) hammer
  n(72, 10, 1), n(69, 11, 1), n(76, 12, 4),
];
const SECCIONES: SeccionGuitarra[] = [
  { inicioBeat: 0, duracionBeats: 16, tipo: 'intro' },
  { inicioBeat: 16, duracionBeats: 32, tipo: 'verso' },
  { inicioBeat: 48, duracionBeats: 32, tipo: 'coro' },
  { inicioBeat: 80, duracionBeats: 16, tipo: 'puente' },
];

const soloKs = (xs: NotaGuitarra[]) => xs.filter(esKeyswitch);
const soloGuitarra = (xs: NotaGuitarra[]) => xs.filter((x) => !esKeyswitch(x));

/** Reproduce los keyswitches fijos en orden y devuelve el estado vigente en el instante t. */
function estadoEn(xs: NotaGuitarra[], t: number) {
  const est = { art: 'normal', legato: 'off', dir: 'abajo', swell: false };
  for (const k of soloKs(xs).filter((x) => x.inicio <= t + 1e-9)) {
    switch (k.pitch) {
      case KS_GUITARRA.normal: est.art = 'normal'; est.legato = 'off'; est.dir = 'abajo'; est.swell = false; break;
      case KS_GUITARRA.palmMute: est.art = 'palm'; break;
      case KS_GUITARRA.muerta: est.art = 'muerta'; break;
      case KS_GUITARRA.armonicoNatural: est.art = 'armN'; break;
      case KS_GUITARRA.armonicoArtificial: est.art = 'armA'; break;
      case KS_GUITARRA.tremolo: est.art = 'trem'; break;
      case KS_GUITARRA.legato: est.legato = 'legato'; break;
      case KS_GUITARRA.slide: est.legato = 'slide'; break;
      case KS_GUITARRA.rasgueoAbajo: est.dir = 'abajo'; break;
      case KS_GUITARRA.rasgueoArriba: est.dir = 'arriba'; break;
      case KS_GUITARRA.rasgueoAlterno: est.dir = 'alterno'; break;
      case KS_GUITARRA.autoSwell: est.swell = true; break;
      default: break;
    }
  }
  return est;
}

function invariantes(xs: NotaGuitarra[], cc: { tiempo: number; valor: number }[] = []) {
  for (const x of xs) {
    expect(x.inicio).toBeGreaterThanOrEqual(0);
    expect(x.duracion).toBeGreaterThan(0);
    expect(x.velocidad).toBeGreaterThanOrEqual(1);
    expect(x.velocidad).toBeLessThanOrEqual(127);
    if (esKeyswitch(x)) { expect(x.pitch).toBeGreaterThanOrEqual(KS_MIN); expect(x.pitch).toBeLessThanOrEqual(KS_MAX); }
    else expect(x.pitch).toBeGreaterThanOrEqual(NOTA_MIN_GUITARRA);
  }
  for (let i = 1; i < xs.length; i++) expect(xs[i]!.inicio).toBeGreaterThanOrEqual(xs[i - 1]!.inicio);
  for (const e of cc) { expect(e.valor).toBeGreaterThanOrEqual(0); expect(e.valor).toBeLessThanOrEqual(1); expect(e.tiempo).toBeGreaterThanOrEqual(0); }
}

describe('contrato de keyswitches', () => {
  it('todos los keyswitches están en 11..27, son únicos y por debajo del registro de la guitarra', () => {
    const vals = Object.values(KS_GUITARRA);
    expect(new Set(vals).size).toBe(vals.length);
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(KS_MIN); expect(v).toBeLessThanOrEqual(KS_MAX); expect(v).toBeLessThan(NOTA_MIN_GUITARRA); }
    expect(KS_GUITARRA.normal).toBe(12);
    expect(CC_GUITARRA.expresion).toBe(11);
  });
});

describe('slidesEnMelodia', () => {
  it('solapa las parejas ligadas, deja intactas las demás y envuelve las parejas con el modo del plugin', () => {
    const r = slidesEnMelodia(MELODIA, { semilla: 1, probabilidad: 1 });
    invariantes(r.notas);
    const g = soloGuitarra(r.notas);
    expect(g).toHaveLength(MELODIA.length);
    expect(r.parejas.length).toBeGreaterThanOrEqual(2);
    const tipos = r.parejas.map((p) => p.tipo);
    expect(tipos).toContain('slide');
    expect(tipos).toContain('hammer');
    for (const p of r.parejas) {
      const a = g[p.desde]!;
      const b = g[p.hasta]!;
      expect(a.inicio + a.duracion).toBeGreaterThan(b.inicio);          // solape
      expect(a.inicio + a.duracion).toBeLessThanOrEqual(b.inicio + b.duracion);
      // el modo correcto está activo cuando entra la segunda nota
      expect(estadoEn(r.notas, b.inicio - 1e-6).legato).toBe(p.tipo === 'slide' ? 'slide' : 'legato');
    }
    // fuera de las parejas el modo está apagado: la nota larga final (76 en el beat 12) no se liga
    expect(estadoEn(r.notas, 12).legato).toBe('off');
    // ningún solape entre notas que no son una pareja
    const pares = new Set(r.parejas.map((p) => `${p.desde}-${p.hasta}`));
    for (let i = 0; i + 1 < g.length; i++) if (!pares.has(`${i}-${i + 1}`)) expect(g[i]!.inicio + g[i]!.duracion).toBeLessThanOrEqual(g[i + 1]!.inicio + 1e-9);
  });
  it('es determinista por semilla y probabilidad 0 no toca nada', () => {
    const a = slidesEnMelodia(MELODIA, { semilla: 7, probabilidad: 0.5 });
    const b = slidesEnMelodia(MELODIA, { semilla: 7, probabilidad: 0.5 });
    expect(a).toEqual(b);
    const c = slidesEnMelodia(MELODIA, { semilla: 7, probabilidad: 0 });
    expect(c.notas).toEqual(MELODIA);
  });
  it('ignora los acordes y no liga intervalos fuera de rango', () => {
    const acorde = [n(50, 0, 2), n(57, 0, 2), n(62, 0, 2), n(66, 2, 1), n(69, 2, 1), n(74, 2, 1)];
    const r = slidesEnMelodia(acorde, { semilla: 1, probabilidad: 1 });
    expect(r.parejas).toHaveLength(0);
    expect(soloKs(r.notas)).toHaveLength(0);
    const salto = slidesEnMelodia([n(60, 0, 1), n(80, 1, 1)], { semilla: 1, probabilidad: 1 });
    expect(salto.parejas).toHaveLength(0);
  });
});

describe('rasgueosConDireccion', () => {
  const golpe = (t: number, d = 1) => [40, 47, 52, 56, 59, 64].map((p, i) => n(p + 12, t, d, 90 - i));
  it('agrupa los golpes y alterna abajo en los tiempos / arriba en los contratiempos', () => {
    const notas = [...golpe(0), ...golpe(1.5), ...golpe(2), ...golpe(3.5)];
    expect(gruposDeAcorde(notas)).toHaveLength(4);
    const r = rasgueosConDireccion(notas);
    expect(r.direcciones).toEqual(['abajo', 'arriba', 'abajo', 'arriba']);
    invariantes(r.notas);
    expect(estadoEn(r.notas, 1.5).dir).toBe('arriba');
    expect(estadoEn(r.notas, 2).dir).toBe('abajo');
    // solo se emite un keyswitch cuando cambia la dirección (el primero 'abajo' ya es el estado inicial)
    const ks = soloKs(r.notas).map((k) => k.pitch);
    expect(ks.length).toBeGreaterThanOrEqual(3);
    for (const k of soloKs(r.notas)) expect(k.inicio).toBeLessThanOrEqual(3.5);
  });
  it('un patrón fijo "arriba" emite un único keyswitch y no toca las notas', () => {
    const notas = [...golpe(0), ...golpe(1), ...golpe(2)];
    const r = rasgueosConDireccion(notas, { patron: 'arriba' });
    expect(soloKs(r.notas)).toHaveLength(1);
    expect(soloKs(r.notas)[0]!.pitch).toBe(KS_GUITARRA.rasgueoArriba);
    expect(soloGuitarra(r.notas)).toEqual(notas);
  });
});

describe('palmMutesEnSecciones', () => {
  const bajo = [n(52, 16, 0.5), n(52, 16.5, 0.5), n(55, 17, 0.5), n(72, 18, 0.5), n(52, 19, 0.5), n(52, 50, 0.5)];
  it('silencia las notas graves y cortas del verso y vuelve a normal al salir o ante una nota abierta', () => {
    const r = palmMutesEnSecciones(bajo, SECCIONES);
    invariantes(r.notas);
    expect(estadoEn(r.notas, 16.5).art).toBe('palm');
    expect(estadoEn(r.notas, 17).art).toBe('palm');
    expect(estadoEn(r.notas, 18).art).toBe('normal');     // la nota aguda queda abierta
    expect(estadoEn(r.notas, 19).art).toBe('palm');
    expect(estadoEn(r.notas, 50).art).toBe('normal');     // en el coro no
    // un 13 antes de la primera nota, pegado a ella
    const k13 = soloKs(r.notas).find((k) => k.pitch === KS_GUITARRA.palmMute)!;
    expect(k13.inicio).toBeCloseTo(16 - ANTELACION_KS, 3);
  });
});

describe('swellsAlEntrar', () => {
  it('emite CC11 monótono 0..1 antes de cada sección elegida', () => {
    const cc = swellsAlEntrar(SECCIONES, { duracion: 4 });
    invariantes([], cc);
    expect(cc.every((e) => e.cc === CC_GUITARRA.expresion)).toBe(true);
    for (let i = 1; i < cc.length; i++) expect(cc[i]!.tiempo).toBeGreaterThanOrEqual(cc[i - 1]!.tiempo);
    // la sección 'puente' (beat 80): empieza en 0 y sube sin bajar hasta 1 a los 4 beats
    const tramo = cc.filter((e) => e.tiempo >= 79.9 && e.tiempo <= 84.01);
    expect(tramo[0]!.valor).toBe(0);
    for (let i = 1; i < tramo.length; i++) expect(tramo[i]!.valor).toBeGreaterThanOrEqual(tramo[i - 1]!.valor);
    expect(tramo[tramo.length - 1]!.valor).toBe(1);
    // el verso no tiene swell: no hay un 0 en su inicio
    expect(cc.some((e) => e.tiempo > 15 && e.tiempo < 17 && e.valor === 0)).toBe(false);
    expect(swellsAlEntrar([{ inicioBeat: 0, duracionBeats: 8, tipo: 'verso' }])).toEqual([]);
  });
});

describe('slides de entrada/salida, bends, armónicos, tremolo y vibrato', () => {
  it('slide-in tras un silencio y slide-out en una nota larga de fin de frase (keyswitches de una sola nota)', () => {
    const r = slidesDeEntradaYSalida([n(64, 0, 2), n(66, 10, 3), n(69, 20, 1)], { semilla: 3, probabilidad: 1 });
    invariantes(r.notas);
    const ks = soloKs(r.notas).map((k) => k.pitch);
    expect(ks).toContain(KS_GUITARRA.slideIn);
    expect(ks.some((p) => p === KS_GUITARRA.slideOutAbajo || p === KS_GUITARRA.slideOutArriba)).toBe(true);
    for (const k of soloKs(r.notas)) {
      const sig = soloGuitarra(r.notas).find((x) => x.inicio > k.inicio - 0.001 && x.inicio - k.inicio < 0.05);
      expect(sig).toBeTruthy();                                          // cada keyswitch precede de inmediato a su nota
    }
  });
  it('bend -2 → nota 2 st más grave + bend-up', () => {
    const r = bendsComoKeyswitch([{ ...n(76, 4, 2), bend: -2 }, { ...n(70, 8, 1), bend: -1 }]);
    const g = soloGuitarra(r.notas);
    expect(g.map((x) => x.pitch)).toEqual([74, 70]);
    expect(soloKs(r.notas).map((k) => k.pitch)).toEqual([KS_GUITARRA.bendUp]);
  });
  it('armónico natural en las alturas elegidas y tremolo en notas largas', () => {
    const a = armonicosNaturales([n(64, 0, 1), n(76, 2, 2), n(64, 5, 1)]);
    expect(estadoEn(a.notas, 2).art).toBe('armN');
    expect(estadoEn(a.notas, 5).art).toBe('normal');
    const t = tremoloEnNotasLargas([n(64, 0, 1), n(69, 2, 4), n(64, 7, 1)], SECCIONES);
    expect(estadoEn(t.notas, 2).art).toBe('trem');
    expect(estadoEn(t.notas, 7).art).toBe('normal');
  });
  it('vibrato solo en notas largas, con CC1 a 0 al terminar', () => {
    const cc = vibratoEnNotasLargas([n(64, 0, 1), n(69, 2, 4)]);
    expect(cc).toHaveLength(2);
    expect(cc[0]!.cc).toBe(CC_GUITARRA.vibrato);
    expect(cc[1]!.valor).toBe(0);
  });
});

describe('Conmutador', () => {
  it('no repite keyswitches y repone el estado tras un reset', () => {
    const c = new Conmutador();
    expect(c.fijar(1, { articulacion: 'palmMute' })).toBe(true);
    expect(c.fijar(2, { articulacion: 'palmMute' })).toBe(false);
    expect(c.fijar(3, { direccion: 'arriba' })).toBe(true);
    expect(c.fijar(4, { articulacion: 'normal' })).toBe(true);        // vuelve a normal: 12 + reponer la dirección 'arriba'
    const pitches = c.notas.map((k) => k.pitch);
    expect(pitches).toEqual([KS_GUITARRA.palmMute, KS_GUITARRA.rasgueoArriba, KS_GUITARRA.normal, KS_GUITARRA.rasgueoArriba]);
    expect(c.actual()).toMatchObject({ articulacion: 'normal', direccion: 'arriba' });
  });
});

describe('aplicarTecnicasGuitarra', () => {
  const golpe = (t: number) => [52, 59, 64, 67, 71].map((p, i) => n(p, t, 0.9, 85 - i));
  const notas = [
    ...[16, 16.5, 17, 17.5].map((t) => n(52, t, 0.4)),             // verso: palm mute
    ...golpe(48), ...golpe(49.5), ...golpe(50),                    // coro: rasgueos
    ...MELODIA.map((x) => ({ ...x, inicio: x.inicio + 80 })),      // puente: lead con slides
  ];
  const r = aplicarTecnicasGuitarra(notas, { semilla: 5, secciones: SECCIONES, slides: { probabilidad: 1 } });
  it('respeta las invariantes y no pierde ni inventa notas de guitarra', () => {
    invariantes(r.notas, r.cc);
    expect(soloGuitarra(r.notas)).toHaveLength(notas.length);
    expect(soloGuitarra(r.notas).map((x) => x.pitch).sort()).toEqual(notas.map((x) => x.pitch).sort());
    expect(r.cc.length).toBeGreaterThan(0);
  });
  it('combina palm mute, rasgueo y slides sin que un reset apague a otro', () => {
    expect(estadoEn(r.notas, 16.5).art).toBe('palm');
    expect(estadoEn(r.notas, 48).art).toBe('normal');
    expect(estadoEn(r.notas, 49.5).dir).toBe('arriba');
    const slide = r.notas.filter((k) => k.pitch === KS_GUITARRA.slide);
    expect(slide.length).toBeGreaterThan(0);
    expect(estadoEn(r.notas, 80 + 1 - 1e-6).legato).toBe('slide');
  });
  it('es determinista y se puede apagar bloque a bloque', () => {
    expect(aplicarTecnicasGuitarra(notas, { semilla: 5, secciones: SECCIONES, slides: { probabilidad: 1 } })).toEqual(r);
    const off = aplicarTecnicasGuitarra(notas, { semilla: 5, secciones: SECCIONES, slides: false, rasgueos: false, palmMute: false, swell: false, slideInOut: false, vibrato: false });
    expect(off.notas).toEqual(soloGuitarra(r.notas).map((x) => ({ ...x, duracion: notas.find((m) => m.pitch === x.pitch && m.inicio === x.inicio)!.duracion })));
    expect(off.cc).toEqual([]);
  });
});
