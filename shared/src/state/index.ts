/**
 * Módulo de gestión de estado del DAW.
 *
 * Propósito:
 *   Centralizar la implementación runtime del estado: factory de estado
 *   inicial, tienda de estado, query concreta y watchers.
 *
 * Importancia:
 *   - Provee la base para la inmutabilidad lógica y el acceso controlado.
 *   - Separa la implementación runtime de las interfaces de tipos.
 *   - Facilita la sustitución de la tienda o query sin romper contratos.
 *
 * Función:
 *   Exporta crearEstadoInicial, crearTiendaDAW, ConsultaDAW y tipos
 *   relacionados para la gestión de estado.
 */

export { crearEstadoInicial } from './estado-inicial';
export { crearTiendaDAW, type TiendaDAW, type TiendaDAWOpciones, type TiendaDAWListener } from './tienda';
export { ConsultaDAW } from './consulta';
export { crearObservadorEstado, type ObservadorEstado } from './watch';
export { ejecutarMigraciones, type ResultadoMigracion } from './migraciones';
export { validarEstado, type ValidacionEstadoResultado } from './validador';
export {
  serializarEstado,
  deserializarEstado,
  clonarEstadoViaJSON,
  fusionarConEstadoInicial,
} from './serializar-estado';
export {
  exportarEstadoDAW,
  importarEstadoDAW,
  clonarEstadoDAW,
  resetearEstadoDAW,
  type ResultadoExportacionEstado,
  type ResultadoImportacionEstado,
} from './operaciones-estado';
export { crearRegistroComandos, registroComandos } from './registro-comandos';
export { registrarComandosBuiltin } from './comandos-builtin';
export { crearPilaDeshacerRehacer } from './pila-deshacer-rehacer';
export { CommandExecutor } from './ejecutor-comandos';
export type { CommandExecutorOptions } from './ejecutor-comandos';
export {
  computeSemanticDiff,
  formatSemanticDiffSummary,
  mergeSemanticDiffs,
  emptySemanticDiff,
  type SemanticStateDiff,
} from './diff-estado';
export { TransactionManager, crearTransactionManager, type Transaction, type TransactionCommitResult, type TransactionCommitOptions } from './gestor-transacciones';
export { crearRegistroMacros, registroMacros } from './macros';
export type { MacroRegistry } from './macros';
export { crearRegistroAuditoria, registroAuditoria } from './registro-auditoria';
export type { AuditLog } from './registro-auditoria';
export { crearApiScripts } from './api-scripts';
export type { ScriptAPIOptions } from './api-scripts';
export { crearValidadorPermisos } from './validacion-acceso';
export { crearReglasDominio } from './validacion-dominio';
export type { ReglasDominio } from './validacion-dominio';
export { crearValidadorConflictos } from './validacion-conflictos';
export type { ConflictValidator } from './validacion-conflictos';
export { crearValidadorIA } from './validacion-ia';
export type { AIValidator } from './validacion-ia';
export { crearPipelineValidacion } from './pipeline-validacion';
export type { ValidationStep } from './pipeline-validacion';
export { crearPermissionManager } from './permissions';
export type {
  PermissionManager,
  AutonomyLevel,
  UserPermissionConfig,
  PermissionCheckResult,
  PermissionLogEntry,
  AutonomyScope,
  EmergencyStop,
  ToolPermissionOverride,
} from './permissions';
