/**
 * Ejecutor de comandos del DAW con pipeline de validación, undo/redo,
 * batch/transacciones y emisión de eventos.
 *
 * Garantías:
 *   - Serialización: execute/undo/redo/batch/simulateBatch se encolan y nunca
 *     se intercalan (sin lost updates por awaits concurrentes).
 *   - Redo determinista: usa `StateTransition.redoPayload` (ids fijados) en vez
 *     de regenerar ids en cada redo.
 *   - Batch atómico: una sola entrada de undo; eventos/auditoría/historial solo
 *     se emiten/registran si todo el batch tiene éxito.
 *   - simulateBatch puro: sin bus, auditoría, historial, undo ni listeners.
 *   - Historial y auditoría acotados (ring buffer + payloads grandes resumidos).
 *   - Coalescencia: comandos del mismo gesto (`coalesceKey` + `gestureId`) se
 *     fusionan en una sola entrada de undo (un arrastre de fader = 1 undo).
 *   - Undo por instantánea parcial para comandos sin inverso
 *     (`historialUndo: 'instantanea'`); `'ninguno'` no toca la pila.
 *   - El estado resultante se valida con el esquema del proyecto (solo las
 *     partes que el comando tocó): un comando nunca deja el proyecto inválido.
 */

import type { DAWState } from '../types/state';
import type { CommandDefinition, CommandResult, TransactionResult, CommandError, CommandPayload, CommandHistoryEntry, StateTransition, ActionRequest, ValidatorPipeline, OpcionesEjecucion } from '../types/command';
import type { EventoDominio, MetaEmit } from '../events/evento-dominio';
import type { BusEventos } from '../events/event-bus';
import { crearPilaDeshacerRehacer, type PilaDeshacerRehacer } from '../state/pila-deshacer-rehacer';
import { conEntorno, nuevoEntorno, type EntornoComando } from './entorno-determinista';
import type { CommandRegistry } from '../state/registro-comandos';
import type { AuditLog } from '../state/registro-auditoria';
import type { Command } from '../types/command';
import { crearPipelineValidacion } from './pipeline-validacion';
import { validarCambiosProyecto } from '../schemas/proyecto';
import { capturarInstantaneaParcial, aplicarInstantaneaParcial, type InstantaneaParcial } from './instantanea-parcial';
import { withUpdatedStateRevision } from './state-revision';
import { computeSemanticDiff, type SemanticStateDiff } from './diff-estado';
import { agregarAcotado, MAX_ENTRADAS_REGISTRO, resumirPayloadParaRegistro } from './resumen-payload';

/** Usuario dueño de la pila de undo cuando un comando no indica `userId` (UI e IA locales). */
export const USUARIO_LOCAL = 'local';

/**
 * Cambio aplicado localmente que debe replicarse a otros colaboradores.
 * Los cambios que llegan de otras réplicas se aplican con `reemplazarEstado` y no se notifican aquí.
 */
export type CambioReplicable =
  | {
      modo: 'operacion';
      id: string;
      userId: string;
      comandos: { type: string; payload: unknown; entorno: EntornoComando }[];
      antes: DAWState;
      despues: DAWState;
    }
  | { modo: 'resultado'; id: string; userId: string; origen: string; antes: DAWState; despues: DAWState };

export type ListenerReplicacion = (cambio: CambioReplicable) => void;

export interface CommandExecutorOptions {
  busEventos: BusEventos;
  pila: PilaDeshacerRehacer;
  registro: CommandRegistry;
  auditoria: AuditLog;
  estadoInicial: DAWState;
  pipelineValidacion?: ValidatorPipeline;
  /** Máximo de entradas del historial en memoria (ring buffer). Default 2000. */
  maxHistorial?: number;
}

/** Listener de cambios de estado del executor (la tienda lo usa para notificar a la UI). */
export type ListenerCambioEstado = (estadoNuevo: DAWState, estadoAnterior: DAWState) => void;

type Emision = { nombre: string; payload: unknown; meta?: MetaEmit };

