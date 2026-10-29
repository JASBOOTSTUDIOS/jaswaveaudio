/**
 * Comandos de actuación con valores reales (A7c).
 *
 * Propósito:
 *   Permitir al agente de IA actuar sobre el mezcla con valores físicos
 *   (dB, Hz, ms, ratio) leídos del servicio de análisis (A7b), nunca
 *   placeholders. Cada mutación pasa por el Command System: queda deshacible,
 *   auditada y con antes/después para `run.diff` / `audit.step`.
 *
 * Importancia:
 *   - Toda mutación pasa por `tienda.executor.execute` (undo + auditoría).
 *   - Los valores aplicados son reales: ganancia (dB → lineal), frecuencias
 *     (Hz), tiempos (ms) y techos (dBFS).
 *   - EQ/compresor/limite se modelan como entradas de la FX Chain de la pista
 *     (`pista.plugins`), reutilizando el SSOT de plugins (ADR-0012).
 *   - Los datos de análisis (A7b) se tratan como origen de verdad para el
 *     cálculo de valores; el envelope de "no confiable" del dato de herramienta
 *     (`untrusted.ts`) se aplica en la capa del agente al devolver el resultado
 *     al modelo.
 *
 * Función:
 *   Expone definiciones de comando listas para registrar en el registry:
 *   track.ganancia, pista.pan, pista.eq.agregar/editar/quitar,
 *   pista.compresor.agregar/editar/quitar, pista.limite, master.normalizar.
 */

import type { CommandDefinition, StateTransition } from '../types/command';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { Track } from '../types/tracks';
import type { PluginInfo, ParametroPluginOpciones } from '../types/entidades';
import { dbDesdeLineal } from '../audio/loudness-bs1770';
import { obtenerProveedorAnalisis } from '../audio/analysis-provider';
import type { MedidaPista } from '../audio/diagnosis';
import { getStateRevision } from '../state/state-revision';
import { EventosTrack, EventosMezcla, EventosPlugin } from '../constants/nombres-eventos';
import { entorno } from '../state/entorno-determinista';
import {
  EQ_MAX_BANDAS,
  EQ_RANGOS,
  MODOS_BANDA_EQ,
  codigoEqATipo,
  eqDiferencias,
  eqResumenCambios,
  normalizarTipoEq,
  tipoEqACodigo,
  type BandaEq,
  type CambioEq,
  type PendienteEq,
} from '../audio/eq-dinamico';

function generarId(): string {
  return `${entorno.ahora().toString(36)}-${entorno.aleatorio().toString(36).slice(2, 7)}`;
}

type ProcesadorTipo = 'eq' | 'compresor' | 'limite';

const ID_EQ = (trackId: string) => `eq-${trackId}`;
const ID_COMP = (trackId: string) => `comp-${trackId}`;
const ID_LIMIT = (trackId: string) => `limit-${trackId}`;

/** Banda del EQ: modelo único (ver audio/eq-dinamico.ts); `slot` es el slot del VST cuando se conoce. */
type EqBand = BandaEq;

type EqPayload = { trackId: string; bandas: EqBand[]; pluginInstanceId?: string };
type EqBandaAgregarPayload = { trackId: string; banda: EqBand; pluginInstanceId?: string };
type EqBandaEditarPayload = { trackId: string; indice: number; cambios: Partial<EqBand>; pluginInstanceId?: string };
type EqBandaQuitarPayload = { trackId: string; indice: number; pluginInstanceId?: string };
type CompPayload = {
  trackId: string;
  threshold?: number; // dB
  ratio?: number; // :1
  attack?: number; // ms
  release?: number; // ms
  knee?: number; // dB
  makeup?: number; // dB
  pluginInstanceId?: string;
};
type LimitePayload = { trackId: string; ceiling: number; gainIn?: number; pluginInstanceId?: string };
type NormalizarPayload = { objetivoLufs: number; trackId?: string };

// ── Helpers de estado ──────────────────────────────────────────────────────

function obtenerMedida(estado: DAWState, trackId: string): Promise<MedidaPista | undefined> {
  const proveedor = obtenerProveedorAnalisis();
  if (!proveedor) return Promise.resolve(undefined);
  return (async () => {
    try {
      const analisis = await proveedor({
        revision: getStateRevision(estado),
        pistas: [trackId],
      });
      return (
        analisis.pistas.find((p) => p.trackId === trackId) ??
        (trackId === 'master' ? analisis.master : undefined)
      );
    } catch {
      return undefined;
    }
  })();
}

function medidaJSON(medida: MedidaPista | undefined): { integrated: number; truePeakDb: number } | null {
  if (!medida) return null;
  return { integrated: medida.integrated, truePeakDb: medida.truePeakDb };
}

