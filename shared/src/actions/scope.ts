import type { ActionDefinition, ActionContext, ShortcutScope } from './types';

/**
 * Política de alcance: no secuestrar escritura en inputs.
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"]')) return true;
  if (target.closest('[data-shortcut-scope="ignore"]')) return true;
  return false;
}

export function shouldHandleShortcut(
  scope: ShortcutScope | undefined,
  target: EventTarget | null,
  opts?: { modalOpen?: boolean },
): boolean {
  const effective = scope ?? 'whenNotTyping';
  if (effective === 'always') return true;
  if (effective === 'whenNotModal' && opts?.modalOpen) return false;
  if (effective === 'whenNotTyping' || effective === 'whenNotModal') {
    if (isTextInputTarget(target)) return false;
  }
  return true;
}

export function actionAllowsEvent(def: ActionDefinition | undefined, target: EventTarget | null): boolean {
  if (!def) return false;
  return shouldHandleShortcut(def.scope, target);
}

/** Contexto activo por defecto; la UI puede actualizarlo. */
export function createContextState(initial: ActionContext = 'arrangement') {
  let current: ActionContext = initial;
  return {
    get: () => current,
    set: (ctx: ActionContext) => {
      current = ctx;
    },
  };
}
