import { useState, useEffect, useMemo } from 'react'
import { X, FolderOpen, Save, Music2, AudioLines, Settings2, Keyboard, ListOrdered, Shield, Bot } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { ACCIONES_ATAJO, ATAJOS_POR_DEFECTO } from '../../shared/src'
import type { AccionAtajo } from '../../shared/src'
import { permissionManager, type AutonomyLevel } from '../../shared/src/state/permissions'
import {
  loadAiSettings,
  saveAiSettings,
  upsertProviderModel,
  createProviderProfile,
  getActiveProvider,
  PROVIDER_PRESETS,
  type AiSettings,
  type AiProviderKind,
  type AiProviderProfile,
} from '@/src/lib/ai-settings'
import { JasWaveLogo } from '@/components/brand'

interface ProjectSettingsDialogProps {
  open: boolean
  onClose: () => void
}

const SAMPLE_RATES = [44100, 48000, 88200, 96000, 192000]
const BIT_DEPTHS = [16, 24, 32]
const BUFFER_SIZES = [64, 128, 256, 512, 1024, 2048, 4096]

const COMPASES_COMUNES = [
  [4, 4], [3, 4], [2, 4], [5, 4], [7, 4],
  [6, 8], [3, 8], [5, 8], [7, 8], [9, 8], [12, 8],
] as const

type SettingsTab = 'general' | 'audio' | 'rutas' | 'atajos' | 'comandos' | 'permisos' | 'ia'

