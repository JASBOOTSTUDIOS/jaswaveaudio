/**
 * Diff semántico de estado DAW (030-dry-run).
 * A9: ampliado con clips/notas, plugins con parámetros (unidades), mezcla en dB, routing.
 *
 * El diff NO muta nada: compara dos snapshots y describe el cambio de forma
 * legible por el agente y por la UI (unidades explícitas: dB, Hz, %).
 */

import type { DAWState } from '../types/state';

/** Vista mínima de una pista para poder compararla. */
export type DiffTrackLike = {
  id: string
  nombre?: string
  volumen?: number
  paneo?: number
  silenciada?: boolean
  soloActiva?: boolean
  clips?: ReadonlyArray<{ id: string; tipo?: string; notas?: ReadonlyArray<{ pitch: number; inicio: number }> }>
  plugins?: ReadonlyArray<{
    id: string
    nombre?: string
    bypass?: boolean
    estado?: string
    parametros?: ReadonlyArray<{ id: string; valor: number; unidad?: string; nombre?: string }>
  }>
}

/** Estado (o snapshot reducido) comparable por el diff. */
export type DiffLike = {
  project?: {
    tracks?: ReadonlyArray<DiffTrackLike>
    routing?: {
      sends?: ReadonlyArray<unknown>
      sidechains?: ReadonlyArray<unknown>
    }
  }
}

/** Snapshot reducido y serializable del estado (para `run.diff`). */
export type DiffSnapshot = {
  project: {
    tracks: DiffTrackLike[]
    routing: { sends: unknown[]; sidechains: unknown[] }
  }
}

export type SemanticStateDiff = {
  tracksAdded: string[];
  tracksRemoved: string[];
  tracksModified: string[];
  clipsAdded: number;
  clipsRemoved: number;
  notesAdded: number;
  notesRemoved: number;
  pluginsLoaded: Array<{ trackId: string; trackName: string; pluginId: string; pluginName: string }>;
  pluginsUnloaded: Array<{ trackId: string; trackName: string; pluginId: string; pluginName: string }>;
  pluginParamChanges: Array<{
    trackId: string;
    trackName: string;
    pluginId: string;
    pluginName: string;
    paramId: string;
    paramName?: string;
    before: number | string | boolean | null;
    after: number | string | boolean | null;
    unit?: string;
  }>;
  volumeChanges: Array<{ trackId: string; before: number; after: number; unit: 'dB' | 'linear' }>;
  panChanges: Array<{ trackId: string; before: number; after: number }>;
  muteChanges: Array<{ trackId: string; before: boolean; after: boolean }>;
  soloChanges: Array<{ trackId: string; before: boolean; after: boolean }>;
  sendsAdded: number;
  sidechainsAdded: number;
  routingChanges: string[];
};

/** Proyecta el estado real a un snapshot reducido y serializable. */
export function proyectarParaDiff(estado: DAWState | DiffLike): DiffSnapshot {
  const tracks = estado.project?.tracks ?? []
  return {
    project: {
      tracks: tracks.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        volumen: t.volumen,
        paneo: t.paneo,
        silenciada: t.silenciada,
        soloActiva: t.soloActiva,
        clips: (t.clips ?? []).map((c) => ({
          id: c.id,
          tipo: c.tipo,
          notas: (c as { notas?: ReadonlyArray<{ pitch: number; inicio: number }> }).notas,
        })),
        plugins: (t.plugins ?? []).map((p) => ({
          id: p.id,
          nombre: p.nombre,
          bypass: p.bypass,
          estado: p.estado,
          parametros: (p.parametros ?? []).map((pr) => ({
            id: pr.id,
            nombre: pr.nombre,
            valor: pr.valor,
            unidad: pr.unidad,
          })),
        })),
      })),
      routing: {
        sends: [...(estado.project?.routing?.sends ?? [])],
        sidechains: [...(estado.project?.routing?.sidechains ?? [])],
      },
    },
  }
}

function getTracks(state: DiffLike | undefined | null): ReadonlyArray<DiffTrackLike> {
  return state?.project?.tracks ?? []
}

