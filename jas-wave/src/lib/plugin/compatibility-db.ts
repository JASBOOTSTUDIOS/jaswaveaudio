/**
 * Base de compatibilidad / blacklist (ADR-0011 §37).
 */

export type CompatibilityEntry = {
  pluginId: string
  version?: string
  status: 'ok' | 'disabled' | 'warn'
  reason?: string
  date: number
  crashCount: number
}

export class PluginCompatibilityDatabase {
  private byId = new Map<string, CompatibilityEntry>()

  isDisabled(pluginId: string, version?: string): boolean {
    const e = this.byId.get(pluginId)
    if (!e) return false
    if (e.status !== 'disabled') return false
    if (version && e.version && e.version !== version) return false
    return true
  }

  recordCrash(pluginId: string, version?: string, reason?: string): CompatibilityEntry {
    const prev = this.byId.get(pluginId)
    const crashCount = (prev?.crashCount ?? 0) + 1
    const entry: CompatibilityEntry = {
      pluginId,
      version: version ?? prev?.version,
      status: crashCount >= 3 ? 'disabled' : 'warn',
      reason: reason ?? prev?.reason ?? 'crash',
      date: Date.now(),
      crashCount,
    }
    this.byId.set(pluginId, entry)
    return entry
  }

  disable(pluginId: string, reason: string, version?: string): void {
    this.byId.set(pluginId, {
      pluginId,
      version,
      status: 'disabled',
      reason,
      date: Date.now(),
      crashCount: this.byId.get(pluginId)?.crashCount ?? 0,
    })
  }

  get(pluginId: string): CompatibilityEntry | undefined {
    return this.byId.get(pluginId)
  }

  list(): CompatibilityEntry[] {
    return [...this.byId.values()]
  }

  clear(): void {
    this.byId.clear()
  }
}

export const pluginCompatibilityDb = new PluginCompatibilityDatabase()
