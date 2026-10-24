/**
 * EQ dinámico de JasWave: modelo único de banda + traducción a los parámetros del VST3 "JasWave EQ Parametric Pro".
 *
 * El VST3 expone una lista de parámetros FIJA (así la automatizan Reaper y el resto de DAW), por eso "agregar o quitar
 * una banda" es activar/desactivar un slot de un pool de EQ_MAX_BANDAS con IDs estables. Este módulo es la única fuente
 * de verdad de ese contrato en TypeScript y espeja `plugins/com.jaswave.plugin.param-eq/src/param_eq_dsp.h`
 * (bandParam / extParam). Si cambia el C++, cambia aquí (hay una prueba que lo comprueba contra el manifiesto).
 *
 * Es puro (sin E/S): lo usan los comandos del dominio, la IA, el puente al host y la UI.
 */

/** Slots de banda del VST (antes 8). */
export const EQ_MAX_BANDAS = 24;
/** Las 8 primeras bandas conservan los IDs 1..40 de "JasWave EQ" / JasWaveFx. */
export const EQ_BANDAS_HEREDADAS = 8;
/** Índice (0-based) desde el que una banda requiere la feature de licencia `eq.bandas-avanzadas`. */
export const EQ_PRIMERA_BANDA_AVANZADA = 4;

/** IDs de los parámetros globales del VST. */
export const EQ_PARAM_GLOBAL = { bypass: 0, salida: 41, pendiente: 42, analizador: 43 } as const;

/** Tipos de banda. `lowCut`/`highCut` son los HPF/LPF; `bell` es el peak. */
export type TipoBandaEq = 'lowCut' | 'lowShelf' | 'bell' | 'highShelf' | 'highCut' | 'notch' | 'bandPass';
export type ModoBandaEq = 'stereo' | 'mid' | 'side' | 'left' | 'right';
/** Pendiente propia de una banda de corte en dB/oct (undefined = usa la global del EQ). */
export type PendienteEq = 12 | 24 | 36 | 48;

/** Orden = código del VST (BandType en param_eq_dsp.h). */
export const TIPOS_BANDA_EQ: readonly TipoBandaEq[] = ['lowCut', 'lowShelf', 'bell', 'highShelf', 'highCut', 'notch', 'bandPass'];
export const MODOS_BANDA_EQ: readonly ModoBandaEq[] = ['stereo', 'mid', 'side', 'left', 'right'];
const PENDIENTES: readonly PendienteEq[] = [12, 24, 36, 48];

/** Alias aceptados al leer tipos (la IA y los proyectos antiguos usan nombres distintos). */
const ALIAS_TIPO: Record<string, TipoBandaEq> = {
  lowcut: 'lowCut', hpf: 'lowCut', highpass: 'lowCut', lowshelf: 'lowShelf', ls: 'lowShelf',
  bell: 'bell', peak: 'bell', peaking: 'bell', highshelf: 'highShelf', hs: 'highShelf',
  highcut: 'highCut', lpf: 'highCut', lowpass: 'highCut', notch: 'notch', bandpass: 'bandPass', bp: 'bandPass',
};
export function normalizarTipoEq(valor: unknown): TipoBandaEq | undefined {
  if (typeof valor !== 'string') return undefined;
  return ALIAS_TIPO[valor.replace(/[\s_-]/g, '').toLowerCase()];
}
export function tipoEqACodigo(tipo: TipoBandaEq): number {
  return TIPOS_BANDA_EQ.indexOf(tipo);
}
export function codigoEqATipo(codigo: number): TipoBandaEq {
  return TIPOS_BANDA_EQ[Math.max(0, Math.min(TIPOS_BANDA_EQ.length - 1, Math.round(codigo)))]!;
}
/** ¿El tipo usa ganancia? (los cortes y notch/band-pass no). */
export function tipoEqConGanancia(tipo: TipoBandaEq): boolean {
  return tipo === 'lowShelf' || tipo === 'bell' || tipo === 'highShelf';
}

