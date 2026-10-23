/**
 * Herramientas de IA derivadas del manifiesto de un plugin (sin código del plugin): cualquier VST
 * alineado con JasWave expone a los agentes `describir` (lectura) y, si su manifiesto lo permite,
 * `ajustar` (escritura vía `plugin.setParameter`). Las herramientas de un `aiSkill` se suman aparte.
 */

import { aliasPlugin, type ManifiestoPlugin, type ParametroIAPlugin } from './manifiesto';

export type ClaseAccion = 'read' | 'write' | 'destructive' | 'system';

export type HerramientaManifiesto = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  actionClass: ClaseAccion;
};

export type ComandoPlugin = { type: 'plugin.setParameter'; payload: { trackId: string; pluginInstanceId: string; parameterId: string; normalizedValue: number; plainValue: number; name?: string } };

const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Valor de un parámetro: número en sus unidades o, si es `enum`, la etiqueta o su índice. */
export type ValorParametro = number | string;

/** Convierte una etiqueta de `enum` en su valor numérico; los números pasan tal cual. */
export function valorNumerico(p: ParametroIAPlugin, valor: ValorParametro): number {
  if (typeof valor === 'number') return valor;
  if (p.scale === 'enum' && p.values) {
    const i = p.values.findIndex((v) => v.toLowerCase() === valor.trim().toLowerCase());
    if (i >= 0) return p.min + i;
    throw new Error(`valor "${valor}" no válido para ${p.id}; opciones: ${p.values.join(', ')}`);
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`valor no numérico para ${p.id}`);
  return n;
}

/** Valor en unidades del parámetro → valor normalizado VST (0..1). */
export function normalizarValor(p: ParametroIAPlugin, valor: number): number {
  if (!Number.isFinite(valor)) throw new Error(`valor no numérico para ${p.id}`);
  const v = limitar(valor, p.min, p.max);
  if (p.max === p.min) return 0;
  switch (p.scale) {
    case 'toggle':
      return v >= (p.min + p.max) / 2 ? 1 : 0;
    case 'log':
      if (p.min <= 0) return (v - p.min) / (p.max - p.min);
      return Math.log(v / p.min) / Math.log(p.max / p.min);
    case 'stepped':
    case 'enum':
      return (Math.round(v) - p.min) / (p.max - p.min);
    default:
      return (v - p.min) / (p.max - p.min);
  }
}

export function herramientasDesdeManifiesto(m: ManifiestoPlugin): HerramientaManifiesto[] {
  const alias = aliasPlugin(m);
  const params = (m.ai?.parameters ?? []).filter((p) => !p.readOnly);
  const out: HerramientaManifiesto[] = [
    {
      name: `plugin.${alias}.describir`,
      description: `Describe ${m.name}: para qué sirve, intenciones típicas y parámetros (rango, unidad, default).`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      actionClass: 'read',
    },
  ];
  if (params.length > 0 && m.permissions.commands.includes('plugin.setParameter')) {
    out.push({
      name: `plugin.${alias}.ajustar`,
      description: `Ajusta parámetros de una instancia de ${m.name} en una pista. Valores en unidades reales (${params
        .slice(0, 6)
        .map((p) => `${p.id}: ${p.min}–${p.max}${p.unit ? ' ' + p.unit : ''}`)
        .join('; ')}${params.length > 6 ? '; …' : ''}).`,
      parameters: {
        type: 'object',
        properties: {
          trackId: { type: 'string' },
          pluginInstanceId: { type: 'string' },
          valores: {
            type: 'object',
            description: 'Mapa id de parámetro → valor en sus unidades',
            properties: Object.fromEntries(
              params.map((p) => [
                p.id,
                p.scale === 'enum' && p.values
                  ? { type: 'string', enum: p.values, description: p.name }
                  : { type: 'number', minimum: p.min, maximum: p.max, description: `${p.name}${p.unit ? ` (${p.unit})` : ''}` },
              ]),
            ),
            additionalProperties: false,
          },
        },
        required: ['trackId', 'pluginInstanceId', 'valores'],
        additionalProperties: false,
      },
      actionClass: 'write',
    });
  }
  return out;
}

/** Respuesta de `describir`: datos del manifiesto pensados para el modelo. */
export function describirPlugin(m: ManifiestoPlugin, accionesConcedidas?: readonly string[]) {
  return {
    id: m.id,
    nombre: m.name,
    resumen: m.ai?.summary ?? m.description,
    intenciones: m.ai?.intents ?? [],
    parametros: (m.ai?.parameters ?? []).map((p) => ({
      id: p.id,
      nombre: p.name,
      min: p.min,
      max: p.max,
      default: p.default,
      unidad: p.unit,
      ...(p.values ? { opciones: p.values } : {}),
      ...(p.readOnly ? { soloLectura: true } : {}),
      disponible: !p.feature || !accionesConcedidas || accionesConcedidas.includes(p.feature),
    })),
  };
}

/**
 * Traduce `ajustar` a comandos `plugin.setParameter`. Rechaza parámetros desconocidos y los que
 * requieren una función no concedida por la licencia (`accionesConcedidas`).
 */
export function traducirAjuste(
  m: ManifiestoPlugin,
  args: { trackId: string; pluginInstanceId: string; valores: Record<string, ValorParametro> },
  accionesConcedidas?: readonly string[],
): ComandoPlugin[] {
  if (!m.permissions.commands.includes('plugin.setParameter')) throw new Error(`${m.id} no permite plugin.setParameter`);
  const porId = new Map((m.ai?.parameters ?? []).map((p) => [p.id, p]));
  return Object.entries(args.valores).map(([id, crudo]) => {
    const p = porId.get(id);
    if (!p) throw new Error(`parámetro desconocido en ${m.id}: ${id}`);
    if (p.readOnly) throw new Error(`"${p.name}" es una medición de solo lectura`);
    const valor = valorNumerico(p, crudo);
    if (p.feature && accionesConcedidas && !accionesConcedidas.includes(p.feature)) {
      throw new Error(`"${p.name}" no está incluido en tu licencia (${p.feature})`);
    }
    return {
      type: 'plugin.setParameter',
      payload: {
        trackId: args.trackId,
        pluginInstanceId: args.pluginInstanceId,
        parameterId: String(p.vstParamId),
        normalizedValue: normalizarValor(p, valor),
        plainValue: limitar(valor, p.min, p.max),
        name: p.name,
      },
    };
  });
}
