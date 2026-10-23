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
import { batchOrNotify, executeOrNotify, redoOrNotify, undoOrNotify } from '../src/lib/execute-or-toast'
import { dawClipboard, type ClipboardClip } from '../src/lib/daw-clipboard'
import { loteBorrarClips, loteDuplicarClips, lotePegarClips } from '../src/lib/clip-edit-commands'
import { solicitarBorrarPista } from '../src/lib/track-delete-request'

import { requestOpenTool } from '../src/workspace/types'
import { bumpUiZoom } from '../src/lib/ui-zoom'
import { zoomDeModulo } from '../src/modulos/contribuciones'
import { captureActiveDocTextSelection } from '../src/lib/ai-selection-context'
import { resolveSnapDivision } from '../src/lib/timeline-snap'
import { estaRenderLock } from '../src/lib/render-lock'

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
      // Un pegado = un lote = un undo; conserva clipInicio de los clips de audio.
      const lote = lotePegarClips(clips, targetTrackId, playheadBeats)
      void (async () => {
        const r = await batchOrNotify(tienda, lote.comandos, 'editing.paste')
        if (!r.success) return
        const lastClipId = lote.idsCreados[lote.idsCreados.length - 1]
        if (lastClipId) {
          void executeOrNotify(tienda, 'selection.set', {
            idsClips: [lastClipId],
            idsPistas: [targetTrackId],
            tipo: 'clip',
            idPrincipal: targetTrackId,
          })
        }
        tienda.busEventos.emit('portapapeles.pegado', { cantidad: lote.idsCreados.length })
      })()
    }

    const deleteSelectedClips = (tipo: string) => {
      const { selection, project } = st()
      void batchOrNotify(tienda, loteBorrarClips(project, selection.idsClips), tipo)
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
        const bpb = s.project?.timeSignature?.numerador ?? 4
        const division = resolveSnapDivision(s.project?.timeline?.snapValor ?? 1, bpb)
        const beats = snapOn && division > 0 ? division : 1
        const deltaPx = -Math.max(4, Math.round(5 * zoom * beats))
        window.dispatchEvent(new CustomEvent('jaswave-scroll-timeline', { detail: { deltaPx } }))
      },
      'transport.stepForward': () => {
        const s = st()
        const zoom = s.ui?.zoomHorizontal ?? 1
        const snapOn = s.project?.timeline?.snap ?? true
        const bpb = s.project?.timeSignature?.numerador ?? 4
        const division = resolveSnapDivision(s.project?.timeline?.snapValor ?? 1, bpb)
        const beats = snapOn && division > 0 ? division : 1
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
          if (!r.success && !r.canceled) {
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
        deleteSelectedClips('editing.cut')
      },
      'editing.paste': () => {
        pasteClipboardClips()
      },
      'editing.duplicate': () => {
        const clips = collectSelectedClips()
        if (clips.length === 0) return
        // Duplicar: justo después del original en la misma pista, un solo undo.
        void batchOrNotify(tienda, loteDuplicarClips(clips).comandos, 'editing.duplicate')
      },
      'editing.delete': () => {
        deleteSelectedClips('editing.delete')
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
        const { selection, project } = st()
        const trackId = selection.idPrincipal
        if (!trackId || !project.tracks.some((t: { id: string }) => t.id === trackId)) return
        // Mismo diálogo de confirmación que el menú contextual de pista.
        solicitarBorrarPista(trackId, (id) => {
          void executeOrNotify(tienda, 'track.delete', { trackId: id })
        })
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
        // Panel de un módulo con zoom propio (Docs, chat del asistente…) con foco: zoom solo de ese panel.
        const zoomModulo = zoomDeModulo(document.activeElement)
        if (zoomModulo) {
          zoomModulo.cambiar(0.1)
          return
        }
        const z = st().ui?.zoomHorizontal ?? 1
        window.dispatchEvent(
          new CustomEvent('jaswave-zoom-horizontal', { detail: { zoom: Math.min(256, z * 1.25) } }),
        )
        bumpUiZoom(0.05)
      },
      'timeline.zoomOut': () => {
        const zoomModulo = zoomDeModulo(document.activeElement)
        if (zoomModulo) {
          zoomModulo.cambiar(-0.1)
          return
        }
        const z = st().ui?.zoomHorizontal ?? 1
        window.dispatchEvent(
          new CustomEvent('jaswave-zoom-horizontal', { detail: { zoom: Math.max(0.15, z / 1.25) } }),
        )
        bumpUiZoom(-0.05)
      },
      'timeline.zoomToProject': () => {
        const zoomModulo = zoomDeModulo(document.activeElement)
        if (zoomModulo) {
          zoomModulo.restablecer()
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
      // U6: con un render en curso la app está bloqueada (solo cancelar).
      if (estaRenderLock()) return
      const resolved = system.actions.resolveId(id) ?? id
      // Copiar/pegar clips: no bloquear por selección de texto residual
      const isClipEdit =
        resolved === 'editing.copy' ||
        resolved === 'editing.cut' ||
        resolved === 'editing.paste' ||
        resolved === 'editing.duplicate'
      // Zoom de chat/docs debe llegar aunque el panel ignore atajos globales
      if (isZoomAction(resolved) && zoomDeModulo(document.activeElement)) {
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
      // U6: con un render en curso la app está bloqueada (solo cancelar).
      if (estaRenderLock()) return
      const isClipEdit =
        resolved === 'editing.copy' ||
        resolved === 'editing.cut' ||
        resolved === 'editing.paste' ||
        resolved === 'editing.duplicate'
      if (isZoomAction(resolved) && zoomDeModulo(document.activeElement)) {
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
      // Un componente con foco (piano roll, editor de partitura, diálogo) ya
      // manejó la tecla: no ejecutar además un atajo global (nunca dos acciones).
      if (e.defaultPrevented) return
      // U6: con un render en curso la app está bloqueada (solo cancelar).
      if (estaRenderLock()) return
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
