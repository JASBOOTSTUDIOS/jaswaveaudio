import type { KeymapDocument, ShortcutBinding } from './types';
import { getActionCatalog } from './catalog';
import { normalizeShortcutString } from './keyboard-normalizer';
import { ShortcutRegistry } from './shortcut-registry';

export const DEFAULT_KEYMAP_ID = 'jaswave-default';

export function buildDefaultKeymap(): KeymapDocument {
  const bindings: ShortcutBinding[] = [];
  for (const action of getActionCatalog()) {
    for (const shortcut of action.defaultShortcuts ?? []) {
      bindings.push({
        actionId: action.id,
        shortcut: normalizeShortcutString(shortcut),
        context: action.context,
        intentionalShadowing: action.intentionalShadowing,
      });
    }
  }
  return {
    version: 1,
    id: DEFAULT_KEYMAP_ID,
    name: 'Jaswave Default',
    bindings,
  };
}

/** Mapa legacy actionId (español o inglés) → chord único (primer shortcut). */
export function buildLegacyAtajoMap(keymap: KeymapDocument = buildDefaultKeymap()): Record<string, string> {
  const map: Record<string, string> = {};
  for (const action of getActionCatalog()) {
    const binding = keymap.bindings.find((b) => b.actionId === action.id);
    const chord = binding?.shortcut ?? action.defaultShortcuts?.[0] ?? '';
    if (!chord) continue;
    map[action.id] = chord;
    for (const alias of action.aliases ?? []) {
      map[alias] = chord;
    }
  }
  return map;
}

export function validateKeymap(doc: KeymapDocument): ReturnType<typeof ShortcutRegistry.detectConflicts> {
  return ShortcutRegistry.detectConflicts(doc.bindings);
}

export function exportKeymap(doc: KeymapDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function importKeymap(json: string): KeymapDocument {
  const parsed = JSON.parse(json) as KeymapDocument;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.bindings)) {
    throw new Error('Keymap inválido: se espera version 1 con bindings[]');
  }
  return {
    version: 1,
    id: String(parsed.id || 'imported'),
    name: String(parsed.name || 'Imported'),
    bindings: parsed.bindings.map((b) => ({
      actionId: String(b.actionId),
      shortcut: normalizeShortcutString(String(b.shortcut)),
      context: b.context ?? 'global',
      intentionalShadowing: b.intentionalShadowing,
    })),
  };
}
