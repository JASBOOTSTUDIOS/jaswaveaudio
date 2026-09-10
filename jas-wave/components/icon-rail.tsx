import {
  FileText,
  Library,
  Piano,
  Gauge,
  GitBranch,
  Settings,
  SlidersHorizontal,
  LayoutTemplate,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Radio,
  FolderOpen,
  Music2,
  Terminal,
  Activity,
  FileCode2,
  Sparkles,
  Wand2,
  Cable,
  ListTree,
  type LucideIcon,
} from 'lucide-react'
import type { DockZone, ToolId } from '@/src/workspace/types'
import { JasWaveAppIcon, JasWaveLogo } from '@/components/brand'

const ITEMS: { id: ToolId; icon?: LucideIcon; label: string; brand?: 'logo' }[] = [
  { id: 'coproducer', brand: 'logo', label: 'Asistente Jas' },
  { id: 'docs-explorer', icon: FolderOpen, label: 'Explorador' },
  { id: 'docs', icon: FileText, label: 'Docs' },
  { id: 'library', icon: Library, label: 'Biblioteca' },
  { id: 'instruments', icon: Sparkles, label: 'Instrumentos' },
  { id: 'fx-chain', icon: Wand2, label: 'FX Chain' },
  { id: 'automation', icon: Activity, label: 'Automatización' },
  { id: 'plugin-editor', icon: Cable, label: 'Editor de plugin' },
  { id: 'midi-map', icon: Radio, label: 'MIDI Learn' },
  { id: 'arrange', icon: LayoutTemplate, label: 'Arrange' },
  { id: 'mixer', icon: SlidersHorizontal, label: 'Mixer' },
  { id: 'terminal', icon: Terminal, label: 'Terminal' },
  { id: 'piano-roll', icon: Piano, label: 'Piano roll' },
  { id: 'midi-md', icon: FileCode2, label: 'MIDI · MD' },
  { id: 'score-editor', icon: Music2, label: 'Partitura' },
  { id: 'meters', icon: Gauge, label: 'Medidores' },
  { id: 'routing', icon: GitBranch, label: 'Enrutamiento' },
  { id: 'track-detail', icon: ListTree, label: 'Inspector' },
  { id: 'settings', icon: Settings, label: 'Configuración' },
]

export function IconRail({
  activeTool,
  undockedTools = [],
  onToolSelect,
  onToggleZone,
  zoneVisible,
}: {
  activeTool: ToolId | null
  undockedTools?: ToolId[]
  onToolSelect: (id: ToolId) => void
  onToggleZone: (zone: DockZone) => void
  zoneVisible: Record<DockZone, boolean>
}) {
  return (
    <nav
      className="flex w-14 flex-col items-center gap-1 bg-rail py-1.5"
      aria-label="Herramientas del workspace"
    >
      <div className="mb-1 flex size-12 items-center justify-center overflow-hidden rounded-md">
        <JasWaveAppIcon className="size-12" />
      </div>

      {ITEMS.map(({ id, icon: Icon, label, brand }) => {
        const isActive = activeTool === id
        const floating = undockedTools.includes(id)
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToolSelect(id)}
            title={floating ? `${label} (clic para acoplar de nuevo)` : label}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex size-10 items-center justify-center rounded-md transition-colors ${
              isActive
                ? 'bg-panel-raised text-foreground'
                : floating
                  ? 'text-accent-amber hover:bg-panel-raised/60'
                  : 'text-muted-foreground hover:bg-panel-raised/60 hover:text-foreground'
            }`}
          >
            {brand === 'logo' ? (
              <JasWaveLogo className="size-8" alt={label} />
            ) : Icon ? (
              <Icon className="size-[18px]" strokeWidth={1.75} />
            ) : null}
            {floating && (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent-amber" />
            )}
          </button>
        )
      })}

      <div className="mt-auto flex flex-col gap-1 border-t border-border/50 pt-2">
        <button type="button" title="Panel izquierdo" onClick={() => onToggleZone('left')} className={`flex size-8 items-center justify-center rounded ${zoneVisible.left ? 'text-accent-amber' : 'text-muted-foreground'}`}>
          <PanelLeft className="size-4" />
        </button>
        <button type="button" title="Panel derecho" onClick={() => onToggleZone('right')} className={`flex size-8 items-center justify-center rounded ${zoneVisible.right ? 'text-accent-amber' : 'text-muted-foreground'}`}>
          <PanelRight className="size-4" />
        </button>
        <button type="button" title="Panel inferior" onClick={() => onToggleZone('bottom')} className={`flex size-8 items-center justify-center rounded ${zoneVisible.bottom ? 'text-accent-amber' : 'text-muted-foreground'}`}>
          <PanelBottom className="size-4" />
        </button>
      </div>
    </nav>
  )
}
