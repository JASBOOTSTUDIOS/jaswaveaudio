/**
 * Bus de eventos en memoria del dominio JasWave.
 *
 * Propósito:
 *   Proveer un mecanismo de comunicación desacoplado, tipo pub/sub, entre
 *   los diferentes módulos del DAW (motor de audio, UI, IA, exportación,
 *   configuración, etc.) sin generar dependencias circulares.
 *
 * Importancia:
 *   - Centraliza todo el flujo de eventos del sistema, permitiendo auditar,
 *     replay, priorizar y reaccionar a cambios de estado en tiempo real.
 *   - Facilita la trazabilidad completa del flujo de usuario mediante
 *     IDs de causación y correlación.
 *   - Habilita funcionalidades avanzadas como undo/redo, sesiones,
 *     exportación de eventos y respuestas reactivas consistentes.
 *
 * Función:
 *   Implementa la interfaz BusEventos con soporte para suscripciones
 *   persistentes y de una sola vez, buffer de replay con filtrado,
 *   cola de batch con coalescing a suscriptores, schemas versionados,
 *   eventos asíncronos y priorización de eventos por dominio
 *   (transporte, audio, MIDI, UI, IA, etc.).
 */

import type { EventoDominio, FiltroEvento, MetaEmit, ValorJSON } from './evento-dominio';
import type { Suscripcion } from './suscripcion';
import { BufferReplay } from './buffer-replay';
import { RegistroSchemasEventos, registroSchemasEventos } from './schemas-eventos';

export type ManejadorEvento<T = ValorJSON> = (payload: T) => void;

export interface GrupoSuscripciones {
  agregar<S extends Suscripcion>(suscripcion: S): S;
  cancelarTodas(): void;
  obtenerActivas(): Suscripcion[];
}

export interface BusEventos {
  on<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): Suscripcion;
  off(nombreEvento: string, manejador: (payload: unknown) => void): void;
  emit<T = ValorJSON>(nombreEvento: string, payload: T, meta?: MetaEmit): void;
  emitAsincrono<T = ValorJSON>(
    nombreEvento: string,
    payload: T,
    meta: MetaEmit & { idCorrelacion: string },
  ): void;
  once<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): Suscripcion;
  clear(): void;
  obtenerBufferReplay(filtro?: FiltroEvento): EventoDominio[];
  /** Cantidad total de manejadores registrados (todos los eventos). */
  cantidadManejadores(): number;
}

interface RegistroManejador {
  manejador: (payload: unknown) => void;
  unaSolaVez: boolean;
  id: string;
  nombreEvento: string;
}

export type PrioridadEvento = 'alta' | 'normal' | 'baja';

export interface EventoPriorizado {
  evento: EventoDominio;
  prioridad: PrioridadEvento;
}

export interface ConfigBusEventos {
  capacidadBufferReplay?: number;
  /** Si > 1 (o se omite), habilita coalescing de eventos de alta frecuencia. 0 desactiva. */
  tamanoBatch?: number;
  intervaloBatchMs?: number;
  batchHabilitado?: boolean;
  /** Si true, emit lanza cuando el payload no cumple el schema registrado. */
  validacionEstricta?: boolean;
  schemas?: RegistroSchemasEventos;
}

/** Eventos de alta frecuencia: se coalescean (último gana) antes de notificar suscriptores. */
const EVENTOS_BATCHABLES = new Set([
  'audio.analisis.actualizado',
  'audio.nivelActualizado',
  'audio.espectroActualizado',
  'audio.bufferProcesado',
  'rendimiento.cpuActualizado',
  'rendimiento.memoriaActualizada',
  'rendimiento.discoActualizado',
  'automatizacion.puntoCambiado',
]);

export class BusEventosMemoria implements BusEventos {
  private manejadores: Map<string, Set<RegistroManejador>> = new Map();
  private replay: BufferReplay;
  private pendientesBatch: Map<string, EventoDominio> = new Map();
  private colaBajaPrioridad: EventoDominio[] = [];
  private temporizadorBatch: ReturnType<typeof setTimeout> | null = null;
  private temporizadorBajaPrioridad: ReturnType<typeof setTimeout> | null = null;
  private intervaloBatchMs: number;
  private contadorManejadores = 0;
  private schemas: RegistroSchemasEventos;
  private validacionEstricta: boolean;
  private batchHabilitado: boolean;
  private static readonly MAX_COLA_BAJA = 100;
  private static readonly INTERVALO_BAJA_MS = 100;
  private static readonly INTERVALO_BATCH_MS = 50;

