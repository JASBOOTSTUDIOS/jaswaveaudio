/**
 * Ops de StyleProfile para agente / UI.
 */

import type { MidiClip } from '@jaswave/shared'
import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import { applyStyleProfileToNotes } from './apply-style-profile'
import { extractStyleProfile, inferStyleRole, seedMesiasWorshipDrumProfile } from './extract-style-profile'
import {
  ensureMesiasSeed,
  getGlobalStyleProfile,
  listGlobalStyleProfiles,
  saveGlobalStyleProfile,
  searchGlobalStyleProfiles,
} from './global-style-catalog'
import {
  formatStyleProfilesForContext,
  getStyleProfile,
  listStyleProfiles,
  saveStyleProfile,
  searchStyleProfiles,
} from './style-catalog'
import type { StyleProfile, StyleRole } from './types'

function projectMeta(tienda: TiendaDAW) {
  const st = tienda.obtenerEstado()
  return {
    projectId: st.project?.id ?? 'default',
    projectRuta: st.project?.ruta as string | undefined,
    bpm: st.project?.bpm?.valor ?? 120,
  }
}

function findClip(
  tienda: TiendaDAW,
  pistaId: string,
  clipId: string,
): { trackName: string; clip: MidiClip } | null {
  const st = tienda.obtenerEstado()
  const track = st.project?.tracks?.find((t) => t.id === pistaId)
  if (!track) return null
  const clip = (track.clips ?? []).find((c) => c.id === clipId && (c as MidiClip).tipo === 'midi') as
    | MidiClip
    | undefined
  if (!clip) return null
  return { trackName: track.nombre, clip }
}

export async function styleEnsureSeed(): Promise<StyleProfile> {
  return ensureMesiasSeed(seedMesiasWorshipDrumProfile())
}

export async function styleList(
  tienda: TiendaDAW,
  scope: 'project' | 'global' | 'all' = 'all',
): Promise<StyleProfile[]> {
  await styleEnsureSeed()
  const { projectId } = projectMeta(tienda)
  const proj = scope === 'global' ? [] : listStyleProfiles(projectId)
  const glob = scope === 'project' ? [] : await listGlobalStyleProfiles()
  const map = new Map<string, StyleProfile>()
  for (const p of [...glob, ...proj]) map.set(p.id, p)
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function styleSearch(
  tienda: TiendaDAW,
  opts: { query?: string; rol?: string; tag?: string; scope?: 'project' | 'global' | 'all' },
): Promise<StyleProfile[]> {
  await styleEnsureSeed()
  const { projectId } = projectMeta(tienda)
  const scope = opts.scope ?? 'all'
  const proj =
    scope === 'global' ? [] : searchStyleProfiles(projectId, { query: opts.query, rol: opts.rol, tag: opts.tag })
  const glob =
    scope === 'project'
      ? []
      : await searchGlobalStyleProfiles({ query: opts.query, rol: opts.rol, tag: opts.tag })
  const map = new Map<string, StyleProfile>()
  for (const p of [...glob, ...proj]) map.set(p.id, p)
  return [...map.values()]
}

export async function styleSaveFromClip(
  tienda: TiendaDAW,
  opts: {
    pistaId: string
    clipId: string
    nombre?: string
    tags?: string[]
    global?: boolean
    rol?: StyleRole
  },
): Promise<{ ok: boolean; message: string; profile?: StyleProfile }> {
  const found = findClip(tienda, opts.pistaId, opts.clipId)
  if (!found) return { ok: false, message: 'Clip MIDI no encontrado' }
  const { projectId, projectRuta, bpm } = projectMeta(tienda)
  const profile = extractStyleProfile(found.clip, {
    nombre: opts.nombre,
    tags: opts.tags,
    bpm,
    rol: opts.rol ?? inferStyleRole(found.trackName),
    trackName: found.trackName,
    source: {
      projectId,
      trackId: opts.pistaId,
      clipId: opts.clipId,
      trackName: found.trackName,
      clipName: found.clip.nombre,
    },
    scope: opts.global ? 'global' : 'project',
  })
  const saved = opts.global
    ? await saveGlobalStyleProfile(profile)
    : await saveStyleProfile(projectId, profile, projectRuta)
  return { ok: true, message: `Estilo guardado: ${saved.nombre} (${saved.id})`, profile: saved }
}

export async function styleResolve(
  tienda: TiendaDAW,
  profileId: string,
): Promise<StyleProfile | undefined> {
  const { projectId } = projectMeta(tienda)
  return getStyleProfile(projectId, profileId) ?? (await getGlobalStyleProfile(profileId))
}

export async function styleApplyToClip(
  tienda: TiendaDAW,
  opts: { profileId: string; pistaId: string; clipId: string; replace?: boolean },
): Promise<{ ok: boolean; message: string }> {
  const profile = await styleResolve(tienda, opts.profileId)
  if (!profile) return { ok: false, message: `Perfil no encontrado: ${opts.profileId}` }
  const found = findClip(tienda, opts.pistaId, opts.clipId)
  if (!found) return { ok: false, message: 'Clip destino no encontrado' }
  const bars = Math.max(1, Math.round(Number(found.clip.duracion) / 4) || 4)
  const notas = applyStyleProfileToNotes(profile, {
    bars,
    existing: opts.replace === false ? found.clip.notas : undefined,
    seed: Date.now() % 10000,
  })
  const r = await tienda.executor.execute('midi.notes.set', {
    pistaId: opts.pistaId,
    clipId: opts.clipId,
    notas,
  })
  if (!r.success) return { ok: false, message: String((r as { message?: string }).message || 'midi.notes.set falló') }
  return {
    ok: true,
    message: `Estilo «${profile.nombre}» aplicado a «${found.clip.nombre}» (${notas.length} notas, sin copiar MIDI origen)`,
  }
}

export function styleFormatContext(profiles: StyleProfile[]): string {
  return formatStyleProfilesForContext(profiles)
}
