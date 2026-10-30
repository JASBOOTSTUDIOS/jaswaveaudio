import { useState, useEffect, useSyncExternalStore } from 'react'
import { escuchaEnVivo } from '../motor/escucha-en-vivo'
import {
  orquestadorBandaSingleton,
  type BandaLiveState,
  type FaseBanda,
} from '../motor/banda-orchestrator'
import {
  Users,
  CheckCircle2,
  Clock,
  Play,
  Square,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  PanelRightOpen,
  MessageSquare,
  Headphones,
  HeadphoneOff,
  Send,
} from 'lucide-react'
import { requestOpenTool } from '@jaswave/host-sdk'
import { abrirPanelBanda, cambiarVistaBanda, useVistaBanda } from './banda-vista-store'
import { TarjetaReanudar } from './tarjeta-reanudar'
import { agruparActividad, estadosEtapas, itemsDeEventos, numeroEtapa } from './actividad-agrupada'
import { FilasActividad } from './actividad-por-agente'

/** Interruptor «Escuchar en vivo»: oír cada parte que se graba y la mezcla mientras se hace. */
export function BotonEscucha({ conTexto = false }: { conTexto?: boolean }) {
  const activa = useSyncExternalStore(
    (cb) => escuchaEnVivo.suscribir(cb),
    () => escuchaEnVivo.estaActiva(),
  )
  const titulo = activa
    ? 'Escuchando en vivo: suena cada parte que se graba y la mezcla mientras se hace. Clic para trabajar en silencio.'
    : 'En silencio. Clic para escuchar en vivo cada parte que se graba y la mezcla.'
  return (
    <button
      type="button"
      aria-pressed={activa}
      aria-label="Escuchar en vivo lo que hace la banda"
      title={titulo}
      onClick={() => escuchaEnVivo.fijarActiva(!activa)}
      className={`flex shrink-0 items-center gap-1 rounded p-0.5 text-[10px] ${activa ? 'text-accent-amber hover:bg-accent-amber/15' : 'text-muted-foreground hover:bg-panel-base hover:text-foreground'}`}
    >
      {activa ? <Headphones className="size-3.5" /> : <HeadphoneOff className="size-3.5" />}
      {conTexto ? <span>{activa ? 'Escuchando' : 'En silencio'}</span> : null}
    </button>
  )
}

const FASE_CORTA: Record<FaseBanda, string> = {
  idle: 'En espera',
  planificacion: 'Planificando',
  direccion: 'Repartiendo el trabajo',
  grabacion_musicos: 'Los músicos graban',
  ensayo: 'Ensayando: la banda se pone de acuerdo',
  coherencia: 'Encajando tiempo, armonía y ritmo',
  qa_musicos: 'Revisando las partes',
  mezcla: 'Mezclando',
  qa_mezcla: 'Revisando la mezcla',
  mastering: 'Preparando el máster',
  qa_final: 'Revisión final',
  completado: 'Terminada',
  error: 'Detenida',
}

/**
 * La banda en el chat: una sola línea (etapa, avance y lo último que pasó). El detalle aparece al pasar
 * el ratón (o con el foco) en un globo flotante que no ocupa sitio; el panel aparte tiene la vista completa.
 */
