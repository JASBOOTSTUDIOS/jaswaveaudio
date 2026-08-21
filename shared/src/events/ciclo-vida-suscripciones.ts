/**
 * Patrones de ciclo de vida de suscripciones al BusEventos.
 *
 * UI → useEventBus (React). Servicios / IA / plugins → SessionScope o
 * los helpers de este módulo con initialize()/shutdown().
 */

import type { BusEventos, ManejadorEvento, SessionScope } from './event-bus';
import { crearSessionScope } from './event-bus';
import {
  EventosProyecto,
  EventosTrack,
  EventosTransporte,
  EventosClip,
} from '../constants/nombres-eventos';

export interface ServicioConSuscripciones {
  initialize(): void;
  shutdown(): void;
  estaActivo(): boolean;
  cantidadSuscripciones(): number;
}

export type CallbacksServicioProyecto = {
  onProyectoCargado?: ManejadorEvento;
  onProyectoGuardado?: ManejadorEvento;
  onProyectoCerrado?: ManejadorEvento;
  onPosicionCambiada?: ManejadorEvento;
  onTrackCreada?: ManejadorEvento;
  onTrackEliminada?: ManejadorEvento;
};

/**
 * Servicio de dominio con initialize/shutdown (patrón proceso / Electron).
 * Usa SessionScope internamente.
 */
export class ServicioProyectoEventos implements ServicioConSuscripciones {
  private scope: SessionScope | null = null;

  constructor(
    private readonly bus: BusEventos,
    private readonly callbacks: CallbacksServicioProyecto = {},
  ) {}

  initialize(): void {
    this.shutdown();
    this.scope = crearSessionScope(this.bus);
    const c = this.callbacks;
    if (c.onProyectoCargado) this.scope.on(EventosProyecto.cargado, c.onProyectoCargado);
    if (c.onProyectoGuardado) this.scope.on(EventosProyecto.guardado, c.onProyectoGuardado);
    if (c.onProyectoCerrado) this.scope.on(EventosProyecto.cerrado, c.onProyectoCerrado);
    if (c.onPosicionCambiada) this.scope.on(EventosTransporte.posicionCambiada, c.onPosicionCambiada);
    if (c.onTrackCreada) this.scope.on(EventosTrack.creada, c.onTrackCreada);
    if (c.onTrackEliminada) this.scope.on(EventosTrack.eliminada, c.onTrackEliminada);
  }

  shutdown(): void {
    this.scope?.destruir();
    this.scope = null;
  }

  estaActivo(): boolean {
    return this.scope?.estaActivo() ?? false;
  }

  cantidadSuscripciones(): number {
    return this.scope?.cantidadSuscripciones() ?? 0;
  }
}

export type CallbacksSesionIA = {
  onProyectoCargado?: ManejadorEvento;
  onProyectoGuardado?: ManejadorEvento;
  onTrackCreada?: ManejadorEvento;
  onTrackEliminada?: ManejadorEvento;
  onClipCreado?: ManejadorEvento;
  onClipEliminado?: ManejadorEvento;
};

/**
 * Sesión de conversación IA: suscripciones ligadas a start/end de sesión.
 */
export function iniciarSesionContextoIA(bus: BusEventos, callbacks: CallbacksSesionIA = {}): SessionScope {
  const scope = crearSessionScope(bus);
  if (callbacks.onProyectoCargado) scope.on(EventosProyecto.cargado, callbacks.onProyectoCargado);
  if (callbacks.onProyectoGuardado) scope.on(EventosProyecto.guardado, callbacks.onProyectoGuardado);
  if (callbacks.onTrackCreada) scope.on(EventosTrack.creada, callbacks.onTrackCreada);
  if (callbacks.onTrackEliminada) scope.on(EventosTrack.eliminada, callbacks.onTrackEliminada);
  if (callbacks.onClipCreado) scope.on(EventosClip.creado, callbacks.onClipCreado);
  if (callbacks.onClipEliminado) scope.on(EventosClip.eliminado, callbacks.onClipEliminado);
  return scope;
}

export interface GestorSuscripcionesPlugin {
  alCargar(pluginId: string, suscribir: (scope: SessionScope) => void): void;
  alDescargar(pluginId: string): void;
  shutdown(): void;
  estaCargado(pluginId: string): boolean;
  cantidadPlugins(): number;
}

/** El Plugin Host gestiona un SessionScope por instancia de plugin. */
export function crearGestorSuscripcionesPlugin(bus: BusEventos): GestorSuscripcionesPlugin {
  const porPlugin = new Map<string, SessionScope>();

  function alDescargar(pluginId: string): void {
    const scope = porPlugin.get(pluginId);
    if (!scope) return;
    scope.destruir();
    porPlugin.delete(pluginId);
  }

  return {
    alCargar(pluginId: string, suscribir: (scope: SessionScope) => void): void {
      alDescargar(pluginId);
      const scope = crearSessionScope(bus);
      suscribir(scope);
      porPlugin.set(pluginId, scope);
    },

    alDescargar,

    shutdown(): void {
      for (const scope of porPlugin.values()) {
        scope.destruir();
      }
      porPlugin.clear();
    },

    estaCargado(pluginId: string): boolean {
      return porPlugin.has(pluginId);
    },

    cantidadPlugins(): number {
      return porPlugin.size;
    },
  };
}
