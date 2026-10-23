import { describe, it, expect } from 'vitest';
import { validarManifiesto, aliasPlugin, type ManifiestoPlugin } from '../plugins/manifiesto';
import { herramientasDesdeManifiesto, traducirAjuste, normalizarValor, describirPlugin } from '../plugins/herramientas-ia';

const base = () => ({
  id: 'com.jaswave.plugin.param-eq',
  name: 'JasWave EQ Parametric Pro',
  version: '1.0.0',
  category: 'audio-effect',
  vendor: 'JasWave Audio',
  targetPlatforms: ['win-x64'],
  entrypoints: { dspDesktop: 'bin/JasWaveParamEq.vst3' },
  vst3: { classId: '{4A15A3A0-3C1A-4C4F-B19A-8E40280D5E01}', subCategories: 'Fx|EQ' },
  permissions: { realtimeAudio: true, fileSystem: 'none', network: false, commands: ['plugin.setParameter'] },
  rolesAllowed: ['mix', 'mastering'],
  license: { productId: 'com.jaswave.plugin.param-eq', features: [{ key: 'eq.bandas-avanzadas', description: 'Bandas 5–8' }] },
  ai: {
    summary: 'EQ de 8 bandas',
    intents: ['cortar-graves'],
    parameters: [
      { id: 'b1.freq', vstParamId: 2, name: 'Banda 1 Frecuencia', min: 20, max: 20000, default: 100, unit: 'Hz', scale: 'log', feature: null },
      { id: 'b1.gain', vstParamId: 3, name: 'Banda 1 Ganancia', min: -24, max: 24, default: 0, unit: 'dB', scale: 'linear', feature: null },
      { id: 'b5.gain', vstParamId: 23, name: 'Banda 5 Ganancia', min: -24, max: 24, default: 0, unit: 'dB', scale: 'linear', feature: 'eq.bandas-avanzadas' },
    ],
  },
});

const valido = (): ManifiestoPlugin => {
  const r = validarManifiesto(base());
  if (!r.ok) throw new Error(r.errores.join('\n'));
  return r.manifiesto;
};

describe('P1 — manifiesto V5', () => {
  it('acepta un manifiesto completo y normaliza alias de roles', () => {
    const m = valido();
    expect(m.rolesAllowed).toEqual(['mezcla', 'mastering']);
    expect(aliasPlugin(m)).toBe('param-eq');
  });

  it('acepta texto JSON y rechaza JSON roto sin lanzar', () => {
    expect(validarManifiesto(JSON.stringify(base())).ok).toBe(true);
    expect(validarManifiesto('{no json')).toEqual({ ok: false, errores: ['JSON mal formado'] });
  });

  it.each([
    ['ruta absoluta en entrypoint', { entrypoints: { dspDesktop: 'C:\\Windows\\evil.dll' } }],
    ['ruta con ..', { entrypoints: { aiSkill: '../../fuera.js' } }],
    ['sin entrypoints', { entrypoints: {} }],
    ['dspDesktop sin vst3', { vst3: undefined }],
    ['rol desconocido', { rolesAllowed: ['hacker'] }],
    ['id sin dominio inverso', { id: 'EQ' }],
    ['versión no semver', { version: 'v1' }],
  ])('rechaza: %s', (_n, cambio) => {
    const r = validarManifiesto({ ...base(), ...cambio });
    expect(r.ok).toBe(false);
  });

  it('rechaza un parámetro que usa una feature no declarada, o rango/default inválidos', () => {
    const m = base();
    m.ai.parameters[0]!.feature = 'eq.inexistente' as never;
    expect(validarManifiesto(m).ok).toBe(false);
    const n = base();
    n.ai.parameters[1]!.default = 99;
    expect(validarManifiesto(n).ok).toBe(false);
  });
});

describe('P1 — herramientas de IA desde el manifiesto', () => {
  it('genera describir (read) y ajustar (write) bajo el espacio del plugin', () => {
    const tools = herramientasDesdeManifiesto(valido());
    expect(tools.map((t) => [t.name, t.actionClass])).toEqual([
      ['plugin.param-eq.describir', 'read'],
      ['plugin.param-eq.ajustar', 'write'],
    ]);
  });

  it('sin permiso plugin.setParameter no expone ajustar', () => {
    const r = validarManifiesto({ ...base(), permissions: { ...base().permissions, commands: [] } });
    expect(r.ok && herramientasDesdeManifiesto(r.manifiesto).map((t) => t.name)).toEqual(['plugin.param-eq.describir']);
  });

  it('normaliza valores con escala log y lineal', () => {
    const [freq, gain] = valido().ai!.parameters;
    expect(normalizarValor(freq!, 20)).toBe(0);
    expect(normalizarValor(freq!, 20000)).toBeCloseTo(1, 10);
    expect(normalizarValor(freq!, 632.4555)).toBeCloseTo(0.5, 4);
    expect(normalizarValor(gain!, 0)).toBe(0.5);
    expect(normalizarValor(gain!, 100)).toBe(1); // se limita al rango
  });

  it('traduce ajustar a plugin.setParameter con el ParamID VST3', () => {
    const cmds = traducirAjuste(valido(), { trackId: 't1', pluginInstanceId: 'p1', valores: { 'b1.gain': 6 } });
    expect(cmds).toEqual([
      {
        type: 'plugin.setParameter',
        payload: { trackId: 't1', pluginInstanceId: 'p1', parameterId: '3', normalizedValue: 0.625, plainValue: 6, name: 'Banda 1 Ganancia' },
      },
    ]);
  });

  it('bloquea parámetros desconocidos y los que la licencia no concede', () => {
    const m = valido();
    expect(() => traducirAjuste(m, { trackId: 't', pluginInstanceId: 'p', valores: { nada: 1 } })).toThrow(/desconocido/);
    expect(() => traducirAjuste(m, { trackId: 't', pluginInstanceId: 'p', valores: { 'b5.gain': 3 } }, [])).toThrow(/licencia/);
    expect(traducirAjuste(m, { trackId: 't', pluginInstanceId: 'p', valores: { 'b5.gain': 3 } }, ['eq.bandas-avanzadas'])).toHaveLength(1);
    expect(describirPlugin(m, []).parametros.find((p) => p.id === 'b5.gain')?.disponible).toBe(false);
  });
});
