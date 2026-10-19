/**
 * Tool Registry del DAW.
 *
 * Propósito:
 *   Registrar, descubrir y versionar herramientas que la IA puede ejecutar.
 *   Genera fragments de prompt y capabilities para el Context Manager.
 *
 * Importancia:
 *   - Es el catálogo que la IA consulta para entender qué acciones puede realizar.
 *   - Permite descubrimiento dinámico de herramientas por categoría, riesgo o tags.
 *   - Centraliza el versionado y deprecated marking de herramientas.
 *
 * Función:
 *   Exporta ToolRegistry, ToolHandler, ToolContext, ToolResult y helpers
 *   para registro dinámico, búsqueda, prompt fragment generation y salud.
 */

import type { ToolDefinition, RiskLevel, ToolCategory } from '../types/command';
import type { CommandExecutor } from '../state/ejecutor-comandos';
import type { DAWQuery } from '../types/query';
import type { PermissionLevel } from '../types/command';
import type { EventoDominio } from '../events/evento-dominio';
import type { PermissionManager } from '../state/permissions';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
  min?: number;
  max?: number;
}

export interface ToolReturn {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  description: string;
  schema?: Record<string, unknown>;
}

export interface ToolExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface ToolContext {
  commandExecutor: CommandExecutor;
  query: DAWQuery;
  userPermissionLevel: PermissionLevel;
  projectId: string;
}

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: ToolError;
  events: EventoDominio[];
  confirmationRequired?: boolean;
}

export type ToolHandler = (params: unknown, ctx: ToolContext) => Promise<ToolResult>;

export interface ToolFilter {
  category?: ToolCategory;
  risk?: RiskLevel;
  tags?: string[];
}

export interface ToolRegistryHealth {
  registeredCount: number;
  brokenHandlers: string[];
  lastUpdated: number;
}

export interface ToolDefinitionExtended extends ToolDefinition {
  name: string;
  version: string;
  parameters?: ToolParameter[];
  returns?: ToolReturn;
  examples?: ToolExample[];
  idempotent?: boolean;
  tags?: string[];
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface ToolRegistry {
  register(definition: ToolDefinitionExtended, handler: ToolHandler): void;
  unregister(name: string): void;
  get(name: string): ToolDefinitionExtended | undefined;
  list(filter?: ToolFilter): ToolDefinitionExtended[];
  search(query: string): ToolDefinitionExtended[];
  generatePromptFragment(): string;
  generateCapabilities(): { name: string; description: string; version: string }[];
  onChange(listener: () => void): { cancelarSuscripcion: () => void };
  getHealth(): ToolRegistryHealth;
  setContext(executor: CommandExecutor, permissionManager: PermissionManager): void;
  execute(name: string, params: unknown, source?: 'user' | 'ai' | 'script'): Promise<ToolResult>;
}

const DEFAULT_VERSION = '1.0.0';
const MAX_BROKEN_HANDLERS = 100;

export function crearToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinitionExtended>();
  const handlers = new Map<string, ToolHandler>();
  const listeners = new Set<() => void>();
  const brokenHandlers = new Set<string>();
  let lastUpdated = Date.now();

