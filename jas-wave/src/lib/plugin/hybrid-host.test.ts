/**
 * Tests del host híbrido (ADR-0011 C) — Node test runner.
 * Ejecutar: npx tsx --test src/lib/plugin/hybrid-host.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PluginCompatibilityDatabase } from './compatibility-db'
import { createFakePluginDescriptor, createSoftPadDescriptor, FAKE_PLUGIN_ID } from './fake-plugin'
import { InProcessRuntime } from './in-process-runtime'
import { isolationForFormat } from './isolation-policy'
import { OutOfProcessRuntime, type PluginHostProcessBridge } from './out-of-process-runtime'
import { PluginManager } from './plugin-manager'
import { pluginRegistry } from './registry'
import { PluginHostError } from './types'
import { descriptorToPluginInfo } from './plugin-info-adapter'

describe('isolation policy', () => {
  it('builtin → in-process', () => {
    assert.equal(isolationForFormat('builtin'), 'in-process')
  })
  it('vst3 → out-of-process', () => {
    assert.equal(isolationForFormat('vst3'), 'out-of-process')
  })
})

describe('descriptorToPluginInfo (no-engaño)', () => {
  it('no marca VST3 como cargado al insertar', () => {
    const info = descriptorToPluginInfo({
      pluginId: 'vendor.piano',
      format: 'vst3',
      vendor: 'Vendor',
      name: 'Piano',
      version: '1',
      path: 'C:/VST3/Piano.vst3',
      category: 'instrumento',
      isInstrument: true,
      isEffect: false,
      supportsMidiInput: true,
      supportsMidiOutput: false,
      supportsAudioInput: false,
      supportsAudioOutput: true,
      supportsSidechain: false,
      supportsEditor: true,
      parameterCount: 0,
      scanStatus: 'ok',
      hostReady: true,
      isolation: 'out-of-process',
    })
    assert.equal(info.estado, 'pendiente')
  })

  it('builtin listo sí es cargado', () => {
    const info = descriptorToPluginInfo(createSoftPadDescriptor())
    assert.equal(info.estado, 'cargado')
  })
})

describe('InProcessRuntime', () => {
  it('loads Soft Pad', async () => {
    const rt = new InProcessRuntime()
    const soft = createSoftPadDescriptor()
    const inst = await rt.load(soft, { trackId: 't1', position: 0 })
    assert.equal(inst.lifecycle, 'active')
    assert.equal(inst.isolation, 'in-process')
    assert.equal(inst.pluginId, 'jaswave.softpad')
  })

  it('loads Fake Gain', async () => {
    const rt = new InProcessRuntime()
    const fake = createFakePluginDescriptor()
    const inst = await rt.load(fake, { trackId: 't1' })
    assert.equal(inst.pluginId, FAKE_PLUGIN_ID)
    await rt.setBypass(inst.instanceId, true)
    assert.equal(rt.get(inst.instanceId)?.lifecycle, 'bypassed')
  })
})

describe('OutOfProcessRuntime', () => {
  it('rejects VST3 when bridge unavailable', async () => {
    const rt = new OutOfProcessRuntime()
    const desc = {
      ...createFakePluginDescriptor(),
      pluginId: 'vendor.eq',
      format: 'vst3' as const,
      path: 'C:/Plugins/eq.vst3',
      hostReady: false,
      isolation: 'out-of-process' as const,
      scanStatus: 'pending' as const,
    }
    await assert.rejects(() => rt.load(desc), (e: unknown) => {
      assert.ok(e instanceof PluginHostError)
      assert.equal(e.code, 'HostNotReady')
      return true
    })
  })

  it('loads when bridge is available (fake bridge)', async () => {
    const bridge: PluginHostProcessBridge = {
      isAvailable: () => true,
      send: async (cmd) => {
        if (cmd.type === 'load') return { ok: true, processId: 'php-1', slotId: 'slot-1' }
        if (cmd.type === 'prepare') return { ok: true, processId: 'php-1', slotId: 'slot-1', latencySamples: 64 }
        return { ok: true, processId: 'php-1' }
      },
    }
    const rt = new OutOfProcessRuntime(bridge)
    const desc = {
      pluginId: 'vendor.eq',
      format: 'vst3' as const,
      vendor: 'Vendor',
      name: 'EQ',
      version: '1',
      path: '/tmp/eq.vst3',
      category: 'effect',
      isInstrument: false,
      isEffect: true,
      supportsMidiInput: false,
      supportsMidiOutput: false,
      supportsAudioInput: true,
      supportsAudioOutput: true,
      supportsSidechain: false,
      supportsEditor: true,
      parameterCount: 1,
      scanStatus: 'ok' as const,
      hostReady: true,
      isolation: 'out-of-process' as const,
    }
    const inst = await rt.load(desc, { trackId: 't2' })
    assert.equal(inst.isolation, 'out-of-process')
    assert.equal(inst.hostProcessId, 'php-1')
    assert.equal(inst.latencySamples, 64)
    assert.equal(inst.lifecycle, 'active')
  })
})

describe('PluginManager', () => {
  it('loads builtin via manager', async () => {
    const mgr = new PluginManager()
    const inst = await mgr.load('jaswave.softpad', { trackId: 'tr' })
    assert.equal(inst.isolation, 'in-process')
    await mgr.unload(inst.instanceId)
    assert.equal(mgr.get(inst.instanceId), undefined)
  })

  it('discovers via OOP bridge', async () => {
    const bridge: PluginHostProcessBridge = {
      isAvailable: () => true,
      send: async (cmd) => {
        if (cmd.type === 'discover') {
          return {
            ok: true,
            processId: 'test',
            plugins: [{ path: 'C:/Plugins/Demo.vst3', name: 'Demo', format: 'vst3', hostReady: false }],
            count: 1,
          }
        }
        return { ok: false, code: 'HostNotReady', message: 'no' }
      },
    }
    const mgr = new PluginManager(bridge)
    const result = await mgr.discoverVst3(['C:/Plugins'])
    assert.equal(result.registered, 1)
    assert.equal(result.discovered[0]?.name, 'Demo')
    assert.equal(result.discovered[0]?.hostReady, false)
  })

  it('refuses VST3 without native host', async () => {
    const mgr = new PluginManager()
    pluginRegistry.register({
      pluginId: 'third.vst3',
      format: 'vst3',
      vendor: 'X',
      name: 'X',
      version: '1',
      path: 'x.vst3',
      category: 'effect',
      isInstrument: false,
      isEffect: true,
      supportsMidiInput: false,
      supportsMidiOutput: false,
      supportsAudioInput: true,
      supportsAudioOutput: true,
      supportsSidechain: false,
      supportsEditor: true,
      parameterCount: 0,
      scanStatus: 'ok',
      hostReady: false,
      isolation: 'out-of-process',
    })
    await assert.rejects(() => mgr.load('third.vst3'), (e: unknown) => {
      assert.ok(e instanceof PluginHostError)
      assert.equal(e.code, 'HostNotReady')
      return true
    })
  })

  it('blacklist blocks load after crashes', async () => {
    const db = new PluginCompatibilityDatabase()
    db.recordCrash('bad.plug', '1', 'init')
    db.recordCrash('bad.plug', '1', 'init')
    db.recordCrash('bad.plug', '1', 'init')
    assert.equal(db.isDisabled('bad.plug'), true)
  })
})

describe('search paths', () => {
  it('expands Windows env placeholders when present', async () => {
    const { expandPluginSearchPath } = await import('./search-paths')
    const raw = '%CommonProgramFiles%/VST3'
    const expanded = expandPluginSearchPath(raw)
    if (process.platform === 'win32' && process.env.CommonProgramFiles) {
      assert.ok(expanded.includes('VST3'))
      assert.ok(!expanded.includes('%CommonProgramFiles%'))
    } else {
      assert.equal(expanded, raw)
    }
  })

  it('addCustom rejects duplicates and remove only customs', async () => {
    const { PluginSearchPathConfig } = await import('./search-paths')
    const cfg = new PluginSearchPathConfig([])
    const a = cfg.addCustom('D:\\MyVSTs')
    assert.ok(a)
    assert.equal(cfg.addCustom('D:\\MyVSTs'), null)
    assert.equal(cfg.addCustom('D:\\MyVSTs\\'), null)
    cfg.addCustom('D:\\Other')
    cfg.remove(a!.id)
    assert.equal(cfg.list().length, 1)
  })
})
