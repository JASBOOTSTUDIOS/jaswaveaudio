import { describe, it, expect } from 'vitest';
import {
  normalizeShortcutString,
  normalizeKeyboardEvent,
  createActionSystem,
  ShortcutRegistry,
  buildDefaultKeymap,
  validateKeymap,
  importKeymap,
  exportKeymap,
  isTextInputTarget,
} from '../actions';

describe('KeyboardNormalizer', () => {
  it('normaliza orden de modificadores', () => {
    expect(normalizeShortcutString('Shift+Ctrl+S')).toBe('Ctrl+Shift+S');
    expect(normalizeShortcutString('Ctrl+Shift+S')).toBe('Ctrl+Shift+S');
    expect(normalizeShortcutString('ctrl+shift+s')).toBe('Ctrl+Shift+S');
  });

  it('normaliza Space y teclas especiales', () => {
    expect(normalizeShortcutString('Space')).toBe('Space');
    expect(normalizeKeyboardEvent({
      key: ' ',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    })).toBe('Space');
  });

  it('unifica Meta/Cmd con Ctrl', () => {
    expect(normalizeShortcutString('Cmd+S')).toBe('Ctrl+S');
    expect(normalizeKeyboardEvent({
      key: 's',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: true,
    })).toBe('Ctrl+S');
  });
});

describe('ShortcutResolver / contexts', () => {
  it('prioriza contexto específico sobre global', () => {
    const system = createActionSystem({ initialContext: 'arrangement' });
    system.shortcuts.clear();
    system.shortcuts.addBinding({
      actionId: 'editing.split',
      shortcut: 'S',
      context: 'arrangement',
      intentionalShadowing: true,
    });
    system.shortcuts.addBinding({
      actionId: 'transport.togglePlay',
      shortcut: 'S',
      context: 'global',
    });

    const resolved = system.resolver.resolve('S', 'arrangement');
    expect(resolved?.actionId).toBe('editing.split');
    expect(resolved?.shadowed).toBe(true);

    const global = system.resolver.resolve('S', 'global');
    expect(global?.actionId).toBe('transport.togglePlay');
  });
});

describe('Conflicts', () => {
  it('detecta bindings duplicados en el mismo contexto', () => {
    const conflicts = ShortcutRegistry.detectConflicts([
      { actionId: 'a', shortcut: 'S', context: 'global' },
      { actionId: 'b', shortcut: 'S', context: 'global' },
      { actionId: 'c', shortcut: 'S', context: 'arrangement' },
    ]);
    expect(conflicts.some((c) => c.kind === 'global' && c.actionIds.includes('a'))).toBe(true);
    expect(conflicts.find((c) => c.context === 'arrangement')).toBeUndefined();
  });
});

describe('Keymap', () => {
  it('default keymap incluye Space → transport.togglePlay', () => {
    const km = buildDefaultKeymap();
    const space = km.bindings.find(
      (b) => b.shortcut === 'Space' && b.actionId === 'transport.togglePlay',
    );
    expect(space).toBeTruthy();
  });

  it('export/import roundtrip', () => {
    const km = buildDefaultKeymap();
    const json = exportKeymap(km);
    const imported = importKeymap(json);
    expect(imported.version).toBe(1);
    expect(imported.bindings.length).toBe(km.bindings.length);
  });

  it('validateKeymap no rompe con defaults', () => {
    const conflicts = validateKeymap(buildDefaultKeymap());
    // Puede haber conflictos intencionales; no debe lanzar
    expect(Array.isArray(conflicts)).toBe(true);
  });
});

describe('ActionRegistry search', () => {
  it('encuentra por id, nombre y alias', () => {
    const system = createActionSystem();
    const byId = system.actions.search('transport.togglePlay');
    expect(byId[0]?.id).toBe('transport.togglePlay');

    const byAlias = system.actions.search('transporte.reproducir');
    expect(byAlias.some((a) => a.id === 'transport.togglePlay')).toBe(true);

    const byName = system.actions.search('reproducir');
    expect(byName.length).toBeGreaterThan(0);
  });

  it('execute sin handler falla sin mutar', () => {
    const system = createActionSystem();
    const result = system.actions.execute('transport.togglePlay');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_handler');
  });

  it('execute con handler funciona', () => {
    const system = createActionSystem();
    let called = false;
    system.bindHandler('transport.togglePlay', () => {
      called = true;
    });
    expect(system.actions.execute('transport.togglePlay').ok).toBe(true);
    expect(called).toBe(true);
  });
});

describe('Text input scope', () => {
  it('trata null como no-input', () => {
    expect(isTextInputTarget(null)).toBe(false);
  });

  it('no despacha Space con foco en input', () => {
    const system = createActionSystem();
    let called = false;
    system.bindHandler('transport.togglePlay', () => {
      called = true;
    });
    const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null } as unknown as HTMLElement;
    const handled = system.handleKeyboardEvent({
      target: input,
      key: ' ',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as KeyboardEvent);
    expect(handled).toBe(false);
    expect(called).toBe(false);
  });

  it('respeta data-shortcut-scope=ignore en ancestros', () => {
    const panel = { tagName: 'DIV', isContentEditable: false, closest: () => null };
    const input = {
      tagName: 'INPUT',
      isContentEditable: false,
      closest: (sel: string) => (sel === '[data-shortcut-scope="ignore"]' ? panel : null),
    } as unknown as HTMLElement;
    expect(isTextInputTarget(input)).toBe(true);
  });
});
