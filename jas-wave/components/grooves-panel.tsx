/**
 * Panel «Grooves» (M): biblioteca de ritmos MIDI de batería organizada por estilos. Árbol de estilos, búsqueda,
 * filtros (compás, tipo, intensidad, etiquetas, favoritos), vista previa en bucle por la pista elegida, botón
 * «Insertar» y arrastre al arreglo (clip MIDI con undo). Permite añadir tus propios .mid, crear/renombrar/borrar
 * estilos y borrar grooves (a la papelera).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drum, FolderOpen, FolderPlus, Pencil, Play, Plus, Search, Send, Square, Star, Trash2 } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { Button } from '@/components/ui/button'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { isMidiLikeTrack } from '@/src/lib/midi-track-io'
import { routeMidiToTrack } from '@/src/lib/plugin/vst-voice-router'
import {
  apiGrooves,
  cargarGrooves,
  insertarGroove,
  invalidarGrooves,
  notasDeGroove,
  playheadBeats,
  suscribirGrooves,
  type IndiceGrooves,
} from '@/src/lib/grooves/cliente'
import { PrevisualizadorGrooves } from '@/src/lib/grooves/previsualizador'
import { TEXTO_CONSENTIMIENTO, enviarPropuestaDeGroove, parecidosLocales, type ParecidoLocal } from '@/src/lib/grooves/propuestas'
import { GroovesSyncBar } from '@/components/grooves-sync-bar'
import {
  TIPOS_GROOVE,
  arbolDeEstilos,
  compasATexto,
  filtrarGrooves,
  type EntradaGroove,
} from '../../shared/src/grooves'

export const MIME_GROOVE = 'application/x-jaswave-groove'
const RE_BATERIA = /bater|drum|perc|kit/i
const ETIQUETA_TIPO: Record<string, string> = { groove: 'Groove', fill: 'Fill', intro: 'Intro', outro: 'Final', transicion: 'Transición' }

type Mensaje = { texto: string; error?: boolean }

export function GroovesPanel() {
  const tienda = useDAW()
  const tracks = useDAWState((s) => s.project?.tracks ?? [])
  const seleccionada = useDAWState((s) => getSelectedTrackId(s))
  const bpmProyecto = useDAWState((s) => s.project?.bpm?.valor ?? 120)
  const pistasMidi = useMemo(() => tracks.filter((t) => isMidiLikeTrack(t.tipo) && t.tipo !== 'audio'), [tracks])

  const [indice, setIndice] = useState<IndiceGrooves | null>(null)
  const [texto, setTexto] = useState('')
  const [estilo, setEstilo] = useState<string | null>(null)
  const [subestilo, setSubestilo] = useState<string | null>(null)
  const [compas, setCompas] = useState('')
  const [tipo, setTipo] = useState('')
  const [intensidadMin, setIntensidadMin] = useState(0)
  const [etiqueta, setEtiqueta] = useState('')
  const [soloFavoritos, setSoloFavoritos] = useState(false)
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [sonando, setSonando] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const [pistaDestino, setPistaDestino] = useState('')
  const [compases, setCompases] = useState(0)
  const [variacion, setVariacion] = useState(false)
  const [conFill, setConFill] = useState(false)
  const [escalar, setEscalar] = useState(false)
  const [adaptarCompas, setAdaptarCompas] = useState(false)
  const [formulario, setFormulario] = useState<'nuevo' | 'renombrar' | null>(null)
  const [nombreForm, setNombreForm] = useState('')
  const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [propuesta, setPropuesta] = useState<{ g: EntradaGroove; parecidos: ParecidoLocal[]; cargando: boolean; enviando: boolean } | null>(null)

  const previa = useRef<PrevisualizadorGrooves | null>(null)
  const seleccionRef = useRef<string | null>(null)
  seleccionRef.current = seleccion

  const recargar = useCallback(async (forzar = false) => {
    setIndice(await cargarGrooves(forzar))
  }, [])
  useEffect(() => {
    void recargar()
    return suscribirGrooves(() => void recargar(true))
  }, [recargar])

  const pistaPorDefecto = useMemo(() => {
    const sel = pistasMidi.find((t) => t.id === seleccionada)
    return (sel ?? pistasMidi.find((t) => RE_BATERIA.test(t.nombre)) ?? pistasMidi[0])?.id ?? ''
  }, [pistasMidi, seleccionada])
  const pista = pistasMidi.some((t) => t.id === pistaDestino) ? pistaDestino : pistaPorDefecto

  const todos = indice?.lista ?? []
  const arbol = useMemo(() => {
    const base = arbolDeEstilos(todos)
    // Estilos y subestilos recién creados (aún sin grooves) también aparecen en el árbol.
    for (const c of indice?.carpetas ?? []) {
      const [e, sub] = c.split('/')
      if (!e) continue
      let n = base.find((x) => x.estilo === e)
      if (!n) base.push((n = { estilo: e, total: 0, subestilos: [] }))
      if (sub && !n.subestilos.some((x) => x.subestilo === sub)) n.subestilos.push({ subestilo: sub, total: 0 })
    }
    return base.sort((a, b) => a.estilo.localeCompare(b.estilo, 'es'))
  }, [todos, indice?.carpetas])
  const compasesDisponibles = useMemo(() => [...new Set(todos.map((g) => compasATexto(g.compas)))].sort(), [todos])
  const etiquetasDisponibles = useMemo(() => [...new Set(todos.flatMap((g) => g.etiquetas))].sort(), [todos])
  const visibles = useMemo(
    () =>
      filtrarGrooves(todos, {
        texto,
        estilo: estilo ?? undefined,
        subestilo: subestilo ?? undefined,
        compas: compas || undefined,
        tipo: tipo || undefined,
        etiquetas: etiqueta ? [etiqueta] : undefined,
        intensidadMin: intensidadMin || undefined,
        soloFavoritos,
      }),
    [todos, texto, estilo, subestilo, compas, tipo, etiqueta, intensidadMin, soloFavoritos],
  )
  const actual = todos.find((g) => g.id === seleccion) ?? null

  const avisar = (texto: string, error = false) => setMensaje({ texto, error })

  const detener = useCallback(() => {
    previa.current?.detener()
    setSonando(null)
  }, [])
  useEffect(() => detener, [detener])
  // Cambiar de pista o de groove corta la vista previa (no queda sonando algo que ya no se ve).
  useEffect(() => {
    if (sonando && sonando !== seleccion) detener()
  }, [seleccion, sonando, detener])

  const alternarPrevia = async (g: EntradaGroove) => {
    if (sonando === g.id) return detener()
    if (!pista) return avisar('No hay una pista MIDI para escuchar el groove.', true)
    try {
      const notas = await notasDeGroove(g)
      previa.current ??= new PrevisualizadorGrooves((id, on, pitch, vel) => {
        const t = tienda.obtenerEstado().project.tracks.find((x) => x.id === id)
        return routeMidiToTrack(id, on, pitch, vel, { ignoreMute: true, ignorarZonas: true, plugins: t?.plugins })
      })
      previa.current.iniciar({ pistaId: pista, notas, largoBeats: g.compases * ((g.compas.numerador * 4) / g.compas.denominador), bpm: bpmProyecto })
      setSeleccion(g.id)
      setSonando(g.id)
    } catch (e) {
      avisar((e as Error).message, true)
    }
  }

  const insertar = async (g: EntradaGroove, opts: { pistaId?: string; inicioBeat?: number } = {}) => {
    const pistaId = opts.pistaId ?? pista
    if (!pistaId) return avisar('Crea o selecciona una pista de batería primero.', true)
    const r = await insertarGroove(tienda, {
      grooveId: g.id,
      pistaId,
      inicioBeat: opts.inicioBeat ?? playheadBeats(tienda),
      compases: compases > 0 ? compases : undefined,
      variacion: variacion ? 'ligera' : 'ninguna',
      fill: conFill ? true : undefined,
      escalarAlTempo: escalar,
      adaptarCompas,
      semilla: Date.now() % 100000,
    })
    avisar(r.mensaje, !r.ok)
  }

  const favorito = async (g: EntradaGroove) => {
    await apiGrooves()?.favorito(g.id, !g.favorito)
    invalidarGrooves()
  }

  const importarArchivos = async (files: File[]) => {
    const api = apiGrooves()
    if (!api) return
    if (!estilo) return avisar('Elige primero un estilo en el árbol (o crea uno con «Nuevo estilo») y suelta los .mid.', true)
    let ok = 0
    const errores: string[] = []
    for (const f of files) {
      if (!/\.(mid|midi)$/i.test(f.name)) {
        errores.push(`${f.name}: no es .mid`)
        continue
      }
      const r = await api.importarBytes(f.name, new Uint8Array(await f.arrayBuffer()), estilo, subestilo ?? undefined)
      if (r.ok) ok++
      else errores.push(`${f.name}: ${r.error}`)
    }
    invalidarGrooves()
    avisar(`${ok} groove(s) añadidos a ${estilo}${errores.length ? ` · ${errores.join(' · ')}` : ''}`, errores.length > 0 && ok === 0)
  }

  const anadirDialogo = async () => {
    const api = apiGrooves()
    if (!api) return
    if (!estilo) return avisar('Elige primero un estilo en el árbol (o crea uno con «Nuevo estilo»).', true)
    const r = await api.importarDialogo(estilo, subestilo ?? undefined)
    if (r.cancelado) return
    invalidarGrooves()
    if (!r.ok) return avisar(r.error ?? 'No se pudo importar', true)
    const errs = (r.errores ?? []).map((e) => `${e.archivo}: ${e.error}`)
    avisar(`${r.importados?.length ?? 0} groove(s) añadidos${errs.length ? ` · ${errs.join(' · ')}` : ''}`, errs.length > 0 && !r.importados?.length)
  }

  const enviarFormulario = async () => {
    const api = apiGrooves()
    if (!api || !nombreForm.trim()) return
    const nombre = nombreForm.trim()
    let r: { ok: boolean; error?: string; ruta?: string }
    if (formulario === 'nuevo') {
      // «Estilo» crea una carpeta de estilo; «Estilo/Sub» crea también el subestilo.
      const [e, sub] = nombre.split('/').map((x) => x.trim())
      r = await api.crearEstilo(e ?? '', sub || undefined)
      if (r.ok) {
        setEstilo(e ?? null)
        setSubestilo(sub || null)
      }
    } else {
      r = await api.renombrarEstilo(subestilo ? `${estilo}/${subestilo}` : (estilo ?? ''), nombre)
      if (r.ok) {
        if (subestilo) setSubestilo(nombre)
        else setEstilo(nombre)
      }
    }
    if (!r.ok) return avisar(r.error ?? 'No se pudo completar', true)
    setFormulario(null)
    setNombreForm('')
    invalidarGrooves()
  }

  /** Abre el aviso de «Proponer al catálogo»: primero compara por contenido con la biblioteca local; no envía nada aún. */
  const abrirPropuesta = async (g: EntradaGroove) => {
    setPropuesta({ g, parecidos: [], cargando: true, enviando: false })
    try {
      const parecidos = await parecidosLocales(g, todos)
      setPropuesta((p) => (p && p.g.id === g.id ? { ...p, parecidos, cargando: false } : p))
    } catch {
      setPropuesta((p) => (p && p.g.id === g.id ? { ...p, parecidos: [], cargando: false } : p))
    }
  }
  const confirmarPropuesta = async () => {
    if (!propuesta) return
    setPropuesta({ ...propuesta, enviando: true })
    const r = await enviarPropuestaDeGroove(propuesta.g)
    setPropuesta(null)
    avisar(r.mensaje, !r.ok)
  }

  const borrarGroove = async (g: EntradaGroove) => {
    const r = await apiGrooves()?.borrar(g.ruta)
    setConfirmarBorrar(null)
    if (r && !r.ok) return avisar(r.error ?? 'No se pudo borrar', true)
    if (sonando === g.id) detener()
    avisar(`«${g.nombre}» movido a la papelera`)
    invalidarGrooves()
  }

  const borrarEstilo = async () => {
    if (!estilo) return
    const r = await apiGrooves()?.borrarEstilo(subestilo ? `${estilo}/${subestilo}` : estilo)
    setConfirmarBorrar(null)
    if (r && !r.ok) return avisar(r.error ?? 'No se pudo borrar', true)
    avisar(`Estilo «${subestilo ?? estilo}» movido a la papelera`)
    setEstilo(null)
    setSubestilo(null)
    invalidarGrooves()
  }

  if (indice && !indice.disponible) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel px-4 text-center text-muted-foreground" data-testid="grooves-no-disponible">
        <Drum className="size-8 opacity-40" />
        <p className="text-[12px]">La biblioteca de grooves está disponible en la app de escritorio.</p>
      </div>
    )
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-panel ${arrastrando ? 'ring-2 ring-inset ring-accent-cyan' : ''}`}
      data-testid="grooves-panel"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setArrastrando(true)
        }
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        setArrastrando(false)
        const files = Array.from(e.dataTransfer.files ?? [])
        if (!files.length) return
        e.preventDefault()
        void importarArchivos(files)
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Drum className="size-4 text-accent-amber" />
        <h2 className="text-sm font-semibold text-foreground">Grooves</h2>
        <span className="text-[11px] text-muted-foreground">{todos.length} ritmos · {arbol.length} estilos</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => void anadirDialogo()} data-testid="groove-anadir">
            <Plus className="size-3.5" /> Añadir groove…
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setFormulario('nuevo'); setNombreForm('') }} data-testid="groove-estilo-nuevo">
            <FolderPlus className="size-3.5" /> Nuevo estilo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void apiGrooves()?.abrirCarpeta()} title={indice?.raiz} aria-label="Abrir carpeta de grooves">
            <FolderOpen className="size-3.5" />
          </Button>
        </div>
      </div>

      <GroovesSyncBar />

      {propuesta ? (
        <div className="shrink-0 space-y-1 border-b border-border bg-panel-raised/50 px-3 py-2 text-[11px]" role="dialog" aria-label="Proponer al catálogo" data-testid="groove-propuesta">
          <div className="font-medium text-foreground">Proponer «{propuesta.g.nombre}» al catálogo</div>
          {propuesta.cargando ? (
            <div className="text-muted-foreground">Comparando con tu biblioteca…</div>
          ) : (
            <>
              {propuesta.parecidos.some((p) => p.identica) ? (
                <div className="text-accent-amber" data-testid="groove-propuesta-igual">
                  Ya existe uno igual en tu biblioteca: «{propuesta.parecidos.find((p) => p.identica)!.groove.nombre}». No hace falta proponerlo.
                </div>
              ) : propuesta.parecidos.length ? (
                <div className="text-accent-amber" data-testid="groove-propuesta-parecido">
                  Se parece a: {propuesta.parecidos.map((p) => `«${p.groove.nombre}» (${Math.round(p.puntuacion)} %)`).join(', ')}. Puedes proponerlo igualmente.
                </div>
              ) : (
                <div className="text-muted-foreground">No se parece a nada de tu biblioteca.</div>
              )}
              <div className="text-muted-foreground">{TEXTO_CONSENTIMIENTO}</div>
            </>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={propuesta.cargando || propuesta.enviando || propuesta.parecidos.some((p) => p.identica)}
              onClick={() => void confirmarPropuesta()}
              data-testid="groove-propuesta-enviar"
            >
              Acepto y envío
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPropuesta(null)}>Cancelar</Button>
          </div>
        </div>
      ) : null}

      {formulario ? (
        <form
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[11px]"
          onSubmit={(e) => {
            e.preventDefault()
            void enviarFormulario()
          }}
        >
          <span className="text-muted-foreground">{formulario === 'nuevo' ? 'Nombre del estilo (o Estilo/Subestilo)' : `Nuevo nombre para «${subestilo ?? estilo}»`}</span>
          <input autoFocus value={nombreForm} onChange={(e) => setNombreForm(e.target.value)} className="min-w-0 flex-1 rounded bg-panel-raised px-2 py-1 text-foreground" maxLength={60} aria-label="Nombre del estilo" />
          <Button size="sm" type="submit">Aceptar</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setFormulario(null)}>Cancelar</Button>
        </form>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11px]">
        <label className="flex min-w-[140px] flex-1 items-center gap-1 rounded bg-panel-raised px-2 py-1">
          <Search className="size-3.5 text-muted-foreground" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar (estilo, nombre, etiqueta…)" className="w-full bg-transparent text-foreground outline-none" aria-label="Buscar grooves" data-testid="groove-buscar" />
        </label>
        <select value={compas} onChange={(e) => setCompas(e.target.value)} className="rounded bg-panel-raised px-1 py-1" aria-label="Compás">
          <option value="">Compás</option>
          {compasesDisponibles.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded bg-panel-raised px-1 py-1" aria-label="Tipo">
          <option value="">Tipo</option>
          {TIPOS_GROOVE.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}
        </select>
        <select value={intensidadMin} onChange={(e) => setIntensidadMin(Number(e.target.value))} className="rounded bg-panel-raised px-1 py-1" aria-label="Intensidad mínima">
          <option value={0}>Intensidad</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
        </select>
        <select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className="max-w-[130px] rounded bg-panel-raised px-1 py-1" aria-label="Etiqueta">
          <option value="">Etiqueta</option>
          {etiquetasDisponibles.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" onClick={() => setSoloFavoritos((v) => !v)} className={`flex items-center gap-1 rounded px-2 py-1 ${soloFavoritos ? 'bg-accent-amber/25 text-accent-amber' : 'bg-panel-raised text-muted-foreground'}`} aria-pressed={soloFavoritos}>
          <Star className="size-3.5" /> Favoritos
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="jw-scrollbar w-44 shrink-0 overflow-y-auto border-r border-border py-1 text-[12px]" aria-label="Estilos" data-testid="groove-estilos">
          <button type="button" onClick={() => { setEstilo(null); setSubestilo(null) }} className={`flex w-full items-center justify-between px-3 py-1 text-left hover:bg-panel-raised ${!estilo ? 'bg-accent-amber/15 text-accent-amber' : ''}`}>
            <span>Todos</span><span className="text-[10px] text-muted-foreground">{todos.length}</span>
          </button>
          {arbol.map((n) => (
            <div key={n.estilo}>
              <button type="button" onClick={() => { setEstilo(n.estilo); setSubestilo(null) }} className={`flex w-full items-center justify-between px-3 py-1 text-left hover:bg-panel-raised ${estilo === n.estilo && !subestilo ? 'bg-accent-amber/15 text-accent-amber' : ''}`} data-testid="groove-estilo">
                <span className="truncate">{n.estilo}</span><span className="text-[10px] text-muted-foreground">{n.total}</span>
              </button>
              {estilo === n.estilo
                ? n.subestilos.map((s) => (
                    <button key={s.subestilo} type="button" onClick={() => setSubestilo(s.subestilo)} className={`flex w-full items-center justify-between py-0.5 pl-6 pr-3 text-left text-[11px] hover:bg-panel-raised ${subestilo === s.subestilo ? 'bg-accent-amber/15 text-accent-amber' : 'text-muted-foreground'}`}>
                      <span className="truncate">{s.subestilo}</span><span className="text-[10px]">{s.total}</span>
                    </button>
                  ))
                : null}
            </div>
          ))}
          {estilo ? (
            <div className="mt-2 flex gap-1 border-t border-border px-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => { setFormulario('renombrar'); setNombreForm(subestilo ?? estilo) }} aria-label="Renombrar estilo" title="Renombrar estilo"><Pencil className="size-3.5" /></Button>
              {confirmarBorrar === 'estilo' ? (
                <Button size="sm" variant="destructive" onClick={() => void borrarEstilo()}>¿Borrar?</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmarBorrar('estilo')} aria-label="Borrar estilo" title="Borrar estilo (a la papelera)"><Trash2 className="size-3.5" /></Button>
              )}
            </div>
          ) : null}
        </nav>

        <div className="jw-scrollbar min-w-0 flex-1 overflow-y-auto" data-testid="groove-lista">
          {!indice ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">Cargando…</p>
          ) : visibles.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground" data-testid="groove-vacio">
              {todos.length === 0 ? 'La biblioteca está vacía. Añade archivos .mid o suéltalos aquí.' : 'Ningún groove cumple los filtros.'}
            </p>
          ) : (
            visibles.map((g) => (
              <div
                key={g.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(MIME_GROOVE, g.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => setSeleccion(g.id)}
                onDoubleClick={() => void insertar(g)}
                className={`flex cursor-grab items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[12px] active:cursor-grabbing ${seleccion === g.id ? 'bg-accent-amber/15' : 'hover:bg-panel-raised'}`}
                data-testid="groove-item"
                data-groove-id={g.id}
              >
                <button type="button" onClick={(e) => { e.stopPropagation(); void favorito(g) }} aria-label={g.favorito ? 'Quitar de favoritos' : 'Marcar favorito'} aria-pressed={!!g.favorito} className={g.favorito ? 'text-accent-amber' : 'text-muted-foreground/50 hover:text-foreground'}>
                  <Star className="size-3.5" fill={g.favorito ? 'currentColor' : 'none'} />
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); void alternarPrevia(g) }} aria-label={sonando === g.id ? 'Detener' : 'Escuchar'} className="rounded bg-panel-raised p-1 text-accent-cyan hover:bg-accent-cyan/20" data-testid="groove-previa">
                  {sonando === g.id ? <Square className="size-3" fill="currentColor" /> : <Play className="size-3" fill="currentColor" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{g.nombre}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {g.estilo}{g.subestilo ? ` · ${g.subestilo}` : ''} · {ETIQUETA_TIPO[g.tipo]} · {compasATexto(g.compas)} · {g.compases} c · {g.tempo} bpm · {'●'.repeat(g.intensidad)}{'○'.repeat(5 - g.intensidad)}
                    {g.origen === 'usuario' ? ' · mío' : ''}
                  </div>
                </div>
                {g.origen === 'usuario' ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); void abrirPropuesta(g) }} className="text-muted-foreground/60 hover:text-accent-amber" aria-label={`Proponer ${g.nombre} al catálogo`} title="Proponer al catálogo" data-testid="groove-proponer">
                    <Send className="size-3.5" />
                  </button>
                ) : null}
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void insertar(g) }} data-testid="groove-insertar">Insertar</Button>
                {confirmarBorrar === g.id ? (
                  <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); void borrarGroove(g) }}>¿Borrar?</Button>
                ) : (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmarBorrar(g.id) }} className="text-muted-foreground/60 hover:text-red-400" aria-label={`Borrar ${g.nombre}`} title="Mover a la papelera">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-[11px]">
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground">Pista</span>
          <select value={pista} onChange={(e) => setPistaDestino(e.target.value)} className="max-w-[140px] rounded bg-panel-raised px-1 py-0.5" aria-label="Pista destino" data-testid="groove-pista">
            {pistasMidi.length === 0 ? <option value="">(sin pistas MIDI)</option> : null}
            {pistasMidi.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1" title="0 = los compases del groove">
          <span className="text-muted-foreground">Compases</span>
          <input type="number" min={0} max={64} value={compases} onChange={(e) => setCompases(Math.max(0, Math.min(64, Number(e.target.value) || 0)))} className="w-12 rounded bg-panel-raised px-1 py-0.5" aria-label="Compases a insertar" />
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={variacion} onChange={(e) => setVariacion(e.target.checked)} /> Variación humana</label>
        <label className="flex items-center gap-1" title="Cambia el último compás por un fill del mismo estilo"><input type="checkbox" checked={conFill} onChange={(e) => setConFill(e.target.checked)} /> Fill al final</label>
        <label className="flex items-center gap-1" title="Mantiene la duración real del groove al tempo del proyecto (por defecto, las notas siguen los beats)"><input type="checkbox" checked={escalar} onChange={(e) => setEscalar(e.target.checked)} /> Escalar al tempo</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={adaptarCompas} onChange={(e) => setAdaptarCompas(e.target.checked)} /> Adaptar compás</label>
        {actual ? <Button size="sm" onClick={() => void insertar(actual)} className="ml-auto" data-testid="groove-insertar-sel">Insertar en el playhead</Button> : null}
      </div>
      {mensaje ? (
        <div role="status" className={`shrink-0 border-t border-border px-3 py-1 text-[11px] ${mensaje.error ? 'text-red-400' : 'text-muted-foreground'}`} data-testid="groove-mensaje">
          {mensaje.texto}
        </div>
      ) : null}
    </div>
  )
}
