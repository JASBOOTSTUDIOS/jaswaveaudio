import { normalizeShortcutString } from './keyboard-normalizer';
import type {
  ActionContext,
  ShortcutBinding,
  ShortcutConflict,
  ShortcutConflictKind,
} from './types';
import { CONTEXT_PRIORITY } from './types';

type IndexKey = string; // `${context}::${chord}`

function indexKey(context: ActionContext, chord: string): IndexKey {
  return `${context}::${chord}`;
}

/**
 * ShortcutRegistry — índice O(1) Context+Shortcut → Action.
 * Una acción puede tener múltiples shortcuts.
 */
export class ShortcutRegistry {
  private readonly byAction = new Map<string, ShortcutBinding[]>();
  private readonly byContextChord = new Map<IndexKey, string>(); // → actionId

  clear(): void {
    this.byAction.clear();
    this.byContextChord.clear();
  }

  setBindings(bindings: readonly ShortcutBinding[]): void {
    this.clear();
    for (const b of bindings) this.addBinding(b);
  }

  addBinding(binding: ShortcutBinding): ShortcutConflict | null {
    const chord = normalizeShortcutString(binding.shortcut);
    if (!chord) return null;

    const key = indexKey(binding.context, chord);
    const existing = this.byContextChord.get(key);
    if (existing && existing !== binding.actionId) {
      const kind: ShortcutConflictKind = binding.intentionalShadowing
        ? 'intentional_shadowing'
        : binding.context === 'global'
          ? 'global'
          : 'contextual';
      // No sobrescribir silenciosamente: reportar conflicto y no reemplazar
      return {
        kind,
        shortcut: chord,
        context: binding.context,
        actionIds: [existing, binding.actionId],
      };
    }

    this.byContextChord.set(key, binding.actionId);
    const list = this.byAction.get(binding.actionId) ?? [];
    const next = list.filter(
      (b) => !(b.context === binding.context && normalizeShortcutString(b.shortcut) === chord),
    );
    next.push({ ...binding, shortcut: chord });
    this.byAction.set(binding.actionId, next);
    return null;
  }

  removeBinding(actionId: string, shortcut: string, context?: ActionContext): void {
    const chord = normalizeShortcutString(shortcut);
    const list = this.byAction.get(actionId) ?? [];
    const remaining = list.filter((b) => {
      const match =
        normalizeShortcutString(b.shortcut) === chord &&
        (context === undefined || b.context === context);
      if (match) {
        this.byContextChord.delete(indexKey(b.context, chord));
      }
      return !match;
    });
    this.byAction.set(actionId, remaining);
  }

  removeAllForAction(actionId: string): void {
    const list = this.byAction.get(actionId) ?? [];
    for (const b of list) {
      this.byContextChord.delete(indexKey(b.context, normalizeShortcutString(b.shortcut)));
    }
    this.byAction.delete(actionId);
  }

  getActionId(context: ActionContext, shortcut: string): string | undefined {
    const chord = normalizeShortcutString(shortcut);
    return this.byContextChord.get(indexKey(context, chord));
  }

  getBindingsForAction(actionId: string): ShortcutBinding[] {
    return [...(this.byAction.get(actionId) ?? [])];
  }

  listBindings(): ShortcutBinding[] {
    const out: ShortcutBinding[] = [];
    for (const list of this.byAction.values()) out.push(...list);
    return out;
  }

  /**
   * Detecta conflictos (mismo context+chord → distintas acciones).
   * El índice solo guarda una acción; este método valida el set de bindings crudo.
   */
  static detectConflicts(bindings: readonly ShortcutBinding[]): ShortcutConflict[] {
    const map = new Map<IndexKey, string[]>();
    for (const b of bindings) {
      const chord = normalizeShortcutString(b.shortcut);
      if (!chord) continue;
      const key = indexKey(b.context, chord);
      const arr = map.get(key) ?? [];
      if (!arr.includes(b.actionId)) arr.push(b.actionId);
      map.set(key, arr);
    }
    const conflicts: ShortcutConflict[] = [];
    for (const [key, actionIds] of map) {
      if (actionIds.length < 2) continue;
      const [context, chord] = key.split('::') as [ActionContext, string];
      conflicts.push({
        kind: context === 'global' ? 'global' : 'contextual',
        shortcut: chord,
        context,
        actionIds,
      });
    }
    return conflicts;
  }

  /** Para UI: chord → action en un contexto (sin jerarquía). */
  lookupExact(context: ActionContext, shortcut: string): string | undefined {
    return this.getActionId(context, shortcut);
  }

  /** Contextos en orden de prioridad. */
  static contextChain(active: ActionContext): ActionContext[] {
    const start = CONTEXT_PRIORITY.indexOf(active);
    if (start < 0) return ['global'];
    const chain = CONTEXT_PRIORITY.slice(start);
    if (!chain.includes('global')) chain.push('global');
    return chain;
  }
}

export function createShortcutRegistry(): ShortcutRegistry {
  return new ShortcutRegistry();
}