function encontrarProcesador(plugins: PluginInfo[], tipo: ProcesadorTipo): PluginInfo | undefined {
  return plugins.find((p) => p.tipo === tipo || p.categoria === tipo);
}

function idProcesador(trackId: string, tipo: ProcesadorTipo): string {
  if (tipo === 'eq') return ID_EQ(trackId);
  if (tipo === 'compresor') return ID_COMP(trackId);
  return ID_LIMIT(trackId);
}

function parametro(
  id: string,
  nombre: string,
  valor: number,
  minimo: number,
  maximo: number,
  paso: number,
  unidad: string,
  etiqueta?: string,
): ParametroPluginOpciones {
  return { id, nombre, valor, minimo, maximo, paso, unidad, etiqueta: etiqueta ?? nombre };
}

function procesadorInfo(
  id: string,
  nombre: string,
  tipo: ProcesadorTipo,
  parametros: ParametroPluginOpciones[],
): PluginInfo {
  return {
    id,
    nombre,
    fabricante: 'JasWave',
    tipo,
    categoria: tipo,
    bypass: false,
    parametros,
    estado: 'cargado',
    presetActual: undefined,
    version: '1.0.0',
    wet: 1,
    entrada: undefined,
    salida: undefined,
    latencia: 0,
    icono: undefined,
    autor: 'JasWave',
    licencia: 'propietaria',
    descripcion: `Procesador ${tipo} de JasWave (valor real)`,
    sitioWeb: undefined,
    manualUrl: undefined,
    ui: { ancho: 600, alto: 400, personalizable: false },
  } as PluginInfo;
}

/** Versión del esquema de parámetros del EQ de dominio: 2 = códigos de tipo del VST + parámetros extra por banda. */
const EQ_VERSION_ESQUEMA = 2;

function bandasEqAParametros(bandas: EqBand[]): ParametroPluginOpciones[] {
  const out: ParametroPluginOpciones[] = [parametro('eq.version', 'Versión del esquema', EQ_VERSION_ESQUEMA, 1, 99, 1, '')];
  for (let i = 0; i < bandas.length; i++) {
    const b = bandas[i]!;
    const pref = `eq.band.${i}`;
    out.push(parametro(`${pref}.freq`, 'Frecuencia', b.freq, 20, 20_000, 1, 'Hz'));
    out.push(parametro(`${pref}.gain`, 'Ganancia', b.gain, -24, 24, 0.1, 'dB'));
    out.push(parametro(`${pref}.q`, 'Q', b.q, 0.1, 18, 0.1, ''));
    out.push(parametro(`${pref}.type`, 'Tipo', tipoEqACodigo(b.type), 0, 6, 1, '', b.type));
    out.push(parametro(`${pref}.enabled`, 'Habilitada', b.enabled ? 1 : 0, 0, 1, 1, ''));
    out.push(parametro(`${pref}.slope`, 'Pendiente (dB/oct, 0 = global)', b.slope ?? 0, 0, 48, 12, 'dB/oct'));
    out.push(parametro(`${pref}.mode`, 'Modo', Math.max(0, MODOS_BANDA_EQ.indexOf(b.mode ?? 'stereo')), 0, 4, 1, '', b.mode ?? 'stereo'));
    out.push(parametro(`${pref}.solo`, 'Solo', b.solo ? 1 : 0, 0, 1, 1, ''));
  }
  return out;
}

/**
 * Valida y normaliza las bandas de un payload (la IA puede mandar alias como "peak"/"hpf"):
 * tipo conocido, máximo de bandas y valores dentro de rango. Lanza con un mensaje accionable.
 */
function normalizarBandasEq(bandas: EqBand[]): EqBand[] {
  if (bandas.length > EQ_MAX_BANDAS) {
    throw new Error(`El ecualizador admite como máximo ${EQ_MAX_BANDAS} bandas (recibidas ${bandas.length})`);
  }
  const limitar = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  return bandas.map((b, i) => {
    const type = normalizarTipoEq(b.type);
    if (!type) throw new Error(`Banda ${i + 1}: tipo "${String(b.type)}" desconocido (usa bell, lowShelf, highShelf, lowCut, highCut, notch o bandPass)`);
    const modo = b.mode ?? 'stereo';
    if (!MODOS_BANDA_EQ.includes(modo)) throw new Error(`Banda ${i + 1}: modo "${String(modo)}" desconocido (stereo, mid, side, left, right)`);
    if (b.slope !== undefined && ![12, 24, 36, 48].includes(b.slope)) throw new Error(`Banda ${i + 1}: pendiente ${String(b.slope)} no válida (12, 24, 36 o 48 dB/oct)`);
    for (const campo of ['freq', 'gain', 'q'] as const) {
      if (!Number.isFinite(b[campo])) throw new Error(`Banda ${i + 1}: ${campo} debe ser un número`);
    }
    return {
      ...b,
      type,
      freq: limitar(b.freq, EQ_RANGOS.freq.min, EQ_RANGOS.freq.max),
      gain: limitar(b.gain, EQ_RANGOS.gain.min, EQ_RANGOS.gain.max),
      q: limitar(b.q, EQ_RANGOS.q.min, EQ_RANGOS.q.max),
    };
  });
}

