/**
 * Runtime VST3 por pista (estilo Reaper): load de toda la cadena
 * (instrumento + efectos) en Plugin Host + MIDI.
 */

import type { PluginInfo } from '../../../../shared/src/types/entidades'
import {
  extractHostPluginPath,
  guessIsInstrument,
  isBuiltinPlugin,
  isLikelyAudioFx,
  resolveHostPluginPath,
} from './plugin-info-adapter'
import { setActiveVstVoiceTarget, getActiveVstVoiceTarget } from './vst-voice-router'
import { encodeTrackGraph } from './track-graph-encoding'
import { audioEngine } from '@/lib/audio-engine'
import type { HostParameterRaw } from './plugin-parameter-intel'
import { getEditorPreviewTrackId } from './editor-preview-focus'

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
const runtimeListeners = new Set<() => void>()
let runtimeGeneration = 0
let lastVstLoadError = ''

export function getLastVstLoadError(): string {
  return lastVstLoadError
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
  lastVstLoadError = ''
  emitRuntime()
}

export async function releaseSlot(slotId: string): Promise<void> {
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
      if (extractHostPluginPath(p.descripcion, p.id)) live.add(slotIdForTrackPlugin(t.id, p.id))
    }
  }
  for (const p of masterPlugins ?? []) {
    if (isBuiltinInstrument(p)) continue
    if (extractHostPluginPath(p.descripcion, p.id)) live.add(slotIdForTrackPlugin('master', p.id))
  }
  for (const slotId of [...bySlot.keys()]) {
    if (!live.has(slotId)) await releaseSlot(slotId)
  }
}

let lastHostPid = 0
/** Evita ensure concurrentes (lifecycle + play + host restart). */
let ensureProjectInFlight: Promise<Map<string, string>> | null = null
/** Paths en cuarentena ya avisados (no spamear consola). */
const quarantineWarned = new Set<string>()

