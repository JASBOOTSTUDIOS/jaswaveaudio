/**
 * Diff semántico de estado DAW (030-dry-run).
 */

import type { DAWState } from '../types/state';

export type SemanticStateDiff = {
  tracksAdded: string[];
  tracksRemoved: string[];
  tracksModified: string[];
  clipsAdded: number;
  clipsRemoved: number;
  pluginsLoaded: string[];
  pluginsUnloaded: string[];
  volumeChanges: Array<{ trackId: string; before: number; after: number }>;
  panChanges: Array<{ trackId: string; before: number; after: number }>;
  muteChanges: Array<{ trackId: string; before: boolean; after: boolean }>;
  sendsAdded: number;
  sidechainsAdded: number;
};

export function emptySemanticDiff(): SemanticStateDiff {
  return {
    tracksAdded: [],
    tracksRemoved: [],
    tracksModified: [],
    clipsAdded: 0,
    clipsRemoved: 0,
    pluginsLoaded: [],
    pluginsUnloaded: [],
    volumeChanges: [],
    panChanges: [],
    muteChanges: [],
    sendsAdded: 0,
    sidechainsAdded: 0,
  };
}

export function mergeSemanticDiffs(a: SemanticStateDiff, b: SemanticStateDiff): SemanticStateDiff {
  return {
    tracksAdded: [...a.tracksAdded, ...b.tracksAdded],
    tracksRemoved: [...a.tracksRemoved, ...b.tracksRemoved],
    tracksModified: [...new Set([...a.tracksModified, ...b.tracksModified])],
    clipsAdded: a.clipsAdded + b.clipsAdded,
    clipsRemoved: a.clipsRemoved + b.clipsRemoved,
    pluginsLoaded: [...a.pluginsLoaded, ...b.pluginsLoaded],
    pluginsUnloaded: [...a.pluginsUnloaded, ...b.pluginsUnloaded],
    volumeChanges: [...a.volumeChanges, ...b.volumeChanges],
    panChanges: [...a.panChanges, ...b.panChanges],
    muteChanges: [...a.muteChanges, ...b.muteChanges],
    sendsAdded: a.sendsAdded + b.sendsAdded,
    sidechainsAdded: a.sidechainsAdded + b.sidechainsAdded,
  };
}

export function computeSemanticDiff(before: DAWState, after: DAWState): SemanticStateDiff {
  const diff = emptySemanticDiff();
  const beforeTracks = new Map((before.project?.tracks ?? []).map((t) => [t.id, t]));
  const afterTracks = new Map((after.project?.tracks ?? []).map((t) => [t.id, t]));

  for (const [id, t] of afterTracks) {
    if (!beforeTracks.has(id)) diff.tracksAdded.push(t.nombre || id);
  }
  for (const [id, t] of beforeTracks) {
    if (!afterTracks.has(id)) diff.tracksRemoved.push(t.nombre || id);
  }
  for (const [id, at] of afterTracks) {
    const bt = beforeTracks.get(id);
    if (!bt) continue;
    let modified = false;
    if (typeof bt.volumen === 'number' && typeof at.volumen === 'number' && bt.volumen !== at.volumen) {
      diff.volumeChanges.push({ trackId: id, before: bt.volumen, after: at.volumen });
      modified = true;
    }
    if (typeof bt.paneo === 'number' && typeof at.paneo === 'number' && bt.paneo !== at.paneo) {
      diff.panChanges.push({ trackId: id, before: bt.paneo, after: at.paneo });
      modified = true;
    }
    if (Boolean(bt.silenciada) !== Boolean(at.silenciada)) {
      diff.muteChanges.push({ trackId: id, before: Boolean(bt.silenciada), after: Boolean(at.silenciada) });
      modified = true;
    }
    const bClips = bt.clips?.length ?? 0;
    const aClips = at.clips?.length ?? 0;
    if (aClips > bClips) diff.clipsAdded += aClips - bClips;
    if (bClips > aClips) diff.clipsRemoved += bClips - aClips;
    if (aClips !== bClips) modified = true;
    const bPlugins = new Set((bt.plugins ?? []).map((p) => p.id));
    const aPlugins = new Set((at.plugins ?? []).map((p) => p.id));
    for (const pid of aPlugins) {
      if (!bPlugins.has(pid)) diff.pluginsLoaded.push(`${at.nombre}:${pid}`);
    }
    for (const pid of bPlugins) {
      if (!aPlugins.has(pid)) diff.pluginsUnloaded.push(`${bt.nombre}:${pid}`);
    }
    if (modified || diff.pluginsLoaded.length || diff.pluginsUnloaded.length) {
      diff.tracksModified.push(at.nombre || id);
    }
  }

  const bSends = before.project?.routing?.sends?.length ?? 0;
  const aSends = after.project?.routing?.sends?.length ?? 0;
  if (aSends > bSends) diff.sendsAdded = aSends - bSends;

  const bSc = before.project?.routing?.sidechains?.length ?? 0;
  const aSc = after.project?.routing?.sidechains?.length ?? 0;
  if (aSc > bSc) diff.sidechainsAdded = aSc - bSc;

  return diff;
}

export function formatSemanticDiffSummary(diff: SemanticStateDiff): string {
  const parts: string[] = [];
  if (diff.tracksAdded.length) parts.push(`+${diff.tracksAdded.length} pista(s): ${diff.tracksAdded.slice(0, 4).join(', ')}`);
  if (diff.tracksRemoved.length) parts.push(`-${diff.tracksRemoved.length} pista(s)`);
  if (diff.clipsAdded) parts.push(`+${diff.clipsAdded} clip(s)`);
  if (diff.volumeChanges.length) parts.push(`${diff.volumeChanges.length} cambio(s) de volumen`);
  if (diff.pluginsLoaded.length) parts.push(`${diff.pluginsLoaded.length} plugin(s) cargado(s)`);
  if (diff.sendsAdded) parts.push(`+${diff.sendsAdded} send(s)`);
  if (diff.sidechainsAdded) parts.push(`+${diff.sidechainsAdded} sidechain(s)`);
  return parts.length ? parts.join(' · ') : 'Sin cambios detectables';
}