function aplicarBandasEq(plugin: PluginInfo, bandas: EqBand[]): PluginInfo {
  return { ...plugin, parametros: bandasEqAParametros(bandas) };
}

function trackDeEstado(estado: DAWState, trackId: string): Track {
  const pista = estado.project.tracks.find((t) => t.id === trackId);
  if (!pista) throw new Error(`Pista no encontrada: ${trackId}`);
  return pista;
}

function actualizarPlugins(
  estado: DAWState,
  trackId: string,
  plugins: PluginInfo[],
): ProjectState {
  const now = entorno.ahora();
  return {
    ...estado.project,
    tracks: estado.project.tracks.map((t) =>
      t.id === trackId ? ({ ...t, plugins, fechaModificacion: now } as Track) : t,
    ),
    modificado: true,
    fechaModificacion: now,
  };
}

// ── track.ganancia ─────────────────────────────────────────────────────────

export type TrackGananciaPayload = { trackId: string; db: number };

export function crearComandoTrackGanancia(): CommandDefinition<TrackGananciaPayload> {
  return {
    type: 'track.ganancia',
    replicacion: 'resultado',
    inverseType: 'track.ganancia',
    description: 'Fija la ganancia de una pista en dB (lineal = 10^(dB/20))',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        db: { type: 'number' },
      },
      required: ['trackId', 'db'],
      additionalProperties: false,
    },
    handler: async (estado, payload): Promise<StateTransition<TrackGananciaPayload>> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const medida = await obtenerMedida(estado, payload.trackId);
      const db = Math.max(-60, Math.min(24, Number(payload.db)));
      const volumenAntes = pista.volumen;
      const dbAntes = dbDesdeLineal(volumenAntes);
      const volumenDespues = Math.pow(10, db / 20);
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map((t) =>
          t.id === pista.id
            ? ({ ...t, volumen: volumenDespues, fechaModificacion: entorno.ahora() } as Track)
            : t,
        ),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.volumenCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: {
              trackId: pista.id,
              nombre: pista.nombre,
              dbAntes: Number(dbAntes.toFixed(2)),
              dbDespues: db,
              volumenAntes,
              volumenDespues,
              medidaAntes: medida
                ? { integrated: medida.integrated, truePeakDb: medida.truePeakDb }
                : null,
            },
          },
        ],
        result: payload,
        inversePayload: { trackId: pista.id, db: Number(dbAntes.toFixed(2)) },
      };
    },
  };
}

// ── pista.pan ──────────────────────────────────────────────────────────────

export type PistaPanPayload = { trackId: string; pan: number };

export function crearComandoPistaPan(): CommandDefinition<PistaPanPayload> {
  return {
    type: 'pista.pan',
    replicacion: 'resultado',
    inverseType: 'pista.pan',
    description: 'Fija el paneo de una pista (-1 izquierda .. 1 derecha)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pan: { type: 'number' },
      },
      required: ['trackId', 'pan'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<PistaPanPayload> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const pan = Math.max(-1, Math.min(1, Number(payload.pan)));
      const panAntes = pista.paneo;
      const proyecto: ProjectState = {
        ...estado.project,
        tracks: estado.project.tracks.map((t) =>
          t.id === pista.id
            ? ({ ...t, paneo: pan, fechaModificacion: entorno.ahora() } as Track)
            : t,
        ),
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosTrack.paneoCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: { trackId: pista.id, panAntes, panDespues: pan },
          },
        ],
        result: payload,
        inversePayload: { trackId: pista.id, pan: panAntes },
      };
    },
  };
}

// ── pista.eq.* ─────────────────────────────────────────────────────────────

