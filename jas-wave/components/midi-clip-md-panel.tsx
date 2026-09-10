/**
 * Panel workspace «MIDI · MD»: editor del clip-*.md con sync en vivo al piano roll.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { FileCode2, Link2, Unlink } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getAgentDoc, subscribeAgentDocs, writeAgentDoc } from '@/src/lib/agent-docs'
import {
  bindMidiClipMdSync,
  getMidiClipMdSyncStatus,
  getPreferredMidiClipMd,
  openMidiClipMdSync,
  subscribeMidiClipMdSync,
  unbindMidiClipMdSync,
} from '@/src/lib/midi-clip-md-sync'
import { midiClipDocSlug } from '@/src/lib/midi-clip-markdown'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'

function useSyncStatus() {
  return useSyncExternalStore(
    subscribeMidiClipMdSync,
    getMidiClipMdSyncStatus,
    getMidiClipMdSyncStatus,
  )
}

function listMidiClips(state: DAWState): Array<{ trackId: string; clipId: string; label: string }> {
  const out: Array<{ trackId: string; clipId: string; label: string }> = []
  for (const t of state.project?.tracks ?? []) {
    for (const c of t.clips ?? []) {
      if ((c as { tipo?: string }).tipo !== 'midi') continue
      out.push({
        trackId: t.id,
        clipId: c.id,
        label: `${t.nombre} · ${c.nombre || c.id}`,
      })
    }
  }
  return out
}

function resolveTargetClip(state: DAWState): { trackId: string; clipId: string } | null {
  const preferred = getPreferredMidiClipMd()
  if (preferred) {
    const hit = listMidiClips(state).find(
      (c) => c.clipId === preferred.clipId && c.trackId === preferred.trackId,
    )
    if (hit) return { trackId: hit.trackId, clipId: hit.clipId }
  }
  const selectedClip = state.selection?.idsClips?.[0]
  const selectedTrack = getSelectedTrackId(state)
  if (selectedClip) {
    for (const t of state.project?.tracks ?? []) {
      if (selectedTrack && t.id !== selectedTrack) continue
      if ((t.clips ?? []).some((c) => c.id === selectedClip && (c as { tipo?: string }).tipo === 'midi')) {
        return { trackId: t.id, clipId: selectedClip }
      }
    }
    for (const t of state.project?.tracks ?? []) {
      if ((t.clips ?? []).some((c) => c.id === selectedClip && (c as { tipo?: string }).tipo === 'midi')) {
        return { trackId: t.id, clipId: selectedClip }
      }
    }
  }
  const first = listMidiClips(state)[0]
  return first ? { trackId: first.trackId, clipId: first.clipId } : null
}

/** Cache de contenido de doc para useSyncExternalStore. */
const docSnapCache = new Map<string, string>()

function getDocSnapshot(projectId: string, slug: string | null): string {
  if (!slug) return ''
  const key = `${projectId}\0${slug}`
  const content = getAgentDoc(projectId, slug)?.content ?? ''
  const prev = docSnapCache.get(key)
  if (prev === content) return prev
  docSnapCache.set(key, content)
  return content
}

