/**
 * Gestor de modelos gratuitos de OpenRouter.
 *
 * Los modelos gratuitos cambian cada semana: aparecen nuevos, otros se retiran, se saturan (429) o dejan de
 * aceptar herramientas. Este módulo mantiene al día la lista que usan las cadenas de JasWave IA:
 *
 *  1. Descubre los modelos gratuitos del catálogo de OpenRouter que sirven para el DAW (texto, herramientas).
 *  2. Los prueba con una petición real (una llamada de herramienta con una lista de notas) y mide validez,
 *     variedad y velocidad.
 *  3. Los clasifica por nivel de razonamiento (rápido, creativo, profundo) y por salud (sano, inestable, caído).
 *  4. Reconstruye las cadenas de los modelos JasWave con los mejores de cada nivel, sin intervención.
 *
 * Las funciones puras van aparte de la parte con base de datos para poder probarlas sin red.
 */

import type { Db } from '../../db.js';
import type { AiChatRequest, AiChatResult, AiProviderCustom, AiProviderKind } from '../gateway/ai-gateway.js';
import type { AiToolSchema } from '../gateway/ai-tools.js';
import type { ChatDirecto, RegistroIntento } from './enrutador.js';

// ───────────────────────────── Tipos ─────────────────────────────

export const NIVELES = ['rapido', 'creativo', 'profundo'] as const;
export type Nivel = (typeof NIVELES)[number];
export type EstadoGratis = 'nuevo' | 'sano' | 'inestable' | 'caido' | 'excluido';
export type RazonamientoGratis = 'apagable' | 'obligatorio' | 'no';

export type ModeloCatalogo = {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  pricing?: { prompt?: string | number; completion?: string | number };
  architecture?: { output_modalities?: string[]; input_modalities?: string[] };
  supported_parameters?: string[];
};

export type FilaGratis = {
  modelo: string;
  nombre: string;
  contexto: number;
  razonamiento: string;
  nivel: string;
  estado: string;
  puntuacion: number;
  latenciaMs: number | null;
  fallosSeguidos: number;
  limitesSeguidos: number;
  motivo: string;
  nivelFijado: boolean;
  excluidoManual: boolean;
  detectadoEn: Date;
  vistoEn: Date;
  ultimaPrueba: Date | null;
  ultimoOk: Date | null;
  proximaPrueba: Date | null;
};

export type EslabonGratis = { modelo: string; razonamiento: 'off' | 'bajo' | 'normal' };

export type ConfigGestor = { auto: boolean; intervaloMin: number; maxPruebasPorCiclo: number };
export const CONFIG_INICIAL: ConfigGestor = { auto: true, intervaloMin: 180, maxPruebasPorCiclo: 10 };

// ───────────────────────────── Catálogo ─────────────────────────────

const NO_SIRVE = /(guard|safety|moderation|embed|rerank|whisper|tts|lyria|image|vision-only|ocr)/i;
const MIN_CONTEXTO = 32_768;

/** ¿Es un modelo gratuito de texto con herramientas, útil para el asistente? */
export function esGratuitoUtil(m: ModeloCatalogo): boolean {
  if (!m.id.endsWith(':free') || NO_SIRVE.test(m.id)) return false;
  const gratis = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
  const salida = m.architecture?.output_modalities;
  const soloTexto = !salida || salida.every((x) => x === 'text');
  const herramientas = (m.supported_parameters ?? []).includes('tools');
  return gratis && soloTexto && herramientas && (m.context_length ?? 0) >= MIN_CONTEXTO;
}