/** Banda del ecualizador (valores reales: Hz, dB, Q). */
export type BandaEq = {
  /** Slot del VST (0..EQ_MAX_BANDAS-1). Lo asigna el sistema al agregar. */
  slot?: number;
  freq: number;
  gain: number;
  q: number;
  type: TipoBandaEq;
  enabled: boolean;
  /** Pendiente propia (solo cortes). */
  slope?: PendienteEq;
  mode?: ModoBandaEq;
  solo?: boolean;
}

export type CampoBandaEq = 'type' | 'freq' | 'gain' | 'q' | 'enabled' | 'used' | 'slope' | 'mode' | 'solo';

/** ID de VST de un campo de una banda (espeja bandParam / extParam del C++). */
export function eqParamId(slot: number, campo: CampoBandaEq): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= EQ_MAX_BANDAS) throw new RangeError(`Slot de banda fuera de rango: ${slot}`);
  const base = (campoBase: number) =>
    slot < EQ_BANDAS_HEREDADAS ? 1 + slot * 5 + campoBase : 400 + (slot - EQ_BANDAS_HEREDADAS) * 5 + campoBase;
  const ext = (campoExt: number) => 100 + slot * 8 + campoExt;
  switch (campo) {
    case 'type': return base(0);
    case 'freq': return base(1);
    case 'gain': return base(2);
    case 'q': return base(3);
    case 'enabled': return base(4);
    case 'used': return ext(0);
    case 'slope': return ext(1);
    case 'mode': return ext(2);
    case 'solo': return ext(3);
  }
}

type Rango = { min: number; max: number; escala: 'lineal' | 'log' | 'paso'; pasos?: number; defecto: number };
/** Rangos de cada campo (espeja paramDefs() del C++). */
export const EQ_RANGOS: Record<CampoBandaEq, Rango> = {
  type: { min: 0, max: TIPOS_BANDA_EQ.length - 1, escala: 'paso', pasos: TIPOS_BANDA_EQ.length - 1, defecto: 2 },
  freq: { min: 20, max: 20000, escala: 'log', defecto: 1000 },
  gain: { min: -24, max: 24, escala: 'lineal', defecto: 0 },
  q: { min: 0.1, max: 18, escala: 'lineal', defecto: 1 },
  enabled: { min: 0, max: 1, escala: 'paso', pasos: 1, defecto: 1 },
  used: { min: 0, max: 1, escala: 'paso', pasos: 1, defecto: 0 },
  /** 0 = global; 1..4 = 12..48 dB/oct */
  slope: { min: 0, max: 4, escala: 'paso', pasos: 4, defecto: 0 },
  mode: { min: 0, max: MODOS_BANDA_EQ.length - 1, escala: 'paso', pasos: MODOS_BANDA_EQ.length - 1, defecto: 0 },
  solo: { min: 0, max: 1, escala: 'paso', pasos: 1, defecto: 0 },
};

const acotar = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

/**
 * Valores de fábrica de una banda (espeja bandDefault() del C++): las 8 heredadas tienen tipo/frecuencia/estado propios
 * (HPF y LPF apagados) y los slots 9..24 son peaks repartidos en escala logarítmica (120 Hz … 9 kHz), sin usar.
 */
export function eqDefectoBanda(slot: number): { type: TipoBandaEq; freq: number; q: number; enabled: boolean; used: boolean } {
  const heredadas: Array<{ type: TipoBandaEq; freq: number; q: number; enabled: boolean }> = [
    { type: 'lowCut', freq: 30, q: 0.71, enabled: false },
    { type: 'lowShelf', freq: 100, q: 0.71, enabled: true },
    { type: 'bell', freq: 250, q: 1, enabled: true },
    { type: 'bell', freq: 1000, q: 1, enabled: true },
    { type: 'bell', freq: 3000, q: 1, enabled: true },
    { type: 'bell', freq: 6000, q: 1, enabled: true },
    { type: 'highShelf', freq: 10000, q: 0.71, enabled: true },
    { type: 'highCut', freq: 18000, q: 0.71, enabled: false },
  ];
  if (slot < EQ_BANDAS_HEREDADAS) return { ...heredadas[slot]!, used: true };
  const t = (slot - EQ_BANDAS_HEREDADAS) / (EQ_MAX_BANDAS - EQ_BANDAS_HEREDADAS - 1);
  return { type: 'bell', freq: 120 * Math.pow(9000 / 120, t), q: 1, enabled: true, used: false };
}