export function crearComandoPistaEqAgregar(): CommandDefinition<EqPayload> {
  return {
    type: 'pista.eq.agregar',
    replicacion: 'resultado',
    inverseType: 'pista.eq.quitar',
    description: 'Añade (o actualiza) un ecualizador en la pista con bandas reales (Hz/dB)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        bandas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              freq: { type: 'number' },
              gain: { type: 'number' },
              q: { type: 'number' },
              type: { type: 'string' },
              enabled: { type: 'boolean' },
              slope: { type: 'number' },
              mode: { type: 'string' },
              solo: { type: 'boolean' },
            },
            required: ['freq', 'gain', 'q', 'type', 'enabled'],
            additionalProperties: false,
          },
        },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId', 'bandas'],
      additionalProperties: false,
    },
    handler: async (estado, payload): Promise<StateTransition<EqPayload>> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const medida = await obtenerMedida(estado, payload.trackId);
      const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'eq');
      const existente = encontrarProcesador(pista.plugins, 'eq');
      const bandasNorm = normalizarBandasEq(payload.bandas);
      const prevBandas = existente ? bandasDePlugin(existente) : [];
      const plugin = procesadorInfo(
        id,
        'EQ (JasWave)',
        'eq',
        aplicarBandasEq(existente ?? ({} as PluginInfo), bandasNorm).parametros,
      );
      // Si ya existía un EQ, sustituye sus parámetros conservando el id (redo determinista).
      const plugins = existente
        ? pista.plugins.map((p) => (p.id === existente.id ? plugin : p))
        : [...pista.plugins, plugin];
      const proyecto = actualizarPlugins(estado, pista.id, plugins);
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosMezcla.eqCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: {
              trackId: pista.id,
              pluginInstanceId: id,
              creado: !existente,
              bandas: bandasNorm,
              cambios: eqDiferencias(prevBandas.map(conSlot), bandasNorm.map(conSlot)),
              medidaAntes: medidaJSON(medida),
            },
          },
          {
            nombre: EventosPlugin.parametroCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: { trackId: pista.id, pluginInstanceId: id, parameterId: 'eq.band.*.gain' },
          },
        ],
        result: payload,
        // Si ya había EQ, deshacer RESTAURA las bandas previas (editar); si no, lo quita.
        inverseType: existente ? 'pista.eq.editar' : 'pista.eq.quitar',
        inversePayload: {
          trackId: pista.id,
          pluginInstanceId: id,
          bandas: prevBandas,
        },
      };
    },
  };
}

export function crearComandoPistaEqEditar(): CommandDefinition<EqPayload> {
  return {
    type: 'pista.eq.editar',
    replicacion: 'resultado',
    inverseType: 'pista.eq.editar',
    description: 'Edita las bandas del ecualizador existente de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        bandas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              freq: { type: 'number' },
              gain: { type: 'number' },
              q: { type: 'number' },
              type: { type: 'string' },
              enabled: { type: 'boolean' },
              slope: { type: 'number' },
              mode: { type: 'string' },
              solo: { type: 'boolean' },
            },
            required: ['freq', 'gain', 'q', 'type', 'enabled'],
            additionalProperties: false,
          },
        },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId', 'bandas'],
      additionalProperties: false,
    },
    handler: async (estado, payload): Promise<StateTransition<EqPayload>> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const medida = await obtenerMedida(estado, payload.trackId);
      const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'eq');
      const existente = encontrarProcesador(pista.plugins, 'eq');
      const objetivo = existente ?? pista.plugins.find((p) => p.id === id);
      if (!objetivo) {
        throw new Error(`No hay ecualizador en la pista ${pista.id}`);
      }
      const bandasNorm = normalizarBandasEq(payload.bandas);
      const plugin = aplicarBandasEq(objetivo, bandasNorm);
      const plugins = pista.plugins.map((p) => (p.id === objetivo.id ? plugin : p));
      const proyecto = actualizarPlugins(estado, pista.id, plugins);
      const prevBandas = bandasDePlugin(objetivo);
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosMezcla.eqCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: {
              trackId: pista.id,
              pluginInstanceId: objetivo.id,
              creado: false,
              bandas: bandasNorm,
              cambios: eqDiferencias(prevBandas.map(conSlot), bandasNorm.map(conSlot)),
              medidaAntes: medidaJSON(medida),
            },
          },
        ],
        result: payload,
        inversePayload: { trackId: pista.id, pluginInstanceId: objetivo.id, bandas: prevBandas },
      };
    },
  };
}

