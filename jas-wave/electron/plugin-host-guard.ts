/**
 * Allowlist de comandos que el renderer puede enviar al plugin host nativo.
 * Cargar un .vst3/.dll ejecuta código nativo: las rutas deben estar bajo raíces concedidas.
 */

import * as path from 'node:path'
import type { PathGrants } from './path-grants'

export const ALLOWED_HOST_COMMANDS = new Set([
  'ping',
  'discover',
  'load',
  'unload',
  'prepare',
  'setBypass',
  'getLatency',
  'crashReport',
  'listParameters',
  'setParameter',
  'getPluginState',
  'setPluginState',
  'openEditor',
  'openEditorFloating',
  'focusEditor',
  'closeEditor',
  'setEditorBounds',
  'noteOn',
  'noteOff',
  'allNotesOff',
  'midiCc',
  'setTransport',
  'setLiveMidiTargets',
  'metronome.set',
  'getTransportClock',
  'clip.load',
  'clip.schedule',
  'clip.stopAll',
  'clip.unload',
  'setMixInputRate',
  'setSlotMix',
  'setMasterMix',
  'setTrackGraph',
  'setMeterTrackOrder',
  'getMixMeters',
  'getMixBufferStats',
  'listAudioDevices',
  'getAudioDevice',
  'setAudioDevice',
  'testTone',
  'ensureAudio',
  'asioControlPanel',
  'listMidiDevices',
  'openMidiInputs',
  'renderOfflineStart',
  'renderOfflineStep',
  'renderOfflineFinish',
  'renderOfflineCancel',
  'clearPluginQuarantine',
])

const PLUGIN_EXTENSIONS = new Set(['.vst3', '.dll'])

export type HostCommandCheck = { ok: true } | { ok: false; error: string }

function pluginPathOk(p: unknown, grants: PathGrants): boolean {
  if (typeof p !== 'string') return false
  return PLUGIN_EXTENSIONS.has(path.extname(p).toLowerCase()) && grants.isAllowed(p, 'read')
}

export function checkHostCommand(cmd: Record<string, unknown>, grants: PathGrants): HostCommandCheck {
  const type = typeof cmd.type === 'string' ? cmd.type : ''
  if (!ALLOWED_HOST_COMMANDS.has(type)) {
    return { ok: false, error: `Comando de plugin host no permitido: ${type || '(vacío)'}` }
  }
  switch (type) {
    case 'load':
    case 'openEditor':
      if (!pluginPathOk(cmd.path, grants)) {
        return { ok: false, error: `Ruta de plugin no permitida: ${String(cmd.path)}. Añade su carpeta en Instrumentos → Carpetas.` }
      }
      break
    case 'focusEditor':
      if (cmd.path !== undefined && !pluginPathOk(cmd.path, grants)) {
        return { ok: false, error: `Ruta de plugin no permitida: ${String(cmd.path)}` }
      }
      break
    case 'discover':
      if (!grants.isAllowed(cmd.path, 'read')) {
        return { ok: false, error: `Carpeta de plugins no permitida: ${String(cmd.path)}` }
      }
      break
    case 'clip.load':
      if (cmd.path !== undefined && !grants.isBinaryReadAllowed(cmd.path)) {
        return { ok: false, error: `Audio no permitido: ${String(cmd.path)}` }
      }
      break
    case 'renderOfflineStart':
      if (!grants.isAllowed(cmd.outPath, 'write')) {
        return { ok: false, error: `Destino de render no permitido: ${String(cmd.outPath)}` }
      }
      break
  }
  return { ok: true }
}
