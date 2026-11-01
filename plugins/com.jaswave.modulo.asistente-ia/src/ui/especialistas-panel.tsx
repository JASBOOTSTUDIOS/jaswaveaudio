import { useState, useEffect } from 'react'
import {
  cargarEspecialistas,
  guardarEspecialistas,
  agregarNuevoEspecialista,
  eliminarEspecialista,
  ESPECIALISTAS_POR_DEFECTO,
  type EspecialistaConfig,
  type RolAgente,
} from '../motor/especialistas-storage'
import type { ProcedimientoHabilidad } from '@jaswave/host-sdk'
import { HabilidadesEjecutables } from './habilidades-ejecutables'
import { GRUPOS_HERRAMIENTAS } from '../motor/turno/catalogo-agente'
import { habilidadesDelEspecialista, plantillaHabilidad } from '../motor/habilidades-agentes'
import { Seccion, Boton, Aviso, EVENTO_CARPETA_ASISTENTE, carpetaAsistente } from '@jaswave/host-sdk'
import type { HabilidadAgente } from '@jaswave/host-sdk'
import {
  BookOpen,
  UserCheck,
  Sparkles,
  Sliders,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  X,
  Tag,
} from 'lucide-react'

const CATALOGO_SKILLS_SUGERIDAS: Record<string, string[]> = {
  'Armonía y teclados': ['acordes', 'voicings', 'arpegios', 'piano-roll', 'vst-piano', 'teoria-armonica'],
  'Ritmo y batería': ['groove', 'kick-snare-hihat', 'fills', 'voice-to-drums', 'vst-drums', 'humanize'],
  'Bajo': ['lineas-de-bajo', 'notas-raiz', 'sincronia-kick', 'vst-bass', 'slap'],
  'Sintetizadores y efectos': ['leads', 'pads', 'sound-design', 'vst-synth', 'filtros-lfo'],
  'Revisión de calidad': ['audioLens', 'diagnose', 'deteccion-clipping', 'revision-armonica', 'loudness'],
  'Mezcla': ['gain-staging', 'eq-correctiva', 'compresion', 'paneo', 'espacio-reverb', 'vst-fx'],
  'Mastering': ['master-bus', 'limitador', 'lufs-bs1770', 'true-peak', 'balance-espectral'],
}

/** Nombre legible de una especialidad (el valor guardado sigue siendo el identificador). */
const NOMBRES_SKILL: Record<string, string> = {
  acordes: 'Acordes',
  'acordes-ritmicos': 'Acordes rítmicos',
  armonia: 'Armonía',
  arpegios: 'Arpegios',
  'asignacion-tareas': 'Reparto de tareas',
  audioLens: 'Análisis de audio',
  'balance-espectral': 'Balance de frecuencias',
  comunicacion: 'Comunicación',
  'comunicacion-qa': 'Coordinación con el revisor',
  compresion: 'Compresión',
  coordinacion: 'Coordinación',
  creatividad: 'Creatividad',
  'desglose-pistas': 'Reparto en pistas',
  diagnose: 'Diagnóstico',
  'deteccion-clipping': 'Detección de saturación',
  'eq-correctiva': 'Ecualización correctiva',
  'espacio-reverb': 'Espacio y reverberación',
  estructura: 'Estructura',
  fills: 'Redobles',
  'filtros-lfo': 'Filtros y modulación',
  'fx-chain-guitarra': 'Efectos de guitarra',
  'gain-staging': 'Niveles de ganancia',
  groove: 'Groove',
  humanize: 'Toque humano',
  interpretacion: 'Interpretación',
  'kick-snare-hihat': 'Bombo, caja y hi-hat',
  leads: 'Melodías principales',
  limitador: 'Limitador',
  'lineas-de-bajo': 'Líneas de bajo',
  loudness: 'Volumen percibido',
  'lufs-bs1770': 'Volumen final (LUFS)',
  'master-bus': 'Canal máster',
  melodias: 'Melodías',
  'notas-raiz': 'Notas raíz',
  pads: 'Colchones (pads)',
  paneo: 'Paneo',
  'piano-roll': 'Edición de notas',
  'revision-armonica': 'Revisión armónica',
  riffs: 'Riffs',
  ritmo: 'Ritmo',
  'secuenciacion-flujo': 'Orden de trabajo',
  'sincronia-kick': 'Sincronía con el bombo',
  slap: 'Slap',
  solos: 'Solos',
  'sound-design': 'Diseño de sonido',
  tempo: 'Tempo',
  'teoria-armonica': 'Teoría armónica',
  tonalidad: 'Tonalidad',
  'true-peak': 'Control de picos',
  'voice-to-drums': 'De voz a batería',
  voicings: 'Disposición de acordes',
  'vst-bass': 'Bajo virtual',
  'vst-drums': 'Batería virtual',
  'vst-fx': 'Efectos',
  'vst-guitar': 'Guitarra virtual',
  'vst-piano': 'Piano virtual',
  'vst-synth': 'Sintetizador virtual',
}

