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
 */

import type { DAWState } from '../types/state';
import type { CommandDefinition, CommandResult, TransactionResult, CommandError, CommandPayload, CommandHistoryEntry, StateTransition, ActionRequest, ValidatorPipeline } from '../types/command';
import type { EventoDominio, MetaEmit } from '../events/evento-dominio';
import type { BusEventos } from '../events/event-bus';
import type { PilaDeshacerRehacer } from '../state/pila-deshacer-rehacer';
import type { CommandRegistry } from '../state/registro-comandos';
import type { AuditLog } from '../state/registro-auditoria';
import type { Command } from '../types/command';
import { crearPipelineValidacion } from './pipeline-validacion';
import { validarEstado } from './validador';
import { withUpdatedStateRevision } from './state-revision';
import { computeSemanticDiff, type SemanticStateDiff } from './diff-estado';
import { agregarAcotado, MAX_ENTRADAS_REGISTRO, resumirPayloadParaRegistro } from './resumen-payload';

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
  private pila: PilaDeshacerRehacer;
  private registro: CommandRegistry;
  private auditoria: AuditLog;
  private historial: CommandHistoryEntry[] = [];
  private maxHistorial: number;
  private pipeline: ValidatorPipeline;
  /** Cola serial: cada operación espera a la anterior. */
  private cola: Promise<void> = Promise.resolve();
  private listenersCambio = new Set<ListenerCambioEstado>();

  constructor(opciones: CommandExecutorOptions) {
    this.estado = opciones.estadoInicial;
    this.bus = opciones.busEventos;
    this.pila = opciones.pila;
    this.registro = opciones.registro;
    this.auditoria = opciones.auditoria;
    this.maxHistorial = Math.max(1, opciones.maxHistorial ?? MAX_ENTRADAS_REGISTRO);
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
    this.pila.restore({ undo: [], redo: [] });
  }

  marcarBoundary(): void {
    this.pila.limpiarRedo();
  }

  // ── Infraestructura ──────────────────────────────────────────────────────

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

  /** Entrada de undo compuesta: deshace en orden inverso, rehace en orden. */
  private crearEntradaCompuesta(entradas: Command[]): Command {
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
      nombre: 'batch',
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
   * Núcleo sin efectos secundarios: valida y ejecuta el handler sobre `estadoBase`.
   * No toca this.estado, bus, auditoría, historial ni pila.
   */
  private async ejecutarPaso(
    estadoBase: DAWState,
    type: string,
    payload: unknown,
    source: CommandHistoryEntry['source'],
    effectiveUserId: string | undefined,
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

    const estadoValidacion = validarEstado(estadoBase);
    for (const advertencia of estadoValidacion.advertencias) {
      emisiones.push({ nombre: 'estado.advertencia', payload: { campo: advertencia.campo, mensaje: advertencia.mensaje, entidadId: advertencia.entidadId } });
    }

    let transition: StateTransition;
    try {
      transition = await (definicion.handler(estadoBase, payload as never) as Promise<StateTransition> | StateTransition);
    } catch (e: unknown) {
      return {
        ok: false,
        error: { code: 'EXECUTION_ERROR', message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined },
        emisiones,
      };
    }

    const estado = withUpdatedStateRevision(transition.state);
    const inverseType = transition.inverseType ?? definicion.inverseType;
    const inverseDef = inverseType ? this.registro.get(inverseType) : undefined;
    const payloadInverse = transition.inversePayload !== undefined ? transition.inversePayload : payload;
    const payloadRedo = transition.redoPayload !== undefined ? transition.redoPayload : payload;
    const entradaUndo = inverseDef ? this.crearEntradaUndo(definicion, inverseDef, payloadRedo, payloadInverse) : null;

    return {
      ok: true,
      estado,
      events: transition.events ?? [],
      result: transition.result,
      entradaUndo,
      emisiones,
      limpiaRedo: !inverseDef && transition.state.project !== estadoBase.project,
      limpiaPila: definicion.limpiaHistorialUndo === true,
    };
  }

  // ── API pública ─────────────────────────────────────────────────────────

  execute<T = unknown>(type: string, payload: unknown, source: CommandHistoryEntry['source'] = 'user', userId?: string): Promise<CommandResult<T>> {
    return this.enCola(() => this.ejecutarAhora<T>(type, payload, source, userId));
  }

  private async ejecutarAhora<T>(type: string, payload: unknown, source: CommandHistoryEntry['source'], userId?: string): Promise<CommandResult<T>> {
    const entryId = crypto.randomUUID();
    const timestamp = Date.now();
    const effectiveUserId = this.resolverUsuario(source, userId);

    const paso = await this.ejecutarPaso(this.estado, type, payload, source, effectiveUserId);
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
      this.pila.push(paso.entradaUndo);
    } else if (paso.limpiaRedo) {
      this.pila.limpiarRedo();
    }

    this.emitirEmisiones(paso.emisiones);
    this.emitirEventos(paso.events);
    this.registrarHistorial({ id: entryId, commandType: type, payload, timestamp, source, userId: effectiveUserId, success: true });
    this.auditoria.log({ id: entryId, timestamp, commandType: type, payload, source, userId: effectiveUserId, result: 'success' });
    this.notificarCambio(this.estado, anterior);

    return { success: true, state: this.estado, events: paso.events, result: paso.result as T | undefined };
  }

  undo(): Promise<CommandResult> {
    return this.enCola(() => this.moverPila('undo'));
  }

  redo(): Promise<CommandResult> {
    return this.enCola(() => this.moverPila('redo'));
  }

  private async moverPila(tipo: 'undo' | 'redo'): Promise<CommandResult> {
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
  batch(commands: CommandPayload[], source: CommandHistoryEntry['source'] = 'user', userId?: string): Promise<TransactionResult> {
    return this.enCola(() => this.batchAhora(commands, source, userId));
  }

  private async batchAhora(commands: CommandPayload[], source: CommandHistoryEntry['source'], userId?: string): Promise<TransactionResult> {
    const effectiveUserId = this.resolverUsuario(source, userId);
    const resultados: CommandResult[] = [];
    const pasos: { cmd: CommandPayload; paso: PasoOk; id: string; timestamp: number }[] = [];
    let estado = this.estado;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!;
      const timestamp = Date.now();
      const paso = await this.ejecutarPaso(estado, cmd.type, cmd.payload, source, effectiveUserId);
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
      pasos.push({ cmd, paso, id: crypto.randomUUID(), timestamp });
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
      this.pila.push(entradas[0]!);
    } else if (entradas.length > 1) {
      this.pila.push(this.crearEntradaCompuesta(entradas));
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
        const paso = await this.ejecutarPaso(estado, cmd.type, cmd.payload, source, effectiveUserId);
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
}
