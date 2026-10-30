/**
 * Importación de audio para acciones del agente (audio.import, reference.*).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { obtenerProveedorAnalisis } from '../../../shared/src/audio/analysis-provider'
import { getStateRevision } from '../../../shared/src/state/state-revision'
import { audioEngine } from '@/lib/audio-engine'
import { extractStereoPeaks, packStereoPeaks } from '@/lib/stereo-peaks'
import { copiarRutaAlProyecto, guardarWaveformPeak, sanitizarNombreArchivo } from '@/src/lib/project-media'
import { makeRecordingFileName, saveRecordingWav, saveRecordingWavFallback } from '@/src/lib/audio-recording-persist'
import { encodeWavFromAudioBuffer } from '@/src/lib/encode-wav'

function projectBpm(st: ReturnType<TiendaDAW['obtenerEstado']>): number {
  const bpmObj = st.project?.bpm as { valor?: number } | undefined
  const bpm = bpmObj?.valor ?? (st.transport as { bpm?: number } | undefined)?.bpm
  return typeof bpm === 'number' && bpm > 0 ? bpm : 120
}

function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60
}

function baseName(path: string): string {
  const leaf = path.replace(/\\/g, '/').split('/').pop() ?? path
  return leaf.replace(/\.[^.]+$/, '') || leaf
}

export type AudioImportOpts = {
  filePath: string
  trackId?: string
  pistaId?: string
  inicio?: number
  startSec?: number
  nombre?: string
  createTrack?: boolean
  trackName?: string
}

export async function importAudioToTrack(
  tienda: TiendaDAW,
  opts: AudioImportOpts,
): Promise<{ trackId: string; clipId?: string; bufferKey: string; durationSec: number }> {
  const filePath = opts.filePath?.trim()
  if (!filePath) throw new Error('filePath requerido para audio.import')

  const api = typeof window !== 'undefined' ? window.electron : undefined
  if (!api?.fileReadBinary) {
    throw new Error('audio.import requiere Electron (fileReadBinary)')
  }

  const raw = await api.fileReadBinary(filePath)
  let ab: ArrayBuffer
  if (raw instanceof ArrayBuffer) {
    ab = raw
  } else if (ArrayBuffer.isView(raw)) {
    ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  } else {
    ab = new Uint8Array(raw as ArrayBuffer).buffer
  }

  let trackId = opts.trackId ?? opts.pistaId
  if (!trackId && opts.createTrack !== false) {
    const created = await tienda.executor.execute('track.create', {
      nombre: opts.trackName ?? baseName(filePath),
      tipo: 'audio',
    })
    if (!created.success) throw new Error(created.error?.message ?? 'No se pudo crear pista audio')
    trackId = (created.result as { trackId?: string })?.trackId
  }
  if (!trackId) throw new Error('trackId/pistaId requerido o createTrack=true')

  const st = tienda.obtenerEstado()
  const bpm = projectBpm(st)
  const bufferKey = `import-${trackId}-${Date.now()}`
  const buffer = await audioEngine.decodeArrayBuffer(bufferKey, ab)
  const durationSec = buffer.duration
  const durationBeats = secondsToBeats(durationSec, bpm)
  const startBeats =
    typeof opts.inicio === 'number'
      ? opts.inicio
      : typeof opts.startSec === 'number'
        ? secondsToBeats(opts.startSec, bpm)
        : 0

  const buckets = Math.min(4096, Math.max(512, Math.floor(durationSec * 80)))
  const waveform = packStereoPeaks(extractStereoPeaks(buffer, buckets))

  const clipRes = await tienda.executor.execute('clip.create', {
    pistaId: trackId,
    nombre: opts.nombre ?? baseName(filePath),
    inicio: startBeats,
    duracion: durationBeats,
    sourceId: bufferKey,
    waveform,
  })

  if (!clipRes.success) throw new Error(clipRes.error?.message ?? 'clip.create falló')
  const clipId = (clipRes.result as { clipId?: string })?.clipId

  // Copia el archivo al media del proyecto y reapunta el clip a la ruta relativa:
  // el proyecto sigue sonando al abrirlo en otra carpeta u otro equipo.
  const proyecto = tienda.obtenerEstado().project
  const copia = await copiarRutaAlProyecto(filePath, proyecto?.ruta)
  if (copia.rutaRelativa && clipId) {
    const set = await tienda.executor.execute('clip.setSource', {
      pistaId: trackId,
      clipId,
      sourceId: copia.rutaRelativa,
    })
    if (set.success) {
      audioEngine.setAudioBuffer(copia.rutaRelativa, buffer)
      return { trackId, bufferKey: copia.rutaRelativa, durationSec, clipId }
    }
  }

  return { trackId, bufferKey, durationSec, clipId }
}

export type AudioBytesImportOpts = {
  /** Audio en cualquier formato que Web Audio sepa decodificar (wav, mp3, webm…). */
  bytes: ArrayBuffer
  nombre: string
  trackId?: string
  inicio?: number
  /** Nombre de la pista si hay que crearla. */
  trackName?: string
}