export function crearComandoPistaEqQuitar(): CommandDefinition<EqPayload> {
  return {
    type: 'pista.eq.quitar',
    replicacion: 'resultado',
    inverseType: 'pista.eq.agregar',
    description: 'Quita el ecualizador de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        bandas: { type: 'array' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: async (estado, payload): Promise<StateTransition<EqPayload>> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'eq');
      const existente = pista.plugins.find((p) => p.id === id) ?? encontrarProcesador(pista.plugins, 'eq');
      if (!existente) {
        throw new Error(`No hay ecualizador en la pista ${pista.id}`);
      }
      const plugins = pista.plugins.filter((p) => p.id !== existente.id);
      const proyecto = actualizarPlugins(estado, pista.id, plugins);
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosMezcla.eqCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: { trackId: pista.id, pluginInstanceId: existente.id, creado: false, bandas: [], removido: true },
          },
        ],
        result: payload,
        inversePayload: {
          trackId: pista.id,
          pluginInstanceId: existente.id,
          bandas: bandasDePlugin(existente),
        },
      };
    },
  };
}

// ── pista.eq.banda.* (alta/baja/edición de UNA banda: auditable e incremental) ─────────────

const ESQUEMA_BANDA = {
  type: 'object',
  properties: {
    freq: { type: 'number' },
    gain: { type: 'number' },
    q: { type: 'number' },
    type: { type: 'string' },
    enabled: { type: 'boolean' },
    slope: { type: 'number' },
    mode: { type: 'string' },
    solo: { type: 'boolean' },
  },
  required: ['freq', 'gain', 'q', 'type', 'enabled'],
  additionalProperties: false,
} as const;

/** Aplica un cambio de bandas sobre el EQ de la pista (lo crea si falta) y devuelve la transición con auditoría. */
function transicionEqBandas(
  estado: DAWState,
  payload: { trackId: string; pluginInstanceId?: string },
  bandasNuevas: EqBand[],
  crear: boolean,
  medida: MedidaPista | undefined,
  extra: Record<string, unknown>,
): StateTransition<unknown> {
  const pista = trackDeEstado(estado, payload.trackId);
  const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'eq');
  const existente = encontrarProcesador(pista.plugins, 'eq');
  if (!existente && !crear) throw new Error(`No hay ecualizador en la pista ${pista.id}`);
  const normalizadas = normalizarBandasEq(bandasNuevas);
  const prev = existente ? bandasDePlugin(existente) : [];
  const plugin = procesadorInfo(existente?.id ?? id, 'EQ (JasWave)', 'eq', bandasEqAParametros(normalizadas));
  const plugins = existente ? pista.plugins.map((p) => (p.id === existente.id ? plugin : p)) : [...pista.plugins, plugin];
  const cambios: CambioEq[] = eqDiferencias(prev.map(conSlot), normalizadas.map(conSlot));
  return {
    state: { ...estado, project: actualizarPlugins(estado, pista.id, plugins) },
    events: [
      {
        nombre: EventosMezcla.eqCambiado,
        version: 1,
        marcaTiempo: entorno.ahora(),
        fuente: 'actuacion-commands',
        payload: {
          trackId: pista.id,
          pluginInstanceId: plugin.id,
          creado: !existente,
          bandas: normalizadas,
          cambios,
          resumen: eqResumenCambios(cambios),
          medidaAntes: medidaJSON(medida),
          ...extra,
        },
      },
    ],
    result: { trackId: pista.id, bandas: normalizadas.length, ...extra },
    // Deshacer restaura el conjunto completo de bandas previo (o quita el EQ si lo creó este comando)
    inverseType: existente ? 'pista.eq.editar' : 'pista.eq.quitar',
    inversePayload: { trackId: pista.id, pluginInstanceId: plugin.id, bandas: prev },
  };
}

export function crearComandoPistaEqBandaAgregar(): CommandDefinition<EqBandaAgregarPayload> {
  return {
    type: 'pista.eq.banda.agregar',
    replicacion: 'resultado',
    inverseType: 'pista.eq.editar',
    description: `Agrega UNA banda al ecualizador de la pista (lo crea si falta; hasta ${EQ_MAX_BANDAS} bandas)`,
    risk: 'write',
    schema: {
      type: 'object',
      properties: { trackId: { type: 'string' }, banda: ESQUEMA_BANDA, pluginInstanceId: { type: 'string' } },
      required: ['trackId', 'banda'],
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const pista = trackDeEstado(estado, payload.trackId);
      const existente = encontrarProcesador(pista.plugins, 'eq');
      const actuales = existente ? bandasDePlugin(existente) : [];
      const medida = await obtenerMedida(estado, payload.trackId);
      const t = transicionEqBandas(estado, payload, [...actuales, payload.banda], true, medida, { indice: actuales.length });
      return t as StateTransition<EqBandaAgregarPayload>;
    },
  };
}

