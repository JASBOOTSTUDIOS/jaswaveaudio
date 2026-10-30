/**
 * Runtime VST3 por pista (estilo Reaper): load de toda la cadena
 * (instrumento + efectos) en Plugin Host + MIDI.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import { snapshotPluginSinCambios } from '../../../../shared/src/commands/plugin-commands'
import {
  extractHostPluginPath,
  guessIsInstrument,
  isBuiltinPlugin,
  isLikelyAudioFx,
  resolveHostPluginPath,
  VST2_NOT_HOSTED_MSG,
} from './plugin-info-adapter'
import { setActiveVstVoiceTarget, getActiveVstVoiceTarget } from './vst-voice-router'
import { encodeTrackGraph } from './track-graph-encoding'
import { padresEfectivos, pistasAudibles } from './track-hierarchy'
import { audioEngine } from '@/lib/audio-engine'
import { isUndockWindow } from '@/lib/undock-window'
import type { HostParameterRaw } from './plugin-parameter-intel'
import { getEditorPreviewTrackId } from './editor-preview-focus'
import {
  crearAutoguardadoEstadoVst,
  descartarEstadoParaMover,
  guardarEstadoParaMover,
  limpiarEstadoParaMover,
  listarRestauracionesPendientes,
  marcarRestauracionPendiente,
  olvidarRestauraciones,
  restauracionPendiente,
  restaurarEstadoSlot,
  verEstadoParaMover,
} from './vst-estado'

export { extractHostPluginPath, extractHostPluginPath as extractVst3Path, resolveHostPluginPath }

export function isBuiltinInstrument(plugin: PluginInfo): boolean {
  return isBuiltinPlugin(plugin)
}

export function isVstInstrumentPlugin(plugin: PluginInfo, path: string): boolean {
  if (
    plugin.tipo === 'instrumento' ||
    plugin.categoria === 'instrumento' ||
    plugin.categoria === 'synth' ||
    guessIsInstrument(plugin.nombre, path)
  ) {
    return true
  }
  // Alineado con findTrackPlaybackInstrument: VST no-FX puede recibir MIDI (p.ej. BFD).
  return !isLikelyAudioFx(plugin.nombre, path)
}

/** Instrumento de playback: último VST instrumento de la cadena (evita Piano muerto + Roles vivo). */
export function findTrackPlaybackInstrument(
  plugins: PluginInfo[] | undefined,
): { kind: 'builtin'; plugin: PluginInfo } | { kind: 'vst'; plugin: PluginInfo; path: string } | null {
  let builtin: PluginInfo | null = null
  let lastVst: { plugin: PluginInfo; path: string } | null = null
  for (const p of plugins ?? []) {
    if (p.bypass) continue
    if (isBuiltinInstrument(p)) {
      if (!builtin) builtin = p
      continue
    }
    const path = extractHostPluginPath(p.descripcion, p.id)
    if (!path) continue
    if (isVstInstrumentPlugin(p, path)) {
      lastVst = { plugin: p, path }
      continue
    }
    if (!lastVst && !isLikelyAudioFx(p.nombre, path)) {
      lastVst = { plugin: p, path }
    }
  }
  if (lastVst) return { kind: 'vst', plugin: lastVst.plugin, path: lastVst.path }
  return builtin ? { kind: 'builtin', plugin: builtin } : null
}

export function trackHasInsertedSoftPad(plugins: PluginInfo[] | undefined): boolean {
  return findTrackPlaybackInstrument(plugins)?.kind === 'builtin'
}

/** Primer instrumento VST3 no bypass de la cadena. */
export function findTrackVstInstrument(plugins: PluginInfo[] | undefined): PluginInfo | null {
  const hit = findTrackPlaybackInstrument(plugins)
  return hit?.kind === 'vst' ? hit.plugin : null
}

export function slotIdForTrackPlugin(trackId: string, pluginId: string): string {
  return `${trackId}:${pluginId}`
}

type LoadedPlugin = {
  trackId: string
  pluginId: string
  path: string
  slotId: string
  instrument: boolean
}

/** Instrumento activo por pista (MIDI). */
const g = globalThis as unknown as {
  __jaswaveVstRuntime?: {
    byTrack: Map<string, LoadedPlugin>
    bySlot: Map<string, LoadedPlugin>
  }
}
if (!g.__jaswaveVstRuntime) {
  g.__jaswaveVstRuntime = {
    byTrack: new Map(),
    bySlot: new Map(),
  }
}
const byTrack = g.__jaswaveVstRuntime.byTrack
/** Todos los slots VST cargados (instrumento + efecto). */
const bySlot = g.__jaswaveVstRuntime.bySlot
const loadPromises = new Map<string, Promise<boolean>>()
/** Cargas fallidas recientes por ruta (evita reintentos en bucle). */
const loadFailCache = new Map<string, { until: number; msg: string }>()
const loadFailLogged = new Set<string>()
const runtimeListeners = new Set<() => void>()
let runtimeGeneration = 0
let lastVstLoadError = ''
/** Último fallo de carga por slot: la UI lo muestra en el slot (deshabilitado + motivo + qué hacer). */
const slotLoadErrors = new Map<string, string>()

export function getLastVstLoadError(): string {
  return lastVstLoadError
}

/** Motivo por el que el plugin de esa pista no está sonando, o '' si cargó (o aún no se intentó). */
export function getVstSlotLoadError(trackId: string, pluginId: string): string {
  return slotLoadErrors.get(slotIdForTrackPlugin(trackId, pluginId)) ?? ''
}

function setSlotLoadError(slotId: string, msg: string) {
  if (msg) {
    if (slotLoadErrors.get(slotId) === msg) return
    slotLoadErrors.set(slotId, msg)
  } else if (!slotLoadErrors.delete(slotId)) {
    return
  }
  emitRuntime()
}

