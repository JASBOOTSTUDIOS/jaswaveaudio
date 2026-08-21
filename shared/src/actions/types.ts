/**
 * Contratos tipados del sistema de Actions / Shortcuts (estilo REAPER).
 * Las Actions NO mutan DAWState; delegan en Command System / handlers enlazados.
 */

export type ActionRisk = 'read' | 'write' | 'dangerous';

export type ActionCategory =
  | 'Transport'
  | 'Project'
  | 'Editing'
  | 'Selection'
  | 'Timeline'
  | 'Navigation'
  | 'Track'
  | 'Mixer'
  | 'Clip'
  | 'MIDI'
  | 'Automation'
  | 'View'
  | 'Browser'
  | 'Plugin'
  | 'Render'
  | 'AI'
  | 'Window'
  | 'System';

export type ActionContext =
  | 'global'
  | 'arrangement'
  | 'timeline'
  | 'mixer'
  | 'midiEditor'
  | 'pianoRoll'
  | 'automation'
  | 'mediaBrowser'
  | 'pluginEditor'
  | 'aiPanel'
  | 'commandPalette';

/** Orden de prioridad (más específico primero). */
export const CONTEXT_PRIORITY: readonly ActionContext[] = [
  'pluginEditor',
  'midiEditor',
  'pianoRoll',
  'automation',
  'mediaBrowser',
  'aiPanel',
  'commandPalette',
  'mixer',
  'timeline',
  'arrangement',
  'global',
] as const;

export type ShortcutScope = 'always' | 'whenNotTyping' | 'whenNotModal';

export interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  category: ActionCategory;
  context: ActionContext;
  risk: ActionRisk;
  /** Command type del Command System, si aplica. */
  commandType?: string;
  /** IDs legacy u otros nombres de búsqueda. */
  aliases?: readonly string[];
  defaultShortcuts?: readonly string[];
  enabled?: boolean;
  visible?: boolean;
  scope?: ShortcutScope;
  /** Shadowing intencional sobre un binding global con la misma tecla. */
  intentionalShadowing?: boolean;
}

export interface ShortcutBinding {
  actionId: string;
  shortcut: string;
  context: ActionContext;
  /** Si true, el shadowing sobre global/parent es intencional. */
  intentionalShadowing?: boolean;
}

export interface NormalizedShortcut {
  /** Representación canónica: Ctrl+Shift+S */
  chord: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

export type ShortcutConflictKind = 'global' | 'contextual' | 'intentional_shadowing';

export interface ShortcutConflict {
  kind: ShortcutConflictKind;
  shortcut: string;
  context: ActionContext;
  actionIds: readonly string[];
}

export interface ResolvedAction {
  actionId: string;
  shortcut: string;
  context: ActionContext;
  shadowed?: boolean;
}

export interface KeymapDocument {
  version: 1;
  id: string;
  name: string;
  bindings: ShortcutBinding[];
}

export interface KeymapOverrides {
  activeKeymapId: string;
  /** Sobrescrituras usuario: actionId → chords (vacío = deshabilitado). */
  overrides: Record<string, string[]>;
  disabledShortcuts: string[];
}

export type ActionHandler = () => void | Promise<void>;

export interface ActionExecuteResult {
  ok: boolean;
  actionId: string;
  error?: string;
}
