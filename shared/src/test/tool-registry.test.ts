/**
 * Tests del Tool Registry.
 */

import { describe, it, expect, vi } from 'vitest';
import { crearToolRegistry, toolRegistry } from '../ai/tool-registry';
import type { ToolDefinitionExtended, ToolHandler, ToolFilter } from '../ai/tool-registry';
import type { DAWState } from '../types/state';
import type { DAWQuery } from '../types/query';
import type { EventoDominio } from '../events/evento-dominio';
import type { CommandResult } from '../types/command';

const toolDef = (overrides: Partial<ToolDefinitionExtended> = {}): ToolDefinitionExtended => ({
  name: 'project.getState',
  type: 'project.getState',
  description: 'Obtiene el estado del proyecto',
  category: 'system',
  risk: 'read',
  version: '1.0.0',
  parameters: [
    { name: 'projectId', type: 'string', description: 'ID del proyecto', required: true },
  ],
  returns: { type: 'object', description: 'Estado del proyecto' },
  ...overrides,
});

const handler = async (_params: unknown, _ctx: unknown): Promise<{ success: boolean; events: EventoDominio[] }> => ({
  success: true,
  events: [],
});

describe('ToolRegistry', () => {
  it('register hace la tool disponible en list y get', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef(), handler);

    expect(registry.get('project.getState')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });

  it('unregister elimina la tool', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef(), handler);
    registry.unregister('project.getState');

    expect(registry.get('project.getState')).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it('generatePromptFragment incluye todas las tools', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef(), handler);
    registry.register(toolDef({ name: 'track.volume.set', description: 'Set volume', risk: 'write' }), handler);

    const fragment = registry.generatePromptFragment();
    expect(fragment).toContain('project.getState');
    expect(fragment).toContain('track.volume.set');
    expect(fragment).toContain('(read)');
    expect(fragment).toContain('(write)');
  });

  it('search encuentra tools por nombre, descripción o tags', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef({ tags: ['project'] }), handler);
    registry.register(toolDef({ name: 'track.volume.set', description: 'Set track volume', tags: ['track'] }), handler);

    expect(registry.search('project')).toHaveLength(1);
    expect(registry.search('volume')).toHaveLength(1);
    expect(registry.search('track')).toHaveLength(1);
  });

  it('list filtra por category, risk y tags', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef({ category: 'system', risk: 'read', tags: ['a'] }), handler);
    registry.register(toolDef({ name: 'track.volume.set', category: 'track', risk: 'write', tags: ['b'] }), handler);

    const porCategoria = registry.list({ category: 'track' });
    expect(porCategoria).toHaveLength(1);
    expect(porCategoria[0].name).toBe('track.volume.set');

    const porRiesgo = registry.list({ risk: 'read' });
    expect(porRiesgo).toHaveLength(1);

    const porTags = registry.list({ tags: ['a'] });
    expect(porTags).toHaveLength(1);

    const combinado = registry.list({ category: 'track', risk: 'write', tags: ['b'] });
    expect(combinado).toHaveLength(1);
  });

  it('onChange notifica a los listeners cuando se registra o elimina una tool', () => {
    const registry = crearToolRegistry();
    const listener = vi.fn();
    registry.onChange(listener);

    registry.register(toolDef(), handler);
    expect(listener).toHaveBeenCalledTimes(1);

    registry.unregister('project.getState');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('getHealth reporta el estado del registro', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef(), handler);

    const health = registry.getHealth();
    expect(health.registeredCount).toBe(1);
    expect(health.brokenHandlers).toEqual([]);
    expect(health.lastUpdated).toBeGreaterThan(0);
  });

  it('tool con versión antigua es aceptada pero conserva su versión', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef({ version: '0.9.0' }), handler);

    const tool = registry.get('project.getState');
    expect(tool?.version).toBe('0.9.0');
  });

  it('herramienta deprecated aparece marcada en prompt fragment', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef({ deprecated: true, deprecationMessage: 'use project.state.get' }), handler);

    const fragment = registry.generatePromptFragment();
    expect(fragment).toContain('deprecated');
    expect(fragment).toContain('use project.state.get');
  });

  it('idempotent flag se respeta', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef({ idempotent: true }), handler);

    const tool = registry.get('project.getState');
    expect(tool?.idempotent).toBe(true);
  });

  it('generateCapabilities devuelve capabilities de todas las tools', () => {
    const registry = crearToolRegistry();
    registry.register(toolDef(), handler);
    registry.register(toolDef({ name: 'track.volume.set' }), handler);

    const capabilities = registry.generateCapabilities();
    expect(capabilities).toHaveLength(2);
    expect(capabilities[0].name).toBe('project.getState');
  });

  it('singleton toolRegistry funciona como instancia global', () => {
    toolRegistry.register(toolDef({ name: 'singleton.tool' }), handler);
    expect(toolRegistry.get('singleton.tool')).toBeDefined();
    toolRegistry.unregister('singleton.tool');
  });
});
