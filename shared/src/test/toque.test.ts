import { describe, expect, it } from 'vitest';
import {
  aplicarPerfilToque,
  aprenderPerfilToque,
  crearRng,
  describirPerfilToque,
  type NotaToque,
  type PosicionMetrica,
} from '../index';

const BPM = 100;
const MS = 60000 / BPM;

/** Patrón cuantizado: acorde en 1 y 3, notas sueltas en 2 y 2.5, arpegio ascendente de semicorcheas en 4. */
function patronCuantizado(compases = 16): NotaToque[] {
  const notas: NotaToque[] = [];
  for (let c = 0; c < compases; c++) {
    const b = c * 4;
    for (const p of [48, 52, 55, 60]) notas.push({ pitch: p, inicio: b, duracion: 1, velocidad: 90 });
    notas.push({ pitch: 64, inicio: b + 1, duracion: 0.5, velocidad: 90 });
    notas.push({ pitch: 62, inicio: b + 1.5, duracion: 0.5, velocidad: 90 });
    for (const p of [50, 53, 57, 60]) notas.push({ pitch: p, inicio: b + 2, duracion: 1, velocidad: 90 });
    [60, 64, 67, 72].forEach((p, i) => notas.push({ pitch: p, inicio: b + 3 + i * 0.25, duracion: 0.25, velocidad: 90 }));
  }
  return notas;
}

const TIMING: Record<PosicionMetrica, [number, number]> = { fuerte: [-4, 2], debil: [3, 3], contratiempo: [10, 3], subdivision: [6, 3] };
const VEL: Record<PosicionMetrica, [number, number]> = { fuerte: [100, 4], debil: [82, 4], contratiempo: [70, 4], subdivision: [76, 4] };

function posDe(beat: number): PosicionMetrica {
  const enCompas = beat % 4;
  if (enCompas === 0) return 'fuerte';
  if (Number.isInteger(beat)) return 'debil';
  if (beat % 1 === 0.5) return 'contratiempo';
  return 'subdivision';
}

/** «Interpretación» sintética con un toque conocido sobre el patrón cuantizado. */
function interpretar(cuantizadas: NotaToque[], semilla = 11): NotaToque[] {
  const rng = crearRng(semilla);
  const porInicio = new Map<number, NotaToque[]>();
  for (const n of cuantizadas) porInicio.set(n.inicio, [...(porInicio.get(n.inicio) ?? []), n]);
  const anclas = [...porInicio.keys()].sort((a, b) => a - b);
  const res: NotaToque[] = [];
  anclas.forEach((t, k) => {
    const ns = [...porInicio.get(t)!].sort((a, b) => a.pitch - b.pitch);
    const pos = posDe(t);
    const desv = (TIMING[pos][0] + TIMING[pos][1] * rng.gauss()) / MS;
    const vGrupo = VEL[pos][0] + VEL[pos][1] * rng.gauss();
    const arpegiado = ns.length > 1 && rng.prob(0.8);
    const ioi = (anclas[k + 1] ?? t + 1) - t;
    let acum = 0;
    ns.forEach((n, j) => {
      if (arpegiado && j > 0) acum += Math.max(1, 14 + 4 * rng.gauss()) / MS;
      const voz = ns.length > 1 ? (j === ns.length - 1 ? 8 : j === 0 ? 4 : -6) : 0;
      res.push({
        pitch: n.pitch,
        inicio: t + desv + acum,
        duracion: (0.85 + 0.05 * rng.gauss()) * ioi,
        velocidad: Math.round(Math.max(1, Math.min(127, vGrupo + voz))),
      });
    });
  });
  return res;
}

