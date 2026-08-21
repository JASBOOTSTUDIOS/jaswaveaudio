/**
 * Suite de tests de contratos para BusEventosMemoria.
 *
 * Propósito:
 *   Verificar el comportamiento del bus de eventos en memoria, cubriendo
 *   suscripciones, emisión, replay, batch, priorización y manejo de
 *   errores en manejadores.
 *
 * Importancia:
 *   - Garantiza que el bus mantenga sus garantías de entrega, filtrado,
 *     aislamiento de errores y trazabilidad.
 *   - Protege contra regresiones en funcionalidades críticas como el
 *     buffer de replay, la priorización por dominio y el ciclo de vida
 *     de suscripciones.
 *
 * Función:
 *   Ejecuta casos de prueba unitarios que validan on/off/emit/once/clear,
 *   capacidad del buffer, filtros, batch, prioridades y estabilidad
 *   frente a excepciones en manejadores.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BusEventosMemoria, crearSessionScope } from '../events/event-bus';
import type { EventoDominio } from '../events/evento-dominio';
import { RegistroSchemasEventos } from '../events/schemas-eventos';

describe('BusEventosMemoria', () => {
  let bus: BusEventosMemoria;

  beforeEach(() => {
    bus = new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 });
  });

  afterEach(() => {
    bus.destruir();
  });

  it('should emit and consume events', () => {
    const manejador = vi.fn();
    bus.on('evento.prueba', manejador);
    bus.emit('evento.prueba', { valor: 42 });
    expect(manejador).toHaveBeenCalledWith({ valor: 42 });
  });

  it('should unsubscribe correctly', () => {
    const manejador = vi.fn();
    const suscripcion = bus.on('evento.prueba', manejador);
    suscripcion.cancelarSuscripcion();
    bus.emit('evento.prueba', {});
    expect(manejador).not.toHaveBeenCalled();
  });

  it('should execute once handlers only once', () => {
    const manejador = vi.fn();
    bus.once('evento.prueba', manejador);
    bus.emit('evento.prueba', {});
    bus.emit('evento.prueba', {});
    expect(manejador).toHaveBeenCalledTimes(1);
  });

  it('should store events in replay buffer', () => {
    bus.emit('evento.a', { a: 1 });
    bus.emit('evento.b', { b: 2 });
    const eventos = bus.obtenerBufferReplay();
    expect(eventos).toHaveLength(2);
    expect(eventos[0].nombre).toBe('evento.a');
    expect(eventos[1].nombre).toBe('evento.b');
  });

  it('should respect replay buffer capacity', () => {
    const busPequeno = new BusEventosMemoria({ capacidadBufferReplay: 2, batchHabilitado: false });
    busPequeno.emit('e1', {});
    busPequeno.emit('e2', {});
    busPequeno.emit('e3', {});
    const eventos = busPequeno.obtenerBufferReplay();
    expect(eventos).toHaveLength(2);
    expect(eventos[0].nombre).toBe('e2');
    expect(eventos[1].nombre).toBe('e3');
    busPequeno.destruir();
  });

  it('should filter replay buffer', () => {
    bus.emit('evento.a', {});
    bus.emit('evento.b', {});
    const filtrados = bus.obtenerBufferReplay({ nombre: 'evento.a' });
    expect(filtrados).toHaveLength(1);
    expect(filtrados[0].nombre).toBe('evento.a');
  });

  it('should clear handlers and replay buffer', () => {
    const manejador = vi.fn();
    bus.on('evento.prueba', manejador);
    bus.emit('evento.prueba', {});
    bus.clear();
    expect(bus['manejadores'].size).toBe(0);
    expect(bus.obtenerBufferReplay()).toHaveLength(0);
    bus.emit('evento.prueba', {});
    expect(manejador).toHaveBeenCalledTimes(1);
  });

  it('should not crash on handler error', () => {
    const manejadorIncorrecto = () => { throw new Error('fallo'); };
    const manejadorCorrecto = vi.fn();
    bus.on('evento.prueba', manejadorIncorrecto);
    bus.on('evento.prueba', manejadorCorrecto);
    expect(() => bus.emit('evento.prueba', {})).not.toThrow();
    expect(manejadorCorrecto).toHaveBeenCalled();
  });

  it('should preserve event metadata in replay buffer', () => {
    bus.emit('evento.prueba', { datos: 1 });
    const eventos = bus.obtenerBufferReplay();
    expect(eventos[0].nombre).toBe('evento.prueba');
    expect(eventos[0].version).toBe(1);
    expect(eventos[0].marcaTiempo).toBeGreaterThan(0);
    expect(eventos[0].fuente).toBe('desconocido');
    expect(eventos[0].payload).toEqual({ datos: 1 });
  });

  it('should support multiple handlers on same event', () => {
    const manejador1 = vi.fn();
    const manejador2 = vi.fn();
    bus.on('evento.prueba', manejador1);
    bus.on('evento.prueba', manejador2);
    bus.emit('evento.prueba', { valor: 1 });
    expect(manejador1).toHaveBeenCalledWith({ valor: 1 });
    expect(manejador2).toHaveBeenCalledWith({ valor: 1 });
  });

  it('should handle generic payload typing', () => {
    interface PayloadPersonalizado {
      id: string;
      cantidad: number;
    }
    const manejador = vi.fn();
    bus.on<PayloadPersonalizado>('evento.tipado', manejador);
    bus.emit('evento.tipado', { id: 'abc', cantidad: 5 });
    expect(manejador).toHaveBeenCalledWith({ id: 'abc', cantidad: 5 });
  });

  it('should filter replay buffer by source', () => {
    bus.emit('evento.a', {});
    bus.emit('evento.b', {});
    const filtrados = bus.obtenerBufferReplay({ fuente: 'desconocido' });
    expect(filtrados).toHaveLength(2);
  });

  it('should filter replay buffer by since timestamp', async () => {
    bus.emit('evento.a', {});
    await new Promise(resolve => setTimeout(resolve, 2));
    bus.emit('evento.b', {});
    const eventos = bus.obtenerBufferReplay();
    const timestampA = eventos[0].marcaTiempo;
    const filtrados = bus.obtenerBufferReplay({ desde: timestampA + 1 });
    expect(filtrados).toHaveLength(1);
    expect(filtrados[0].nombre).toBe('evento.b');
  });

  it('should limit replay buffer results', () => {
    bus.emit('e1', {});
    bus.emit('e2', {});
    bus.emit('e3', {});
    const filtrados = bus.obtenerBufferReplay({ limite: 2 });
    expect(filtrados).toHaveLength(2);
  });

  it('should batch multiple events of same type', async () => {
    const manejador = vi.fn();
    bus.on('audio.analisis.actualizado', manejador);
    bus.emit('audio.analisis.actualizado', { pico: 0.5 });
    bus.emit('audio.analisis.actualizado', { pico: 0.6 });
    bus.emit('audio.analisis.actualizado', { pico: 0.7 });

    expect(manejador).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(manejador).toHaveBeenCalledTimes(1);
    expect(manejador).toHaveBeenCalledWith({ pico: 0.7 });

    const eventos = bus.obtenerBufferReplay();
    const eventosAnalisis = eventos.filter(e => e.nombre === 'audio.analisis.actualizado');
    expect(eventosAnalisis.length).toBe(3);
  });

  it('should propagate correlationId to replay buffer', () => {
    bus.emit('evento.prueba', {}, { idCorrelacion: 'corr-123' });
    const eventos = bus.obtenerBufferReplay();
    expect(eventos[0].idCorrelacion).toBe('corr-123');
  });

  it('should propagate fuente and version from meta', () => {
    bus.emit('evento.prueba', { x: 1 }, { fuente: 'motor-audio', version: 3 });
    const eventos = bus.obtenerBufferReplay();
    expect(eventos[0].fuente).toBe('motor-audio');
    expect(eventos[0].version).toBe(3);
  });

  it('should resolve schema version when meta.version is omitted', () => {
    const schemas = new RegistroSchemasEventos();
    schemas.registrar('evento.schema', { version: 2 });
    const busSchema = new BusEventosMemoria({
      capacidadBufferReplay: 10,
      batchHabilitado: false,
      schemas,
    });
    busSchema.emit('evento.schema', {});
    expect(busSchema.obtenerBufferReplay()[0].version).toBe(2);
    busSchema.destruir();
  });

  it('should validate payload against registered schema in strict mode', () => {
    const schemas = new RegistroSchemasEventos();
    schemas.registrar('evento.validado', {
      version: 1,
      validar: (p) => (typeof p === 'object' && p !== null && 'ok' in p ? true : 'falta ok'),
    });
    const busEstricto = new BusEventosMemoria({
      capacidadBufferReplay: 10,
      batchHabilitado: false,
      validacionEstricta: true,
      schemas,
    });
    expect(() => busEstricto.emit('evento.validado', 'malo')).toThrow(/Schema inválido/);
    expect(() => busEstricto.emit('evento.validado', { ok: true })).not.toThrow();
    busEstricto.destruir();
  });

  it('should emit async events with asincrono flag and correlationId', () => {
    const manejador = vi.fn();
    bus.on('audio.clip.renderizado', manejador);
    bus.emitAsincrono(
      'audio.clip.renderizado',
      { clipId: 'c1' },
      { idCorrelacion: 'job-99', fuente: 'render-worker' },
    );
    expect(manejador).toHaveBeenCalledWith({ clipId: 'c1' });
    const evento = bus.obtenerBufferReplay()[0];
    expect(evento.asincrono).toBe(true);
    expect(evento.idCorrelacion).toBe('job-99');
    expect(evento.fuente).toBe('render-worker');
  });

  it('should require idCorrelacion for emitAsincrono', () => {
    expect(() =>
      bus.emitAsincrono('audio.clip.renderizado', {}, { idCorrelacion: '' }),
    ).toThrow(/idCorrelacion/);
  });

  it('should propagate causationId to replay buffer', () => {
    bus.emit('evento.prueba', {});
    const eventos = bus.obtenerBufferReplay();
    expect(eventos[0].idCausacion).toBeUndefined();
  });

  it('should handle off() for non-existent handler gracefully', () => {
    const manejador = vi.fn();
    bus.off('evento.inexistente', manejador);
    expect(() => bus.emit('evento.inexistente', {})).not.toThrow();
  });

  it('should not add handler twice for same event', () => {
    const manejador = vi.fn();
    bus.on('evento.prueba', manejador);
    bus.on('evento.prueba', manejador);
    bus.emit('evento.prueba', {});
    expect(manejador).toHaveBeenCalledTimes(1);
  });

  it('should support concurrent subscriptions', () => {
    const manejador1 = vi.fn();
    const manejador2 = vi.fn();
    const suscripcion1 = bus.on('evento.a', manejador1);
    const suscripcion2 = bus.on('evento.b', manejador2);
    bus.emit('evento.a', {});
    bus.emit('evento.b', {});
    expect(manejador1).toHaveBeenCalledTimes(1);
    expect(manejador2).toHaveBeenCalledTimes(1);
    suscripcion1.cancelarSuscripcion();
    suscripcion2.cancelarSuscripcion();
    bus.emit('evento.a', {});
    bus.emit('evento.b', {});
    expect(manejador1).toHaveBeenCalledTimes(1);
    expect(manejador2).toHaveBeenCalledTimes(1);
  });

  it('should emit events with correct timestamp', () => {
    const antes = Date.now();
    bus.emit('evento.prueba', {});
    const despues = Date.now();
    const eventos = bus.obtenerBufferReplay();
    expect(eventos[0].marcaTiempo).toBeGreaterThanOrEqual(antes);
    expect(eventos[0].marcaTiempo).toBeLessThanOrEqual(despues);
  });

  describe('Prioridad de Eventos', () => {
    it('should assign high priority to transport events', () => {
      expect(bus.obtenerPrioridad('transporte.iniciado')).toBe('alta');
      expect(bus.obtenerPrioridad('transporte.detenido')).toBe('alta');
      expect(bus.obtenerPrioridad('transporte.pausado')).toBe('alta');
      expect(bus.obtenerPrioridad('transporte.posicionCambiada')).toBe('alta');
    });

    it('should assign high priority to audio and midi events', () => {
      expect(bus.obtenerPrioridad('audio.analisis.actualizado')).toBe('alta');
      expect(bus.obtenerPrioridad('audio.xrun')).toBe('alta');
      expect(bus.obtenerPrioridad('midi.notaIniciada')).toBe('alta');
      expect(bus.obtenerPrioridad('midi.notaDetenida')).toBe('alta');
    });

    it('should assign normal priority to domain events', () => {
      expect(bus.obtenerPrioridad('proyecto.creado')).toBe('normal');
      expect(bus.obtenerPrioridad('track.creada')).toBe('normal');
      expect(bus.obtenerPrioridad('clip.movido')).toBe('normal');
      expect(bus.obtenerPrioridad('plugin.cargado')).toBe('normal');
      expect(bus.obtenerPrioridad('automatizacion.creada')).toBe('normal');
    });

    it('should assign normal priority to ui events', () => {
      expect(bus.obtenerPrioridad('ui.panelAbierto')).toBe('normal');
      expect(bus.obtenerPrioridad('ui.panelCerrado')).toBe('normal');
      expect(bus.obtenerPrioridad('ui.tooltipMostrado')).toBe('normal');
    });

    it('should assign low priority to ai events', () => {
      expect(bus.obtenerPrioridad('ia.herramientaEjecutada')).toBe('baja');
      expect(bus.obtenerPrioridad('ia.herramientaFallida')).toBe('baja');
      expect(bus.obtenerPrioridad('ia.permisoDenegado')).toBe('baja');
    });

    it('should assign low priority to system events', () => {
      expect(bus.obtenerPrioridad('sistema.inicializado')).toBe('baja');
      expect(bus.obtenerPrioridad('sistema.error')).toBe('baja');
    });

    it('should sort prioritized events correctly', () => {
      bus.emit('ui.panelAbierto', {});
      bus.emit('transporte.iniciado', {});
      bus.emit('audio.analisis.actualizado', {});
      bus.emit('track.creada', {});
      bus.emit('sistema.error', {});

      const priorizados = bus.obtenerEventosPriorizados();
      const prioridades = priorizados.map(p => p.prioridad);

      expect(prioridades[0]).toBe('alta');
      expect(prioridades[1]).toBe('alta');
      expect(prioridades[2]).toBe('normal');
      expect(prioridades[3]).toBe('normal');
      expect(prioridades[4]).toBe('baja');
    });
  });

  describe('Ciclo de Vida de Suscripciones', () => {
    it('should auto-unsubscribe once handler after first emit', () => {
      const manejador = vi.fn();
      const suscripcion = bus.once('evento.prueba', manejador);
      bus.emit('evento.prueba', {});
      bus.emit('evento.prueba', {});
      expect(manejador).toHaveBeenCalledTimes(1);
      expect(suscripcion.cancelarSuscripcion).toBeDefined();
    });

    it('should allow manual unsubscribe before emit', () => {
      const manejador = vi.fn();
      const suscripcion = bus.on('evento.prueba', manejador);
      suscripcion.cancelarSuscripcion();
      bus.emit('evento.prueba', {});
      expect(manejador).not.toHaveBeenCalled();
    });

    it('should handle multiple subscriptions and unsubscriptions', () => {
      const manejador1 = vi.fn();
      const manejador2 = vi.fn();
      const manejador3 = vi.fn();

      const suscripcion1 = bus.on('evento.prueba', manejador1);
      const suscripcion2 = bus.on('evento.prueba', manejador2);
      const suscripcion3 = bus.on('evento.prueba', manejador3);

      bus.emit('evento.prueba', {});
      expect(manejador1).toHaveBeenCalledTimes(1);
      expect(manejador2).toHaveBeenCalledTimes(1);
      expect(manejador3).toHaveBeenCalledTimes(1);

      suscripcion2.cancelarSuscripcion();
      bus.emit('evento.prueba', {});
      expect(manejador1).toHaveBeenCalledTimes(2);
      expect(manejador2).toHaveBeenCalledTimes(1);
      expect(manejador3).toHaveBeenCalledTimes(2);

      suscripcion1.cancelarSuscripcion();
      suscripcion3.cancelarSuscripcion();
      bus.emit('evento.prueba', {});
      expect(manejador1).toHaveBeenCalledTimes(2);
      expect(manejador2).toHaveBeenCalledTimes(1);
      expect(manejador3).toHaveBeenCalledTimes(2);
    });

    it('should clean up empty handler sets on unsubscribe', () => {
      const manejador = vi.fn();
      const suscripcion = bus.on('evento.prueba', manejador);
      suscripcion.cancelarSuscripcion();
      expect(bus['manejadores'].has('evento.prueba')).toBe(false);
    });
  });

  describe('orden causal', () => {
    it('should execute handlers in registration order', () => {
      const orden: number[] = [];
      bus.on('evento.prueba', () => { orden.push(1); });
      bus.on('evento.prueba', () => { orden.push(2); });
      bus.on('evento.prueba', () => { orden.push(3); });
      bus.emit('evento.prueba', {});
      expect(orden).toEqual([1, 2, 3]);
    });

    it('should deliver events in causal chain order (A→B)', () => {
      const delivered: string[] = [];
      bus.on('evento.a', () => {
        delivered.push('A-before');
        bus.emit('evento.b', {});
        delivered.push('A-after');
      });
      bus.on('evento.b', () => {
        delivered.push('B');
      });
      bus.emit('evento.a', {});
      expect(delivered).toEqual(['A-before', 'B', 'A-after']);
    });
  });

  describe('backpressure: eventos críticos no se pierden', () => {
    it('should always dispatch transport events even under pressure', () => {
      const transportEvents: unknown[] = [];
      const uiEvents: unknown[] = [];

      bus.on('transporte.posicionCambiada', (p) => transportEvents.push(p));
      // Simulate pressure: fill the low-priority queue beyond MAX_COLA_BAJA
      for (let i = 0; i < 150; i++) {
        bus.emit('ia.mensajeEnviado', { i });
      }
      // Transport events should still dispatch
      bus.emit('transporte.posicionCambiada', { beat: 42 });
      expect(transportEvents).toEqual([{ beat: 42 }]);
    });

    it('should drop low-priority events when queue is full', () => {
      bus.on('ia.mensajeEnviado', () => {});
      // Fill beyond MAX_COLA_BAJA (100)
      for (let i = 0; i < 120; i++) {
        bus.emit('ia.mensajeEnviado', { i });
      }
      // The queue should cap at MAX_COLA_BAJA
      expect(bus['colaBajaPrioridad'].length).toBeLessThanOrEqual(100);
    });
  });

  describe('correlación y causación', () => {
    it('should preserve correlationId through emit to replay', () => {
      bus.emit('evento.prueba', { datos: 1 }, { idCorrelacion: 'corr-abc' });
      const buffer = bus.obtenerBufferReplay({ nombre: 'evento.prueba' });
      expect(buffer.length).toBe(1);
      expect(buffer[0].idCorrelacion).toBe('corr-abc');
    });

    it('should preserve causationId through emit to replay', () => {
      bus.emit('evento.prueba', { datos: 2 }, { idCausacion: 'cause-xyz' });
      const buffer = bus.obtenerBufferReplay({ nombre: 'evento.prueba' });
      expect(buffer.length).toBe(1);
      expect(buffer[0].idCausacion).toBe('cause-xyz');
    });

    it('should support async event pattern with correlationId', () => {
      const received: EventoDominio[] = [];
      bus.on('audio.clip.renderizado', (payload: unknown) => {
        received.push({
          nombre: 'audio.clip.renderizado',
          version: 1,
          marcaTiempo: Date.now(),
          fuente: 'async-processor',
          payload: payload as EventoDominio['payload'],
          idCorrelacion: 'corr-async-1',
          asincrono: true,
        });
      });
      bus.emitAsincrono(
        'audio.clip.renderizado',
        { request: 'analyze' },
        { idCorrelacion: 'corr-async-1', fuente: 'async-processor' },
      );
      expect(received.length).toBe(1);
      expect(received[0].idCorrelacion).toBe('corr-async-1');
      expect(received[0].asincrono).toBe(true);
      const buffer = bus.obtenerBufferReplay({ nombre: 'audio.clip.renderizado' });
      expect(buffer[0].asincrono).toBe(true);
      expect(buffer[0].idCorrelacion).toBe('corr-async-1');
    });
  });

  describe('unsubscribe() alias', () => {
    it('should support unsubscribe() as alias for cancelarSuscripcion()', () => {
      const manejador = vi.fn();
      const suscripcion = bus.on('evento.prueba', manejador);
      expect(typeof suscripcion.unsubscribe).toBe('function');
      suscripcion.unsubscribe();
      bus.emit('evento.prueba', {});
      expect(manejador).not.toHaveBeenCalled();
    });
  });

  describe('session scope', () => {
    it('should create session scope with active subscriptions', () => {
      const scope = crearSessionScope(bus);
      scope.on('evento.a', () => {});
      scope.on('evento.b', () => {});
      expect(scope.cantidadSuscripciones()).toBe(2);
      expect(scope.estaActivo()).toBe(true);
    });

    it('should destroy session scope and unsubscribe all', () => {
      const manejadorA = vi.fn();
      const manejadorB = vi.fn();
      const scope = crearSessionScope(bus);
      scope.on('evento.a', manejadorA);
      scope.on('evento.b', manejadorB);
      expect(scope.cantidadSuscripciones()).toBe(2);
      scope.destruir();
      expect(scope.cantidadSuscripciones()).toBe(0);
      expect(scope.estaActivo()).toBe(false);
      bus.emit('evento.a', {});
      bus.emit('evento.b', {});
      expect(manejadorA).not.toHaveBeenCalled();
      expect(manejadorB).not.toHaveBeenCalled();
    });

    it('should ignore new subscriptions after destroy', () => {
      const scope = crearSessionScope(bus);
      scope.destruir();
      scope.on('evento.a', () => {});
      expect(scope.cantidadSuscripciones()).toBe(0);
    });

    it('should allow off() to remove specific subscription', () => {
      const manejador = vi.fn();
      const scope = crearSessionScope(bus);
      scope.on('evento.a', manejador);
      expect(scope.cantidadSuscripciones()).toBe(1);
      scope.off('evento.a', manejador);
      expect(scope.cantidadSuscripciones()).toBe(0);
    });
  });

  describe('priorización', () => {
    it('should assign alta priority to transport events', () => {
      expect(bus.obtenerPrioridad('transporte.iniciado')).toBe('alta');
      expect(bus.obtenerPrioridad('grabacion.iniciada')).toBe('alta');
    });

    it('should assign normal priority to UI events', () => {
      expect(bus.obtenerPrioridad('ui.panelAbierto')).toBe('normal');
      expect(bus.obtenerPrioridad('track.creada')).toBe('normal');
      expect(bus.obtenerPrioridad('clip.creado')).toBe('normal');
    });

    it('should assign low priority to AI events', () => {
      expect(bus.obtenerPrioridad('ia.herramientaEjecutada')).toBe('baja');
      expect(bus.obtenerPrioridad('sistema.inicializado')).toBe('baja');
    });
  });
});