export function crearComandoPistaEqBandaEditar(): CommandDefinition<EqBandaEditarPayload> {
  return {
    type: 'pista.eq.banda.editar',
    replicacion: 'resultado',
    inverseType: 'pista.eq.editar',
    description: 'Cambia solo los campos indicados de una banda del ecualizador (indice 0-based)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        indice: { type: 'number' },
        cambios: { type: 'object' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId', 'indice', 'cambios'],
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const pista = trackDeEstado(estado, payload.trackId);
      const existente = encontrarProcesador(pista.plugins, 'eq');
      if (!existente) throw new Error(`No hay ecualizador en la pista ${pista.id}`);
      const actuales = bandasDePlugin(existente);
      if (!Number.isInteger(payload.indice) || payload.indice < 0 || payload.indice >= actuales.length) {
        throw new Error(`La banda ${payload.indice} no existe (hay ${actuales.length})`);
      }
      const medida = await obtenerMedida(estado, payload.trackId);
      const nuevas = actuales.map((b, i) => (i === payload.indice ? { ...b, ...payload.cambios } : b));
      return transicionEqBandas(estado, payload, nuevas, false, medida, { indice: payload.indice }) as StateTransition<EqBandaEditarPayload>;
    },
  };
}

export function crearComandoPistaEqBandaQuitar(): CommandDefinition<EqBandaQuitarPayload> {
  return {
    type: 'pista.eq.banda.quitar',
    replicacion: 'resultado',
    inverseType: 'pista.eq.editar',
    description: 'Quita UNA banda del ecualizador de la pista (indice 0-based); las demás conservan su orden',
    risk: 'write',
    schema: {
      type: 'object',
      properties: { trackId: { type: 'string' }, indice: { type: 'number' }, pluginInstanceId: { type: 'string' } },
      required: ['trackId', 'indice'],
      additionalProperties: false,
    },
    handler: async (estado, payload) => {
      const pista = trackDeEstado(estado, payload.trackId);
      const existente = encontrarProcesador(pista.plugins, 'eq');
      if (!existente) throw new Error(`No hay ecualizador en la pista ${pista.id}`);
      const actuales = bandasDePlugin(existente);
      if (!Number.isInteger(payload.indice) || payload.indice < 0 || payload.indice >= actuales.length) {
        throw new Error(`La banda ${payload.indice} no existe (hay ${actuales.length})`);
      }
      const medida = await obtenerMedida(estado, payload.trackId);
      const nuevas = actuales.filter((_, i) => i !== payload.indice);
      return transicionEqBandas(estado, payload, nuevas, false, medida, { indice: payload.indice, removida: true }) as StateTransition<EqBandaQuitarPayload>;
    },
  };
}

// ── pista.compresor.* ──────────────────────────────────────────────────────

export function crearComandoPistaCompresorAgregar(): CommandDefinition<CompPayload> {
  return {
    type: 'pista.compresor.agregar',
    replicacion: 'resultado',
    inverseType: 'pista.compresor.quitar',
    description: 'Añade (o actualiza) un compresor en la pista con valores reales (dB, ms, :1)',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        threshold: { type: 'number' },
        ratio: { type: 'number' },
        attack: { type: 'number' },
        release: { type: 'number' },
        knee: { type: 'number' },
        makeup: { type: 'number' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<CompPayload> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'compresor');
      const existente = encontrarProcesador(pista.plugins, 'compresor');
      const plugin = procesadorInfo(
        id,
        'Compresor (JasWave)',
        'compresor',
        compParametros(payload),
      );
      const plugins = existente
        ? pista.plugins.map((p) => (p.id === existente.id ? plugin : p))
        : [...pista.plugins, plugin];
      const proyecto = actualizarPlugins(estado, pista.id, plugins);
      const prev = existente ? compDeParametros(existente.parametros) : {};
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosMezcla.compresorCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: {
              trackId: pista.id,
              pluginInstanceId: id,
              creado: !existente,
              parametros: payload,
              antes: prev,
            },
          },
        ],
        result: payload,
        inversePayload: { trackId: pista.id, pluginInstanceId: id, ...prev },
      };
    },
  };
}

export function crearComandoPistaCompresorEditar(): CommandDefinition<CompPayload> {
  return {
    type: 'pista.compresor.editar',
    replicacion: 'resultado',
    inverseType: 'pista.compresor.editar',
    description: 'Edita los parámetros del compresor existente de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        threshold: { type: 'number' },
        ratio: { type: 'number' },
        attack: { type: 'number' },
        release: { type: 'number' },
        knee: { type: 'number' },
        makeup: { type: 'number' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<CompPayload> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'compresor');
      const existente = pista.plugins.find((p) => p.id === id) ?? encontrarProcesador(pista.plugins, 'compresor');
      if (!existente) {
        throw new Error(`No hay compresor en la pista ${pista.id}`);
      }
      const plugin = procesadorInfo(
        existente.id,
        existente.nombre,
        'compresor',
        compParametros(payload),
      );
      const plugins = pista.plugins.map((p) => (p.id === existente.id ? plugin : p));
      const proyecto = actualizarPlugins(estado, pista.id, plugins);
      const prev = compDeParametros(existente.parametros);
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosMezcla.compresorCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: {
              trackId: pista.id,
              pluginInstanceId: existente.id,
              creado: false,
              parametros: payload,
              antes: prev,
            },
          },
        ],
        result: payload,
        inversePayload: { trackId: pista.id, pluginInstanceId: existente.id, ...prev },
      };
    },
  };
}