/** Texto para el usuario a partir del error del host: qué pasó y qué puede hacer. */
export function describeVstLoadError(msg: string): string {
  if (!msg) return ''
  if (/solo \.vst3|VST2|\.dll/i.test(msg)) return VST2_NOT_HOSTED_MSG + ' Reemplázalo por su versión VST3.'
  if (isQuarantineLoadError(msg)) {
    return 'Este plugin cerró el motor de audio y quedó aislado. Quítalo o pulsa «Reintentar plugins aislados» en Ajustes de audio.'
  }
  if (/HostNotReady|stdin|no está en ejecución/i.test(msg)) {
    return 'El motor de audio se está reiniciando. El plugin se cargará solo cuando esté listo.'
  }
  if (/Timeout/i.test(msg)) return 'El plugin tardó demasiado en cargar. Se reintentará en un minuto; si persiste, quítalo.'
  return `No se pudo cargar el plugin (${msg}). Comprueba que el archivo existe y es VST3 de 64 bits.`
}

function emitRuntime() {
  runtimeGeneration += 1
  for (const l of runtimeListeners) l()
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search)
      const undock =
        Boolean(q.get('undock')) || window.location.hash.replace(/^#/, '').startsWith('undock/')
      if (!undock) publishVstRuntimeSnapshot()
    }
  } catch {
    /* ignore */
  }
}

export function subscribeVstRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener)
  return () => {
    runtimeListeners.delete(listener)
  }
}

export function getVstRuntimeGeneration(): number {
  return runtimeGeneration
}

export function isPluginAudioReady(trackId: string, pluginId: string): boolean {
  return bySlot.has(slotIdForTrackPlugin(trackId, pluginId))
}

export function getLoadedInstrumentForTrack(trackId: string): LoadedPlugin | null {
  const direct = byTrack.get(trackId)
  if (direct) return direct
  // Preferir el último instrumento cargado de la pista (cadena con varios VSTs).
  let lastInst: LoadedPlugin | null = null
  let fallback: LoadedPlugin | null = null
  for (const p of bySlot.values()) {
    if (p.trackId !== trackId) continue
    if (p.instrument) lastInst = p
    else if (!fallback) fallback = p
  }
  return lastInst ?? fallback
}

/**
 * Todos los instrumentos cargados de la pista (capas), el principal primero. El MIDI de la pista
 * se envía a cada uno; el host suma sus salidas antes de los efectos.
 */
export function getLoadedInstrumentsForTrack(trackId: string): LoadedPlugin[] {
  const principal = byTrack.get(trackId)
  const out: LoadedPlugin[] = principal ? [principal] : []
  for (const p of bySlot.values()) {
    if (p.trackId === trackId && p.instrument && p.slotId !== principal?.slotId) out.push(p)
  }
  return out
}

let resyncProjectGraph: (() => void) | null = null

/** playback-provider registra syncNativeChannelMix para publicar graph tras load. */
export function registerProjectGraphResync(fn: (() => void) | null): void {
  resyncProjectGraph = fn
}

/** Re-publica el graph del proyecto (+ stems de audición huérfanos). */
export function flushProjectGraphResync(): boolean {
  if (!resyncProjectGraph) return false
  resyncProjectGraph()
  return true
}

/** Audio corriendo. No pone transport.playing (eso mueve el playhead);
 *  el host activa kPlaying del slot en cada noteOn de preview. */
let hostMidiAudioReady = false
let hostMidiAudioEnsure: Promise<void> | null = null

export function ensureHostMidiAudible(): Promise<void> {
  if (hostMidiAudioReady) return Promise.resolve()
  if (hostMidiAudioEnsure) return hostMidiAudioEnsure
  hostMidiAudioEnsure = (async () => {
    try {
      const api = window.electron
      if (!api?.pluginHostSend) return
      const raw = (await api.pluginHostSend({ type: 'getAudioDevice' })) as {
        audio?: { running?: boolean }
      }
      if (!raw?.audio?.running) {
        await api.pluginHostSend({ type: 'ensureAudio' })
      }
      hostMidiAudioReady = true
    } catch {
      /* ignore */
    } finally {
      hostMidiAudioEnsure = null
    }
  })()
  return hostMidiAudioEnsure
}

export function rememberLoadedInstrument(plugin: {
  trackId: string
  pluginId: string
  path: string
  slotId: string
  instrument: boolean
}): void {
  bySlot.set(plugin.slotId, plugin)
  if (plugin.instrument) byTrack.set(plugin.trackId, plugin)
}

const RUNTIME_SYNC_CH = 'jaswave-vst-runtime-v1'

export function publishVstRuntimeSnapshot(): void {
  try {
    const ch = new BroadcastChannel(RUNTIME_SYNC_CH)
    ch.postMessage({ type: 'snapshot', slots: [...bySlot.values()] })
    ch.close()
  } catch {
    /* ignore */
  }
}

/** Primary publica; satélites hidratan el mapa de slots (preview MIDI en undock). */
export function startVstRuntimeWindowSync(role: 'primary' | 'satellite'): () => void {
  try {
    const ch = new BroadcastChannel(RUNTIME_SYNC_CH)
    if (role === 'primary') {
      ch.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { type?: string }
        if (data?.type === 'request') publishVstRuntimeSnapshot()
      }
      publishVstRuntimeSnapshot()
      return () => ch.close()
    }
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string
        slots?: Array<{
          trackId: string
          pluginId: string
          path: string
          slotId: string
          instrument: boolean
        }>
      }
      if (data?.type !== 'snapshot' || !Array.isArray(data.slots)) return
      bySlot.clear()
      byTrack.clear()
      for (const p of data.slots) {
        bySlot.set(p.slotId, p)
        if (p.instrument) byTrack.set(p.trackId, p)
      }
      emitRuntime()
    }
    ch.postMessage({ type: 'request' })
    return () => ch.close()
  } catch {
    return () => undefined
  }
}

export function listLoadedSlots(): Array<{
  trackId: string
  pluginId: string
  path: string
  slotId: string
  instrument: boolean
}> {
  return [...bySlot.values()].map((p) => ({ ...p }))
}

export function forgetHostPlugins(): void {
  bySlot.clear()
  byTrack.clear()
  loadPromises.clear()
  olvidarRestauraciones()
  lastVstLoadError = ''
  emitRuntime()
}

export async function releaseSlot(slotId: string): Promise<void> {
  olvidarRestauraciones(slotId)
  slotLoadErrors.delete(slotId)
  try {
    await window.electron?.pluginHostSend?.({ type: 'closeEditor', slotId })
    await window.electron?.pluginHostSend?.({ type: 'unload', slotId })
  } catch {
    /* ignore */
  }
  bySlot.delete(slotId)
  for (const [trackId, inst] of [...byTrack.entries()]) {
    if (inst.slotId === slotId) byTrack.delete(trackId)
  }
  const active = getActiveVstVoiceTarget()
  if (active?.slotId === slotId) setActiveVstVoiceTarget(null)
  emitRuntime()
}

