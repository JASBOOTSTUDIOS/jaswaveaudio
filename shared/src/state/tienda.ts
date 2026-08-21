/**
 * Tienda de estado centralizada del DAW.
 *
 * Propósito:
 *   Gestionar el estado global DAWState con inmutabilidad lógica,
 *   notificación a suscriptores y acceso controlado desde la UI
 *   y el dominio.
 *
 * Importancia:
 *   - Es la única vía para leer y mutar el estado del DAW.
 *   - Garantiza que las mutaciones pasen por el Command System.
 *   - Centraliza la lógica de suscripción y notificación.
 *   - Facilita la implementación de watchers, time-travel y debugging.
 *
 * Función:
 *   Exporta TiendaDAW con getState, setState, suscribir, despachar,
 *   reemplazarEstado y helpers de notificación a listeners.
 */

import type { DAWState } from '../types/state';
import type { Command, CommandPayload } from '../types/command';
import type { DAWStatePartial } from '../types/state';
import type { CommandRegistry } from './registro-comandos';
import { crearRegistroComandos } from './registro-comandos';
import { registrarComandosBuiltin } from './comandos-builtin';
import { CommandExecutor as CommandExecutorCls } from './ejecutor-comandos';
import { crearPilaDeshacerRehacer } from './pila-deshacer-rehacer';
import { crearRegistroAuditoria } from './registro-auditoria';
import { BusEventosMemoria } from '../events/event-bus';
import type { SessionScope } from '../events/event-bus';
import { iniciarSesionContextoIA } from '../events/ciclo-vida-suscripciones';
import { crearPermissionManager, type PermissionManager } from './permissions';
import { crearMemoryManager, type MemoryManager } from '../ai/memory-manager';
import { crearGestorContexto, type ContextManagerConfig } from '../ai/context-manager';
import type { AssembledContext, ImmediateContext, ProjectContext, RecentEvent, TurnoConversacion } from '../types/contexto';
import type { ToolDefinition } from '../types/command';

export interface TiendaDAWOpciones {
  estadoInicial?: DAWState;
  maximoListeners?: number;
}

export interface TiendaDAWListener {
  (estado: DAWState, estadoAnterior: DAWState): void;
}

export interface TiendaDAW {
  obtenerEstado(): DAWState;
  establecerEstado(actualizador: DAWStatePartial | ((estado: DAWState) => DAWStatePartial)): DAWState;
  reemplazarEstado(estado: DAWState): DAWState;
  suscribir(listener: TiendaDAWListener): () => void;
  despachar(comando: CommandPayload): Promise<DAWState>;
  obtenerHistorialListeners(): number;
  registroComandos: CommandRegistry;
  executor: CommandExecutorCls;
  busEventos: BusEventosMemoria;
  permisos: PermissionManager;
  memoria: MemoryManager;
  ensamblarContexto(
    inmediato: ImmediateContext,
    historialTurnos: TurnoConversacion[],
    herramientas: ToolDefinition[],
  ): AssembledContext;
  /** Inicia suscripciones de sesión IA (limpiar con finalizarSesionIA). */
  iniciarSesionIA(): SessionScope;
  finalizarSesionIA(): void;
  sesionIAActiva(): boolean;
}