/** Valor real → normalizado (0..1) del VST. */
export function eqValorANormalizado(campo: CampoBandaEq, valor: number): number {
  const r = EQ_RANGOS[campo];
  const v = acotar(valor, r.min, r.max);
  switch (r.escala) {
    case 'paso': return r.pasos ? Math.round(v) / r.pasos : 0;
    case 'log': return acotar(Math.log(v / r.min) / Math.log(r.max / r.min));
    default: return acotar((v - r.min) / (r.max - r.min));
  }
}
/** Normalizado del VST → valor real. */
export function eqNormalizadoAValor(campo: CampoBandaEq, normalizado: number): number {
  const r = EQ_RANGOS[campo];
  const n = acotar(normalizado);
  switch (r.escala) {
    case 'paso': return Math.round(n * (r.pasos ?? 1));
    case 'log': return r.min * Math.pow(r.max / r.min, n);
    default: return r.min + (r.max - r.min) * n;
  }
}

/** Valores reales (planos) de una banda como los guarda el VST, listos para normalizar. */
function camposDeBanda(b: BandaEq): Record<CampoBandaEq, number> {
  const tipo = tipoEqACodigo(b.type);
  return {
    type: tipo < 0 ? EQ_RANGOS.type.defecto : tipo,
    freq: b.freq,
    gain: b.gain,
    q: b.q,
    enabled: b.enabled ? 1 : 0,
    used: 1,
    slope: b.slope ? PENDIENTES.indexOf(b.slope) + 1 : 0,
    mode: Math.max(0, MODOS_BANDA_EQ.indexOf(b.mode ?? 'stereo')),
    solo: b.solo ? 1 : 0,
  };
}

export type AjusteParametroVst = {
  paramId: number;
  /** 0..1 */
  normalizado: number;
  campo: CampoBandaEq;
  slot: number;
}

/**
 * Convierte una lista de bandas a los ajustes de parámetros del VST.
 * Las bandas se asignan a slots 0..n-1 (o a `slot` si la banda ya lo trae). Con `slotsUsadosActuales` además se
 * apagan (used=0) los slots que ya no corresponden a ninguna banda.
 */
export function eqBandasAAjustes(bandas: readonly BandaEq[], slotsUsadosActuales: Iterable<number> = []): AjusteParametroVst[] {
  if (bandas.length > EQ_MAX_BANDAS) throw new RangeError(`Máximo ${EQ_MAX_BANDAS} bandas (recibidas ${bandas.length})`);
  const ocupados = new Set<number>();
  const asignados: Array<[number, BandaEq]> = [];
  for (const b of bandas) if (b.slot !== undefined) { ocupados.add(b.slot); asignados.push([b.slot, b]); }
  let siguiente = 0;
  for (const b of bandas) {
    if (b.slot !== undefined) continue;
    while (ocupados.has(siguiente)) siguiente++;
    ocupados.add(siguiente);
    asignados.push([siguiente, b]);
  }
  const out: AjusteParametroVst[] = [];
  for (const [slot, banda] of asignados) {
    const campos = camposDeBanda(banda);
    (Object.keys(campos) as CampoBandaEq[]).forEach((campo) => {
      out.push({ paramId: eqParamId(slot, campo), normalizado: eqValorANormalizado(campo, campos[campo]), campo, slot });
    });
  }
  for (const slot of slotsUsadosActuales) {
    if (!ocupados.has(slot)) out.push({ paramId: eqParamId(slot, 'used'), normalizado: 0, campo: 'used', slot });
  }
  return out;
}

