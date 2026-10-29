import { describe, expect, it } from 'vitest';
import {
  intentarParsearAcorde,
  nombrarAcorde,
  parsearAcordeComplejo,
  pcDeNota,
  transponerAcorde,
  voicingDeAcorde,
} from '../music/acordes';
import { acordeDesdeToken, crearTonal } from '../music/worship/armonia';

const rel = (nombre: string) => parsearAcordeComplejo(nombre).intervalos;

describe('acordes · parser cromático', () => {
  it('tríadas, sus y power chord', () => {
    expect(rel('C')).toEqual([0, 4, 7]);
    expect(rel('Cm')).toEqual([0, 3, 7]);
    expect(rel('Caug')).toEqual([0, 4, 8]);
    expect(rel('C+')).toEqual([0, 4, 8]);
    expect(rel('Cdim')).toEqual([0, 3, 6]);
    expect(rel('C°')).toEqual([0, 3, 6]);
    expect(rel('Csus2')).toEqual([0, 2, 7]);
    expect(rel('Csus4')).toEqual([0, 5, 7]);
    expect(rel('Csus')).toEqual([0, 5, 7]);
    expect(rel('C5')).toEqual([0, 7]);
  });

  it('add, sextas', () => {
    expect(rel('Cadd9')).toEqual([0, 4, 7, 14]);
    expect(rel('Cadd11')).toEqual([0, 4, 7, 17]);
    expect(rel('C6')).toEqual([0, 4, 7, 9]);
    expect(rel('Cm6')).toEqual([0, 3, 7, 9]);
    expect(rel('C6/9')).toEqual([0, 4, 7, 9, 14]);
    expect(parsearAcordeComplejo('Cmadd9').nombre).toBe('Cmadd9');
  });

  it('séptimas', () => {
    expect(rel('C7')).toEqual([0, 4, 7, 10]);
    expect(rel('Cmaj7')).toEqual([0, 4, 7, 11]);
    expect(rel('CM7')).toEqual([0, 4, 7, 11]);
    expect(rel('CΔ7')).toEqual([0, 4, 7, 11]);
    expect(rel('Cm7')).toEqual([0, 3, 7, 10]);
    expect(rel('C-7')).toEqual([0, 3, 7, 10]);
    expect(rel('Cm7b5')).toEqual([0, 3, 6, 10]);
    expect(rel('Cø')).toEqual([0, 3, 6, 10]);
    expect(rel('Cdim7')).toEqual([0, 3, 6, 9]);
    expect(rel('Cm(maj7)')).toEqual([0, 3, 7, 11]);
    expect(rel('CmMaj7')).toEqual([0, 3, 7, 11]);
    expect(rel('C7sus4')).toEqual([0, 5, 7, 10]);
    expect(parsearAcordeComplejo('F#m7b5').calidad).toBe('semidisminuido');
    expect(parsearAcordeComplejo('G7').calidad).toBe('dominante');
  });

  it('novenas, oncenas, trecenas', () => {
    expect(rel('C9')).toEqual([0, 4, 7, 10, 14]);
    expect(rel('Cmaj9')).toEqual([0, 4, 7, 11, 14]);
    expect(rel('Cm9')).toEqual([0, 3, 7, 10, 14]);
    // 11 dominante omite la tercera (choque de novena menor)
    expect(rel('C11')).toEqual([0, 7, 10, 14, 17]);
    expect(rel('Cm11')).toEqual([0, 3, 7, 10, 14, 17]);
    expect(rel('C9#11')).toEqual([0, 4, 7, 10, 14, 18]);
    expect(rel('Cmaj7#11')).toEqual([0, 4, 7, 11, 18]);
    // 13 dominante omite la oncena
    expect(rel('C13')).toEqual([0, 4, 7, 10, 14, 21]);
    expect(rel('C7b13')).toEqual([0, 4, 7, 10, 20]);
    expect(rel('C13sus4')).toEqual([0, 5, 7, 10, 14, 21]);
  });

  it('alteraciones, paréntesis y alt', () => {
    expect(rel('C7b9')).toEqual([0, 4, 7, 10, 13]);
    expect(rel('C7(b9)')).toEqual([0, 4, 7, 10, 13]);
    expect(rel('C7#9')).toEqual([0, 4, 7, 10, 15]);
    expect(rel('C7b5')).toEqual([0, 4, 6, 10]);
    expect(rel('C7#5')).toEqual([0, 4, 8, 10]);
    expect(rel('C7(b9,#11)')).toEqual([0, 4, 7, 10, 13, 18]);
    expect(rel('C7b9#9')).toEqual([0, 4, 7, 10, 13, 15]);
    expect(parsearAcordeComplejo('C7b9#9').nombre).toBe('C7b9#9');
    expect(parsearAcordeComplejo('C13b9').nombre).toBe('C13b9');
    expect(rel('E7alt')).toEqual([0, 4, 10, 13, 15, 20]);
    expect(parsearAcordeComplejo('E7alt').calidad).toBe('alterado');
  });

  it('slash, ♯♭, mayúsculas/minúsculas y normalización', () => {
    const d = parsearAcordeComplejo('D/F#');
    expect(d.bajo).toBe('F#');
    expect(d.bajoPc).toBe(6);
    expect(d.nombre).toBe('D/F#');
    expect(parsearAcordeComplejo('Bb/D').nombre).toBe('Bb/D');
    expect(parsearAcordeComplejo('C/E').pcs).toEqual([0, 4, 7]);
    expect(parsearAcordeComplejo('E♭maj7').raiz).toBe('Eb');
    expect(parsearAcordeComplejo('F♯m7♭5').nombre).toBe('F#m7b5');
    expect(parsearAcordeComplejo('f#m7b5').nombre).toBe('F#m7b5');
    expect(parsearAcordeComplejo('dmaj7#11').nombre).toBe('Dmaj7#11');
    expect(parsearAcordeComplejo('bbm').nombre).toBe('Bbm');
    expect(parsearAcordeComplejo('C/C').bajo).toBeUndefined();
    expect(pcDeNota('Cb')).toBe(11);
  });

  it('rechaza lo que no es un acorde', () => {
    expect(intentarParsearAcorde('H7')).toBeNull();
    expect(intentarParsearAcorde('Cxyz')).toBeNull();
    expect(intentarParsearAcorde('')).toBeNull();
    expect(() => parsearAcordeComplejo('7')).toThrow();
  });

  it('pitches en la octava pedida', () => {
    expect(parsearAcordeComplejo('C').pitches(4)).toEqual([60, 64, 67]);
    expect(parsearAcordeComplejo('D/F#').pitches(4)).toEqual([54, 62, 66, 69]);
    expect(parsearAcordeComplejo('G13').pitches(3)).toEqual([55, 59, 62, 65, 69, 76]);
  });
});

