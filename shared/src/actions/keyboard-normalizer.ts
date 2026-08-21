/**
 * KeyboardNormalizer — convierte KeyboardEvent / strings sueltas
 * a una representación canónica estable (independiente del orden de modificadores).
 */

import type { NormalizedShortcut } from './types';

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  Ins: 'Insert',
  Return: 'Enter',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Add: 'NumpadAdd',
  Subtract: 'NumpadSubtract',
  Control: 'Ctrl',
  Cmd: 'Meta',
  Command: 'Meta',
  Option: 'Alt',
  '+': 'Equal',
  '=': 'Equal',
  '-': 'Minus',
  _: 'Minus',
};

function isModifierKeyName(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'control' || k === 'ctrl' || k === 'alt' || k === 'shift' || k === 'meta' || k === 'cmd' || k === 'command' || k === 'option';
}

export function normalizeKeyName(raw: string): string {
  if (raw === ' ' || raw === 'Spacebar' || raw === 'Space') return 'Space';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (KEY_ALIASES[trimmed]) return KEY_ALIASES[trimmed];
  if (trimmed.length === 1) {
    // Digits / letters
    return trimmed.toUpperCase();
  }
  // F-keys, Arrow*, Numpad*, etc.
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^arrow/i.test(trimmed)) {
    return `Arrow${trimmed.slice(5, 6).toUpperCase()}${trimmed.slice(6).toLowerCase()}`;
  }
  if (/^numpad/i.test(trimmed)) {
    return `Numpad${trimmed.slice(6, 7).toUpperCase()}${trimmed.slice(7)}`;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Normaliza una cadena de combo (cualquier orden de mods) a forma canónica.
 * Ej: "Shift+Ctrl+s" → "Ctrl+Shift+S"
 */
export function normalizeShortcutString(input: string): string {
  if (!input || !input.trim()) return '';
  const parts = input.split('+').map((p) => p.trim()).filter(Boolean);
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let key = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') ctrl = true;
    else if (lower === 'alt' || lower === 'option') alt = true;
    else if (lower === 'shift') shift = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') {
      // Unificamos Cmd/Meta con Ctrl en atajos DAW cross-platform (como el resto del proyecto).
      ctrl = true;
    } else if (!isModifierKeyName(part)) {
      key = normalizeKeyName(part);
    }
  }

  const mods: string[] = [];
  if (ctrl) mods.push('Ctrl');
  if (alt) mods.push('Alt');
  if (shift) mods.push('Shift');
  // Meta se fusiona a Ctrl arriba; no añadimos Meta aparte para evitar duplicados

  if (!key) return mods.join('+');
  return [...mods, key].join('+');
}

export function parseNormalizedShortcut(chord: string): NormalizedShortcut {
  const normalized = normalizeShortcutString(chord);
  const parts = normalized.split('+').filter(Boolean);
  const key = parts[parts.length - 1] ?? '';
  return {
    chord: normalized,
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
    meta: parts.includes('Meta'),
    key: isModifierKeyName(key) ? '' : key,
  };
}

/**
 * Convierte un KeyboardEvent nativo a chord canónico.
 */
export function normalizeKeyboardEvent(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string {
  if (isModifierKeyName(e.key)) {
    const mods: string[] = [];
    if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    return mods.join('+');
  }

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normalizeKeyName(e.key));
  return normalizeShortcutString(parts.join('+'));
}

export function shortcutsEqual(a: string, b: string): boolean {
  return normalizeShortcutString(a) === normalizeShortcutString(b);
}

export { MOD_ORDER };
