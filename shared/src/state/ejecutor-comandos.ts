/**
 * Ejecutor de comandos del DAW con pipeline de validación, undo/redo,
 * batch/transacciones y emisión de eventos.
 */

import type { DAWState } from '../types/state';
import type { CommandDefinition, CommandResult, TransactionResult, CommandError, CommandPayload, CommandHistoryEntry, StateTransition, ActionRequest, ValidatorPipeline } from '../types/command';
import type { EventoDominio } from '../events/evento-dominio';
import type { BusEventos } from '../events/event-bus';
import type { PilaDeshacerRehacer } from '../state/pila-deshacer-rehacer';
import type { CommandRegistry } from '../state/registro-comandos';
import type { AuditLog } from '../state/registro-auditoria';
import type { Command } from '../types/command';
import { crearPipelineValidacion } from './pipeline-validacion';
import { validarEstado } from './validador';
import { withUpdatedStateRevision } from './state-revision';

export interface CommandExecutorOptions {
  busEventos: BusEventos;
  pila: PilaDeshacerRehacer;
  registro: CommandRegistry;
  auditoria: AuditLog;
  estadoInicial: DAWState;
  pipelineValidacion?: ValidatorPipeline;
}

export class CommandExecutor {
  private estado: DAWState;
  private bus: BusEventos;
  private pila: PilaDeshacerRehacer;
  private registro: CommandRegistry;
  private auditoria: AuditLog;
  private historial: CommandHistoryEntry[] = [];
  private pipeline: ValidatorPipeline;

  constructor(opciones: CommandExecutorOptions) {
    this.estado = opciones.estadoInicial;
    this.bus = opciones.busEventos;
    this.pila = opciones.pila;
    this.registro = opciones.registro;
    this.auditoria = opciones.auditoria;
    this.pipeline = opciones.pipelineValidacion ?? crearPipelineValidacion({ registroComandos: opciones.registro });
  }

  obtenerEstado(): DAWState {
    return this.estado;
  }

  canUndo(): boolean {
    return this.pila.canUndo();
  }

  canRedo(): boolean {
    return this.pila.canRedo();
  }

  /** Profundidad actual de la pila de undo (para revertir un turno del agente). */
  getUndoDepth(): number {
    return this.pila.getUndoStack().length;
  }