export async function releaseTrackPlugin(trackId: string, pluginId: string): Promise<void> {
  const slotId = slotIdForTrackPlugin(trackId, pluginId)
  await releaseSlot(slotId)
}

/** Sincroniza slots cargados con el proyecto (quita huérfanos). */
export async function syncLoadedSlotsWithProject(
  tracks: Array<{ id: string; plugins?: PluginInfo[] }>,
  masterPlugins?: PluginInfo[],
): Promise<void> {
  const live = new Set<string>()
  for (const t of tracks) {
    for (const p of t.plugins ?? []) {
      if (isBuiltinInstrument(p)) continue
      if (resolveHostPluginPath(p)) live.add(slotIdForTrackPlugin(t.id, p.id))
    }
  }
  for (const p of masterPlugins ?? []) {
    if (isBuiltinInstrument(p)) continue
    if (resolveHostPluginPath(p)) live.add(slotIdForTrackPlugin('master', p.id))
  }
  // Ids de plugin que siguen en el proyecto (en la misma pista o en otra): si su slot se descarga porque
  // cambió de cadena/pista, el estado VIVO se guarda antes (el chunk del proyecto puede ser más viejo).
  const idsVivos = new Set<string>()
  for (const t of tracks) for (const p of t.plugins ?? []) idsVivos.add(p.id)
  for (const p of masterPlugins ?? []) idsVivos.add(p.id)
  for (const slotId of [...bySlot.keys()]) {
    if (live.has(slotId)) continue
    const info = bySlot.get(slotId)
    if (info && idsVivos.has(info.pluginId) && !restauracionPendiente(slotId)) {
      const chunk = await getSlotPluginStateBase64(slotId)
      if (chunk) guardarEstadoParaMover(info.pluginId, chunk)
    }
    await releaseSlot(slotId)
  }
}

let lastHostPid = 0
/** Evita ensure concurrentes (lifecycle + play + host restart). */
let ensureProjectInFlight: Promise<Map<string, string>> | null = null
/** Paths en cuarentena ya avisados (no spamear consola). */
const quarantineWarned = new Set<string>()

function isQuarantineLoadError(msg: string): boolean {
  return /tumbó el Plugin Host|plugin-crash-quarantine|PluginCrashedHost|se aísla|skip \(cuarentena\)/i.test(
    msg,
  )
}

export function isVstQuarantineError(msg: string): boolean {
  return isQuarantineLoadError(msg)
}

/** Tras audio.clearQuarantine: permite reintentar load sin spam de consola. */
export function clearVstQuarantineWarnCache(): void {
  quarantineWarned.clear()
  // También el «no reintentar» de fallos recientes: sin esto, tras limpiar la cuarentena el plugin
  // seguía devolviendo el mismo error hasta 5 minutos sin llegar a intentarse.
  loadFailCache.clear()
  loadFailLogged.clear()
}

/**
 * Olvida el fallo reciente de un plugin. Se llama cuando el usuario pide abrirlo o insertarlo a propósito:
 * una acción explícita siempre se intenta (el «no reintentar» solo protege de los disparadores automáticos).
 */
