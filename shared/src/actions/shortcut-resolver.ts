import type { ActionContext, ResolvedAction } from './types';
import { ShortcutRegistry } from './shortcut-registry';
import { normalizeKeyboardEvent, normalizeShortcutString } from './keyboard-normalizer';

export interface ShortcutResolverOptions {
  shortcuts: ShortcutRegistry;
  getActiveContext: () => ActionContext;
}

/**
 * ShortcutResolver — Keyboard → Context → Shortcut → Action (sin ejecutar dominio).
 */
export class ShortcutResolver {
  constructor(private readonly opts: ShortcutResolverOptions) {}

  resolveFromEvent(e: {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  }): ResolvedAction | null {
    const chord = normalizeKeyboardEvent(e);
    if (!chord) return null;
    return this.resolve(chord, this.opts.getActiveContext());
  }

  resolve(shortcut: string, activeContext: ActionContext): ResolvedAction | null {
    const chord = normalizeShortcutString(shortcut);
    if (!chord) return null;

    const chain = ShortcutRegistry.contextChain(activeContext);
    for (let i = 0; i < chain.length; i++) {
      const ctx = chain[i];
      const actionId = this.opts.shortcuts.getActionId(ctx, chord);
      if (actionId) {
        const hasDeeperGlobal =
          ctx !== 'global' &&
          this.opts.shortcuts.getActionId('global', chord) !== undefined;
        return {
          actionId,
          shortcut: chord,
          context: ctx,
          shadowed: hasDeeperGlobal || i > 0,
        };
      }
    }
    return null;
  }
}

export function createShortcutResolver(opts: ShortcutResolverOptions): ShortcutResolver {
  return new ShortcutResolver(opts);
}