/** Parámetros totales en miles de millones según el id («26b-a4b» = 26; «550b-a55b» = 550). */
export function tamanoB(id: string): number | null {
  const m = /(?<![a-z\d.])(\d+(?:\.\d+)?)b(?![a-z])/i.exec(id.replace(/^[^/]*\//, ''));
  return m ? Number(m[1]) : null;
}

const RAPIDOS = /(lite|mini|nano|small|\bxs\b|-xs|lightning|flash|fast|tiny|haiku|instant)/i;
const PROFUNDOS = /(ultra|\bpro\b|-pro|max|large|opus|think|reason|deep)/i;

/** Nivel de razonamiento que se espera de un modelo a partir de su id y tamaño. */
export function nivelSugerido(id: string): Nivel {
  const nombre = id.replace(/^[^/]*\//, '');
  const b = tamanoB(id);
  if (b !== null && b >= 100) return 'profundo';
  if (RAPIDOS.test(nombre) || (b !== null && b <= 9)) return 'rapido';
  if (PROFUNDOS.test(nombre)) return 'profundo';
  return 'creativo';
}

export function razonamientoDe(m: ModeloCatalogo): RazonamientoGratis {
  return (m.supported_parameters ?? []).includes('reasoning') ? 'apagable' : 'no';
}

// ───────────────────────────── Sonda ─────────────────────────────

export const HERRAMIENTA_SONDA: AiToolSchema = {
  name: 'crear_clip',
  description: 'Crea un clip MIDI con notas en una pista.',
  parameters: {
    type: 'object',
    properties: {
      pistaId: { type: 'string' },
      inicio: { type: 'number' },
      duracion: { type: 'number' },
      notas: {
        type: 'array',
        items: {
          type: 'object',
          properties: { pitch: { type: 'number' }, inicio: { type: 'number' }, duracion: { type: 'number' }, velocidad: { type: 'number' } },
          required: ['pitch', 'inicio', 'duracion', 'velocidad'],
        },
      },
    },
    required: ['pistaId', 'inicio', 'duracion', 'notas'],
  },
};

export const MENSAJES_SONDA = [
  { role: 'system', content: 'Eres el pianista de una banda de worship moderno. Escribe música humana: duraciones y velocidades variadas, nada cuadrado. Usa siempre las herramientas.' },
  { role: 'user', content: 'Pista "p1". Graba con crear_clip el verso (beats 0 a 16) en Re mayor: 16 notas de melodía y acordes abiertos con novenas. pitch es el número MIDI (D4 = 62).' },
];
const NOTAS_PEDIDAS = 16;

export type ResultadoSonda = {
  ok: boolean;
  ms: number;
  notasOk: number;
  notasTotal: number;
  duraciones: number;
  velocidades: number;
  puntuacion: number;
  /** Clasificación del fallo; vacío si ok. */
  fallo: '' | 'limite' | 'excluir' | 'razonamiento-obligatorio' | 'retirado' | 'sin-herramienta' | 'respuesta-invalida' | 'fallo';
  motivo: string;
};

export function puntuar(s: { notasOk: number; notasTotal: number; duraciones: number; velocidades: number; ms: number }): number {
  const valida = s.notasTotal ? s.notasOk / s.notasTotal : 0;
  const completa = Math.min(1, s.notasOk / (NOTAS_PEDIDAS - 2));
  const variedad = (Math.min(s.duraciones, 5) / 5 + Math.min(s.velocidades, 8) / 8) / 2;
  const velocidad = s.ms <= 2000 ? 1 : s.ms >= 30_000 ? 0 : 1 - (s.ms - 2000) / 28_000;
  return Math.round(100 * (0.3 * valida + 0.25 * completa + 0.25 * variedad + 0.2 * velocidad));
}

/** Clasifica un fallo del proveedor para decidir si es pasajero (límite), definitivo (excluir) o corregible. */
export function clasificarFallo(r: AiChatResult): ResultadoSonda['fallo'] {
  const texto = `${r.error ?? ''} ${r.hint ?? ''}`;
  if (/agentic harness|only available on agent/i.test(texto)) return 'excluir';
  if (/reasoning is mandatory|cannot be disabled/i.test(texto)) return 'razonamiento-obligatorio';
  if (r.errorCode === 'payment_required') return 'excluir';
  if (r.errorCode === 'model_not_found' || /no endpoints found|model .* (is )?not (found|available)|no longer available/i.test(texto)) return 'retirado';
  if (r.errorCode === 'rate_limit') return 'limite';
  return 'fallo';
}

/** Evalúa la respuesta de una sonda. */
export function evaluarSonda(r: AiChatResult, ms: number): ResultadoSonda {
  const vacio = { ms, notasOk: 0, notasTotal: 0, duraciones: 0, velocidades: 0, puntuacion: 0 };
  if (!r.success) {
    const motivo = (r.error ?? r.errorCode ?? 'sin respuesta').slice(0, 160);
    return { ok: false, ...vacio, fallo: clasificarFallo(r), motivo };
  }
  const llamada = r.toolCalls?.[0];
  if (!llamada) return { ok: false, ...vacio, fallo: 'sin-herramienta', motivo: `no emitió llamada de herramienta: ${(r.content ?? '').slice(0, 60).replace(/\s+/g, ' ')}` };
  const notas = (llamada.arguments as { notas?: unknown }).notas;
  if (!Array.isArray(notas)) return { ok: false, ...vacio, fallo: 'respuesta-invalida', motivo: 'notas no es una lista' };
  const validas = notas.filter((n) => {
    const x = n as Record<string, unknown>;
    return Number.isFinite(x?.pitch) && Number.isFinite(x?.inicio) && Number(x?.duracion) > 0;
  }) as Array<{ duracion: number; velocidad?: number }>;
  const duraciones = new Set(validas.map((n) => n.duracion)).size;
  const velocidades = new Set(validas.map((n) => n.velocidad)).size;
  const base = { ms, notasOk: validas.length, notasTotal: notas.length, duraciones, velocidades };
  const puntuacion = puntuar(base);
  return { ok: validas.length > 0, ...base, puntuacion, fallo: validas.length ? '' : 'respuesta-invalida', motivo: validas.length ? '' : 'ninguna nota válida' };
}

// ───────────────────────────── Estado ─────────────────────────────

const HORA = 3_600_000;
const MIN = 60_000;
/** Puntuación mínima para considerar sano a un modelo. */
export const PUNTUACION_SANO = 45;
/** Límites (429) seguidos tras los que un modelo sano pasa a inestable. */
const LIMITES_PARA_INESTABLE = 6;
/** Fallos seguidos tras los que un modelo pasa a caído. */
const FALLOS_PARA_CAIDO = 3;

export type Cambio = Partial<Omit<FilaGratis, 'modelo' | 'nombre' | 'contexto' | 'detectadoEn' | 'vistoEn'>>;

/** Aplica el resultado de una sonda a la fila y devuelve los campos a guardar. Pura. */
export function aplicarSonda(f: FilaGratis, s: ResultadoSonda, ahora: Date): Cambio {
  const t = ahora.getTime();
  const base: Cambio = { ultimaPrueba: ahora };
  if (s.ok) {
    const sano = s.puntuacion >= PUNTUACION_SANO;
    return {
      ...base,
      estado: sano ? 'sano' : 'inestable',
      puntuacion: s.puntuacion,
      latenciaMs: s.ms,
      fallosSeguidos: 0,
      limitesSeguidos: 0,
      motivo: sano ? '' : `respuesta pobre (${s.notasOk}/${s.notasTotal} notas, ${s.duraciones} duraciones)`,
      ultimoOk: ahora,
      proximaPrueba: new Date(t + (sano ? 6 * HORA : 2 * HORA)),
    };
  }
  switch (s.fallo) {
    case 'excluir':
      return { ...base, estado: 'excluido', motivo: s.motivo, proximaPrueba: new Date(t + 7 * 24 * HORA) };
    case 'retirado':
      return { ...base, estado: 'excluido', motivo: `retirado de OpenRouter: ${s.motivo}`, proximaPrueba: new Date(t + 24 * HORA) };
    case 'razonamiento-obligatorio':
      // Se corrige y se vuelve a probar enseguida, ya con el razonamiento activado.
      return { ...base, razonamiento: 'obligatorio', motivo: 'exige razonamiento', proximaPrueba: ahora };
    case 'limite': {
      const limites = f.limitesSeguidos + 1;
      return {
        ...base,
        limitesSeguidos: limites,
        motivo: 'saturado (429)',
        // Un modelo que estaba sano sigue sano (es un límite pasajero) hasta que se repite mucho.
        ...(f.estado === 'nuevo' ? { estado: 'inestable' } : limites >= LIMITES_PARA_INESTABLE && f.estado === 'sano' ? { estado: 'inestable' } : {}),
        proximaPrueba: new Date(t + 20 * MIN),
      };
    }
    default: {
      const fallos = f.fallosSeguidos + 1;
      const caido = fallos >= FALLOS_PARA_CAIDO;
      return {
        ...base,
        fallosSeguidos: fallos,
        estado: caido ? 'caido' : f.estado === 'sano' ? 'inestable' : f.estado === 'nuevo' ? 'inestable' : f.estado,
        motivo: s.motivo,
        proximaPrueba: new Date(t + Math.min(24 * HORA, HORA * 2 ** Math.min(fallos, 5))),
      };
    }
  }
}

// ───────────────────────────── Cadenas ─────────────────────────────

const ORDEN_NIVEL: Record<Nivel, number> = { rapido: 0, creativo: 1, profundo: 2 };
const esNivel = (x: string): x is Nivel => (NIVELES as readonly string[]).includes(x);

/** Cuánto se parece el nivel del modelo al pedido (mismo 100, contiguo 55, opuesto 20). */
export function afinidad(modelo: string, pedido: Nivel): number {
  const d = Math.abs(ORDEN_NIVEL[esNivel(modelo) ? modelo : 'creativo'] - ORDEN_NIVEL[pedido]);
  return d === 0 ? 100 : d === 1 ? 55 : 20;
}

/** Puntaje de un modelo para un nivel: calidad medida + afinidad de nivel + rapidez (solo «rápido») − penalizaciones. */
export function puntajePara(f: FilaGratis, pedido: Nivel): number {
  let p = 0.55 * f.puntuacion + 0.45 * afinidad(f.nivel, pedido);
  if (pedido === 'rapido' && f.latenciaMs != null) p += Math.max(0, Math.min(15, 15 - f.latenciaMs / 400));
  p -= Math.min(25, f.limitesSeguidos * 5);
  if (f.estado === 'inestable') p -= 30;
  return p;
}

export function razonamientoPara(f: FilaGratis, pedido: Nivel): EslabonGratis['razonamiento'] {
  if (f.razonamiento === 'obligatorio') return 'normal';
  if (f.razonamiento === 'apagable' && pedido === 'profundo' && f.nivel === 'profundo') return 'bajo';
  return 'off';
}

/** Cadena de un nivel con lo mejor disponible. Vacía si no hay al menos `minimo` candidatos útiles. */
export function construirCadena(filas: FilaGratis[], pedido: Nivel, opciones: { max?: number; minimo?: number } = {}): EslabonGratis[] {
  const max = opciones.max ?? 7;
  const minimo = opciones.minimo ?? 2;
  const utiles = filas.filter((f) => (f.estado === 'sano' || f.estado === 'inestable') && !f.excluidoManual);
  const orden = [...utiles].sort((a, b) => puntajePara(b, pedido) - puntajePara(a, pedido) || a.modelo.localeCompare(b.modelo));
  const elegidos = orden.slice(0, max);
  if (elegidos.filter((f) => f.estado === 'sano').length < minimo) return [];
  return elegidos.map((f) => ({ modelo: f.modelo, razonamiento: razonamientoPara(f, pedido) }));
}

// ───────────────────────────── Servicio ─────────────────────────────

export type DestinoOpenRouter = { proveedorId: string; kind: AiProviderKind; baseUrl: string; apiKey?: string; custom?: AiProviderCustom };

export type ResumenCiclo = {
  inicio: string;
  fin?: string;
  nuevos: string[];
  retirados: string[];
  probados: Array<{ modelo: string; ok: boolean; ms: number; puntuacion: number; estado: string; motivo: string }>;
  cadenas: Record<string, string[]>;
  error?: string;
};

export type OpcionesGestor = {
  db: Db;
  chat: ChatDirecto;
  /** Conexión OpenRouter del admin con su clave descifrada; null si no hay ninguna activa. */
  destino: () => Promise<DestinoOpenRouter | null>;
  /** Cadenas de JasWave: lee y guarda (con invalidación de caché). */
  jaswave: {
    modelos: () => Promise<Array<{ id: string; nombre: string; descripcion: string; cadena: Array<{ proveedorId: string; modelo: string; razonamiento: 'off' | 'bajo' | 'normal' }> }>>;
    guardar: (id: string, datos: { nombre: string; descripcion: string; cadena: Array<{ proveedorId: string; modelo: string; razonamiento: 'off' | 'bajo' | 'normal' }> }) => Promise<unknown>;
    invalidar: () => void;
  };
  obtenerCatalogo?: () => Promise<ModeloCatalogo[]>;
  ahora?: () => Date;
  pausaEntrePruebasMs?: number;
  log?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
};

export async function catalogoOpenRouter(): Promise<ModeloCatalogo[]> {
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`OpenRouter respondió ${r.status} al listar los modelos`);
  const j = (await r.json()) as { data?: ModeloCatalogo[] };
  return j.data ?? [];
}

const CLAVE_CONFIG = 'gestor-modelos-gratis';
/** Fallos de producción seguidos tras los que un modelo se marca inestable sin esperar a la siguiente sonda. */
const FALLOS_PRODUCCION = 4;

export function crearGestorModelosGratis(o: OpcionesGestor) {
  const { db } = o;
  const ahora = o.ahora ?? (() => new Date());
  const catalogo = o.obtenerCatalogo ?? catalogoOpenRouter;
  const pausa = o.pausaEntrePruebasMs ?? 1500;
  let ultimo: ResumenCiclo | null = null;
  let enCurso: Promise<ResumenCiclo> | null = null;
  const fallosProduccion = new Map<string, number>();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let reconstruccion: ReturnType<typeof setTimeout> | undefined;

  const filas = async (): Promise<FilaGratis[]> => (await db.modeloGratisIA.findMany({ orderBy: { modelo: 'asc' } })) as FilaGratis[];

  async function config(): Promise<ConfigGestor> {
    const f = await db.ajusteIA.findUnique({ where: { clave: CLAVE_CONFIG } });
    return { ...CONFIG_INICIAL, ...((f?.valor as Partial<ConfigGestor> | null) ?? {}) };
  }
  async function guardarConfig(c: Partial<ConfigGestor>): Promise<ConfigGestor> {
    const nueva = { ...(await config()), ...c };
    nueva.intervaloMin = Math.max(15, Math.min(24 * 60, Math.round(nueva.intervaloMin)));
    nueva.maxPruebasPorCiclo = Math.max(1, Math.min(40, Math.round(nueva.maxPruebasPorCiclo)));
    const valor = { auto: Boolean(nueva.auto), intervaloMin: nueva.intervaloMin, maxPruebasPorCiclo: nueva.maxPruebasPorCiclo };
    await db.ajusteIA.upsert({ where: { clave: CLAVE_CONFIG }, create: { clave: CLAVE_CONFIG, valor }, update: { valor } });
    return valor;
  }

  /** Descubre modelos nuevos y marca los que ya no están en el catálogo. */
  async function sincronizar(): Promise<{ nuevos: string[]; retirados: string[] }> {
    const t = ahora();
    const lista = (await catalogo()).filter(esGratuitoUtil);
    const vistos = new Set(lista.map((m) => m.id));
    const existentes = new Map((await filas()).map((f) => [f.modelo, f]));
    const nuevos: string[] = [];
    for (const m of lista) {
      const prev = existentes.get(m.id);
      const datos = { nombre: m.name ?? m.id, contexto: m.context_length ?? 0, vistoEn: t };
      if (!prev) {
        nuevos.push(m.id);
        await db.modeloGratisIA.create({ data: { modelo: m.id, ...datos, razonamiento: razonamientoDe(m), nivel: nivelSugerido(m.id), estado: 'nuevo', detectadoEn: t, proximaPrueba: t } });
      } else {
        await db.modeloGratisIA.update({
          where: { modelo: m.id },
          data: { ...datos, ...(prev.estado === 'excluido' && !prev.excluidoManual && prev.motivo.startsWith('ya no está') ? { estado: 'nuevo', motivo: '', proximaPrueba: t } : {}) },
        });
      }
    }
    const retirados: string[] = [];
    for (const f of existentes.values()) {
      if (!vistos.has(f.modelo) && f.estado !== 'excluido') {
        retirados.push(f.modelo);
        await db.modeloGratisIA.update({ where: { modelo: f.modelo }, data: { estado: 'excluido', motivo: 'ya no está en el catálogo gratuito de OpenRouter' } });
      }
    }
    return { nuevos, retirados };
  }

  /** Prueba un modelo y guarda el resultado. */
  async function probar(modelo: string): Promise<ResultadoSonda> {
    const d = await o.destino();
    if (!d) throw new Error('No hay una conexión OpenRouter activa con clave');
    let f = (await db.modeloGratisIA.findUnique({ where: { modelo } })) as FilaGratis | null;
    if (!f) throw new Error(`Modelo desconocido: ${modelo}`);
    const llamar = async (razonamiento: string): Promise<ResultadoSonda> => {
      const req: AiChatRequest = {
        kind: d.kind,
        baseUrl: d.baseUrl,
        model: modelo,
        ...(d.apiKey ? { apiKey: d.apiKey } : {}),
        ...(d.custom ? { custom: d.custom } : {}),
        messages: MENSAJES_SONDA,
        tools: [HERRAMIENTA_SONDA],
        toolChoice: 'auto',
        maxTokens: 3000,
        temperature: 0.6,
        extra: { reasoning: razonamiento === 'obligatorio' ? { effort: 'low' } : { enabled: false } },
      };
      const t0 = Date.now();
      const r = await o.chat(req, { timeoutMs: 90_000 });
      return evaluarSonda(r, Date.now() - t0);
    };
    let s = await llamar(f.razonamiento);
    if (!s.ok && s.fallo === 'razonamiento-obligatorio') {
      await db.modeloGratisIA.update({ where: { modelo }, data: { razonamiento: 'obligatorio' } });
      f = { ...f, razonamiento: 'obligatorio' };
      s = await llamar('obligatorio');
    }
    const cambio = f.excluidoManual ? { ultimaPrueba: ahora() } : aplicarSonda(f, s, ahora());
    await db.modeloGratisIA.update({ where: { modelo }, data: cambio });
    fallosProduccion.delete(modelo);
    return s;
  }

  /** Reconstruye las cadenas de rápido, creativo y profundo con los mejores modelos de cada nivel. */
  async function reconstruirCadenas(): Promise<Record<string, string[]>> {
    const d = await o.destino();
    if (!d) return {};
    const todas = await filas();
    const resultado: Record<string, string[]> = {};
    const actuales = await o.jaswave.modelos();
    // La conexión debe listar los modelos de las cadenas para que el servidor los acepte.
    const permitidos = todas.filter((f) => f.estado !== 'excluido').map((f) => f.modelo);
    await db.proveedorIA.update({ where: { id: d.proveedorId }, data: { modelos: permitidos.length ? permitidos : ['openrouter/free'] } });
    for (const nivel of NIVELES) {
      const m = actuales.find((x) => x.id === nivel);
      if (!m) continue;
      const cadena = construirCadena(todas, nivel);
      if (!cadena.length) {
        resultado[nivel] = m.cadena.map((e) => e.modelo); // sin candidatos suficientes: se deja como está
        continue;
      }
      const iguales = m.cadena.length === cadena.length && m.cadena.every((e, i) => e.modelo === cadena[i]!.modelo && e.razonamiento === cadena[i]!.razonamiento && e.proveedorId === d.proveedorId);
      if (!iguales) await o.jaswave.guardar(nivel, { nombre: m.nombre, descripcion: m.descripcion, cadena: cadena.map((e) => ({ proveedorId: d.proveedorId, ...e })) });
      resultado[nivel] = cadena.map((e) => e.modelo);
    }
    o.jaswave.invalidar();
    return resultado;
  }

  /** Un ciclo completo: descubrir → probar lo pendiente → reconstruir cadenas. */
  async function ciclo(opciones: { forzar?: boolean } = {}): Promise<ResumenCiclo> {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      const resumen: ResumenCiclo = { inicio: ahora().toISOString(), nuevos: [], retirados: [], probados: [], cadenas: {} };
      try {
        const c = await config();
        const s = await sincronizar();
        resumen.nuevos = s.nuevos;
        resumen.retirados = s.retirados;
        const t = ahora().getTime();
        const prioridad: Record<string, number> = { nuevo: 0, caido: 2, inestable: 1, sano: 3 };
        const pendientes = (await filas())
          .filter((f) => f.estado !== 'excluido' && !f.excluidoManual && (opciones.forzar || !f.proximaPrueba || f.proximaPrueba.getTime() <= t))
          .sort((a, b) => (prioridad[a.estado] ?? 9) - (prioridad[b.estado] ?? 9) || (a.ultimaPrueba?.getTime() ?? 0) - (b.ultimaPrueba?.getTime() ?? 0))
          .slice(0, c.maxPruebasPorCiclo);
        for (const f of pendientes) {
          try {
            const r = await probar(f.modelo);
            const despues = (await db.modeloGratisIA.findUnique({ where: { modelo: f.modelo } })) as FilaGratis;
            resumen.probados.push({ modelo: f.modelo, ok: r.ok, ms: r.ms, puntuacion: r.puntuacion, estado: despues.estado, motivo: r.motivo });
          } catch (e) {
            resumen.probados.push({ modelo: f.modelo, ok: false, ms: 0, puntuacion: 0, estado: f.estado, motivo: e instanceof Error ? e.message : String(e) });
          }
          if (pausa > 0) await new Promise((r) => setTimeout(r, pausa));
        }
        resumen.cadenas = await reconstruirCadenas();
        if (resumen.nuevos.length) o.log?.info({ nuevos: resumen.nuevos }, 'modelos gratuitos nuevos detectados en OpenRouter');
      } catch (e) {
        resumen.error = e instanceof Error ? e.message : String(e);
        o.log?.warn({ err: resumen.error }, 'ciclo del gestor de modelos gratuitos');
      }
      resumen.fin = ahora().toISOString();
      ultimo = resumen;
      return resumen;
    })().finally(() => {
      enCurso = null;
    });
    return enCurso;
  }

  /** Planificador: primer ciclo poco después de arrancar y uno cada `intervaloMin`; sigue cada 5 min mientras haya modelos sin probar. */
  function iniciar(primeroEnMs = 60_000) {
    const tic = async (esperaMs: number) => {
      temporizador = setTimeout(async () => {
        let siguiente = (await config().catch(() => CONFIG_INICIAL)).intervaloMin * MIN;
        try {
          if ((await config()).auto) {
            const r = await ciclo();
            if (!r.error && (await filas()).some((f) => f.estado === 'nuevo' && !f.excluidoManual)) siguiente = 5 * MIN;
          }
        } catch (e) {
          o.log?.warn({ err: String(e) }, 'planificador del gestor de modelos gratuitos');
        }
        void tic(siguiente);
      }, esperaMs);
      temporizador.unref?.();
    };
    void tic(primeroEnMs);
  }
  function detener() {
    if (temporizador) clearTimeout(temporizador);
    if (reconstruccion) clearTimeout(reconstruccion);
  }

  /** Los intentos reales de producción alimentan la salud: varios fallos seguidos marcan inestable sin esperar a la sonda. */
  function alIntentos(registros: RegistroIntento[]) {
    for (const r of registros) {
      if (r.ok) {
        fallosProduccion.delete(r.modelo);
        continue;
      }
      if (r.codigo === 'rate_limit' || r.codigo === 'cancelled') continue;
      const n = (fallosProduccion.get(r.modelo) ?? 0) + 1;
      fallosProduccion.set(r.modelo, n);
      if (n < FALLOS_PRODUCCION) continue;
      fallosProduccion.delete(r.modelo);
      void (async () => {
        const f = (await db.modeloGratisIA.findUnique({ where: { modelo: r.modelo } })) as FilaGratis | null;
        if (!f || f.estado !== 'sano') return;
        await db.modeloGratisIA.update({ where: { modelo: r.modelo }, data: { estado: 'inestable', motivo: `${FALLOS_PRODUCCION} fallos seguidos en uso real (${r.codigo ?? 'sin código'})`, proximaPrueba: ahora() } });
        if (reconstruccion) clearTimeout(reconstruccion);
        reconstruccion = setTimeout(() => void reconstruirCadenas().catch(() => undefined), 30_000);
        reconstruccion.unref?.();
      })().catch(() => undefined);
    }
  }

  return {
    config,
    guardarConfig,
    sincronizar,
    probar,
    ciclo,
    reconstruirCadenas,
    iniciar,
    detener,
    alIntentos,
    estado: () => ({ enCurso: enCurso !== null, ultimo }),
    async listar(): Promise<FilaGratis[]> {
      return filas();
    },
    /** El admin excluye o repone un modelo, o le fija el nivel. */
    async ajustar(modelo: string, cambios: { excluido?: boolean; nivel?: Nivel | null }): Promise<void> {
      const f = (await db.modeloGratisIA.findUnique({ where: { modelo } })) as FilaGratis | null;
      if (!f) throw new Error(`Modelo desconocido: ${modelo}`);
      const data: Cambio & { nivel?: string; nivelFijado?: boolean; excluidoManual?: boolean } = {};
      if (cambios.excluido !== undefined) {
        data.excluidoManual = cambios.excluido;
        if (cambios.excluido) {
          data.estado = 'excluido';
          data.motivo = 'excluido por el administrador';
        } else {
          data.estado = 'nuevo';
          data.motivo = '';
          data.proximaPrueba = ahora();
        }
      }
      if (cambios.nivel !== undefined) {
        if (cambios.nivel === null) {
          data.nivelFijado = false;
          data.nivel = nivelSugerido(modelo);
        } else {
          data.nivelFijado = true;
          data.nivel = cambios.nivel;
        }
      }
      await db.modeloGratisIA.update({ where: { modelo }, data });
    },
  };
}

export type GestorModelosGratis = ReturnType<typeof crearGestorModelosGratis>;
