/**
 * Tests de ciclo de vida de suscripciones (servicios, plugins, sesión IA).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { BusEventosMemoria } from '../events/event-bus';
import {
  ServicioProyectoEventos,
  crearGestorSuscripcionesPlugin,
  iniciarSesionContextoIA,
} from '../events/ciclo-vida-suscripciones';
import { EventosProyecto, EventosTrack, EventosTransporte } from '../constants/nombres-eventos';
import { crearEstadoInicial } from '../state/estado-inicial';
import { crearTiendaDAW } from '../state/tienda';

describe('ciclo de vida de suscripciones', () => {
  let bus: BusEventosMemoria;

  afterEach(() => {
    bus?.destruir();
  });

  it('ServicioProyectoEventos limpia todos los manejadores en shutdown', () => {
    bus = new BusEventosMemoria({ batchHabilitado: false });
    const onCargado = vi.fn();
    const onTrack = vi.fn();
    const servicio = new ServicioProyectoEventos(bus, {
      onProyectoCargado: onCargado,
      onTrackCreada: onTrack,
    });

    servicio.initialize();
    expect(servicio.estaActivo()).toBe(true);
    expect(bus.cantidadManejadores()).toBeGreaterThan(0);

    bus.emit(EventosProyecto.cargado, { id: 'p1' });
    bus.emit(EventosTrack.creada, { trackId: 't1' });
    expect(onCargado).toHaveBeenCalled();
    expect(onTrack).toHaveBeenCalled();

    servicio.shutdown();
    expect(servicio.estaActivo()).toBe(false);
    expect(bus.cantidadManejadores()).toBe(0);

    bus.emit(EventosProyecto.cargado, { id: 'p2' });
    expect(onCargado).toHaveBeenCalledTimes(1);
  });

  it('GestorSuscripcionesPlugin aísla scopes por plugin', () => {
    bus = new BusEventosMemoria({ batchHabilitado: false });
    const host = crearGestorSuscripcionesPlugin(bus);
    const a = vi.fn();
    const b = vi.fn();

    host.alCargar('plug-a', (scope) => {
      scope.on(EventosTransporte.posicionCambiada, a);
    });
    host.alCargar('plug-b', (scope) => {
      scope.on(EventosTransporte.posicionCambiada, b);
    });
    expect(host.cantidadPlugins()).toBe(2);
    expect(bus.cantidadManejadores()).toBe(2);

    bus.emit(EventosTransporte.posicionCambiada, { beat: 1 });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    host.alDescargar('plug-a');
    expect(host.estaCargado('plug-a')).toBe(false);
    expect(bus.cantidadManejadores()).toBe(1);

    bus.emit(EventosTransporte.posicionCambiada, { beat: 2 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    host.shutdown();
    expect(bus.cantidadManejadores()).toBe(0);
  });

  it('iniciarSesionContextoIA se limpia al destruir el scope', () => {
    bus = new BusEventosMemoria({ batchHabilitado: false });
    const onTrack = vi.fn();
    const scope = iniciarSesionContextoIA(bus, { onTrackCreada: onTrack });
    expect(scope.cantidadSuscripciones()).toBeGreaterThan(0);

    bus.emit(EventosTrack.creada, { trackId: 'x' });
    expect(onTrack).toHaveBeenCalledTimes(1);

    scope.destruir();
    expect(scope.estaActivo()).toBe(false);
    expect(bus.cantidadManejadores()).toBe(0);
  });

  it('tienda.iniciarSesionIA / finalizarSesionIA', () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    expect(tienda.sesionIAActiva()).toBe(false);

    tienda.iniciarSesionIA();
    expect(tienda.sesionIAActiva()).toBe(true);
    expect(tienda.busEventos.cantidadManejadores()).toBeGreaterThan(0);

    tienda.finalizarSesionIA();
    expect(tienda.sesionIAActiva()).toBe(false);
    tienda.busEventos.destruir();
  });
});
