export type * from './types';
export {
  normalizeShortcutString,
  normalizeKeyboardEvent,
  normalizeKeyName,
  parseNormalizedShortcut,
  shortcutsEqual,
} from './keyboard-normalizer';
export { ActionRegistry, createActionRegistry } from './action-registry';
export { ShortcutRegistry, createShortcutRegistry } from './shortcut-registry';
export { ShortcutResolver, createShortcutResolver } from './shortcut-resolver';
export { ACTION_CATALOG, getActionCatalog } from './catalog';
export {
  buildDefaultKeymap,
  buildLegacyAtajoMap,
  validateKeymap,
  exportKeymap,
  importKeymap,
  DEFAULT_KEYMAP_ID,
} from './keymap';
export {
  createLocalKeymapStorage,
  createDefaultOverrides,
  type KeymapStorage,
} from './keymap-storage';
export {
  isTextInputTarget,
  hasNonEmptyTextSelection,
  isNativeClipboardShortcut,
  shouldIgnoreGlobalShortcuts,
  shouldHandleShortcut,
  actionAllowsEvent,
  createContextState,
} from './scope';
export { createActionSystem, type ActionSystem } from './action-system';
export { listActionsAsTools, actionToToolDefinition } from './ai-bridge';

/** Preparación futura: mouse modifiers comparten InputBinding conceptualmente. */
export type InputBindingKind = 'keyboard' | 'mouseModifier';

export interface InputBindingBase {
  kind: InputBindingKind;
  actionId: string;
  context: import('./types').ActionContext;
}
