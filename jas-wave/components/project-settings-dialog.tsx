import { useState, useEffect, useMemo, useCallback } from 'react'
import { FolderOpen, Music2, AudioLines, Settings2, Keyboard, ListOrdered, Shield, Piano, Plus, Trash2 } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { NumericField } from '@/components/ui/numeric-field'
import { TimeSignatureField } from '@/components/ui/time-signature-field'
import type { DAWState } from '../../shared/src/types/state'
import { ACCIONES_ATAJO, ATAJOS_POR_DEFECTO } from '../../shared/src'
import type { AccionAtajo } from '../../shared/src'
import { permissionManager, type AutonomyLevel } from '../../shared/src/state/permissions'
import { usePaginasAjustes } from '@/src/modulos/contribuciones'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { audioEngine } from '@/lib/audio-engine'
import { midiController } from '@/src/lib/midi-controller'
import {
  formatKeyLabel,
  getProjectKey,
  getProjectKeyRegions,
  PROJECT_KEY_ROOTS,
  type ProjectKeyConfig,
  type ProjectKeyMode,
  type ProjectKeyRegion,
} from '../../shared/src/music/project-key'

interface ProjectSettingsDialogProps {
  open: boolean
  onClose: () => void
}

const SAMPLE_RATES = [44100, 48000, 88200, 96000, 192000]
const BIT_DEPTHS = [16, 24, 32]
const BUFFER_SIZES = [64, 128, 256, 512, 1024, 2048, 4096]

type PestanaNucleo = 'general' | 'audio' | 'midi' | 'rutas' | 'atajos' | 'comandos' | 'permisos'
/** Pestañas del núcleo o el id de una página de ajustes de un módulo. */
type SettingsTab = PestanaNucleo | string

const TABS: { id: PestanaNucleo; label: string; icon: typeof Music2 }[] = [
  { id: 'general', label: 'General', icon: Music2 },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'midi', label: 'MIDI', icon: Piano },
  { id: 'rutas', label: 'Rutas', icon: FolderOpen },
  { id: 'atajos', label: 'Atajos', icon: Keyboard },
  { id: 'comandos', label: 'Comandos', icon: ListOrdered },
  { id: 'permisos', label: 'Permisos', icon: Shield },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

const INPUT =
  'rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber'
const MONO = `${INPUT} font-mono`

function Select({
  value,
  onChange,
  options,
  render,
}: {
  value: number
  onChange: (v: number) => void
  options: number[]
  render?: (v: number) => string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {render ? render(opt) : opt}
        </option>
      ))}
    </select>
  )
}

const CATEGORIAS_ATAJOS: { id: 'todas' | AccionAtajo['categoria']; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'global', label: 'Global' },
  { id: 'transporte', label: 'Transporte' },
  { id: 'edicion', label: 'Edición' },
  { id: 'daw', label: 'Pistas/Clips' },
  { id: 'ui', label: 'Herramientas' },
  { id: 'ventana', label: 'Ventanas' },
  { id: 'proyecto', label: 'Proyecto' },
]

const CATEGORIAS_COMANDOS = ['Transporte', 'Pistas', 'Edición', 'Tempo', 'Herramientas', 'Vista', 'Archivo'] as const

interface ComandoCatalogo {
  id: string
  label: string
  category: string
  description?: string
}

const COMANDOS_CATALOGO: ComandoCatalogo[] = [
  { id: 'transport.toggle', label: 'Reproducir / Pausar', category: 'Transporte', description: 'Alterna entre reproducir y pausar' },
  { id: 'transport.stop', label: 'Detener', category: 'Transporte', description: 'Detiene la reproducción' },
  { id: 'transport.toggleLoop', label: 'Loop', category: 'Transporte', description: 'Activa/desactiva el bucle' },
  { id: 'transport.toggleMetronome', label: 'Metrónomo', category: 'Transporte', description: 'Activa/desactiva el metrónomo' },
  { id: 'transport.toggleRecord', label: 'Grabación', category: 'Transporte', description: 'Activa/desactiva la grabación' },
  { id: 'transport.seek', label: 'Ir al inicio', category: 'Transporte', description: 'Mueve el cursor al inicio' },
  { id: 'track.create', label: 'Nueva pista de audio', category: 'Pistas', description: 'Añade una pista de audio al proyecto' },
  { id: 'track.create.midi', label: 'Nueva pista MIDI', category: 'Pistas', description: 'Añade una pista MIDI al proyecto' },
  { id: 'track.delete', label: 'Eliminar pista', category: 'Pistas', description: 'Elimina una pista del proyecto' },
  { id: 'track.toggleMute', label: 'Silenciar pista', category: 'Pistas', description: 'Activa/desactiva el mute' },
  { id: 'track.toggleSolo', label: 'Solo pista', category: 'Pistas', description: 'Activa/desactiva el solo' },
  { id: 'track.toggleArm', label: 'Armar pista', category: 'Pistas', description: 'Activa/desactiva el arm para grabación' },
  { id: 'track.update', label: 'Actualizar pista', category: 'Pistas', description: 'Modifica propiedades de la pista' },
  { id: 'undo', label: 'Deshacer', category: 'Edición', description: 'Deshace la última acción' },
  { id: 'redo', label: 'Rehacer', category: 'Edición', description: 'Rehace la acción deshecha' },
  { id: 'clip.create', label: 'Crear clip', category: 'Edición', description: 'Crea un clip de audio/MIDI' },
  { id: 'clip.delete', label: 'Eliminar clip', category: 'Edición', description: 'Elimina un clip seleccionado' },
  { id: 'clip.split', label: 'Cortar clip', category: 'Edición', description: 'Divide un clip en dos' },
  { id: 'clip.move', label: 'Mover clip', category: 'Edición', description: 'Mueve un clip en el timeline' },
  { id: 'project.setBpm', label: 'Cambiar BPM', category: 'Tempo', description: 'Establece el tempo del proyecto' },
  { id: 'project.setTimeSignature', label: 'Cambiar compás', category: 'Tempo', description: 'Establece la firma temporal' },
  { id: 'project.update', label: 'Actualizar proyecto', category: 'Tempo', description: 'Modifica propiedades del proyecto' },
  { id: 'ui.setTool', label: 'Cambiar herramienta', category: 'Herramientas', description: 'Selecciona la herramienta activa' },
  { id: 'ui.togglePanel', label: 'Alternar panel', category: 'Vista', description: 'Muestra/oculta un panel lateral' },
  { id: 'timeline.setSnap', label: 'Snap del timeline', category: 'Vista', description: 'Activa/desactiva el encaje en cuadrícula' },
  { id: 'master.update', label: 'Actualizar master', category: 'Vista', description: 'Modifica volumen/paneo master' },
  { id: 'atajos.actualizar', label: 'Cambiar atajo', category: 'Vista', description: 'Reasigna un atajo de teclado' },
]

