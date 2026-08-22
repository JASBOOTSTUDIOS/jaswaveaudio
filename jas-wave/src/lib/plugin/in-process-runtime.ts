/**
 * Runtime in-process para plugins de confianza (builtin).
 * ADR-0011 opción C.
 */

import type { PluginRuntime } from './runtime'
import type {
  PluginDescriptor,
  PluginInstanceRef,
  PluginLifecycleState,
  PluginLoadOptions,
} from './types'
import { PluginHostError } from './types'

function newInstanceId(): string {
  return `plugin-instance-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`
}

export class InProcessRuntime implements PluginRuntime {
  readonly isolation = 'in-process' as const
  private instances = new Map<string, PluginInstanceRef>()

  canLoad(descriptor: PluginDescriptor): boolean {
    return (
      descriptor.isolation === 'in-process' &&
      descriptor.hostReady &&
      descriptor.scanStatus === 'ok' &&
      descriptor.format === 'builtin'
    )
  }

  async load(descriptor: PluginDescriptor, options: PluginLoadOptions = {}): Promise<PluginInstanceRef> {
    if (!this.canLoad(descriptor)) {
      throw new PluginHostError(
        'HostNotReady',
        `In-process no puede cargar ${descriptor.pluginId} (${descriptor.format})`,
      )
    }

    const instanceId = newInstanceId()
    const ref: PluginInstanceRef = {
      instanceId,
      pluginId: descriptor.pluginId,
      trackId: options.trackId,
      busId: options.busId,
      position: options.position ?? 0,
      bypass: false,
      lifecycle: 'loading',
      latencySamples: 0,
      isolation: 'in-process',
      stateBlobId: options.stateBlobId,
    }

    try {
      // create → initialize → configure → restore → prepare → commit (síncrono en scaffold)
      ref.lifecycle = 'loaded'
      ref.lifecycle = 'prepared'
      ref.lifecycle = 'active'
      this.instances.set(instanceId, ref)
      return { ...ref }
    } catch (err) {
      this.instances.delete(instanceId)
      throw new PluginHostError(
        'PluginLoadFailed',
        err instanceof Error ? err.message : `Fallo al cargar ${descriptor.pluginId}`,
      )
    }
  }

  async unload(instanceId: string): Promise<void> {
    const inst = this.instances.get(instanceId)
    if (!inst) return
    inst.lifecycle = 'unloading'
    this.instances.delete(instanceId)
  }

  async setBypass(instanceId: string, bypass: boolean): Promise<void> {
    const inst = this.instances.get(instanceId)
    if (!inst) throw new PluginHostError('PluginNotFound', `Instancia ${instanceId} no encontrada`)
    inst.bypass = bypass
    inst.lifecycle = bypass ? 'bypassed' : 'active'
  }

  get(instanceId: string): PluginInstanceRef | undefined {
    return this.instances.get(instanceId)
  }

  setLifecycle(instanceId: string, lifecycle: PluginLifecycleState): void {
    const inst = this.instances.get(instanceId)
    if (inst) inst.lifecycle = lifecycle
  }

  markCrashed(instanceId: string, _reason: string): void {
    const inst = this.instances.get(instanceId)
    if (inst) inst.lifecycle = 'crashed'
  }

  list(): PluginInstanceRef[] {
    return [...this.instances.values()]
  }
}
