import type { ComponentType } from 'react'

export type DockZone = 'left' | 'center' | 'right' | 'bottom'

/**
 * Herramientas del núcleo del DAW. Los módulos instalables (asistente IA, partitura…) añaden las suyas en
 * tiempo de ejecución con `registrarHerramienta`, así que un ToolId puede ser cualquier cadena.
 */
export type HerramientaNucleo =
  | 'arrange'
  | 'mixer'
  | 'library'
  | 'track-detail'
  | 'meters'
  | 'routing'
  | 'instruments'
  | 'fx-chain'
  | 'automation'
  | 'plugin-editor'
  | 'midi-map'
  | 'midi-zones'
  | 'piano-roll'
  | 'terminal'
  | 'settings'
  | 'project-files'
  | 'cuenta'
  | 'admin'
  | 'modulos'

export type ToolId = HerramientaNucleo | (string & {})

export interface ToolDefinitionUI {
  id: ToolId
  title: string
  description: string
  defaultZone: DockZone
  /** Si true, solo puede haber una instancia dockeada o undocked */
  singleton: boolean
  /** No se coloca sola en el layout: solo aparece cuando se pide (p. ej. el panel admin). */
  bajoDemanda?: boolean
  /** Icono de la pestaña (lo aportan los módulos). */
  icono?: ComponentType<{ className?: string }>
  /** Módulo que aporta la herramienta (undefined = núcleo). */
  moduloId?: string
  /** Al colocarse por primera vez queda como pestaña activa de su zona. */
  destacada?: boolean
  /** Tamaño mínimo (px) con el que el panel se ve y se usa bien; por debajo aparece scroll en vez de deformarse. */
  minW?: number
  minH?: number
}

/**
 * Tamaño mínimo utilizable por herramienta. Si la zona donde está acoplada se hace más pequeña, el panel
 * conserva este tamaño y se desplaza (scroll) en vez de aplastar controles, faders o teclados.
 */
const TAMANO_MINIMO: Record<string, { w: number; h: number }> = {
  arrange: { w: 420, h: 220 },
  // Barra (36) + tira mínima estrecha (nombre, M/S y volumen fijo de 160 px): por debajo, scroll, nunca deformar.
  mixer: { w: 160, h: 320 },
  'piano-roll': { w: 380, h: 240 },
  library: { w: 220, h: 200 },
  'track-detail': { w: 250, h: 260 },
  meters: { w: 270, h: 340 },
  routing: { w: 240, h: 180 },
  instruments: { w: 240, h: 240 },
  'fx-chain': { w: 250, h: 240 },
  automation: { w: 320, h: 170 },
  'plugin-editor': { w: 420, h: 300 },
  'midi-map': { w: 280, h: 200 },
  'midi-zones': { w: 420, h: 260 },
  terminal: { w: 260, h: 140 },
  settings: { w: 300, h: 260 },
  'project-files': { w: 200, h: 160 },
  cuenta: { w: 260, h: 240 },
  admin: { w: 320, h: 260 },
  modulos: { w: 280, h: 240 },
}
const TAMANO_MINIMO_DEFECTO = { w: 240, h: 160 }

/** Tamaño mínimo de una herramienta (núcleo o módulo; los módulos pueden declarar minW/minH). */
export function tamanoMinimoHerramienta(id: ToolId): { w: number; h: number } {
  const def = (TOOL_CATALOG as Record<string, ToolDefinitionUI | undefined>)[id]
  const base = TAMANO_MINIMO[id] ?? TAMANO_MINIMO_DEFECTO
  return { w: def?.minW ?? base.w, h: def?.minH ?? base.h }
}

