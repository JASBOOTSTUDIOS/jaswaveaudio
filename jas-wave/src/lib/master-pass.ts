/**
 * daw.masterPass — orquesta cadena master + bounce + compareTarget.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { PluginInfo } from '../../../shared/src/types/entidades'
import { LOUDNESS_TARGETS, type LoudnessTargetName } from '../../../shared/src/audio/loudness-bs1770'
import { pluginRegistry } from './plugin/registry'
import { descriptorToPluginInfo } from './plugin/plugin-info-adapter'
import { ensureTrackVstPlugin } from './plugin/track-vst-runtime'
import { buildRuntimeBounceContent, runNativeBounce } from './bounce-service'

export type MasterPassOpts = {
  target?: LoudnessTargetName
  genero?: string
  maxTruePeakDb?: number
  minutes?: number
}

export type MasterPassResult = {
  ok: boolean
  message: string
  jobId?: string
  integrated?: number
  deltaDb?: number
  listenSummary?: string
  iterations: number
}

function pickMasterPlugins(genero?: string): PluginInfo[] {
  const catalog = pluginRegistry.list().filter((d) => d.isEffect && d.hostReady)
  const want =
    /metal|rock|club|edm/i.test(genero ?? '')
      ? [/limit|maxim|clip/i, /eq|equal/i, /comp/i]
      : [/limit|maxim/i, /eq|equal/i, /comp|glue/i]
  const out: PluginInfo[] = []
  for (const re of want) {
    const d = catalog.find((p) => re.test(p.name) && !out.some((o) => o.nombre === p.name))
    if (d) out.push(descriptorToPluginInfo(d))
  }
  return out
}

export async function runMasterPass(
  tienda: TiendaDAW,
  opts: MasterPassOpts = {},
): Promise<MasterPassResult> {
  const target = opts.target ?? 'streaming'
  const targetLufs = LOUDNESS_TARGETS[target]
  const plugins = pickMasterPlugins(opts.genero)

  // Aplicar cadena master (sustituye plugins master actuales de FX)
  const st0 = tienda.obtenerEstado()
  const master = st0.project.master
  const nextPlugins = plugins.length ? plugins : master.plugins ?? []
  await tienda.executor.execute('project.update', {
    datos: {
      master: {
        ...master,
        plugins: nextPlugins,
        volumen: master.volumen ?? 0.92,
      },
    },
  })
  for (const pl of nextPlugins) {
    try {
      await ensureTrackVstPlugin('master', pl)
    } catch {
      /* optional */
    }
  }

  let iterations = 0
  let lastDelta = 0
  let lastIntegrated: number = targetLufs
  let lastSummary = ''
  let lastJobId = ''

  for (let i = 0; i < 2; i++) {
    iterations++
    const st = tienda.obtenerEstado()
    const endSec = Math.max(8, (opts.minutes ?? 1) * 60)
    const start = await tienda.executor.execute('render.start', {
      format: 'wav',
      startSec: 0,
      endSec: Math.min(endSec, 120),
      listenTarget: target,
      normalize: false,
    })
    if (!start.success || !start.result) {
      return { ok: false, message: start.error?.message ?? 'render.start falló', iterations }
    }
    const job = start.result as import('../../../shared/src/types/render').RenderJob
    lastJobId = job.id
    const content = buildRuntimeBounceContent(st, {
      startSec: job.start.segundos ?? 0,
      endSec: job.end.segundos,
    })
    const done = await runNativeBounce(job, content, undefined, st)
    lastIntegrated = done.loudness?.integrated ?? lastIntegrated
    lastSummary = done.listenReport?.summary ?? ''
    lastDelta = targetLufs - lastIntegrated

    if (Math.abs(lastDelta) <= 1.5 && done.listenReport?.ok !== false) {
      return {
        ok: true,
        message: `MasterPass OK → ${target} (${lastIntegrated.toFixed(1)} LUFS). ${lastSummary}`,
        jobId: done.id,
        integrated: lastIntegrated,
        deltaDb: lastDelta,
        listenSummary: lastSummary,
        iterations,
      }
    }

    // Ajuste de master fader
    const m = tienda.obtenerEstado().project.master
    const gain = Math.pow(10, lastDelta / 20)
    const nextVol = Math.max(0.05, Math.min(1.5, (m.volumen ?? 0.9) * Math.min(1.25, Math.max(0.75, gain))))
    await tienda.executor.execute('master.update', { datos: { volumen: nextVol } })
  }

  return {
    ok: Math.abs(lastDelta) <= 2.5,
    message: `MasterPass ${Math.abs(lastDelta) <= 2.5 ? 'aceptable' : 'fuera de target'}: ${lastIntegrated.toFixed(1)} LUFS (Δ ${lastDelta.toFixed(1)} dB vs ${target}). ${lastSummary}`,
    jobId: lastJobId,
    integrated: lastIntegrated,
    deltaDb: lastDelta,
    listenSummary: lastSummary,
    iterations,
  }
}