type PasoOk = {
  ok: true;
  estado: DAWState;
  events: EventoDominio[];
  result: unknown;
  entradaUndo: Command | null;
  /** Advertencias de validación a emitir (antes de los eventos de dominio). */
  emisiones: Emision[];
  /** El comando cambió el proyecto sin ser deshacible → invalida redo. */
  limpiaRedo: boolean;
  /** El comando reemplaza el proyecto (project.load/new) → vacía undo/redo. */
  limpiaPila: boolean;
};

type PasoError = {
  ok: false;
  error: CommandError;
  emisiones: Emision[];
};

type Paso = PasoOk | PasoError;

/** Metadatos de la entrada de undo en el tope de la pila que admite fusionarse. */
type MetaCoalescencia = { coalesceKey: string; gestureId: string; entradas: Command[] };

function puedeCoalescer(opciones?: OpcionesEjecucion): opciones is Required<OpcionesEjecucion> {
  return Boolean(opciones?.coalesceKey && opciones?.gestureId);
}

function transicionDesdeComando(command: Command, estado: DAWState, direccion: 'deshacer' | 'rehacer'): StateTransition | Promise<StateTransition> {
  if (direccion === 'deshacer') {
    return command.deshacerTransicion
      ? command.deshacerTransicion(estado)
      : { state: command.deshacer(estado) as DAWState, events: [], result: undefined };
  }
  return command.rehacerTransicion
    ? command.rehacerTransicion(estado)
    : { state: command.rehacer(estado) as DAWState, events: [], result: undefined };
}

export class CommandExecutor {
  private estado: DAWState;
  private bus: BusEventos;
  /** Pilas de undo/redo por usuario: cada colaborador deshace solo lo suyo. */
  private pilas = new Map<string, PilaDeshacerRehacer>();
  /** Usuario de la operación en curso; la cola serial garantiza que no se intercalan. */
  private usuarioPila = USUARIO_LOCAL;
  private listenersReplicacion = new Set<ListenerReplicacion>();
  private registro: CommandRegistry;
  private auditoria: AuditLog;
  private historial: CommandHistoryEntry[] = [];
  private maxHistorial: number;
  private pipeline: ValidatorPipeline;
  /** Cola serial: cada operación espera a la anterior. */
  private cola: Promise<void> = Promise.resolve();
  private listenersCambio = new Set<ListenerCambioEstado>();
  private metaCoalescencia = new WeakMap<Command, MetaCoalescencia>();

  constructor(opciones: CommandExecutorOptions) {
    this.estado = opciones.estadoInicial;
    this.bus = opciones.busEventos;
    this.pilas.set(USUARIO_LOCAL, opciones.pila);
    this.registro = opciones.registro;
    this.auditoria = opciones.auditoria;
    this.maxHistorial = Math.max(1, opciones.maxHistorial ?? MAX_ENTRADAS_REGISTRO);
    this.pipeline = opciones.pipelineValidacion ?? crearPipelineValidacion({ registroComandos: opciones.registro });
  }

  private get pila(): PilaDeshacerRehacer {
    return this.pilaDe(this.usuarioPila);
  }

  private pilaDe(usuario: string): PilaDeshacerRehacer {
    let pila = this.pilas.get(usuario);
    if (!pila) {
      pila = crearPilaDeshacerRehacer();
      this.pilas.set(usuario, pila);
    }
    return pila;
  }

  /** Suscribe a los cambios locales que deben replicarse (colaboración en tiempo real). */
  alReplicar(listener: ListenerReplicacion): () => void {
    this.listenersReplicacion.add(listener);
    return () => {
      this.listenersReplicacion.delete(listener);
    };
  }

  private notificarReplicacion(cambio: CambioReplicable): void {
    for (const l of this.listenersReplicacion) {
      try {
        l(cambio);
      } catch {
        // Un listener defectuoso no debe romper la ejecución local.
      }
    }
  }

  obtenerEstado(): DAWState {
    return this.estado;
  }

  canUndo(usuario: string = USUARIO_LOCAL): boolean {
    return this.pilaDe(usuario).canUndo();
  }

  canRedo(usuario: string = USUARIO_LOCAL): boolean {
    return this.pilaDe(usuario).canRedo();
  }

  /** Profundidad actual de la pila de undo (para revertir un turno del agente). */
  getUndoDepth(usuario: string = USUARIO_LOCAL): number {
    return this.pilaDe(usuario).getUndoStack().length;
  }

