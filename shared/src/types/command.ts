/**
 * Sistema de comandos para undo/redo del DAW.
 *
 * Propósito:
 *   Encapsular cada mutación del estado como un objeto Command con
 *   ejecución y reversión explícitas, manteniendo el estado lógicamente
 *   inmutable y evitando snapshots completos.
 *
 * Importancia:
 *   - Es el único mecanismo permitido para mutar el estado del DAW,
 *     garantizando trazabilidad y reversibilidad.
 *   - Mantiene la memoria proporcional al número de acciones, no al
 *     tamaño del estado.
 *   - Facilita la automatización, macros y herramientas de IA que
 *     necesiten aplicar y deshacer secuencias de operaciones.
 *
 * Función:
 *   Exporta Command, CommandDefinition, CommandRegistry, CommandExecutor,
 *   UndoRedoStack, Macro, AuditLog, ScriptAPI, Validator, ValidationLayer
 *   y tipos relacionados para el sistema completo de comandos, undo/redo,
 *   macros, auditoría, ejecución sandboxeada de scripts y validación.
 */

export type RiskLevel = 'read' | 'write' | 'dangerous';
export type PermissionLevel = 'admin' | 'engineer' | 'user' | 'guest' | 'ai';
export type ToolCategory = 'transport' | 'track' | 'clip' | 'plugin' | 'automation' | 'midi' | 'audio' | 'ui' | 'system' | 'ai';

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface PermissionResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export interface CommandError {
  code: string;
  message: string;
  stack?: string;
}

export interface StateDiff {
  [key: string]: {
    before: unknown;
    after: unknown;
  };
}

export interface DryRunResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  events?: import('../events/evento-dominio').EventoDominio[];
  stateDiff?: StateDiff;
}

export interface ActionRequest {
  type: string;
  payload: unknown;
  source: 'user' | 'macro' | 'script' | 'ai';
  userId?: string;
  context?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: string;
  category: ToolCategory;
  description: string;
  risk: RiskLevel;
  schema?: Record<string, unknown>;
  inverseType?: string;
  requiredPermission?: PermissionLevel;
  confirmationRequired?: boolean;
}

export interface DomainRule {
  name: string;
  code: string;
  description: string;
  validate: (state: import('../types/state').DAWState, payload: unknown) => ValidationResult;
  appliesTo?: string[];
}

export interface ConflictCheck {
  name: string;
  code: string;
  description: string;
  check: (state: import('../types/state').DAWState, request: ActionRequest) => ValidationResult;
}

export interface AICheck {
  name: string;
  code: string;
  description: string;
  check: (request: ActionRequest, context: Record<string, unknown>) => ValidationResult;
}

export interface ValidatorPipeline {
  validate(request: ActionRequest, options?: { dryRun?: boolean; state?: import('../types/state').DAWState }): Promise<ValidationResult>;
  validateAndPreview(request: ActionRequest, options?: { dryRun?: boolean; state?: import('../types/state').DAWState }): Promise<DryRunResult>;
  addRule(rule: DomainRule): void;
  addConflictCheck(check: ConflictCheck): void;
  addAICheck(check: AICheck): void;
  setPermissionValidator(validator: PermissionValidator): void;
}

export interface PermissionValidator {
  check(tool: ToolDefinition, userLevel: PermissionLevel): PermissionResult;
}

export interface StateTransition<TResult = unknown> {
  state: import('../types/state').DAWState;
  events: import('../events/evento-dominio').EventoDominio[];
  result: TResult;
  /** Payload para el comando inverso (si difiere del payload original). */
  inversePayload?: unknown;
}

export interface CommandPayload<T = unknown> {
  type: string;
  payload: T;
}

export interface TransactionResult {
  success: boolean;
  results: CommandResult[];
  rolledBack: boolean;
  error?: CommandError;
}

export interface CommandResult<T = unknown> {
  success: boolean;
  state: import('../types/state').DAWState;
  events: import('../events/evento-dominio').EventoDominio[];
  result?: T;
  error?: CommandError;
}

