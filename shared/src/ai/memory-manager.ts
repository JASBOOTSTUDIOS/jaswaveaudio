/**
 * Gestor de memorias del DAW para el sistema de IA.
 *
 * Propósito:
 *   Administrar memorias de sesión y persistentes, aplicando
 *   expiración, decaimiento, filtrado por scope y operaciones
 *   CRUD básicas.
 *
 * Importancia:
 *   - Centraliza la lógica de memorias separada del Context Manager.
 *   - Facilita persistencia futura y búsqueda semántica.
 *
 * Función:
 *   Exporta MemoryManager con add/remove/clear/getForContext y
 *   helpers de expiración y decaimiento.
 */

import type { MemoryEntry, PersistentMemoryEntry } from '../types/contexto';
import { aplicarDecayPorAntiguedad } from '../types/contexto';

export interface MemoryManagerOptions {
  maxSessionEntries?: number;
  maxPersistentEntries?: number;
  autoExpire?: boolean;
}

export interface MemoryManager {
  addSession(entry: MemoryEntry): void;
  addPersistent(entry: PersistentMemoryEntry): void;
  removeSession(id: string): void;
  removePersistent(id: string): void;
  clearSession(): void;
  clearPersistent(): void;
  getSession(): MemoryEntry[];
  getPersistent(scope?: 'user' | 'project'): PersistentMemoryEntry[];
  getForContext(scope?: 'project' | 'session' | 'user'): { session: MemoryEntry[]; persistent: PersistentMemoryEntry[] };
  decayAll(): void;
}

export function crearMemoryManager(opciones: MemoryManagerOptions = {}): MemoryManager {
  const maxSessionEntries = opciones.maxSessionEntries ?? 200;
  const maxPersistentEntries = opciones.maxPersistentEntries ?? 1000;
  const autoExpire = opciones.autoExpire ?? true;

  const sessionEntries: MemoryEntry[] = [];
  const persistentEntries: PersistentMemoryEntry[] = [];

  const limpiarExpiradas = (entradas: PersistentMemoryEntry[]): PersistentMemoryEntry[] => {
    if (!autoExpire) return entradas;
    const ahora = Date.now();
    return entradas.filter(e => {
      const expiracion = typeof e.expiration === 'number' ? e.expiration : undefined;
      return expiracion === undefined || expiracion > ahora;
    });
  };

  const decayEntry = <T extends { timestamp: number; confidence: number }>(entry: T): T => {
    const base = typeof entry.confidence === 'number' ? entry.confidence : 0;
    const decayed = aplicarDecayPorAntiguedad(base, entry.timestamp);
    return { ...entry, confidence: decayed };
  };

  return {
    addSession(entry: MemoryEntry): void {
      sessionEntries.push(entry);
      if (sessionEntries.length > maxSessionEntries) {
        sessionEntries.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
        sessionEntries.splice(maxSessionEntries);
      }
    },

    addPersistent(entry: PersistentMemoryEntry): void {
      persistentEntries.push(entry);
      const limpias = limpiarExpiradas([...persistentEntries]);
      persistentEntries.length = 0;
      persistentEntries.push(...limpias);
      if (persistentEntries.length > maxPersistentEntries) {
        persistentEntries.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
        persistentEntries.splice(maxPersistentEntries);
      }
    },

    removeSession(id: string): void {
      const idx = sessionEntries.findIndex(e => e.id === id);
      if (idx >= 0) sessionEntries.splice(idx, 1);
    },

    removePersistent(id: string): void {
      const idx = persistentEntries.findIndex(e => e.id === id);
      if (idx >= 0) persistentEntries.splice(idx, 1);
    },

    clearSession(): void {
      sessionEntries.length = 0;
    },

    clearPersistent(): void {
      persistentEntries.length = 0;
    },

    getSession(): MemoryEntry[] {
      return sessionEntries.map(decayEntry);
    },

    getPersistent(scope?: 'user' | 'project'): PersistentMemoryEntry[] {
      const filtradas = scope ? persistentEntries.filter(e => e.scope === scope) : persistentEntries;
      return filtradas.map(decayEntry);
    },

    getForContext(scope?: 'project' | 'session' | 'user'): { session: MemoryEntry[]; persistent: PersistentMemoryEntry[] } {
      const persistent = scope ? persistentEntries.filter(e => e.scope === scope) : persistentEntries;
      return {
        session: sessionEntries.map(decayEntry),
        persistent: persistent.map(decayEntry),
      };
    },

    decayAll(): void {
      for (let i = 0; i < sessionEntries.length; i++) {
        sessionEntries[i] = decayEntry(sessionEntries[i]);
      }
      for (let i = 0; i < persistentEntries.length; i++) {
        persistentEntries[i] = decayEntry(persistentEntries[i]);
      }
    },
  };
}
