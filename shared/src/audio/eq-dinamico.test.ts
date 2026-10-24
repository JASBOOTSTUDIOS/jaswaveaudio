import { describe, expect, it } from 'vitest';
import {
  EQ_BANDAS_HEREDADAS,
  EQ_MAX_BANDAS,
  eqAjustesABandas,
  eqBandasAAjustes,
  eqDiferencias,
  eqFrecuenciaLibre,
  eqNormalizadoAValor,
  eqParamId,
  eqPerfilParametros,
  eqPrimerSlotLibre,
  eqResumenCambios,
  eqValorANormalizado,
  normalizarTipoEq,
  tipoEqACodigo,
  type BandaEq,
  type CampoBandaEq,
} from './eq-dinamico';

const banda = (extra: Partial<BandaEq> = {}): BandaEq => ({ freq: 1000, gain: 0, q: 1, type: 'bell', enabled: true, ...extra });

describe('eq-dinamico: contrato con el VST', () => {
  it('los IDs de las 8 bandas heredadas no cambian (compatibilidad con JasWave EQ / JasWaveFx)', () => {
    expect(eqParamId(0, 'type')).toBe(1);
    expect(eqParamId(0, 'enabled')).toBe(5);
    expect(eqParamId(7, 'enabled')).toBe(40);
    for (let s = 0; s < EQ_BANDAS_HEREDADAS; s++) expect(eqParamId(s, 'freq')).toBe(1 + s * 5 + 1);
  });

  it('todos los IDs son únicos y están dentro del pool', () => {
    const campos: CampoBandaEq[] = ['type', 'freq', 'gain', 'q', 'enabled', 'used', 'slope', 'mode', 'solo'];
    const ids = new Set<number>();
    for (let s = 0; s < EQ_MAX_BANDAS; s++) for (const c of campos) ids.add(eqParamId(s, c));
    expect(ids.size).toBe(EQ_MAX_BANDAS * campos.length);
    expect(() => eqParamId(EQ_MAX_BANDAS, 'freq')).toThrow(RangeError);
  });
});

describe('eq-dinamico: tipos y normalización', () => {
  it('los códigos de tipo son los del VST y los alias se resuelven', () => {
    expect(tipoEqACodigo('lowCut')).toBe(0);
    expect(tipoEqACodigo('bell')).toBe(2);
    expect(tipoEqACodigo('highCut')).toBe(4);
    expect(tipoEqACodigo('notch')).toBe(5);
    expect(tipoEqACodigo('bandPass')).toBe(6);
    expect(normalizarTipoEq('Peak')).toBe('bell');
    expect(normalizarTipoEq('HPF')).toBe('lowCut');
    expect(normalizarTipoEq('low_shelf')).toBe('lowShelf');
    expect(normalizarTipoEq('xyz')).toBeUndefined();
  });

  it('ida y vuelta valor ↔ normalizado (frecuencia logarítmica, pasos exactos)', () => {
    expect(eqValorANormalizado('freq', 20)).toBeCloseTo(0, 6);
    expect(eqValorANormalizado('freq', 20000)).toBeCloseTo(1, 6);
    expect(eqNormalizadoAValor('freq', eqValorANormalizado('freq', 440))).toBeCloseTo(440, 3);
    expect(eqNormalizadoAValor('gain', eqValorANormalizado('gain', -6.5))).toBeCloseTo(-6.5, 6);
    expect(eqNormalizadoAValor('type', eqValorANormalizado('type', 5))).toBe(5);
    expect(eqValorANormalizado('gain', 100)).toBe(1); // acota
  });
});

