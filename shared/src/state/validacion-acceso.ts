/**
 * Validador de permisos del DAW.
 *
 * Propósito:
 *   Verificar que el nivel de permiso del usuario permite ejecutar
 *   una herramienta o comando según su riesgo y categoría.
 *
 * Importancia:
 *   - Es la puerta de entrada para garantizar que solo usuarios
 *     autorizados ejecutan acciones peligrosas.
 *   - Implementa la política de opt-out por defecto.
 *
 * Función:
 *   Exporta PermissionValidator, PermissionLevel, PermissionResult
 *   y crearValidadorPermisos con matriz de permisos por nivel.
 */

import type { PermissionLevel, PermissionResult, ToolDefinition, RiskLevel } from '../types/command';

export type { PermissionLevel, PermissionResult };

const MATRIZ_PERMISOS: Record<PermissionLevel, Record<RiskLevel, boolean>> = {
  admin: { read: true, write: true, dangerous: true },
  engineer: { read: true, write: true, dangerous: false },
  user: { read: true, write: true, dangerous: false },
  guest: { read: true, write: false, dangerous: false },
  ai: { read: true, write: false, dangerous: false },
};

export interface PermissionValidator {
  check(tool: ToolDefinition, userLevel: PermissionLevel): PermissionResult;
}

export function crearValidadorPermisos(): PermissionValidator {
  return {
    check(tool: ToolDefinition, userLevel: PermissionLevel): PermissionResult {
      const permitted = MATRIZ_PERMISOS[userLevel]?.[tool.risk] ?? false;
      if (permitted) {
        return {
          allowed: true,
          requiresConfirmation: tool.confirmationRequired ?? false,
        };
      }
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `El nivel de permiso ${userLevel} no permite ejecutar herramientas de riesgo ${tool.risk}`,
      };
    },
  };
}