export function crearComandoPistaCompresorQuitar(): CommandDefinition<CompPayload> {
  return {
    type: 'pista.compresor.quitar',
    replicacion: 'resultado',
    inverseType: 'pista.compresor.agregar',
    description: 'Quita el compresor de una pista',
    risk: 'write',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<CompPayload> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'compresor');
      const existente = pista.plugins.find((p) => p.id === id) ?? encontrarProcesador(pista.plugins, 'compresor');
      if (!existente) {
        throw new Error(`No hay compresor en la pista ${pista.id}`);
      }
      const plugins = pista.plugins.filter((p) => p.id !== existente.id);
      const proyecto = actualizarPlugins(estado, pista.id, plugins);
      const prev = compDeParametros(existente.parametros);
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosMezcla.compresorCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: {
              trackId: pista.id,
              pluginInstanceId: existente.id,
              creado: false,
              removido: true,
              antes: prev,
            },
          },
        ],
        result: payload,
        inversePayload: { trackId: pista.id, pluginInstanceId: existente.id, ...prev },
      };
    },
  };
}

// ── pista.limite ───────────────────────────────────────────────────────────

export function crearComandoPistaLimite(): CommandDefinition<LimitePayload> {
  return {
    type: 'pista.limite',
    replicacion: 'resultado',
    description: 'Fija el techo (ceiling) y ganancia de entrada del limitador de una pista',
    risk: 'write',
    historialUndo: 'instantanea',
    schema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        ceiling: { type: 'number' },
        gainIn: { type: 'number' },
        pluginInstanceId: { type: 'string' },
      },
      required: ['trackId', 'ceiling'],
      additionalProperties: false,
    },
    handler: (estado, payload): StateTransition<LimitePayload> => {
      const pista = trackDeEstado(estado, payload.trackId);
      const id = payload.pluginInstanceId ?? idProcesador(pista.id, 'limite');
      const existente = encontrarProcesador(pista.plugins, 'limite');
      const plugin = procesadorInfo(
        id,
        'Limitador (JasWave)',
        'limite',
        [
          parametro('limit.ceiling', 'Techo', payload.ceiling, -60, 0, 0.1, 'dBFS'),
          parametro('limit.gainIn', 'Ganancia entrada', payload.gainIn ?? 0, -24, 24, 0.1, 'dB'),
        ],
      );
      const plugins = existente
        ? pista.plugins.map((p) => (p.id === existente.id ? plugin : p))
        : [...pista.plugins, plugin];
      const proyecto = actualizarPlugins(estado, pista.id, plugins);
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosPlugin.parametroCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: { trackId: pista.id, pluginInstanceId: id, parameterId: 'limit.ceiling' },
          },
        ],
        result: payload,
      };
    },
  };
}

// ── master.normalizar ──────────────────────────────────────────────────────

