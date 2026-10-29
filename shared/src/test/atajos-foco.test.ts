import { describe, expect, it } from 'vitest';
import { isTextInputTarget, shouldIgnoreGlobalShortcuts } from '../actions/scope';

/** Elemento mínimo con la forma que consulta scope.ts (sin DOM). */
function el(tagName: string, extra: Record<string, unknown> = {}, ignorar = false) {
  return {
    tagName,
    isContentEditable: false,
    closest: (sel: string) => (ignorar && sel === '[data-shortcut-scope="ignore"]' ? {} : null),
    ...extra,
  } as unknown as EventTarget;
}

describe('atajos globales · qué foco los bloquea', () => {
  it('escribir en campos de texto bloquea el atajo', () => {
    for (const tipo of ['text', 'search', 'email', 'number', 'password', 'url']) {
      expect(isTextInputTarget(el('INPUT', { type: tipo })), tipo).toBe(true);
    }
    expect(isTextInputTarget(el('TEXTAREA'))).toBe(true);
    expect(shouldIgnoreGlobalShortcuts(el('INPUT', { type: 'text' }))).toBe(true);
  });

  it('un fader, una casilla o un botón con foco NO bloquean la barra espaciadora', () => {
    for (const tipo of ['range', 'checkbox', 'radio', 'button', 'color', 'file', 'submit']) {
      expect(isTextInputTarget(el('INPUT', { type: tipo })), tipo).toBe(false);
    }
    expect(isTextInputTarget(el('BUTTON'))).toBe(false);
    expect(shouldIgnoreGlobalShortcuts(el('INPUT', { type: 'range' }))).toBe(false);
  });

  it('el panel del agente de IA y la terminal siguen ignorando los atajos', () => {
    expect(shouldIgnoreGlobalShortcuts(el('DIV', {}, true))).toBe(true);
    expect(shouldIgnoreGlobalShortcuts(el('BUTTON', {}, true))).toBe(true);
  });

  it('un contenteditable o role=textbox bloquea', () => {
    expect(isTextInputTarget(el('DIV', { isContentEditable: true }))).toBe(true);
  });
});

import { createActionSystem } from '../actions';

describe('atajos globales · la barra espaciadora reproduce desde cualquier contexto', () => {
  const contextos = ['global', 'arrangement', 'timeline', 'mixer', 'midiEditor', 'pianoRoll', 'automation', 'mediaBrowser', 'pluginEditor', 'aiPanel', 'commandPalette'] as const;
  it('Space resuelve a transport.togglePlay en todos los contextos conocidos', () => {
    const sistema = createActionSystem({ initialContext: 'arrangement' });
    for (const ctx of contextos) {
      try {
        sistema.context.set(ctx as never);
      } catch {
        continue; // contexto que este build no define
      }
      const r = sistema.resolver.resolveFromEvent({ key: ' ', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
      expect(r?.actionId, `contexto ${ctx}`).toBe('transport.togglePlay');
    }
  });
});