function getTrackName(track: DiffTrackLike | undefined, id: string): string {
  return track?.nombre || id
}

function countNotes(track: DiffTrackLike): number {
  let count = 0
  for (const clip of track.clips ?? []) {
    if (Array.isArray(clip.notas)) count += clip.notas.length
  }
  return count
}

/**
 * Unidad del volumen: en JasWave el volumen de pista es lineal (0..1) salvo que
 * el host lo guarde en dB. Se detecta por rango: valores ≤ 0 se consideran dB.
 */
function volumenUnit(before: number, after: number): 'dB' | 'linear' {
  const candidates = [before, after].filter((v) => Number.isFinite(v))
  if (!candidates.length) return 'linear'
  const pareceDb = candidates.every((v) => v <= 0 && v >= -120)
  return pareceDb ? 'dB' : 'linear'
}

export function emptySemanticDiff(): SemanticStateDiff {
  return {
    tracksAdded: [],
    tracksRemoved: [],
    tracksModified: [],
    clipsAdded: 0,
    clipsRemoved: 0,
    notesAdded: 0,
    notesRemoved: 0,
    pluginsLoaded: [],
    pluginsUnloaded: [],
    pluginParamChanges: [],
    volumeChanges: [],
    panChanges: [],
    muteChanges: [],
    soloChanges: [],
    sendsAdded: 0,
    sidechainsAdded: 0,
    routingChanges: [],
  }
}

export function mergeSemanticDiffs(a: SemanticStateDiff, b: SemanticStateDiff): SemanticStateDiff {
  return {
    tracksAdded: [...a.tracksAdded, ...b.tracksAdded],
    tracksRemoved: [...a.tracksRemoved, ...b.tracksRemoved],
    tracksModified: [...new Set([...a.tracksModified, ...b.tracksModified])],
    clipsAdded: a.clipsAdded + b.clipsAdded,
    clipsRemoved: a.clipsRemoved + b.clipsRemoved,
    notesAdded: a.notesAdded + b.notesAdded,
    notesRemoved: a.notesRemoved + b.notesRemoved,
    pluginsLoaded: [...a.pluginsLoaded, ...b.pluginsLoaded],
    pluginsUnloaded: [...a.pluginsUnloaded, ...b.pluginsUnloaded],
    pluginParamChanges: [...a.pluginParamChanges, ...b.pluginParamChanges],
    volumeChanges: [...a.volumeChanges, ...b.volumeChanges],
    panChanges: [...a.panChanges, ...b.panChanges],
    muteChanges: [...a.muteChanges, ...b.muteChanges],
    soloChanges: [...a.soloChanges, ...b.soloChanges],
    sendsAdded: a.sendsAdded + b.sendsAdded,
    sidechainsAdded: a.sidechainsAdded + b.sidechainsAdded,
    routingChanges: [...a.routingChanges, ...b.routingChanges],
  }
}

