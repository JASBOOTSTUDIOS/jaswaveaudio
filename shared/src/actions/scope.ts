import type { ActionDefinition, ActionContext, ShortcutScope } from './types';

/**
 * Política de alcance: no secuestrar escritura en inputs.
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (typeof tag !== 'string') return false;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function') {
    if (el.closest('[contenteditable="true"]')) return true;
    if (el.closest('[data-shortcut-scope="ignore"]')) return true;
    if (el.closest('[role="textbox"]')) return true;
  }
  return false;
}

/** Hay texto seleccionado en la página (chat, docs, etc.). */
export function hasNonEmptyTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection?.();
  return Boolean(sel && !sel.isCollapsed && sel.toString().length > 0);
}

function isNativeClipboardShortcut(e: KeyboardEvent): boolean {
  if (!e.ctrlKey && !e.metaKey) return false;
  const k = e.key.toLowerCase();
  return k === 'c' || k === 'x' || k === 'a' || k === 'v';
}

function isInsideShortcutIgnoreZone(el: HTMLElement | null): boolean {
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(
    el.closest('[data-shortcut-scope="ignore"]') ||
      el.closest('[data-coproducer-chat]') ||
      el.closest('[data-chat-selectable]'),
  );
}

/** Selección de texto dentro de chat/docs/inputs (no cualquier texto residual en la UI). */
export function textSelectionIsInEditableOrChat(): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.toString().length) return false;
  const node = sel.anchorNode;
  const el =
    node instanceof HTMLElement ? node : node?.parentElement instanceof HTMLElement ? node.parentElement : null;
  if (!el) return false;
  return isTextInputTarget(el) || isInsideShortcutIgnoreZone(el);
}

/** No ejecutar atajos globales del DAW mientras el usuario escribe en inputs/chat. */
export function shouldIgnoreGlobalShortcuts(target?: EventTarget | null): boolean {
  if (isTextInputTarget(target ?? null)) return true;
  if (typeof document !== 'undefined' && isTextInputTarget(document.activeElement)) {
    return true;
  }
  if (target && typeof target === 'object') {
    if (isInsideShortcutIgnoreZone(target as HTMLElement)) return true;
  }
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    if (isInsideShortcutIgnoreZone(document.activeElement)) return true;
  }
  return false;
}

export { isNativeClipboardShortcut };

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
