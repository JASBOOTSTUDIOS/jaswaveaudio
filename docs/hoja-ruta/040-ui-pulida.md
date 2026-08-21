# UI Pulida

## Objetivo
Implementar la UI pulida del DAW: themes, layouts guardados, atajos de teclado configurables y detalles de UX que hacen la interfaz productiva y agradable.

## Criterios de Aceptación
- [ ] Themes, layouts guardados, atajos de teclado configurables
- [ ] La UI es productiva y agradable
- [ ] Accesibilidad completa
- [ ] Performance fluido

## Requerimientos Detallados

### 1. Themes
- Soportar temas claros y oscuros.
- `Theme`:
  - `id: string`
  - `name: string`
  - `type: 'light' | 'dark'`
  - `colors`: background, foreground, accent, border, panel, panelHeader, trackColors[].
  - `fonts`: mono, sans.
- Themes se pueden extender mediante plugins de tema.
- El usuario puede crear temas personalizados.
- Los temas se guardan en configuración del usuario.

### 2. Layouts Guardados
- El usuario puede guardar layouts de paneles:
  - Posición y tamaño de cada panel.
  - Paneles abiertos/cerrados.
  - Tab activa por panel.
- `PanelLayout`:
  - `panels: PanelInstance[]`
  - `splitters: Splitter[]`
- Layouts se guardan por proyecto y globalmente.
- El usuario puede cambiar entre layouts guardados.

### 3. Atajos de Teclado Configurables
- Todos los comandos tienen key bindings configurables.
- `KeyBinding`:
  - `key: string`
  - `modifiers: KeyModifier[]`
  - `command: string`
  - `context: string` — 'timeline', 'mixer', 'global'.
- UI para editar key bindings:
  - Buscar comando.
  - Presionar tecla para asignar.
  - Detectar conflictos.
- Export/import key bindings.

### 4. Status Bar
- Mostrar información contextual:
  - BPM, compás.
  - Posición del playhead.
  - Estado de transporte.
  - Estado de grabación.
  - Nivel de CPU.
  - Estado del proveedor de IA.
  - Mensajes de error/advertencia.

### 5. Tooltips y Ayuda
- Tooltips contextuales en botones y controles.
- Modo ayuda: presionar `?` para ver descripciones.
- Accesos rápidos visibles en tooltips.

### 6. Accesibilidad
- Navegación completa por teclado.
- Lectores de pantalla compatibles (ARIA labels).
- Contraste de color suficiente (WCAG AA).
- Tamaño de fuente ajustable.
- Focus indicators visibles.

### 7. Performance
- Virtualización para listas largas (tracks, clips, eventos).
- Canvas para waveforms y espectros.
- Web Workers para cálculos pesados.
- `requestAnimationFrame` para animaciones.
- Memoización de componentes costosos.
- Lazy loading de paneles.

### 8. Animaciones
- Transiciones suaves al abrir/cerrar paneles.
- Animación de playhead.
- Feedback visual en botones.
- Sin animaciones que distraigan durante grabación.

### 9. Tipografía
- Fuente monoespaciada para valores numéricos y tiempo: `JetBrains Mono`, `Fira Code`.
- Fuente sans-serif para UI: `Inter`, `Segoe UI`.
- Tamaños de fuente consistentes.

### 10. Tests
- Test: tema se aplica correctamente
- Test: layout se guarda y restaura
- Test: key binding se puede cambiar
- Test: conflictos de key bindings se detectan
- Test: tooltips muestran información correcta
- Test: navegación por teclado funciona
- Test: contraste cumple WCAG AA
- Test: performance con 100 tracks es fluido

## Dependencias
- State Model
- Event Bus
- Command System

## Documentación Relacionada
- `docs/interfaz/ARQUITECTURA-UI.md`
- `docs/arquitectura/VISION-GENERAL.md`
