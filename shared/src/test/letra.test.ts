import { describe, expect, it } from 'vitest';
import { acordesComoTexto, acordesDesdeTexto, repartirLetra, silabaEn, silabasDeLinea, silabear } from '../music/letra';

describe('letra · silabeo español', () => {
  it('casos básicos', () => {
    expect(silabear('presencia')).toEqual(['pre', 'sen', 'cia']);
    expect(silabear('santo')).toEqual(['san', 'to']);
    expect(silabear('gloria')).toEqual(['glo', 'ria']);
    expect(silabear('Dios')).toEqual(['Dios']);
    expect(silabear('amor')).toEqual(['a', 'mor']);
    expect(silabear('transformar')).toEqual(['trans', 'for', 'mar']);
    expect(silabear('construir')).toEqual(['cons', 'truir']);
    expect(silabear('calle')).toEqual(['ca', 'lle']);
    expect(silabear('perro')).toEqual(['pe', 'rro']);
    expect(silabear('chocolate')).toEqual(['cho', 'co', 'la', 'te']);
  });

  it('hiatos, diptongos, acentos y u muda', () => {
    expect(silabear('María')).toEqual(['Ma', 'rí', 'a']);
    expect(silabear('río')).toEqual(['rí', 'o']);
    expect(silabear('poeta')).toEqual(['po', 'e', 'ta']);
    expect(silabear('cielo')).toEqual(['cie', 'lo']);
    expect(silabear('aquí')).toEqual(['a', 'quí']);
    expect(silabear('guerra')).toEqual(['gue', 'rra']);
    expect(silabear('ahí')).toEqual(['a', 'hí']);
    expect(silabear('rey')).toEqual(['rey']);
    expect(silabear('corazón')).toEqual(['co', 'ra', 'zón']);
    expect(silabear('leer')).toEqual(['le', 'er']);
  });

  it('línea completa con puntuación y fin de palabra', () => {
    const s = silabasDeLinea('Tu presencia, Señor');
    expect(s.map((x) => x.texto)).toEqual(['Tu', 'pre', 'sen', 'cia,', 'Se', 'ñor']);
    expect(s.map((x) => x.finPalabra)).toEqual([true, false, false, true, false, true]);
  });
});

describe('letra · reparto en el tiempo', () => {
  const id = (() => {
    let n = 0;
    return () => `f${++n}`;
  })();

  it('sin secciones: compases por frase', () => {
    const f = repartirLetra('Santo santo\nDigno es', { numerador: 4, compasesPorFrase: 2, id });
    expect(f).toHaveLength(2);
    expect(f[0]!.silabas.map((s) => s.beat)).toEqual([0, 2, 4, 6]);
    expect(f[0]!.silabas[0]!.duracion).toBe(2);
    expect(f[1]!.silabas[0]!.beat).toBe(8);
  });

  it('con secciones: estrofa i → sección i', () => {
    const f = repartirLetra('Verso uno\nVerso dos\n\nCoro aquí', {
      numerador: 4,
      secciones: [
        { nombre: 'Verso', beat: 0 },
        { nombre: 'Coro', beat: 16 },
      ],
      id,
    });
    expect(f.map((x) => x.seccion)).toEqual(['Verso', 'Verso', 'Coro']);
    expect(f[0]!.silabas[0]!.beat).toBe(0);
    expect(f[1]!.silabas[0]!.beat).toBe(8);
    expect(f[2]!.silabas[0]!.beat).toBe(16);
  });

  it('silabaEn encuentra la sílaba activa', () => {
    const f = repartirLetra('la la la la', { numerador: 4, compasesPorFrase: 1, id });
    expect(silabaEn(f, 2.5)).toEqual({ fraseId: f[0]!.id, indice: 2 });
    expect(silabaEn(f, 9)).toBeNull();
  });
});

describe('letra · acordes como texto', () => {
  const id = () => 'x';
  it('barras y repeticiones', () => {
    const a = acordesDesdeTexto('| D | Bm | G A | % |', { numerador: 4, id })!;
    expect(a.map((x) => [x.nombre, x.beat, x.duracion])).toEqual([
      ['D', 0, 4],
      ['Bm', 4, 4],
      ['G', 8, 2],
      ['A', 10, 6],
    ]);
    expect(acordesDesdeTexto('D Bm G A', { numerador: 3, id })!.map((x) => x.beat)).toEqual([0, 3, 6, 9]);
    expect(acordesDesdeTexto('D Hm', { numerador: 4, id })).toBeNull();
  });

  it('ida y vuelta', () => {
    const a = acordesDesdeTexto('| Dmaj9 | Bm7 | G A/C# |', { numerador: 4, id })!;
    expect(acordesComoTexto(a, 4)).toBe('| Dmaj9 | Bm7 | G A/C# |');
  });
});