/**
 * Inserta audio en memoria (nota de voz del chat, archivo soltado) como clip
 * real: se guarda como WAV en `media/grabaciones/` del proyecto (o en userData
 * si aún no hay proyecto) y el clip apunta a ese archivo, así suena, se exporta
 * y sobrevive al guardar y reabrir. Todo pasa por comandos (deshacer).
 */
export async function importAudioBytesToTrack(
  tienda: TiendaDAW,
  opts: AudioBytesImportOpts,
): Promise<{ trackId: string; clipId?: string; sourceId: string; durationSec: number; dentroDelProyecto: boolean }> {
  const tempKey = `chat-audio-${Date.now()}`
  const buffer = await audioEngine.decodeArrayBuffer(tempKey, opts.bytes.slice(0))
  const durationSec = buffer.duration
  if (!(durationSec > 0.02)) throw new Error('El audio está vacío')

  const wav = encodeWavFromAudioBuffer(buffer)
  const fileName = makeRecordingFileName(sanitizarNombreArchivo(opts.nombre).replace(/\.[^.]+$/, '') || 'audio')
  const ruta = tienda.obtenerEstado().project?.ruta
  const guardado = (await saveRecordingWav(wav, fileName, ruta)) ?? (await saveRecordingWavFallback(wav, fileName))
  if (!guardado) throw new Error('No se pudo guardar el audio en disco: revisa los permisos o el espacio libre')
  const sourceId = guardado.sourceId
  audioEngine.setAudioBuffer(sourceId, buffer)

  let trackId = opts.trackId
  if (!trackId) {
    const created = await tienda.executor.execute('track.create', { nombre: opts.trackName ?? 'Audio', tipo: 'audio' })
    if (!created.success) throw new Error(created.error?.message ?? 'No se pudo crear la pista de audio')
    trackId = (created.result as { trackId?: string })?.trackId
  }
  if (!trackId) throw new Error('No se pudo crear la pista de audio')

  const buckets = Math.min(4096, Math.max(256, Math.floor(durationSec * 80)))
  const waveform = packStereoPeaks(extractStereoPeaks(buffer, buckets))
  const clipRes = await tienda.executor.execute('clip.create', {
    pistaId: trackId,
    nombre: opts.nombre.replace(/\.[^.]+$/, '') || 'Audio',
    inicio: opts.inicio ?? 0,
    duracion: secondsToBeats(durationSec, projectBpm(tienda.obtenerEstado())),
    sourceId,
    waveform,
  })
  if (!clipRes.success) throw new Error(clipRes.error?.message ?? 'No se pudo crear el clip')
  void guardarWaveformPeak(sourceId, waveform, ruta)
  return {
    trackId,
    clipId: (clipRes.result as { clipId?: string })?.clipId,
    sourceId,
    durationSec,
    dentroDelProyecto: sourceId !== guardado.absPath,
  }
}