export function computeSemanticDiff(before: DiffLike, after: DiffLike): SemanticStateDiff {
  const diff = emptySemanticDiff()
  const beforeTracks = new Map(getTracks(before).map((t) => [t.id, t]))
  const afterTracks = new Map(getTracks(after).map((t) => [t.id, t]))

  for (const [id, t] of afterTracks) {
    if (!beforeTracks.has(id)) diff.tracksAdded.push(getTrackName(t, id))
  }
  for (const [id, t] of beforeTracks) {
    if (!afterTracks.has(id)) diff.tracksRemoved.push(getTrackName(t, id))
  }

  for (const [id, at] of afterTracks) {
    const bt = beforeTracks.get(id)
    if (!bt) continue
    let modified = false
    const trackNameAfter = getTrackName(at, id)
    const trackNameBefore = getTrackName(bt, id)

    if (typeof bt.volumen === 'number' && typeof at.volumen === 'number' && bt.volumen !== at.volumen) {
      diff.volumeChanges.push({
        trackId: id,
        before: bt.volumen,
        after: at.volumen,
        unit: volumenUnit(bt.volumen, at.volumen),
      })
      modified = true
    }
    if (typeof bt.paneo === 'number' && typeof at.paneo === 'number' && bt.paneo !== at.paneo) {
      diff.panChanges.push({ trackId: id, before: bt.paneo, after: at.paneo })
      modified = true
    }
    if (Boolean(bt.silenciada) !== Boolean(at.silenciada)) {
      diff.muteChanges.push({ trackId: id, before: Boolean(bt.silenciada), after: Boolean(at.silenciada) })
      modified = true
    }
    if (Boolean(bt.soloActiva) !== Boolean(at.soloActiva)) {
      diff.soloChanges.push({ trackId: id, before: Boolean(bt.soloActiva), after: Boolean(at.soloActiva) })
      modified = true
    }

    const bClips = bt.clips?.length ?? 0
    const aClips = at.clips?.length ?? 0
    if (aClips > bClips) diff.clipsAdded += aClips - bClips
    if (bClips > aClips) diff.clipsRemoved += bClips - aClips
    if (aClips !== bClips) modified = true

    const bNotes = countNotes(bt)
    const aNotes = countNotes(at)
    if (aNotes > bNotes) diff.notesAdded += aNotes - bNotes
    if (bNotes > aNotes) diff.notesRemoved += bNotes - aNotes
    if (aNotes !== bNotes) modified = true

    const bPlugins = new Map((bt.plugins ?? []).map((p) => [p.id, p]))
    const aPlugins = new Map((at.plugins ?? []).map((p) => [p.id, p]))

    for (const [pid, p] of aPlugins) {
      if (!bPlugins.has(pid)) {
        diff.pluginsLoaded.push({
          trackId: id,
          trackName: trackNameAfter,
          pluginId: pid,
          pluginName: p.nombre || pid,
        })
        modified = true
        continue
      }
      const bp = bPlugins.get(pid)!
      const bParams = new Map((bp.parametros ?? []).map((pr) => [pr.id, pr]))
      for (const ap of p.parametros ?? []) {
        const bpr = bParams.get(ap.id)
        if (bpr && bpr.valor !== ap.valor) {
          diff.pluginParamChanges.push({
            trackId: id,
            trackName: trackNameAfter,
            pluginId: pid,
            pluginName: p.nombre || pid,
            paramId: ap.id,
            paramName: ap.nombre,
            before: bpr.valor,
            after: ap.valor,
            unit: ap.unidad || bpr.unidad,
          })
          modified = true
        }
      }
      if (bp.bypass !== p.bypass) {
        diff.pluginParamChanges.push({
          trackId: id,
          trackName: trackNameAfter,
          pluginId: pid,
          pluginName: p.nombre || pid,
          paramId: '__bypass',
          paramName: 'Bypass',
          before: Boolean(bp.bypass),
          after: Boolean(p.bypass),
          unit: 'bool',
        })
        modified = true
      }
    }
    for (const [pid, p] of bPlugins) {
      if (!aPlugins.has(pid)) {
        diff.pluginsUnloaded.push({
          trackId: id,
          trackName: trackNameBefore,
          pluginId: pid,
          pluginName: p.nombre || pid,
        })
        modified = true
      }
    }

    if (modified) diff.tracksModified.push(trackNameAfter)
  }

  const bSends = before.project?.routing?.sends?.length ?? 0
  const aSends = after.project?.routing?.sends?.length ?? 0
  if (aSends > bSends) diff.sendsAdded = aSends - bSends

  const bSc = before.project?.routing?.sidechains?.length ?? 0
  const aSc = after.project?.routing?.sidechains?.length ?? 0
  if (aSc > bSc) diff.sidechainsAdded = aSc - bSc

  const routingChanges: string[] = []
  if (bSends !== aSends) routingChanges.push('sends')
  if (bSc !== aSc) routingChanges.push('sidechains')
  diff.routingChanges = routingChanges

  return diff
}

