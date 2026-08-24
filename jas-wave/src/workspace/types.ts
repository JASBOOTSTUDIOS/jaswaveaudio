export type DockZone = 'left' | 'center' | 'right' | 'bottom'

export type ToolId =
  | 'coproducer'
  | 'docs'
  | 'docs-explorer'
  | 'arrange'
  | 'mixer'
  | 'library'
  | 'track-detail'
  | 'meters'
  | 'routing'
  | 'instruments'
  | 'fx-chain'
  | 'plugin-editor'
  | 'midi-map'
  | 'piano-roll'
  | 'settings'

export interface ToolDefinitionUI {
  id: ToolId
  title: string
  description: string
  defaultZone: DockZone
  /** Si true, solo puede haber una instancia dockeada o undocked */
  singleton: boolean
}

export const TOOL_CATALOG: Record<ToolId, ToolDefinitionUI> = {
  coproducer: {
    id: 'coproducer',
    title: 'Asistente Jas',
    description: 'Asistente JasWave',
    defaultZone: 'left',
    singleton: true,
  },
  docs: {
    id: 'docs',
    title: 'Docs',
    description: 'Tabs de edición y vista de Markdown del proyecto',
    defaultZone: 'left',
    singleton: true,
  },
  'docs-explorer': {
    id: 'docs-explorer',
    title: 'Explorador',
    description: 'Árbol de docs/ del proyecto (plan.md y contextos)',
    defaultZone: 'left',
    singleton: true,
  },
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
  'piano-roll': {
    id: 'piano-roll',
    title: 'Piano roll',
    description: 'Editor MIDI de notas',
    defaultZone: 'bottom',
    singleton: true,
  },
  settings: {
    id: 'settings',
    title: 'Configuración',
    description: 'Proyecto, audio, IA, rutas y permisos',
    defaultZone: 'right',
    singleton: true,
  },
}

export type WorkspaceLayout = {
  zones: Record<DockZone, ToolId[]>
  activeTab: Record<DockZone, ToolId | null>
  undocked: ToolId[]
  zoneVisible: Record<DockZone, boolean>
}

export const DEFAULT_WORKSPACE: WorkspaceLayout = {
  zones: {
    left: ['coproducer', 'docs-explorer', 'docs', 'library', 'instruments'],
    center: ['arrange'],
    right: ['track-detail', 'fx-chain', 'plugin-editor', 'midi-map', 'meters', 'routing', 'settings'],
    bottom: ['mixer', 'piano-roll'],
  },
  activeTab: {
    left: 'coproducer',
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
}

const STORAGE_KEY = 'jaswave.workspace.v1'

/** Garantiza que todas las herramientas del catálogo estén en alguna zona. */
function ensureCatalogTools(layout: WorkspaceLayout): WorkspaceLayout {
  const placed = new Set<ToolId>([
    ...layout.zones.left,
    ...layout.zones.center,
    ...layout.zones.right,
    ...layout.zones.bottom,
    ...layout.undocked,
  ])
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
  }
  for (const id of Object.keys(TOOL_CATALOG) as ToolId[]) {
    if (placed.has(id)) continue
    const zone = TOOL_CATALOG[id].defaultZone
    next.zones[zone] = [...next.zones[zone], id]
  }
  // Filtrar ids obsoletos que ya no están en el catálogo
  for (const zone of ['left', 'center', 'right', 'bottom'] as DockZone[]) {
    next.zones[zone] = next.zones[zone].filter((id) => id in TOOL_CATALOG)
    const active = next.activeTab[zone]
    if (active && !(active in TOOL_CATALOG)) {
      next.activeTab[zone] = next.zones[zone][0] ?? null
    }
  }
  next.undocked = next.undocked.filter((id) => id in TOOL_CATALOG)
  return next
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