function GeneralTab() {
  const tienda = useDAW()
  const project = useDAWState((s: DAWState) => s.project)
  const transport = useDAWState((s: DAWState) => s.transport)
  const [nombre, setNombre] = useState('')
  const [bpm, setBpm] = useState(120)
  const [numCompas, setNumCompas] = useState(4)
  const [denCompas, setDenCompas] = useState(4)
  const avisarInvalido = (message: string) =>
    tienda.busEventos.emit('validacion.advertencia', { code: 'INVALID_INPUT', message })
  const [keyEnabled, setKeyEnabled] = useState(false)
  const [keyRoot, setKeyRoot] = useState(60)
  const [keyMode, setKeyMode] = useState<ProjectKeyMode>('major')
  const [keyRegions, setKeyRegions] = useState<ProjectKeyRegion[]>([])

  useEffect(() => {
    if (project) {
      setNombre(project.nombre ?? 'Sin título')
      setBpm(project.bpm?.valor ?? transport?.bpm ?? 120)
      setNumCompas(project.timeSignature?.numerador ?? transport?.metronomo?.compas ?? 4)
      setDenCompas(project.timeSignature?.denominador ?? 4)
      const pk = getProjectKey(project.metadata)
      if (pk) {
        setKeyEnabled(true)
        setKeyRoot(pk.root)
        setKeyMode(pk.mode)
      } else {
        setKeyEnabled(false)
        setKeyRoot(60)
        setKeyMode('major')
      }
      setKeyRegions(getProjectKeyRegions(project.metadata))
    }
  }, [project, transport])

  const buildKeyPayload = useCallback(() => {
    if (!keyEnabled) {
      return { tonalidad: null as ProjectKeyConfig | null, tonalidadRegiones: [] as ProjectKeyRegion[] }
    }
    const tonalidad: ProjectKeyConfig = {
      enabled: true,
      label: formatKeyLabel(keyRoot, keyMode),
      root: keyRoot,
      mode: keyMode,
    }
    return { tonalidad, tonalidadRegiones: keyRegions }
  }, [keyEnabled, keyRoot, keyMode, keyRegions])

  /** Solo se envía lo que cambió: un blur sin cambios no ensucia el undo ni `modificado`. */
  const guardarNombre = () => {
    const limpio = nombre.trim()
    if (!limpio) {
      setNombre(project?.nombre ?? '')
      avisarInvalido('El nombre del proyecto no puede estar vacío')
      return
    }
    if (limpio === project?.nombre) return
    void tienda.executor.execute('project.update', { datos: { nombre: limpio } })
  }

  const guardarBpm = (valor: number) => {
    void tienda.executor.execute('project.setBpm', { bpm: valor })
  }

  const guardarCompas = (numerador: number, denominador: number) => {
    void tienda.executor.execute('project.setTimeSignature', { numerador, denominador })
  }

  const guardarTonalidad = () => {
    void tienda.executor.execute('project.update', {
      datos: buildKeyPayload(),
    })
  }

  const addKeyRegion = () => {
    const beatsPerBar = numCompas
    const lastEnd =
      keyRegions.length > 0
        ? Math.max(...keyRegions.map((r) => r.finBeats))
        : beatsPerBar * 4
    const id = `key-${Date.now()}`
    setKeyRegions((prev) => [
      ...prev,
      {
        id,
        inicioBeats: lastEnd,
        finBeats: lastEnd + beatsPerBar * 8,
        label: formatKeyLabel(keyRoot, keyMode === 'major' ? 'minor' : 'major'),
        root: keyRoot,
        mode: keyMode === 'major' ? 'minor' : 'major',
      },
    ])
  }

  const updateKeyRegion = (id: string, patch: Partial<ProjectKeyRegion>) => {
    setKeyRegions((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const next = { ...r, ...patch }
        if (patch.root != null || patch.mode != null) {
          next.label = formatKeyLabel(next.root, next.mode)
        }
        return next
      }),
    )
  }

  const removeKeyRegion = (id: string) => {
    setKeyRegions((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Nombre del proyecto">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={guardarNombre}
          className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        />
      </Field>
      <div className="flex gap-4">
        <Field label="BPM">
          {/* Vacío, texto o fuera de 20–300 (p. ej. 0) revierte al BPM actual con aviso. */}
          <NumericField
            value={bpm}
            min={20}
            max={300}
            recortar={false}
            step={0.1}
            aria-label="BPM"
            data-testid="settings-bpm"
            onCommit={guardarBpm}
            onInvalid={(m) => avisarInvalido(`BPM: ${m}`)}
            className="w-20 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
        </Field>
        <Field label="Compás">
          {/* Se confirma al salir del grupo: se puede pasar con Tab al denominador. */}
          <TimeSignatureField
            numerador={numCompas}
            denominador={denCompas}
            onCommit={guardarCompas}
            onInvalid={avisarInvalido}
            testIdPrefix="settings-timesig"
            separatorClassName="text-[12px] text-muted-foreground"
            inputClassName="w-14 rounded-md border border-border bg-panel-raised px-2 py-1.5 text-center text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
        </Field>
      </div>

      <div className="rounded-md border border-border bg-panel-raised/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-foreground">Tonalidad del proyecto</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Opcional. La IA y el editor de partitura la usan como referencia. Puedes definir cambios de
              tono por tramos de tiempo.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={keyEnabled}
              onChange={(e) => {
                setKeyEnabled(e.target.checked)
                setTimeout(guardarTonalidad, 0)
              }}
            />
            Activar
          </label>
        </div>

        {keyEnabled ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <Field label="Tónica">
                <select
                  value={keyRoot}
                  onChange={(e) => {
                    setKeyRoot(Number(e.target.value))
                  }}
                  onBlur={guardarTonalidad}
                  className={INPUT}
                >
                  {PROJECT_KEY_ROOTS.map((k) => (
                    <option key={k.root} value={k.root}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Modo">
                <select
                  value={keyMode}
                  onChange={(e) => setKeyMode(e.target.value as ProjectKeyMode)}
                  onBlur={guardarTonalidad}
                  className={INPUT}
                >
                  <option value="major">Mayor</option>
                  <option value="minor">Menor</option>
                </select>
              </Field>
              <div className="flex items-end pb-1 text-[11px] text-muted-foreground">
                {formatKeyLabel(keyRoot, keyMode)}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Regiones con otro tono (beats del arrange)
                </span>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-panel"
                  onClick={() => {
                    addKeyRegion()
                  }}
                >
                  <Plus className="size-3" />
                  Añadir región
                </button>
              </div>
              {keyRegions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Sin regiones: todo el proyecto usa la tonalidad base.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {keyRegions.map((r) => (
                    <div
                      key={r.id}
                      className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2 rounded border border-border/60 bg-background/40 p-2"
                    >
                      <Field label="Inicio (beats)">
                        <input
                          type="number"
                          min={0}
                          step={0.25}
                          value={r.inicioBeats}
                          onChange={(e) =>
                            updateKeyRegion(r.id, { inicioBeats: Number(e.target.value) })
                          }
                          onBlur={guardarTonalidad}
                          className={MONO}
                        />
                      </Field>
                      <Field label="Fin (beats)">
                        <input
                          type="number"
                          min={0}
                          step={0.25}
                          value={r.finBeats}
                          onChange={(e) => updateKeyRegion(r.id, { finBeats: Number(e.target.value) })}
                          onBlur={guardarTonalidad}
                          className={MONO}
                        />
                      </Field>
                      <Field label="Tónica">
                        <select
                          value={r.root}
                          onChange={(e) => updateKeyRegion(r.id, { root: Number(e.target.value) })}
                          onBlur={guardarTonalidad}
                          className={INPUT}
                        >
                          {PROJECT_KEY_ROOTS.map((k) => (
                            <option key={k.root} value={k.root}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Modo">
                        <select
                          value={r.mode}
                          onChange={(e) =>
                            updateKeyRegion(r.id, { mode: e.target.value as ProjectKeyMode })
                          }
                          onBlur={guardarTonalidad}
                          className={INPUT}
                        >
                          <option value="major">Mayor</option>
                          <option value="minor">Menor</option>
                        </select>
                      </Field>
                      <button
                        type="button"
                        title="Eliminar región"
                        className="mb-1 rounded p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        onClick={() => {
                          removeKeyRegion(r.id)
                          setTimeout(guardarTonalidad, 0)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="self-start rounded-md bg-accent-amber px-3 py-1.5 text-[11px] font-medium text-background"
                onClick={guardarTonalidad}
              >
                Guardar tonalidad
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

type AudioBackendInfo = { id: string; name: string; available: boolean; hint?: string }
type AudioDeviceInfo = { id: string; backend: string; name: string; isDefault?: boolean; available?: boolean }
type AudioRuntime = {
  backend: string
  deviceId: string
  deviceName: string
  sampleRate: number
  bufferSize: number
  exclusive: boolean
  running: boolean
  lastError?: string
}

function AudioTab() {
  const tienda = useDAW()
  const project = useDAWState((s: DAWState) => s.project)
  const [sampleRate, setSampleRate] = useState(48000)
  const [bitDepth, setBitDepth] = useState(24)
  const [bufferSize, setBufferSize] = useState(1024)
  const [backends, setBackends] = useState<AudioBackendInfo[]>([])
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([])
  const [backend, setBackend] = useState('auto')
  const [deviceId, setDeviceId] = useState('')
  const [runtime, setRuntime] = useState<AudioRuntime | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (project) {
      setSampleRate(project.sampleRate ?? 48000)
      setBitDepth(project.bitDepth ?? 24)
      setBufferSize(project.configuracion?.bufferSize ?? 1024)
    }
  }, [project])

  const refreshDevices = async () => {
    if (!window.electron?.pluginHostEnsure || !window.electron.pluginHostSend) {
      setStatus('El host de audio nativo solo está en la app Electron.')
      return
    }
    setBusy(true)
    try {
      await window.electron.pluginHostEnsure()
      const raw = (await window.electron.pluginHostSend({ type: 'listAudioDevices' })) as {
        ok?: boolean
        message?: string
        backends?: AudioBackendInfo[]
        devices?: AudioDeviceInfo[]
        audio?: AudioRuntime
      }
      if (!raw?.ok) {
        setStatus(raw?.message || 'No se pudieron listar los dispositivos.')
        return
      }
      setBackends(raw.backends ?? [])
      setDevices(raw.devices ?? [])
      if (raw.audio) {
        setRuntime(raw.audio)
        if (raw.audio.backend) setBackend(raw.audio.backend)
        if (raw.audio.deviceId) setDeviceId(raw.audio.deviceId)
        if (raw.audio.sampleRate) setSampleRate(raw.audio.sampleRate)
        if (raw.audio.bufferSize) setBufferSize(raw.audio.bufferSize)
      }
      setStatus(
        raw.audio?.running
          ? `En uso: ${raw.audio.backend} · ${raw.audio.deviceName || 'default'} · ${raw.audio.sampleRate} Hz / ${raw.audio.bufferSize}`
          : 'Host listo. Elige API y dispositivo y pulsa Aplicar.',
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error al enumerar audio')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refreshDevices()
     
  }, [])

  useEffect(() => {
    const onChange = () => {
      void refreshDevices()
    }
    window.addEventListener('jaswave-audio-device-changed', onChange)
    return () => window.removeEventListener('jaswave-audio-device-changed', onChange)
  }, [])

  const guardarProyecto = (next?: { sampleRate?: number; bufferSize?: number; dispositivoSalida?: string }) => {
    const sr = next?.sampleRate ?? sampleRate
    const buf = next?.bufferSize ?? bufferSize
    void tienda.executor.execute('project.update', {
      datos: {
        sampleRate: sr,
        bitDepth,
        configuracion: {
          ...project?.configuracion,
          bufferSize: buf,
          dispositivoSalida: next?.dispositivoSalida ?? project?.configuracion?.dispositivoSalida ?? '',
        },
      },
    })
  }

  const applyDevice = async () => {
    if (!window.electron?.pluginHostSend) return
    if (backend === 'asio' && (!deviceId || deviceId === 'default')) {
      setStatus('Elige un driver ASIO x64 de la lista (UMC, Yamaha, M-WAVE…). «Predeterminado» no abre ASIO.')
      return
    }
    // U6: el dispositivo solo se cambia con el transporte detenido: evita cortes,
    // clicks y perder la toma en curso.
    const transporte = tienda.obtenerEstado().transport
    if (transporte.reproduciendo || transporte.grabacion === 'grabando') {
      await tienda.executor.execute('transport.stop', {})
      const { esperarFinalizacionGrabacion } = await import('@/src/lib/recording-session')
      await esperarFinalizacionGrabacion()
    }
    setBusy(true)
    setStatus('Aplicando dispositivo…')
    try {
      await window.electron.pluginHostEnsure?.()
      const raw = (await window.electron.pluginHostSend({
        type: 'setAudioDevice',
        backend,
        deviceId,
        sampleRate,
        bufferSize,
        exclusive: backend === 'wasapi_exclusive',
      })) as {
        ok?: boolean
        message?: string
        audio?: AudioRuntime
      }
      if (raw.audio) {
        setRuntime(raw.audio)
        if (raw.audio.backend) setBackend(raw.audio.backend)
        if (raw.audio.deviceId != null) setDeviceId(raw.audio.deviceId)
        if (raw.audio.sampleRate) setSampleRate(raw.audio.sampleRate)
        if (raw.audio.bufferSize) setBufferSize(raw.audio.bufferSize)
      }
      if (!raw?.ok) {
        setStatus(raw?.message || 'No se pudo abrir el dispositivo. Se mantiene el driver que sí está running.')
        void audioEngine.rearmAfterDeviceChange(raw.audio?.sampleRate)
        return
      }
      const label = raw.audio
        ? `${raw.audio.backend} · ${raw.audio.deviceName || deviceId || 'default'}`
        : backend
      guardarProyecto({
        sampleRate: raw.audio?.sampleRate ?? sampleRate,
        bufferSize: raw.audio?.bufferSize ?? bufferSize,
        dispositivoSalida: label,
      })
      const armed = await audioEngine.rearmAfterDeviceChange(raw.audio?.sampleRate)
      const running = raw.audio?.running !== false
      if (!running) {
        setStatus(`Driver respondió pero no está running: ${label}`)
        return
      }
      if (!armed) {
        setStatus(
          `Driver activo (${label}) pero el tap PCM no se rearmó. Pulsa Play o Test tone.`,
        )
        return
      }
      const fallbackNote =
        raw.message && /WASAPI|wrapper|crash/i.test(raw.message) ? ` · ${raw.message}` : ''
      setStatus(
        `Driver activo: ${label} · ${raw.audio?.sampleRate ?? sampleRate} Hz${fallbackNote}`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error al aplicar el dispositivo')
    } finally {
      setBusy(false)
    }
  }

  const testTone = async () => {
    if (!window.electron?.pluginHostSend) return
    setBusy(true)
    try {
      await window.electron.pluginHostEnsure?.()
      const raw = (await window.electron.pluginHostSend({ type: 'testTone' })) as {
        ok?: boolean
        message?: string
      }
      setStatus(raw?.ok ? 'Tono de prueba (440 Hz, 0,5 s) enviado al device actual.' : raw?.message || 'Falló el tono')
    } finally {
      setBusy(false)
    }
  }

  const openAsioPanel = async () => {
    if (!window.electron?.pluginHostSend) return
    await window.electron.pluginHostEnsure?.()
    const raw = (await window.electron.pluginHostSend({
      type: 'asioControlPanel',
      deviceId,
    })) as { ok?: boolean; message?: string }
    if (!raw?.ok) setStatus(raw?.message || 'No se pudo abrir el panel ASIO')
  }

  const devicesForBackend = devices.filter((d) => {
    if (backend === 'auto') return true
    if (backend === 'wasapi_exclusive') return d.backend === 'wasapi_exclusive' || d.backend === 'wasapi'
    return d.backend === backend
  })
  const selectedBackend = backends.find((b) => b.id === backend)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-muted-foreground">
        El DAW usa el Plugin Host nativo como dueño del device (como REAPER): WASAPI, DirectSound, WinMM,
        JACK y ASIO. El ASIO de Behringer UMC se abre en un proceso limpio, con todos los canales y el
        buffer del panel ASIO; Chromium no debe usar esa tarjeta a la vez. Cierra REAPER/Cubase/FL si
        ya tienen el driver abierto.
      </p>
      {backend === 'asio' && /umc|behringer/i.test(deviceId) ? (
        <p className="text-[10px] text-accent-amber">
          UMC ASIO: igual que en REAPER. Al aplicar se reinicia el Plugin Host (sin WASAPI previo) y se
          abre el driver x64. Si falla, se restaura WASAPI compartido.
        </p>
      ) : null}
      {backend === 'asio' && /fl studio|asio4all|generic low latency/i.test(deviceId) ? (
        <p className="text-[10px] text-accent-amber">
          FL Studio ASIO, ASIO4ALL y Generic Low Latency envuelven WASAPI y pueden tumbar el host.
          Elige el ASIO x64 de tu interfaz o cambia a WASAPI y pulsa Aplicar.
        </p>
      ) : null}

      <Field label="API / driver">
        <select
          value={backend}
          onChange={(e) => {
            const id = e.target.value
            setBackend(id)
            if (id === 'asio') {
              const preferred = devices.find(
                (d) =>
                  d.backend === 'asio' &&
                  d.available !== false &&
                  !/fl studio|generic low latency|asio4all/i.test(d.name),
              )
              setDeviceId(preferred?.id ?? '')
            } else {
              setDeviceId('')
            }
          }}
          className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        >
          {backends.length === 0 ? <option value="auto">Automático</option> : null}
          {backends.map((b) => (
            <option key={b.id} value={b.id} disabled={!b.available && b.id !== 'auto'}>
              {b.name}
              {b.available ? '' : ' (no disponible)'}
            </option>
          ))}
        </select>
        {selectedBackend?.hint ? (
          <p className="mt-1 text-[10px] text-muted-foreground">{selectedBackend.hint}</p>
        ) : null}
      </Field>

      <Field label="Dispositivo de salida">
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        >
          <option value="">{backend === 'asio' ? '— Elige un driver ASIO —' : 'Predeterminado del sistema / API'}</option>
          {devicesForBackend.map((d) => (
            <option key={d.id} value={d.id} disabled={d.available === false}>
              {d.name}
              {d.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap gap-4">
        <Field label="Sample Rate">
          <Select
            value={sampleRate}
            onChange={(v) => setSampleRate(v)}
            options={SAMPLE_RATES}
            render={(v) => `${v} Hz`}
          />
        </Field>
        <Field label="Bit Depth">
          <Select
            value={bitDepth}
            onChange={(v) => {
              setBitDepth(v)
              setTimeout(() => guardarProyecto(), 0)
            }}
            options={BIT_DEPTHS}
            render={(v) => `${v}-bit`}
          />
        </Field>
        <Field label="Buffer Size">
          <Select
            value={bufferSize}
            onChange={(v) => setBufferSize(v)}
            options={BUFFER_SIZES}
            render={(v) => `${v} samples`}
          />
          <p className="mt-1 text-[9px] text-muted-foreground">
            Recomendado 1024 a 48 kHz con ASIO (UMC): menos underruns y menos crackle en el sistema.
            256–512 solo si necesitas latencia mínima al tocar y el CPU aguanta.
            {(backend === 'asio' || runtime?.backend === 'asio') && bufferSize < 512
              ? ' Aviso: buffers bajos + VSTi pesados pueden causar xruns y notificaciones del SO crujientes.'
              : ''}
          </p>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void applyDevice()}
          className="rounded-md bg-accent-amber px-3 py-1.5 text-[11px] font-semibold text-background hover:opacity-90 disabled:opacity-50"
        >
          Aplicar driver
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void testTone()}
          className="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-panel-raised disabled:opacity-50"
        >
          Probar tono
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refreshDevices()}
          className="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-panel-raised disabled:opacity-50"
        >
          Detectar de nuevo
        </button>
        {backend === 'asio' ? (
          <button
            type="button"
            onClick={() => void openAsioPanel()}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-panel-raised"
          >
            Panel ASIO
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true)
              try {
                const { clearPluginQuarantineAndRestore } = await import('@/src/lib/audio-device-cli')
                const r = await clearPluginQuarantineAndRestore(tienda)
                setStatus(r.message)
              } catch (e) {
                setStatus(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            })()
          }}
          className="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-panel-raised disabled:opacity-50"
          title="Limpia VSTs aislados tras crash del host y restaura ASIO/mix"
        >
          Limpiar cuarentena VST
        </button>
      </div>

      {status ? <p className="text-[11px] text-muted-foreground">{status}</p> : null}
      {runtime?.lastError ? <p className="text-[11px] text-destructive">{runtime.lastError}</p> : null}
    </div>
  )
}

const MIDI_GRID: { value: number; label: string }[] = [
  { value: 0, label: 'Sin cuantizar' },
  { value: 1, label: '1/4' },
  { value: 0.5, label: '1/8' },
  { value: 0.25, label: '1/16' },
  { value: 0.125, label: '1/32' },
  { value: 0.0625, label: '1/64' },
]

function MidiTab() {
  const tienda = useDAW()
  const project = useDAWState((s: DAWState) => s.project)
  const [status, setStatus] = useState(() => midiController.getStatus())
  const [busy, setBusy] = useState(false)

  useEffect(() => midiController.subscribeDevices(() => setStatus(midiController.getStatus())), [])

  const refresh = async () => {
    setBusy(true)
    try {
      await midiController.start()
      setStatus(midiController.getStatus())
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const persistInput = (id: string) => {
    midiController.setSelectedId(id)
    setStatus(midiController.getStatus())
    void tienda.executor.execute('project.update', {
      datos: {
        configuracion: {
          ...project?.configuracion,
          dispositivoMidiEntrada: id,
        },
      },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-muted-foreground">
        El teclado o pad entra a la pista MIDI seleccionada (o a las armadas). Arma la pista, pulsa
        Grabar y toca: se crea un clip. En Windows los dispositivos se enumeran por WinMM (como
        REAPER), no solo por Web MIDI.
      </p>

      <Field label="Controlador de entrada">
        <select
          value={status.inputId}
          onChange={(e) => persistInput(e.target.value)}
          className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        >
          <option value="all">Todos los conectados</option>
          {status.devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.manufacturer ? ` · ${d.manufacturer}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap gap-4">
        <Field label="Canal">
          <select
            value={status.channel === 'omni' ? 'omni' : String(status.channel)}
            onChange={(e) => {
              const v = e.target.value
              midiController.setChannel(v === 'omni' ? 'omni' : Number(v))
              setStatus(midiController.getStatus())
            }}
            className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          >
            <option value="omni">Omni (todos)</option>
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i} value={String(i)}>
                Canal {i + 1}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cuantizar grabación">
          <select
            value={String(status.quantizeGrid)}
            onChange={(e) => {
              midiController.setQuantizeGridBeats(Number(e.target.value))
              setStatus(midiController.getStatus())
            }}
            className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          >
            {MIDI_GRID.map((g) => (
              <option key={g.label} value={String(g.value)}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-panel-raised disabled:opacity-50"
        >
          Detectar de nuevo
        </button>
        <span className="text-[11px] text-muted-foreground">
          {status.error
            ? status.error
            : status.ready
              ? `${status.devices.length} dispositivo(s) · ${status.inputName}`
              : 'Esperando permiso MIDI…'}
        </span>
      </div>
    </div>
  )
}

function RutasTab() {
  const tienda = useDAW()
  const project = useDAWState((s: DAWState) => s.project)
  const [rutaGuardado, setRutaGuardado] = useState('')
  const [rutaExportacion, setRutaExportacion] = useState('')
  const [rutaMedios, setRutaMedios] = useState('')

  useEffect(() => {
    if (project) {
      setRutaGuardado(project.configuracion?.rutaGuardado ?? '')
      setRutaExportacion(project.configuracion?.rutaExportacion ?? '')
      setRutaMedios(project.configuracion?.rutaMedios ?? '')
    }
  }, [project])

  const guardar = () => {
    void tienda.executor.execute('project.update', {
      datos: { configuracion: { ...project?.configuracion, rutaGuardado, rutaExportacion, rutaMedios } },
    })
  }

  const RutaField = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) => (
    <Field label={label}>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={guardar}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        />
        <button
          type="button"
          className="flex items-center justify-center rounded-md border border-border bg-panel-raised px-2 hover:bg-panel-raised/80"
        >
          <FolderOpen className="size-3.5 text-muted-foreground" />
        </button>
      </div>
    </Field>
  )

  return (
    <div className="flex flex-col gap-4">
      <RutaField label="Carpeta de guardado" value={rutaGuardado} onChange={setRutaGuardado} placeholder="~/Documents/JasWave" />
      <RutaField label="Carpeta de exportación" value={rutaExportacion} onChange={setRutaExportacion} placeholder="~/Documents/JasWave/Exports" />
      <RutaField label="Carpeta de medios" value={rutaMedios} onChange={setRutaMedios} placeholder="~/Music/JasWave/Samples" />
    </div>
  )
}

function AtajosTab() {
  const tienda = useDAW()
  const atajosActuales = useDAWState((s: DAWState) => s.atajos?.mapa ?? {})
  const [filtroCat, setFiltroCat] = useState<'todas' | AccionAtajo['categoria']>('todas')
  const [busqueda, setBusqueda] = useState('')

  const filtradas = useMemo(() => {
    return ACCIONES_ATAJO.filter((a) => {
      const matchCat = filtroCat === 'todas' || a.categoria === filtroCat
      const matchBusqueda =
        !busqueda ||
        a.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
        a.id.toLowerCase().includes(busqueda.toLowerCase()) ||
        (atajosActuales[a.id] ?? '').toLowerCase().includes(busqueda.toLowerCase())
      return matchCat && matchBusqueda
    })
  }, [filtroCat, busqueda, atajosActuales])

  const handleRestaurar = (accionId: string) => {
    const defecto = ATAJOS_POR_DEFECTO[accionId]
    if (defecto) {
      tienda.executor.execute('atajos.restaurarUno', { accionId })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-md bg-panel-raised px-2.5 py-1.5">
        <Keyboard className="size-3.5 text-muted-foreground" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar atajo..."
          className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
          spellCheck={false}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {CATEGORIAS_ATAJOS.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setFiltroCat(cat.id)}
            className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] transition-colors ${
              filtroCat === cat.id
                ? 'bg-accent-amber text-background'
                : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Shortcut list */}
      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border">
        {filtradas.length === 0 && (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">No se encontraron atajos</div>
        )}
        {filtradas.map((accion) => {
          const combo = atajosActuales[accion.id] ?? accion.comandoPorDefecto
          const esDefault = combo === accion.comandoPorDefecto
          return (
            <div
              key={accion.id}
              className="flex items-center gap-3 border-b border-border/50 px-3 py-2 hover:bg-panel-raised/50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-foreground">{accion.descripcion}</div>
                <div className="text-[10px] text-muted-foreground">{accion.id}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <kbd className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                  esDefault ? 'border-border text-muted-foreground' : 'border-accent-amber/50 text-accent-amber'
                }`}>
                  {combo || 'Sin atajo'}
                </kbd>
                {!esDefault && (
                  <button
                    onClick={() => handleRestaurar(accion.id)}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    title="Restaurar por defecto"
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Para editar atajos, abre el editor dedicado con{' '}
        <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[9px]">Ctrl+Shift+,</kbd>
      </p>
    </div>
  )
}

function ComandosTab() {
  const [filtroCat, setFiltroCat] = useState<string>('Todos')
  const [busqueda, setBusqueda] = useState('')

  const filtrados = useMemo(() => {
    return COMANDOS_CATALOGO.filter((cmd) => {
      const matchCat = filtroCat === 'Todos' || cmd.category === filtroCat
      const matchBusqueda =
        !busqueda ||
        cmd.label.toLowerCase().includes(busqueda.toLowerCase()) ||
        cmd.id.toLowerCase().includes(busqueda.toLowerCase()) ||
        (cmd.description ?? '').toLowerCase().includes(busqueda.toLowerCase())
      return matchCat && matchBusqueda
    })
  }, [filtroCat, busqueda])

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-md bg-panel-raised px-2.5 py-1.5">
        <ListOrdered className="size-3.5 text-muted-foreground" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar comando..."
          className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
          spellCheck={false}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {['Todos', ...CATEGORIAS_COMANDOS].map((cat) => (
          <button
            key={cat}
            onClick={() => setFiltroCat(cat)}
            className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] transition-colors ${
              filtroCat === cat
                ? 'bg-accent-amber text-background'
                : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Command list */}
      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border">
        {filtrados.length === 0 && (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">No se encontraron comandos</div>
        )}
        {filtrados.map((cmd) => (
          <div
            key={cmd.id}
            className="flex items-center gap-3 border-b border-border/50 px-3 py-2 hover:bg-panel-raised/50"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-foreground">{cmd.label}</div>
              <div className="text-[10px] text-muted-foreground">{cmd.id}</div>
            </div>
            {cmd.description && (
              <div className="max-w-[200px] truncate text-[10px] text-muted-foreground">{cmd.description}</div>
            )}
            <span className="shrink-0 rounded bg-panel-raised px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {cmd.category}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Usa{' '}
        <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[9px]">Ctrl+Shift+P</kbd>
        {' '}para ejecutar comandos rápidamente
      </p>
    </div>
  )
}

const NIVELES_AUTONOMIA: { value: AutonomyLevel; label: string; desc: string }[] = [
  { value: 'READ_ONLY', label: 'Solo lectura', desc: 'La IA solo puede analizar, sin ejecutar comandos.' },
  { value: 'SUGGEST', label: 'Sugerir', desc: 'La IA sugiere cambios pero no los ejecuta.' },
  { value: 'CONFIRM', label: 'Confirmar', desc: 'La IA ejecuta comandos peligrosos con confirmación del usuario.' },
  { value: 'AUTO_EXECUTE_SAFE', label: 'Auto-ejecutar (seguros)', desc: 'La IA ejecuta comandos seguros automáticamente; los peligrosos requieren confirmación.' },
  { value: 'FULL_AUTONOMY', label: 'Autonomía total', desc: 'La IA ejecuta todo sin pedir confirmación (no recomendado).' },
]

function PermisosTab() {
  const config = permissionManager.getUserConfig()
  const log = permissionManager.getLog()
  const scope = permissionManager.getScope()
  const [nivel, setNivel] = useState<AutonomyLevel>(config.level)
  const [allowUnsafe, setAllowUnsafe] = useState(config.allowUnsafeTools)

  useEffect(() => {
    const c = permissionManager.getUserConfig()
    setNivel(c.level)
    setAllowUnsafe(c.allowUnsafeTools)
  }, [])

  const cambiarNivel = (nuevo: AutonomyLevel) => {
    setNivel(nuevo)
    permissionManager.setUserConfig({ ...permissionManager.getUserConfig(), level: nuevo }, 'user')
  }

  const cambiarAllowUnsafe = (v: boolean) => {
    setAllowUnsafe(v)
    permissionManager.setUserConfig({ ...permissionManager.getUserConfig(), allowUnsafeTools: v }, 'user')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="text-[12px] font-semibold text-foreground">Nivel de autonomía de la IA</div>
        <div className="flex flex-col gap-1.5">
          {NIVELES_AUTONOMIA.map((n) => (
            <button
              key={n.value}
              onClick={() => cambiarNivel(n.value)}
              className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors ${
                nivel === n.value
                  ? 'border-accent-amber bg-accent-amber/10 text-foreground'
                  : 'border-border bg-transparent text-muted-foreground hover:border-border/80 hover:bg-panel-raised/30'
              }`}
            >
              <span className="text-[12px] font-medium">{n.label}</span>
              <span className="text-[10px] text-muted-foreground">{n.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold text-foreground">Seguridad</div>
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <input
            type="checkbox"
            checked={allowUnsafe}
            onChange={(e) => cambiarAllowUnsafe(e.target.checked)}
            className="accent-accent-amber"
          />
          Permitir herramientas de riesgo alto (dangerous) sin confirmación
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold text-foreground">Ámbito</div>
        <div className="text-[11px] text-muted-foreground">
          Nivel efectivo: <span className="font-medium text-foreground">{scope.level}</span>
          {scope.expiresAt && (
            <span className="ml-2 text-accent-amber">(expira {new Date(scope.expiresAt).toLocaleTimeString()})</span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Aplica a: {scope.appliesTo.join(', ')}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold text-foreground">Registro de permisos recientes</div>
        <div className="max-h-[18vh] overflow-y-auto rounded-md border border-border">
          {log.length === 0 ? (
            <div className="px-4 py-4 text-center text-[11px] text-muted-foreground">No hay registros de permisos todavía</div>
          ) : (
            [...log].reverse().slice(0, 50).map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[11px]"
              >
                <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                  entry.allowed ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
                }`}>
                  {entry.allowed ? 'PERMITIDO' : 'BLOQUEADO'}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{entry.toolName}</span>
                <span className="shrink-0 text-muted-foreground">{entry.source}</span>
                <span className="shrink-0 text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="text-[12px] font-semibold text-foreground">Override por herramienta</div>
        </div>
        {config.overrides.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No hay overrides configurados.</div>
        ) : (
          <div className="max-h-[15vh] overflow-y-auto rounded-md border border-border">
            {config.overrides.map((o) => (
              <div key={o.toolName} className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[11px]">
                <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                  o.allowed ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
                }`}>
                  {o.allowed ? 'PERMITIDO' : 'BLOQUEADO'}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{o.toolName}</span>
                {o.requireConfirmation && <span className="shrink-0 text-accent-amber">requiere confirmación</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsPanel() {
  const paginasModulos = usePaginasAjustes()
  const [tab, setTab] = useState<SettingsTab>(() => paginasModulos[0]?.id ?? 'general')
  const paginaModulo = paginasModulos.find((p) => p.id === tab)

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Settings2 className="size-4 text-accent-amber" />
        <span className="text-[13px] font-semibold text-foreground">Configuración</span>
        <span className="text-[10px] text-muted-foreground">Panel · arrastra pestaña / desacopla a otro monitor</span>
      </div>

      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2 pt-1">
        {paginasModulos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setTab(p.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              tab === p.id
                ? 'bg-panel-raised text-foreground border-b-2 border-accent-amber'
                : 'text-muted-foreground hover:bg-panel-raised/50 hover:text-foreground'
            }`}
          >
            {p.titulo}
          </button>
        ))}
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                tab === t.id
                  ? 'bg-panel-raised text-foreground border-b-2 border-accent-amber'
                  : 'text-muted-foreground hover:bg-panel-raised/50 hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === 'general' && <GeneralTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'midi' && <MidiTab />}
        {paginaModulo ? (
          <AppErrorBoundary area={`ajustes-${paginaModulo.id}`} compact>
            <paginaModulo.componente />
          </AppErrorBoundary>
        ) : null}
        {!paginaModulo && !TABS.some((t) => t.id === tab) ? <GeneralTab /> : null}
        {tab === 'rutas' && <RutasTab />}
        {tab === 'atajos' && <AtajosTab />}
        {tab === 'comandos' && <ComandosTab />}
        {tab === 'permisos' && <PermisosTab />}
      </div>
    </div>
  )
}

/** @deprecated Preferir el panel dockeable `settings`. Redirige al workspace. */
export function ProjectSettingsDialog({ open, onClose }: ProjectSettingsDialogProps) {
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(
      new CustomEvent('jaswave-open-tool', { detail: { toolId: 'settings' as const } }),
    )
    onClose()
  }, [open, onClose])
  return null
}
