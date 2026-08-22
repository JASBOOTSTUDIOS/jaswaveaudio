/**
 * Runtime abstracto — in-process u out-of-process.
 * El audio thread no llama a load/unload.
 */

import type {
  PluginDescriptor,
  PluginInstanceRef,
  PluginIsolationMode,
  PluginLifecycleState,
  PluginLoadOptions,
} from './types'

export interface PluginRuntime {
  readonly isolation: PluginIsolationMode
  canLoad(descriptor: PluginDescriptor): boolean
  load(descriptor: PluginDescriptor, options?: PluginLoadOptions): Promise<PluginInstanceRef>
  unload(instanceId: string): Promise<void>
  setBypass(instanceId: string, bypass: boolean): Promise<void>
  get(instanceId: string): PluginInstanceRef | undefined
  setLifecycle(instanceId: string, lifecycle: PluginLifecycleState): void
  markCrashed(instanceId: string, reason: string): void
  list(): PluginInstanceRef[]
}