export function crearTiendaDAW(opciones?: TiendaDAWOpciones): TiendaDAW {
  const { estadoInicial, maximoListeners = 100 } = opciones ?? {};
  const estadoInicialResolved = estadoInicial ?? (() => {
    throw new Error('TiendaDAW requiere estadoInicial o usar crearEstadoInicial() de shared/src/state/estado-inicial.ts');
  })();

  const bus = new BusEventosMemoria({ capacidadBufferReplay: 2000, tamanoBatch: 10 });
  const registro = crearRegistroComandos();
  const pila = crearPilaDeshacerRehacer(1000);
  const auditoria = crearRegistroAuditoria();
  const executor = new CommandExecutorCls({
    busEventos: bus,
    pila,
    registro,
    auditoria,
    estadoInicial: estadoInicialResolved,
  });

  registrarComandosBuiltin(registro);

  const permisos = crearPermissionManager({ busEventos: bus });
  const memoria = crearMemoryManager();
  const gestorContexto = crearGestorContexto();

  // Buffer de eventos recientes para el Context Manager
  const recentEventsBuffer: RecentEvent[] = [];
  const MAX_RECENT_EVENTS = 200;

  // Intercept bus.emit to feed events to the context manager buffer
  const originalEmit = bus.emit.bind(bus);
  const wrappedEmit: typeof bus.emit = (nombre: string, payload?: unknown, opciones?: any) => {
    const recent: RecentEvent = {
      nombre,
      timestamp: Date.now(),
      source: (payload as any)?.fuente ?? 'system',
      summary: payload ? JSON.stringify(payload).slice(0, 120) : nombre,
    };
    recentEventsBuffer.push(recent);
    if (recentEventsBuffer.length > MAX_RECENT_EVENTS) {
      recentEventsBuffer.splice(0, recentEventsBuffer.length - MAX_RECENT_EVENTS);
    }
    return originalEmit(nombre, payload, opciones);
  };
  bus.emit = wrappedEmit;

  (globalThis as any).__jaswaveCommandRegistry = registro;
  (globalThis as any).__jaswaveEventBus = bus;

  let estadoActual = executor.obtenerEstado();
  const listeners = new Set<TiendaDAWListener>();
  let sesionIA: SessionScope | null = null;

  function notificar(estadoNuevo: DAWState, estadoAnterior: DAWState): void {
    for (const listener of listeners) {
      try {
        listener(estadoNuevo, estadoAnterior);
      } catch (error) {
        console.error('Error en listener de TiendaDAW:', error);
      }
    }
  }

  function validarMaximoListeners(): void {
    if (listeners.size >= maximoListeners) {
      console.warn(`TiendaDAW alcanzó el máximo de listeners (${maximoListeners})`);
    }
  }

  // Interceptar ejecuciones de comandos en executor para notificar automáticamente a la tienda
  const originalExecute = executor.execute.bind(executor);
  executor.execute = (async (...args: Parameters<typeof originalExecute>) => {
    const estadoAnterior = executor.obtenerEstado();
    const res = await originalExecute(...args);
    if (res.success) {
      const estadoNuevo = executor.obtenerEstado();
      if (estadoNuevo !== estadoAnterior) {
        estadoActual = estadoNuevo;
        notificar(estadoNuevo, estadoAnterior);
      }
    }
    return res;
  }) as typeof executor.execute;

  const originalUndo = executor.undo.bind(executor);
  executor.undo = (async (...args: Parameters<typeof originalUndo>) => {
    const estadoAnterior = executor.obtenerEstado();
    const res = await originalUndo(...args);
    if (res?.success) {
      const estadoNuevo = executor.obtenerEstado();
      if (estadoNuevo !== estadoAnterior) {
        estadoActual = estadoNuevo;
        notificar(estadoNuevo, estadoAnterior);
      }
    }
    return res;
  }) as typeof executor.undo;

  const originalRedo = executor.redo.bind(executor);
  executor.redo = (async (...args: Parameters<typeof originalRedo>) => {
    const estadoAnterior = executor.obtenerEstado();
    const res = await originalRedo(...args);
    if (res?.success) {
      const estadoNuevo = executor.obtenerEstado();
      if (estadoNuevo !== estadoAnterior) {
        estadoActual = estadoNuevo;
        notificar(estadoNuevo, estadoAnterior);
      }
    }
    return res;
  }) as typeof executor.redo;

  return {
    obtenerEstado(): DAWState {
      return executor.obtenerEstado();
    },

    establecerEstado(actualizador: DAWStatePartial | ((estado: DAWState) => DAWStatePartial)): DAWState {
      const estadoAnterior = executor.obtenerEstado();
      const parcial = typeof actualizador === 'function' ? actualizador(estadoAnterior) : actualizador;
      const estadoNuevo = { ...estadoAnterior, ...parcial } as DAWState;
      executor['estado'] = estadoNuevo;
      estadoActual = estadoNuevo;
      notificar(estadoNuevo, estadoAnterior);
      return estadoNuevo;
    },

    reemplazarEstado(estadoNuevo: DAWState): DAWState {
      const estadoAnterior = executor.obtenerEstado();
      executor['estado'] = estadoNuevo;
      estadoActual = estadoNuevo;
      notificar(estadoNuevo, estadoAnterior);
      return estadoNuevo;
    },

    suscribir(listener: TiendaDAWListener): () => void {
      validarMaximoListeners();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async despachar(comando: CommandPayload): Promise<DAWState> {
      const estadoAnterior = executor.obtenerEstado();
      const resultado = await executor.execute(comando.type, comando.payload);

      if (resultado.success) {
        const estadoNuevo = executor.obtenerEstado();
        if (estadoNuevo !== estadoAnterior) {
          estadoActual = estadoNuevo;
          notificar(estadoNuevo, estadoAnterior);
        }
        return estadoNuevo;
      }

      const msg = resultado.error?.message ?? `Comando fallido: ${comando.type}`;
      bus.emit('comando.fallido', {
        type: comando.type,
        error: msg,
        code: resultado.error?.code ?? 'DESPACHAR_FAILED',
      });
      throw new Error(msg);
    },

    obtenerHistorialListeners(): number {
      return listeners.size;
    },
    registroComandos: registro,
    executor,
    busEventos: bus,
    permisos,
    memoria,
    ensamblarContexto(
      inmediato: ImmediateContext,
      historialTurnos: TurnoConversacion[],
      herramientas: ToolDefinition[],
    ): AssembledContext {
      const estado = executor.obtenerEstado();
      const tracks = estado.project?.tracks ?? [];
      const bpmValor = estado.project?.bpm?.valor ?? 120;
      const ts = estado.project?.timeSignature ?? { numerador: 4, denominador: 4 };
      const proyecto: ProjectContext = {
        projectName: estado.project?.nombre ?? 'Sin nombre',
        tempo: {
          valor: bpmValor,
          min: 20,
          max: 300,
          texto: `${bpmValor}`,
          modo: 'fijo',
          cambios: [],
        },
        timeSignature: {
          numerador: ts.numerador,
          denominador: ts.denominador,
          nombre: `${ts.numerador}/${ts.denominador}`,
          cambios: [],
        },
        trackCount: tracks.length,
        trackSummary: tracks.map((t: any) => ({
          id: t.id,
          name: t.nombre,
          type: t.tipo,
          color: t.color ?? '#888888',
          muted: t.mute ?? false,
          soloed: t.solo ?? false,
          volume: t.volumen ?? 1.0,
        })),
        busCount: 0,
        pluginCount: 0,
        routingSummary: { buses: 0, sends: 0, sidechains: 0 },
        analysisSummary: { durationSeconds: 0, activeClips: 0 },
      };
      const eventosRecientes = [...recentEventsBuffer];
      const memoriasSesion = memoria.getSession();
      const memoriasPersistentes = memoria.getForContext(inmediato.scope);
      return gestorContexto.ensamblarContexto(
        inmediato,
        historialTurnos,
        proyecto,
        eventosRecientes,
        memoriasSesion,
        memoriasPersistentes.persistent,
        herramientas,
      );
    },

    iniciarSesionIA(): SessionScope {
      if (sesionIA?.estaActivo()) {
        sesionIA.destruir();
      }
      sesionIA = iniciarSesionContextoIA(bus, {
        onTrackCreada: (payload) => {
          memoria.addSession({
            id: `evt-track-${Date.now()}`,
            content: `Pista creada: ${JSON.stringify(payload).slice(0, 120)}`,
            timestamp: Date.now(),
            source: 'ai',
            confidence: 0.6,
            relevance: 0.5,
            scope: 'session',
          });
        },
        onProyectoCargado: (payload) => {
          memoria.addSession({
            id: `evt-proj-${Date.now()}`,
            content: `Proyecto cargado: ${JSON.stringify(payload).slice(0, 120)}`,
            timestamp: Date.now(),
            source: 'ai',
            confidence: 0.7,
            relevance: 0.6,
            scope: 'session',
          });
        },
      });
      return sesionIA;
    },

    finalizarSesionIA(): void {
      sesionIA?.destruir();
      sesionIA = null;
      memoria.clearSession();
    },

    sesionIAActiva(): boolean {
      return sesionIA?.estaActivo() ?? false;
    },
  };
}