describe('eq-dinamico: bandas ↔ parámetros', () => {
  it('una lista de bandas se convierte a ajustes y vuelve igual', () => {
    const bandas: BandaEq[] = [
      banda({ type: 'lowCut', freq: 80, slope: 24 }),
      banda({ type: 'bell', freq: 340, gain: -4.5, q: 1.6 }),
      banda({ type: 'highShelf', freq: 9000, gain: 2.5, mode: 'mid', solo: true }),
    ];
    const ajustes = eqBandasAAjustes(bandas);
    const mapa = new Map(ajustes.map((a) => [a.paramId, a.normalizado]));
    const leidas = eqAjustesABandas((id) => mapa.get(id));
    expect(leidas).toHaveLength(3);
    expect(leidas.map((b) => b.slot)).toEqual([0, 1, 2]);
    expect(leidas[0]).toMatchObject({ type: 'lowCut', slope: 24, enabled: true });
    expect(leidas[1]!.freq).toBeCloseTo(340, 1);
    expect(leidas[1]!.gain).toBeCloseTo(-4.5, 2);
    expect(leidas[2]).toMatchObject({ type: 'highShelf', mode: 'mid', solo: true });
    expect(leidas[1]!.slope).toBeUndefined();
  });

  it('los slots que ya no corresponden a ninguna banda se apagan (quitar banda)', () => {
    const ajustes = eqBandasAAjustes([banda()], [0, 1, 5]);
    const apagados = ajustes.filter((a) => a.campo === 'used' && a.normalizado === 0).map((a) => a.slot);
    expect(apagados).toEqual([1, 5]);
  });

  it('respeta el slot de una banda y no pisa slots ocupados', () => {
    const ajustes = eqBandasAAjustes([banda({ slot: 3 }), banda(), banda()]);
    const slots = [...new Set(ajustes.map((a) => a.slot))].sort();
    expect(slots).toEqual([0, 1, 3]);
  });

  it('más de 24 bandas es un error claro', () => {
    expect(() => eqBandasAAjustes(Array.from({ length: EQ_MAX_BANDAS + 1 }, () => banda()))).toThrow(/Máximo 24/);
  });

  it('primer slot libre respeta la licencia de bandas avanzadas', () => {
    expect(eqPrimerSlotLibre([0, 1, 2])).toBe(3);
    expect(eqPrimerSlotLibre([0, 1, 2, 3], true)).toBe(4);
    expect(eqPrimerSlotLibre([0, 1, 2, 3], false)).toBeUndefined();
    expect(eqPrimerSlotLibre(Array.from({ length: EQ_MAX_BANDAS }, (_, i) => i))).toBeUndefined();
  });

  it('frecuencia sugerida: el hueco más ancho entre las bandas', () => {
    const f = eqFrecuenciaLibre([banda({ freq: 100 }), banda({ freq: 200 })]);
    expect(f).toBeGreaterThan(1000);
    expect(f).toBeLessThan(20000);
  });
});

describe('eq-dinamico: auditoría', () => {
  it('lista cada parámetro cambiado, y las altas/bajas de banda', () => {
    const antes = [banda({ slot: 0, gain: -2 }), banda({ slot: 1, freq: 500 })];
    const despues = [banda({ slot: 0, gain: -6 }), banda({ slot: 2, freq: 3000 })];
    const cambios = eqDiferencias(antes, despues);
    expect(cambios).toEqual([
      { slot: 0, campo: 'gain', antes: -2, despues: -6 },
      { slot: 1, campo: 'banda', antes: 'existente', despues: 'quitada' },
      { slot: 2, campo: 'banda', antes: null, despues: 'agregada' },
    ]);
    expect(eqResumenCambios(cambios)[0]).toBe('B1 gain: -2 dB → -6 dB');
  });

  it('sin cambios no hay registro', () => {
    expect(eqDiferencias([banda({ slot: 0 })], [banda({ slot: 0 })])).toEqual([]);
  });
});

describe('eq-dinamico: perfil para la IA', () => {
  it('genera nombres "Banda N Freq" y cubre las 24 bandas', () => {
    const perfil = eqPerfilParametros();
    expect(perfil.find((p) => p.name === 'Banda 3 Freq')?.id).toBe(eqParamId(2, 'freq'));
    expect(perfil.find((p) => p.name === 'Banda 24 Usada')?.default).toBe(0);
    expect(perfil.find((p) => p.name === 'Banda 1 Usada')?.default).toBe(1);
    expect(new Set(perfil.map((p) => p.id)).size).toBe(perfil.length);
    expect(perfil).toHaveLength(1 + EQ_MAX_BANDAS * 9 + 3);
  });
});