function isHostDeadLoadError(msg: string): boolean {
  return /stdin cerrado|Plugin Host stdin|salió \(code=|tumbó el Plugin Host|PluginCrashedHost|HostNotReady/i.test(
    msg,
  )
}

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
      await restorePluginStateAfterLoad(trackId, plugin)
      resyncProjectGraph?.()
      return true
    }
    // getLatency falló: no borrar el mapa todavía — re-load abajo; si falla, conservar slot.
  }

  if (instrument) {
    const prevInst = byTrack.get(trackId)
    if (prevInst && prevInst.slotId !== slotId) await releaseSlot(prevInst.slotId)
  }

  const pending = loadPromises.get(slotId)
  if (pending) return pending

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
        } else {
          console.error('[track-vst] load failed', path, msg)
        }
        // Conservar slot previo si el re-load falla (evita silenciar MIDI mid-play).
        if (existing) {
          if (instrument) byTrack.set(trackId, existing)
          return true
        }
        return false
      }
      lastVstLoadError = ''
      const loaded: LoadedPlugin = { trackId, pluginId: plugin.id, path, slotId, instrument }
      bySlot.set(slotId, loaded)
      if (instrument) {
        byTrack.set(trackId, loaded)
        setActiveVstVoiceTarget({ slotId, path, trackId, pluginId: plugin.id })
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
        return Boolean(extractHostPluginPath(p.descripcion, p.id))
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
        if (!extractHostPluginPath(p.descripcion, p.id)) continue
        jobs.push({ trackId: t.id, plugin: p, name: p.nombre || p.id })
      }
    }
    for (const p of masterPlugins ?? []) {
      if (p.bypass || isBuiltinInstrument(p)) continue
      if (!extractHostPluginPath(p.descripcion, p.id)) continue
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
      cantidad?: number
    }>
    buses?: Array<{ id: string }>
  } | null,
): void {
  const anySolo = tracks.some((t) => t.soloActiva)

  const stemByTrackId = new Map(tracks.map((t, i) => [t.id, i]))
  for (const b of routing?.buses ?? []) {
    if (!stemByTrackId.has(b.id)) {
      // bus id puede coincidir con track id; si no, se resuelve vía destinoBusId→track
    }
  }

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

  const sidechainsByDest = new Map<string, Array<{ srcStem: number; amount: number }>>()
  for (const sc of routing?.sidechains ?? []) {
    if (sc.activo === false) continue
    const amount = Math.max(0, Math.min(1, Number(sc.cantidad ?? 1)))
    if (amount <= 0) continue
    const srcStem = stemByTrackId.get(sc.origenTrackId)
    if (srcStem == null) continue
    const list = sidechainsByDest.get(sc.destinoTrackId) ?? []
    list.push({ srcStem, amount })
    sidechainsByDest.set(sc.destinoTrackId, list)
  }

  const graphTracks = tracks.map((t, stemIndex) => {
    const previewId = getEditorPreviewTrackId()
    const muted =
      previewId === t.id ? false : anySolo ? !t.soloActiva : Boolean(t.silenciada)
    const slots: Array<{ slotId: string; instrument: boolean; bypass: boolean }> = []
    for (const p of t.plugins ?? []) {
      // VST3 con ruta: nunca tratar como builtin (licencia «JasWave» ≠ in-process).
      const path = extractHostPluginPath(p.descripcion, p.id)
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
      slots: [{ slotId: loaded.slotId, instrument: true, bypass: false }],
      sends: [],
      sidechains: [],
    })
    usedSlotIds.add(loaded.slotId)
    stemIds.push(loaded.trackId)
  }
  audioEngine.setTrackStemLayout(stemIds)

  const master: Array<{ slotId: string; instrument: boolean; bypass: boolean }> = []
  for (const p of masterPlugins ?? []) {
    if (isBuiltinInstrument(p)) continue
    const path = extractHostPluginPath(p.descripcion, p.id)
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

async function readLivePluginSnapshot(
  slotId: string,
  previous?: PluginInfo,
): Promise<PluginSnapshotFields | null> {
  if (!bySlot.has(slotId)) return null
  const rawParams = await listSlotParameters(slotId)
  const parametros = rawParams.map((rp) => ({
    id: String(rp.parameterId),
    nombre: rp.name || String(rp.parameterId),
    valor: Number(rp.normalizedValue) || 0,
    minimo: 0,
    maximo: 1,
    paso: 0.001,
    unidad: '',
    etiqueta: rp.name || String(rp.parameterId),
  }))
  const chunk = await getSlotPluginStateBase64(slotId)
  if (!chunk) {
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
    const nextPlugins = (mNow?.plugins ?? []).map((p) => (p.id === pluginId ? { ...p, ...snap } : p))
    await tienda.executor.execute('project.update', {
      datos: { master: { ...mNow, plugins: nextPlugins } },
    })
    return { ok: true, hasChunk: Boolean(snap.estadoPluginBase64) }
  }
  const live = tienda.obtenerEstado().project.tracks.find((x) => x.id === trackId)
  const pl = (live?.plugins ?? []).find((p) => p.id === pluginId)
  if (!pl || !extractHostPluginPath(pl.descripcion, pl.id)) return { ok: false, hasChunk: false }
  const snap = await readLivePluginSnapshot(slotId, pl)
  if (!snap) return { ok: false, hasChunk: false }
  const nextPlugins = (live?.plugins ?? []).map((p) => (p.id === pluginId ? { ...p, ...snap } : p))
  await tienda.executor.execute('track.update', {
    trackId,
    datos: { plugins: nextPlugins },
  })
  return { ok: true, hasChunk: Boolean(snap.estadoPluginBase64) }
}

/** Lee params (+ chunk VST2/VST3) del host y los escribe en DAWState.plugins. */
export async function snapshotLoadedPluginsIntoProject(
  tienda: import('../../../../shared/src/state/tienda').TiendaDAW,
): Promise<{ slots: number; withChunk: number }> {
  // Asegura slots cargados antes de snapshot (evita guardar sin chunk en pistas recién abiertas).
  try {
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
  // Chunk VST = fuente de verdad. No overlay de params (pisaría el estado del editor).
  if (plugin.estadoPluginBase64) {
    const ok = await setSlotPluginStateBase64(slotId, plugin.estadoPluginBase64)
    if (ok) return
    console.warn('[track-vst] setPluginState falló; fallback a parámetros', slotId)
  }
  for (const p of plugin.parametros ?? []) {
    if (p.id == null || p.valor == null) continue
    await setSlotParameter(slotId, p.id, p.valor)
  }
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

