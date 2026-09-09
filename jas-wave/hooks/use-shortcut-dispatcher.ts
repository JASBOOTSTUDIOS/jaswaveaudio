import { useEffect, useMemo, useRef } from 'react'
import { useDAW, useDAWState } from '../src/context/daw-context'
import {
  createActionSystem,
  DespachadorTeclado,
  hasNonEmptyTextSelection,
  shouldIgnoreGlobalShortcuts,
  type ActionSystem,
} from '../../shared/src'
import {
  abrirProyectoIO,
  cerrarProyectoIO,
  guardarProyectoComoIO,
  guardarProyectoIO,
  nuevoProyectoIO,
} from '../src/lib/project-io'
import { executeOrNotify, redoOrNotify, undoOrNotify } from '../src/lib/execute-or-toast'
import { dawClipboard, type ClipboardClip } from '../src/lib/daw-clipboard'
import { requestOpenTool } from '../src/workspace/types'
import { bumpUiZoom, bumpDocsTextZoom, isDocsZoomTarget, setDocsTextZoom } from '../src/lib/docs-editor-store'
import { bumpChatTextZoom, isChatZoomTarget, setChatTextZoom } from '../src/lib/chat-ui-store'
import { captureActiveDocTextSelection } from '../src/lib/ai-selection-context'

/**
 * Sistema unificado: ActionSystem → Command System.
 * Expone DespachadorTeclado como adaptador para la UI de atajos.
 */
