/**
 * Módulo de IA del DAW.
 *
 * Propósito:
 *   Centralizar proveedores de IA, factory y políticas de fallback,
 *   manteniendo el DAW core desacoplado de implementaciones concretas.
 *
 * Importancia:
 *   - Cumple ADR-0004: abstracción de proveedor de IA.
 *   - Facilita cambio de proveedor por configuración.
 *   - Soporta fallback automático entre proveedores.
 *
 * Función:
 *   Exporta OllamaProvider, ProviderFactory, FallbackProvider y
 *   tipos relacionados desde submódulos.
 */

export { OllamaProvider } from './providers/ollama';
export type { OllamaProviderOptions } from './providers/ollama';
export { crearProviderFactory, providerFactory, FallbackProvider } from './factory';
export type { ProviderFactory, FallbackProviderOptions } from './factory';
export { crearGestorContexto } from './context-manager';
export { crearMemoryManager } from './memory-manager';
export { crearToolRegistry, toolRegistry } from './tool-registry';
export type {
  ToolDefinitionExtended,
  ToolHandler,
  ToolContext,
  ToolResult,
  ToolRegistry,
} from './tool-registry';
export { registrarPluginTools } from './plugin-tools';