  getHistory(): CommandHistoryEntry[] {
    return [...this.historial];
  }

  /** Suscribe a cambios de estado efectivos (execute/undo/redo/batch/reemplazarEstado). */
  onCambioEstado(listener: ListenerCambioEstado): () => void {
    this.listenersCambio.add(listener);
    return () => {
      this.listenersCambio.delete(listener);
    };
  }

  /**
   * Reemplaza el estado fuera del Command System (UI efímera, carga de proyecto,
   * sincronización entre ventanas). Con `limpiarPila` vacía undo/redo, porque las
   * entradas existentes apuntan a entidades del estado anterior.
   */
  reemplazarEstado(estadoNuevo: DAWState, opciones?: { limpiarPila?: boolean }): DAWState {
    const anterior = this.estado;
    this.estado = estadoNuevo;
    if (opciones?.limpiarPila) this.limpiarPilaUndo();
    this.notificarCambio(estadoNuevo, anterior);
    return estadoNuevo;
  }

  /** Vacía undo y redo. */
  limpiarPilaUndo(): void {
    for (const pila of this.pilas.values()) pila.restore({ undo: [], redo: [] });
  }

  marcarBoundary(): void {
    this.pila.limpiarRedo();
  }

  // ── Infraestructura ──────────────────────────────────────────────────────

  /**
   * Ejecuta `operacion` en la cola serial del ejecutor (sin intercalarse con comandos, undo ni redo).
   * La usa la sincronización para aplicar cambios remotos de forma atómica respecto a lo local.
   */
  enColaExterna<R>(operacion: () => Promise<R>): Promise<R> {
    return this.enCola(operacion);
  }

  private enCola<R>(operacion: () => Promise<R>): Promise<R> {
    const ejecucion = this.cola.then(operacion);
    this.cola = ejecucion.then(
      () => undefined,
      () => undefined,
    );
    return ejecucion;
  }

  private notificarCambio(estadoNuevo: DAWState, estadoAnterior: DAWState): void {
    if (estadoNuevo === estadoAnterior) return;
    for (const listener of this.listenersCambio) {
      try {
        listener(estadoNuevo, estadoAnterior);
      } catch (error) {
        console.error('Error en listener de cambio de estado del executor:', error);
      }
    }
  }

  private emitirEventos(events: EventoDominio[]): void {
    for (const event of events) {
      this.bus.emit(event.nombre, event.payload, {
        fuente: event.fuente,
        version: event.version,
        idCorrelacion: event.idCorrelacion,
        idCausacion: event.idCausacion,
        asincrono: event.asincrono,
      });
    }
  }

  private emitirEmisiones(emisiones: Emision[]): void {
    for (const e of emisiones) {
      this.bus.emit(e.nombre, e.payload, e.meta);
    }
  }

  private registrarHistorial(entrada: CommandHistoryEntry): void {
    agregarAcotado(
      this.historial,
      { ...entrada, payload: resumirPayloadParaRegistro(entrada.payload) },
      this.maxHistorial,
    );
  }

  private resolverUsuario(source: CommandHistoryEntry['source'], userId?: string): string | undefined {
    // Identidad por defecto en app de escritorio (evita AUTH_MISSING en cada acción UI)
    return userId ?? (source === 'user' ? 'local' : undefined);
  }