export function useShortcutDispatcher(): DespachadorTeclado {
  const tienda = useDAW()
  const atajos = useDAWState((s) => s.atajos)
  const paletaAbiertaRef = useRef(false)

  const system = useMemo(() => createActionSystem({ initialContext: 'arrangement' }), [])
  const dispatcher = useMemo(() => {
    const d = new DespachadorTeclado()
    d.attachSystem(system)
    return d
  }, [system])

  useEffect(() => {
    system.loadPersisted()
    dispatcher.attachSystem(system)
  }, [system, dispatcher])

  useEffect(() => {
    const st = () => tienda.obtenerEstado()

    const collectSelectedClips = (): ClipboardClip[] => {
      const { selection, project } = st()
      const out: ClipboardClip[] = []
      for (const clipId of selection.idsClips) {
        for (const track of project.tracks) {
          const clip = track.clips.find((c: { id: string }) => c.id === clipId)
          if (!clip) continue
          const c = clip as unknown as Record<string, unknown>
          const tipo = typeof c.tipo === 'string' ? c.tipo : undefined
          const notasRaw = Array.isArray(c.notas) ? (c.notas as Record<string, unknown>[]) : []
          const notas =
            tipo === 'midi' || notasRaw.length > 0
              ? notasRaw.map((n) => ({
                  pitch: Number(n.pitch ?? 60),
                  inicio: Number(n.inicio ?? 0),
                  duracion: Number(n.duracion ?? 0.25),
                  velocidad: Number(n.velocidad ?? 80),
                  canal: n.canal != null ? Number(n.canal) : undefined,
                }))
              : undefined
          const source =
            c.source && typeof c.source === 'object'
              ? (c.source as Record<string, unknown>)
              : null
          out.push({
            pistaOrigenId: track.id,
            nombre: String(c.nombre ?? 'Clip'),
            inicio: Number(c.inicio ?? 0),
            duracion: Number(c.duracion ?? 0),
            tipo: tipo ?? (notas?.length ? 'midi' : 'audio'),
            color: typeof c.color === 'string' ? c.color : undefined,
            notas,
            sourceId:
              (typeof c.sourceId === 'string' && c.sourceId) ||
              (source && typeof source.ruta === 'string' ? source.ruta : undefined),
            waveform: Array.isArray(c.waveform) ? (c.waveform as number[]) : undefined,
            clipInicio: c.clipInicio != null ? Number(c.clipInicio) : undefined,
          })
        }
      }
      return out
    }

    const resolvePasteTrackId = (): string | undefined => {
      const state = st()
      const sel = state.selection
      if (sel.idsPistas[0] && state.project.tracks.some((t: { id: string }) => t.id === sel.idsPistas[0])) {
        return sel.idsPistas[0]
      }
      if (sel.idPrincipal && state.project.tracks.some((t: { id: string }) => t.id === sel.idPrincipal)) {
        return sel.idPrincipal
      }
      // Clip seleccionado → pista que lo contiene
      for (const clipId of sel.idsClips) {
        for (const track of state.project.tracks) {
          if (track.clips.some((c: { id: string }) => c.id === clipId)) return track.id
        }
      }
      return state.project.tracks[0]?.id
    }

    const pasteClipboardClips = () => {
      const clips = dawClipboard.getClips()
      if (clips.length === 0) {
        tienda.busEventos.emit('comando.fallido', { type: 'editing.paste', error: 'Portapapeles vacío — copia un clip primero (Ctrl+C)' })
        return
      }
      const state = st()
      const targetTrackId = resolvePasteTrackId()
      if (!targetTrackId) {
        tienda.busEventos.emit('comando.fallido', { type: 'editing.paste', error: 'No hay pista destino' })
        return
      }
      const playheadBeats =
        state.transport.posicion?.beats ??
        ((state.transport.posicion?.segundos ?? 0) * (state.project.bpm?.valor ?? 120)) / 60
      const baseInicio = Math.min(...clips.map((c) => c.inicio))
      void (async () => {
        let ok = 0
        let lastClipId: string | undefined
        for (const clip of clips) {
          const offset = clip.inicio - baseInicio
          const inicio = playheadBeats + offset
          const isMidi =
            clip.tipo === 'midi' || (Array.isArray(clip.notas) && clip.notas.length > 0)
          const result = isMidi
            ? await executeOrNotify(tienda, 'midi.clip.create', {
                pistaId: targetTrackId,
                nombre: clip.nombre,
                inicio,
                duracion: clip.duracion,
                color: clip.color,
                notas: (clip.notas ?? []).map((n) => ({
                  pitch: n.pitch,
                  inicio: n.inicio,
                  duracion: n.duracion,
                  velocidad: n.velocidad,
                  canal: n.canal,
                })),
              })
            : await executeOrNotify(tienda, 'clip.create', {
                pistaId: targetTrackId,
                nombre: clip.nombre,
                inicio,
                duracion: clip.duracion,
                color: clip.color,
                sourceId: clip.sourceId,
                waveform: clip.waveform,
              })
          if (result.success) {
            ok += 1
            const created = result.state?.project?.tracks
              ?.find((t: { id: string }) => t.id === targetTrackId)
              ?.clips?.slice(-1)[0] as { id?: string } | undefined
            if (created?.id) lastClipId = created.id
          }
        }
        if (ok > 0) {
          if (lastClipId) {
            void executeOrNotify(tienda, 'selection.set', {
              idsClips: [lastClipId],
              idsPistas: [targetTrackId],
              tipo: 'clip',
              idPrincipal: targetTrackId,
            })
          }
          tienda.busEventos.emit('portapapeles.pegado', { cantidad: ok })
        }
      })()
    }

    const handlers: Record<string, () => void> = {
      'transport.togglePlay': () => { void executeOrNotify(tienda, 'transport.toggle', {}) },
      'transport.pause': () => { void executeOrNotify(tienda, 'transport.toggle', {}) },
      'transport.stop': () => { void executeOrNotify(tienda, 'transport.stop', {}) },
      'transport.record': () => { void executeOrNotify(tienda, 'transport.toggleRecord', {}) },
      'transport.toggleLoop': () => { void executeOrNotify(tienda, 'transport.toggleLoop', {}) },
      'transport.goToStart': () => { void executeOrNotify(tienda, 'transport.seek', { segundos: 0 }) },
      'transport.goToEnd': () => {
        const { timeline } = st().project
        void executeOrNotify(tienda, 'transport.seek', { segundos: timeline.duracion.segundos })
      },
      'transport.toggleMetronome': () => { void executeOrNotify(tienda, 'transport.toggleMetronome', {}) },
      'transport.stepBack': () => {
        // Flechas ←/→: desplazar timeline con paso en beats × zoom (px)
        const s = st()
        const zoom = s.ui?.zoomHorizontal ?? 1
        const snapOn = s.project?.timeline?.snap ?? true
        const snap = s.project?.timeline?.snapValor ?? 1
        const beats = snapOn ? Math.max(0.0625, snap) : 1
        const deltaPx = -Math.max(4, Math.round(5 * zoom * beats))
        window.dispatchEvent(new CustomEvent('jaswave-scroll-timeline', { detail: { deltaPx } }))
      },
      'transport.stepForward': () => {
        const s = st()
        const zoom = s.ui?.zoomHorizontal ?? 1
        const snapOn = s.project?.timeline?.snap ?? true
        const snap = s.project?.timeline?.snapValor ?? 1
        const beats = snapOn ? Math.max(0.0625, snap) : 1
        const deltaPx = Math.max(4, Math.round(5 * zoom * beats))
        window.dispatchEvent(new CustomEvent('jaswave-scroll-timeline', { detail: { deltaPx } }))
      },

      'project.new': () => {
        void nuevoProyectoIO(tienda).then((r) => {
          if (!r.success && !r.canceled) {
            tienda.busEventos.emit('comando.fallido', { type: 'project.new', error: String(r.error ?? 'Error') })
          }
        })
      },
      'project.open': () => {
        void abrirProyectoIO(tienda).then((r) => {
          if (!r.success && !r.canceled) {
            tienda.busEventos.emit('comando.fallido', { type: 'project.open', error: String(r.error ?? 'Error') })
          }
        })
      },
      'project.save': () => {
        void guardarProyectoIO(tienda).then((r) => {
          if (!r.success && !r.canceled) {
            tienda.busEventos.emit('comando.fallido', { type: 'project.save', error: String(r.error ?? 'Error') })
          }
        })
      },
      'project.saveAs': () => {
        void guardarProyectoComoIO(tienda).then((r) => {
          if (!r.success && !r.canceled) {
            tienda.busEventos.emit('comando.fallido', { type: 'project.saveAs', error: String(r.error ?? 'Error') })
          }
        })
      },
      'project.close': () => {
        void cerrarProyectoIO(tienda).then((r) => {
          if (!r.success) {
            tienda.busEventos.emit('comando.fallido', { type: 'project.close', error: String(r.error ?? 'Error') })
          }
        })
      },

      'editing.undo': () => { void undoOrNotify(tienda) },
      'editing.redo': () => { void redoOrNotify(tienda) },
      'editing.copy': () => {
        const clips = collectSelectedClips()
        if (clips.length === 0) {
          if (hasNonEmptyTextSelection()) return
          tienda.busEventos.emit('comando.fallido', {
            type: 'editing.copy',
            error: 'Selecciona un clip en el arrange (clic en el clip) y vuelve a Copiar',
          })
          return
        }
        try {
          window.getSelection()?.removeAllRanges()
        } catch {
          /* ignore */
        }
        dawClipboard.setClips(clips)
        tienda.busEventos.emit('portapapeles.copiado', { cantidad: clips.length })
      },
      'editing.cut': () => {
        const clips = collectSelectedClips()
        if (clips.length === 0) {
          if (hasNonEmptyTextSelection()) return
          return
        }
        dawClipboard.setClips(clips)
        tienda.busEventos.emit('portapapeles.copiado', { cantidad: clips.length })
        const { selection, project } = st()
        for (const clipId of selection.idsClips) {
          for (const track of project.tracks) {
            if (track.clips.some((c: { id: string }) => c.id === clipId)) {
              void executeOrNotify(tienda, 'clip.delete', { pistaId: track.id, clipId })
            }
          }
        }
      },
      'editing.paste': () => {
        pasteClipboardClips()
      },
      'editing.duplicate': () => {
        const clips = collectSelectedClips()
        if (clips.length === 0) return
        // Duplicar: pegar justo después del original en la misma pista
        for (const clip of clips) {
          const inicio = clip.inicio + clip.duracion
          const isMidi =
            clip.tipo === 'midi' || (Array.isArray(clip.notas) && (clip.notas?.length ?? 0) > 0)
          if (isMidi) {
            void executeOrNotify(tienda, 'midi.clip.create', {
              pistaId: clip.pistaOrigenId,
              nombre: `${clip.nombre} (Copia)`,
              inicio,
              duracion: clip.duracion,
              color: clip.color,
              notas: (clip.notas ?? []).map((n) => ({
                pitch: n.pitch,
                inicio: n.inicio,
                duracion: n.duracion,
                velocidad: n.velocidad,
                canal: n.canal,
              })),
            })
          } else {
            void executeOrNotify(tienda, 'clip.create', {
              pistaId: clip.pistaOrigenId,
              nombre: `${clip.nombre} (Copia)`,
              inicio,
              duracion: clip.duracion,
              color: clip.color,
              sourceId: clip.sourceId,
              waveform: clip.waveform,
            })
          }
        }
      },
      'editing.delete': () => {
        const { selection, project } = st()
        for (const clipId of selection.idsClips) {
          for (const track of project.tracks) {
            if (track.clips.some((c: { id: string }) => c.id === clipId)) {
              void executeOrNotify(tienda, 'clip.delete', { pistaId: track.id, clipId })
            }
          }
        }
      },
      'editing.selectAll': () => {
        const { project } = st()
        const idsClips: string[] = []
        for (const track of project.tracks) {
          for (const clip of track.clips) idsClips.push(clip.id)
        }
        void executeOrNotify(tienda, 'selection.set', {
          idsClips,
          idsPistas: project.tracks.map((t: { id: string }) => t.id),
          tipo: 'clip',
          idPrincipal: idsClips[0] ?? null,
        })
      },
      'editing.split': () => {
        const { selection, project, transport } = st()
        const clipId = selection.idsClips[0]
        if (!clipId) return
        const tiempo =
          transport.posicion?.beats ??
          ((transport.posicion?.segundos ?? 0) * (project.bpm?.valor ?? 120)) / 60
        for (const track of project.tracks) {
          if (track.clips.some((c: { id: string }) => c.id === clipId)) {
            void executeOrNotify(tienda, 'clip.split', { pistaId: track.id, clipId, tiempo })
          }
        }
      },

      'track.create': () => {
        const count = st().project.tracks.length + 1
        void executeOrNotify(tienda, 'track.create', { nombre: `Pista ${count}`, tipo: 'audio' })
      },
      'track.createMidi': () => {
        const count = st().project.tracks.length + 1
        void executeOrNotify(tienda, 'track.create', { nombre: `MIDI ${count}`, tipo: 'midi' })
      },
      'track.delete': () => {
        const { selection } = st()
        if (selection.idPrincipal) {
          void executeOrNotify(tienda, 'track.delete', { trackId: selection.idPrincipal })
        }
      },
      'track.mute': () => {
        const { selection, project } = st()
        const id = selection.idPrincipal ?? selection.idsPistas[0]
        if (!id) return
        const track = project.tracks.find((t: { id: string }) => t.id === id)
        if (track) {
          void executeOrNotify(tienda, 'track.update', {
            trackId: id,
            datos: { silenciada: !track.silenciada },
          })
        }
      },
      'track.solo': () => {
        const { selection, project } = st()
        const id = selection.idPrincipal ?? selection.idsPistas[0]
        if (!id) return
        const track = project.tracks.find((t: { id: string }) => t.id === id)
        if (track) {
          void executeOrNotify(tienda, 'track.update', {
            trackId: id,
            datos: { soloActiva: !track.soloActiva },
          })
        }
      },
      'track.arm': () => {
        const { selection, project } = st()
        const id = selection.idPrincipal ?? selection.idsPistas[0]
        if (!id) return
        const track = project.tracks.find((t: { id: string }) => t.id === id)
        if (track) {
          void executeOrNotify(tienda, 'track.update', {
            trackId: id,
            datos: { armada: !track.armada },
          })
        }
      },
      'track.selectNext': () => {
        const { project, selection } = st()
        const tracks = project.tracks
        if (tracks.length === 0) return
        const idx = tracks.findIndex((t: { id: string }) => t.id === selection.idPrincipal)
        const next = idx < tracks.length - 1 ? idx + 1 : 0
        void executeOrNotify(tienda, 'selection.set', {
          idsPistas: [tracks[next].id],
          idsClips: [],
          tipo: 'track',
          idPrincipal: tracks[next].id,
        })
      },
      'track.selectPrevious': () => {
        const { project, selection } = st()
        const tracks = project.tracks
        if (tracks.length === 0) return
        const idx = tracks.findIndex((t: { id: string }) => t.id === selection.idPrincipal)
        const prev = idx > 0 ? idx - 1 : tracks.length - 1
        void executeOrNotify(tienda, 'selection.set', {
          idsPistas: [tracks[prev].id],
          idsClips: [],
          tipo: 'track',
          idPrincipal: tracks[prev].id,
        })
      },

      'timeline.zoomIn': () => {
        // Panel Docs con foco / undock Docs: Ctrl+= zoom tipográfico del .md.
        if (isDocsZoomTarget()) {
          bumpDocsTextZoom(0.1)
          return
        }
        // Chat / Asistente Jas con foco: zoom solo del chat
        if (isChatZoomTarget()) {
          bumpChatTextZoom(0.1)
          return
        }
        const z = st().ui?.zoomHorizontal ?? 1
        window.dispatchEvent(
          new CustomEvent('jaswave-zoom-horizontal', { detail: { zoom: Math.min(256, z * 1.25) } }),
        )
        bumpUiZoom(0.05)
      },
      'timeline.zoomOut': () => {
        if (isDocsZoomTarget()) {
          bumpDocsTextZoom(-0.1)
          return
        }
        if (isChatZoomTarget()) {
          bumpChatTextZoom(-0.1)
          return
        }
        const z = st().ui?.zoomHorizontal ?? 1
        window.dispatchEvent(
          new CustomEvent('jaswave-zoom-horizontal', { detail: { zoom: Math.max(0.15, z / 1.25) } }),
        )
        bumpUiZoom(-0.05)
      },
      'timeline.zoomToProject': () => {
        if (isDocsZoomTarget()) {
          setDocsTextZoom(1)
          return
        }
        if (isChatZoomTarget()) {
          setChatTextZoom(1)
          return
        }
        void executeOrNotify(tienda, 'ui.setZoom', { horizontal: 1, vertical: 1 })
      },
      'timeline.zoomToSelection': () => {
        /* bounds — placeholder */
      },
      'timeline.scrollLeft': () => {
        const s = st()
        const zoom = s.ui?.zoomHorizontal ?? 1
        const beatsPerBar = s.project?.timeSignature?.numerador ?? 4
        // Alt+←: un compás a la precisión del zoom actual
        const deltaPx = -Math.max(8, Math.round(5 * zoom * beatsPerBar))
        window.dispatchEvent(new CustomEvent('jaswave-scroll-timeline', { detail: { deltaPx } }))
      },
      'timeline.scrollRight': () => {
        const s = st()
        const zoom = s.ui?.zoomHorizontal ?? 1
        const beatsPerBar = s.project?.timeSignature?.numerador ?? 4
        const deltaPx = Math.max(8, Math.round(5 * zoom * beatsPerBar))
        window.dispatchEvent(new CustomEvent('jaswave-scroll-timeline', { detail: { deltaPx } }))
      },

      'view.toolSelect': () => void executeOrNotify(tienda, 'ui.setTool', { herramienta: 'select' }),
      'view.toolMove': () => void executeOrNotify(tienda, 'ui.setTool', { herramienta: 'move' }),
      'view.toolPencil': () => void executeOrNotify(tienda, 'ui.setTool', { herramienta: 'pencil' }),
      'view.toolSplit': () => void executeOrNotify(tienda, 'ui.setTool', { herramienta: 'split' }),
      'view.toolEraser': () => void executeOrNotify(tienda, 'ui.setTool', { herramienta: 'eraser' }),

      'window.commandPalette': () => {
        window.dispatchEvent(new CustomEvent('toggle-command-palette'))
        void executeOrNotify(tienda, 'ui.setPalette', {
          abierta: !st().ui?.paletaComandosAbierta,
        })
      },
      'window.keyboardShortcuts': () => {
        window.dispatchEvent(new CustomEvent('open-shortcuts-dialog'))
      },
      'window.midiMap': () => {
        requestOpenTool('midi-map')
      },
      'window.terminal': () => {
        requestOpenTool('terminal', { zone: 'bottom' })
        window.dispatchEvent(new Event('jaswave-focus-terminal'))
      },
      'window.toggleLeft': () => {
        window.dispatchEvent(new CustomEvent('jaswave-toggle-zone', { detail: { zone: 'left' } }))
      },
      'window.toggleBottom': () => {
        window.dispatchEvent(new CustomEvent('jaswave-toggle-zone', { detail: { zone: 'bottom' } }))
      },
      'window.toggleRight': () => {
        window.dispatchEvent(new CustomEvent('jaswave-toggle-zone', { detail: { zone: 'right' } }))
      },
      'window.projectSettings': () => {
        window.dispatchEvent(new CustomEvent('open-project-settings'))
      },
      'ai.askSelection': () => {
        captureActiveDocTextSelection()
        window.dispatchEvent(new CustomEvent('jaswave-ask-ai-selection'))
      },
    }

    system.bindHandlers(handlers)

    // Exponer sistema para Command Palette / UI
    ;(window as unknown as { __jaswaveActions?: ActionSystem }).__jaswaveActions = system

    const isZoomAction = (resolved: string) =>
      resolved === 'timeline.zoomIn' ||
      resolved === 'timeline.zoomOut' ||
      resolved === 'timeline.zoomToProject'

    const onMenu = (ev: Event) => {
      const id = (ev as CustomEvent<{ id: string }>).detail?.id
      if (!id) return
      const resolved = system.actions.resolveId(id) ?? id
      // Copiar/pegar clips: no bloquear por selección de texto residual
      const isClipEdit =
        resolved === 'editing.copy' ||
        resolved === 'editing.cut' ||
        resolved === 'editing.paste' ||
        resolved === 'editing.duplicate'
      // Zoom de chat/docs debe llegar aunque el panel ignore atajos globales
      if (isZoomAction(resolved) && (isChatZoomTarget() || isDocsZoomTarget())) {
        system.actions.execute(resolved)
        return
      }
      if (isClipEdit) {
        const ae = document.activeElement
        if (ae && shouldIgnoreGlobalShortcuts(ae) && !(st().selection.idsClips.length > 0)) return
      } else if (shouldIgnoreGlobalShortcuts()) {
        if (resolved !== 'window.terminal') return
      }
      system.actions.execute(resolved)
    }
    window.addEventListener('jaswave-menu-action', onMenu)

    const api = window.electron as typeof window.electron & {
      onMenuAction?: (cb: (id: string) => void) => () => void
    }
    const unsubNative = api?.onMenuAction?.((id) => {
      const resolved = system.actions.resolveId(id) ?? id
      const isClipEdit =
        resolved === 'editing.copy' ||
        resolved === 'editing.cut' ||
        resolved === 'editing.paste' ||
        resolved === 'editing.duplicate'
      if (isZoomAction(resolved) && (isChatZoomTarget() || isDocsZoomTarget())) {
        system.actions.execute(resolved)
        return
      }
      if (isClipEdit) {
        const ae = document.activeElement
        if (ae && shouldIgnoreGlobalShortcuts(ae) && !(st().selection.idsClips.length > 0)) return
      } else if (shouldIgnoreGlobalShortcuts()) {
        if (resolved !== 'window.terminal') return
      }
      system.actions.execute(resolved)
    })

    return () => {
      window.removeEventListener('jaswave-menu-action', onMenu)
      unsubNative?.()
    }
  }, [system, tienda])

  // Sincronizar store legacy si hay mapa personalizado
  useEffect(() => {
    if (atajos?.mapa && Object.keys(atajos.mapa).length > 0) {
      dispatcher.setMapa({ ...system.getLegacyMap(), ...atajos.mapa })
    }
  }, [atajos?.mapa, dispatcher, system])

  useEffect(() => {
    const syncPalette = () => {
      paletaAbiertaRef.current = Boolean(tienda.obtenerEstado().ui?.paletaComandosAbierta)
    }
    const unsub = tienda.suscribir(syncPalette)
    return () => unsub()
  }, [tienda])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (paletaAbiertaRef.current && e.key !== 'Escape') return
      if (shouldIgnoreGlobalShortcuts(e.target)) {
        const terminalChord =
          (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '`'
        const askSel =
          (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'l'
        if (terminalChord) {
          e.preventDefault()
          system.actions.execute('window.terminal')
          return
        }
        if (askSel) {
          e.preventDefault()
          captureActiveDocTextSelection()
          system.actions.execute('ai.askSelection')
          return
        }
        return
      }
      system.handleKeyboardEvent(e)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [system])

  return dispatcher
}

export function getActionSystemFromWindow(): ActionSystem | null {
  return (window as unknown as { __jaswaveActions?: ActionSystem }).__jaswaveActions ?? null
}