  const emitChange = () => {
    lastUpdated = Date.now();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // noop
      }
    }
  };

  const normalizeName = (definition: ToolDefinitionExtended): string => {
    return definition.name || definition.type;
  };

  const matchFilter = (tool: ToolDefinitionExtended, filter?: ToolFilter): boolean => {
    if (!filter) return true;
    if (filter.category && tool.category !== filter.category) return false;
    if (filter.risk && tool.risk !== filter.risk) return false;
    if (filter.tags && filter.tags.length > 0) {
      const toolTags = tool.tags || [];
      const hasTag = filter.tags.some(tag => toolTags.includes(tag));
      if (!hasTag) return false;
    }
    return true;
  };

  const markBroken = (name: string) => {
    brokenHandlers.add(name);
    if (brokenHandlers.size > MAX_BROKEN_HANDLERS) {
      const first = Array.from(brokenHandlers)[0];
      if (first !== undefined) {
        brokenHandlers.delete(first);
      }
    }
  };

  return {
    register(definition: ToolDefinitionExtended, handler: ToolHandler): void {
      const name = normalizeName(definition);
      const extended: ToolDefinitionExtended = {
        ...definition,
        name,
        version: definition.version || DEFAULT_VERSION,
        parameters: definition.parameters || [],
        returns: definition.returns || { type: 'object', description: 'Resultado de la herramienta' },
      };
      tools.set(name, extended);
      handlers.set(name, handler);
      brokenHandlers.delete(name);
      emitChange();
    },

    unregister(name: string): void {
      tools.delete(name);
      handlers.delete(name);
      brokenHandlers.delete(name);
      emitChange();
    },

    get(name: string): ToolDefinitionExtended | undefined {
      if (brokenHandlers.has(name)) return undefined;
      return tools.get(name);
    },

    list(filter?: ToolFilter): ToolDefinitionExtended[] {
      return Array.from(tools.values()).filter(tool => !brokenHandlers.has(tool.name) && matchFilter(tool, filter));
    },

    search(query: string): ToolDefinitionExtended[] {
      const q = query.toLowerCase();
      return Array.from(tools.values()).filter(tool =>
        !brokenHandlers.has(tool.name) &&
        (tool.name.toLowerCase().includes(q) ||
          tool.description.toLowerCase().includes(q) ||
          (tool.tags || []).some(tag => tag.toLowerCase().includes(q)))
      );
    },

    generatePromptFragment(): string {
      const lines: string[] = [];
      const sorted = Array.from(tools.values())
        .filter(tool => !brokenHandlers.has(tool.name))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      let lastCat = '';
      for (const tool of sorted) {
        if (tool.category !== lastCat) {
          lastCat = tool.category;
          lines.push(`### ${tool.category}`);
        }
        const deprecated = tool.deprecated ? ' (deprecated' + (tool.deprecationMessage ? `, ${tool.deprecationMessage}` : '') + ')' : '';
        lines.push(`- ${tool.name}: ${tool.description} (${tool.risk})${deprecated}`);
        if (tool.parameters && tool.parameters.length > 0) {
          const params = tool.parameters
            .slice(0, 8)
            .map(p => `${p.name}${p.required ? '*' : ''}:${p.type}`)
            .join(', ');
          lines.push(`  params: ${params}`);
        }
      }
      return lines.join('\n');
    },

    generateCapabilities(): { name: string; description: string; version: string }[] {
      return Array.from(tools.values())
        .filter(tool => !brokenHandlers.has(tool.name))
        .map(tool => ({
          name: tool.name,
          description: tool.description,
          version: tool.version,
        }));
    },

    onChange(listener: () => void): { cancelarSuscripcion: () => void } {
      listeners.add(listener);
      return {
        cancelarSuscripcion: () => {
          listeners.delete(listener);
        },
      };
    },

    getHealth(): ToolRegistryHealth {
      return {
        registeredCount: tools.size - brokenHandlers.size,
        brokenHandlers: Array.from(brokenHandlers).slice(-MAX_BROKEN_HANDLERS),
        lastUpdated,
      };
    },

    setContext(executor: CommandExecutor, permManager: PermissionManager): void {
      executorRef = executor;
      permissionManagerRef = permManager;
    },

    async execute(name: string, params: unknown, source: 'user' | 'ai' | 'script' = 'ai'): Promise<ToolResult> {
      const definition = tools.get(name);
      if (!definition || brokenHandlers.has(name)) {
        return {
          success: false,
          error: { code: 'TOOL_NOT_FOUND', message: `Herramienta no encontrada: ${name}` },
          events: [],
        };
      }

      if (!executorRef) {
        return {
          success: false,
          error: { code: 'NO_EXECUTOR', message: 'ToolRegistry no tiene executor configurado. Llama a setContext() primero.' },
          events: [],
        };
      }

      if (permissionManagerRef) {
        const permResult = permissionManagerRef.check(definition, source);
        if (!permResult.allowed) {
          return {
            success: false,
            error: { code: 'PERMISSION_DENIED', message: `Permiso denegado: ${permResult.reason ?? `nivel ${permResult.userLevel} no permite ${definition.risk}`}` },
            events: [],
            confirmationRequired: permResult.requiresConfirmation,
          };
        }
        if (permResult.requiresConfirmation) {
          return {
            success: false,
            data: null,
            events: [],
            confirmationRequired: true,
            error: { code: 'CONFIRMATION_REQUIRED', message: `Requiere confirmación del usuario para ejecutar ${name}` },
          };
        }
      }

      const handler = handlers.get(name);
      if (handler) {
        const ctx: ToolContext = {
          commandExecutor: executorRef,
          query: { type: 'tool_execute', toolName: name, params } as any,
          userPermissionLevel: 'admin',
          projectId: executorRef.obtenerEstado()?.project?.id ?? '',
        };

        try {
          return await handler(params, ctx);
        } catch (e) {
          markBroken(name);
          return {
            success: false,
            error: { code: 'HANDLER_ERROR', message: e instanceof Error ? e.message : String(e), details: e },
            events: [],
          };
        }
      }

      const cmdResult = await executorRef.execute(name, params, source);
      return {
        success: cmdResult.success,
        data: cmdResult.result,
        error: cmdResult.error,
        events: cmdResult.events,
      };
    },
  };
}

let executorRef: CommandExecutor | null = null;
let permissionManagerRef: PermissionManager | null = null;

export const toolRegistry = crearToolRegistry();