const TABS: { id: SettingsTab; label: string; icon: typeof Music2 }[] = [
  { id: 'general', label: 'General', icon: Music2 },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'ia', label: 'IA', icon: Bot },
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

  useEffect(() => {
    if (project) {
      setNombre(project.nombre ?? 'Sin título')
      setBpm(project.bpm?.valor ?? transport?.bpm ?? 120)
      setNumCompas(project.timeSignature?.numerador ?? transport?.metronomo?.compas ?? 4)
      setDenCompas(project.timeSignature?.denominador ?? 4)
    }
  }, [project, transport])

  const guardar = () => {
    void tienda.executor.execute('project.update', {
      datos: {
        nombre,
        bpm: { valor: bpm, tipo: 'constante' },
        timeSignature: { numerador: numCompas, denominador: denCompas },
      },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Nombre del proyecto">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={guardar}
          className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        />
      </Field>
      <div className="flex gap-4">
        <Field label="BPM">
          <input
            type="number"
            value={bpm}
            min={20}
            max={300}
            step={0.1}
            onChange={(e) => setBpm(Number(e.target.value))}
            onBlur={guardar}
            className="w-20 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
        </Field>
        <Field label="Compás">
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={numCompas}
              min={1}
              max={12}
              onChange={(e) => setNumCompas(Number(e.target.value))}
              onBlur={guardar}
              className="w-14 rounded-md border border-border bg-panel-raised px-2 py-1.5 text-center text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
            />
            <span className="text-[12px] text-muted-foreground">/</span>
            <input
              type="number"
              value={denCompas}
              min={1}
              max={32}
              onChange={(e) => setDenCompas(Number(e.target.value))}
              onBlur={guardar}
              className="w-14 rounded-md border border-border bg-panel-raised px-2 py-1.5 text-center text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
            />
          </div>
        </Field>
      </div>
    </div>
  )
}

function AudioTab() {
  const tienda = useDAW()
  const project = useDAWState((s: DAWState) => s.project)
  const [sampleRate, setSampleRate] = useState(48000)
  const [bitDepth, setBitDepth] = useState(24)
  const [bufferSize, setBufferSize] = useState(512)

  useEffect(() => {
    if (project) {
      setSampleRate(project.sampleRate ?? 48000)
      setBitDepth(project.bitDepth ?? 24)
      setBufferSize(project.configuracion?.bufferSize ?? 512)
    }
  }, [project])

  const guardar = () => {
    void tienda.executor.execute('project.update', {
      datos: { sampleRate, bitDepth, configuracion: { ...project?.configuracion, bufferSize } },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        <Field label="Sample Rate">
          <Select value={sampleRate} onChange={(v) => { setSampleRate(v); setTimeout(guardar, 0) }} options={SAMPLE_RATES} render={(v) => `${v} Hz`} />
        </Field>
        <Field label="Bit Depth">
          <Select value={bitDepth} onChange={(v) => { setBitDepth(v); setTimeout(guardar, 0) }} options={BIT_DEPTHS} render={(v) => `${v}-bit`} />
        </Field>
        <Field label="Buffer Size">
          <Select value={bufferSize} onChange={(v) => { setBufferSize(v); setTimeout(guardar, 0) }} options={BUFFER_SIZES} render={(v) => `${v} samples`} />
        </Field>
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

function AiTab() {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings())
  const [newModel, setNewModel] = useState('')
  const [addKind, setAddKind] = useState<AiProviderKind>('openai')
  const [remoteModels, setRemoteModels] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [statusHint, setStatusHint] = useState('')
  const [showKey, setShowKey] = useState(false)

  const active = useMemo(() => getActiveProvider(settings), [settings])
  const preset = PROVIDER_PRESETS[active.kind]

  const persist = (next: AiSettings) => {
    setSettings(next)
    saveAiSettings(next)
    window.dispatchEvent(new CustomEvent('jaswave-ai-settings-changed'))
  }

  const updateActive = (patch: Partial<AiProviderProfile>) => {
    const providers = settings.providers.map((p) => (p.id === active.id ? { ...p, ...patch } : p))
    persist({ ...settings, providers })
  }

  const refreshHealth = async (provider: AiProviderProfile = active) => {
    setStatus('checking')
    setStatusHint('')
    if (!window.electron?.aiHealth) {
      setStatus('error')
      setStatusMsg('La IA en la nube solo funciona en la app Electron (escritorio).')
      setStatusHint('Abre JasWave con npm run dev / electron, no solo el navegador.')
      setRemoteModels([])
      return
    }
    try {
      const result = await window.electron.aiHealth({
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
      })
      const models = Array.isArray(result.models)
        ? result.models
            .map((m) => (typeof m === 'string' ? m : String((m as { name?: string })?.name ?? m)))
            .filter(Boolean)
        : []
      setRemoteModels(models)
      if (result.status === 'healthy') {
        setStatus('ok')
        setStatusMsg(
          models.length
            ? `Conectado a ${PROVIDER_PRESETS[provider.kind].label}: ${models.length} modelo(s) detectados.`
            : `Conectado a ${PROVIDER_PRESETS[provider.kind].label}.`,
        )
        setStatusHint(result.hint || '')
        if (models.length) {
          const latest = loadAiSettings()
          const providers = latest.providers.map((p) =>
            p.id === provider.id
              ? { ...p, models: Array.from(new Set([...p.models, ...models])) }
              : p,
          )
          persist({ ...latest, providers })
        }
      } else {
        setStatus('error')
        setStatusMsg(result.error || `No se pudo conectar con ${PROVIDER_PRESETS[provider.kind].label}.`)
        setStatusHint(result.hint || 'Revisa URL, API key y modelo en esta pestaña.')
      }
    } catch (err) {
      setStatus('error')
      setStatusMsg(err instanceof Error ? err.message : 'Error de conexión')
      setStatusHint('No se silenció el error: revisa la consola y la configuración.')
      setRemoteModels([])
    }
  }

  useEffect(() => {
    void refreshHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.activeProviderId])

  const allModels = useMemo(() => {
    const set = new Set<string>([
      ...remoteModels,
      ...active.models,
      ...preset.suggestedModels,
      active.selectedModel,
    ])
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [remoteModels, active.models, active.selectedModel, preset.suggestedModels])

  const addModel = () => {
    const name = newModel.trim()
    if (!name) {
      setStatus('error')
      setStatusMsg('Escribe un nombre de modelo antes de añadir.')
      setStatusHint('Ejemplos: gpt-4o-mini, claude-sonnet-4-20250514, gemini-2.0-flash')
      return
    }
    const updated = upsertProviderModel(active, name)
    const providers = settings.providers.map((p) => (p.id === active.id ? updated : p))
    persist({ ...settings, providers })
    setNewModel('')
    setStatus('ok')
    setStatusMsg(`Modelo «${name}» añadido y seleccionado.`)
    setStatusHint('')
  }

  const removeModel = (name: string) => {
    const models = active.models.filter((m) => m !== name)
    const selectedModel =
      active.selectedModel === name ? models[0] ?? preset.defaultModel : active.selectedModel
    updateActive({ models, selectedModel })
  }

  const addProvider = () => {
    const profile = createProviderProfile(addKind)
    persist({
      ...settings,
      providers: [...settings.providers, profile],
      activeProviderId: profile.id,
    })
    setStatus('idle')
    setStatusMsg(`Proveedor «${profile.name}» añadido. Configura la API key y prueba la conexión.`)
    setStatusHint(PROVIDER_PRESETS[addKind].hint)
  }

  const removeActiveProvider = () => {
    if (settings.providers.length <= 1) {
      setStatus('error')
      setStatusMsg('Debes conservar al menos un proveedor.')
      setStatusHint('Añade otro proveedor antes de eliminar este.')
      return
    }
    const providers = settings.providers.filter((p) => p.id !== active.id)
    persist({ ...settings, providers, activeProviderId: providers[0].id })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-md border border-border bg-panel-raised/40 px-3 py-2.5">
        <JasWaveLogo className="h-14 w-auto max-w-[160px] shrink-0" alt="JasWave IA" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground">Asistente Jas</div>
          <p className="text-[11px] text-muted-foreground">
            OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Kilo Code u otro endpoint compatible.
          </p>
        </div>
      </div>

      <Field label="Proveedor activo">
        <div className="flex flex-wrap gap-2">
          <select
            value={settings.activeProviderId}
            onChange={(e) => persist({ ...settings, activeProviderId: e.target.value })}
            className="min-w-0 flex-1 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          >
            {settings.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({PROVIDER_PRESETS[p.kind].label})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={removeActiveProvider}
            className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-destructive"
          >
            Quitar
          </button>
        </div>
      </Field>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Añadir proveedor">
          <select
            value={addKind}
            onChange={(e) => setAddKind(e.target.value as AiProviderKind)}
            className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          >
            {(Object.keys(PROVIDER_PRESETS) as AiProviderKind[]).map((k) => (
              <option key={k} value={k}>
                {PROVIDER_PRESETS[k].label}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          onClick={addProvider}
          className="rounded-md bg-accent-amber/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
        >
          Añadir
        </button>
      </div>

      <Field label="Nombre en la app">
        <input
          type="text"
          value={active.name}
          onChange={(e) => updateActive({ name: e.target.value })}
          onBlur={() => persist(settings)}
          className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        />
      </Field>

      <Field label="URL base">
        <div className="flex gap-2">
          <input
            type="text"
            value={active.baseUrl}
            onChange={(e) => {
              const baseUrl = e.target.value
              setSettings((s) => ({
                ...s,
                providers: s.providers.map((p) => (p.id === active.id ? { ...p, baseUrl } : p)),
              }))
            }}
            onBlur={() => persist(settings)}
            placeholder={preset.defaultBaseUrl}
            className="min-w-0 flex-1 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
          <button
            type="button"
            onClick={() => {
              persist(settings)
              void refreshHealth(getActiveProvider(settings))
            }}
            className="shrink-0 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-background"
          >
            Probar
          </button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{preset.hint}</p>
      </Field>

      {preset.needsApiKey || active.kind === 'openai-compatible' ? (
        <Field label={preset.needsApiKey ? 'API key (obligatoria)' : 'API key (opcional)'}>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={active.apiKey}
              onChange={(e) => {
                const apiKey = e.target.value
                setSettings((s) => ({
                  ...s,
                  providers: s.providers.map((p) => (p.id === active.id ? { ...p, apiKey } : p)),
                }))
              }}
              onBlur={() => persist(settings)}
              placeholder={preset.needsApiKey ? 'sk-… / clave del proveedor' : 'si el endpoint la pide'}
              className="min-w-0 flex-1 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showKey ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Se guarda solo en este equipo (localStorage). No se sube a ningún servidor de JasWave.
          </p>
        </Field>
      ) : null}

      <div
        className={`rounded-md border px-3 py-2 text-[11px] ${
          status === 'ok'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : status === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-border bg-panel-raised/40 text-muted-foreground'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="font-medium">
          {status === 'checking' ? 'Comprobando proveedor…' : statusMsg || 'Pulsa «Probar» para validar la conexión.'}
        </div>
        {statusHint ? <div className="mt-1 opacity-90">{statusHint}</div> : null}
      </div>

      <Field label="Modelo activo">
        <select
          value={active.selectedModel}
          onChange={(e) => updateActive({ selectedModel: e.target.value })}
          className="w-full rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
        >
          {allModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-4">
        <Field label="Temperatura">
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => setSettings((s) => ({ ...s, temperature: Number(e.target.value) }))}
            onBlur={() => persist(settings)}
            className="w-24 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
        </Field>
        <Field label="Max tokens">
          <input
            type="number"
            min={256}
            max={128000}
            step={256}
            value={settings.maxTokens}
            onChange={(e) => setSettings((s) => ({ ...s, maxTokens: Number(e.target.value) }))}
            onBlur={() => persist(settings)}
            className="w-28 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] font-mono text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
        </Field>
      </div>

      <Field label="Añadir modelo">
        <div className="flex gap-2">
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addModel()
            }}
            placeholder="id exacto del modelo del proveedor"
            className="min-w-0 flex-1 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
          />
          <button
            type="button"
            onClick={addModel}
            className="shrink-0 rounded-md bg-accent-amber/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
          >
            Añadir
          </button>
        </div>
      </Field>

      {active.models.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Modelos del proveedor
          </div>
          <div className="max-h-[18vh] overflow-y-auto rounded-md border border-border">
            {active.models.map((m) => (
              <div
                key={m}
                className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[12px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">{m}</span>
                <button
                  type="button"
                  onClick={() => removeModel(m)}
                  className="text-[10px] text-muted-foreground hover:text-destructive"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectSettingsDialog({ open, onClose }: ProjectSettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('general')

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (open) setTab('general')
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex w-full max-w-2xl flex-col rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-accent-amber" />
            <span className="text-[14px] font-semibold text-foreground">Configuración</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-5 pt-2">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[12px] font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-panel-raised text-foreground border-b-2 border-accent-amber'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel-raised/50'
                }`}
              >
                {t.id === 'ia' ? (
                  <JasWaveLogo className="size-4" alt="" />
                ) : (
                  <Icon className="size-3.5" />
                )}
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div className="overflow-y-auto px-5 py-4" style={{ maxHeight: '60vh' }}>
          {tab === 'general' && <GeneralTab />}
          {tab === 'audio' && <AudioTab />}
          {tab === 'ia' && <AiTab />}
          {tab === 'rutas' && <RutasTab />}
          {tab === 'atajos' && <AtajosTab />}
          {tab === 'comandos' && <ComandosTab />}
          {tab === 'permisos' && <PermisosTab />}
        </div>
      </div>
    </div>
  )
}