/** Herramientas disponibles: las del núcleo + las de los módulos activos (mutable en tiempo de ejecución). */
export const TOOL_CATALOG: Record<ToolId, ToolDefinitionUI> = {
  arrange: {
    id: 'arrange',
    title: 'Arrange',
    description: 'Línea de tiempo',
    defaultZone: 'center',
    singleton: true,
  },
  mixer: {
    id: 'mixer',
    title: 'Mixer',
    description: 'Consola de mezcla',
    defaultZone: 'bottom',
    singleton: true,
  },
  library: {
    id: 'library',
    title: 'Biblioteca',
    description: 'Audio y samples',
    defaultZone: 'left',
    singleton: true,
  },
  'track-detail': {
    id: 'track-detail',
    title: 'Inspector',
    description: 'Propiedades de pista, canal y clip',
    defaultZone: 'right',
    singleton: true,
  },
  meters: {
    id: 'meters',
    title: 'Medidores',
    description: 'Espectro, estéreo, LUFS y sync de timing',
    defaultZone: 'right',
    singleton: true,
  },
  routing: {
    id: 'routing',
    title: 'Ruteo',
    description: 'Buses y envíos',
    defaultZone: 'right',
    singleton: true,
  },
  instruments: {
    id: 'instruments',
    title: 'Instrumentos',
    description: 'Catálogo de plugins · acoplable / otra pantalla',
    defaultZone: 'left',
    singleton: true,
  },
  'fx-chain': {
    id: 'fx-chain',
    title: 'FX Chain',
    description: 'Cadena de plugins de la pista activa',
    defaultZone: 'right',
    singleton: true,
  },
  automation: {
    id: 'automation',
    title: 'Automatización',
    description: 'Curvas vol/pan y write-on-play de la pista activa',
    defaultZone: 'right',
    singleton: true,
  },
  'plugin-editor': {
    id: 'plugin-editor',
    title: 'Editor de plugin',
    description: 'IU del instrumento / efecto activo',
    defaultZone: 'right',
    singleton: true,
  },
  'midi-map': {
    id: 'midi-map',
    title: 'MIDI Learn',
    description: 'Asigna nota, CC o tecla a una función del DAW',
    defaultZone: 'right',
    singleton: true,
  },
  'midi-zones': {
    id: 'midi-zones',
    title: 'Zonas MIDI',
    description: 'Splits, capas y transposición del teclado para tocar en directo',
    defaultZone: 'bottom',
    singleton: true,
  },
  'piano-roll': {
    id: 'piano-roll',
    title: 'Piano roll',
    description: 'Editor MIDI de notas',
    defaultZone: 'bottom',
    singleton: true,
  },
  terminal: {
    id: 'terminal',
    title: 'Terminal',
    description: 'CLI del DAW y log de lo que ejecuta la IA',
    defaultZone: 'bottom',
    singleton: true,
  },
  settings: {
    id: 'settings',
    title: 'Configuración',
    description: 'Ajustes del DAW',
    defaultZone: 'right',
    singleton: true,
  },
  'project-files': {
    id: 'project-files',
    title: 'Archivos',
    description: 'Explorador del proyecto por carpetas estilo IDE con vista contextual',
    defaultZone: 'left',
    singleton: true,
  },
  cuenta: {
    id: 'cuenta',
    title: 'Cuenta',
    description: 'Sesión, licencia de este equipo para los plugins JasWave y colaboración',
    defaultZone: 'right',
    singleton: true,
  },
  admin: {
    id: 'admin',
    title: 'Administración',
    description: 'Abre JasWave Admin, la app de administración aparte del DAW (solo administradores)',
    defaultZone: 'center',
    singleton: true,
    bajoDemanda: true,
  },
  modulos: {
    id: 'modulos',
    title: 'Módulos',
    description: 'Activa, desactiva y descarga módulos opcionales del DAW (asistente IA, partitura…)',
    defaultZone: 'right',
    singleton: true,
    bajoDemanda: true,
  },
}

export type WorkspaceLayout = {
  zones: Record<DockZone, ToolId[]>
  activeTab: Record<DockZone, ToolId | null>
  undocked: ToolId[]
  zoneVisible: Record<DockZone, boolean>
  /** Herramientas cerradas (no aparecen como tabs hasta reabrirlas). */
  closed: ToolId[]
}

export const DEFAULT_WORKSPACE: WorkspaceLayout = {
  zones: {
    left: ['project-files', 'instruments'],
    center: ['arrange'],
    right: ['track-detail', 'plugin-editor', 'settings'],
    bottom: ['mixer', 'piano-roll'],
  },
  activeTab: {
    left: 'project-files',
    center: 'arrange',
    right: 'track-detail',
    bottom: 'mixer',
  },
  undocked: [],
  zoneVisible: {
    left: true,
    center: true,
    right: true,
    bottom: true,
  },
  closed: [
    'library',
    'fx-chain',
    'automation',
    'midi-map',
    'midi-zones',
    'meters',
    'routing',
    'terminal',
  ],
}

const STORAGE_KEY = 'jaswave.workspace.v1'

