import { describe, expect, it } from 'vitest';
import { construirAcorde, crearTonal, parsearAcorde, tonosLimitados } from './armonia';
import { componerWorship } from './compositor';
import { validarArregloWorship } from './validador';

const C = crearTonal('C', 'mayor');
const simbolo = (tok: string) => construirAcorde(C, parsearAcorde(tok, C)).simbolo;

describe('acordes de color jazz-pop (diatónicos)', () => {
  it('novenas, oncenas y 13sus con los nombres correctos', () => {
    expect(simbolo('IVmaj9')).toBe('Fmaj9');
    expect(simbolo('iii9')).toBe('Em9');
    expect(simbolo('vi9')).toBe('Am9');
    expect(simbolo('V9')).toBe('G9');
    expect(simbolo('ii11')).toBe('Dm11');
    expect(simbolo('IV11')).toBe('Fmaj7#11'); // la 11 de IV es aumentada: se conserva la tercera
    expect(simbolo('V11')).toBe('G11'); // 11 justa sobre tercera mayor: sin tercera
    expect(simbolo('V13sus4')).toBe('G13sus4');
  });

  it('acepta símbolos (los de la intro del tutorial) y rechaza calidades erróneas', () => {
    for (const t of ['Fmaj9', 'Am9', 'Dm11', 'G13sus', 'G13sus4', 'Fmaj7#11']) expect(() => parsearAcorde(t, C)).not.toThrow();
    expect(() => parsearAcorde('Dmaj9', C)).toThrow(); // D es menor en Do mayor
    expect(() => parsearAcorde('Fm9', C)).toThrow();
  });

  it('G11 no contiene la tercera (B) y Dm11 sí la conserva (F)', () => {
    const g11 = construirAcorde(C, parsearAcorde('V11', C));
    expect(g11.pcs).not.toContain(11);
    expect(g11.pcs).toContain(0);
    const dm11 = construirAcorde(C, parsearAcorde('ii11', C));
    expect(dm11.pcs).toEqual(expect.arrayContaining([2, 5, 9, 0, 4, 7]));
  });

  it('al limitar voces se conservan fundamental, tercera y séptima', () => {
    const a = construirAcorde(C, parsearAcorde('IVmaj9', C));
    expect(tonosLimitados(a, 3).sort()).toEqual([4, 5, 9].sort());
  });

  it('el compositor produce un arreglo válido con progresiones de color', () => {
    const arreglo = componerWorship({
      semilla: 3,
      tonalidad: { raiz: 'C', escala: 'mayor' },
      secciones: [
        { tipo: 'verso', compases: 4, progresion: ['IVmaj9', 'iii9', 'ii11', 'V13sus4'] },
        { tipo: 'coro', compases: 4, progresion: ['I', 'V/3', 'vi9', 'IV11'], intensidad: 0.9 },
      ],
    });
    const v = validarArregloWorship(arreglo);
    expect(v.problemas).toEqual([]);
    expect(v.ok).toBe(true);
  });
});
