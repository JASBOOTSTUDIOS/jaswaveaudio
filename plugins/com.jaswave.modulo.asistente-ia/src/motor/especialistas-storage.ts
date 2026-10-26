export type RolAgente = 'planificador' | 'director' | 'musico' | 'mezcla' | 'mastering' | 'qa' | string

export type EspecialistaConfig = {
  id: string
  nombre: string
  role: RolAgente
  instrumento?: string
  skills: string[]
  descripcion?: string
  instruccionesPersonalizadas?: string
  temperatura?: number
  maxIterPorPaso?: number
  activo: boolean
  esCustom?: boolean
  color?: string
}

const STORAGE_KEY = 'jaswave-especialistas-custom-v2'

export const ESPECIALISTAS_POR_DEFECTO: EspecialistaConfig[] = [
  {
    id: 'planificador',
    nombre: 'Planificador Musical',
    role: 'planificador',
    skills: ['estructura', 'tempo', 'tonalidad', 'desglose-pistas', 'armonia'],
    descripcion: 'Diseña la estructura de la canción, define tonalidad, BPM, secciones y las pistas necesarias.',
    instruccionesPersonalizadas: 'Analiza la solicitud y desglosa el tema en partes claras (intro, verso, coro) asignando el trabajo a cada músico.',
    temperatura: 0.2,
    maxIterPorPaso: 15,
    activo: true,
    color: '#8b5cf6',
  },
  {
    id: 'director',
    nombre: 'Director de Banda',
    role: 'director',
    skills: ['coordinacion', 'asignacion-tareas', 'secuenciacion-flujo', 'comunicacion-qa'],
    descripcion: 'Asigna tareas a los músicos (en paralelo o serial), recibe los clips y los envía a validar con QA.',
    instruccionesPersonalizadas: 'Coordina los músicos de la banda. Cuando un músico entrega su pista, consúltala con el auditor QA antes de darla por buena.',
    temperatura: 0.2,
    maxIterPorPaso: 20,
    activo: true,
    color: '#f59e0b',
  },
  {
    id: 'pianista',
    nombre: 'Pianista / Teclista',
    role: 'musico',
    instrumento: 'Piano / Keys',
    skills: ['acordes', 'voicings', 'melodias', 'vst-piano', 'piano-roll'],
    descripcion: 'Compone progresiones armónicas de piano, arpegios y melodías expresivas, cargando el VST de piano adecuado.',
    instruccionesPersonalizadas: 'Crea progresiones de acordes ricos con dinámicas humanas en la pista de piano. Si QA indica discordancias, corrige las notas.',
    temperatura: 0.35,
    maxIterPorPaso: 25,
    activo: true,
    color: '#3b82f6',
  },
  {
    id: 'baterista',
    nombre: 'Baterista / Percusión',
    role: 'musico',
    instrumento: 'Drums',
    skills: ['groove', 'ritmo', 'kick-snare-hihat', 'fills', 'vst-drums', 'voice-to-drums'],
    descripcion: 'Crea el ritmo principal, grooves, cajas, bombos, hi-hats y redobles de batería alineados a la rejilla.',
    instruccionesPersonalizadas: 'Genera patrones de batería sólidos con acentos en 2 y 4, variaciones en los cortes y sincronización perfecta con el tempo.',
    temperatura: 0.3,
    maxIterPorPaso: 25,
    activo: true,
    color: '#ef4444',
  },
  {
    id: 'bajista',
    nombre: 'Bajista',
    role: 'musico',
    instrumento: 'Bajo',
    skills: ['lineas-de-bajo', 'notas-raiz', 'sincronia-kick', 'vst-bass'],
    descripcion: 'Compone la línea de bajo asegurando el anclaje armónico con las notas raíz y el ritmo del bombo.',
    instruccionesPersonalizadas: 'Alinea los golpes de bajo con el bombo de la batería para crear un low-end potente y sin notas disonantes.',
    temperatura: 0.3,
    maxIterPorPaso: 20,
    activo: true,
    color: '#10b981',
  },
  {
    id: 'sintetizador',
    nombre: 'Diseñador de Sintes / Leads',
    role: 'musico',
    instrumento: 'Synthesizer',
    skills: ['leads', 'pads', 'arpegios', 'sound-design', 'vst-synth'],
    descripcion: 'Crea texturas atmosféricas, pads envolventes, hooks melódicos y sintetizadores modernos.',
    instruccionesPersonalizadas: 'Diseña el espacio tímbrico con pads y leads que complementen la melodía sin saturar el espectro medio.',
    temperatura: 0.4,
    maxIterPorPaso: 20,
    activo: true,
    color: '#ec4899',
  },
  {
    id: 'qa',
    nombre: 'QA / Auditor de Calidad Musical',
    role: 'qa',
    skills: ['audioLens', 'diagnose', 'deteccion-clipping', 'revision-armonica', 'loudness'],
    descripcion: 'Audita cada clip, pista y mezcla usando herramientas de diagnóstico. Aprueba o solicita correcciones.',
    instruccionesPersonalizadas: 'Evalúa estrictamente la afinación, ritmo, rango dinámico y ausencia de clipping. Si hay defectos, explica exactamente qué corregir.',
    temperatura: 0.1,
    maxIterPorPaso: 12,
    activo: true,
    color: '#14b8a6',
  },
  {
    id: 'mezcla',
    nombre: 'Ingeniero de Mezcla',
    role: 'mezcla',
    skills: ['gain-staging', 'eq-correctiva', 'compresion', 'paneo', 'espacio-reverb', 'vst-fx'],
    descripcion: 'Equilibra los niveles de todas las pistas, limpia frecuencias con EQ e inserta plugins VST de FX.',
    instruccionesPersonalizadas: 'Ajusta volúmenes relativos, paneo estéreo, inserta ecualizadores y compresores VST en las pistas para cohesión musical.',
    temperatura: 0.25,
    maxIterPorPaso: 25,
    activo: true,
    color: '#6366f1',
  },
  {
    id: 'mastering',
    nombre: 'Ingeniero de Mastering',
    role: 'mastering',
    skills: ['master-bus', 'balance-espectral', 'limitador', 'lufs-bs1770', 'true-peak'],
    descripcion: 'Aplica el procesamiento final al bus Master, optimiza la pegada, brillo y volumen comercial sin distorsión.',
    instruccionesPersonalizadas: 'Controla el techo de picos a -0.5 dBFS, ajusta el limitador master para alcanzar el LUFS objetivo (-14 LUFS para streaming).',
    temperatura: 0.2,
    maxIterPorPaso: 15,
    activo: true,
    color: '#e11d48',
  },
]

