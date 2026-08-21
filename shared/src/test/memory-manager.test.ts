/**
 * Tests del Memory Manager.
 */

import { describe, it, expect } from 'vitest';
import { crearMemoryManager } from '../ai/memory-manager';
import type { MemoryEntry, PersistentMemoryEntry } from '../types/contexto';

const sessionEntry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: 'session-1',
  content: 'Sesión base',
  timestamp: Date.now(),
  source: 'user',
  confidence: 0.9,
  relevance: 0.5,
  scope: 'session',
  ...overrides,
});

const persistentEntry = (overrides: Partial<PersistentMemoryEntry> = {}): PersistentMemoryEntry => ({
  id: 'persistent-1',
  content: 'Persistente base',
  timestamp: Date.now(),
  source: 'user',
  confidence: 0.9,
  relevance: 0.5,
  scope: 'user',
  tags: ['general'],
  ...overrides,
});

describe('MemoryManager', () => {
  it('agrega y recupera memorias de sesión', () => {
    const manager = crearMemoryManager({ maxSessionEntries: 10, autoExpire: false });
    manager.addSession(sessionEntry({ id: 's1' }));
    manager.addSession(sessionEntry({ id: 's2' }));

    const session = manager.getSession();
    expect(session).toHaveLength(2);
    expect(session.map(entry => entry.id)).toEqual(['s1', 's2']);
  });

  it('agrega y recupera memorias persistentes', () => {
    const manager = crearMemoryManager({ maxPersistentEntries: 10, autoExpire: false });
    manager.addPersistent(persistentEntry({ id: 'p1', scope: 'project' }));
    manager.addPersistent(persistentEntry({ id: 'p2', scope: 'user' }));

    const persistent = manager.getPersistent();
    expect(persistent).toHaveLength(2);
    expect(persistent.map(entry => entry.id)).toEqual(['p1', 'p2']);
  });

  it('filtra memorias persistentes por scope', () => {
    const manager = crearMemoryManager({ maxPersistentEntries: 10, autoExpire: false });
    manager.addPersistent(persistentEntry({ id: 'p1', scope: 'project' }));
    manager.addPersistent(persistentEntry({ id: 'p2', scope: 'user' }));

    expect(manager.getPersistent('project').map(entry => entry.id)).toEqual(['p1']);
    expect(manager.getPersistent('user').map(entry => entry.id)).toEqual(['p2']);
  });

  it('getForContext devuelve sesión y persistentes combinadas', () => {
    const manager = crearMemoryManager({ maxPersistentEntries: 10, autoExpire: false });
    manager.addSession(sessionEntry({ id: 's1' }));
    manager.addPersistent(persistentEntry({ id: 'p1', scope: 'project' }));

    const combined = manager.getForContext('project');
    expect(combined.session).toHaveLength(1);
    expect(combined.persistent).toHaveLength(1);
    expect(combined.session[0].id).toBe('s1');
    expect(combined.persistent[0].id).toBe('p1');
  });

  it('elimina memorias por id', () => {
    const manager = crearMemoryManager({ maxSessionEntries: 10, maxPersistentEntries: 10, autoExpire: false });
    manager.addSession(sessionEntry({ id: 's1' }));
    manager.addPersistent(persistentEntry({ id: 'p1' }));

    manager.removeSession('s1');
    manager.removePersistent('p1');

    expect(manager.getSession()).toHaveLength(0);
    expect(manager.getPersistent()).toHaveLength(0);
  });

  it('limpia memorias', () => {
    const manager = crearMemoryManager({ maxSessionEntries: 10, maxPersistentEntries: 10, autoExpire: false });
    manager.addSession(sessionEntry({ id: 's1' }));
    manager.addPersistent(persistentEntry({ id: 'p1' }));

    manager.clearSession();
    manager.clearPersistent();

    expect(manager.getSession()).toHaveLength(0);
    expect(manager.getPersistent()).toHaveLength(0);
  });

  it('respeta maxSessionEntries eliminando entradas de menor relevancia', () => {
    const manager = crearMemoryManager({ maxSessionEntries: 2, autoExpire: false });
    manager.addSession(sessionEntry({ id: 'baja', relevance: 0.1 }));
    manager.addSession(sessionEntry({ id: 'alta', relevance: 0.9 }));
    manager.addSession(sessionEntry({ id: 'media', relevance: 0.5 }));

    const session = manager.getSession();
    expect(session).toHaveLength(2);
    expect(session.map(entry => entry.id)).toEqual(['alta', 'media']);
  });

  it('expira memorias persistentes según expiration', () => {
    const manager = crearMemoryManager({ maxPersistentEntries: 10, autoExpire: true });
    manager.addPersistent(persistentEntry({ id: 'expirada', expiration: Date.now() - 1000 }));
    manager.addPersistent(persistentEntry({ id: 'vigente', expiration: Date.now() + 10000 }));

    expect(manager.getPersistent().map(entry => entry.id)).toEqual(['vigente']);
  });

  it('no expira memorias cuando autoExpire es false', () => {
    const manager = crearMemoryManager({ maxPersistentEntries: 10, autoExpire: false });
    manager.addPersistent(persistentEntry({ id: 'expirada', expiration: Date.now() - 1000 }));

    expect(manager.getPersistent().map(entry => entry.id)).toEqual(['expirada']);
  });

  it('aplica decay progresivo por antigüedad', () => {
    const manager = crearMemoryManager({ maxSessionEntries: 10, autoExpire: false });
    const antigua = sessionEntry({ id: 'antigua', timestamp: Date.now() - 60 * 1000, confidence: 1 });
    manager.addSession(antigua);

    const [recuperada] = manager.getSession();
    expect(recuperada.confidence).toBeLessThan(1);
  });

  it('decayAll actualiza confianzas almacenadas', () => {
    const manager = crearMemoryManager({ maxSessionEntries: 10, maxPersistentEntries: 10, autoExpire: false });
    manager.addSession(sessionEntry({ id: 's1', confidence: 1, timestamp: Date.now() - 60 * 1000 }));
    manager.addPersistent(persistentEntry({ id: 'p1', confidence: 1, timestamp: Date.now() - 60 * 1000 }));

    manager.decayAll();
    const [sesion] = manager.getSession();
    const [persistente] = manager.getPersistent();

    expect(sesion.confidence).toBeLessThan(1);
    expect(persistente.confidence).toBeLessThan(1);
  });
});
