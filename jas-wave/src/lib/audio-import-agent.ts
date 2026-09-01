/**
 * Importación de audio para acciones del agente (audio.import, reference.*).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { audioEngine } from '@/lib/audio-engine'
import { extractStereoPeaks, packStereoPeaks } from '@/lib/stereo-peaks'

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

  return { trackId, bufferKey, durationSec, clipId: (clipRes.result as { clipId?: string })?.clipId }
}

type ReferenceAbState = {
  referenceTrackId: string | null
  mode: 'mix' | 'reference'
  savedMutes: Record<string, boolean>
}

const g = globalThis as unknown as { __jaswaveReferenceAb?: ReferenceAbState }

function refState(): ReferenceAbState {
  if (!g.__jaswaveReferenceAb) {
    g.__jaswaveReferenceAb = { referenceTrackId: null, mode: 'mix', savedMutes: {} }
  }
  return g.__jaswaveReferenceAb
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

export async function toggleReferenceAb(
  tienda: TiendaDAW,
  mode?: 'mix' | 'reference' | 'toggle',
): Promise<{ mode: 'mix' | 'reference'; referenceTrackId: string | null }> {
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

  if (nextMode === 'reference') {
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
  }

  st.mode = nextMode
  st.referenceTrackId = refId
  return { mode: nextMode, referenceTrackId: refId }
}