function nombreSkill(skill: string): string {
  const conocido = NOMBRES_SKILL[skill]
  if (conocido) return conocido
  const t = skill
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : skill
}

const NOMBRES_ROL: Record<string, string> = {
  musico: 'Músico',
  planificador: 'Planificador',
  director: 'Director de la banda',
  mezcla: 'Ingeniero de mezcla',
  mastering: 'Ingeniero de mastering',
  qa: 'Revisor de calidad',
}

function SkillSelectorChips({
  currentSkills,
  onChange,
}: {
  currentSkills: string[]
  onChange: (skills: string[]) => void
}) {
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string>('Armonía y teclados')

  const toggleSkill = (skill: string) => {
    if (currentSkills.includes(skill)) {
      onChange(currentSkills.filter((s) => s !== skill))
    } else {
      onChange([...currentSkills, skill])
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-border/70 bg-panel-raised/50 p-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-foreground/80">
          <Tag className="size-3 text-primary" /> Especialidades sugeridas (toca para añadir o quitar):
        </span>
        <select
          value={categoriaSeleccionada}
          onChange={(e) => setCategoriaSeleccionada(e.target.value)}
          className="rounded border border-border bg-panel px-1.5 py-0.5 text-[9px] text-foreground focus:outline-none"
        >
          {Object.keys(CATALOGO_SKILLS_SUGERIDAS).map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        {(CATALOGO_SKILLS_SUGERIDAS[categoriaSeleccionada] || []).map((skill) => {
          const activa = currentSkills.includes(skill)
          return (
            <button
              key={skill}
              type="button"
              onClick={() => toggleSkill(skill)}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] transition-colors ${
                activa
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : 'bg-panel-base/80 text-muted-foreground hover:bg-panel hover:text-foreground border border-border/60'
              }`}
            >
              {activa ? <Check className="size-2.5" /> : <Plus className="size-2.5 opacity-60" />}
              {nombreSkill(skill)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Habilidades del agente (skills): las de serie de su rol e instrumento más las que el usuario le asigna desde
 * la carpeta del asistente (`habilidades/*.md` con «@slug» del agente). El agente ve la lista y lee cada una
 * con `leer_habilidad` solo cuando la tarea lo pide.
 */
function HabilidadesAgente({ esp }: { esp: EspecialistaConfig }) {
  const [habilidades, setHabilidades] = useState<HabilidadAgente[]>(() => habilidadesDelEspecialista(esp))
  const [abierta, setAbierta] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    const recalcular = () => setHabilidades(habilidadesDelEspecialista(esp))
    recalcular()
    window.addEventListener(EVENTO_CARPETA_ASISTENTE, recalcular)
    return () => window.removeEventListener(EVENTO_CARPETA_ASISTENTE, recalcular)
  }, [esp])

  const crear = async () => {
    const plantilla = plantillaHabilidad(esp)
    try {
      if (carpetaAsistente.archivo(plantilla.ruta)) {
        setAviso(`Ya existe ${plantilla.ruta}: edítala en la carpeta del asistente.`)
      } else {
        await carpetaAsistente.escribir(plantilla.ruta, plantilla.contenido)
        setAviso(`Creada ${plantilla.ruta}. Escribe ahí el método y guarda: ${esp.nombre} la tendrá en su próxima intervención.`)
      }
      await carpetaAsistente.abrirEnExplorador()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    }
  }

  const deSerie = habilidades.filter((h) => h.origen !== 'usuario')
  const propias = habilidades.filter((h) => h.origen === 'usuario')

  return (
    <div className="col-span-2 flex flex-col gap-1" data-testid={`habilidades-${esp.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <BookOpen className="size-3 text-sky-400" />
          Habilidades ({deSerie.length} de serie{propias.length ? `, ${propias.length} tuya${propias.length === 1 ? '' : 's'}` : ''}):
        </span>
        <Boton onClick={() => void crear()} title="Crea un archivo Markdown en habilidades/ asignado a este agente y abre la carpeta">
          <Plus className="mr-1 inline size-3 text-emerald-400" />
          Nueva habilidad para este agente
        </Boton>
      </div>
      <ul className="flex flex-col gap-0.5">
        {habilidades.map((h) => {
          const verla = abierta === h.id
          return (
            <li key={h.id} className="rounded border border-border/60 bg-panel-raised/60">
              <button
                type="button"
                className="flex w-full items-start gap-1.5 px-1.5 py-1 text-left text-[10px] hover:bg-panel"
                aria-expanded={verla}
                onClick={() => setAbierta(verla ? null : h.id)}
              >
                <span className={`mt-px shrink-0 rounded px-1 text-[8px] ${h.origen === 'usuario' ? 'bg-amber-500/20 text-amber-300' : 'bg-muted/40 text-muted-foreground'}`}>
                  {h.origen === 'usuario' ? 'tuya' : 'de serie'}
                </span>
                <span className="font-medium text-foreground">{h.nombre}</span>
                <span className="text-muted-foreground">· {h.descripcion}</span>
              </button>
              {verla ? <pre className="whitespace-pre-wrap border-t border-border/60 px-2 py-1.5 font-sans text-[10px] leading-snug text-foreground/90">{h.contenido}</pre> : null}
            </li>
          )
        })}
      </ul>
      <p className="text-[9px] text-muted-foreground">
        Son archivos Markdown de la carpeta del asistente (habilidades/). Para dar una a este agente escribe «@{esp.id}» (o su nombre) en la línea de descripción, o «todos» para toda la banda; si repite el nombre de una de serie, la tuya manda.
      </p>
      {aviso ? <Aviso>{aviso}</Aviso> : null}
    </div>
  )
}

export function EspecialistasPanel() {
  const [especialistas, setEspecialistas] = useState<EspecialistaConfig[]>(() => cargarEspecialistas())
  const [expandido, setExpandido] = useState<string | null>(null)
  const [guardadoId, setGuardadoId] = useState<string | null>(null)
  const [mostrandoCrear, setMostrandoCrear] = useState(false)

  // Estado del nuevo agente
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoRol, setNuevoRol] = useState<RolAgente>('musico')
  const [nuevoInstrumento, setNuevoInstrumento] = useState('')
  const [nuevasSkills, setNuevasSkills] = useState<string[]>([])
  const [nuevaDescripcion, setNuevaDescripcion] = useState('')
  const [nuevasInstrucciones, setNuevasInstrucciones] = useState('')
  const [nuevoColor, setNuevoColor] = useState('#6366f1')
  const [nuevosProcedimientos, setNuevosProcedimientos] = useState<ProcedimientoHabilidad[]>([])

  useEffect(() => {
    const handler = () => {
      setEspecialistas(cargarEspecialistas())
    }
    window.addEventListener('jaswave-especialistas-changed', handler)
    return () => window.removeEventListener('jaswave-especialistas-changed', handler)
  }, [])

  const actualizarEspecialista = (id: string, parche: Partial<EspecialistaConfig>) => {
    const nuevos = especialistas.map((e) => (e.id === id ? { ...e, ...parche } : e))
    setEspecialistas(nuevos)
    guardarEspecialistas(nuevos)
    setGuardadoId(id)
    setTimeout(() => setGuardadoId(null), 1800)
  }

  const handleCrearAgente = () => {
    if (!nuevoNombre.trim()) return

    agregarNuevoEspecialista({
      nombre: nuevoNombre.trim(),
      role: nuevoRol,
      instrumento: nuevoInstrumento.trim() || undefined,
      skills: nuevasSkills.length > 0 ? nuevasSkills : ['creatividad', 'interpretacion'],
      descripcion: nuevaDescripcion.trim() || `Especialista en ${nuevoInstrumento || nuevoNombre}`,
      instruccionesPersonalizadas: nuevasInstrucciones.trim(),
      temperatura: 0.3,
      maxIterPorPaso: 20,
      activo: true,
      color: nuevoColor,
      ...(nuevosProcedimientos.length ? { procedimientos: nuevosProcedimientos } : {}),
    })

    // Reset formulario
    setNuevoNombre('')
    setNuevoInstrumento('')
    setNuevasSkills([])
    setNuevaDescripcion('')
    setNuevasInstrucciones('')
    setNuevosProcedimientos([])
    setMostrandoCrear(false)
  }

  const handleEliminar = (id: string) => {
    if (confirm('¿Eliminar este músico personalizado de la banda?')) {
      eliminarEspecialista(id)
    }
  }

  const restaurarPorDefecto = () => {
    if (confirm('¿Volver a la configuración original de todos los especialistas de la banda?')) {
      const def = ESPECIALISTAS_POR_DEFECTO
      setEspecialistas(def)
      guardarEspecialistas(def)
    }
  }

  return (
    <Seccion
      titulo="Banda de especialistas de la IA"
      acciones={
        <div className="flex items-center gap-1.5">
          <Boton onClick={() => setMostrandoCrear(!mostrandoCrear)}>
            <Plus className="mr-1 inline size-3 text-emerald-400" />
            Nuevo músico
          </Boton>
          <Boton onClick={restaurarPorDefecto} title="Volver a la configuración original">
            <RotateCcw className="mr-1 inline size-3" />
            Restaurar
          </Boton>
        </div>
      }
    >
      <Aviso>
        Personaliza tu banda virtual. Cada músico o ingeniero tiene su papel, sus especialidades, sus
        instrumentos virtuales y tus instrucciones; un revisor de calidad comprueba su trabajo.
      </Aviso>

      {/* Formulario Crear Nuevo Agente */}
      {mostrandoCrear && (
        <div className="mt-3 rounded-lg border border-primary/40 bg-panel-base/90 p-3 shadow-md">
          <div className="flex items-center justify-between pb-2 border-b border-border/60">
            <h4 className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <Plus className="size-3.5" /> Crear un músico nuevo
            </h4>
            <button
              type="button"
              title="Cerrar"
              aria-label="Cerrar"
              onClick={() => setMostrandoCrear(false)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Nombre del músico:</label>
              <input
                type="text"
                placeholder="Ej. Guitarrista Acústico"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                className="w-full rounded border border-border bg-panel-raised px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Papel en la banda:</label>
              <select
                value={nuevoRol}
                onChange={(e) => setNuevoRol(e.target.value as RolAgente)}
                className="w-full rounded border border-border bg-panel-raised px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="musico">Músico intérprete</option>
                <option value="planificador">Planificador</option>
                <option value="director">Director de la banda</option>
                <option value="mezcla">Ingeniero de mezcla</option>
                <option value="mastering">Ingeniero de mastering</option>
                <option value="qa">Revisor de calidad</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-[10px] text-muted-foreground block mb-0.5">Instrumento asignado:</label>
              <input
                type="text"
                placeholder="Ej. Guitarra Acústica, Percusión Latina, Violonchelo..."
                value={nuevoInstrumento}
                onChange={(e) => setNuevoInstrumento(e.target.value)}
                className="w-full rounded border border-border bg-panel-raised px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="col-span-2">
              <label className="text-[10px] text-muted-foreground block mb-0.5">
                Especialidades activas ({nuevasSkills.length}):
              </label>
              <div className="flex flex-wrap gap-1 min-h-[26px] p-1.5 rounded border border-border bg-panel-raised">
                {nuevasSkills.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground italic">
                    Ninguna especialidad elegida todavía. Elígelas en las sugerencias de abajo.
                  </span>
                ) : (
                  nuevasSkills.map((sk) => (
                    <span
                      key={sk}
                      className="inline-flex items-center gap-1 rounded bg-primary/20 px-2 py-0.5 text-[9px] text-primary-foreground border border-primary/40"
                    >
                      {nombreSkill(sk)}
                      <button
                        type="button"
                        title="Quitar"
                        aria-label={`Quitar ${nombreSkill(sk)}`}
                        onClick={() => setNuevasSkills(nuevasSkills.filter((s) => s !== sk))}
                        className="hover:text-red-400"
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* Selector interactivo de chips por categoría */}
              <SkillSelectorChips
                currentSkills={nuevasSkills}
                onChange={setNuevasSkills}
              />
            </div>

            <div className="col-span-2">
              <label className="text-[10px] text-muted-foreground block mb-0.5">Descripción breve:</label>
              <input
                type="text"
                placeholder="Ej. Encargado de añadir ritmo acústico y rasgueos dinámicos en coros"
                value={nuevaDescripcion}
                onChange={(e) => setNuevaDescripcion(e.target.value)}
                className="w-full rounded border border-border bg-panel-raised px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="col-span-2">
              <label className="text-[10px] text-muted-foreground block mb-0.5">Instrucciones y estilo de ejecución:</label>
              <textarea
                rows={2}
                placeholder="Ej. Mantén las notas dentro de la escala del proyecto y sincroniza las figuras con el hi-hat..."
                value={nuevasInstrucciones}
                onChange={(e) => setNuevasInstrucciones(e.target.value)}
                className="w-full rounded border border-border bg-panel-raised p-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="col-span-2">
              <HabilidadesEjecutables procedimientos={nuevosProcedimientos} onChange={setNuevosProcedimientos} />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground">Color de insignia:</label>
              <input
                type="color"
                value={nuevoColor}
                onChange={(e) => setNuevoColor(e.target.value)}
                className="h-6 w-8 rounded border border-border cursor-pointer bg-transparent"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Boton onClick={() => setMostrandoCrear(false)}>Cancelar</Boton>
              <button
                type="button"
                onClick={handleCrearAgente}
                disabled={!nuevoNombre.trim()}
                className="inline-flex items-center justify-center rounded bg-primary px-3 py-1 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-xs"
              >
                <Plus className="size-3 mr-1" /> Guardar músico
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista de Agentes de la Banda */}
      <ul className="flex flex-col gap-2 mt-3">
        {especialistas.map((esp) => {
          const abierto = expandido === esp.id
          return (
            <li
              key={esp.id}
              className="flex flex-col rounded-lg border border-border bg-panel-base/60 p-2 text-[11px] transition-colors"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Activar ${esp.nombre}`}
                  checked={esp.activo}
                  onChange={(e) => actualizarEspecialista(esp.id, { activo: e.target.checked })}
                  className="rounded border-border accent-primary"
                />

                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: esp.color || '#6366f1' }}
                  title="Color de la insignia"
                />

                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <UserCheck className="size-3.5 text-primary" />
                  {esp.nombre}
                </span>

                <span className="text-muted-foreground text-[10px]">
                  ({NOMBRES_ROL[esp.role] ?? nombreSkill(esp.role)}{esp.instrumento ? ` · ${esp.instrumento}` : ''})
                </span>

                {esp.esCustom && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px]">
                    Personalizado
                  </span>
                )}

                <div className="flex-1" />

                {guardadoId === esp.id ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                    <Check className="size-3" /> Guardado
                  </span>
                ) : null}

                {esp.esCustom && (
                  <button
                    onClick={() => handleEliminar(esp.id)}
                    title="Eliminar este músico"
                    className="p-1 rounded text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}

                <Boton
                  aria-label={`Configurar ${esp.nombre}`}
                  onClick={() => setExpandido(abierto ? null : esp.id)}
                >
                  <Sliders className="size-3 mr-1" />
                  {abierto ? 'Ocultar' : 'Editar'}
                  {abierto ? <ChevronUp className="size-3 ml-0.5" /> : <ChevronDown className="size-3 ml-0.5" />}
                </Boton>
              </div>

              {esp.descripcion && !abierto ? (
                <p className="mt-1 text-muted-foreground text-[10px] line-clamp-1 pl-6">
                  {esp.descripcion}
                </p>
              ) : null}

              {/* Tags de skills resumidas */}
              {esp.skills && esp.skills.length > 0 && !abierto ? (
                <div className="mt-1 flex flex-wrap gap-1 pl-6">
                  {esp.skills.map((skill) => (
                    <span
                      key={skill}
                      className="px-1.5 py-0.5 rounded bg-muted/30 text-[9px] text-muted-foreground"
                    >
                      {nombreSkill(skill)}
                    </span>
                  ))}
                </div>
              ) : null}

              {abierto ? (
                <div className="mt-2.5 flex flex-col gap-2 border-t border-border/70 pt-2 pl-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-foreground/80 flex items-center gap-1">
                      <Sparkles className="size-3 text-amber-400" />
                      Instrucciones y directrices para {esp.nombre}:
                    </label>
                    <textarea
                      rows={3}
                      value={esp.instruccionesPersonalizadas || ''}
                      onChange={(e) => actualizarEspecialista(esp.id, { instruccionesPersonalizadas: e.target.value })}
                      placeholder="Ej.: Mantén el ritmo estricto y pide siempre una revisión de calidad antes de terminar la pista..."
                      className="w-full rounded-md border border-border bg-panel-raised p-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1 col-span-2">
                      <label className="text-[10px] text-muted-foreground">Instrumento asignado:</label>
                      <input
                        type="text"
                        value={esp.instrumento || ''}
                        onChange={(e) => actualizarEspecialista(esp.id, { instrumento: e.target.value })}
                        className="rounded border border-border bg-panel-raised px-2 py-0.5 text-[10px]"
                        placeholder="Ej: Piano, Batería, Bajo..."
                      />
                    </div>

                    <div className="flex flex-col gap-1 col-span-2">
                      <label className="text-[10px] text-muted-foreground">
                        Especialidades ({esp.skills?.length ?? 0}):
                      </label>
                      <SkillSelectorChips
                        currentSkills={esp.skills || []}
                        onChange={(nuevas) => actualizarEspecialista(esp.id, { skills: nuevas })}
                      />
                    </div>

                    <fieldset className="col-span-2 flex flex-col gap-1">
                      <legend className="text-[10px] text-muted-foreground">
                        Qué puede cambiar cuando trabaja en paralelo (sin marcar ninguno, puede usarlo todo):
                      </legend>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {GRUPOS_HERRAMIENTAS.map((g) => {
                          const marcados = esp.herramientasPermitidas ?? []
                          return (
                            <label key={g.id} className="flex items-center gap-1 text-[10px] text-foreground">
                              <input
                                type="checkbox"
                                className="accent-primary"
                                checked={marcados.includes(g.id)}
                                onChange={(e) =>
                                  actualizarEspecialista(esp.id, {
                                    herramientasPermitidas: e.target.checked ? [...marcados, g.id] : marcados.filter((x) => x !== g.id),
                                  })
                                }
                              />
                              {g.titulo}
                            </label>
                          )
                        })}
                      </div>
                    </fieldset>

                    <HabilidadesAgente esp={esp} />

                    <div className="col-span-2">
                      <HabilidadesEjecutables
                        procedimientos={esp.procedimientos ?? []}
                        onChange={(procs) => actualizarEspecialista(esp.id, { procedimientos: procs })}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground pt-1">
                    <label className="flex items-center gap-1.5">
                      Creatividad (0 = precisa, 1 = libre):
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={esp.temperatura ?? 0.3}
                        onChange={(e) => actualizarEspecialista(esp.id, { temperatura: Number(e.target.value) })}
                        className="w-14 rounded border border-border bg-panel-raised px-1 py-0.5"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Intentos máximos por paso:
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={esp.maxIterPorPaso ?? 20}
                        onChange={(e) => actualizarEspecialista(esp.id, { maxIterPorPaso: Number(e.target.value) })}
                        className="w-14 rounded border border-border bg-panel-raised px-1 py-0.5"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Color:
                      <input
                        type="color"
                        value={esp.color || '#6366f1'}
                        onChange={(e) => actualizarEspecialista(esp.id, { color: e.target.value })}
                        className="h-5 w-6 rounded border border-border cursor-pointer bg-transparent"
                      />
                    </label>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Seccion>
  )
}
