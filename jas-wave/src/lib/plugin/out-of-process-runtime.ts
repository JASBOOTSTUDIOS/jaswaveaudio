/**
 * Runtime out-of-process para VST3/AU/LV2/CLAP (ADR-0011 opción C).
 *
 * Hoy: contrato + máquina de estados + rechazo honesto (HostNotReady).
 * Mañana: IPC al Plugin Host Process (native/plugin-host) + shared memory
 * preparada fuera del audio thread.
 */

import type { PluginRuntime } from './runtime'
import type {
  PluginDescriptor,
  PluginHostProcessCommand,
  PluginHostProcessReply,
  PluginInstanceRef,
  PluginLifecycleState,
  PluginLoadOptions,
} from './types'
import { PluginHostError } from './types'

function newInstanceId(): string {
  return `plugin-instance-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`
}

/**
 * Canal hacia el proceso hijo. Stub: siempre HostNotReady hasta el binario nativo.
 */
export type PluginHostProcessBridge = {
  isAvailable(): boolean
  send(cmd: PluginHostProcessCommand): Promise<PluginHostProcessReply>
}

export const stubPluginHostProcessBridge: PluginHostProcessBridge = {
  isAvailable: () => false,
  send: async () => ({
    ok: false,
    code: 'HostNotReady',
    message:
      'Plugin Host Process no disponible. En Electron se arranca vía IPC (Node host estable; nativo opcional).',
  }),
}

export class OutOfProcessRuntime implements PluginRuntime {
  readonly isolation = 'out-of-process' as const
  private instances = new Map<string, PluginInstanceRef>()
  private bridge: PluginHostProcessBridge

  constructor(bridge: PluginHostProcessBridge = stubPluginHostProcessBridge) {
    this.bridge = bridge
  }

  setBridge(bridge: PluginHostProcessBridge): void {
    this.bridge = bridge
  }

  getBridge(): PluginHostProcessBridge {
    return this.bridge
  }

  canLoad(descriptor: PluginDescriptor): boolean {
    return (
      descriptor.isolation === 'out-of-process' &&
      descriptor.hostReady &&
      descriptor.scanStatus === 'ok' &&
      this.bridge.isAvailable()
    )
  }

  async load(descriptor: PluginDescriptor, options: PluginLoadOptions = {}): Promise<PluginInstanceRef> {
    if (descriptor.isolation !== 'out-of-process') {
      throw new PluginHostError('PluginIncompatible', `${descriptor.pluginId} no es OOP`)
    }

    if (!this.bridge.isAvailable() || !descriptor.hostReady) {
      throw new PluginHostError(
        'HostNotReady',
        `VST3/terceros requieren Plugin Host Process. ${descriptor.pluginId} no se carga en renderer ni in-process.`,
      )
    }

    const path = descriptor.path
    if (!path) {
      throw new PluginHostError('PluginLoadFailed', `Sin path para ${descriptor.pluginId}`)
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
      isolation: 'out-of-process',
      stateBlobId: options.stateBlobId,
    }
    this.instances.set(instanceId, ref)

    const reply = await this.bridge.send({
      type: 'load',
      pluginId: descriptor.pluginId,
      path,
      sampleRate: options.sampleRate ?? 48000,
      blockSize: options.blockSize ?? 512,
    })

    if (!reply.ok) {
      this.instances.delete(instanceId)
      throw new PluginHostError(reply.code, reply.message)
    }

    ref.hostProcessId = reply.processId
    ref.lifecycle = 'loaded'

    const prep = await this.bridge.send({ type: 'prepare', slotId: reply.slotId ?? instanceId })
    if (!prep.ok) {
      await this.bridge.send({ type: 'unload', slotId: reply.slotId ?? instanceId })
      this.instances.delete(instanceId)
      throw new PluginHostError(prep.code, prep.message)
    }

    ref.latencySamples = prep.latencySamples ?? 0
    ref.lifecycle = 'prepared'
    ref.lifecycle = 'active'
    return { ...ref }
  }

  async unload(instanceId: string): Promise<void> {
    const inst = this.instances.get(instanceId)
    if (!inst) return
    inst.lifecycle = 'unloading'
    if (inst.hostProcessId && this.bridge.isAvailable()) {
      await this.bridge.send({ type: 'unload', slotId: instanceId })
    }
    this.instances.delete(instanceId)
  }

  async setBypass(instanceId: string, bypass: boolean): Promise<void> {
    const inst = this.instances.get(instanceId)
    if (!inst) throw new PluginHostError('PluginNotFound', `Instancia ${instanceId} no encontrada`)
    if (this.bridge.isAvailable()) {
      await this.bridge.send({ type: 'setBypass', slotId: instanceId, bypass })
    }
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

  markCrashed(instanceId: string, reason: string): void {
    const inst = this.instances.get(instanceId)
    if (!inst) return
    inst.lifecycle = 'crashed'
    void this.bridge.send({ type: 'crashReport', slotId: instanceId }).catch(() => {
      /* diagnóstico best-effort */
    })
    void reason
  }

  list(): PluginInstanceRef[] {
    return [...this.instances.values()]
  }

  /** ¿El proceso hijo está listo? */
  isNativeHostAvailable(): boolean {
    return this.bridge.isAvailable()
  }
}
