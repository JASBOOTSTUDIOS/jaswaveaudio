import type {
  ActionDefinition,
  ActionCategory,
  ActionContext,
  ActionHandler,
  ActionExecuteResult,
} from './types';

export class ActionRegistry {
  private readonly defs = new Map<string, ActionDefinition>();
  private readonly handlers = new Map<string, ActionHandler>();
  private readonly aliasIndex = new Map<string, string>();

  register(def: ActionDefinition, handler?: ActionHandler): void {
    if (!def.id) throw new Error('ActionDefinition.id requerido');
    this.defs.set(def.id, {
      enabled: true,
      visible: true,
      scope: 'whenNotTyping',
      ...def,
    });
    if (handler) this.handlers.set(def.id, handler);
    this.aliasIndex.set(def.id, def.id);
    for (const alias of def.aliases ?? []) {
      this.aliasIndex.set(alias, def.id);
    }
  }

  registerMany(defs: readonly ActionDefinition[]): void {
    for (const d of defs) this.register(d);
  }

  bindHandler(actionId: string, handler: ActionHandler): void {
    const id = this.resolveId(actionId);
    if (!id) throw new Error(`Acción desconocida: ${actionId}`);
    this.handlers.set(id, handler);
  }

  unregister(actionId: string): void {
    const id = this.resolveId(actionId) ?? actionId;
    const def = this.defs.get(id);
    this.defs.delete(id);
    this.handlers.delete(id);
    this.aliasIndex.delete(id);
    if (def?.aliases) {
      for (const a of def.aliases) this.aliasIndex.delete(a);
    }
  }

  resolveId(idOrAlias: string): string | undefined {
    return this.aliasIndex.get(idOrAlias);
  }

  get(idOrAlias: string): ActionDefinition | undefined {
    const id = this.resolveId(idOrAlias);
    return id ? this.defs.get(id) : undefined;
  }

  has(idOrAlias: string): boolean {
    return this.resolveId(idOrAlias) !== undefined;
  }

  list(filter?: {
    category?: ActionCategory;
    context?: ActionContext;
    visibleOnly?: boolean;
  }): ActionDefinition[] {
    let items = Array.from(this.defs.values());
    if (filter?.category) items = items.filter((a) => a.category === filter.category);
    if (filter?.context) items = items.filter((a) => a.context === filter.context);
    if (filter?.visibleOnly !== false) items = items.filter((a) => a.visible !== false);
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Búsqueda ranking: exact id > prefix id/name > substring > alias/category.
   */
  search(query: string, limit = 40): ActionDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list().slice(0, limit);

    type Scored = { def: ActionDefinition; score: number };
    const scored: Scored[] = [];

    for (const def of this.defs.values()) {
      if (def.visible === false || def.enabled === false) continue;
      const id = def.id.toLowerCase();
      const name = def.name.toLowerCase();
      const desc = def.description.toLowerCase();
      const cat = def.category.toLowerCase();
      const aliases = (def.aliases ?? []).map((a) => a.toLowerCase());

      let score = 0;
      if (id === q || name === q) score = 100;
      else if (id.startsWith(q) || name.startsWith(q)) score = 80;
      else if (aliases.some((a) => a === q || a.startsWith(q))) score = 70;
      else if (id.includes(q) || name.includes(q)) score = 50;
      else if (desc.includes(q) || cat.includes(q) || aliases.some((a) => a.includes(q))) score = 30;
      else continue;

      scored.push({ def, score });
    }

    scored.sort((a, b) => b.score - a.score || a.def.name.localeCompare(b.def.name));
    return scored.slice(0, limit).map((s) => s.def);
  }

  execute(idOrAlias: string): ActionExecuteResult {
    const id = this.resolveId(idOrAlias);
    if (!id) return { ok: false, actionId: idOrAlias, error: 'not_found' };
    const def = this.defs.get(id);
    if (!def || def.enabled === false) {
      return { ok: false, actionId: id, error: 'disabled' };
    }
    const handler = this.handlers.get(id);
    if (!handler) return { ok: false, actionId: id, error: 'no_handler' };
    try {
      void handler();
      return { ok: true, actionId: id };
    } catch (err) {
      return {
        ok: false,
        actionId: id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function createActionRegistry(): ActionRegistry {
  return new ActionRegistry();
}
