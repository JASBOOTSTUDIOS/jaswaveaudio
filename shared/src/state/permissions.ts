/**
 * Sistema de permisos del DAW.
 *
 * Propósito:
 *   Controlar la autonomía de la IA y validar qué herramientas puede
 *   ejecutar según el nivel del usuario, overrides por herramienta y
 *   ámbito de sesión/proyecto.
 *
 * Importancia:
 *   - Garantiza que el usuario mantenga control total sobre la IA.
 *   - Permite cambiar el nivel de autonomía sin cambiar código.
 *   - Cumple con el requisito de emergency stop y auditoría.
 *
 * Función:
 *   Exporta PermissionManager, PermissionPolicy, PermissionLogEntry,
 *   AutonomyScope, EmergencyStop y helpers de permisos.
 */

import type { ToolDefinition, RiskLevel } from '../types/command';

export type AutonomyLevel = 'READ_ONLY' | 'SUGGEST' | 'CONFIRM' | 'AUTO_EXECUTE_SAFE' | 'FULL_AUTONOMY';

export interface ToolPermissionOverride {
  toolName: string;
  allowed: boolean;
  requireConfirmation: boolean;
  reason?: string;
}

export interface UserPermissionConfig {
  level: AutonomyLevel;
  overrides: ToolPermissionOverride[];
  allowUnsafeTools: boolean;
}

export interface PermissionLogEntry {
  timestamp: number;
  toolName: string;
  userLevel: AutonomyLevel;
  allowed: boolean;
  requiredConfirmation: boolean;
  userConfirmed?: boolean;
  source: 'user' | 'ai' | 'script';
}

export interface PermissionCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
  toolName: string;
  userLevel: AutonomyLevel;
  overrideUsed?: boolean;
}

export interface AutonomyScope {
  level: AutonomyLevel;
  appliesTo: ('all' | 'project' | 'session')[];
  expiresAt?: number;
}

export interface ConfirmationRequest {
  type: 'confirmation';
  summary: string;
  toolCalls: { type: string; payload: unknown }[];
  risk: RiskLevel;
  preview?: Record<string, { before: unknown; after: unknown }>;
}

export interface EmergencyStop {
  trigger(): void;
  isActive(): boolean;
}

const DEFAULT_LEVEL: AutonomyLevel = 'CONFIRM';
const MAX_LOG_ENTRIES = 1000;

const MATRIZ_PERMISOS: Record<AutonomyLevel, Record<RiskLevel, { allowed: boolean; requiresConfirmation: boolean }>> = {
  READ_ONLY: { read: { allowed: true, requiresConfirmation: false }, write: { allowed: false, requiresConfirmation: false }, dangerous: { allowed: false, requiresConfirmation: false } },
  SUGGEST: { read: { allowed: true, requiresConfirmation: false }, write: { allowed: false, requiresConfirmation: false }, dangerous: { allowed: false, requiresConfirmation: false } },
  CONFIRM: { read: { allowed: true, requiresConfirmation: false }, write: { allowed: true, requiresConfirmation: true }, dangerous: { allowed: true, requiresConfirmation: true } },
  AUTO_EXECUTE_SAFE: { read: { allowed: true, requiresConfirmation: false }, write: { allowed: true, requiresConfirmation: false }, dangerous: { allowed: true, requiresConfirmation: true } },
  FULL_AUTONOMY: { read: { allowed: true, requiresConfirmation: false }, write: { allowed: true, requiresConfirmation: false }, dangerous: { allowed: true, requiresConfirmation: false } },
};

export interface PermissionManagerOptions {
  busEventos?: {
    emit: (nombre: string, payload?: unknown) => void;
  };
}

export interface PermissionManager {
  getUserConfig(): UserPermissionConfig;
  setUserConfig(config: UserPermissionConfig, source?: 'user' | 'ai' | 'script'): void;
  check(tool: ToolDefinition, source: 'user' | 'ai' | 'script'): PermissionCheckResult;
  confirm(toolName: string, approved: boolean): void;
  getLog(): PermissionLogEntry[];
  setScope(scope: AutonomyScope): void;
  getScope(): AutonomyScope;
  createEmergencyStop(): EmergencyStop;
  requestLevelChange(level: AutonomyLevel): boolean;
}

