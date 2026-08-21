/**
 * ActionSystem — fachada que cablea registries, keymap y resolver.
 * Sin React. Sin mutar DAWState.
 */

import { ActionRegistry, createActionRegistry } from './action-registry';
import { ShortcutRegistry, createShortcutRegistry } from './shortcut-registry';
import { ShortcutResolver, createShortcutResolver } from './shortcut-resolver';
import { getActionCatalog } from './catalog';
import { buildDefaultKeymap, buildLegacyAtajoMap, DEFAULT_KEYMAP_ID } from './keymap';
import {
  createDefaultOverrides,
  createLocalKeymapStorage,
  type KeymapStorage,
} from './keymap-storage';
import { normalizeShortcutString } from './keyboard-normalizer';
import { actionAllowsEvent, createContextState } from './scope';
import type {
  ActionContext,
  ActionHandler,
  KeymapDocument,
  KeymapOverrides,
  ResolvedAction,
  ShortcutBinding,
  ShortcutConflict,
} from './types';
import { ShortcutRegistry as SR } from './shortcut-registry';

export interface ActionSystem {
  actions: ActionRegistry;
  shortcuts: ShortcutRegistry;
  resolver: ShortcutResolver;
  context: { get: () => ActionContext; set: (c: ActionContext) => void };
  getKeymap(): KeymapDocument;
  getLegacyMap(): Record<string, string>;
  applyOverrides(overrides: KeymapOverrides): ShortcutConflict[];
  resetAll(): void;
  resetAction(actionId: string): void;
  assignShortcut(actionId: string, shortcut: string, context?: ActionContext): ShortcutConflict | null;
  removeShortcut(actionId: string, shortcut: string, context?: ActionContext): void;
  handleKeyboardEvent(e: KeyboardEvent): boolean;
  bindHandler(actionId: string, handler: ActionHandler): void;
  bindHandlers(map: Record<string, ActionHandler>): void;
  persist(): void;
  loadPersisted(): void;
}

export function createActionSystem(opts?: {
  storage?: KeymapStorage;
  initialContext?: ActionContext;
}): ActionSystem {
  const actions = createActionRegistry();
  const shortcuts = createShortcutRegistry();
  const context = createContextState(opts?.initialContext ?? 'arrangement');
  const storage = opts?.storage ?? createLocalKeymapStorage();
  let overrides = createDefaultOverrides();
  let baseKeymap = buildDefaultKeymap();

  actions.registerMany(getActionCatalog());

  const resolver = createShortcutResolver({
    shortcuts,
    getActiveContext: () => context.get(),
  });

  function rebuildFromKeymap(doc: KeymapDocument): ShortcutConflict[] {
    const conflicts = SR.detectConflicts(doc.bindings);
    // Aplicar solo bindings no conflictivos en el mismo contexto; el primero gana
    shortcuts.clear();
    const seen = new Set<string>();
    for (const b of doc.bindings) {
      const key = `${b.context}::${normalizeShortcutString(b.shortcut)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      shortcuts.addBinding(b);
    }
    // Aplicar overrides de usuario
    for (const [actionId, chords] of Object.entries(overrides.overrides)) {
      shortcuts.removeAllForAction(actionId);
      for (const chord of chords) {
        if (overrides.disabledShortcuts.includes(normalizeShortcutString(chord))) continue;
        const def = actions.get(actionId);
        shortcuts.addBinding({
          actionId,
          shortcut: chord,
          context: def?.context ?? 'global',
        });
      }
    }
    return conflicts;
  }

  rebuildFromKeymap(baseKeymap);

  const system: ActionSystem = {
    actions,
    shortcuts,
    resolver,
    context,

    getKeymap() {
      return {
        ...baseKeymap,
        bindings: shortcuts.listBindings(),
      };
    },

    getLegacyMap() {
      return buildLegacyAtajoMap({
        version: 1,
        id: baseKeymap.id,
        name: baseKeymap.name,
        bindings: shortcuts.listBindings(),
      });
    },

    applyOverrides(next) {
      overrides = next;
      return rebuildFromKeymap(baseKeymap);
    },

    resetAll() {
      overrides = createDefaultOverrides();
      baseKeymap = buildDefaultKeymap();
      rebuildFromKeymap(baseKeymap);
      storage.clear();
    },

    resetAction(actionId) {
      const id = actions.resolveId(actionId) ?? actionId;
      delete overrides.overrides[id];
      const def = actions.get(id);
      shortcuts.removeAllForAction(id);
      for (const s of def?.defaultShortcuts ?? []) {
        shortcuts.addBinding({
          actionId: id,
          shortcut: s,
          context: def?.context ?? 'global',
          intentionalShadowing: def?.intentionalShadowing,
        });
      }
      system.persist();
    },

    assignShortcut(actionId, shortcut, ctx) {
      const id = actions.resolveId(actionId) ?? actionId;
      const def = actions.get(id);
      const context = ctx ?? def?.context ?? 'global';
      const chord = normalizeShortcutString(shortcut);
      const conflict = shortcuts.addBinding({
        actionId: id,
        shortcut: chord,
        context,
        intentionalShadowing: def?.intentionalShadowing,
      });
      if (!conflict) {
        const existing = overrides.overrides[id] ?? shortcuts.getBindingsForAction(id).map((b) => b.shortcut);
        const next = Array.from(new Set([...existing.filter((c) => c !== chord), chord]));
        // Si addBinding falló por conflicto no actualizamos; si ok:
        overrides.overrides[id] = shortcuts.getBindingsForAction(id).map((b) => b.shortcut);
        void next;
        system.persist();
      }
      return conflict;
    },

    removeShortcut(actionId, shortcut, ctx) {
      const id = actions.resolveId(actionId) ?? actionId;
      shortcuts.removeBinding(id, shortcut, ctx);
      overrides.overrides[id] = shortcuts.getBindingsForAction(id).map((b) => b.shortcut);
      system.persist();
    },

    handleKeyboardEvent(e: KeyboardEvent) {
      const resolved: ResolvedAction | null = resolver.resolveFromEvent(e);
      if (!resolved) return false;
      const def = actions.get(resolved.actionId);
      if (!actionAllowsEvent(def, e.target)) return false;
      const result = actions.execute(resolved.actionId);
      if (result.ok) {
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      return false;
    },

    bindHandler(actionId, handler) {
      actions.bindHandler(actionId, handler);
    },

    bindHandlers(map) {
      for (const [id, h] of Object.entries(map)) {
        // Acepta id canónico o alias
        try {
          actions.bindHandler(id, h);
        } catch {
          /* ignore unknown during partial bind */
        }
      }
    },

    persist() {
      storage.save(overrides);
    },

    loadPersisted() {
      const loaded = storage.load();
      if (loaded) {
        overrides = loaded;
        rebuildFromKeymap(baseKeymap);
      }
    },
  };

  return system;
}

export type { ShortcutBinding };
export { DEFAULT_KEYMAP_ID };