type ReferenceAbState = {
  referenceTrackId: string | null
  mode: 'mix' | 'reference'
  savedMutes: Record<string, boolean>
  /** Volumen original de la referencia antes de la igualación de loudness. */
  savedVolumenRef: number | null
  /** Estado previo de bypass de la cadena master (vacío si no se tocó). */
  savedBypassMaster: Array<{ pluginInstanceId: string; bypass: boolean }> | null
  /** Ganancia (dB) aplicada a la referencia para igualar loudness. */
  gananciaAplicadaDb: number | null
}

const g = globalThis as unknown as { __jaswaveReferenceAb?: ReferenceAbState }

function refState(): ReferenceAbState {
  if (!g.__jaswaveReferenceAb) {
    g.__jaswaveReferenceAb = {
      referenceTrackId: null,
      mode: 'mix',
      savedMutes: {},
      savedVolumenRef: null,
      savedBypassMaster: null,
      gananciaAplicadaDb: null,
    }
  }
  const st = g.__jaswaveReferenceAb
  st.savedVolumenRef ??= null
  st.savedBypassMaster ??= null
  st.gananciaAplicadaDb ??= null
  return st
}

export function findReferenceTrackId(tienda: TiendaDAW): string | null {
  const st = refState()
  if (st.referenceTrackId) {
    const exists = tienda.obtenerEstado().project?.tracks?.some((t) => t.id === st.referenceTrackId)
    if (exists) return st.referenceTrackId
  }
  const tagged = tienda.obtenerEstado().project?.tracks?.find((t) => {
    const meta = (t as { metadatos?: Record<string, unknown> }).metadatos
    return meta?.esReferencia === true || meta?.reference === true
  })
  if (tagged) {
    st.referenceTrackId = tagged.id
    return tagged.id
  }
  const byName = tienda.obtenerEstado().project?.tracks?.find((t) => /^referencia|reference/i.test(t.nombre ?? ''))
  if (byName) {
    st.referenceTrackId = byName.id
    return byName.id
  }
  return null
}

export async function importReferenceTrack(
  tienda: TiendaDAW,
  opts: { filePath: string; nombre?: string },
): Promise<{ trackId: string; bufferKey: string }> {
  let refId = findReferenceTrackId(tienda)
  if (!refId) {
    const created = await tienda.executor.execute('track.create', {
      nombre: opts.nombre ?? 'Referencia',
      tipo: 'audio',
    })
    if (!created.success) throw new Error(created.error?.message ?? 'No se pudo crear pista referencia')
    refId = (created.result as { trackId?: string })?.trackId ?? null
    if (!refId) throw new Error('trackId referencia vacío')
    await tienda.executor.execute('track.update', {
      trackId: refId,
      datos: {
        metadatos: { esReferencia: true, reference: true },
        silenciada: true,
        color: '#f59e0b',
      },
    })
    refState().referenceTrackId = refId
  }

  const imp = await importAudioToTrack(tienda, {
    filePath: opts.filePath,
    trackId: refId,
    inicio: 0,
    createTrack: false,
    nombre: opts.nombre ?? baseName(opts.filePath),
  })
  refState().referenceTrackId = refId
  return { trackId: refId, bufferKey: imp.bufferKey }
}

type ClipRango = { inicio?: number; duracion?: number; tipo?: string }

function segundosDesdeBeats(beats: number, bpm: number): number {
  return (beats * 60) / bpm
}

/**
 * Rango en el que se compara la referencia con la mezcla: los clips de audio de
 * la propia referencia; si no tiene, el contenido del proyecto; si no, 30 s.
 */