/** Lee las bandas USADAS desde los normalizados del VST (`leer` devuelve undefined si el parámetro no existe). */
export function eqAjustesABandas(leer: (paramId: number) => number | undefined): BandaEq[] {
  const bandas: BandaEq[] = [];
  for (let slot = 0; slot < EQ_MAX_BANDAS; slot++) {
    const usada = leer(eqParamId(slot, 'used'));
    if (usada === undefined || usada < 0.5) continue;
    const v = (campo: CampoBandaEq) => {
      const n = leer(eqParamId(slot, campo));
      return eqNormalizadoAValor(campo, n ?? eqValorANormalizado(campo, EQ_RANGOS[campo].defecto));
    };
    const pendiente = v('slope');
    bandas.push({
      slot,
      type: codigoEqATipo(v('type')),
      freq: v('freq'),
      gain: v('gain'),
      q: v('q'),
      enabled: v('enabled') >= 0.5,
      ...(pendiente > 0 ? { slope: PENDIENTES[pendiente - 1] } : {}),
      mode: MODOS_BANDA_EQ[v('mode')] ?? 'stereo',
      solo: v('solo') >= 0.5,
    });
  }
  return bandas;
}

/** Primer slot libre; las bandas avanzadas (>= EQ_PRIMERA_BANDA_AVANZADA) solo si la licencia las concede. */
export function eqPrimerSlotLibre(usados: Iterable<number>, bandasAvanzadas = true): number | undefined {
  const ocupados = new Set(usados);
  const tope = bandasAvanzadas ? EQ_MAX_BANDAS : EQ_PRIMERA_BANDA_AVANZADA;
  for (let slot = 0; slot < tope; slot++) if (!ocupados.has(slot)) return slot;
  return undefined;
}

/** Frecuencia sugerida para una banda nueva: el hueco más ancho (en octavas) entre las existentes. */
export function eqFrecuenciaLibre(bandas: readonly BandaEq[]): number {
  const fs = [20, 20000, ...bandas.map((b) => b.freq)].sort((a, b) => a - b);
  let mejor = 1000;
  let hueco = 0;
  for (let i = 1; i < fs.length; i++) {
    const g = Math.log2(fs[i]! / fs[i - 1]!);
    if (g > hueco) { hueco = g; mejor = Math.sqrt(fs[i]! * fs[i - 1]!); }
  }
  return mejor;
}

/** Un cambio concreto de un parámetro de una banda (registro de auditoría). */
export type CambioEq = {
  slot: number;
  campo: CampoBandaEq | 'banda';
  antes: number | string | boolean | null;
  despues: number | string | boolean | null;
}

const CAMPOS_AUDITABLES = ['type', 'freq', 'gain', 'q', 'enabled', 'slope', 'mode', 'solo'] as const;

/** Diferencias entre dos estados de EQ, por banda y parámetro (alta/baja de banda incluidas). */
export function eqDiferencias(antes: readonly BandaEq[], despues: readonly BandaEq[]): CambioEq[] {
  const mapaA = new Map(antes.map((b) => [b.slot ?? -1, b]));
  const mapaD = new Map(despues.map((b) => [b.slot ?? -1, b]));
  const cambios: CambioEq[] = [];
  const slots = [...new Set([...mapaA.keys(), ...mapaD.keys()])].sort((a, b) => a - b);
  for (const slot of slots) {
    const a = mapaA.get(slot);
    const d = mapaD.get(slot);
    if (!a && d) { cambios.push({ slot, campo: 'banda', antes: null, despues: 'agregada' }); continue; }
    if (a && !d) { cambios.push({ slot, campo: 'banda', antes: 'existente', despues: 'quitada' }); continue; }
    if (!a || !d) continue;
    for (const campo of CAMPOS_AUDITABLES) {
      const va = a[campo];
      const vd = d[campo];
      const igual = typeof va === 'number' && typeof vd === 'number' ? Math.abs(va - vd) < 1e-6 * Math.max(1, Math.abs(va)) : va === vd;
      if (!igual && !(va === undefined && vd === undefined)) cambios.push({ slot, campo, antes: va ?? null, despues: vd ?? null });
    }
  }
  return cambios;
}

