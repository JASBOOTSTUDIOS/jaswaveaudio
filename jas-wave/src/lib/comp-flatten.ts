/**
 * Render comp → clip único (mezcla offline de segmentos).
 */

import { beatsASegundos } from '@/lib/audio-conversions'
import { encodeWavPcm16 } from './encode-wav'
import { audioEngine } from '@/lib/audio-engine'
import type { DAWState } from '../../../shared/src/types/state'

export async function flattenCompToClip(
  tienda: {
    executor: {
      execute: (
        type: string,
        payload: Record<string, unknown>,
      ) => Promise<{ success: boolean; result?: unknown; error?: { message?: string } }>
    }
    obtenerEstado: () => DAWState
  },
  pistaId: string,
  opts?: { nombre?: string },
): Promise<{ clipId?: string; error?: string }> {
  const state = tienda.obtenerEstado()
  const folder = state.project.takeFolders?.find((f) => f.pistaId === pistaId)
  if (!folder?.segments.length) {
    return { error: 'Sin segmentos de comp para aplanar' }
  }

  const bpm = state.project.bpm?.valor ?? 120
  const sr = state.project.sampleRate ?? 48000
  const tlStart = Math.min(...folder.segments.map((s) => s.timelineInicio))
  const tlEnd = Math.max(...folder.segments.map((s) => s.timelineFin))
  const durationSec = beatsASegundos(tlEnd - tlStart, bpm)
  const frames = Math.max(1, Math.ceil(durationSec * sr))

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: sr })
  const dest = ctx.createGain()
  dest.connect(ctx.destination)

  for (const seg of folder.segments) {
    const take = folder.takes.find((t) => t.id === seg.takeId)
    if (!take?.archivo) continue
    let buffer = audioEngine.getAudioBuffer(take.archivo)
    if (!buffer) {
      try {
        const bin = await window.electron?.fileReadBinary?.(take.archivo)
        if (bin) buffer = await audioEngine.decodeArrayBuffer(take.archivo, bin.buffer as ArrayBuffer)
      } catch {
        /* ignore */
      }
    }
    if (!buffer) continue

    const segStartSec = beatsASegundos(seg.timelineInicio - tlStart, bpm)
    const segDurSec = beatsASegundos(seg.timelineFin - seg.timelineInicio, bpm)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(dest)
    src.start(segStartSec, seg.origenInicio, Math.min(segDurSec, buffer.duration - seg.origenInicio))
  }

  const rendered = await ctx.startRendering()
  const wav = encodeWavPcm16(
    [rendered.getChannelData(0), rendered.getChannelData(1)],
    sr,
  )
  const fileName = `comp-${pistaId}-${Date.now()}.wav`
  const dir = await window.electron?.recordingsDir?.()
  const path = dir ? `${dir}/${fileName}` : fileName
  await window.electron?.fileSaveBinary?.(path, wav)
  audioEngine.setAudioBuffer(path, rendered)

  const cr = await tienda.executor.execute('clip.create', {
    pistaId,
    nombre: opts?.nombre ?? 'Comp',
    inicio: tlStart,
    duracion: tlEnd - tlStart,
    sourceId: path,
  })
  if (!cr.success) return { error: String(cr.error?.message ?? 'clip.create falló') }
  const clipId = (cr.result as { clipId?: string })?.clipId
  return { clipId }
}