export interface Command {
  id: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  ejecutar(estado: unknown): unknown;
  deshacer(estado: unknown): unknown;
  rehacer(estado: unknown): unknown;
  /** Transición completa (estado + eventos) para undo con emisión en el bus. */
  deshacerTransicion?(estado: unknown): StateTransition | Promise<StateTransition>;
  rehacerTransicion?(estado: unknown): StateTransition | Promise<StateTransition>;
  inverso: Command | null;
  agruparCon?: string;
  irreversible: boolean;
  fechaCreacion: number;
}

export interface CommandDefinition<T = unknown> {
  type: string;
  description: string;
  risk: RiskLevel;
  schema?: Record<string, unknown>;
  inverseType?: string;
  handler: (state: import('../types/state').DAWState, payload: T) => StateTransition<T> | Promise<StateTransition<T>>;
  validate?: (state: import('../types/state').DAWState, payload: T) => ValidationResult;
}

export interface CommandHistoryEntry {
  id: string;
  commandType: string;
  payload: unknown;
  timestamp: number;
  source: 'user' | 'macro' | 'script' | 'ai';
  userId?: string;
  success: boolean;
  error?: string;
}

export interface Macro {
  id: string;
  name: string;
  commands: string[];
  parameters?: Record<string, unknown>;
}

export interface CommandLogEntry {
  id: string;
  timestamp: number;
  commandType: string;
  payload: unknown;
  source: 'user' | 'macro' | 'script' | 'ai';
  userId?: string;
  result: 'success' | 'failure';
  error?: string;
}

export interface ScriptAPI {
  executeCommand(type: string, payload: unknown): Promise<CommandResult>;
  getState(): import('../types/state').DAWState;
  subscribe(event: string, handler: Function): { cancelarSuscripcion: () => void };
  log(message: string): void;
}

export interface CommandRegistry {
  register<T>(cmd: CommandDefinition<T>): void;
  unregister(type: string): void;
  get(type: string): CommandDefinition | undefined;
  list(): CommandDefinition[];
  listByRisk(risk: RiskLevel): CommandDefinition[];
}

export interface UndoRedoStack {
  undoStack: Command[];
  redoStack: Command[];
  maxSize: number;
}

export interface KeyBinding {
  key: string;
  modifiers: string[];
  command: string;
  context?: string;
}

export interface CommandGroup {
  id: string;
  nombre: string;
  comandos: Command[];
  descripcion: string;
}

export interface CommandStack {
  deshacer: Command[];
  rehacer: Command[];
  limite: number;
  grupos: CommandGroup[];
}

export interface CommandResultLegacy {
  exito: boolean;
  error?: string;
  estado: unknown;
  comandosAfectados: string[];
}

export function ejecutarComando(pila: CommandStack, comando: Command, estado: unknown): CommandResultLegacy {
  try {
    const nuevoEstado = comando.ejecutar(estado);
    pila.deshacer.push(comando);
    if (pila.deshacer.length > pila.limite) {
      pila.deshacer.shift();
    }
    pila.rehacer = [];
    return { exito: true, estado: nuevoEstado, comandosAfectados: [comando.id] };
  } catch (error: any) {
    return { exito: false, error: error?.message ?? String(error), estado, comandosAfectados: [] };
  }
}

export function deshacerComando(pila: CommandStack, estado: unknown): CommandResultLegacy {
  const comando = pila.deshacer.pop();
  if (!comando) return { exito: false, error: 'Pila vacía', estado, comandosAfectados: [] };
  try {
    const nuevoEstado = comando.deshacer(estado);
    pila.rehacer.push(comando);
    return { exito: true, estado: nuevoEstado, comandosAfectados: [comando.id] };
  } catch (error: any) {
    return { exito: false, error: error?.message ?? String(error), estado, comandosAfectados: [] };
  }
}

export function rehacerComando(pila: CommandStack, estado: unknown): CommandResultLegacy {
  const comando = pila.rehacer.pop();
  if (!comando) return { exito: false, error: 'Pila vacía', estado, comandosAfectados: [] };
  try {
    const nuevoEstado = comando.rehacer(estado);
    pila.deshacer.push(comando);
    return { exito: true, estado: nuevoEstado, comandosAfectados: [comando.id] };
  } catch (error: any) {
    return { exito: false, error: error?.message ?? String(error), estado, comandosAfectados: [] };
  }
}