/** Resumen legible de cambios, p. ej. "B3 gain: -2 → -6 dB". */
export function eqResumenCambios(cambios: readonly CambioEq[]): string[] {
  const unidad: Partial<Record<CampoBandaEq, string>> = { freq: ' Hz', gain: ' dB' };
  const fmt = (c: CambioEq, v: CambioEq['antes']) =>
    typeof v === 'number' ? `${Math.round(v * 100) / 100}${c.campo !== 'banda' ? (unidad[c.campo] ?? '') : ''}` : String(v ?? '—');
  return cambios.map((c) => `B${c.slot + 1} ${c.campo}: ${fmt(c, c.antes)} → ${fmt(c, c.despues)}`);
}

/** Nombre legible del parámetro tal como lo conocen los perfiles/la IA: "Banda 3 Freq". */
export function eqNombreParametro(slot: number, campo: CampoBandaEq): string {
  const sufijo: Record<CampoBandaEq, string> = {
    type: 'Tipo', freq: 'Freq', gain: 'Gain', q: 'Q', enabled: 'On', used: 'Usada', slope: 'Pendiente', mode: 'Modo', solo: 'Solo',
  };
  return `Banda ${slot + 1} ${sufijo[campo]}`;
}

/** Perfil de parámetros del EQ (mismo formato que processor-profiles.json) generado del contrato, sin duplicarlo a mano. */
export type ParametroPerfilEq = {
  id: number;
  name: string;
  unit: string;
  kind: 'bool' | 'enum' | 'float';
  min: number;
  max: number;
  default: number;
  step?: number;
  scale?: 'log' | 'linear';
  enumValues?: string[];
}
export function eqPerfilParametros(): ParametroPerfilEq[] {
  const out: ParametroPerfilEq[] = [{ id: 0, name: 'Bypass', unit: '', kind: 'bool', min: 0, max: 1, default: 0, step: 1 }];
  const enums: Partial<Record<CampoBandaEq, string[]>> = {
    type: [...TIPOS_BANDA_EQ],
    slope: ['global', '12', '24', '36', '48'],
    mode: [...MODOS_BANDA_EQ],
  };
  const campos: CampoBandaEq[] = ['type', 'freq', 'gain', 'q', 'enabled', 'used', 'slope', 'mode', 'solo'];
  for (let slot = 0; slot < EQ_MAX_BANDAS; slot++) {
    for (const campo of campos) {
      const r = EQ_RANGOS[campo];
      const bool = campo === 'enabled' || campo === 'used' || campo === 'solo';
      const d = eqDefectoBanda(slot);
      const defecto =
        campo === 'used' ? (d.used ? 1 : 0)
        : campo === 'enabled' ? (d.enabled ? 1 : 0)
        : campo === 'type' ? tipoEqACodigo(d.type)
        : campo === 'freq' ? d.freq
        : campo === 'q' ? d.q
        : r.defecto;
      out.push({
        id: eqParamId(slot, campo),
        name: eqNombreParametro(slot, campo),
        unit: campo === 'freq' ? 'Hz' : campo === 'gain' ? 'dB' : '',
        kind: bool ? 'bool' : enums[campo] ? 'enum' : 'float',
        min: r.min,
        max: r.max,
        default: defecto,
        step: r.escala === 'paso' ? 1 : campo === 'gain' ? 0.1 : campo === 'freq' ? 1 : 0.1,
        ...(r.escala === 'log' ? { scale: 'log' as const } : {}),
        ...(enums[campo] ? { enumValues: enums[campo] } : {}),
      });
    }
  }
  out.push({ id: EQ_PARAM_GLOBAL.salida, name: 'Output', unit: 'dB', kind: 'float', min: -24, max: 24, default: 0, step: 0.1 });
  out.push({ id: EQ_PARAM_GLOBAL.pendiente, name: 'HP/LP Slope', unit: '', kind: 'enum', min: 0, max: 3, default: 0, step: 1, enumValues: ['12', '24', '36', '48'] });
  out.push({ id: EQ_PARAM_GLOBAL.analizador, name: 'Analyzer', unit: '', kind: 'enum', min: 0, max: 2, default: 1, step: 1, enumValues: ['Off', 'Post', 'Pre+Post'] });
  return out;
}
