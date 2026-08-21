/**
 * Puente Action Registry → AI Tool Registry (descubrimiento, sin duplicar catálogo).
 */

import type { ToolDefinitionExtended } from '../ai/tool-registry';
import type { ToolCategory } from '../types/command';
import type { ActionCategory, ActionDefinition } from './types';
import { getActionCatalog } from './catalog';

const CATEGORY_TO_TOOL: Partial<Record<ActionCategory, ToolCategory>> = {
  Transport: 'transport',
  Track: 'track',
  Clip: 'clip',
  MIDI: 'midi',
  Automation: 'automation',
  Plugin: 'plugin',
  View: 'ui',
  Window: 'ui',
  AI: 'ai',
  System: 'system',
  Project: 'system',
  Editing: 'clip',
  Selection: 'clip',
  Timeline: 'ui',
  Navigation: 'ui',
  Mixer: 'audio',
  Browser: 'audio',
  Render: 'audio',
};

export function actionToToolDefinition(action: ActionDefinition): ToolDefinitionExtended {
  return {
    type: action.commandType ?? action.id,
    name: action.id,
    description: action.description || action.name,
    version: '1.0.0',
    category: CATEGORY_TO_TOOL[action.category] ?? 'system',
    risk: action.risk,
    parameters: [],
    returns: { type: 'object', description: 'Resultado de la acción' },
    tags: action.aliases ? [...action.aliases] : undefined,
  };
}

/** Lista de herramientas derivadas del Action Catalog (misma fuente que teclado/palette). */
export function listActionsAsTools(): ToolDefinitionExtended[] {
  return getActionCatalog()
    .filter((a) => a.visible !== false && a.enabled !== false)
    .map(actionToToolDefinition);
}