export function BandaLineaCompacta() {
  const [s, setS] = useState<BandaLiveState>(() => orquestadorBandaSingleton.getState())
  useEffect(() => orquestadorBandaSingleton.subscribe((next) => setS({ ...next })), [])
  if (!s.activo && s.eventos.length === 0) return <TarjetaReanudar />
  const ultimo = s.eventos.at(-1)
  const paso = ({ planificacion: 1, direccion: 2, grabacion_musicos: 3, ensayo: 3, coherencia: 3, qa_musicos: 3, mezcla: 4, qa_mezcla: 4, mastering: 5, qa_final: 5, completado: 6 } as Partial<Record<FaseBanda, number>>)[s.faseActual] ?? 0
  const porcentaje = s.faseActual === 'completado' ? 100 : Math.round((Math.max(0, paso - 1) / 5) * 100)
  return (
    <div data-testid="banda-linea" className="group relative min-w-0" tabIndex={0} aria-label="Banda virtual: pasa el ratón para ver el detalle">
      <TarjetaReanudar />
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <Users className={`size-3.5 shrink-0 text-accent-amber ${s.activo ? 'animate-pulse' : ''}`} />
        <span className="shrink-0 font-medium text-foreground">Banda</span>
        <span className="shrink-0">· {FASE_CORTA[s.faseActual]}{s.activo ? ` · ${porcentaje} %` : ''}</span>
        {ultimo ? <span className="min-w-0 flex-1 truncate">· {ultimo.agenteNombre}: {ultimo.mensaje}</span> : <span className="flex-1" />}
        <BotonEscucha />
        <button
          type="button"
          onClick={() => {
            cambiarVistaBanda({ ubicacion: 'panel' })
            abrirPanelBanda('línea del chat', (id) => requestOpenTool(id as never, { zone: 'right' }))
          }}
          title="Ver la banda completa en su panel"
          aria-label="Abrir la banda en un panel aparte"
          className="shrink-0 rounded p-0.5 hover:bg-panel-base hover:text-foreground"
        >
          <PanelRightOpen className="size-3.5" />
        </button>
        {s.activo ? (
          <button
            type="button"
            onClick={() => orquestadorBandaSingleton.detener()}
            title="Detener la banda"
            aria-label="Detener la banda"
            className="shrink-0 rounded p-0.5 text-rose-300 hover:bg-rose-500/20"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : null}
      </div>
      {s.activo ? (
        <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-panel-base/80">
          <div className="h-full bg-accent-amber transition-all duration-300" style={{ width: `${porcentaje}%` }} />
        </div>
      ) : null}
      {/* Globo con el detalle: solo al pasar el ratón o con el foco; flota sobre el chat. */}
      <div className="invisible absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-panel-raised p-2 text-[11px] opacity-0 shadow-xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="mb-1 font-medium text-foreground">{faseLarga(s.faseActual)}</div>
        <FilasActividad filas={agruparActividad(itemsDeEventos(s.eventos, { activo: s.activo, agenteActivoId: s.agenteActivoId }))} />
        {s.qaReporte.detalles.length ? (
          <div className="mt-1 border-t border-border/50 pt-1 text-muted-foreground">
            Revisión: {s.qaReporte.musicosAprobados} de {s.qaReporte.musicosTotal} músicos aprobados
            {s.qaReporte.mezclaAprobada ? ' · mezcla aprobada' : ''}
            {s.qaReporte.masterAprobado ? ' · máster aprobado' : ''}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function faseLarga(f: FaseBanda): string {
  return f === 'completado' || f === 'error' || f === 'idle' ? FASE_CORTA[f] : `Ahora: ${FASE_CORTA[f].toLowerCase()}`
}

/**
 * Escribirle a la banda mientras trabaja: lo que el usuario ve y oye en el DAW y los agentes no. A toda la
 * banda (el agente en turno lo recibe entre dos pasos) o a un participante en particular, elegido en el
 * selector o pulsando su nombre en la consola.
 */
function EntradaNotaBanda({ state, para, onPara }: { state: BandaLiveState; para: string; onPara: (id: string) => void }) {
  const [texto, setTexto] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const participantes = state.participantes ?? []
  const destino = participantes.find((p) => p.id === para)
  const enviar = () => {
    const base = texto.trim()
    if (!base) return
    const d = destino ? { texto: base, para: destino.id } : orquestadorBandaSingleton.destinatarioDeTexto(base)
    if (orquestadorBandaSingleton.enviarNota(d.texto, d.para)) {
      setTexto('')
      setAviso(null)
    } else setAviso('No se pudo entregar: la producción ya no está en curso.')
  }
  return (
    <form
      data-testid="banda-nota"
      onSubmit={(e) => {
        e.preventDefault()
        enviar()
      }}
      className="flex flex-col gap-1 rounded-lg border border-border/60 bg-panel-base/60 p-1.5"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <select
          aria-label="A quién le escribes"
          title="A quién le escribes: a toda la banda o a un participante en particular"
          value={destino?.id ?? ''}
          onChange={(e) => onPara(e.target.value)}
          className="h-7 max-w-[40%] shrink-0 truncate rounded border border-border/60 bg-panel-raised px-1 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Toda la banda</option>
          {participantes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <input
          data-testid="banda-nota-texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={destino ? `Escríbele a ${destino.nombre}…` : 'Dile a la banda lo que ves y ellos no…'}
          aria-label="Indicación para la banda"
          className="h-7 min-w-0 flex-1 rounded border border-border/60 bg-panel-raised px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!texto.trim()}
          aria-label={destino ? `Enviar a ${destino.nombre}` : 'Enviar a la banda'}
          title={destino ? `Enviar a ${destino.nombre}` : 'Enviar a la banda (el agente en turno lo recibe entre dos pasos)'}
          className="flex size-7 shrink-0 items-center justify-center rounded bg-accent-amber/20 text-accent-amber hover:bg-accent-amber/30 disabled:opacity-40"
        >
          <Send className="size-3.5" />
        </button>
      </div>
      {aviso ? <div className="text-[10px] text-rose-300">{aviso}</div> : null}
    </form>
  )
}

/** Banda virtual en vivo. `enPanel`: dibujada en su propio panel (no dentro del chat). */
export function BandaLiveOrchestrator({ enPanel = false }: { enPanel?: boolean } = {}) {
  const vista = useVistaBanda()
  const [liveState, setLiveState] = useState<BandaLiveState>(() =>
    orquestadorBandaSingleton.getState(),
  )
  const [verTodo, setVerTodo] = useState(false)
  /** Participante al que va la próxima indicación ('' = toda la banda). */
  const [para, setPara] = useState('')

  useEffect(() => {
    return orquestadorBandaSingleton.subscribe((next) => {
      setLiveState({ ...next })
    })
  }, [])

  const faseLabels: Record<FaseBanda, string> = {
    idle: 'En espera',
    planificacion: 'Paso 1: planificando la canción',
    direccion: 'Paso 2: el director reparte el trabajo',
    grabacion_musicos: 'Paso 3: los músicos graban',
    ensayo: 'Paso 4: ensayo, la banda se escucha y se pone de acuerdo',
    coherencia: 'Paso 5: el arreglista encaja tiempo, armonía y ritmo',
    qa_musicos: 'Paso 6: revisando lo que grabaron',
    mezcla: 'Paso 7: mezclando',
    qa_mezcla: 'Paso 8: revisando la mezcla',
    mastering: 'Paso 9: preparando el máster',
    qa_final: 'Paso 10: revisión final',
    completado: 'Producción terminada',
    error: 'La producción se detuvo',
  }

  const currentStep = numeroEtapa(liveState.faseActual)
  const porcentaje = liveState.faseActual === 'completado' ? 100 : Math.round((Math.max(0, currentStep - 1) / 5) * 100)

  if (!liveState.activo && liveState.eventos.length === 0) {
    if (!enPanel) return <TarjetaReanudar />
    return (
      <div data-testid="banda-vacia" className="flex flex-col items-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <TarjetaReanudar />
        <Users className="size-5 text-accent-amber/70" />
        <span>No hay ninguna producción en curso.</span>
        <span>Pide una canción en el chat con el modo «Banda» y verás aquí a los agentes trabajando.</span>
      </div>
    )
  }

  const plegada = vista.plegada
  const moverA = (ubicacion: 'chat' | 'panel') => {
    cambiarVistaBanda({ ubicacion })
    if (ubicacion === 'panel') abrirPanelBanda('botón de la tarjeta', (id) => requestOpenTool(id as never, { zone: 'right' }))
    else requestOpenTool('coproducer', { zone: 'left' })
  }

  return (
    <div
      data-testid="banda-live"
      data-plegada={plegada ? 'si' : 'no'}
      className="@container flex min-w-0 flex-col gap-2 rounded-xl border border-accent-amber/40 bg-panel-raised/95 p-3 text-xs shadow-lg ring-1 ring-accent-amber/20"
    >
      <TarjetaReanudar />
      {/* Encabezado con estado en vivo */}
      <div className={`flex items-center justify-between gap-2 ${plegada ? '' : 'border-b border-border/60 pb-2'}`}>
        <button
          type="button"
          aria-expanded={!plegada}
          aria-label={plegada ? 'Desplegar la banda virtual' : 'Plegar la banda virtual'}
          title={plegada ? 'Desplegar' : 'Plegar'}
          onClick={() => cambiarVistaBanda({ plegada: !plegada })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {plegada ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
          <div className="relative flex size-6 items-center justify-center rounded-full bg-accent-amber/20 text-accent-amber">
            <Users className="size-3.5" />
            {liveState.activo && (
              <span className="absolute -top-0.5 -right-0.5 flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-amber opacity-75" />
                <span className="relative inline-flex rounded-full size-2 bg-accent-amber" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-foreground text-[12px] flex items-center gap-1.5">
              <span>Banda virtual</span>
              <span className="rounded bg-accent-amber/15 px-1.5 py-0.2 text-[9px] font-bold text-accent-amber uppercase tracking-wider">
                {liveState.activo ? 'Trabajando' : liveState.faseActual === 'error' ? 'Detenida' : 'Terminada'}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground truncate max-w-xs" title={liveState.promptUsuario}>
              {faseLabels[liveState.faseActual]}
              {plegada && liveState.activo ? ` · ${porcentaje} %` : ''}
            </div>
          </div>
        </button>

        <BotonEscucha conTexto />
        <button
          type="button"
          onClick={() => moverA(enPanel ? 'chat' : 'panel')}
          title={enPanel ? 'Mostrar en el chat' : 'Abrir en un panel aparte'}
          aria-label={enPanel ? 'Mostrar la banda en el chat' : 'Abrir la banda en un panel aparte'}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-panel-base hover:text-foreground"
        >
          {enPanel ? <MessageSquare className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
        </button>

        {liveState.activo && (
          <button
            type="button"
            onClick={() => orquestadorBandaSingleton.detener()}
            className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/30 transition-colors"
          >
            <Square className="size-3 fill-current" />
            <span>Detener</span>
          </button>
        )}
      </div>

      {plegada ? null : (
        <>
      {/* Etapas en una barra compacta: una sola fila que se parte si no cabe, sin cajas apiladas. */}
      <ol data-testid="banda-etapas" aria-label="Etapas de la producción" className="flex flex-wrap items-center gap-1 pt-1 text-[10px] font-medium">
        {estadosEtapas(liveState.faseActual, liveState.activo).map((et, i) => (
          <li
            key={et.etiqueta}
            aria-current={et.estado === 'actual' ? 'step' : undefined}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors ${
              et.estado === 'hecha'
                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                : et.estado === 'actual'
                  ? 'animate-pulse border-accent-amber/50 bg-accent-amber/20 text-accent-amber'
                  : 'border-border/40 bg-panel-base/40 text-muted-foreground/60'
            }`}
          >
            {et.estado === 'hecha' ? <CheckCircle2 className="size-3" aria-hidden /> : <span className="tabular-nums" aria-hidden>{i + 1}</span>}
            {et.etiqueta}
          </li>
        ))}
      </ol>

      {/* Barra de progreso interactiva */}
      {liveState.activo && (
        <div className="w-full bg-panel-base/80 h-1.5 rounded-full overflow-hidden mt-1">
          <div className="bg-accent-amber h-full transition-all duration-300" style={{ width: `${porcentaje}%` }} />
        </div>
      )}

      {/* Consola: una fila por agente con su estado actual; el historial completo, cerrado y con scroll. */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-panel-base/80 p-2 text-[11px] leading-tight">
        <FilasActividad
          filas={agruparActividad(itemsDeEventos(liveState.eventos, { activo: liveState.activo, agenteActivoId: liveState.agenteActivoId }))}
          onElegir={liveState.activo ? (id) => ((liveState.participantes ?? []).some((p) => p.id === id) ? setPara(id) : undefined) : undefined}
        />
        {liveState.eventos.length > 6 ? (
          <>
            <button
              type="button"
              aria-expanded={verTodo}
              onClick={() => setVerTodo((v) => !v)}
              className="self-start text-[10px] text-muted-foreground hover:text-foreground"
            >
              {verTodo ? 'Ocultar el historial' : `Ver el historial completo (${liveState.eventos.length})`}
            </button>
            {verTodo ? (
              <ol className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain rounded border border-border/40 bg-panel-raised/50 px-1.5 py-1 text-[10px]">
                {liveState.eventos.map((ev) => (
                  <li key={ev.id} className="break-words text-muted-foreground">
                    <span className="font-semibold" style={{ color: ev.color }}>{ev.agenteNombre}:</span> {ev.mensaje}
                    {ev.accionDetalle ? <span className="block whitespace-pre-line pl-2 text-muted-foreground/70">{ev.accionDetalle}</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Escribirle a la banda (o a un participante) mientras trabaja */}
      {liveState.activo ? <EntradaNotaBanda state={liveState} para={para} onPara={setPara} /> : null}

      {/* Resumen de QA */}
      {liveState.qaReporte.detalles.length > 0 && (
        <div className="flex items-start gap-2 pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-400 shrink-0" />
          <span className="min-w-0 break-words">
            Revisión de calidad: {liveState.qaReporte.musicosAprobados} de {liveState.qaReporte.musicosTotal} músicos aprobados
            {liveState.qaReporte.mezclaAprobada ? ' · mezcla aprobada' : ''}
            {liveState.qaReporte.masterAprobado ? ' · máster aprobado' : ''}
            {liveState.qaReporte.rondas
              ? ` · ${liveState.qaReporte.rondas} ${liveState.qaReporte.rondas === 1 ? 'corrección' : 'correcciones'}`
              : ''}
          </span>
        </div>
      )}
        </>
      )}
    </div>
  )
}