  getHistory(): CommandHistoryEntry[] {
    return [...this.historial];
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

  private async resolverTransicion(
    valor: StateTransition | Promise<StateTransition>,
  ): Promise<StateTransition> {
    return await valor;
  }

  async execute<T = unknown>(type: string, payload: unknown, source: CommandHistoryEntry['source'] = 'user', userId?: string): Promise<CommandResult<T>> {
    const entryId = crypto.randomUUID();
    const timestamp = Date.now();
    // Identidad por defecto en app de escritorio (evita AUTH_MISSING en cada acción UI)
    const effectiveUserId = userId ?? (source === 'user' ? 'local' : undefined);

    const definicion = this.registro.get(type);
    if (!definicion) {
      const error: CommandError = { code: 'COMMAND_NOT_FOUND', message: `Comando no registrado: ${type}` };
      this.auditoria.log({ id: entryId, timestamp, commandType: type, payload, source, userId: effectiveUserId, result: 'failure', error: error.message });
      this.bus.emit('comando.fallido', { type, error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }

    const request: ActionRequest = {
      type,
      payload: payload as never,
      source,
      userId: effectiveUserId,
      context: {},
    };

    const pipelineResult = await this.pipeline.validate(request, { state: this.estado });
    if (!pipelineResult.valid) {
      const error: CommandError = { code: 'VALIDATION_FAILED', message: pipelineResult.errors.map(e => e.message).join(', ') };
      this.auditoria.log({ id: entryId, timestamp, commandType: type, payload, source, userId: effectiveUserId, result: 'failure', error: error.message });
      this.bus.emit('comando.fallido', { type, error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }

    for (const warning of pipelineResult.warnings) {
      this.bus.emit('validacion.advertencia', { code: warning.code, message: warning.message, suggestion: warning.suggestion });
    }

    if (definicion.validate) {
      const validationResult = definicion.validate(this.estado, payload as never);
      if (!validationResult.valid) {
        const error: CommandError = { code: 'VALIDATION_FAILED', message: validationResult.errors.map(e => e.message).join(', ') };
        this.auditoria.log({ id: entryId, timestamp, commandType: type, payload, source, userId: effectiveUserId, result: 'failure', error: error.message });
        this.bus.emit('comando.fallido', { type, error: error.message, code: error.code });
        return { success: false, state: this.estado, events: [], error };
      }
    }

    const estadoValidacion = validarEstado(this.estado);
    for (const advertencia of estadoValidacion.advertencias) {
      this.bus.emit('estado.advertencia', { campo: advertencia.campo, mensaje: advertencia.mensaje, entidadId: advertencia.entidadId });
    }

    let events: EventoDominio[] = [];
    let result: T | undefined;
    let inversePayload: unknown = payload;

    try {
      const stateTransition = await (definicion.handler(this.estado, payload as never) as Promise<StateTransition<T>> | StateTransition<T>);
      this.estado = withUpdatedStateRevision(stateTransition.state);
      events = stateTransition.events ?? [];
      result = stateTransition.result as T | undefined;
      if (stateTransition.inversePayload !== undefined) {
        inversePayload = stateTransition.inversePayload;
      }
    } catch (e: unknown) {
      const error: CommandError = { code: 'EXECUTION_ERROR', message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined };
      this.auditoria.log({ id: entryId, timestamp, commandType: type, payload, source, userId: effectiveUserId, result: 'failure', error: error.message });
      this.bus.emit('comando.fallido', { type, error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }

    const inverseDef = definicion.inverseType ? this.registro.get(definicion.inverseType) : null;

    if (inverseDef) {
      const payloadForward = payload;
      const payloadInverse = inversePayload;

      const deshacerTransicion = (estado: unknown) =>
        inverseDef.handler(estado as DAWState, payloadInverse as never) as StateTransition;
      const rehacerTransicion = (estado: unknown) =>
        definicion.handler(estado as DAWState, payloadForward as never) as StateTransition;

      const inverse: Command = {
        id: crypto.randomUUID(),
        nombre: inverseDef.type,
        descripcion: inverseDef.description,
        categoria: 'sistema',
        ejecutar: (estado: unknown) => deshacerTransicion(estado).state,
        deshacer: (estado: unknown) => rehacerTransicion(estado).state,
        rehacer: (estado: unknown) => deshacerTransicion(estado).state,
        deshacerTransicion: rehacerTransicion,
        rehacerTransicion: deshacerTransicion,
        inverso: null,
        irreversible: false,
        fechaCreacion: Date.now(),
      };

      const wrapper: Command = {
        id: crypto.randomUUID(),
        nombre: definicion.type,
        descripcion: definicion.description,
        categoria: 'usuario',
        ejecutar: (estado: unknown) => rehacerTransicion(estado).state,
        deshacer: (estado: unknown) => deshacerTransicion(estado).state,
        rehacer: (estado: unknown) => rehacerTransicion(estado).state,
        deshacerTransicion,
        rehacerTransicion,
        inverso: inverse,
        irreversible: false,
        fechaCreacion: Date.now(),
      };

      this.pila.push(wrapper);
    }

    this.emitirEventos(events);

    const historyEntry: CommandHistoryEntry = { id: entryId, commandType: type, payload, timestamp, source, userId: effectiveUserId, success: true };
    this.historial.push(historyEntry);
    this.auditoria.log({
      id: historyEntry.id,
      timestamp: historyEntry.timestamp,
      commandType: historyEntry.commandType,
      payload: historyEntry.payload,
      source,
      userId: effectiveUserId,
      result: 'success',
    });

    return { success: true, state: this.estado, events, result };
  }

  async undo(): Promise<CommandResult> {
    if (!this.pila.canUndo()) {
      const error: CommandError = { code: 'NOTHING_TO_UNDO', message: 'No hay acciones para deshacer' };
      this.bus.emit('comando.fallido', { type: 'undo', error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }

    const pendientes = this.pila.getUndoStack();
    const command = pendientes[pendientes.length - 1]!;

    try {
      const raw = command.deshacerTransicion
        ? command.deshacerTransicion(this.estado)
        : { state: command.deshacer(this.estado) as DAWState, events: [] as EventoDominio[], result: undefined };
      const transition = await this.resolverTransicion(raw as StateTransition);
      this.estado = withUpdatedStateRevision(transition.state);
      this.pila.undo();
      const events = transition.events ?? [];
      this.emitirEventos(events);

      const entryId = crypto.randomUUID();
      const timestamp = Date.now();
      this.historial.push({ id: entryId, commandType: `undo:${command.nombre}`, payload: undefined, timestamp, source: 'user', success: true });
      this.auditoria.log({ id: entryId, timestamp, commandType: `undo:${command.nombre}`, payload: undefined, source: 'user', result: 'success' });
      this.bus.emit('undoRedo.undo', { comando: command.nombre });
      return { success: true, state: this.estado, events };
    } catch (e: unknown) {
      const error: CommandError = { code: 'UNDO_ERROR', message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined };
      this.bus.emit('comando.fallido', { type: 'undo', error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }
  }

  async redo(): Promise<CommandResult> {
    if (!this.pila.canRedo()) {
      const error: CommandError = { code: 'NOTHING_TO_REDO', message: 'No hay acciones para rehacer' };
      this.bus.emit('comando.fallido', { type: 'redo', error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }

    const pendientes = this.pila.getRedoStack();
    const command = pendientes[pendientes.length - 1]!;

    try {
      const raw = command.rehacerTransicion
        ? command.rehacerTransicion(this.estado)
        : { state: command.rehacer(this.estado) as DAWState, events: [] as EventoDominio[], result: undefined };
      const transition = await this.resolverTransicion(raw as StateTransition);
      this.estado = withUpdatedStateRevision(transition.state);
      this.pila.redo();
      const events = transition.events ?? [];
      this.emitirEventos(events);

      const entryId = crypto.randomUUID();
      const timestamp = Date.now();
      this.historial.push({ id: entryId, commandType: `redo:${command.nombre}`, payload: undefined, timestamp, source: 'user', success: true });
      this.auditoria.log({ id: entryId, timestamp, commandType: `redo:${command.nombre}`, payload: undefined, source: 'user', result: 'success' });
      this.bus.emit('undoRedo.redo', { comando: command.nombre });
      return { success: true, state: this.estado, events };
    } catch (e: unknown) {
      const error: CommandError = { code: 'REDO_ERROR', message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined };
      this.bus.emit('comando.fallido', { type: 'redo', error: error.message, code: error.code });
      return { success: false, state: this.estado, events: [], error };
    }
  }

  async batch(commands: CommandPayload[], source: CommandHistoryEntry['source'] = 'user', userId?: string): Promise<TransactionResult> {
    const resultados: CommandResult[] = [];
    const estadoAnterior = this.estado;
    const pilaSnap = this.pila.snapshot();

    for (const cmd of commands) {
      const resultado = await this.execute(cmd.type, cmd.payload, source, userId);
      resultados.push(resultado);
      if (!resultado.success) {
        this.estado = estadoAnterior;
        this.pila.restore(pilaSnap);
        this.bus.emit('comando.fallido', {
          type: 'batch',
          error: resultado.error?.message ?? 'Batch fallido',
          code: resultado.error?.code ?? 'BATCH_FAILED',
        });
        return { success: false, results: resultados, rolledBack: true, error: resultado.error };
      }
    }

    return { success: true, results: resultados, rolledBack: false };
  }

  marcarBoundary(): void {
    this.pila.limpiarRedo();
  }

  /** Simula un batch sin persistir estado ni undo (dry-run). */
  async simulateBatch(
    commands: CommandPayload[],
    source: CommandHistoryEntry['source'] = 'ai',
    userId?: string,
  ): Promise<{ success: boolean; results: CommandResult[]; stateDiff: import('./diff-estado').SemanticStateDiff }> {
    const before = structuredClone(this.estado) as DAWState;
    const pilaSnap = this.pila.snapshot();
    const batch = await this.batch(commands, source, userId);
    const after = structuredClone(this.estado) as DAWState;
    const { computeSemanticDiff } = await import('./diff-estado');
    const stateDiff = computeSemanticDiff(before, after);
    this.estado = before;
    this.pila.restore(pilaSnap);
    return { success: batch.success, results: batch.results, stateDiff };
  }
}
