/**
 * Tests de permisos del DAW.
 */

import { describe, it, expect } from 'vitest';
import { crearPermissionManager, permissionManager } from '../state/permissions';
import type { ToolDefinition } from '../types/command';

const tool = (risk: ToolDefinition['risk'], overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  type: 'track.volume.set',
  category: 'track',
  description: 'Set volume',
  risk,
  ...overrides,
});

describe('PermissionManager', () => {
  it('READ_ONLY bloquea write y dangerous', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'READ_ONLY', overrides: [], allowUnsafeTools: false }, 'user');

    expect(manager.check(tool('read'), 'ai').allowed).toBe(true);
    expect(manager.check(tool('write'), 'ai').allowed).toBe(false);
    expect(manager.check(tool('dangerous'), 'ai').allowed).toBe(false);
  });

  it('SUGGEST no ejecuta write ni dangerous', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'SUGGEST', overrides: [], allowUnsafeTools: false }, 'user');

    expect(manager.check(tool('read'), 'ai').allowed).toBe(true);
    expect(manager.check(tool('write'), 'ai').allowed).toBe(false);
    expect(manager.check(tool('dangerous'), 'ai').allowed).toBe(false);
  });

  it('CONFIRM ejecuta write y dangerous con confirmación', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'CONFIRM', overrides: [], allowUnsafeTools: false }, 'user');

    const write = manager.check(tool('write'), 'ai');
    expect(write.allowed).toBe(true);
    expect(write.requiresConfirmation).toBe(true);

    const dangerous = manager.check(tool('dangerous'), 'ai');
    expect(dangerous.allowed).toBe(true);
    expect(dangerous.requiresConfirmation).toBe(true);
  });

  it('AUTO_EXECUTE_SAFE ejecuta write sin confirmación y dangerous con confirmación', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'AUTO_EXECUTE_SAFE', overrides: [], allowUnsafeTools: false }, 'user');

    const write = manager.check(tool('write'), 'ai');
    expect(write.allowed).toBe(true);
    expect(write.requiresConfirmation).toBe(false);

    const dangerous = manager.check(tool('dangerous'), 'ai');
    expect(dangerous.allowed).toBe(true);
    expect(dangerous.requiresConfirmation).toBe(true);
  });

  it('FULL_AUTONOMY ejecuta todo sin confirmación', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'FULL_AUTONOMY', overrides: [], allowUnsafeTools: false }, 'user');

    const read = manager.check(tool('read'), 'ai');
    const write = manager.check(tool('write'), 'ai');
    const dangerous = manager.check(tool('dangerous'), 'ai');
    expect(read.requiresConfirmation).toBe(false);
    expect(write.requiresConfirmation).toBe(false);
    expect(dangerous.requiresConfirmation).toBe(false);
  });

  it('override por herramienta tiene precedencia', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({
      level: 'READ_ONLY',
      overrides: [{ toolName: 'track.volume.set', allowed: true, requireConfirmation: false }],
      allowUnsafeTools: false,
    }, 'user');

    const result = manager.check(tool('write'), 'ai');
    expect(result.allowed).toBe(true);
    expect(result.overrideUsed).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('emergency stop pone en READ_ONLY instantáneamente', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'FULL_AUTONOMY', overrides: [], allowUnsafeTools: false }, 'user');

    const stop = manager.createEmergencyStop();
    expect(stop.isActive()).toBe(false);

    stop.trigger();
    expect(stop.isActive()).toBe(true);

    const write = manager.check(tool('write'), 'ai');
    expect(write.allowed).toBe(false);
    expect(manager.getUserConfig().level).toBe('READ_ONLY');
  });

  it('audit log registra todas las comprobaciones', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'CONFIRM', overrides: [], allowUnsafeTools: false }, 'user');

    manager.check(tool('read'), 'user');
    manager.check(tool('write'), 'ai');

    const log = manager.getLog();
    expect(log).toHaveLength(2);
    expect(log[0].toolName).toBe('track.volume.set');
    expect(log[0].source).toBe('user');
    expect(log[1].source).toBe('ai');
  });

  it('IA no puede cambiar nivel de autonomía sin confirmación', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'CONFIRM', overrides: [], allowUnsafeTools: false }, 'user');

    const cambiado = manager.requestLevelChange('FULL_AUTONOMY');
    expect(cambiado).toBe(false);
    expect(manager.getUserConfig().level).toBe('CONFIRM');
  });

  it('scope aplica nivel temporalmente', () => {
    const manager = crearPermissionManager();
    manager.setUserConfig({ level: 'READ_ONLY', overrides: [], allowUnsafeTools: false }, 'user');
    manager.setScope({ level: 'AUTO_EXECUTE_SAFE', appliesTo: ['session'], expiresAt: Date.now() + 1000 });

    const write = manager.check(tool('write'), 'ai');
    expect(write.allowed).toBe(true);
  });

  it('singleton permissionManager funciona', () => {
    permissionManager.setUserConfig({ level: 'CONFIRM', overrides: [], allowUnsafeTools: false }, 'user');
    expect(permissionManager.check(tool('read'), 'ai').allowed).toBe(true);
  });
});