describe('toque · aprender', () => {
  const perfil = aprenderPerfilToque(interpretar(patronCuantizado()), { bpm: BPM, rejillaBeats: 0.25, instrumento: 'piano' });

  it('mide el micro-timing por posición métrica', () => {
    expect(perfil.timing.porPosicion.fuerte.media).toBeCloseTo(-4, 0);
    expect(Math.abs(perfil.timing.porPosicion.debil.media - 3)).toBeLessThan(1.5);
    expect(Math.abs(perfil.timing.porPosicion.contratiempo.media - 10)).toBeLessThan(1.5);
    expect(Math.abs(perfil.timing.porPosicion.subdivision.media - 6)).toBeLessThan(1.5);
    expect(perfil.confianza).toBe('alta');
  });

  it('mide dispersión y orden de los acordes', () => {
    expect(Math.abs(perfil.acordes.probArpegiado - 0.8)).toBeLessThan(0.15);
    expect(perfil.acordes.ordenAscendente).toBe(1);
    expect(Math.abs(perfil.acordes.msEntreNotas.media - 14)).toBeLessThan(2);
    expect(perfil.acordes.enfasisSuperior).toBeGreaterThan(perfil.acordes.enfasisBajo);
    expect(perfil.acordes.enfasisMedio).toBeLessThan(0);
  });

  it('mide microdinámica, articulación y arpegios', () => {
    expect(Math.abs(perfil.dinamica.porPosicion.fuerte.media - (100 + 0.5))).toBeLessThan(3);
    expect(perfil.dinamica.porPosicion.fuerte.media).toBeGreaterThan(perfil.dinamica.porPosicion.contratiempo.media);
    expect(Math.abs(perfil.articulacion.ratio.media - 0.85)).toBeLessThan(0.05);
    expect(perfil.arpegios.n).toBe(16);
    expect(perfil.muestras.acordes).toBe(32);
    expect(describirPerfilToque(perfil)).toMatch(/Micro-timing/);
  });

  it('marca confianza baja con pocas notas y no falla sin notas', () => {
    const pocas = aprenderPerfilToque(interpretar(patronCuantizado(1)), { bpm: BPM });
    expect(pocas.confianza).toBe('baja');
    const vacio = aprenderPerfilToque([], { bpm: BPM });
    expect(vacio.muestras.notas).toBe(0);
    expect(vacio.rango).toBeNull();
    expect(describirPerfilToque(vacio)).toMatch(/Sin notas/);
  });
});

