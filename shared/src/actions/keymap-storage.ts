import type { KeymapOverrides } from './types';
import { DEFAULT_KEYMAP_ID } from './keymap';

const STORAGE_KEY = 'jaswave.keymap.overrides.v1';

export interface KeymapStorage {
  load(): KeymapOverrides | null;
  save(data: KeymapOverrides): void;
  clear(): void;
}

/** Persistencia vía localStorage (renderer). Preparado para swap a Preload/Main. */
export function createLocalKeymapStorage(storage?: Storage): KeymapStorage {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);

  return {
    load() {
      if (!store) return null;
      try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as KeymapOverrides;
      } catch {
        return null;
      }
    },
    save(data: KeymapOverrides) {
      if (!store) return;
      store.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    clear() {
      if (!store) return;
      store.removeItem(STORAGE_KEY);
    },
  };
}

export function createDefaultOverrides(): KeymapOverrides {
  return {
    activeKeymapId: DEFAULT_KEYMAP_ID,
    overrides: {},
    disabledShortcuts: [],
  };
}
