/**
 * Bounce WAV vía plugin-host renderOffline* + loudness BS.1770.
 */

import { encodeStemPacket } from '@/src/lib/plugin/track-graph-encoding'
import { measureLoudnessBs1770 } from '../../../shared/src/audio/loudness-bs1770'
import { renderJobGet, renderJobUpdate } from '../../../shared/src/render/job-store'
import type { RenderJob } from '../../../shared/src/types/render'

const BLOCK = 512

async function hostSend(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = window.electron
  if (!api?.pluginHostSend) throw new Error('Plugin host no disponible')
  await api.pluginHostEnsure?.()
  const raw = (await api.pluginHostSend(cmd)) as Record<string, unknown>
  if (raw && raw.ok === false) {
    throw new Error(String(raw.message ?? raw.code ?? 'render host error'))
  }
  return raw ?? {}
}

function decodeWavPcm16Stereo(bin: Uint8Array): { l: Float32Array; r: Float32Array; sampleRate: number } | null {
  if (bin.byteLength < 44) return null
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  if (view.getUint32(0, false) !== 0x52494646) return null // 'RIFF' BE check via chars
  const sampleRate = view.getUint32(24, true)
  const dataSize = view.getUint32(40, true)
  const numFrames = Math.floor(dataSize / 4)
  const l = new Float32Array(numFrames)
  const r = new Float32Array(numFrames)
  let o = 44
  for (let i = 0; i < numFrames && o + 3 < bin.byteLength; i++) {
    l[i] = view.getInt16(o, true) / 32768
    r[i] = view.getInt16(o + 2, true) / 32768
    o += 4
  }
  return { l, r, sampleRate }
}

export async function runNativeBounce(
  job: RenderJob,
  emit?: (nombre: string, payload: Record<string, unknown>) => void,
): Promise<RenderJob> {
  const startSec = job.start.segundos ?? 0
  const endSec = job.end.segundos ?? startSec + 1
  const duration = Math.max(0.1, endSec - startSec)
  const sr = job.sampleRate || 48000
  const totalFrames = Math.ceil(duration * sr)

  let outPath = job.outputPath
  if (!outPath) {
    try {
      const dir = await window.electron?.recordingsDir?.()
      outPath = dir ? `${dir}/bounce-${job.id}.wav` : `bounce-${job.id}.wav`
    } catch {
      outPath = `bounce-${job.id}.wav`
    }
  }

  renderJobUpdate(job.id, { status: 'rendering', progress: 0, outputPath: outPath })
  emit?.('render.progress', { jobId: job.id, progress: 0 })

  await hostSend({
    type: 'renderOfflineStart',
    outPath,
    totalFrames,
    blockSize: BLOCK,
    sampleRate: sr,
  })

  let done = 0
  while (done < totalFrames) {
    if (renderJobGet(job.id)?.status === 'cancelled') {
      await hostSend({ type: 'renderOfflineCancel' })
      emit?.('render.cancelled', { jobId: job.id })
      return renderJobGet(job.id) ?? { ...job, status: 'cancelled' }
    }
    const frames = Math.min(BLOCK, totalFrames - done)
    const silence = new Float32Array(frames * 2)
    for (let stem = 0; stem < 8; stem++) {
      window.electron?.pluginHostPushPcm?.(encodeStemPacket(stem, silence))
    }
    const step = await hostSend({ type: 'renderOfflineStep' })
    const progress = typeof step.progress === 'number' ? step.progress : done / totalFrames
    done = typeof step.doneFrames === 'number' ? Number(step.doneFrames) : done + frames
    renderJobUpdate(job.id, {
      status: 'rendering',
      progress: Math.min(99, Math.round(progress * 100)),
    })
    emit?.('render.progress', { jobId: job.id, progress })
  }

  const finish = await hostSend({ type: 'renderOfflineFinish' })
  const path = String(finish.path ?? outPath)
  const framesOut = typeof finish.frames === 'number' ? Number(finish.frames) : totalFrames
  const finishSr = typeof finish.sampleRate === 'number' ? Number(finish.sampleRate) : sr

  let loudness = measureLoudnessBs1770(
    [new Float32Array(Math.min(framesOut, 1)), new Float32Array(Math.min(framesOut, 1))],
    finishSr,
  )
  try {
    const bin = (await window.electron?.fileReadBinary?.(path)) as Uint8Array | undefined
    if (bin) {
      const pcm = decodeWavPcm16Stereo(bin)
      if (pcm) loudness = measureLoudnessBs1770([pcm.l, pcm.r], pcm.sampleRate || finishSr)
    }
  } catch {
    /* sin archivo legible */
  }

  const completed = renderJobUpdate(job.id, {
    status: 'completed',
    progress: 100,
    outputPath: path,
    frames: framesOut,
    loudness,
  })!
  emit?.('render.completed', { jobId: job.id, path, loudness })
  return completed
}