function rangoParaIgualacion(
  estado: ReturnType<TiendaDAW['obtenerEstado']>,
  refId: string,
): { inicioSeg: number; finSeg: number } {
  const bpm = projectBpm(estado)
  const tracks = estado.project?.tracks ?? []
  const ref = tracks.find((t) => t.id === refId)
  const clipsRef = ((ref?.clips ?? []) as unknown as ClipRango[]).filter((c) => c.tipo !== 'midi')
  const origen: ClipRango[] =
    clipsRef.length > 0 ? clipsRef : tracks.flatMap((t) => (t.clips ?? []) as unknown as ClipRango[])

  let inicio = Infinity
  let fin = -Infinity
  for (const c of origen) {
    const s = segundosDesdeBeats(c.inicio ?? 0, bpm)
    const f = s + segundosDesdeBeats(c.duracion ?? 16, bpm)
    if (s < inicio) inicio = s
    if (f > fin) fin = f
  }
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) {
    inicio = 0
    fin = 30
  }
  return { inicioSeg: Math.max(0, inicio), finSeg: Math.max(inicio + 1, fin) }
}

/**
 * Mide mezcla y referencia con el motor de análisis (A7b) y devuelve la ganancia
 * (dB) que hay que aplicar a la referencia para que ambos suenen al mismo nivel.
 * `null` si no hay motor o la medición no es utilizable: A/B sigue funcionando,
 * solo que sin igualación.
 */
async function gananciaAplicarReferencia(
  tienda: TiendaDAW,
  refId: string,
): Promise<number | null> {
  const proveedor = obtenerProveedorAnalisis()
  if (!proveedor) return null
  const estado = tienda.obtenerEstado()
  try {
    const analisis = await proveedor({
      revision: getStateRevision(estado),
      rango: rangoParaIgualacion(estado, refId),
    })
    const medidaRef = analisis.pistas.find((p) => p.trackId === refId)
    const medidaMix = analisis.master
    if (!medidaRef || !Number.isFinite(medidaRef.integrated) || !Number.isFinite(medidaMix.integrated)) {
      return null
    }
    // Sin señal (silencio / por debajo del umbral) no se puede igualar.
    if (medidaRef.integrated <= -70 || medidaMix.integrated <= -70) return null
    const deltaDb = medidaMix.integrated - medidaRef.integrated
    if (!Number.isFinite(deltaDb) || Math.abs(deltaDb) < 0.05) return 0
    return deltaDb
  } catch {
    return null
  }
}

/** Aplica la ganancia de igualación al fader de la referencia (0…2 ≈ −∞…+6 dB). */
async function aplicarGananciaReferencia(tienda: TiendaDAW, refId: string, deltaDb: number): Promise<number | null> {
  const st = refState()
  const ref = tienda.obtenerEstado().project?.tracks?.find((t) => t.id === refId)
  if (!ref) return null
  const volumenBase = typeof ref.volumen === 'number' && Number.isFinite(ref.volumen) ? ref.volumen : 0.8
  const lineal = Math.pow(10, deltaDb / 20)
  const nuevo = Math.max(0, Math.min(2, volumenBase * lineal))
  if (Math.abs(nuevo - volumenBase) < 1e-6) return deltaDb
  const r = await tienda.executor.execute('track.update', { trackId: refId, datos: { volumen: nuevo } })
  if (!r.success) return null
  st.savedVolumenRef = volumenBase
  st.gananciaAplicadaDb = deltaDb
  return deltaDb
}

async function restaurarGananciaReferencia(tienda: TiendaDAW, refId: string): Promise<void> {
  const st = refState()
  const anterior = st.savedVolumenRef
  st.savedVolumenRef = null
  st.gananciaAplicadaDb = null
  if (anterior === null) return
  await tienda.executor.execute('track.update', { trackId: refId, datos: { volumen: anterior } })
}

/**
 * Bypass de la cadena master mientras se escucha la referencia: los plugins
 * master están afinados para la mezcla propia y colorean la referencia.
 */