/** Garantiza catálogo coherente: closed no se reinyecta; el resto se coloca. */
function ensureCatalogTools(layout: WorkspaceLayout): WorkspaceLayout {
  const closed = [...(layout.closed ?? [])]
  const closedSet = new Set(closed)
  const next: WorkspaceLayout = {
    ...layout,
    zones: {
      left: [...layout.zones.left],
      center: [...layout.zones.center],
      right: [...layout.zones.right],
      bottom: [...layout.zones.bottom],
    },
    undocked: [...layout.undocked],
    activeTab: { ...layout.activeTab },
    zoneVisible: { ...layout.zoneVisible },
    closed,
  }
  // Quitar de zonas/undocked lo que esté cerrado. Las de módulos aún no cargados se conservan: aparecen al
  // registrarse el módulo (toolsInZone solo devuelve las del catálogo).
  for (const zone of ['left', 'center', 'right', 'bottom'] as DockZone[]) {
    next.zones[zone] = next.zones[zone].filter((id) => !closedSet.has(id))
  }
  next.undocked = next.undocked.filter((id) => !closedSet.has(id))

  for (const id of Object.keys(TOOL_CATALOG) as ToolId[]) {
    if (closedSet.has(id) || TOOL_CATALOG[id].bajoDemanda) continue
    if (
      next.zones.left.includes(id) ||
      next.zones.center.includes(id) ||
      next.zones.right.includes(id) ||
      next.zones.bottom.includes(id) ||
      next.undocked.includes(id)
    ) {
      continue
    }
    // No estaba colocado ni cerrado → zona por defecto (herramientas nuevas)
    const zone = TOOL_CATALOG[id].defaultZone
    next.zones[zone] = [...next.zones[zone], id]
    if (TOOL_CATALOG[id].destacada) next.activeTab[zone] = id
  }

  for (const zone of ['left', 'center', 'right', 'bottom'] as DockZone[]) {
    const active = next.activeTab[zone]
    if (active && !next.zones[zone].includes(active)) {
      next.activeTab[zone] = next.zones[zone][0] ?? null
    }
  }
  return next
}

/** Recoloca herramientas tras registrar o quitar las de un módulo. */
export function reconciliarLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return ensureCatalogTools(layout)
}

export const EVENTO_HERRAMIENTAS = 'jaswave-herramientas-cambiadas'

function avisarHerramientas(): void {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_HERRAMIENTAS))
}

/** Añade una herramienta de un módulo al catálogo (no puede reemplazar una del núcleo ni de otro módulo). */
export function registrarHerramienta(def: ToolDefinitionUI & { moduloId: string }): void {
  const previa = TOOL_CATALOG[def.id]
  if (previa && previa.moduloId !== def.moduloId) {
    throw new Error(`la herramienta ${def.id} ya existe${previa.moduloId ? ` (módulo ${previa.moduloId})` : ' en el núcleo'}`)
  }
  TOOL_CATALOG[def.id] = def
  avisarHerramientas()
}

/** Quita las herramientas de un módulo (al desactivarlo o desinstalarlo). */
export function quitarHerramientasDeModulo(moduloId: string): void {
  let cambio = false
  for (const [id, def] of Object.entries(TOOL_CATALOG)) {
    if (def.moduloId === moduloId) {
      delete TOOL_CATALOG[id]
      cambio = true
    }
  }
  if (cambio) avisarHerramientas()
}

export function loadWorkspace(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULT_WORKSPACE)
    const parsed = JSON.parse(raw) as WorkspaceLayout
    return ensureCatalogTools({
      ...DEFAULT_WORKSPACE,
      ...parsed,
      zones: { ...DEFAULT_WORKSPACE.zones, ...parsed.zones },
      activeTab: { ...DEFAULT_WORKSPACE.activeTab, ...parsed.activeTab },
      zoneVisible: { ...DEFAULT_WORKSPACE.zoneVisible, ...parsed.zoneVisible },
      undocked: parsed.undocked ?? [],
      closed: parsed.closed ?? [],
    })
  } catch {
    return structuredClone(DEFAULT_WORKSPACE)
  }
}

export function saveWorkspace(layout: WorkspaceLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    /* ignore */
  }
}

/** Abre (activa / mueve) una herramienta en el workspace principal. */
export function requestOpenTool(toolId: ToolId, options?: { zone?: DockZone }): void {
  window.dispatchEvent(
    new CustomEvent('jaswave-open-tool', {
      detail: { toolId, zone: options?.zone },
    }),
  )
}

/** Alterna mostrar/ocultar una herramienta (tab). */
export function requestToggleTool(toolId: ToolId): void {
  window.dispatchEvent(
    new CustomEvent('jaswave-toggle-tool', {
      detail: { toolId },
    }),
  )
}