describe('acordes · nombrador', () => {
  it('tríadas en posición fundamental e inversiones', () => {
    expect(nombrarAcorde([60, 64, 67])).toBe('C');
    expect(nombrarAcorde([64, 67, 72])).toBe('C/E');
    expect(nombrarAcorde([54, 62, 66, 69])).toBe('D/F#');
    expect(nombrarAcorde([57, 60, 64])).toBe('Am');
    expect(nombrarAcorde([62, 65, 70])).toBe('Bb/D');
  });

  it('séptimas y tensiones', () => {
    expect(nombrarAcorde([60, 64, 67, 71, 74])).toBe('Cmaj9');
    expect(nombrarAcorde([55, 59, 62, 65])).toBe('G7');
    expect(nombrarAcorde([62, 65, 69, 72])).toBe('Dm7');
    expect(nombrarAcorde([66, 69, 72, 76])).toBe('F#m7b5');
    expect(nombrarAcorde([60, 64, 67, 70, 73])).toBe('C7b9');
    expect(nombrarAcorde([60, 62, 67])).toBe('Csus2');
    expect(nombrarAcorde([60, 65, 67, 70])).toBe('C7sus4');
  });

  it('omisiones', () => {
    expect(nombrarAcorde([60, 64])).toBe('C(no5)');
    expect(nombrarAcorde([60, 64], { anotarOmisiones: false })).toBe('C');
    expect(nombrarAcorde([60, 67])).toBe('C5');
    // maj9 sin quinta se nombra igual (la quinta se omite en voicings de tensiones)
    expect(nombrarAcorde([60, 64, 71, 74])).toBe('Cmaj9');
    expect(nombrarAcorde([60])).toBeNull();
  });

  it('deletreo', () => {
    expect(nombrarAcorde([61, 65, 68], { bemoles: true })).toBe('Db');
    expect(nombrarAcorde([61, 65, 68], { bemoles: false })).toBe('C#');
  });
});

describe('acordes · voicing y transposición', () => {
  it('voicing con límite de voces y bajo', () => {
    expect(voicingDeAcorde('C', { octava: 4 })).toEqual([60, 64, 67]);
    const v = voicingDeAcorde('Cmaj9', { voces: 4 });
    expect(v).toHaveLength(4);
    expect(v.map((p) => p % 12)).not.toContain(7);
    const slash = voicingDeAcorde('D/F#', { octava: 4 });
    expect(slash[0]! % 12).toBe(6);
    expect(slash[0]!).toBeLessThan(slash[1]!);
    for (const p of voicingDeAcorde('G13', { rango: [60, 72] })) expect(p).toBeGreaterThanOrEqual(60);
  });

  it('transposición conserva sufijo y bajo', () => {
    expect(transponerAcorde('D/F#', 2)).toBe('E/G#');
    expect(transponerAcorde('Bbmaj7', 1)).toBe('Bmaj7');
    expect(transponerAcorde('F#m7b5', -1)).toBe('Fm7b5');
    expect(transponerAcorde('C7b9', 5, { bemoles: true })).toBe('F7b9');
  });
});

describe('armonia · respaldo cromático', () => {
  it('diatónico sigue saliendo por grados; no diatónico cae al parser cromático', () => {
    const tonal = crearTonal('D', 'mayor');
    const dia = acordeDesdeToken('Bm7', tonal);
    expect(dia.spec.grado).toBe(5);
    expect(dia.pcs.sort((a, b) => a - b)).toEqual([2, 6, 9, 11]);
    const crom = acordeDesdeToken('Bb', tonal);
    expect(crom.spec.grado).toBe(-1);
    expect(crom.simbolo).toBe('Bb');
    expect(crom.romano).toBe('bVI');
    expect(crom.pcs).toEqual([10, 2, 5]);
    const slash = acordeDesdeToken('C#m7b5/G', tonal);
    expect(slash.bajoPc).toBe(7);
    expect(slash.esMenor).toBe(true);
    expect(() => acordeDesdeToken('Hola', tonal)).toThrow();
  });
});
