/**
 * Bridge del renderer hacia el Plugin Host Process (vía IPC Main).
 */

import type { PluginHostProcessBridge } from './out-of-process-runtime'
import type { PluginHostProcessCommand, PluginHostProcessReply, PluginHostErrorCode } from './types'

function mapReply(raw: unknown): PluginHostProcessReply {
  const r = raw as Record<string, unknown> | null
  if (r && r.ok === true) {
    return {
      ok: true,
      processId: String(r.processId ?? 'unknown'),
      slotId: r.slotId != null ? String(r.slotId) : undefined,
      latencySamples: typeof r.latencySamples === 'number' ? r.latencySamples : undefined,
      plugins: Array.isArray(r.plugins)
        ? (r.plugins as Array<{ path: string; name: string; format?: string; hostReady?: boolean }>)
        : undefined,
      count: typeof r.count === 'number' ? r.count : undefined,
      editorReady: typeof r.editorReady === 'boolean' ? r.editorReady : undefined,
      editorOpening: typeof r.editorOpening === 'boolean' ? r.editorOpening : undefined,
      audioReady: typeof r.audioReady === 'boolean' ? r.audioReady : undefined,
      backends: Array.isArray(r.backends)
        ? (r.backends as PluginHostProcessReply extends { ok: true; backends?: infer B } ? B : never)
        : undefined,
      devices: Array.isArray(r.devices) ? (r.devices as never) : undefined,
      audio: r.audio && typeof r.audio === 'object' ? (r.audio as never) : undefined,
    }
  }
  return {
    ok: false,
    code: ((r?.code as PluginHostErrorCode) || 'HostNotReady') as PluginHostErrorCode,
    message: String(r?.message ?? 'Plugin host no disponible'),
  }
}

let availableCache = false

export function createElectronPluginHostBridge(): PluginHostProcessBridge {
  return {
    isAvailable: () => {
      if (typeof window === 'undefined' || !window.electron?.pluginHostSend) return false
      return availableCache
    },
    send: async (cmd: PluginHostProcessCommand) => {
      if (!window.electron?.pluginHostSend) {
        availableCache = false
        return {
          ok: false,
          code: 'HostNotReady',
          message: 'IPC plugin-host no expuesto (¿app Electron?)',
        }
      }
      try {
        const isEditorCmd =
          cmd.type === 'openEditor' ||
          cmd.type === 'closeEditor' ||
          cmd.type === 'focusEditor' ||
          cmd.type === 'setEditorBounds'
        if (!isEditorCmd && !availableCache && window.electron.pluginHostEnsure) {
          const ensured = await window.electron.pluginHostEnsure()
          availableCache = !!(ensured as { ok?: boolean }).ok
        }
        const raw = await window.electron.pluginHostSend(cmd)
        const reply = mapReply(raw)
        if (reply.ok) availableCache = true
        // HostNotReady en un comando no implica que el proceso murió (p.ej. load sin SDK)
        if (!reply.ok && reply.code === 'HostNotReady' && cmd.type === 'ping') {
          availableCache = false
        }
        return reply
      } catch (e) {
        availableCache = false
        return {
          ok: false,
          code: 'HostNotReady',
          message: e instanceof Error ? e.message : 'Error IPC plugin-host',
        }
      }
    },
  }
}

export async function refreshPluginHostAvailability(): Promise<boolean> {
  if (!window.electron?.pluginHostEnsure && !window.electron?.pluginHostStatus) {
    availableCache = false
    return false
  }
  try {
    const ensured = window.electron.pluginHostEnsure
      ? await window.electron.pluginHostEnsure()
      : null
    if (ensured && typeof ensured === 'object' && 'ok' in ensured) {
      availableCache = !!(ensured as { ok: boolean }).ok
      if (availableCache) return true
    }
    const status = await window.electron.pluginHostStatus?.()
    availableCache = !!status?.vst3HostProcessAvailable
    return availableCache
  } catch {
    availableCache = false
    return false
  }
}

export function isPluginHostBridgeCachedAvailable(): boolean {
  return availableCache
}
