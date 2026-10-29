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
  'hardStop',
  'midiCc',
  'setTransport',
  'setLiveMidiTargets',
  'metronome.set',
  'getTransportClock',
  'clip.load',
  'clip.loadBegin',
  'clip.loadChunk',
  'clip.loadEnd',
  'clip.has',
  'clip.schedule',
  'clip.stopAll',
  'clip.unload',
  'setMixInputRate',
  'setSlotMix',
  'setMasterMix',
  'setMonitorMix',
  'setTrackGraph',
  'setMeterTrackOrder',
  'getMixMeters',
  'resetMasterLoudness',
  'getMasterSpectrum',
  'getStemSpectrum',
  'getOpenEditors',
  'getMixBufferStats',
  'listAudioDevices',
  'getAudioDevice',
  'acquireAudioEngine',
  'requestAudioEngine',
  'releaseAudioEngine',
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

/**
 * Raíz de renders de análisis (userData/analysis). El proceso main la fija al
 * arrancar: los WAV por stem que escribe `renderOfflineStart` con `analysis`
 * no necesitan grant del usuario porque solo se leen para medir.
 */
let analysisRoot: string | null = null

export function setAnalysisRoot(dir: string) {
  analysisRoot = path.resolve(dir)
}

export function clearAnalysisRoot() {
  analysisRoot = null
}

/** true si `p` cae dentro de la raíz de análisis (sin escapes con `..`). */
export function dentroDeRaizAnalisis(p: unknown): boolean {
  if (typeof p !== 'string' || !analysisRoot) return false
  const abs = path.resolve(p)
  return abs === analysisRoot || abs.startsWith(analysisRoot + path.sep)
}

function pluginPathOk(p: unknown, grants: PathGrants): boolean {
  if (typeof p !== 'string') return false
  return PLUGIN_EXTENSIONS.has(path.extname(p).toLowerCase()) && grants.isAllowed(p, 'read')
}

/**
 * Expande variables de entorno estilo Windows (`%LOCALAPPDATA%`) en una ruta. El renderer no tiene `process.env`
 * y manda las carpetas de escaneo tal cual (`%CommonProgramFiles%/VST3`); sin expandirlas aquí, la comprobación de
 * permisos (que trabaja con rutas absolutas) las rechazaba todas y el catálogo no se actualizaba nunca.
 */
export function expandirVariablesDeEntorno(ruta: string, env: Record<string, string | undefined> = process.env): string {
  return ruta.replace(/%([^%]+)%/g, (completo, nombre: string) => {
    const clave = Object.keys(env).find((k) => k.toLowerCase() === nombre.toLowerCase())
    const valor = clave ? env[clave] : undefined
    return valor ? valor : completo
  })
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
    case 'renderOfflineStart': {
      const esAnalisis = cmd.analysis === true
      if (cmd.outDir !== undefined && !esAnalisis) {
        return { ok: false, error: 'outDir solo se permite con analysis: true' }
      }
      if (esAnalisis) {
        if (!dentroDeRaizAnalisis(cmd.outDir)) {
          return { ok: false, error: `Destino de análisis fuera de ${analysisRoot ?? 'userData/analysis'}: ${String(cmd.outDir)}` }
        }
        if (cmd.outPath !== undefined && !grants.isAllowed(cmd.outPath, 'write')) {
          return { ok: false, error: `Destino de render no permitido: ${String(cmd.outPath)}` }
        }
        break
      }
      if (!grants.isAllowed(cmd.outPath, 'write')) {
        return { ok: false, error: `Destino de render no permitido: ${String(cmd.outPath)}` }
      }
      // Stems del export: "stemIndex|ruta;…" — cada ruta necesita el mismo permiso de escritura.
      if (cmd.stemOuts !== undefined) {
        if (typeof cmd.stemOuts !== 'string') return { ok: false, error: 'stemOuts inválido' }
        for (const item of cmd.stemOuts.split(';').filter(Boolean)) {
          const bar = item.indexOf('|')
          const ruta = bar > 0 ? item.slice(bar + 1) : ''
          if (!/^\d+$/.test(item.slice(0, bar)) || !/\.wav$/i.test(ruta) || !grants.isAllowed(ruta, 'write')) {
            return { ok: false, error: `Destino de stem no permitido: ${ruta || item}` }
          }
        }
      }
      break
    }
  }
  return { ok: true }
}