/** Resumen legible (1 línea) del diff. */
export function formatSemanticDiffSummary(diff: SemanticStateDiff): string {
  const parts: string[] = []
  if (diff.tracksAdded.length) parts.push(`+${diff.tracksAdded.length} pista(s): ${diff.tracksAdded.slice(0, 4).join(', ')}`)
  if (diff.tracksRemoved.length) parts.push(`-${diff.tracksRemoved.length} pista(s)`)
  if (diff.clipsAdded) parts.push(`+${diff.clipsAdded} clip(s)`)
  if (diff.clipsRemoved) parts.push(`-${diff.clipsRemoved} clip(s)`)
  if (diff.notesAdded) parts.push(`+${diff.notesAdded} nota(s)`)
  if (diff.notesRemoved) parts.push(`-${diff.notesRemoved} nota(s)`)
  if (diff.volumeChanges.length) parts.push(`${diff.volumeChanges.length} cambio(s) de volumen`)
  if (diff.panChanges.length) parts.push(`${diff.panChanges.length} cambio(s) de paneo`)
  if (diff.muteChanges.length) parts.push(`${diff.muteChanges.length} cambio(s) de mute`)
  if (diff.soloChanges.length) parts.push(`${diff.soloChanges.length} cambio(s) de solo`)
  if (diff.pluginsLoaded.length) parts.push(`${diff.pluginsLoaded.length} plugin(s) cargado(s)`)
  if (diff.pluginsUnloaded.length) parts.push(`${diff.pluginsUnloaded.length} plugin(s) descargado(s)`)
  if (diff.pluginParamChanges.length) parts.push(`${diff.pluginParamChanges.length} cambio(s) de parámetros`)
  if (diff.sendsAdded) parts.push(`+${diff.sendsAdded} send(s)`)
  if (diff.sidechainsAdded) parts.push(`+${diff.sidechainsAdded} sidechain(s)`)
  if (diff.routingChanges.length) parts.push(`routing: ${diff.routingChanges.join(', ')}`)
  return parts.length ? parts.join(' · ') : 'Sin cambios detectables'
}

/** Diff en texto con unidades (para `run.diff` y la UI). */
export function formatSemanticDiffLines(diff: SemanticStateDiff): string[] {
  const lines: string[] = []
  for (const t of diff.tracksAdded) lines.push(`+ pista «${t}»`)
  for (const t of diff.tracksRemoved) lines.push(`- pista «${t}»`)
  for (const v of diff.volumeChanges) {
    lines.push(`~ volumen ${v.trackId}: ${v.before} → ${v.after} ${v.unit}`)
  }
  for (const p of diff.panChanges) {
    lines.push(`~ paneo ${p.trackId}: ${p.before} → ${p.after}`)
  }
  for (const m of diff.muteChanges) {
    lines.push(`~ mute ${m.trackId}: ${m.before ? 'on' : 'off'} → ${m.after ? 'on' : 'off'}`)
  }
  for (const s of diff.soloChanges) {
    lines.push(`~ solo ${s.trackId}: ${s.before ? 'on' : 'off'} → ${s.after ? 'on' : 'off'}`)
  }
  for (const p of diff.pluginsLoaded) {
    lines.push(`+ plugin «${p.pluginName}» en ${p.trackName}`)
  }
  for (const p of diff.pluginsUnloaded) {
    lines.push(`- plugin «${p.pluginName}» en ${p.trackName}`)
  }
  for (const c of diff.pluginParamChanges) {
    lines.push(`~ ${c.trackName}/${c.pluginName} ${c.paramName ?? c.paramId}: ${c.before} → ${c.after}${c.unit ? ` ${c.unit}` : ''}`)
  }
  if (diff.clipsAdded) lines.push(`+ ${diff.clipsAdded} clip(s)`)
  if (diff.clipsRemoved) lines.push(`- ${diff.clipsRemoved} clip(s)`)
  if (diff.notesAdded) lines.push(`+ ${diff.notesAdded} nota(s)`)
  if (diff.notesRemoved) lines.push(`- ${diff.notesRemoved} nota(s)`)
  if (diff.sendsAdded) lines.push(`+ ${diff.sendsAdded} envío(s)`)
  if (diff.sidechainsAdded) lines.push(`+ ${diff.sidechainsAdded} sidechain(s)`)
  return lines
}