  private crearEntradaUndo(
    definicion: CommandDefinition,
    inverseDef: CommandDefinition,
    payloadRedo: unknown,
    payloadInverse: unknown,
  ): Command {
    const deshacerTransicion = (estado: unknown) =>
      inverseDef.handler(estado as DAWState, payloadInverse as never) as StateTransition | Promise<StateTransition>;
    const rehacerTransicion = (estado: unknown) =>
      definicion.handler(estado as DAWState, payloadRedo as never) as StateTransition | Promise<StateTransition>;
    const estadoSync = (t: StateTransition | Promise<StateTransition>) => (t as StateTransition).state;

    const inverse: Command = {
      id: crypto.randomUUID(),
      nombre: inverseDef.type,
      descripcion: inverseDef.description,
      categoria: 'sistema',
      ejecutar: (estado: unknown) => estadoSync(deshacerTransicion(estado)),
      deshacer: (estado: unknown) => estadoSync(rehacerTransicion(estado)),
      rehacer: (estado: unknown) => estadoSync(deshacerTransicion(estado)),
      deshacerTransicion: rehacerTransicion,
      rehacerTransicion: deshacerTransicion,
      inverso: null,
      irreversible: false,
      fechaCreacion: Date.now(),
    };

    return {
      id: crypto.randomUUID(),
      nombre: definicion.type,
      descripcion: definicion.description,
      categoria: 'usuario',
      ejecutar: (estado: unknown) => estadoSync(rehacerTransicion(estado)),
      deshacer: (estado: unknown) => estadoSync(deshacerTransicion(estado)),
      rehacer: (estado: unknown) => estadoSync(rehacerTransicion(estado)),
      deshacerTransicion,
      rehacerTransicion,
      inverso: inverse,
      irreversible: false,
      fechaCreacion: Date.now(),
    };
  }

  /** Entrada de undo que restaura una instantánea parcial (comandos sin inverso). */
  private crearEntradaInstantanea(definicion: CommandDefinition, inst: InstantaneaParcial): Command {
    const transicion = (estado: unknown, lado: 'antes' | 'despues'): StateTransition => ({
      state: aplicarInstantaneaParcial(estado as DAWState, inst, lado),
      events: [
        {
          nombre: 'proyecto.modificado',
          version: 1,
          marcaTiempo: Date.now(),
          fuente: 'undo',
          payload: { comando: definicion.type, direccion: lado === 'antes' ? 'deshacer' : 'rehacer' },
        },
      ],
      result: undefined,
    });
    return {
      id: crypto.randomUUID(),
      nombre: definicion.type,
      descripcion: definicion.description,
      categoria: 'usuario',
      ejecutar: (estado: unknown) => transicion(estado, 'despues').state,
      deshacer: (estado: unknown) => transicion(estado, 'antes').state,
      rehacer: (estado: unknown) => transicion(estado, 'despues').state,
      deshacerTransicion: (estado: unknown) => transicion(estado, 'antes'),
      rehacerTransicion: (estado: unknown) => transicion(estado, 'despues'),
      inverso: null,
      irreversible: false,
      fechaCreacion: Date.now(),
    };
  }

  /** Entrada de undo compuesta: deshace en orden inverso, rehace en orden. */
  private crearEntradaCompuesta(entradas: Command[], nombre = 'batch'): Command {
    const aplicar = async (estado: unknown, direccion: 'deshacer' | 'rehacer'): Promise<StateTransition> => {
      const orden = direccion === 'deshacer' ? [...entradas].reverse() : entradas;
      let actual = estado as DAWState;
      const events: EventoDominio[] = [];
      for (const entrada of orden) {
        const t = await transicionDesdeComando(entrada, actual, direccion);
        actual = t.state;
        events.push(...(t.events ?? []));
      }
      return { state: actual, events, result: undefined };
    };
    const aplicarSync = (estado: unknown, direccion: 'deshacer' | 'rehacer'): unknown => {
      const orden = direccion === 'deshacer' ? [...entradas].reverse() : entradas;
      let actual = estado;
      for (const entrada of orden) {
        actual = direccion === 'deshacer' ? entrada.deshacer(actual) : entrada.rehacer(actual);
      }
      return actual;
    };
    return {
      id: crypto.randomUUID(),
      nombre,
      descripcion: `Batch de ${entradas.length} comandos (${entradas.map((e) => e.nombre).join(', ')})`,
      categoria: 'usuario',
      ejecutar: (estado: unknown) => aplicarSync(estado, 'rehacer'),
      deshacer: (estado: unknown) => aplicarSync(estado, 'deshacer'),
      rehacer: (estado: unknown) => aplicarSync(estado, 'rehacer'),
      deshacerTransicion: (estado: unknown) => aplicar(estado, 'deshacer'),
      rehacerTransicion: (estado: unknown) => aplicar(estado, 'rehacer'),
      inverso: null,
      irreversible: false,
      fechaCreacion: Date.now(),
    };
  }

