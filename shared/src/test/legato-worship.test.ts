import { describe, expect, it } from 'vitest';
import { aplicarLegatoWorship, type NotaLegato } from '../music/legato-worship';

const n = (pitch: number, inicio: number, duracion: number, extra: Partial<NotaLegato> = {}): NotaLegato => ({ pitch, inicio, duracion, ...extra });
const fin = (x: NotaLegato) => x.inicio + x.duracion;

describe('aplicarLegatoWorship', () => {
  it('melodía staccato: sin huecos y con solape de 500 ms (120 bpm = 1 beat)', () => {
    const entrada = [n(60, 0, 0.25), n(62, 1, 0.25), n(64, 2, 0.25), n(65, 3, 0.25)];
    const { notas, resumen } = aplicarLegatoWorship(entrada, { bpm: 120, modo: 'legato' });
    expect(fin(notas[0]!)).toBeCloseTo(2, 6);
    expect(fin(notas[1]!)).toBeCloseTo(3, 6);
    expect(fin(notas[2]!)).toBeCloseTo(4, 6);
    expect(notas[3]!.duracion).toBeCloseTo(0.25, 6); // la última conserva su duración
    expect(resumen.alargadas).toBe(3);
    expect(resumen.huecosCerrados).toBe(3);
    expect(entrada[0]!.duracion).toBe(0.25); // no muta
  });

  it('el solape depende del bpm: 74 y 120', () => {
    const e = [n(60, 0, 0.5), n(62, 2, 0.5)];
    expect(fin(aplicarLegatoWorship(e, { bpm: 74, modo: 'legato' }).notas[0]!)).toBeCloseTo(2 + (500 * 74) / 60000, 6);
    expect(fin(aplicarLegatoWorship(e, { bpm: 120, modo: 'legato' }).notas[0]!)).toBeCloseTo(3, 6);
  });

  it('acordes: todas las notas del acorde llegan al mismo punto', () => {
    const e = [n(48, 0, 1), n(52, 0, 1), n(55, 0, 1), n(50, 4, 1), n(53, 4, 1), n(57, 4, 1)];
    const { notas } = aplicarLegatoWorship(e, { bpm: 120, modo: 'legato' });
    for (const i of [0, 1, 2]) expect(fin(notas[i]!)).toBeCloseTo(5, 6);
    expect(notas[3]!.duracion).toBe(1);
  });

  it('nunca acorta una nota que ya llega más lejos', () => {
    const e = [n(60, 0, 6), n(62, 2, 1)];
    expect(aplicarLegatoWorship(e, { bpm: 120, modo: 'legato' }).notas[0]!.duracion).toBe(6);
  });

  it('misma nota repetida: se recorta justo antes de su nueva entrada', () => {
    const e = [n(60, 0, 0.5), n(60, 2, 0.5), n(62, 4, 0.5)];
    const { notas } = aplicarLegatoWorship(e, { bpm: 120, modo: 'legato' });
    expect(fin(notas[0]!)).toBeLessThan(2);
    expect(fin(notas[0]!)).toBeGreaterThan(1.9);
    expect(fin(notas[1]!)).toBeCloseTo(5, 6);
  });

  it('hueco largo (silencio intencional) respetado; en pad se puentea', () => {
    const e = [n(60, 0, 1), n(62, 20, 1)];
    expect(aplicarLegatoWorship(e, { bpm: 120, modo: 'legato' }).notas[0]!.duracion).toBe(1);
    expect(aplicarLegatoWorship(e, { bpm: 120, modo: 'pad' }).notas[0]!.duracion).toBeCloseTo(22, 6);
  });

  it('pad: solape de 1 s, no cruza cortes de sección y el último llega al fin del clip', () => {
    const e = [n(48, 0, 4), n(50, 8, 4), n(52, 16, 4)];
    const { notas } = aplicarLegatoWorship(e, { bpm: 120, modo: 'pad', finClip: 24 });
    expect(fin(notas[0]!)).toBeCloseTo(10, 6);
    expect(fin(notas[1]!)).toBeCloseTo(18, 6);
    expect(fin(notas[2]!)).toBe(24);
    const corte = aplicarLegatoWorship(e, { bpm: 120, modo: 'pad', finClip: 24, cortes: [8] }).notas;
    expect(corte[0]!.duracion).toBe(4);
  });

  it('no pasa de finClip', () => {
    const e = [n(60, 0, 0.5), n(62, 3.8, 0.1)];
    expect(fin(aplicarLegatoWorship(e, { bpm: 120, modo: 'legato', finClip: 4 }).notas[0]!)).toBeCloseTo(4, 6);
  });

  it('las notas con mute no se tocan ni cuentan como siguiente', () => {
    const e = [n(60, 0, 0.5), n(61, 1, 0.5, { mute: true }), n(62, 3, 0.5)];
    const { notas } = aplicarLegatoWorship(e, { bpm: 120, modo: 'legato' });
    expect(notas[1]!.duracion).toBe(0.5);
    expect(fin(notas[0]!)).toBeCloseTo(4, 6);
  });

  it('es idempotente', () => {
    const e = [n(60, 0, 0.25), n(60, 1, 0.25), n(64, 1, 0.25), n(65, 1.5, 0.25), n(67, 30, 1), n(60, 31, 0.5)];
    const una = aplicarLegatoWorship(e, { bpm: 74, modo: 'legato', finClip: 40 });
    const dos = aplicarLegatoWorship(una.notas, { bpm: 74, modo: 'legato', finClip: 40 });
    expect(dos.notas).toEqual(una.notas);
    expect(dos.resumen.alargadas).toBe(0);
    const p1 = aplicarLegatoWorship(e, { bpm: 74, modo: 'pad', finClip: 40 });
    expect(aplicarLegatoWorship(p1.notas, { bpm: 74, modo: 'pad', finClip: 40 }).notas).toEqual(p1.notas);
  });

  it('la batería la excluye quien llama: sin llamada no hay cambios', () => {
    const bateria = [n(36, 0, 0.1), n(38, 1, 0.1)];
    const pistas = [{ bateria: true, notas: bateria }];
    const salida = pistas.map((p) => (p.bateria ? p.notas : aplicarLegatoWorship(p.notas, { bpm: 120, modo: 'legato' }).notas));
    expect(salida[0]).toBe(bateria);
  });
});