  constructor(config?: ConfigBusEventos) {
    this.intervaloBatchMs = config?.intervaloBatchMs ?? BusEventosMemoria.INTERVALO_BATCH_MS;
    this.replay = new BufferReplay(config?.capacidadBufferReplay ?? 2000);
    this.schemas = config?.schemas ?? registroSchemasEventos;
    this.validacionEstricta = config?.validacionEstricta ?? false;

    if (config?.batchHabilitado !== undefined) {
      this.batchHabilitado = config.batchHabilitado;
    } else if (config?.tamanoBatch !== undefined) {
      this.batchHabilitado = config.tamanoBatch > 1;
    } else {
      this.batchHabilitado = true;
    }
    // Los temporizadores son perezosos: solo se programan cuando hay trabajo
    // pendiente (importar el módulo no deja intervals vivos).
  }

  private unrefTemporizador(timer: ReturnType<typeof setTimeout>): void {
    const t = timer as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  }

  private programarBatch(): void {
    if (this.temporizadorBatch) return;
    this.temporizadorBatch = setTimeout(() => {
      this.temporizadorBatch = null;
      this.procesarBatch();
    }, this.intervaloBatchMs);
    this.unrefTemporizador(this.temporizadorBatch);
  }

  private programarBajaPrioridad(): void {
    if (this.temporizadorBajaPrioridad) return;
    this.temporizadorBajaPrioridad = setTimeout(() => {
      this.temporizadorBajaPrioridad = null;
      this.procesarColaBajaPrioridad();
    }, BusEventosMemoria.INTERVALO_BAJA_MS);
    this.unrefTemporizador(this.temporizadorBajaPrioridad);
  }

  /** Elimina un registro concreto (no "el primero con el mismo manejador"). */
  private eliminarRegistro(nombreEvento: string, registro: RegistroManejador): void {
    const conjunto = this.manejadores.get(nombreEvento);
    if (!conjunto) return;
    conjunto.delete(registro);
    if (conjunto.size === 0) {
      this.manejadores.delete(nombreEvento);
    }
  }