  /**
   * Empuja una entrada de undo. Si `opciones` trae `coalesceKey` + `gestureId` y el
   * tope de la pila es del mismo gesto, ambas se fusionan en una sola entrada
   * (deshacer vuelve al estado previo al primer comando del gesto).
   */
  private empujarEntrada(entrada: Command, opciones?: OpcionesEjecucion): void {
    if (!puedeCoalescer(opciones)) {
      this.pila.push(entrada);
      return;
    }
    const pendientes = this.pila.getUndoStack();
    const tope = pendientes[pendientes.length - 1];
    const meta = tope ? this.metaCoalescencia.get(tope) : undefined;
    if (tope && meta && meta.coalesceKey === opciones.coalesceKey && meta.gestureId === opciones.gestureId) {
      this.pila.popUndoSinRedo();
      const entradas = [...meta.entradas, entrada];
      const fusionada = this.crearEntradaCompuesta(entradas, meta.entradas[0]?.nombre ?? entrada.nombre);
      this.metaCoalescencia.set(fusionada, { ...meta, entradas });
      this.pila.push(fusionada);
      return;
    }
    this.metaCoalescencia.set(entrada, { coalesceKey: opciones.coalesceKey, gestureId: opciones.gestureId, entradas: [entrada] });
    this.pila.push(entrada);
  }

  /**
   * Núcleo sin efectos secundarios: valida y ejecuta el handler sobre `estadoBase`.
   * No toca this.estado, bus, auditoría, historial ni pila.
   */
  private async ejecutarPaso(
    estadoBase: DAWState,
    type: string,
    payload: unknown,
    source: CommandHistoryEntry['source'],
    effectiveUserId: string | undefined,
    entornoCmd: EntornoComando,
  ): Promise<Paso> {
    const emisiones: Emision[] = [];
    const definicion = this.registro.get(type);
    if (!definicion) {
      return { ok: false, error: { code: 'COMMAND_NOT_FOUND', message: `Comando no registrado: ${type}` }, emisiones };
    }

    const request: ActionRequest = {
      type,
      payload: payload as never,
      source,
      userId: effectiveUserId,
      context: { source, userId: effectiveUserId },
    };

    const pipelineResult = await this.pipeline.validate(request, { state: estadoBase });
    if (!pipelineResult.valid) {
      return {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: pipelineResult.errors.map(e => e.message).join(', ') },
        emisiones,
      };
    }

    for (const warning of pipelineResult.warnings) {
      emisiones.push({ nombre: 'validacion.advertencia', payload: { code: warning.code, message: warning.message, suggestion: warning.suggestion } });
    }

