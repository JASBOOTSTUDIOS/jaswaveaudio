/**
 * Manifiesto universal de plugins JasWave (`jaswave-plugin.json`, esquema V5).
 * Especificación: plugins/CONTRATO-V5.md. Lo usan el escáner del escritorio, el cliente web y el
 * registro de herramientas de IA; todo manifiesto se valida aquí antes de usarse.
 */

import { z } from 'zod';

/** Roles de agente (ids en español); se aceptan alias en inglés del documento V5. */
export const ROLES_AGENTE = ['director', 'productor', 'mezcla', 'mastering', 'qa'] as const;
export type RolAgentePlugin = (typeof ROLES_AGENTE)[number];

const ALIAS_ROLES: Record<string, RolAgentePlugin> = {
  producer: 'productor',
  mix: 'mezcla',
  mixing: 'mezcla',
  master: 'mastering',
};

/** Ruta relativa dentro del paquete: sin unidades, sin absolutas y sin `..`. */
const rutaRelativa = z
  .string()
  .min(1)
  .max(260)
  .refine((r) => !/^[a-zA-Z]:|^[\\/]/.test(r) && !r.split(/[\\/]/).includes('..'), 'ruta fuera del paquete');

const idPlugin = z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+){2,}$/, 'id en notación de dominio inverso, minúsculas');
const claveAccion = z.string().regex(/^[a-z0-9][a-z0-9.\-]{1,120}$/);

const parametroIA = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
  vstParamId: z.number().int().min(0).max(0x7fffffff),
  name: z.string().min(1).max(120),
  min: z.number(),
  max: z.number(),
  default: z.number(),
  unit: z.string().max(16).default(''),
  scale: z.enum(['linear', 'log', 'stepped', 'toggle', 'enum']).default('linear'),
  /** Etiquetas de un parámetro `enum` (una por valor entero de min a max). */
  values: z.array(z.string().min(1).max(60)).max(256).optional(),
  feature: claveAccion.nullable().default(null),
  /** Medición que el plugin publica (p. ej. reducción de ganancia): se lee, no se ajusta. */
  readOnly: z.boolean().default(false),
});

export const esquemaManifiesto = z
  .object({
    id: idPlugin,
    name: z.string().min(1).max(120),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'semver'),
    category: z.enum(['audio-effect', 'instrument', 'instrument-bundle', 'ai-skill', 'ui-extension', 'bridge']),
    vendor: z.string().min(1).max(80),
    description: z.string().max(2000).default(''),
    targetPlatforms: z.array(z.enum(['win-x64', 'web'])).min(1),
    entrypoints: z
      .object({
        dspDesktop: rutaRelativa.optional(),
        dspWeb: rutaRelativa.optional(),
        aiSkill: rutaRelativa.optional(),
        /** Módulo del DAW (ESM que exporta definirModulo de @jaswave/host-sdk). */
        ui: rutaRelativa.optional(),
        /** Hoja de estilos del módulo (la carga el DAW junto con `ui`). */
        uiEstilos: rutaRelativa.optional(),
      })
      .refine((e) => Object.values(e).some(Boolean), 'al menos un entrypoint'),
    vst3: z
      .object({
        classId: z.string().regex(/^\{?[0-9A-Fa-f-]{32,36}\}?$/),
        subCategories: z.string().max(120).default(''),
      })
      .optional(),
    permissions: z.object({
      realtimeAudio: z.boolean().default(false),
      fileSystem: z.enum(['none', 'read-project-stems', 'read-write-project']).default('none'),
      network: z.boolean().default(false),
      commands: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9.]{1,80}$/)).max(100).default([]),
    }),
    rolesAllowed: z
      .array(z.string())
      .transform((roles, ctx) => {
        const out: RolAgentePlugin[] = [];
        for (const r of roles) {
          const n = (ALIAS_ROLES[r.toLowerCase()] ?? r.toLowerCase()) as RolAgentePlugin;
          if (!ROLES_AGENTE.includes(n)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `rol desconocido: ${r}` });
            continue;
          }
          if (!out.includes(n)) out.push(n);
        }
        return out;
      })
      .default([]),
    license: z
      .object({
        productId: idPlugin,
        features: z.array(z.object({ key: claveAccion, description: z.string().max(400).default('') })).max(200).default([]),
      })
      .optional(),
    ai: z
      .object({
        summary: z.string().max(1000).default(''),
        intents: z.array(z.string().max(80)).max(100).default([]),
        parameters: z.array(parametroIA).max(512).default([]),
      })
      .optional(),
    download: z
      .object({
        url: z.string().url(),
        sha256: z.string().regex(/^([a-f0-9]{64})?$/),
        sizeBytes: z.number().int().min(0),
      })
      .optional(),
    checksum: z.string().regex(/^SHA256:([a-f0-9]{64})?$/).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.entrypoints.dspDesktop && !m.vst3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vst3'], message: 'vst3.classId es obligatorio con dspDesktop' });
    }
    if (m.entrypoints.dspDesktop && !m.targetPlatforms.includes('win-x64')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetPlatforms'], message: 'dspDesktop requiere win-x64' });
    }
    if ((m.category === 'ui-extension' || m.category === 'ai-skill') && !m.entrypoints.ui) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entrypoints', 'ui'], message: 'un módulo del DAW necesita entrypoints.ui' });
    }
    if (m.entrypoints.uiEstilos && !m.entrypoints.ui) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entrypoints', 'uiEstilos'], message: 'uiEstilos requiere entrypoints.ui' });
    }
    const features = new Set(m.license?.features.map((f) => f.key) ?? []);
    const vistos = new Set<string>();
    for (const [i, p] of (m.ai?.parameters ?? []).entries()) {
      if (p.feature && !features.has(p.feature)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ai', 'parameters', i, 'feature'], message: `feature "${p.feature}" no declarada en license.features` });
      }
      if (p.min > p.max || p.default < p.min || p.default > p.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ai', 'parameters', i], message: 'rango o default inválido' });
      }
      if (p.scale === 'enum' && (!p.values || p.values.length !== p.max - p.min + 1)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ai', 'parameters', i, 'values'], message: 'un parámetro enum necesita una etiqueta por valor (max − min + 1)' });
      }
      if (vistos.has(p.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ai', 'parameters', i, 'id'], message: `id repetido: ${p.id}` });
      vistos.add(p.id);
    }
  });

export type ManifiestoPlugin = z.infer<typeof esquemaManifiesto>;
export type ParametroIAPlugin = z.infer<typeof parametroIA>;

export type ResultadoManifiesto = { ok: true; manifiesto: ManifiestoPlugin } | { ok: false; errores: string[] };

/** Valida un manifiesto (objeto ya parseado o texto JSON). Nunca lanza. */
export function validarManifiesto(entrada: unknown): ResultadoManifiesto {
  let datos = entrada;
  if (typeof entrada === 'string') {
    try {
      datos = JSON.parse(entrada);
    } catch {
      return { ok: false, errores: ['JSON mal formado'] };
    }
  }
  const r = esquemaManifiesto.safeParse(datos);
  if (r.success) return { ok: true, manifiesto: r.data };
  return { ok: false, errores: r.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`) };
}

/** Alias corto para nombres de herramienta: último segmento del id (`com.jaswave.plugin.param-eq` → `param-eq`). */
export function aliasPlugin(m: Pick<ManifiestoPlugin, 'id'>): string {
  const partes = m.id.split('.');
  return partes[partes.length - 1]!;
}