export function crearComandoMasterNormalizar(): CommandDefinition<NormalizarPayload> {
  return {
    type: 'master.normalizar',
    replicacion: 'resultado',
    description: 'Normaliza el master a un objetivo LUFS real (usa medición A7b)',
    risk: 'write',
    historialUndo: 'instantanea',
    schema: {
      type: 'object',
      properties: {
        objetivoLufs: { type: 'number' },
        trackId: { type: 'string' },
      },
      required: ['objetivoLufs'],
      additionalProperties: false,
    },
    handler: async (estado, payload): Promise<StateTransition<NormalizarPayload>> => {
      const objetivo = Math.max(-40, Math.min(0, Number(payload.objetivoLufs)));
      const medida = await obtenerMedida(estado, 'master');
      if (!medida) {
        throw new Error('No hay medición del master disponible para normalizar (ejecuta analysis.mix primero)');
      }
      // Una medición en silencio (p. ej. un análisis que no renderiza los VST) daría una subida absurda (+56 dB).
      if (!Number.isFinite(medida.integrated) || medida.integrated < -60) {
        throw new Error(
          `La medición del master está vacía (${Number.isFinite(medida.integrated) ? medida.integrated.toFixed(1) : 'NaN'} LUFS): no se normaliza. ` +
            'El análisis offline web no procesa los instrumentos VST; mide con un bounce nativo.',
        );
      }
      const master = estado.project.master;
      const volumenAntes = master.volumen;
      const deltaDb = objetivo - medida.integrated;
      const volumenDespues = Math.max(0.001, Math.min(10, volumenAntes * Math.pow(10, deltaDb / 20)));
      const proyecto: ProjectState = {
        ...estado.project,
        master: { ...master, volumen: volumenDespues },
        modificado: true,
        fechaModificacion: entorno.ahora(),
      };
      return {
        state: { ...estado, project: proyecto },
        events: [
          {
            nombre: EventosMezcla.eqCambiado,
            version: 1,
            marcaTiempo: entorno.ahora(),
            fuente: 'actuacion-commands',
            payload: {
              trackId: 'master',
              accion: 'normalizar',
              objetivoLufs: objetivo,
              integradoAntes: medida.integrated,
              deltaDb: Number(deltaDb.toFixed(2)),
              volumenAntes,
              volumenDespues,
            },
          },
        ],
        result: payload,
      };
    },
  };
}

// ── Utilidades internas ────────────────────────────────────────────────────

/** Asigna el slot por posición (las bandas del EQ de dominio se numeran 0..n-1) para compararlas. */
function conSlot(b: EqBand, i: number): EqBand {
  return { ...b, slot: b.slot ?? i };
}

function bandasDePlugin(plugin: PluginInfo): EqBand[] {
  const bandas: EqBand[] = [];
  const indices = new Set<number>();
  for (const p of plugin.parametros) {
    const m = /^eq\.band\.(\d+)\.(freq|gain|q|type|enabled|slope|mode|solo)$/.exec(p.id);
    if (m) indices.add(Number(m[1]));
  }
  // Esquema 1 (proyectos anteriores): códigos de tipo bell=0, lowShelf=1, highShelf=2, lowCut=3, highCut=4.
  const esquema = Number(plugin.parametros.find((x) => x.id === 'eq.version')?.valor ?? 1);
  const tipoHeredado: EqBand['type'][] = ['bell', 'lowShelf', 'highShelf', 'lowCut', 'highCut'];
  for (const i of [...indices].sort((a, b) => a - b)) {
    const get = (sufijo: string) => {
      const p = plugin.parametros.find((x) => x.id === `eq.band.${i}.${sufijo}`);
      return p ? p.valor : undefined;
    };
    const cod = Number(get('type') ?? 0);
    const type: EqBand['type'] = esquema >= 2 ? codigoEqATipo(cod) : (tipoHeredado[cod] ?? 'bell');
    const pendiente = Number(get('slope') ?? 0);
    bandas.push({
      freq: Number(get('freq') ?? 0),
      gain: Number(get('gain') ?? 0),
      q: Number(get('q') ?? 1),
      type,
      enabled: (get('enabled') ?? 1) !== 0,
      ...(pendiente > 0 ? { slope: pendiente as PendienteEq } : {}),
      ...(esquema >= 2 ? { mode: MODOS_BANDA_EQ[Number(get('mode') ?? 0)] ?? 'stereo' } : {}),
      ...(Number(get('solo') ?? 0) !== 0 ? { solo: true } : {}),
    });
  }
  return bandas;
}

function compParametros(p: CompPayload): ParametroPluginOpciones[] {
  return [
    parametro('comp.threshold', 'Umbral', p.threshold ?? -18, -60, 0, 0.1, 'dB'),
    parametro('comp.ratio', 'Relación', p.ratio ?? 4, 1, 100, 0.1, ':1'),
    parametro('comp.attack', 'Ataque', p.attack ?? 10, 0.01, 2000, 0.01, 'ms'),
    parametro('comp.release', 'Liberación', p.release ?? 100, 1, 5000, 1, 'ms'),
    parametro('comp.knee', 'Rodilla', p.knee ?? 6, 0, 24, 0.1, 'dB'),
    parametro('comp.makeup', 'Ganancia salida', p.makeup ?? 0, 0, 24, 0.1, 'dB'),
  ];
}

function compDeParametros(parametros: ParametroPluginOpciones[]): Partial<CompPayload> {
  const g = (id: string) => Number(parametros.find((x) => x.id === id)?.valor ?? 0);
  return {
    threshold: g('comp.threshold'),
    ratio: g('comp.ratio'),
    attack: g('comp.attack'),
    release: g('comp.release'),
    knee: g('comp.knee'),
    makeup: g('comp.makeup'),
  };
}