describe('toque · aplicar', () => {
  const original = aprenderPerfilToque(interpretar(patronCuantizado()), { bpm: BPM, rejillaBeats: 0.25 });
  const cuantizadas = patronCuantizado();
  const nuevas = aplicarPerfilToque(cuantizadas, original, { bpm: BPM, semilla: 7 });
  const reaprendido = aprenderPerfilToque(nuevas, { bpm: BPM, rejillaBeats: 0.25 });

  it('aprender → aplicar reproduce estadísticas cercanas al original', () => {
    for (const pos of ['fuerte', 'debil', 'contratiempo', 'subdivision'] as const) {
      expect(Math.abs(reaprendido.timing.porPosicion[pos].media - original.timing.porPosicion[pos].media)).toBeLessThan(2.5);
      expect(Math.abs(reaprendido.dinamica.porPosicion[pos].media - original.dinamica.porPosicion[pos].media)).toBeLessThan(4);
    }
    expect(Math.abs(reaprendido.timing.global.sd - original.timing.global.sd)).toBeLessThan(2);
    expect(Math.abs(reaprendido.acordes.probArpegiado - original.acordes.probArpegiado)).toBeLessThan(0.2);
    expect(Math.abs(reaprendido.acordes.msEntreNotas.media - original.acordes.msEntreNotas.media)).toBeLessThan(3);
    expect(reaprendido.acordes.ordenAscendente).toBe(1);
    expect(Math.abs(reaprendido.acordes.enfasisSuperior - original.acordes.enfasisSuperior)).toBeLessThan(3);
    expect(Math.abs(reaprendido.articulacion.ratio.media - original.articulacion.ratio.media)).toBeLessThan(0.08);
  });

  it('es determinista con semilla y no altera nada con intensidad 0', () => {
    expect(aplicarPerfilToque(cuantizadas, original, { bpm: BPM, semilla: 7 })).toEqual(nuevas);
    expect(aplicarPerfilToque(cuantizadas, original, { bpm: BPM, semilla: 8 })).not.toEqual(nuevas);
    expect(aplicarPerfilToque(cuantizadas, original, { intensidad: 0 })).toEqual(cuantizadas);
    expect(aplicarPerfilToque([], original)).toEqual([]);
  });

  it('nunca adelanta notas antes de 0 ni rompe el orden de los acordes', () => {
    const adelantado = { ...original, timing: { ...original.timing, porPosicion: { ...original.timing.porPosicion, fuerte: { media: -40, sd: 5, n: 50 } } } };
    const r = aplicarPerfilToque(cuantizadas, adelantado, { bpm: BPM, semilla: 3 });
    expect(Math.min(...r.map((n) => n.inicio))).toBeGreaterThanOrEqual(0);
    // Cada acorde (mismo inicio original) sigue empezando después de todo lo anterior.
    const inicios = [...new Set(cuantizadas.map((n) => n.inicio))].sort((a, b) => a - b);
    let finAnterior = -1;
    for (const t of inicios) {
      const idx = cuantizadas.map((n, i) => (n.inicio === t ? i : -1)).filter((i) => i >= 0);
      const ts = idx.map((i) => r[i]!.inicio);
      expect(Math.min(...ts)).toBeGreaterThan(finAnterior);
      finAnterior = Math.max(...ts);
    }
    for (const n of r) {
      expect(n.velocidad).toBeGreaterThanOrEqual(1);
      expect(n.velocidad).toBeLessThanOrEqual(127);
      expect(n.duracion).toBeGreaterThan(0);
    }
  });

  it('conserva campos extra (id) y el orden del array de entrada', () => {
    const conId = cuantizadas.map((n, i) => ({ ...n, id: `n${i}` }));
    const r = aplicarPerfilToque(conId, original, { semilla: 1 });
    expect(r.map((n) => n.id)).toEqual(conId.map((n) => n.id));
  });

  it('batería: timing y dinámica por pieza', () => {
    const rng = crearRng(5);
    const toca: NotaToque[] = [];
    const cuant: NotaToque[] = [];
    for (let b = 0; b < 64; b += 0.5) {
      cuant.push({ pitch: 42, inicio: b, duracion: 0.1, velocidad: 90 });
      toca.push({ pitch: 42, inicio: b + (2 + 2 * rng.gauss()) / MS, duracion: 0.1, velocidad: Math.round(60 + 5 * rng.gauss()) });
      if (b % 2 === 1) {
        cuant.push({ pitch: 38, inicio: b, duracion: 0.1, velocidad: 90 });
        toca.push({ pitch: 38, inicio: b + (12 + 3 * rng.gauss()) / MS, duracion: 0.1, velocidad: Math.round(110 + 4 * rng.gauss()) });
      }
    }
    const perfil = aprenderPerfilToque(toca, { bpm: BPM, rejillaBeats: 0.25, instrumento: 'Batería' });
    expect(perfil.percusivo).toBe(true);
    expect(Math.abs(perfil.porPitch['38']!.timing.media - 12)).toBeLessThan(1.5);
    const r = aprenderPerfilToque(aplicarPerfilToque(cuant, perfil, { bpm: BPM, semilla: 2 }), { bpm: BPM, rejillaBeats: 0.25, instrumento: 'Batería' });
    expect(Math.abs(r.porPitch['38']!.timing.media - 12)).toBeLessThan(2);
    expect(Math.abs(r.porPitch['42']!.velocidad.media - 60)).toBeLessThan(4);
    expect(Math.abs(r.porPitch['38']!.velocidad.media - 110)).toBeLessThan(4);
  });
});
