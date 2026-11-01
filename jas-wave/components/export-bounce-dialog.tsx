/**
 * Diálogo «Exportar» (G2): mezcla, stems por pista, MIDI y proyecto empaquetado.
 *
 * Duración: por defecto se detecta sola (del primer al último clip audible, más la cola de reverb
 * hasta el silencio). Opcionalmente: región de loop, clips seleccionados o un rango manual en mm:ss.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { runNativeBounce, buildRuntimeBounceContent } from '@/src/lib/bounce-service'
import { exportarMidi, exportarPaquete } from '@/src/lib/export-service'
import { configBackend } from '@/src/lib/backend/config'
import { activarRenderLock, desactivarRenderLock, useRenderLock } from '@/src/lib/render-lock'
import {
  detectarFinProyecto,
  formatearDuracion,
  parsearDuracion,
} from '../../shared/src/render/fin-proyecto'
import {
  RENDER_EXTENSION,
  RENDER_FORMATS_LOSSY,
  type RenderFormat,
  type RenderJob,
} from '../../shared/src/types/render'

type Props = {
  open: boolean
  onClose: () => void
}

type Pestana = 'mezcla' | 'stems' | 'midi' | 'proyecto'
type Rango = 'auto' | 'loop' | 'seleccion' | 'manual'

const FORMATOS: Array<{ id: RenderFormat; nombre: string }> = [
  { id: 'wav', nombre: 'WAV' },
  { id: 'aiff', nombre: 'AIFF' },
  { id: 'flac', nombre: 'FLAC' },
  { id: 'mp3', nombre: 'MP3' },
  { id: 'aac', nombre: 'AAC (M4A)' },
  { id: 'ogg', nombre: 'OGG Vorbis' },
  { id: 'opus', nombre: 'Opus' },
]

const sel = 'w-36 rounded border border-border bg-panel-raised px-2 py-1 disabled:opacity-50'

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{etiqueta}</span>
      {children}
    </label>
  )
}

export function ExportBounceDialog({ open, onClose }: Props) {
  const tienda = useDAW()
  const renderLock = useRenderLock()
  const project = useDAWState((s) => s.project)
  const loop = useDAWState((s) => s.transport?.loop)

  const [pestana, setPestana] = useState<Pestana>('mezcla')
  const [format, setFormat] = useState<RenderFormat>('wav')
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(24)
  const [sampleRate, setSampleRate] = useState(48000)
  const [bitrate, setBitrate] = useState(320)
  const [rango, setRango] = useState<Rango>('auto')
  const [manualIni, setManualIni] = useState('0:00')
  const [manualFin, setManualFin] = useState('')
  const [normalize, setNormalize] = useState<'off' | 'peak' | 'lufs'>('off')
  const [listenTarget, setListenTarget] = useState<'streaming' | 'club' | 'cd' | 'off'>('streaming')
  const [stemsTap, setStemsTap] = useState<'post' | 'pre'>('post')
  const [stemIds, setStemIds] = useState<Set<string>>(new Set())
  const [midiIds, setMidiIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [ffmpeg, setFfmpeg] = useState<'si' | 'no' | 'comprobando' | 'descargando'>('comprobando')
  const [descarga, setDescarga] = useState(0)

  const fin = useMemo(() => detectarFinProyecto(project), [project])
  const bpm = Number(project?.bpm?.valor) > 0 ? Number(project.bpm.valor) : 120
  const tracks = useMemo(() => project?.tracks ?? [], [project])
  const pistasMidi = useMemo(
    () => tracks.filter((t) => (t.clips ?? []).some((c) => c.tipo === 'midi' && ((c as { notas?: unknown[] }).notas?.length ?? 0) > 0)),
    [tracks],
  )

  const loopRango =
    loop && loop.fin?.segundos > loop.inicio?.segundos ? { ini: loop.inicio.segundos, fin: loop.fin.segundos } : null
  const seleccionRango = useMemo(() => {
    let ini = Number.POSITIVE_INFINITY
    let f = 0
    for (const t of tracks) {
      for (const c of t.clips ?? []) {
        if (!c.seleccionado) continue
        ini = Math.min(ini, (c.inicio * 60) / bpm)
        f = Math.max(f, ((c.inicio + c.duracion) * 60) / bpm)
      }
    }
    return f > ini ? { ini, fin: f } : null
  }, [tracks, bpm])

  // Al abrir: comprobar el codificador y preseleccionar las pistas que suenan.
  useEffect(() => {
    if (!open) {
      setBusy(false)
      setProgress(0)
      setMessage('')
      setJobId(null)
      return
    }
    setStemIds(new Set(fin.pistasConContenido))
    setMidiIds(new Set(pistasMidi.map((t) => t.id)))
    setManualFin(formatearDuracion(fin.finSegundos))
    setFfmpeg('comprobando')
    void window.electron?.ffmpegAvailable?.()
      .then((r) => setFfmpeg(r?.ok ? 'si' : 'no'))
      .catch(() => setFfmpeg('no'))
    // Solo al abrir: no pisar lo que el usuario cambie mientras el diálogo está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => window.electron?.onFfmpegProgreso?.((p) => setDescarga(p.total ? Math.round((p.recibidos / p.total) * 100) : 0)), [])

  // FLAC no admite float: se baja a 24 bits.
  useEffect(() => {
    if (format === 'flac' && bitDepth === 32) setBitDepth(24)
  }, [format, bitDepth])

  const necesitaFfmpeg = format !== 'wav'
  const conPerdida = RENDER_FORMATS_LOSSY.includes(format)

  /** Rango elegido en segundos; endSec ausente = final automático. */
  const rangoElegido = (): { startSec: number; endSec?: number } | string => {
    if (rango === 'auto') return { startSec: 0 }
    if (rango === 'loop') return loopRango ? { startSec: loopRango.ini, endSec: loopRango.fin } : 'No hay región de loop definida.'
    if (rango === 'seleccion') return seleccionRango ? { startSec: seleccionRango.ini, endSec: seleccionRango.fin } : 'No hay clips seleccionados.'
    const ini = parsearDuracion(manualIni)
    const f = parsearDuracion(manualFin)
    if (ini == null || f == null) return 'Escribe el rango como minutos:segundos (por ejemplo 0:00 y 3:42).'
    if (f <= ini) return 'El final del rango debe ser posterior al inicio.'
    return { startSec: ini, endSec: f }
  }

  const duracionTexto = (() => {
    if (fin.vacio) return 'Sin contenido en la línea de tiempo'
    if (rango === 'auto') return `${formatearDuracion(fin.finSegundos)} + cola de reverb (se recorta el silencio)`
    const r = rangoElegido()
    return typeof r === 'string' ? r : `${formatearDuracion((r.endSec ?? 0) - r.startSec)} (${formatearDuracion(r.startSec)} → ${formatearDuracion(r.endSec ?? 0)})`
  })()

  const pedirRuta = async (sugerido: string): Promise<string | null> => {
    // Junto al proyecto: con solo el nombre, Windows abría la última carpeta usada (a menudo otra).
    const carpeta = project?.ruta ? project.ruta.replace(/[\\/][^\\/]*$/, '') : ''
    const inicial = carpeta ? `${carpeta}${carpeta.includes('\\') ? '\\' : '/'}${sugerido}` : sugerido
    const picked = window.electron?.dialogSave ? await window.electron.dialogSave(inicial) : undefined
    if (!picked || picked.canceled || !picked.filePath) return null
    return picked.filePath
  }

  const nombreBase = (project?.nombre || 'cancion').replace(/[\\/:*?"<>|]/g, '_')

  const exportarAudio = useCallback(
    async (conStems: boolean) => {
      const r = rangoElegido()
      if (typeof r === 'string') {
        setMessage(r)
        return
      }
      if (conStems && stemIds.size === 0) {
        setMessage('Elige al menos una pista para exportar como stem.')
        return
      }
      const ext = RENDER_EXTENSION[format]
      const ruta = await pedirRuta(`${nombreBase}.${ext}`)
      if (!ruta) {
        setMessage('Exportación cancelada')
        return
      }
      setBusy(true)
      setProgress(0)
      setMessage(conStems ? 'Renderizando mezcla y stems…' : 'Renderizando…')
      let startedId: string | null = null
      try {
        const res = await tienda.executor.execute('render.start', {
          format,
          ...r,
          outputPath: ruta,
          sampleRate,
          bitDepth,
          ...(conPerdida ? { bitrate } : {}),
          ...(conStems ? { stemTrackIds: [...stemIds], stemsTap } : {}),
          normalize: normalize === 'off' ? false : normalize,
          listenTarget: listenTarget === 'off' ? undefined : listenTarget,
        })
        if (!res.success || !res.result) {
          throw new Error(String(res.error?.message ?? res.error ?? 'render.start falló'))
        }
        const job = res.result as RenderJob
        startedId = job.id
        setJobId(job.id)
        // U6: mientras se renderiza, la app queda bloqueada (solo cancelar).
        activarRenderLock()
        const st = tienda.obtenerEstado()
        const content = buildRuntimeBounceContent(st, { startSec: r.startSec, endSec: job.end.segundos })
        const done = await runNativeBounce(
          job,
          content,
          (_n, payload) => {
            if (typeof payload.progress === 'number') setProgress(Math.round(Number(payload.progress) * 100))
          },
          st,
        )
        if (done.status === 'cancelled') {
          setMessage('Cancelado')
        } else if (done.status === 'completed') {
          setProgress(100)
          const lufs = done.loudness?.integrated?.toFixed(1) ?? '?'
          const seg = done.frames ? done.frames / (done.sampleRate || 48000) : 0
          const stemN = done.stemsPaths?.length ?? 0
          const listen = done.listenReport?.summary ?? ''
          setMessage(
            `Listo: ${done.outputPath} · ${formatearDuracion(seg)} · ${lufs} LUFS` +
              `${stemN ? ` · ${stemN} stems en ${done.stemsPaths![0]!.replace(/[\\/][^\\/]+$/, '')}` : ''}` +
              `${listen ? ` · ${listen}` : ''}`,
          )
          void tienda.executor.execute('analysis.fullReport', { jobId: done.id }).catch(() => undefined)
        } else {
          setMessage(done.error ?? 'Error')
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e))
        if (startedId) await tienda.executor.execute('render.cancel', { renderJobId: startedId }).catch(() => undefined)
      } finally {
        setBusy(false)
        desactivarRenderLock()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format, bitDepth, sampleRate, bitrate, rango, manualIni, manualFin, normalize, listenTarget, stemIds, stemsTap, tienda, loopRango, seleccionRango],
  )

  const exportarMidiClick = useCallback(async () => {
    if (midiIds.size === 0) {
      setMessage('Elige al menos una pista MIDI.')
      return
    }
    const ruta = await pedirRuta(`${nombreBase}.mid`)
    if (!ruta) return
    setBusy(true)
    try {
      const r = await exportarMidi(tienda, { ruta, trackIds: [...midiIds] })
      setMessage(r.mensaje)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [midiIds, tienda, nombreBase])

  const exportarProyectoClick = useCallback(async () => {
    const ruta = await pedirRuta(`${nombreBase}.jaswave.zip`)
    if (!ruta) return
    setBusy(true)
    setMessage('Empaquetando proyecto y audio…')
    try {
      const r = await exportarPaquete(tienda, { ruta })
      setMessage(r.mensaje)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [tienda, nombreBase])

  const descargarFfmpeg = useCallback(async () => {
    const api = window.electron
    if (!api?.ffmpegInstall) return
    setFfmpeg('descargando')
    setDescarga(0)
    const r = await api.ffmpegInstall(configBackend().apiUrl).catch((e: unknown) => ({ ok: false, error: String(e) }))
    if (r.ok) {
      setFfmpeg('si')
      setMessage('Codificador instalado: ya puedes exportar en MP3, AAC, FLAC, OGG, Opus y AIFF.')
    } else {
      setFfmpeg('no')
      setMessage(r.error ?? 'No se pudo descargar el codificador.')
    }
  }, [])

  const cancel = useCallback(async () => {
    if (!jobId) return
    await tienda.executor.execute('render.cancel', { renderJobId: jobId })
  }, [jobId, tienda])

  if (!open) return null

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    fn(n)
  }

  const bloqueoFormato = necesitaFfmpeg && ffmpeg !== 'si'
  const puedeAudio = !busy && !fin.vacio && !bloqueoFormato

  const opcionesAudio = (
    <>
      <Fila etiqueta="Formato">
        <select value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as RenderFormat)} className={sel}>
          {FORMATOS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nombre}
            </option>
          ))}
        </select>
      </Fila>
      {bloqueoFormato && (
        <div className="mt-2 rounded border border-accent-amber/40 bg-accent-amber/10 p-2 text-[11px] text-foreground">
          {ffmpeg === 'comprobando'
            ? 'Comprobando el codificador…'
            : ffmpeg === 'descargando'
              ? `Descargando el codificador… ${descarga}%`
              : `${format.toUpperCase()} necesita el codificador (ffmpeg), que se descarga una sola vez. WAV no lo necesita.`}
          {ffmpeg === 'no' && (
            <button
              type="button"
              className="ml-2 rounded bg-accent-amber/90 px-2 py-0.5 font-medium text-black"
              onClick={() => void descargarFfmpeg()}
            >
              Descargar codificador
            </button>
          )}
        </div>
      )}
      {conPerdida ? (
        <Fila etiqueta="Calidad">
          <select value={bitrate} disabled={busy} onChange={(e) => setBitrate(Number(e.target.value))} className={sel}>
            {[128, 192, 256, 320].map((b) => (
              <option key={b} value={b}>
                {b} kbps
              </option>
            ))}
          </select>
        </Fila>
      ) : (
        <Fila etiqueta="Profundidad">
          <select
            value={bitDepth}
            disabled={busy}
            onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24 | 32)}
            className={sel}
          >
            <option value={16}>16 bits (con dither)</option>
            <option value={24}>24 bits</option>
            <option value={32} disabled={format === 'flac'}>
              32 bits float{format === 'flac' ? ' (no en FLAC)' : ''}
            </option>
          </select>
        </Fila>
      )}
      <Fila etiqueta="Frecuencia">
        <select value={sampleRate} disabled={busy} onChange={(e) => setSampleRate(Number(e.target.value))} className={sel}>
          {[44100, 48000, 88200, 96000].map((sr) => (
            <option key={sr} value={sr}>
              {(sr / 1000).toFixed(1).replace('.0', '')} kHz
            </option>
          ))}
        </select>
      </Fila>
      <Fila etiqueta="Duración">
        <select value={rango} disabled={busy} onChange={(e) => setRango(e.target.value as Rango)} className={sel}>
          <option value="auto">Automática (hasta el final)</option>
          <option value="loop" disabled={!loopRango}>
            Región de loop
          </option>
          <option value="seleccion" disabled={!seleccionRango}>
            Clips seleccionados
          </option>
          <option value="manual">Rango manual (mm:ss)</option>
        </select>
      </Fila>
      {rango === 'manual' && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs">
          <input
            aria-label="Inicio (mm:ss)"
            value={manualIni}
            disabled={busy}
            onChange={(e) => setManualIni(e.target.value)}
            className="w-16 rounded border border-border bg-panel-raised px-2 py-1 text-center font-mono tabular-nums"
          />
          <span className="text-muted-foreground">→</span>
          <input
            aria-label="Fin (mm:ss)"
            value={manualFin}
            disabled={busy}
            onChange={(e) => setManualFin(e.target.value)}
            className="w-16 rounded border border-border bg-panel-raised px-2 py-1 text-center font-mono tabular-nums"
          />
        </div>
      )}
      <p className="mt-1 text-right text-[11px] text-muted-foreground">{duracionTexto}</p>
    </>
  )

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-panel p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-foreground">Exportar</h2>
        <div role="tablist" className="mt-3 flex gap-1 border-b border-border">
          {(
            [
              ['mezcla', 'Canción'],
              ['stems', 'Pistas (stems)'],
              ['midi', 'MIDI'],
              ['proyecto', 'Proyecto'],
            ] as Array<[Pestana, string]>
          ).map(([id, txt]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={pestana === id}
              disabled={busy}
              onClick={() => {
                setPestana(id)
                setMessage('')
              }}
              className={`rounded-t px-3 py-1.5 text-xs ${
                pestana === id ? 'bg-panel-raised font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {txt}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {pestana === 'mezcla' && (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                La canción completa por la misma cadena que oyes al reproducir: instrumentos VST3, efectos, envíos y master.
              </p>
              {opcionesAudio}
              <Fila etiqueta="Normalizar">
                <select value={normalize} disabled={busy} onChange={(e) => setNormalize(e.target.value as 'off' | 'peak' | 'lufs')} className={sel}>
                  <option value="off">No</option>
                  <option value="peak">Pico −1 dB</option>
                  <option value="lufs">−14 LUFS</option>
                </select>
              </Fila>
              <Fila etiqueta="Informe para">
                <select
                  value={listenTarget}
                  disabled={busy}
                  onChange={(e) => setListenTarget(e.target.value as 'streaming' | 'club' | 'cd' | 'off')}
                  className={sel}
                >
                  <option value="streaming">Streaming</option>
                  <option value="club">Club</option>
                  <option value="cd">CD</option>
                  <option value="off">Sin informe</option>
                </select>
              </Fila>
            </>
          )}

          {pestana === 'stems' && (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                Un WAV por pista con sus efectos, en la misma pasada que la mezcla y con la misma duración (se alinean al
                importarlos en otro DAW). Se guardan en la carpeta «&lt;nombre&gt;-stems» junto a la mezcla completa;
                el formato elegido se aplica a la mezcla y los stems salen siempre en WAV.
              </p>
              {opcionesAudio}
              <Fila etiqueta="Toma de cada pista">
                <select value={stemsTap} disabled={busy} onChange={(e) => setStemsTap(e.target.value as 'post' | 'pre')} className={sel}>
                  <option value="post">Tras fader y paneo</option>
                  <option value="pre">Antes del fader</option>
                </select>
              </Fila>
              <div className="mt-2 max-h-40 overflow-y-auto rounded border border-border p-2">
                {tracks.length === 0 && <p className="text-xs text-muted-foreground">No hay pistas.</p>}
                {tracks.map((t, i) => (
                  <label key={t.id} className="flex items-center gap-2 py-0.5 text-xs">
                    <input
                      type="checkbox"
                      disabled={busy || i >= 64}
                      checked={stemIds.has(t.id)}
                      onChange={() => toggle(stemIds, t.id, setStemIds)}
                    />
                    <span className="truncate">{t.nombre}</span>
                    {!fin.pistasConContenido.includes(t.id) && <span className="text-[10px] text-muted-foreground">(sin clips audibles)</span>}
                  </label>
                ))}
              </div>
            </>
          )}

          {pestana === 'midi' && (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                Archivo .mid estándar (tipo 1): una pista por pista, con tempo, compás y marcadores. La batería va en el
                canal 10. Las pistas de audio no se incluyen.
              </p>
              <div className="mt-2 max-h-48 overflow-y-auto rounded border border-border p-2">
                {pistasMidi.length === 0 && <p className="text-xs text-muted-foreground">No hay pistas con notas MIDI.</p>}
                {pistasMidi.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 py-0.5 text-xs">
                    <input type="checkbox" disabled={busy} checked={midiIds.has(t.id)} onChange={() => toggle(midiIds, t.id, setMidiIds)} />
                    <span className="truncate">{t.nombre}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {pestana === 'proyecto' && (
            <p className="mt-3 text-xs text-muted-foreground">
              Un .zip con el proyecto y todo el audio que usa, para abrirlo en otro equipo o carpeta sin «media faltante».
              Ábrelo con Archivo → Abrir proyecto empaquetado.
            </p>
          )}
        </div>

        {busy && (
          <div className="mt-3 h-2 overflow-hidden rounded bg-panel-raised">
            <div className="h-full bg-accent-amber transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        {renderLock && (
          <p className="mt-2 text-xs text-accent-amber">
            Render en curso: transporte y edición bloqueados. Usa «Cancelar» para detenerlo.
          </p>
        )}
        {message && (
          <p role="status" className="mt-2 break-all text-xs text-muted-foreground">
            {message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-panel-raised"
            onClick={onClose}
            disabled={busy}
          >
            Cerrar
          </button>
          {busy && jobId ? (
            <button type="button" className="rounded bg-panel-raised px-3 py-1.5 text-xs" onClick={() => void cancel()}>
              Cancelar
            </button>
          ) : (
            <button
              type="button"
              disabled={
                busy ||
                (pestana === 'mezcla' && !puedeAudio) ||
                (pestana === 'stems' && (!puedeAudio || stemIds.size === 0)) ||
                (pestana === 'midi' && midiIds.size === 0)
              }
              title={fin.vacio && (pestana === 'mezcla' || pestana === 'stems') ? 'No hay contenido en la línea de tiempo' : undefined}
              className="rounded bg-accent-amber/90 px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
              onClick={() => {
                if (pestana === 'mezcla') void exportarAudio(false)
                else if (pestana === 'stems') void exportarAudio(true)
                else if (pestana === 'midi') void exportarMidiClick()
                else void exportarProyectoClick()
              }}
            >
              Exportar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