async function aplicarBypassMaster(tienda: TiendaDAW): Promise<boolean> {
  const st = refState()
  const plugins = tienda.obtenerEstado().project?.master?.plugins ?? []
  const guardados: Array<{ pluginInstanceId: string; bypass: boolean }> = []
  for (const p of plugins) {
    if (p.bypass === true) continue
    const r = await tienda.executor.execute('plugin.bypass', {
      trackId: 'master',
      pluginInstanceId: p.id,
      bypass: true,
    })
    if (r.success) guardados.push({ pluginInstanceId: p.id, bypass: false })
  }
  st.savedBypassMaster = guardados.length > 0 ? guardados : null
  return guardados.length > 0
}

async function restaurarBypassMaster(tienda: TiendaDAW): Promise<void> {
  const st = refState()
  const guardados = st.savedBypassMaster
  st.savedBypassMaster = null
  if (!guardados) return
  for (const item of guardados) {
    await tienda.executor.execute('plugin.bypass', {
      trackId: 'master',
      pluginInstanceId: item.pluginInstanceId,
      bypass: item.bypass,
    })
  }
}

export type ResultadoToggleAb = {
  mode: 'mix' | 'reference'
  referenceTrackId: string | null
  /**
   * Ganancia aplicada al fader de la referencia para igualar su loudness con la
   * mezcla (dB; positiva = la referencia estaba más baja). `null` sin medición.
   * (No confundir con `compararConReferencia().gananciaIgualacionDb`, que tiene
   * el signo contrario: es «cuánto más fuerte está la referencia».)
   */
  gananciaAplicadaDb: number | null
  /** true si la cadena master quedó en bypass mientras se escucha la referencia. */
  bypassMaster: boolean
}

export async function toggleReferenceAb(
  tienda: TiendaDAW,
  mode?: 'mix' | 'reference' | 'toggle',
): Promise<ResultadoToggleAb> {
  const st = refState()
  const refId = findReferenceTrackId(tienda)
  if (!refId) throw new Error('No hay pista de referencia — usa reference.import primero')

  const nextMode =
    mode === 'toggle' || !mode
      ? st.mode === 'mix'
        ? 'reference'
        : 'mix'
      : mode

  const tracks = tienda.obtenerEstado().project?.tracks ?? []
  const actual: 'mix' | 'reference' = st.mode
  if (nextMode === actual) {
    // Idempotente: una segunda llamada en el mismo modo no vuelve a guardar
    // mutes/ganancias (se guardarían ya alterados).
    return {
      mode: actual,
      referenceTrackId: refId,
      gananciaAplicadaDb: st.gananciaAplicadaDb,
      bypassMaster: st.savedBypassMaster !== null,
    }
  }

  if (nextMode === 'reference') {
    // 1) Medir ANTES de silenciar: la referencia se compara contra la mezcla completa.
    const deltaDb = await gananciaAplicarReferencia(tienda, refId)
    if (deltaDb !== null) await aplicarGananciaReferencia(tienda, refId, deltaDb)
    // 2) La referencia no se escucha a través de la cadena master propia.
    await aplicarBypassMaster(tienda)
    // 3) Silenciar el resto.
    st.savedMutes = {}
    for (const t of tracks) {
      st.savedMutes[t.id] = Boolean(t.silenciada)
      const wantMute = t.id !== refId
      if (Boolean(t.silenciada) !== wantMute) {
        await tienda.executor.execute('track.toggleMute', { trackId: t.id })
      }
    }
  } else {
    for (const t of tracks) {
      const wantMute = st.savedMutes[t.id]
      if (wantMute === undefined) continue
      if (Boolean(t.silenciada) !== wantMute) {
        await tienda.executor.execute('track.toggleMute', { trackId: t.id })
      }
    }
    st.savedMutes = {}
    await restaurarGananciaReferencia(tienda, refId)
    await restaurarBypassMaster(tienda)
  }

  st.mode = nextMode
  st.referenceTrackId = refId
  return {
    mode: nextMode,
    referenceTrackId: refId,
    gananciaAplicadaDb: st.gananciaAplicadaDb,
    bypassMaster: st.savedBypassMaster !== null,
  }
}
