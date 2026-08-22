/**
 * PluginManager — orquesta registry + runtimes híbridos (ADR-0011 C).
 *
 * UI / Command System → PluginManager → InProcess | OutOfProcess
 * Nunca: React → DLL VST3.
 */

import { pluginCompatibilityDb } from './compatibility-db'
import { discoverVst3Plugins, type DiscoverResult } from './discovery'
import { createFakePluginDescriptor, createSoftPadDescriptor } from './fake-plugin'
import { InProcessRuntime } from './in-process-runtime'
import {
  OutOfProcessRuntime,
  stubPluginHostProcessBridge,
  type PluginHostProcessBridge,
} from './out-of-process-runtime'
import { pluginRegistry } from './registry'
import { pluginSearchPaths } from './search-paths'
import type {
  PluginDescriptor,
  PluginInstanceRef,
  PluginLifecycleState,
  PluginLoadOptions,
} from './types'
import { PluginHostError } from './types'

export class PluginManager {
  readonly inProcess = new InProcessRuntime()
  readonly outOfProcess: OutOfProcessRuntime

  constructor(bridge: PluginHostProcessBridge = stubPluginHostProcessBridge) {
    this.outOfProcess = new OutOfProcessRuntime(bridge)
    this.ensureBuiltins()
  }

  /** Conecta el bridge Electron (IPC → proceso hijo). */
  attachHostBridge(bridge: PluginHostProcessBridge): void {
    this.outOfProcess.setBridge(bridge)
  }

  ensureBuiltins(): void {
    if (!pluginRegistry.findById('jaswave.softpad')) {
      pluginRegistry.register(createSoftPadDescriptor())
    }
    if (!pluginRegistry.findById(createFakePluginDescriptor().pluginId)) {
      pluginRegistry.register(createFakePluginDescriptor())
    }
  }

  listAvailable(): PluginDescriptor[] {
    this.ensureBuiltins()
    return pluginRegistry.list()
  }

  /**
   * Discovery real vía Plugin Host Process (FS). No carga DLL.
   */
  async discoverVst3(paths?: string[]): Promise<DiscoverResult> {
    this.ensureBuiltins()
    const bridge = this.outOfProcess.getBridge()
    if (!bridge.isAvailable()) {
      return {
        discovered: [],
        registered: 0,
        error: 'Plugin Host Process no disponible. Abre JasWave en Electron.',
      }
    }
    return discoverVst3Plugins(async (cmd) => {
      const reply = await bridge.send(cmd)
      if (!reply.ok) {
        return { ok: false, message: reply.message }
      }
      return {
        ok: true,
        processId: reply.processId,
        plugins: reply.plugins,
      }
    }, paths)
  }

  /**
   * Si el host no responde, devuelve placeholders de rutas configuradas.
   */
  async scanVst3CandidatePaths(paths?: string[]): Promise<PluginDescriptor[]> {
    const discovered = await this.discoverVst3(paths)
    if (discovered.discovered.length > 0) return discovered.discovered

    const fromConfig = pluginSearchPaths.enabledPaths().map((p) => p.path)
    const list = paths?.length ? paths : fromConfig
    const { isolationForFormat } = await import('./isolation-policy')
    return list.slice(0, 8).map((path, i) => ({
      pluginId: `vst3.pending.${i}`,
      format: 'vst3' as const,
      vendor: '—',
      name: 'VST3 (ruta configurada · sin escaneo)',
      version: '0',
      path,
      category: 'unknown',
      isInstrument: false,
      isEffect: true,
      supportsMidiInput: false,
      supportsMidiOutput: false,
      supportsAudioInput: true,
      supportsAudioOutput: true,
      supportsSidechain: false,
      supportsEditor: true,
      parameterCount: 0,
      scanStatus: 'pending' as const,
      hostReady: false,
      isolation: isolationForFormat('vst3'),
      scanError:
        discovered.error ||
        'Host process no descubrió plugins. Compila native/plugin-host o usa node-host.cjs.',
    }))
  }

  isNativeVst3Ready(): boolean {
    return this.outOfProcess.isNativeHostAvailable()
  }

  async load(pluginId: string, options: PluginLoadOptions = {}): Promise<PluginInstanceRef> {
    this.ensureBuiltins()
    const desc = pluginRegistry.findById(pluginId)
    if (!desc) throw new PluginHostError('PluginNotFound', `Plugin no registrado: ${pluginId}`)

    if (pluginCompatibilityDb.isDisabled(pluginId, desc.version)) {
      const entry = pluginCompatibilityDb.get(pluginId)
      throw new PluginHostError(
        'Blacklisted',
        `Plugin deshabilitado: ${pluginId}${entry?.reason ? ` (${entry.reason})` : ''}`,
      )
    }

    if (desc.scanStatus === 'blacklisted') {
      throw new PluginHostError('Blacklisted', `Scan blacklisted: ${pluginId}`)
    }

    const runtime = desc.isolation === 'in-process' ? this.inProcess : this.outOfProcess
    return runtime.load(desc, options)
  }

  async instantiate(
    pluginId: string,
    trackId: string,
    position = 0,
  ): Promise<PluginInstanceRef> {
    return this.load(pluginId, { trackId, position })
  }

  async unload(instanceId: string): Promise<void> {
    const inst = this.get(instanceId)
    if (!inst) return
    const runtime = inst.isolation === 'in-process' ? this.inProcess : this.outOfProcess
    await runtime.unload(instanceId)
  }

  async setBypass(instanceId: string, bypass: boolean): Promise<void> {
    const inst = this.get(instanceId)
    if (!inst) throw new PluginHostError('PluginNotFound', `Instancia ${instanceId}`)
    const runtime = inst.isolation === 'in-process' ? this.inProcess : this.outOfProcess
    await runtime.setBypass(instanceId, bypass)
  }

  get(instanceId: string): PluginInstanceRef | undefined {
    return this.inProcess.get(instanceId) ?? this.outOfProcess.get(instanceId)
  }

  setLifecycle(instanceId: string, lifecycle: PluginLifecycleState): void {
    if (this.inProcess.get(instanceId)) this.inProcess.setLifecycle(instanceId, lifecycle)
    else this.outOfProcess.setLifecycle(instanceId, lifecycle)
  }

  handleCrash(instanceId: string, reason: string): void {
    const inst = this.get(instanceId)
    if (!inst) return
    const runtime = inst.isolation === 'in-process' ? this.inProcess : this.outOfProcess
    runtime.markCrashed(instanceId, reason)
    const desc = pluginRegistry.findById(inst.pluginId)
    pluginCompatibilityDb.recordCrash(inst.pluginId, desc?.version, reason)
  }

  listInstances(): PluginInstanceRef[] {
    return [...this.inProcess.list(), ...this.outOfProcess.list()]
  }
}

export const pluginManager = new PluginManager()
