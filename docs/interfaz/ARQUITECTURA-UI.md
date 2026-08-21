# Arquitectura de la UI

## 1. Filosofía

Inspirado en Visual Studio Code y REAPER, pero NO copiando visualmente sus interfaces. Tomamos únicamente conceptos de UX:

- Paneles acoplables (docking)
- Barra de actividad lateral
- Paleta de comandos
- Barra de estado
- Sistema de tabs
- Vistas especializadas (Timeline, Mixer, Inspector)

## 2. Layout Principal

```
┌──────────────────────────────────────────────────┐
│  Menu Bar / Title Bar                             │
├──────┬───────────────────────────────────────────-─┤
│      │  Toolbar                                    │
│ Act  ├─────────────────────────────────────────────┤
│ ivity│                                            │
│  Bar │  Main Content Area                         │
│      │  (Panel Layout)                             │
│      │                                            │
├──────┴─────────────────────────────────────────────┤
│  Status Bar                                       │
└──────────────────────────────────────────────────┘
```

### Activity Bar
Iconos verticales a la izquierda para cambiar entre vistas principales:
- Explorador de proyecto
- Timeline
- Mixer
- Inspector
- Navegador de plugins
- Chat IA

### Paneles
Los paneles son acoplables y redimensionables:

```typescript
interface PanelDefinition {
  id: string;
  title: string;
  icon?: string;
  component: React.ComponentType;
  defaultPosition?: 'left' | 'right' | 'bottom' | 'center';
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  closable?: boolean;
  resizable?: boolean;
}
```

### Tabs
Cada panel puede tener múltiples tabs:

```typescript
interface Tab {
  id: string;
  title: string;
  icon?: string;
  closable: boolean;
  dirty?: boolean;
}
```

## 3. Vistas Principales

### Timeline
La vista principal de edición:
- Clips visuales (forma de onda para audio, piano roll para MIDI)
- Playhead
- Reglas de tiempo
- Marcadores y regiones
- Snapping
- Zoom y scroll

### Mixer
Vista de mezcla:
- Canales verticales
- Faders de volumen
- Panorámicos
- Botones de mute/solo/arm
- Envíos (sends)
- Inserts (FX chains)
- Master fader

### Inspector
Panel de propiedades del elemento seleccionado:
- Propiedades de track
- Propiedades de clip
- Parámetros de plugin
- Automatización

### Navegador de Proyecto
Árbol del proyecto:
- Tracks
- Buses
- Clips
- Plugins
- Marcadores
- Regiones

### Chat IA
Panel de interacción con la IA:
- Historial de conversación
- Entrada de texto
- Visualización de tool calls
- Botones de confirmación
- Indicador de estado del modelo

## 4. Command Palette

Accesible con `Ctrl+Shift+P` (Windows/Linux) o `Cmd+Shift+P` (macOS):

```typescript
interface CommandPalette {
  open(): void;
  close(): void;
  filter(query: string): CommandMatch[];
  execute(command: string): void;
}

interface CommandMatch {
  command: string;
  title: string;
  category: string;
  shortcut?: string;
}
```

## 5. State de UI

El estado de la UI se almacena separado del estado del proyecto:

```typescript
interface UIState {
  layout: PanelLayout;
  activePanel: string | null;
  scrollPositions: Record<string, Point>;
  zoomLevel: number;
  playheadPosition: TimePosition | null;
  selectedItems: SelectedItems;
  theme: string;
  commandPaletteOpen: boolean;
}

interface PanelLayout {
  panels: PanelInstance[];
  splitters: Splitter[];
}

interface PanelInstance {
  panelId: string;
  position: 'left' | 'right' | 'bottom' | 'center';
  size: number;
  tabs: Tab[];
  activeTabId: string;
}
```

## 6. Temas

Soporte para temas claros y oscuros:

```typescript
interface Theme {
  id: string;
  name: string;
  type: 'light' | 'dark';
  colors: {
    background: string;
    foreground: string;
    accent: string;
    border: string;
    panel: string;
    panelHeader: string;
    trackColors: string[];
  };
  fonts: {
    mono: string;
    sans: string;
  };
}
```

Los temas se pueden extender mediante plugins de tema.

## 7. Accesibilidad

- Navegación completa por teclado
- Lectores de pantalla compatibles (ARIA labels)
- Contraste de color suficiente
- Tamaño de fuente ajustable
- Atajos de teclado configurables

## 8. Performance

- Virtualización para listas largas (tracks, clips, eventos de automatización)
- Canvas para waveforms y espectros (no DOM)
- Web Workers para cálculos pesados (análisis, normalización)
- `requestAnimationFrame` para animaciones
- Memoización de componentes costosos

## 9. Tipografía

Usar una fuente monoespaciada para valores numéricos y tiempo:

```css
.value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
```

Fuente sans-serif para UI general:

```css
.ui {
  font-family: 'Inter', 'Segoe UI', sans-serif;
}
```