export function cargarEspecialistas(): EspecialistaConfig[] {
  if (typeof window === 'undefined' || !window.localStorage) return ESPECIALISTAS_POR_DEFECTO
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // Migración desde v1 si existía
      const old = window.localStorage.getItem('jaswave-especialistas-custom-v1')
      if (old) {
        try {
          const parsedOld = JSON.parse(old)
          if (Array.isArray(parsedOld)) {
            const mezclados = ESPECIALISTAS_POR_DEFECTO.map((def) => {
              const prev = parsedOld.find((o) => o.id === def.id)
              return prev ? { ...def, ...prev, skills: def.skills } : def
            })
            guardarEspecialistas(mezclados)
            return mezclados
          }
        } catch {
          /* ignore */
        }
      }
      return ESPECIALISTAS_POR_DEFECTO
    }
    const p = JSON.parse(raw)
    return Array.isArray(p) && p.length > 0 ? p : ESPECIALISTAS_POR_DEFECTO
  } catch {
    return ESPECIALISTAS_POR_DEFECTO
  }
}

export function guardarEspecialistas(lista: EspecialistaConfig[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lista))
      window.dispatchEvent(new CustomEvent('jaswave-especialistas-changed'))
    } catch {
      // Ignorar error de cuota
    }
  }
}

export function agregarNuevoEspecialista(nuevo: Omit<EspecialistaConfig, 'id'>): EspecialistaConfig {
  const lista = cargarEspecialistas()
  const id = `agente-custom-${Date.now()}`
  const creado: EspecialistaConfig = {
    ...nuevo,
    id,
    esCustom: true,
    activo: true,
    skills: nuevo.skills ?? [],
  }
  const actualizada = [...lista, creado]
  guardarEspecialistas(actualizada)
  return creado
}

export function eliminarEspecialista(id: string): void {
  const lista = cargarEspecialistas()
  const filtrada = lista.filter((e) => e.id !== id)
  guardarEspecialistas(filtrada)
}