    if (definicion.validate) {
      const validationResult = definicion.validate(estadoBase, payload as never);
      if (!validationResult.valid) {
        return {
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: validationResult.errors.map(e => e.message).join(', ') },
          emisiones,
        };
      }
    }

    let transition: StateTransition;
    try {
      transition = await conEntorno(entornoCmd, () => definicion.handler(estadoBase, payload as never) as Promise<StateTransition> | StateTransition);
    } catch (e: unknown) {
      return {
        ok: false,
        error: { code: 'EXECUTION_ERROR', message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined },
        emisiones,
      };
    }

    // El estado resultante debe seguir cumpliendo el esquema del proyecto (lo que
    // se guarda y se vuelve a abrir). Solo se validan las partes que cambiaron.
    if (transition.state.project !== estadoBase.project) {
      const validacion = validarCambiosProyecto(estadoBase.project, transition.state.project);
      if (!validacion.ok) {
        return { ok: false, error: { code: 'VALIDATION_FAILED', message: validacion.error }, emisiones };
      }
    }

    const estado = withUpdatedStateRevision(transition.state);
    const inverseType = transition.inverseType ?? definicion.inverseType;
    const inverseDef = inverseType ? this.registro.get(inverseType) : undefined;
    const payloadInverse = transition.inversePayload !== undefined ? transition.inversePayload : payload;
    const payloadRedo = transition.redoPayload !== undefined ? transition.redoPayload : payload;
    let entradaUndo: Command | null = null;
    const redoDef = transition.redoType ? this.registro.get(transition.redoType) ?? definicion : definicion;
    if (inverseDef) {
      entradaUndo = this.crearEntradaUndo(redoDef, inverseDef, payloadRedo, payloadInverse);
    } else if (definicion.historialUndo === 'instantanea') {
      const inst = capturarInstantaneaParcial(estadoBase, transition.state);
      if (inst) entradaUndo = this.crearEntradaInstantanea(definicion, inst);
    }
    const invisible = definicion.historialUndo === 'ninguno';

    return {
      ok: true,
      estado,
      events: transition.events ?? [],
      result: transition.result,
      entradaUndo,
      emisiones,
      limpiaRedo: !entradaUndo && !invisible && transition.state.project !== estadoBase.project,
      limpiaPila: definicion.limpiaHistorialUndo === true,
    };
  }

  // ── API pública ─────────────────────────────────────────────────────────

  /**
   * Ejecuta un comando. `opciones.coalesceKey` + `opciones.gestureId` fusionan en
   * una sola entrada de undo los comandos consecutivos del mismo gesto.
   */
  execute<T = unknown>(
    type: string,
    payload: unknown,
    source: CommandHistoryEntry['source'] = 'user',
    userId?: string,
    opciones?: OpcionesEjecucion,
  ): Promise<CommandResult<T>> {
    return this.enCola(() => this.ejecutarAhora<T>(type, payload, source, userId, opciones));
  }

  private async ejecutarAhora<T>(
    type: string,
    payload: unknown,
    source: CommandHistoryEntry['source'],
    userId?: string,
    opciones?: OpcionesEjecucion,
  ): Promise<CommandResult<T>> {
    const entryId = crypto.randomUUID();
    const timestamp = Date.now();
    const effectiveUserId = this.resolverUsuario(source, userId);
    this.usuarioPila = effectiveUserId ?? USUARIO_LOCAL;
    const entornoCmd = opciones?.entorno ?? nuevoEntorno();

    const paso = await this.ejecutarPaso(this.estado, type, payload, source, effectiveUserId, entornoCmd);
    if (!paso.ok) {
      this.emitirEmisiones(paso.emisiones);
      this.auditoria.log({ id: entryId, timestamp, commandType: type, payload, source, userId: effectiveUserId, result: 'failure', error: paso.error.message });
      this.bus.emit('comando.fallido', { type, error: paso.error.message, code: paso.error.code });
      return { success: false, state: this.estado, events: [], error: paso.error };
    }

    const anterior = this.estado;
    this.estado = paso.estado;
    if (paso.limpiaPila) {
      this.limpiarPilaUndo();
    } else if (paso.entradaUndo) {
      this.empujarEntrada(paso.entradaUndo, opciones);
    } else if (paso.limpiaRedo) {
      this.pila.limpiarRedo();
    }

    this.emitirEmisiones(paso.emisiones);
    this.emitirEventos(paso.events);
    this.registrarHistorial({ id: entryId, commandType: type, payload, timestamp, source, userId: effectiveUserId, success: true });
    this.auditoria.log({ id: entryId, timestamp, commandType: type, payload, source, userId: effectiveUserId, result: 'success' });
    this.notificarCambio(this.estado, anterior);
    this.replicarPaso(entryId, effectiveUserId, [{ type, payload, entorno: entornoCmd }], anterior);

    return { success: true, state: this.estado, events: paso.events, result: paso.result as T | undefined };
  }

  /** Deshace la última acción de `usuario` (por defecto el usuario local); no toca lo de otros. */
  undo(usuario: string = USUARIO_LOCAL): Promise<CommandResult> {
    return this.enCola(() => this.moverPila('undo', usuario));
  }

  redo(usuario: string = USUARIO_LOCAL): Promise<CommandResult> {
    return this.enCola(() => this.moverPila('redo', usuario));
  }

  private async moverPila(tipo: 'undo' | 'redo', usuario: string): Promise<CommandResult> {
    this.usuarioPila = usuario;
    const esUndo = tipo === 'undo';
    if (esUndo ? !this.pila.canUndo() : !this.pila.canRedo()) {
      const error: CommandError = esUndo
        ? { code: 'NOTHING_TO_UNDO', message: 'No hay acciones para deshacer' }
        : { code: 'NOTHING_TO_REDO', message: 'No hay acciones para rehacer' };
      this.bus.emit('comando.fallido', { type: tipo, error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }

    const pendientes = esUndo ? this.pila.getUndoStack() : this.pila.getRedoStack();
    const command = pendientes[pendientes.length - 1]!;

    try {
      const transition = await transicionDesdeComando(command, this.estado, esUndo ? 'deshacer' : 'rehacer');
      const anterior = this.estado;
      this.estado = withUpdatedStateRevision(transition.state);
      if (esUndo) this.pila.undo();
      else this.pila.redo();
      const events = transition.events ?? [];
      this.emitirEventos(events);

      const entryId = crypto.randomUUID();
      const timestamp = Date.now();
      const commandType = `${tipo}:${command.nombre}`;
      this.registrarHistorial({ id: entryId, commandType, payload: undefined, timestamp, source: 'user', success: true });
      this.auditoria.log({ id: entryId, timestamp, commandType, payload: undefined, source: 'user', result: 'success' });
      this.bus.emit(esUndo ? 'undoRedo.undo' : 'undoRedo.redo', { comando: command.nombre });
      this.notificarCambio(this.estado, anterior);
      // El undo se replica por su resultado: su inverso se calculó sobre el estado local.
      this.notificarReplicacion({ modo: 'resultado', id: entryId, userId: usuario, origen: commandType, antes: anterior, despues: this.estado });
      return { success: true, state: this.estado, events };
    } catch (e: unknown) {
      const error: CommandError = {
        code: esUndo ? 'UNDO_ERROR' : 'REDO_ERROR',
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      };
      this.bus.emit('comando.fallido', { type: tipo, error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }
  }

  /**
   * Ejecuta varios comandos de forma atómica. Si alguno falla no se aplica nada:
   * ni estado, ni eventos, ni historial, ni undo (solo un `comando.fallido` y una
   * entrada de auditoría del fallo). En éxito deja una única entrada de undo.
   */
  batch(
    commands: CommandPayload[],
    source: CommandHistoryEntry['source'] = 'user',
    userId?: string,
    opciones?: OpcionesEjecucion,
  ): Promise<TransactionResult> {
    return this.enCola(() => this.batchAhora(commands, source, userId, opciones));
  }

  private async batchAhora(
    commands: CommandPayload[],
    source: CommandHistoryEntry['source'],
    userId?: string,
    opciones?: OpcionesEjecucion,
  ): Promise<TransactionResult> {
    const effectiveUserId = this.resolverUsuario(source, userId);
    this.usuarioPila = effectiveUserId ?? USUARIO_LOCAL;
    const resultados: CommandResult[] = [];
    const pasos: { cmd: CommandPayload; paso: PasoOk; id: string; timestamp: number; entorno: EntornoComando }[] = [];
    let estado = this.estado;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!;
      const timestamp = Date.now();
      // En un lote cada comando recibe su propio entorno derivado del de opciones (si lo hay).
      const entornoCmd =
        cmd.entorno ??
        (opciones?.entorno
          ? { ahora: opciones.entorno.ahora, semilla: (opciones.entorno.semilla + i * 0x9e3779b1) >>> 0 }
          : nuevoEntorno());
      const paso = await this.ejecutarPaso(estado, cmd.type, cmd.payload, source, effectiveUserId, entornoCmd);
      if (!paso.ok) {
        resultados.push({ success: false, state: this.estado, events: [], error: paso.error });
        this.auditoria.log({
          id: crypto.randomUUID(),
          timestamp,
          commandType: 'batch',
          payload: { fallido: cmd.type, indice: i, total: commands.length },
          source,
          userId: effectiveUserId,
          result: 'failure',
          error: `${cmd.type}: ${paso.error.message}`,
        });
        this.bus.emit('comando.fallido', {
          type: 'batch',
          error: paso.error.message ?? 'Batch fallido',
          code: paso.error.code ?? 'BATCH_FAILED',
        });
        return { success: false, results: resultados, rolledBack: true, error: paso.error };
      }
      estado = paso.estado;
      resultados.push({ success: true, state: paso.estado, events: paso.events, result: paso.result });
      pasos.push({ cmd, paso, id: crypto.randomUUID(), timestamp, entorno: entornoCmd });
    }

    const anterior = this.estado;
    this.estado = estado;

    // Pila: si algún comando reemplaza el proyecto, solo cuentan los posteriores.
    let desde = 0;
    for (let i = 0; i < pasos.length; i++) {
      if (pasos[i]!.paso.limpiaPila) desde = i + 1;
    }
    if (desde > 0) this.limpiarPilaUndo();
    const posteriores = pasos.slice(desde);
    const entradas = posteriores.map((p) => p.paso.entradaUndo).filter((e): e is Command => e !== null);
    if (entradas.length === 1) {
      this.empujarEntrada(entradas[0]!, opciones);
    } else if (entradas.length > 1) {
      this.empujarEntrada(this.crearEntradaCompuesta(entradas), opciones);
    } else if (posteriores.some((p) => p.paso.limpiaRedo)) {
      this.pila.limpiarRedo();
    }

    for (const { cmd, paso, id, timestamp } of pasos) {
      this.emitirEmisiones(paso.emisiones);
      this.emitirEventos(paso.events);
      this.registrarHistorial({ id, commandType: cmd.type, payload: cmd.payload, timestamp, source, userId: effectiveUserId, success: true });
      this.auditoria.log({ id, timestamp, commandType: cmd.type, payload: cmd.payload, source, userId: effectiveUserId, result: 'success' });
    }
    this.notificarCambio(this.estado, anterior);
    this.replicarPaso(
      pasos[0]?.id ?? crypto.randomUUID(),
      effectiveUserId,
      pasos.map((p) => ({ type: p.cmd.type, payload: p.cmd.payload, entorno: p.entorno })),
      anterior,
    );

    return { success: true, results: resultados, rolledBack: false };
  }

  /**
   * Simula un batch (dry-run) sobre una copia del estado. Sin efectos: no emite
   * eventos, no audita, no toca historial ni undo, no notifica listeners.
   */
  simulateBatch(
    commands: CommandPayload[],
    source: CommandHistoryEntry['source'] = 'ai',
    userId?: string,
  ): Promise<{ success: boolean; results: CommandResult[]; stateDiff: SemanticStateDiff }> {
    return this.enCola(async () => {
      const effectiveUserId = this.resolverUsuario(source, userId);
      const before = structuredClone(this.estado) as DAWState;
      let estado = structuredClone(this.estado) as DAWState;
      const results: CommandResult[] = [];
      let success = true;
      for (const cmd of commands) {
        const paso = await this.ejecutarPaso(estado, cmd.type, cmd.payload, source, effectiveUserId, nuevoEntorno());
        if (!paso.ok) {
          success = false;
          results.push({ success: false, state: before, events: [], error: paso.error });
          break;
        }
        estado = paso.estado;
        results.push({ success: true, state: paso.estado, events: paso.events, result: paso.result });
      }
      const stateDiff = computeSemanticDiff(before, success ? estado : before);
      return { success, results, stateDiff };
    });
  }

  /**
   * Notifica un cambio local a la replicación. Si algún comando del paso no es reejecutable de forma
   * determinista (`replicacion: 'resultado'`) se replica el resultado completo; si todos son
   * `'local'`, no se replica.
   */
  private replicarPaso(
    id: string,
    userId: string | undefined,
    comandos: { type: string; payload: unknown; entorno: EntornoComando }[],
    antes: DAWState,
  ): void {
    if (this.listenersReplicacion.size === 0 || antes === this.estado) return;
    const modos = comandos.map((c) => this.registro.get(c.type)?.replicacion ?? 'operacion');
    if (modos.every((m) => m === 'local')) return;
    const usuario = userId ?? USUARIO_LOCAL;
    if (modos.includes('resultado') || modos.includes('local')) {
      this.notificarReplicacion({ modo: 'resultado', id, userId: usuario, origen: comandos.map((c) => c.type).join('+'), antes, despues: this.estado });
      return;
    }
    this.notificarReplicacion({ modo: 'operacion', id, userId: usuario, comandos, antes, despues: this.estado });
  }
}