export function olvidarFalloVst(rutaPlugin: string): void {
  const k = rutaPlugin.replace(/\//g, '\\').toLowerCase()
  loadFailCache.delete(k)
  loadFailLogged.delete(k)
  quarantineWarned.delete(k)
}

function esMotorOcupado(msg: string): boolean {
  return /AudioEngineBusy|usando el motor de audio/i.test(msg)
}

/** Al recuperar el motor de audio: olvida los fallos «motor ocupado» para que los plugins se carguen ya. */
export function olvidarFallosPorMotorOcupado(): void {
  for (const [k, v] of loadFailCache) {
    if (esMotorOcupado(v.msg)) {
      loadFailCache.delete(k)
      loadFailLogged.delete(k)
    }
  }
  for (const [slot, msg] of slotLoadErrors) if (esMotorOcupado(msg)) slotLoadErrors.delete(slot)
}

export async function ensureTrackVstPlugin(
  trackId: string,
  plugin: PluginInfo,
): Promise<boolean> {
  const path = resolveHostPluginPath(plugin)
  if (!path) {
    const kept =
      byTrack.get(trackId) ||
      [...bySlot.values()].find((p) => p.trackId === trackId && p.instrument)
    if (kept) {
      byTrack.set(trackId, kept)
      return true
    }
    lastVstLoadError = `Sin ruta .vst3/.dll en «${plugin.nombre}» (descripcion/id/catálogo)`
    return false
  }
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  // Proyectos antiguos guardan VST2 (.dll): el host los rechaza (ADR-0019). No se envía `load`
  // (ocupaba el host y llenaba la consola); el slot queda marcado para que el usuario lo sustituya.
  if (/\.dll$/i.test(path)) {
    lastVstLoadError = VST2_NOT_HOSTED_MSG
    setSlotLoadError(slotId, VST2_NOT_HOSTED_MSG)
    return false
  }
  const instrument = isVstInstrumentPlugin(plugin, path)
  const st = typeof window !== 'undefined' ? await window.electron?.pluginHostStatus?.() : undefined
  const pid = typeof st?.nativePid === 'number' ? st.nativePid : 0
  if (pid && lastHostPid && pid !== lastHostPid) forgetHostPlugins()
  if (pid) lastHostPid = pid
  const existing = bySlot.get(slotId)
  if (existing?.path === path) {
    // Durante play: no RPC getLatency/restore (compiten con noteOn en stdin).
    if (audioEngine.getIsPlaying()) {
      if (instrument) {
        byTrack.set(trackId, existing)
        setActiveVstVoiceTarget({
          slotId: existing.slotId,
          path: existing.path,
          trackId,
          pluginId: existing.pluginId,
        })
      }
      return true
    }
    // Confirmar que el host sigue teniendo el slot (tras restart el mapa local miente).
    let hostHas = false
    try {
      const raw = await window.electron?.pluginHostSend?.({
        type: 'getLatency',
        slotId,
      })
      hostHas = !!(raw && typeof raw === 'object' && (raw as { ok?: boolean }).ok)
    } catch {
      hostHas = false
    }
    if (hostHas) {
      if (instrument) {
        byTrack.set(trackId, existing)
        setActiveVstVoiceTarget({
          slotId: existing.slotId,
          path: existing.path,
          trackId,
          pluginId: existing.pluginId,
        })
      }
      // Slot YA cargado y vivo: su estado es el bueno. Reaplicar aquí el chunk del proyecto (más viejo que
      // lo que el usuario hizo en el editor) era una de las vías por las que se "botaba" la configuración.
      // Solo se reintenta si la restauración inicial quedó pendiente (falló o llegó tarde).
      if (restauracionPendiente(slotId)) await restorePluginStateAfterLoad(trackId, plugin)
      resyncProjectGraph?.()
      return true
    }
    // getLatency falló: no borrar el mapa todavía — re-load abajo; si falla, conservar slot.
  }

  const pending = loadPromises.get(slotId)
  if (pending) return pending

  // Un plugin que acaba de fallar no se reintenta en bucle (varios disparadores lo pedían a la vez y
  // saturaban el host y la consola): se espera un tiempo antes de volver a intentarlo.
  const failKey = path.replace(/\//g, '\\').toLowerCase()
  const failed = loadFailCache.get(failKey)
  if (failed && Date.now() < failed.until) {
    lastVstLoadError = failed.msg
    return false
  }

  const work = (async () => {
    try {
      if (!window.electron?.pluginHostEnsure || !window.electron.pluginHostSend) return false
      await window.electron.pluginHostEnsure()
      const st = await window.electron.pluginHostStatus?.()
      const pid = typeof st?.nativePid === 'number' ? st.nativePid : 0
      if (pid && lastHostPid && pid !== lastHostPid) forgetHostPlugins()
      if (pid) lastHostPid = pid
      const audio = (await window.electron.pluginHostSend({ type: 'getAudioDevice' })) as {
        audio?: { running?: boolean }
      }
      if (!audio?.audio?.running) {
        await window.electron.pluginHostSend({ type: 'ensureAudio' })
      }
      const raw = await window.electron.pluginHostSend({
        type: 'load',
        path,
        slotId,
        pluginId: plugin.id,
        sampleRate: 48000,
        blockSize: 512,
      })
      const ok = !!(raw && typeof raw === 'object' && (raw as { ok?: boolean }).ok)
      if (!ok) {
        const msg =
          raw && typeof raw === 'object' && 'message' in raw
            ? String((raw as { message: unknown }).message)
            : 'load falló'
        lastVstLoadError = msg
        const key = path.replace(/\//g, '\\').toLowerCase()
        if (isQuarantineLoadError(msg)) {
          if (!quarantineWarned.has(key)) {
            quarantineWarned.add(key)
            console.warn('[track-vst] skip (cuarentena)', path)
          }
        } else if (!loadFailLogged.has(failKey)) {
          loadFailLogged.add(failKey)
          console.error('[track-vst] load failed', path, msg)
        }
        // Los disparadores automáticos esperan un poco antes de reintentar; con cuarentena, muy poco, para que
        // limpiarla o recompilar el plugin surta efecto enseguida.
        // Motor ocupado por otra ventana: causa pasajera, no un fallo del plugin (se limpia al recuperar el motor).
        const breve = isQuarantineLoadError(msg) || esMotorOcupado(msg)
        loadFailCache.set(failKey, { until: Date.now() + (breve ? 5_000 : 60_000), msg })
        setSlotLoadError(slotId, msg)
        // Conservar slot previo si el re-load falla (evita silenciar MIDI mid-play).
        if (existing) {
          if (instrument) byTrack.set(trackId, existing)
          return true
        }
        return false
      }
      lastVstLoadError = ''
      slotLoadErrors.delete(slotId)
      const loaded: LoadedPlugin = { trackId, pluginId: plugin.id, path, slotId, instrument }
      // Antes de publicar el slot: desde este momento un snapshot vería el estado de fábrica.
      if (plugin.estadoPluginBase64 || verEstadoParaMover(plugin.id)) marcarRestauracionPendiente(slotId)
      bySlot.set(slotId, loaded)
      if (instrument) {
        byTrack.set(trackId, loaded)
        setActiveVstVoiceTarget({ slotId, path, trackId, pluginId: plugin.id })
        // El instrumento previo NO se descarga aquí: puede ser otra capa de la misma pista. Si se sustituyó,
        // syncLoadedSlotsWithProject lo quita al no estar ya en la cadena del proyecto.
      }
      await restorePluginStateAfterLoad(trackId, plugin)
      emitRuntime()
      resyncProjectGraph?.()
      return true
    } catch {
      return false
    } finally {
      loadPromises.delete(slotId)
    }
  })()

  loadPromises.set(slotId, work)
  return work
}

/** @deprecated usar ensureTrackVstPlugin */
export async function ensureTrackVstInstrument(
  trackId: string,
  plugin: PluginInfo,
): Promise<boolean> {
  return ensureTrackVstPlugin(trackId, plugin)
}

/** Carga instrumentos + efectos VST3 de todas las pistas (y master). */
export async function ensureProjectVstInstruments(
  tracks: Array<{ id: string; plugins?: PluginInfo[] }>,
  masterPlugins?: PluginInfo[],
  opts?: {
    onProgress?: (done: number, total: number, currentName: string) => void
  },
): Promise<Map<string, string>> {
  if (ensureProjectInFlight) return ensureProjectInFlight

  // Durante play: no re-load ni getLatency en cadena (bloquea stdin del host →
  // getTransportClock se congela → silencio MIDI con metrónomo aún vivo).
  if (audioEngine.getIsPlaying()) {
    const map = new Map<string, string>()
    let missing = false
    for (const t of tracks) {
      const needsHost = (t.plugins ?? []).some((p) => {
        if (p.bypass || isBuiltinInstrument(p)) return false
        return Boolean(resolveHostPluginPath(p))
      })
      if (!needsHost) continue
      const inst = getLoadedInstrumentForTrack(t.id)
      if (inst) map.set(t.id, inst.slotId)
      else missing = true
    }
    if (!missing) return map
  }

  ensureProjectInFlight = (async () => {
    const map = new Map<string, string>()
    let hostDead = false

    type Job = { trackId: string; plugin: PluginInfo; name: string }
    const jobs: Job[] = []
    for (const t of tracks) {
      for (const p of t.plugins ?? []) {
        if (p.bypass || isBuiltinInstrument(p)) continue
        if (!resolveHostPluginPath(p)) continue
        jobs.push({ trackId: t.id, plugin: p, name: p.nombre || p.id })
      }
    }
    for (const p of masterPlugins ?? []) {
      if (p.bypass || isBuiltinInstrument(p)) continue
      if (!resolveHostPluginPath(p)) continue
      jobs.push({ trackId: 'master', plugin: p, name: p.nombre || p.id })
    }

    const total = jobs.length
    opts?.onProgress?.(0, total, total ? jobs[0]!.name : '')

    const tryOne = async (trackId: string, p: PluginInfo): Promise<boolean> => {
      if (hostDead) return false
      if (p.bypass || isBuiltinInstrument(p)) return false
      const path = extractHostPluginPath(p.descripcion, p.id)
      if (!path) return false
      const ok = await ensureTrackVstPlugin(trackId, p)
      // Solo abortar la cola si el host murió de verdad (no si el plugin está en cuarentena).
      if (!ok && /stdin cerrado|HostNotReady|Plugin Host stdin/i.test(lastVstLoadError)) {
        hostDead = true
      }
      return ok
    }

    let done = 0
    for (const job of jobs) {
      if (hostDead) break
      opts?.onProgress?.(done, total, job.name)
      const path = extractHostPluginPath(job.plugin.descripcion, job.plugin.id)
      const ok = await tryOne(job.trackId, job.plugin)
      done += 1
      opts?.onProgress?.(done, total, job.name)
      if (ok && path && job.trackId !== 'master' && isVstInstrumentPlugin(job.plugin, path)) {
        map.set(job.trackId, slotIdForTrackPlugin(job.trackId, job.plugin.id))
      }
    }
    return map
  })().finally(() => {
    ensureProjectInFlight = null
  })

  return ensureProjectInFlight
}

/** Publica el graph Reaper al host + layout de stems en Web Audio. */
export function syncReaperTrackGraph(
  tracks: Array<{
    id: string
    plugins?: PluginInfo[]
    volumen?: number
    paneo?: number
    silenciada?: boolean
    soloActiva?: boolean
    tipo?: string
    padreId?: string
  }>,
  masterPlugins?: PluginInfo[],
  routing?: {
    sends?: Array<{
      activo?: boolean
      origenTrackId: string
      destinoBusId: string
      cantidad?: number
      preFader?: boolean
    }>
    sidechains?: Array<{
      activo?: boolean
      origenTrackId: string
      destinoTrackId: string
      destinoSlotId?: string
      cantidad?: number
    }>
    buses?: Array<{ id: string }>
  } | null,
  opts?: {
    /**
     * No rehacer el layout de stems Web Audio (mismas pistas, solo cambian
     * fader/paneo). Para publicaciones frecuentes durante el bounce offline.
     */
    omitirLayout?: boolean
  },
): void {
  // Buses/returns no se silencian por el solo de otra pista (si no, los sends a reverb desaparecen).
  const busIds = new Set((routing?.buses ?? []).map((b) => b.id))
  // Mute/solo heredados de las carpetas-bus.
  const audibles = pistasAudibles(tracks, busIds)
  const padres = padresEfectivos(tracks)

  const stemByTrackId = new Map(tracks.map((t, i) => [t.id, i]))

  const sendsBySrc = new Map<string, Array<{ destStem: number; amount: number; preFader?: boolean }>>()
  for (const send of routing?.sends ?? []) {
    if (send.activo === false) continue
    const amount = Math.max(0, Math.min(1, Number(send.cantidad ?? 0)))
    if (amount <= 0) continue
    let destStem = stemByTrackId.get(send.destinoBusId)
    if (destStem == null) {
      const bus = routing?.buses?.find((b) => b.id === send.destinoBusId)
      if (bus) destStem = stemByTrackId.get(bus.id)
    }
    if (destStem == null) continue
    const list = sendsBySrc.get(send.origenTrackId) ?? []
    list.push({ destStem, amount, preFader: Boolean(send.preFader) })
    sendsBySrc.set(send.origenTrackId, list)
  }

  const sidechainsByDest = new Map<string, Array<{ srcStem: number; amount: number; destSlotId?: string }>>()
  for (const sc of routing?.sidechains ?? []) {
    if (sc.activo === false) continue
    const amount = Math.max(0, Math.min(1, Number(sc.cantidad ?? 1)))
    if (amount <= 0) continue
    const srcStem = stemByTrackId.get(sc.origenTrackId)
    if (srcStem == null) continue
    const list = sidechainsByDest.get(sc.destinoTrackId) ?? []
    list.push({ srcStem, amount, destSlotId: sc.destinoSlotId })
    sidechainsByDest.set(sc.destinoTrackId, list)
  }

  const graphTracks = tracks.map((t, stemIndex) => {
    const previewId = getEditorPreviewTrackId()
    const muted = previewId === t.id ? false : !audibles.has(t.id)
    const padreId = padres.get(t.id)
    const parentStem = padreId != null ? stemByTrackId.get(padreId) : undefined
    const slots: Array<{ slotId: string; instrument: boolean; bypass: boolean }> = []
    for (const p of t.plugins ?? []) {
      // VST3 con ruta: nunca tratar como builtin (licencia «JasWave» ≠ in-process).
      const path = resolveHostPluginPath(p)
      if (!path) {
        if (isBuiltinInstrument(p)) continue
        continue
      }
      const slotId = slotIdForTrackPlugin(t.id, p.id)
      if (!bySlot.has(slotId)) continue
      slots.push({
        slotId,
        instrument: isVstInstrumentPlugin(p, path),
        bypass: Boolean(p.bypass),
      })
    }
    // Si el mapa tiene instrumento cargado pero el plugin del store no resolvió path/id
    // (musicBuild insert vs id), el graph activo deja el slot huérfano → MIDI sin audio.
    if (!slots.some((s) => s.instrument)) {
      const loaded = getLoadedInstrumentForTrack(t.id)
      if (loaded?.instrument && bySlot.has(loaded.slotId)) {
        slots.unshift({ slotId: loaded.slotId, instrument: true, bypass: false })
      }
    }
    return {
      stemIndex,
      gain: typeof t.volumen === 'number' ? t.volumen : 1,
      pan: typeof t.paneo === 'number' ? t.paneo : 0,
      muted,
      parentStem,
      slots,
      sends: sendsBySrc.get(t.id) ?? [],
      sidechains: sidechainsByDest.get(t.id) ?? [],
    }
  })

  // Slots de audición (chat / `__…`) no están en el proyecto: sin stem en el graph
  // el VST recibe MIDI pero no llega al mix ASIO → silencio.
  const usedSlotIds = new Set(graphTracks.flatMap((t) => t.slots.map((s) => s.slotId)))
  const stemIds = tracks.map((t) => t.id)
  for (const loaded of byTrack.values()) {
    if (!loaded.instrument || !bySlot.has(loaded.slotId)) continue
    if (usedSlotIds.has(loaded.slotId)) continue
    if (tracks.some((t) => t.id === loaded.trackId)) continue
    if (graphTracks.length >= 64) break
    const stemIndex = graphTracks.length
    graphTracks.push({
      stemIndex,
      gain: 0.95,
      pan: 0,
      muted: false,
      parentStem: undefined,
      slots: [{ slotId: loaded.slotId, instrument: true, bypass: false }],
      sends: [],
      sidechains: [],
    })
    usedSlotIds.add(loaded.slotId)
    stemIds.push(loaded.trackId)
  }
  if (!opts?.omitirLayout) audioEngine.setTrackStemLayout(stemIds)

  const master: Array<{ slotId: string; instrument: boolean; bypass: boolean }> = []
  for (const p of masterPlugins ?? []) {
    if (isBuiltinInstrument(p)) continue
    const path = resolveHostPluginPath(p)
    if (!path) continue
    const slotId = slotIdForTrackPlugin('master', p.id)
    if (!bySlot.has(slotId)) continue
    master.push({
      slotId,
      instrument: isVstInstrumentPlugin(p, path),
      bypass: Boolean(p.bypass),
    })
  }

  const encoding = encodeTrackGraph({ tracks: graphTracks, master })
  try {
    void window.electron?.pluginHostSend?.({ type: 'setTrackGraph', encoding })
  } catch {
    /* ignore */
  }
}

export function sendVstNote(
  slotId: string,
  on: boolean,
  pitch: number,
  velocity = 100,
  delaySamples = 0,
  lengthSamples?: number,
): void {
  try {
    const api = window.electron
    if (!api) return
    const delay = Math.max(0, Math.round(delaySamples))
    const cmd = on
      ? {
          type: 'noteOn' as const,
          slotId,
          pitch,
          velocity,
          delaySamples: delay,
          ...(lengthSamples != null && lengthSamples > 0
            ? { lengthSamples: Math.max(1, Math.round(lengthSamples)) }
            : {}),
        }
      : { type: 'noteOff' as const, slotId, pitch, delaySamples: delay }
    if (typeof api.pluginHostMidi === 'function') {
      api.pluginHostMidi(cmd)
      return
    }
    void api.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

export function sendVstCc(slotId: string, cc: number, value: number, delaySamples = 0): void {
  try {
    const api = window.electron
    const cmd = {
      type: 'midiCc' as const,
      slotId,
      cc,
      value,
      delaySamples: Math.max(0, Math.round(delaySamples)),
    }
    if (typeof api?.pluginHostMidi === 'function') {
      api.pluginHostMidi(cmd)
      return
    }
    void api?.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

export function allNotesOffSlot(slotId: string): void {
  try {
    const api = window.electron
    if (typeof api?.pluginHostMidi === 'function') {
      void api.pluginHostMidi({ type: 'allNotesOff', slotId })
      return
    }
    void api?.pluginHostSend?.({ type: 'allNotesOff', slotId })
  } catch {
    /* ignore */
  }
}

/** Panic MIDI en todos los slots (instrumento + FX): sustain off + all notes off. */
export function allNotesOffAllTracks(): void {
  try {
    const api = window.electron
    if (typeof api?.pluginHostMidi === 'function') {
      void api.pluginHostMidi({ type: 'allNotesOff' })
    } else {
      void api?.pluginHostSend?.({ type: 'allNotesOff' })
    }
  } catch {
    /* ignore */
  }
  for (const inst of bySlot.values()) {
    allNotesOffSlot(inst.slotId)
  }
}

export function setHostTransportPlaying(playing: boolean, tempo?: number, ppqPos?: number): void {
  try {
    const cmd = {
      type: 'setTransport' as const,
      playing,
      ...(tempo != null ? { tempo } : {}),
      ...(ppqPos != null ? { ppqPos } : {}),
    }
    const api = window.electron
    if (typeof api?.pluginHostMidi === 'function') {
      void api.pluginHostMidi(cmd)
      return
    }
    void api?.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

export async function listSlotParameters(slotId: string): Promise<HostParameterRaw[]> {
  try {
    const api = window.electron
    if (!api?.pluginHostSend) return []
    const raw = (await api.pluginHostSend({
      type: 'listParameters',
      slotId,
      maxCount: 400,
    })) as { ok?: boolean; parameters?: HostParameterRaw[] }
    if (!raw?.ok || !Array.isArray(raw.parameters)) return []
    return raw.parameters.map((p) => ({
      ...p,
      parameterId: String(p.parameterId ?? p.id ?? ''),
      name: p.name || p.shortName || String(p.parameterId ?? ''),
      normalizedValue: Number(p.normalizedValue) || 0,
    }))
  } catch {
    return []
  }
}

export async function setSlotParameter(
  slotId: string,
  parameterId: string | number,
  normalizedValue: number,
): Promise<boolean> {
  try {
    const api = window.electron
    if (!api?.pluginHostSend) return false
    const paramId = Number(parameterId)
    if (!Number.isFinite(paramId)) return false
    const raw = (await api.pluginHostSend({
      type: 'setParameter',
      slotId,
      paramId,
      normalizedValue: Math.max(0, Math.min(1, normalizedValue)),
    })) as { ok?: boolean }
    return !!raw?.ok
  } catch {
    return false
  }
}

export async function getSlotPluginStateBase64(slotId: string): Promise<string | null> {
  try {
    const raw = (await window.electron?.pluginHostSend?.({
      type: 'getPluginState',
      slotId,
    })) as { ok?: boolean; stateBase64?: string }
    if (!raw?.ok || !raw.stateBase64) return null
    return raw.stateBase64
  } catch {
    return null
  }
}

export async function setSlotPluginStateBase64(slotId: string, stateBase64: string): Promise<boolean> {
  try {
    const raw = (await window.electron?.pluginHostSend?.({
      type: 'setPluginState',
      slotId,
      stateBase64,
    })) as { ok?: boolean }
    return !!raw?.ok
  } catch {
    return false
  }
}

type PluginSnapshotFields = {
  parametros: NonNullable<PluginInfo['parametros']>
  estadoPluginBase64?: string
  estado: 'cargado'
}

const avisadoSinChunk = new Set<string>()

async function readLivePluginSnapshot(
  slotId: string,
  previous?: PluginInfo,
): Promise<PluginSnapshotFields | null> {
  if (!bySlot.has(slotId)) return null
  // Restauración pendiente: el estado vivo es el de fábrica; capturarlo pisaría el chunk bueno del proyecto.
  if (restauracionPendiente(slotId)) return null
  // Chunk primero: si no cambió respecto al guardado, se reutilizan los parámetros previos y se evita
  // listParameters (hasta 400 params con el mutex del host tomado) en cada autosave.
  const chunk = await getSlotPluginStateBase64(slotId)
  let parametros: PluginSnapshotFields['parametros']
  if (chunk && previous?.estadoPluginBase64 === chunk && previous.parametros?.length) {
    parametros = previous.parametros
  } else {
    const rawParams = await listSlotParameters(slotId)
    parametros = rawParams.map((rp) => ({
      id: String(rp.parameterId),
      nombre: rp.name || String(rp.parameterId),
      valor: Number(rp.normalizedValue) || 0,
      minimo: 0,
      maximo: 1,
      paso: 0.001,
      unidad: '',
      etiqueta: rp.name || String(rp.parameterId),
    }))
  }
  // Host caído/reiniciándose: sin chunk y sin parámetros no hay nada fiable que capturar; no pisar el
  // estado guardado con una lista vacía.
  if (!chunk && parametros.length === 0) return null
  if (!chunk && !avisadoSinChunk.has(slotId)) {
    avisadoSinChunk.add(slotId) // una vez por slot: el autoguardado periódico no debe inundar la consola
    console.warn('[track-vst] snapshot sin chunk para', slotId, '— se conserva estado previo si existe')
  }
  return {
    parametros,
    ...(chunk
      ? { estadoPluginBase64: chunk }
      : previous?.estadoPluginBase64
        ? { estadoPluginBase64: previous.estadoPluginBase64 }
        : {}),
    estado: 'cargado',
  }
}

/** Persiste params + chunk de un slot concreto (p.ej. al cerrar el editor VST). */
export async function snapshotTrackPluginIntoProject(
  tienda: import('../../../../shared/src/state/tienda').TiendaDAW,
  trackId: string,
  pluginId: string,
): Promise<{ ok: boolean; hasChunk: boolean }> {
  const slotId = slotIdForTrackPlugin(trackId, pluginId)
  if (trackId === 'master') {
    const mNow = tienda.obtenerEstado().project.master
    const pl = (mNow?.plugins ?? []).find((p) => p.id === pluginId)
    if (!pl || !extractHostPluginPath(pl.descripcion, pl.id)) return { ok: false, hasChunk: false }
    const snap = await readLivePluginSnapshot(slotId, pl)
    if (!snap) return { ok: false, hasChunk: false }
    // Snapshot invisible: sin undo ni "modificado", y solo si el estado cambió.
    if (!snapshotPluginSinCambios(pl, snap)) {
      await tienda.executor.execute('master.snapshotPluginState', { pluginInstanceId: pluginId, ...snap })
    }
    return { ok: true, hasChunk: Boolean(snap.estadoPluginBase64) }
  }
  const live = tienda.obtenerEstado().project.tracks.find((x) => x.id === trackId)
  const pl = (live?.plugins ?? []).find((p) => p.id === pluginId)
  if (!pl || !extractHostPluginPath(pl.descripcion, pl.id)) return { ok: false, hasChunk: false }
  const snap = await readLivePluginSnapshot(slotId, pl)
  if (!snap) return { ok: false, hasChunk: false }
  if (!snapshotPluginSinCambios(pl, snap)) {
    await tienda.executor.execute('track.snapshotPluginState', { trackId, pluginInstanceId: pluginId, ...snap })
  }
  return { ok: true, hasChunk: Boolean(snap.estadoPluginBase64) }
}

/** Lee params (+ chunk VST2/VST3) del host y los escribe en DAWState.plugins. */
export async function snapshotLoadedPluginsIntoProject(
  tienda: import('../../../../shared/src/state/tienda').TiendaDAW,
  opts?: {
    /** false = solo slots ya cargados (autoguardado periódico: no debe cargar plugins en segundo plano). */
    cargar?: boolean
  },
): Promise<{ slots: number; withChunk: number }> {
  // Asegura slots cargados antes de snapshot (evita guardar sin chunk en pistas recién abiertas).
  if (opts?.cargar !== false) try {
    const st = tienda.obtenerEstado()
    await ensureProjectVstInstruments(
      (st.project.tracks ?? []).map((t) => ({ id: t.id, plugins: t.plugins })),
      st.project.master?.plugins,
    )
  } catch {
    /* best-effort */
  }
  let slots = 0
  let withChunk = 0
  const tracks = tienda.obtenerEstado().project.tracks ?? []
  for (const t of tracks) {
    for (const p of t.plugins ?? []) {
      if (!extractHostPluginPath(p.descripcion, p.id)) continue
      const r = await snapshotTrackPluginIntoProject(tienda, t.id, p.id)
      if (r.ok) {
        slots += 1
        if (r.hasChunk) withChunk += 1
      }
    }
  }
  const master = tienda.obtenerEstado().project.master?.plugins ?? []
  for (const p of master) {
    if (!extractHostPluginPath(p.descripcion, p.id)) continue
    const r = await snapshotTrackPluginIntoProject(tienda, 'master', p.id)
    if (r.ok) {
      slots += 1
      if (r.hasChunk) withChunk += 1
    }
  }
  return { slots, withChunk }
}

async function restorePluginStateAfterLoad(trackId: string, plugin: PluginInfo): Promise<void> {
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  // Chunk VST = fuente de verdad. El estado vivo guardado al mover el plugin de cadena es más nuevo que el
  // del proyecto. No overlay de params si el chunk entra (pisaría el estado del editor).
  const chunk = verEstadoParaMover(plugin.id) ?? plugin.estadoPluginBase64
  const ok = await restaurarEstadoSlot({
    slotId,
    chunk,
    aplicar: setSlotPluginStateBase64,
    aplicarParametros: async () => {
      for (const p of plugin.parametros ?? []) {
        if (p.id == null || p.valor == null) continue
        await setSlotParameter(slotId, p.id, p.valor)
      }
    },
  })
  if (ok) {
    descartarEstadoParaMover(plugin.id)
  } else {
    console.warn(
      '[track-vst] setPluginState falló; el slot queda pendiente (no se sobrescribe el estado guardado)',
      slotId,
    )
  }
}

/** Reintenta las restauraciones pendientes (llamado por el autoguardado). */
export async function reintentarRestauracionesPendientes(
  tienda: import('../../../../shared/src/state/tienda').TiendaDAW,
): Promise<void> {
  for (const slotId of listarRestauracionesPendientes()) {
    const info = bySlot.get(slotId)
    if (!info) {
      olvidarRestauraciones(slotId)
      continue
    }
    const st = tienda.obtenerEstado().project
    const chain = info.trackId === 'master' ? st.master?.plugins : st.tracks.find((t) => t.id === info.trackId)?.plugins
    const plugin = (chain ?? []).find((p) => p.id === info.pluginId)
    if (!plugin) {
      olvidarRestauraciones(slotId)
      continue
    }
    await restorePluginStateAfterLoad(info.trackId, plugin)
  }
}

/**
 * Autoguardado periódico del estado de los VST cargados hacia el proyecto (y al cerrarse un editor).
 * El estado interno de un plugin (kit de BFD, mezcla…) no mueve la tienda, así que ningún otro disparador de
 * autoguardado lo detecta. Corre en segundo plano, se omite durante el play y no carga plugins.
 */
export function iniciarAutoguardadoEstadoVst(
  tienda: import('../../../../shared/src/state/tienda').TiendaDAW,
  opts?: { intervaloMs?: number },
): { detener: () => void; ahora: () => Promise<boolean> } {
  // Las ventanas satélite (undock) no son dueñas del proyecto: no capturan estado.
  try {
    if (isUndockWindow()) return { detener: () => undefined, ahora: async () => false }
  } catch {
    /* ignore */
  }
  const auto = crearAutoguardadoEstadoVst({
    intervaloMs: opts?.intervaloMs,
    ocupado: () => audioEngine.getIsPlaying() || bySlot.size === 0,
    reintentarPendientes: () => reintentarRestauracionesPendientes(tienda),
    capturar: () => snapshotLoadedPluginsIntoProject(tienda, { cargar: false }),
  })
  auto.start()
  void import('./plugin-windows').then((m) => {
    m.registrarCapturaAlCerrarEditor(async (w) => {
      await snapshotTrackPluginIntoProject(tienda, w.trackId, w.pluginId)
    })
  })
  return {
    detener: () => {
      auto.stop()
      void import('./plugin-windows').then((m) => m.registrarCapturaAlCerrarEditor(null))
    },
    ahora: auto.tick,
  }
}

/**
 * Captura final antes de cerrar la app (el host sigue vivo en este punto). Con tope de tiempo: el cierre
 * no puede quedar colgado por un sampler pesado.
 */
export async function capturarEstadoVstAlCerrar(
  tienda: import('../../../../shared/src/state/tienda').TiendaDAW,
  maxMs = 2500,
): Promise<boolean> {
  if (bySlot.size === 0) return true
  const r = await Promise.race([
    snapshotLoadedPluginsIntoProject(tienda, { cargar: false }).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), maxMs)),
  ]).catch(() => false)
  return r
}

/** Solo pruebas. */
export function __resetEstadoVstParaPruebas(): void {
  olvidarRestauraciones()
  limpiarEstadoParaMover()
}

export type PluginProbeResult = {
  ok: boolean
  pluginId?: string
  path?: string
  message: string
  slotId?: string
}

/**
 * Instancia temporal en el host para comprobar si el VST carga.
 * Descarga el slot al terminar (no deja el plugin en el proyecto).
 */
export async function probePluginLoad(opts: {
  path: string
  pluginId?: string
}): Promise<PluginProbeResult> {
  const path = opts.path.trim()
  if (!path) return { ok: false, message: 'Sin ruta de plugin' }
  if (!window.electron?.pluginHostEnsure || !window.electron.pluginHostSend) {
    return { ok: false, path, message: 'Plugin host no disponible' }
  }
  const slotId = `__probe_${Date.now().toString(36)}`
  try {
    await window.electron.pluginHostEnsure()
    const audio = (await window.electron.pluginHostSend({ type: 'getAudioDevice' })) as {
      audio?: { running?: boolean }
    }
    if (!audio?.audio?.running) {
      await window.electron.pluginHostSend({ type: 'ensureAudio' })
    }
    const raw = await window.electron.pluginHostSend({
      type: 'load',
      path,
      slotId,
      pluginId: opts.pluginId ?? 'probe',
      sampleRate: 48000,
      blockSize: 512,
    })
    const ok = !!(raw && typeof raw === 'object' && (raw as { ok?: boolean }).ok)
    const msg =
      raw && typeof raw === 'object' && 'message' in raw
        ? String((raw as { message: unknown }).message)
        : ok
          ? 'Carga OK'
          : 'load falló'
    await releaseSlot(slotId)
    return { ok, pluginId: opts.pluginId, path, message: msg, slotId }
  } catch (err) {
    try {
      await releaseSlot(slotId)
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      pluginId: opts.pluginId,
      path,
      message: err instanceof Error ? err.message : 'probe falló',
    }
  }
}