export function crearPermissionManager(opciones: PermissionManagerOptions = {}): PermissionManager {
  let config: UserPermissionConfig = {
    level: DEFAULT_LEVEL,
    overrides: [],
    allowUnsafeTools: false,
  };

  const scope: AutonomyScope = {
    level: config.level,
    appliesTo: ['all'],
  };
  let scopeExplicitlySet = false;

  const pendingConfirmations = new Map<string, { tool: ToolDefinition; source: 'user' | 'ai' | 'script' }>();
  const log: PermissionLogEntry[] = [];

  const emit = (nombre: string, payload?: unknown) => {
    try {
      opciones.busEventos?.emit(nombre, payload);
    } catch (error) {
      console.error(`PermissionManager: fallo al emitir ${nombre}`, error);
    }
  };

  const addLog = (entry: PermissionLogEntry) => {
    log.push(entry);
    if (log.length > MAX_LOG_ENTRIES) {
      log.splice(0, log.length - MAX_LOG_ENTRIES);
    }
  };

  const getEffectiveLevel = (): AutonomyLevel => {
    if (scope.expiresAt && Date.now() > scope.expiresAt) {
      scope.level = config.level;
      scope.expiresAt = undefined;
      scopeExplicitlySet = false;
    }
    return scopeExplicitlySet ? scope.level : config.level;
  };

  const getOverride = (toolName: string): ToolPermissionOverride | undefined => {
    return config.overrides.find(o => o.toolName === toolName);
  };

  return {
    getUserConfig(): UserPermissionConfig {
      return config;
    },

    setUserConfig(next: UserPermissionConfig, source?: 'user' | 'ai' | 'script'): void {
      if (source && source !== 'user') {
        addLog({
          timestamp: Date.now(),
          toolName: 'permissions.setLevel',
          userLevel: config.level,
          allowed: false,
          requiredConfirmation: true,
          source,
        });
        return;
      }
      config = next;
    },

    check(tool: ToolDefinition, source: 'user' | 'ai' | 'script'): PermissionCheckResult {
      const effectiveLevel = getEffectiveLevel();
      const override = getOverride(tool.type);

      if (override) {
        const requiresConfirmation = override.requireConfirmation && !config.allowUnsafeTools;
        addLog({
          timestamp: Date.now(),
          toolName: tool.type,
          userLevel: effectiveLevel,
          allowed: override.allowed,
          requiredConfirmation: requiresConfirmation,
          source,
        });

        return {
          allowed: override.allowed,
          requiresConfirmation,
          reason: override.reason,
          toolName: tool.type,
          userLevel: effectiveLevel,
          overrideUsed: true,
        };
      }

      const policy = MATRIZ_PERMISOS[effectiveLevel]?.[tool.risk];
      if (!policy) {
        addLog({
          timestamp: Date.now(),
          toolName: tool.type,
          userLevel: effectiveLevel,
          allowed: false,
          requiredConfirmation: false,
          source,
        });

        return {
          allowed: false,
          requiresConfirmation: false,
          reason: `Nivel ${effectiveLevel} sin política para riesgo ${tool.risk}`,
          toolName: tool.type,
          userLevel: effectiveLevel,
        };
      }

      const requiresConfirmation = tool.confirmationRequired || policy.requiresConfirmation;
      addLog({
        timestamp: Date.now(),
        toolName: tool.type,
        userLevel: effectiveLevel,
        allowed: policy.allowed,
        requiredConfirmation: requiresConfirmation,
        source,
      });

      return {
        allowed: policy.allowed,
        requiresConfirmation,
        toolName: tool.type,
        userLevel: effectiveLevel,
      };
    },

    confirm(toolName: string, approved: boolean): void {
      const pending = pendingConfirmations.get(toolName);
      if (pending) {
        pendingConfirmations.delete(toolName);
        emit('permissions.confirmation.resolved', { toolName, approved });
      }
    },

    getLog(): PermissionLogEntry[] {
      return log.slice(-MAX_LOG_ENTRIES);
    },

    setScope(next: AutonomyScope): void {
      scope.level = next.level;
      scope.appliesTo = next.appliesTo;
      scope.expiresAt = next.expiresAt;
      scopeExplicitlySet = true;
    },

    getScope(): AutonomyScope {
      return scope;
    },

    createEmergencyStop(): EmergencyStop {
      let active = false;

      return {
        trigger(): void {
          active = true;
          config.level = 'READ_ONLY';
          scope.level = 'READ_ONLY';
          scopeExplicitlySet = true;
          emit('permissions.emergency_stop', { active: true });
        },
        isActive(): boolean {
          return active;
        },
      };
    },

    requestLevelChange(level: AutonomyLevel): boolean {
      const allowed = getEffectiveLevel() === 'READ_ONLY';
      addLog({
        timestamp: Date.now(),
        toolName: 'permissions.setLevel',
        userLevel: config.level,
        allowed,
        requiredConfirmation: !allowed,
        source: 'ai',
      });
      if (allowed) {
        config.level = level;
      }
      return allowed;
    },
  };
}

export const permissionManager = crearPermissionManager();