  private crearSuscripcion(
    nombreEvento: string,
    registro: RegistroManejador,
    opciones?: { descripcion?: string; tipo?: string },
  ): Suscripcion {
    const id = `suscripcion-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const estado = {
      activa: true,
      cancelada: false,
      vecesInvocada: 0,
      ultimaInvocacion: 0,
      errores: 0,
      descripcion: opciones?.descripcion,
    };
    const cancelar = () => {
      // Cancela exactamente este registro: cancelar un `once` no debe quitar un
      // `on` con el mismo manejador (ni viceversa).
      this.eliminarRegistro(nombreEvento, registro);
      (estado as { cancelada: boolean; activa: boolean }).cancelada = true;
      (estado as { cancelada: boolean; activa: boolean }).activa = false;
    };

    const suscripcion: Suscripcion = {
      id,
      nombreEvento,
      manejadorId: this.generarIdManejador(),
      cancelarSuscripcion: cancelar,
      unsubscribe: cancelar,
      estado,
      opciones: {
        tipo: opciones?.tipo === 'unaVez' ? 'unaVez' : 'persistente',
        descripcion: opciones?.descripcion ?? '',
        capturarErrores: true,
        maximoErrores: 10,
      },
    };
    return suscripcion;
  }

  private generarIdManejador(): string {
    return `manejador-${Date.now()}-${++this.contadorManejadores}`;
  }

  private esBatchable(nombreEvento: string): boolean {
    return this.batchHabilitado && EVENTOS_BATCHABLES.has(nombreEvento);
  }

  private construirEvento<T>(nombreEvento: string, payload: T, meta?: MetaEmit): EventoDominio {
    const version = meta?.version ?? this.schemas.obtenerVersion(nombreEvento);
    const validacion = this.schemas.validar(nombreEvento, payload as ValorJSON);
    if (!validacion.ok) {
      const mensaje = `Schema inválido para "${nombreEvento}" (v${validacion.version}): ${validacion.error}`;
      if (this.validacionEstricta) {
        throw new Error(mensaje);
      }
      console.warn(mensaje);
    }

    const evento: EventoDominio = {
      nombre: nombreEvento,
      version,
      marcaTiempo: Date.now(),
      fuente: meta?.fuente ?? 'desconocido',
      payload: payload as ValorJSON,
      idCausacion: meta?.idCausacion,
      idCorrelacion: meta?.idCorrelacion,
    };

    if (meta?.asincrono) {
      evento.asincrono = true;
    }

    return evento;
  }

  private despacharAManejadores<T>(nombreEvento: string, payload: T): void {
    const conjunto = this.manejadores.get(nombreEvento);
    if (!conjunto) return;
    const aEliminar: RegistroManejador[] = [];
    for (const registro of conjunto) {
      try {
        (registro.manejador as ManejadorEvento<T>)(payload);
      } catch (error) {
        console.error(`Error en manejador de evento ${nombreEvento}:`, error);
      }
      if (registro.unaSolaVez) aEliminar.push(registro);
    }
    for (const registro of aEliminar) {
      conjunto.delete(registro);
    }
  }

  on<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): Suscripcion {
    if (!this.manejadores.has(nombreEvento)) {
      this.manejadores.set(nombreEvento, new Set());
    }
    const conjunto = this.manejadores.get(nombreEvento)!;
    for (const existente of conjunto) {
      if (existente.manejador === manejador && !existente.unaSolaVez) {
        return this.crearSuscripcion(nombreEvento, existente);
      }
    }
    const registro: RegistroManejador = {
      manejador: manejador as (payload: unknown) => void,
      unaSolaVez: false,
      id: this.generarIdManejador(),
      nombreEvento,
    };
    conjunto.add(registro);
    return this.crearSuscripcion(nombreEvento, registro);
  }

  off(nombreEvento: string, manejador: ManejadorEvento<unknown>): void {
    const conjunto = this.manejadores.get(nombreEvento);
    if (!conjunto) return;
    // Preferir el registro persistente; si solo hay `once`, quitar ese.
    let objetivo: RegistroManejador | undefined;
    for (const registro of conjunto) {
      if (registro.manejador !== manejador) continue;
      if (!registro.unaSolaVez) {
        objetivo = registro;
        break;
      }
      objetivo ??= registro;
    }
    if (objetivo) conjunto.delete(objetivo);
    if (conjunto.size === 0) {
      this.manejadores.delete(nombreEvento);
    }
  }

  emit<T = ValorJSON>(nombreEvento: string, payload: T, meta?: MetaEmit): void {
    const evento = this.construirEvento(nombreEvento, payload, meta);
    const prioridad = this.obtenerPrioridad(nombreEvento);

    if (prioridad === 'baja' && this.colaBajaPrioridad.length >= BusEventosMemoria.MAX_COLA_BAJA) {
      this.colaBajaPrioridad.shift();
    }

    this.replay.agregar(evento);

    if (prioridad === 'baja') {
      this.colaBajaPrioridad.push(evento);
      this.programarBajaPrioridad();
    }

    if (this.esBatchable(nombreEvento)) {
      this.pendientesBatch.set(nombreEvento, evento);
      this.programarBatch();
      return;
    }

    this.despacharAManejadores(nombreEvento, payload);
  }

  /**
   * Emite un evento de fuente asíncrona (análisis, renderizado, IA remota).
   * Requiere `idCorrelacion` para vincularlo con la operación origen.
   */
  emitAsincrono<T = ValorJSON>(
    nombreEvento: string,
    payload: T,
    meta: MetaEmit & { idCorrelacion: string },
  ): void {
    if (!meta.idCorrelacion) {
      throw new Error('emitAsincrono requiere idCorrelacion');
    }
    this.emit(nombreEvento, payload, { ...meta, asincrono: true });
  }

  once<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): Suscripcion {
    if (!this.manejadores.has(nombreEvento)) {
      this.manejadores.set(nombreEvento, new Set());
    }
    const conjunto = this.manejadores.get(nombreEvento)!;
    const registro: RegistroManejador = {
      manejador: manejador as (payload: unknown) => void,
      unaSolaVez: true,
      id: this.generarIdManejador(),
      nombreEvento,
    };
    conjunto.add(registro);
    return this.crearSuscripcion(nombreEvento, registro, { tipo: 'unaVez' });
  }

  clear(): void {
    this.manejadores.clear();
    this.replay.limpiar();
    this.pendientesBatch.clear();
    this.colaBajaPrioridad.length = 0;
  }

  /** Detiene temporizadores internos (útil en tests / shutdown). */
  destruir(): void {
    if (this.temporizadorBatch) {
      clearTimeout(this.temporizadorBatch);
      this.temporizadorBatch = null;
    }
    if (this.temporizadorBajaPrioridad) {
      clearTimeout(this.temporizadorBajaPrioridad);
      this.temporizadorBajaPrioridad = null;
    }
    this.clear();
  }

  /** Alias de destruir(): libera temporizadores y suscripciones. */
  dispose(): void {
    this.destruir();
  }

  /** Fuerza el flush de eventos batchables pendientes (tests / shutdown). */
  flushBatch(): void {
    this.procesarBatch();
  }

  obtenerBufferReplay(filtro?: FiltroEvento): EventoDominio[] {
    return this.replay.obtenerEventos(filtro);
  }

  cantidadManejadores(): number {
    let total = 0;
    for (const conjunto of this.manejadores.values()) {
      total += conjunto.size;
    }
    return total;
  }

  cantidadEventosConSuscriptores(): number {
    return this.manejadores.size;
  }

  obtenerSchemas(): RegistroSchemasEventos {
    return this.schemas;
  }

  obtenerPrioridad(nombreEvento: string): PrioridadEvento {
    if (
      nombreEvento.startsWith('transporte.') ||
      nombreEvento.startsWith('grabacion.') ||
      nombreEvento.startsWith('metronomo.') ||
      nombreEvento.startsWith('midi.') ||
      nombreEvento.startsWith('audio.') ||
      nombreEvento.startsWith('loop.') ||
      nombreEvento.startsWith('escenas.')
    ) {
      return 'alta';
    }
    if (
      nombreEvento.startsWith('ui.') ||
      nombreEvento.startsWith('project.') ||
      nombreEvento.startsWith('proyecto.') ||
      nombreEvento.startsWith('track.') ||
      nombreEvento.startsWith('clip.') ||
      nombreEvento.startsWith('exportacion.') ||
      nombreEvento.startsWith('media.') ||
      nombreEvento.startsWith('hardware.') ||
      nombreEvento.startsWith('mezcla.') ||
      nombreEvento.startsWith('fade.') ||
      nombreEvento.startsWith('rutaAudio.') ||
      nombreEvento.startsWith('muestreo.') ||
      nombreEvento.startsWith('sincronizacion.') ||
      nombreEvento.startsWith('controlSuperficie.') ||
      nombreEvento.startsWith('controlMidi.')
    ) {
      return 'normal';
    }
    if (
      nombreEvento.startsWith('ia.') ||
      nombreEvento.startsWith('sistema.') ||
      nombreEvento.startsWith('rendimiento.') ||
      nombreEvento.startsWith('licencia.') ||
      nombreEvento.startsWith('nube.') ||
      nombreEvento.startsWith('actualizacion.')
    ) {
      return 'baja';
    }
    return 'normal';
  }

  obtenerEventosPriorizados(): EventoPriorizado[] {
    const eventos = this.replay.obtenerEventos();
    return eventos
      .map(evento => ({
        evento,
        prioridad: this.obtenerPrioridad(evento.nombre),
      }))
      .sort((a, b) => {
        const orden = { alta: 0, normal: 1, baja: 2 };
        return orden[a.prioridad] - orden[b.prioridad];
      });
  }

  /**
   * Entrega a suscriptores el último payload de cada evento batchable pendiente.
   * Reduce ráfagas (ej. audio.analisis.actualizado) a una notificación por ventana.
   */
  private procesarBatch(): void {
    if (this.pendientesBatch.size === 0) return;

    const pendientes = [...this.pendientesBatch.entries()];
    this.pendientesBatch.clear();

    pendientes.sort((a, b) => {
      const orden = { alta: 0, normal: 1, baja: 2 };
      return orden[this.obtenerPrioridad(a[0])] - orden[this.obtenerPrioridad(b[0])];
    });

    for (const [nombre, evento] of pendientes) {
      this.despacharAManejadores(nombre, evento.payload);
    }
  }

  private procesarColaBajaPrioridad(): void {
    // La cola solo mide presión; el replay ya tiene los eventos.
    if (this.colaBajaPrioridad.length === 0) return;
    this.colaBajaPrioridad.splice(0, this.colaBajaPrioridad.length);
  }
}

export const busEventos = new BusEventosMemoria();

export function crearGrupoSuscripciones(bus: BusEventos): GrupoSuscripciones {
  const suscripciones: Suscripcion[] = [];

  return {
    agregar<S extends Suscripcion>(suscripcion: S): S {
      suscripciones.push(suscripcion);
      return suscripcion;
    },
    cancelarTodas(): void {
      for (const sub of suscripciones) {
        sub.cancelarSuscripcion();
      }
      suscripciones.length = 0;
    },
    obtenerActivas(): Suscripcion[] {
      return suscripciones.filter(s => s.estado.activa);
    },
  };
}

export function useEventBus(
  bus: BusEventos,
  eventos: { nombre: string; manejador: ManejadorEvento }[],
): { cancelarSuscripcion: () => void } {
  const grupo = crearGrupoSuscripciones(bus);
  for (const e of eventos) {
    grupo.agregar(bus.on(e.nombre, e.manejador));
  }
  return {
    cancelarSuscripcion: () => grupo.cancelarTodas(),
  };
}

/**
 * Scope de sesión para servicios de fondo.
 *
 * Vincula suscripciones al ciclo de vida de una sesión (ej: reproducción,
 * exportación, renderizado). Al finalizar la sesión, todas las suscripciones
 * se cancelan automáticamente.
 */
export interface SessionScope {
  on<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): void;
  once<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): void;
  off(nombreEvento: string, manejador: ManejadorEvento): void;
  destruir(): void;
  estaActivo(): boolean;
  cantidadSuscripciones(): number;
}

export function crearSessionScope(bus: BusEventos): SessionScope {
  const suscripciones: Suscripcion[] = [];
  /** Manejador original de cada suscripción del scope (para off() exacto). */
  const manejadores = new WeakMap<Suscripcion, unknown>();
  let activo = true;

  return {
    on<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): void {
      if (!activo) {
        console.warn('SessionScope destruido — ignorando nueva suscripción');
        return;
      }
      const sub = bus.on(nombreEvento, manejador);
      manejadores.set(sub, manejador);
      suscripciones.push(sub);
    },

    once<T = ValorJSON>(nombreEvento: string, manejador: ManejadorEvento<T>): void {
      if (!activo) {
        console.warn('SessionScope destruido — ignorando nueva suscripción');
        return;
      }
      const sub = bus.once(nombreEvento, manejador);
      manejadores.set(sub, manejador);
      suscripciones.push(sub);
    },

    off(nombreEvento: string, manejador: ManejadorEvento): void {
      // Solo cancela la suscripción del scope con ese evento Y ese manejador;
      // no toca suscripciones ajenas al scope.
      const idx = suscripciones.findIndex(
        s => s.nombreEvento === nombreEvento && s.estado.activa && manejadores.get(s) === manejador,
      );
      if (idx !== -1) {
        suscripciones[idx]!.cancelarSuscripcion();
        suscripciones.splice(idx, 1);
      }
    },

    destruir(): void {
      if (!activo) return;
      activo = false;
      for (const sub of suscripciones) {
        if (sub.estado.activa) {
          sub.cancelarSuscripcion();
        }
      }
      suscripciones.length = 0;
    },

    estaActivo(): boolean {
      return activo;
    },

    cantidadSuscripciones(): number {
      return suscripciones.filter(s => s.estado.activa).length;
    },
  };
}