export function MidiClipMdPanel() {
  const tienda = useDAW()
  const projectId = useDAWState((s) => s.project.id)
  const status = useSyncStatus()
  const clipsSerialized = useDAWState((s) =>
    listMidiClips(s)
      .map((c) => `${c.trackId}\t${c.clipId}\t${c.label}`)
      .join('\n'),
  )
  const clips = useMemo(() => {
    if (!clipsSerialized) return []
    return clipsSerialized.split('\n').map((line) => {
      const [trackId, clipId, ...rest] = line.split('\t')
      return { trackId: trackId!, clipId: clipId!, label: rest.join('\t') || clipId! }
    })
  }, [clipsSerialized])

  const slug = status.slug
  const docContent = useSyncExternalStore(
    subscribeAgentDocs,
    () => getDocSnapshot(projectId, slug),
    () => getDocSnapshot(projectId, slug),
  )

  const [draft, setDraft] = useState(docContent)
  const userDirty = useRef(false)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boundRef = useRef<{ clipId: string; trackId: string } | null>(null)

  // Bind al montar; unbind SOLO al desmontar (evita fugas de listeners).
  useEffect(() => {
    const target = resolveTargetClip(tienda.obtenerEstado())
    if (target) {
      openMidiClipMdSync(tienda, target.clipId, target.trackId)
      boundRef.current = { clipId: target.clipId, trackId: target.trackId }
    }
    return () => {
      unbindMidiClipMdSync()
      boundRef.current = null
      if (writeTimer.current) clearTimeout(writeTimer.current)
    }
  }, [tienda])

  useEffect(() => {
    if (userDirty.current) return
    setDraft(docContent)
  }, [docContent, status.slug])

  const flushDraft = useCallback(
    (text: string) => {
      if (!status.slug || !status.bound) return
      writeAgentDoc(projectId, status.slug, text, {
        origin: 'user',
        title: `Clip · ${status.clipId}`,
        preserveUserNotes: false,
      })
      userDirty.current = false
    },
    [projectId, status.bound, status.clipId, status.slug],
  )

  const onDraftChange = (text: string) => {
    userDirty.current = true
    setDraft(text)
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => flushDraft(text), 220)
  }

  const bindSelected = () => {
    const target = resolveTargetClip(tienda.obtenerEstado())
    if (!target) return
    userDirty.current = false
    openMidiClipMdSync(tienda, target.clipId, target.trackId)
    boundRef.current = { clipId: target.clipId, trackId: target.trackId }
  }

  const bindClip = (trackId: string, clipId: string) => {
    userDirty.current = false
    openMidiClipMdSync(tienda, clipId, trackId)
    boundRef.current = { clipId, trackId }
  }

  if (!clips.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel p-4 text-center text-[12px] text-muted-foreground">
        <FileCode2 className="size-8 opacity-40" />
        <p className="font-medium text-foreground">MIDI · MD</p>
        <p>
          Crea o selecciona un clip MIDI para editarlo como{' '}
          <code className="text-[11px]">clip-*.md</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
        <FileCode2 className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-semibold text-foreground">MIDI · MD</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            status.bound
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-panel-raised text-muted-foreground'
          }`}
        >
          {status.bound ? `Sync ON · ${status.noteCount} notas` : 'Sync OFF'}
        </span>
        {status.slug ? (
          <span className="truncate font-mono text-[10px] text-muted-foreground">{status.slug}</span>
        ) : null}
        <select
          className="ml-auto max-w-[12rem] rounded border border-border bg-panel-raised px-1.5 py-0.5 text-[10px] text-foreground"
          value={status.clipId && status.trackId ? `${status.trackId}\t${status.clipId}` : ''}
          onChange={(e) => {
            const [trackId, clipId] = e.target.value.split('\t')
            if (trackId && clipId) bindClip(trackId, clipId)
          }}
          aria-label="Clip MIDI vinculado"
        >
          {clips.map((c) => (
            <option key={`${c.trackId}:${c.clipId}`} value={`${c.trackId}\t${c.clipId}`}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Vincular clip seleccionado"
          onClick={bindSelected}
          className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
        >
          <Link2 className="size-3.5" />
        </button>
        <button
          type="button"
          title="Desvincular sync"
          onClick={() => {
            unbindMidiClipMdSync()
            boundRef.current = null
          }}
          className="rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-foreground"
        >
          <Unlink className="size-3.5" />
        </button>
      </div>

      {status.parseErrors.length > 0 ? (
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
          Parse: {status.parseErrors.slice(0, 3).join(' · ')}
          {status.parseErrors.length > 3 ? '…' : ''}
        </div>
      ) : null}

      {!status.bound ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-[12px] text-muted-foreground">
          <p>Elige un clip y pulsa vincular para sync en vivo con el piano roll.</p>
          <button
            type="button"
            onClick={bindSelected}
            className="rounded bg-accent-amber/20 px-3 py-1.5 text-[11px] font-medium text-accent-amber"
          >
            Vincular clip
          </button>
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => {
            if (userDirty.current) flushDraft(draft)
          }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none"
          aria-label={`Editar ${status.slug ?? midiClipDocSlug(status.clipId ?? 'clip')}`}
        />
      )}
    </div>
  )
}
