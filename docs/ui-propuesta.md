# Propuesta de UI — JasWave DAW

> Documento de diseño de interfaz y experiencia de usuario.  
> Versión: 0.1.0  
> Estado: Propuesta base para implementación.

---

## 1. Filosofía de Diseño

### 1.1 Principios
- **Jerarquía clara**: el DAW es una herramienta de trabajo profesional; la información crítica (transporte, tiempo, estado de grabación) siempre debe ser visible sin competencia visual.
- **Bajo ruido, alto contraste**: fondo oscuro por defecto, acentos de color solo para estados activos, selección y alertas.
- **Contexto sobre navegación**: las herramientas aparecen cerca del elemento objetivo (pista, clip, canal) en vez de relegarse a menús globales.
- **Progressive disclosure**: los paneles avanzados (IA, automatización, mezcla) están a un clic de distancia, pero no ocupan espacio en el flujo básico.
- **Responsive first**: el layout se adapta de escritorio a tablet y móvil sin perder funcionalidad nuclear.

### 1.2 Lenguaje visual
- Radio de bordes: `4px` controles pequeños, `8px` paneles, `12px` modales.
- Tipografía: sistema nativo. Tamaños base: `12px` UI compacta, `13px` cuerpo, `14px` títulos.
- Espaciado: unidad base `4px`. Márgenes estándar `12px` / `16px`.
- Paleta:
  - `bg-primary`: fondo general.
  - `bg-secondary`: paneles.
  - `bg-tertiary`: inputs y zonas interactivas.
  - `border`: bordes sutiles.
  - `accent`: azul JasWave (#3b82f6).
  - `danger`: rojo (#ef4444).
  - `success`: verde (#22c55e).
  - `warning`: naranja (#f59e0b).

---

## 2. Layout Base: Sistema de Paneles

### 2.1 Estructura general

```
+-----+-------------------+-------------------+-----------+
| A   |      B            |        C          |     D     |
| c   |                   |                   |           |
| t   |                   |                   |           |
| i   |                   |                   |           |
| v   |                   |                   |           |
| i   |                   |                   |           |
| t   |                   |                   |           |
| y   |                   |                   |           |
+-----+-------------------+-------------------+-----------+
|                        E                                  |
+-----------------------------------------------------------+
```

| Zona | Panel | Colapsable | Móvil |
|------|-------|------------|-------|
| **A** | Activity Bar | Sí | Oculta |
| **B** | Barra Lateral | Sí | Drawer inferior |
| **C** | Área Central / Editor | No | Fullscreen |
| **D** | Panel Derecho | Sí | Drawer inferior / ausente |
| **E** | Panel Inferior | Sí | Sheet inferior |

### 2.2 Comportamiento de divisores
- Todos los divisores son arrastrables con snap a `4px`.
- Doble clic en divisor colapsa/expande panel al ancho/alto por defecto.
- Los tamaños se persisten en `localStorage` por proyecto.
- En pantallas pequeñas, divisores se deshabilitan y los paneles usan overlays/drawers.

---

## 3. Responsividad y Breakpoints

| Breakpoint | Ancho | Layout |
|------------|-------|--------|
| `xs` | `< 640px` | Móvil. Sin activity bar. Lateral y derecho como drawers. Inferior como sheet. |
| `sm` | `640px - 1023px` | Tablet vertical. Activity bar compacta. Lateral drawer. |
| `md` | `1024px - 1279px` | Tablet horizontal. Activity bar normal. Lateral visible por defecto. |
| `lg` | `1280px - 1535px` | Desktop. Todos los paneles visibles. |
| `xl` | `≥ 1536px` | Desktop ancho. Paneles con padding ampliado y columnas opcionales. |

### 3.1 Reglas generales responsive
- **Prioridad al canvas**: en pantallas pequeñas, el área DAW siempre es visible.
- **Un panel auxiliar a la vez**: en `xs`, solo un panel lateral/derecho puede estar abierto; el inferior compite con el lateral.
- **Toolbars adaptativas**: botones con icono+tooltip en `xs`, icono+texto en `sm+`.
- **Menús**: en `xs` los menús son fullscreen dialogs; en `md+` son dropdowns/menubar.
- **Atajos de teclado**: se mantienen en todas las vistas; los touch gestures emulan shortcuts más usados (ej: swipe horizontal = undo/redo).
- **Atajos configurables**: ningún atajo es hardcodeado; todos se definen en un catálogo central y el usuario puede reasignarlos.

---

## 4. Sistema de Atajos Configurables

### 4.1 Arquitectura

El sistema de atajos vive en el dominio (`shared/src/config/atajos.ts`) y se expone al Command System:

- **Catálogo de acciones**: lista de `AccionAtajo` con `id`, `descripcion`, `categoria` y `comandoPorDefecto`.
- **Estado en DAWState**: `atajos.mapa` (combinación actual → acción) y `atajos.porDefecto` (fallback de fábrica).
- **Comandos**: `atajo.listar`, `atajo.actualizar`, `atajo.restaurar`, `atajo.restaurarUno`.
- **Hook UI**: `useAtajos()` escucha `keydown`, normaliza la combinación, busca en el mapa y despacha el comando correspondiente.
- **Reglas**: no se permiten duplicados; la combinación vacía se rechaza; los inputs conservan sus shortcuts nativos (cortar/copiar/pegar) cuando el foco está en un campo de texto.

### 4.2 Categorías de acciones

| Categoría | Ejemplos |
|-----------|----------|
| `global` | Paleta de comandos, buscar, terminal, chat |
| `proyecto` | Nuevo, abrir, guardar, guardar como, cerrar |
| `transporte` | Play, stop, loop, metrónomo, grabar |
| `edicion` | Deshacer, rehacer, cortar, copiar, pegar, duplicar, eliminar, seleccionar todo |
| `daw` | Pista nueva, eliminar pista, eliminar clip, dividir clip |
| `ventana` | Zoom, alternar paneles, pantalla completa |

### 4.3 Catálogo por defecto (editable)

| Acción | Default | Categoría |
|--------|---------|-----------|
| `proyecto.nuevo` | `Ctrl+Shift+N` | proyecto |
| `proyecto.abrir` | `Ctrl+O` | proyecto |
| `proyecto.guardar` | `Ctrl+S` | proyecto |
| `proyecto.guardarComo` | `Ctrl+Shift+S` | proyecto |
| `proyecto.cerrar` | `Ctrl+W` | proyecto |
| `transporte.reproducir` | `Space` | transporte |
| `transporte.detener` | `Ctrl+Space` | transporte |
| `transporte.inicio` | `Home` | transporte |
| `transporte.fin` | `End` | transporte |
| `transporte.loop` | `L` | transporte |
| `transporte.metronomo` | `K` | transporte |
| `transporte.grabar` | `Ctrl+Shift+R` | transporte |
| `edicion.deshacer` | `Ctrl+Z` | edicion |
| `edicion.rehacer` | `Ctrl+Shift+Z` | edicion |
| `edicion.cortar` | `Ctrl+X` | edicion |
| `edicion.copiar` | `Ctrl+C` | edicion |
| `edicion.pegar` | `Ctrl+V` | edicion |
| `edicion.duplicar` | `Ctrl+D` | edicion |
| `edicion.eliminar` | `Delete` | edicion |
| `edicion.seleccionarTodo` | `Ctrl+A` | edicion |
| `pista.nueva` | `Ctrl+Shift+T` | daw |
| `pista.eliminarSeleccionada` | `Ctrl+Delete` | daw |
| `clip.eliminar` | `Alt+Delete` | daw |
| `clip.dividir` | `Ctrl+Shift+X` | daw |
| `vista.zoomIn` | `Ctrl+=` | ventana |
| `vista.zoomOut` | `Ctrl+-` | ventana |
| `vista.zoomSeleccion` | `Ctrl+Alt+Z` | ventana |
| `vista.zoomTodo` | `Ctrl+Shift+Z` | ventana |
| `ventana.paletaComandos` | `Ctrl+Shift+P` | global |
| `ventana.buscar` | `Ctrl+F` | global |
| `ventana.terminal` | `Ctrl+`` | global |
| `ventana.chat` | `Ctrl+4` | global |
| `ventana.barraLateral` | `Ctrl+B` | ventana |
| `ventana.panelInferior` | `Ctrl+J` | ventana |
| `ventana.panelDerecho` | `Ctrl+Shift+J` | ventana |
| `ventana.pantallaCompleta` | `F11` | ventana |

### 4.4 Flujo de reasignación

1. Usuario abre Configuración → Teclado.
2. Ve lista de acciones agrupadas por categoría.
3. Click en "Reasignar" junto a una acción.
4. Sistema espera la próxima combinación (`keydown`).
5. Valida duplicados y conflictos con sistema operativo.
6. Ejecuta `atajo.actualizar` y persiste en `DAWState.atajos.mapa`.
7. Hook `useAtajos` reacciona al cambio automáticamente (suscripción a estado).

### 4.5 Persistencia

- Los atajos personalizados se guardan dentro del `.jaswave` (campo `ui.atajosPersonalizados`).
- También se guardan en `localStorage` como fallback para la sesión sin proyecto.
- Al cargar un proyecto, se fusionan: defaults del sistema + overrides del proyecto.

### 4.6 Accesibilidad

- Los atajos se muestran siempre junto a la acción en menús y tooltips.
- En móvil, los atajos se presentan como acciones táctiles en un panel de "accesos rápidos".
- Configuración alternativa para usuarios que no pueden usar teclado completo.

### 4.7 Botones y acciones unificadas

- **Cada botón, icono o control de la UI se asocia a una `AccionAtajo` por `id`**.
- El mismo `accionId` sirve para:
  - Teclado (`useAtajos` resuelve `accionId → comando` y despacha).
  - Botones (`onClick={() => ejecutarAccion('pista.nueva')}`).
  - Menús (`onClick={() => ejecutarAccion('proyecto.guardar')}`).
  - Voice/gestos futuros (el `accionId` es la abstracción estable).
- Los tooltips y etiquetas muestran la combinación activa (ej: `Ctrl+Shift+T`) o el texto `(sin asignar)` si está vacío.
- Los botones no tienen lógica propia; solo ejecutan `ejecutarAccion(accionId)`.

**Ejemplo de mapeo UI → acción:**

| Control UI | `accionId` |
|------------|-----------|
| Botón "Nueva pista" | `pista.nueva` |
| Botón "Eliminar pista" | `pista.eliminarSeleccionada` |
| Botón "Mute" (header pista) | `pista.mute` |
| Botón "Solo" (header pista) | `pista.solo` |
| Botón "Armar" (header pista) | `pista.armar` |
| Botón "Play" (transporte) | `transporte.reproducir` |
| Botón "Stop" | `transporte.detener` |
| Botón "Loop" | `transporte.loop` |
| Botón "Metrónomo" | `transporte.metronomo` |
| Botón "Grabar" | `transporte.grabar` |
| Botón "Dividir clip" | `clip.dividir` |
| Botón "Importar audio" | `ui.importarAudio` |
| Menú → Archivo → Guardar | `proyecto.guardar` |
| Activity Bar → Chat | `ventana.chat` |

> Regla: **si un botón hace algo, ese algo tiene un `accionId` y, por tanto, un atajo asignable**.

---

## 4. Activity Bar (Zona A)

**Ancho**: `48px` (compacto) / `56px` (expandido hover).  
**Posición**: fija a la izquierda.  
**Visible**: `sm+`. En `xs` se convierte en bottom nav o floating action button.

### 4.1 Iconos y navegación

| Icono | Sección | Tooltip | Atajo |
|-------|---------|---------|-------|
| `Files` | Explorador | Explorador de archivos | `ventana.explorador` |
| `Search` | Buscar | Buscar pistas, clips, marcadores | `ventana.buscar` |
| `DAW` | Espacio DAW | Ir al espacio de trabajo | `ventana.daw` |
| `Chat` | Asistente IA | Chat con IA | `ventana.chat` |
| `Mixer` | Mezcla | Consola de mezcla | `ventana.mezcla` |
| `Automation` | Automatización | Líneas de automatización | `ventana.automatizacion` |
| `Media` | Medios | Biblioteca de audio | `ventana.media` |
| `Settings` | Configuración | Ajustes del proyecto | `ventana.configuracion` |

### 4.2 Estados
- **Activo**: fondo accent, icono blanco.
- **Hover**: fondo sutil.
- **Indicador**: badge numérico en Chat si hay mensajes nuevos.

### 4.3 Variante móvil (`xs`)
- Bottom navigation bar con 4 iconos: DAW, Chat, Media, Settings.
- Floating action button para crear pista/clip.

---

## 5. Barra Lateral (Zona B)

**Ancho por defecto**: `260px`.  
**Mínimo**: `180px`.  
**Máximo**: `400px`.  
**Colapsable**: Sí.

### 5.1 Vistas

#### 5.1.1 Explorador de Archivos
Jerarquía de carpetas y archivos del proyecto.

```
📁 proyecto/
  📁 audio/
    🎵 voz.wav
    🎵 guitarra.wav
  📁 media/
    🖼️ caratula.png
  📁 presets/
  📄 proyecto.jaswave
```

**Acciones**:
- `Doble clic` en audio: insertar en pista actual.
- `Right clic`:
  - Abrir en editor
  - Insertar en nueva pista
  - Eliminar
  - Renombrar
  - Propiedades
- `Drag & drop` sobre pista: insertar en posición.
- `Arrastrar` fuera: copiar/mover a otra carpeta.

**Atajos**:
- `Ctrl+N`: nueva carpeta
- `F2`: renombrar
- `Delete`: eliminar

#### 5.1.2 Buscar
Filtro global con resultados agrupados.

**Inputs**:
- Texto libre (nombre de pista, clip, marcador).
- Filtros por tipo: pista, clip, plugin, automatización.

**Resultados**:
```
🔍 "voz"
  📁 Pista 1
    🎵 voz.wav (0:00 - 0:30)
  🏷️ Marcador "Intro" (compás 1)
```

**Atajos**:
- `Ctrl+F`: foco en búsqueda.
- `Esc`: limpiar búsqueda.

#### 5.1.3 Control de Origen
Selección de dispositivo de entrada/salida, latencia y buffer.

```
Input: [Micrófono (Realtek)          ▼]
Output: [Monitores (Focusrite)       ▼]
Buffer: [256                       ▼]
Latencia: 5.8ms
Sample Rate: 44100 Hz / 24-bit
[Test de audio]
```

#### 5.1.4 Extensiones
Lista de plugins instalados, activos/desactivados, con tienda integrada.

### 5.2 Variantes responsive
- `xs` / `sm`: drawer desde la izquierda con overlay. Se cierra al seleccionar.
- `md+`: panel permanente.

---

## 6. Área Central / Editor (Zona C)

**Ancho**: flexible (`flex-1`).  
**Alto**: flexible.  
**Scroll**: independiente por pestaña.

### 6.1 Sistema de Pestañas

```
+-----------------------------------------------------------+
| [ DAW * ] [ Chat * ] [ Configuración ]       [ - ] [ × ] |
+-----------------------------------------------------------+
```

- `*`: cambios no guardados.
- Arrastrar para reordenar.
- `Ctrl+Tab`: siguiente pestaña.
- `Ctrl+Shift+Tab`: anterior.
- `Ctrl+W`: cerrar pestaña actual.

### 6.2 Vista DAW (principal)

#### 6.2.1 Timeline / Arrange View
```
+-----------------------------------------------------------+
| Toolbar pistas                                           |
+--------+--------------------------------------------------+
| Header | Timeline                                          |
| Pista  | [clip1][  clip2  ][clip3]                        |
| 1      | ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ |
| 2      |          ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                        |
| 3      |                                                |
+--------+--------------------------------------------------+
| Transport / Snap / Loop / Markers                        |
+-----------------------------------------------------------+
```

**Header de pista** (columna fija):
- Nombre editable.
- Iconos: `M` (mute), `S` (solo), `R` (armar grabación).
- Volumen (fader vertical en `lg+`, horizontal en `sm`).
- Panorámica (knob en `lg+`, dropdown en `sm`).
- Color de pista (click para cambiar).
- Menú contextual (3 puntos) con: duplicar, eliminar, exportar pista, color, etiquetas.

**Timeline**:
- Regla de tiempo (compases, beats, ticks).
- Playhead (línea roja vertical).
- Snap toggle + selector (beat, bar, 1/4, off).
- Zoom horizontal: `Ctrl + scroll`.
- Scroll horizontal: `Shift + scroll` o arrastre con medio clic.
- Clips arrastrables; snap al grid si activo.
- Selección múltiple con `Shift+clic` o `Ctrl+clic`.
- `Ctrl+A`: seleccionar todo en pista.
- `Ctrl+C/V/X`: copiar/pegar/cortar clips.
- `Delete`: eliminar selección.
- `Ctrl+D`: duplicar selección.
- `Alt+arrastrar`: duplicar mientras arrastras.

#### 6.2.2 Modos de vista
- **Arrange** (por defecto): timeline horizontal.
- **Mix**: canales verticales con faders y inserts.
- **Edit**: editor de waveforms con zoom vertical.
- **Notation**: partitura (si aplica).

Cambio con tabs o `Ctrl+Tab` circular.

### 6.3 Vista Chat (IA)

```
+-----------------------------------------------------------+
| Asistente IA                                             |
+-----------------------------------------------------------+
|                                                           |
|  👤 Usuario                                               |
|  Crea una pista de bajo en A menor                        |
|                                                           |
|  🤖 JasWave                                               |
|  He creado la pista "Bajo" con un instrumento MIDI...    |
|                                                           |
+-----------------------------------------------------------+
| [ Escribe tu instrucción...                    ] [Enviar] |
+-----------------------------------------------------------+
```

**Acciones**:
- `Enter`: enviar.
- `Shift+Enter`: salto de línea.
- `/`: comandos rápidos (ej: `/bounce`, `/metronome`, `/tempo 120`).
- Contexto automático: incluye nombre de pista seleccionada, BPM, compás.

### 6.4 Vista Configuración

Secciones tipo acordeón:
- General (idioma, tema, auto-guardado).
- Audio (dispositivos, buffer, sample rate).
- Teclado (keybindings editables).
- IA (modelo, endpoint, temperatura).
- Almacenamiento (rutas, formato de guardado).

### 6.5 Variantes responsive
- `xs` / `sm`: pestañas se convierten en tabs inferiores o menú hamburguesa + navegación por gestos swipe.
- `md+`: tabs horizontales.

---

## 7. MenuBar (Barra Superior)

Solo visible en `md+`. En `xs` se convierte en `...` overflow menu.

```
+-----------------------------------------------------------+
| Archivo  Edición  Ver  Proyecto  Transporte  Ayuda         |
+-----------------------------------------------------------+
```

### 7.1 Archivo

```
Archivo
├── Nuevo Proyecto              `proyecto.nuevo`
├── Abrir Proyecto...           `proyecto.abrir`
├── Guardar                     `proyecto.guardar`
├── Guardar Como...             `proyecto.guardarComo`
├── ─────────────────────────
├── Importar Audio...
├── Importar MIDI...
├── Exportar Audio...
├── Exportar Mezcla...
├── ─────────────────────────
├── Recent Files
│   ├── proyecto1.jaswave
│   ├── proyecto2.jaswave
│   └── Abrir carpeta
├── ─────────────────────────
├── Cerrar Proyecto            `proyecto.cerrar`
└── Salir
```

**Flujo**:
1. `Nuevo Proyecto`: limpia estado, muestra diálogo de nombre opcional.
2. `Abrir`: file picker `.jaswave`. Carga y reemplaza estado actual.
3. `Guardar`: si no hay ruta, flujo a `Guardar Como`. Emite `proyecto.guardado`.
4. `Guardar Como`: file picker siempre.
5. `Cerrar`: si `proyecto.modificado`, diálogo de confirmación:
   ```
   ¿Guardar cambios antes de cerrar?
   [ Guardar ] [ Descartar ] [ Cancelar ]
   ```
6. `Salir`: igual que cerrar, pero cierra aplicación.

### 7.2 Edición

```
Edición
├── Deshacer                    `edicion.deshacer`
├── Rehacer                     `edicion.rehacer`
├── ─────────────────────────
├── Cortar                      `edicion.cortar`
├── Copiar                      `edicion.copiar`
├── Pegar                       `edicion.pegar`
├── Duplicar                    `edicion.duplicar`
├── Eliminar                    `edicion.eliminar`
├── Seleccionar Todo            `edicion.seleccionarTodo`
├── ─────────────────────────
├── Mute Pista Seleccionada
├── Solo Pista Seleccionada
├── Armar Pista Seleccionada
└── Preferencias...
```

### 7.3 Ver

```
Ver
├── Zoom In                     `vista.zoomIn`
├── Zoom Out                    `vista.zoomOut`
├── Zoom a Selección            `vista.zoomSeleccion`
├── Zoom Todo                   `vista.zoomTodo`
├── ─────────────────────────
├── Barra Lateral               `ventana.barraLateral`
├── Panel Inferior              `ventana.panelInferior`
├── Panel Derecho               `ventana.panelDerecho`
├── Activity Bar                `ventana.activityBar`
├── ─────────────────────────
├── Modo Pantalla Completa      `ventana.pantallaCompleta`
├── Compacto
└── Mostrar Regla
```

### 7.4 Proyecto

```
Proyecto
├── Metadatos...
├── Configuración...
├── ─────────────────────────
├── BPM                         Doble clic en BPM global
│   └── Ajustar BPM...
├── Compás                      Doble clic en time signature
│   └── Ajustar Compás...
├── ─────────────────────────
├── Marcadores
│   ├── Agregar Marcador
│   ├── Ir a Marcador...
│   └── Eliminar Todos
└── Modo Loop
```

### 7.5 Transporte

```
Transporte
├── Reproducir / Pausar         `transporte.reproducir`
├── Detener                     `transporte.detener`
├── Ir a Inicio                 `transporte.inicio`
├── Ir a Fin                    `transporte.fin`
├── Loop                        `transporte.loop`
├── Metrónomo                   `transporte.metronomo`
├── Grabación                   `transporte.grabar`
└── Entrada MIDI
```

### 7.6 Ayuda

```
Ayuda
├── Documentación
├── Atajos de Teclado
├── Notas de la Versión
├── ─────────────────────────
└── Acerca de JasWave
```

---

## 8. Barra de Estado (Zona inferior global)

Siempre visible en todas las vistas excepto modales fullscreen.

```
+-----------------------------------------------------------------+
| [ DAW ]  [120 BPM]  [4/4]  [44.1kHz / 24bit]  [CPU 12%] [●]   |
+-----------------------------------------------------------------+
```

**Izquierda**: contexto actual (vista activa, proyecto nombre).  
**Centro**: transporte (play/pausa/detener), BPM editable, compás editable, sample rate / bit depth.  
**Derecha**: rendimiento (CPU, RAM, disco), estado de conexión, modelo IA.

**Atajos**:
- `Ctrl+T`: editar BPM inline.
- Doble clic en compás: cambiar compás.
- Clic en CPU: abrir monitor de rendimiento.

---

## 9. Panel Inferior (Zona E)

**Alto por defecto**: `240px`.  
**Mínimo**: `120px`.  
**Máximo**: `50%` de pantalla.  
**Vistas** (tabs):

### 9.1 Terminal / Consola
```
> [Entrada de comando o filtro]
-----------------------------------------------------------
[info] Proyecto cargado: Demo.jaswave (44.1kHz)
[warn] Clip "voz" tiene clipping en pista 1
[error] No se pudo cargar preset de compresor
-----------------------------------------------------------
[Filtrar: todos | info | warn | error | ia | audio]
```

**Acciones**:
- `Ctrl+``: foco en terminal.
- `Clear`: limpiar consola.
- Click en línea: filtrar por categoría.

### 9.2 Chat / IA
Misma vista que la pestaña Chat, pero integrada en panel inferior para flujo de trabajo sin cambiar de contexto.

### 9.3 Problemas
Lista de advertencias y errores del proyecto.

```
⚠ clip-overlap   Clip "A" se superpone con "B" en pista 2 (compás 5)
⚠ peak-level     Pista 3 alcanza -0.1 dBFS
✖ missing-ref    Archivo "solo.wav" no encontrado
```

- Click: navega al elemento afectado.
- `Esc`: cerrar panel inferior.

### 9.4 Salida
Logs técnicos del motor de audio y eventos del sistema.

### 9.5 Variante móvil
- `xs` / `sm`: se presenta como **sheet** inferior deslizable.
- Handle para arrastrar y cambiar alto.
- Botón flotante para abrir/cerrar rápido.

---

## 10. Panel Derecho (Zona D)

**Ancho por defecto**: `280px`.  
**Mínimo**: `220px`.  
**Máximo**: `400px`.

### 10.1 Vistas

#### 10.1.1 Propiedades (cuando hay selección)
Contextual al elemento seleccionado.

**Pista seleccionada**:
```
+-------------------+
| Pista 1            |
| Tipo: Audio        |
| Color: [■] #3b82f6 |
|                   |
| Volumen  [=====]  |
| Panorámica  [O]   |
|                   |
| [EQ] [Comp] [Rev] |
+-------------------+
```

**Clip seleccionado**:
```
+-------------------+
| voz.wav            |
| Inicio: 0:00      |
| Duración: 0:30    |
| Ganancia: +0.0 dB |
| Fade In: 0.00s    |
| Fade Out: 0.00s   |
| Color: [■]        |
+-------------------+
```

#### 10.1.2 Navegador
Vista de árbol de carpetas, marcadores, escenas.

#### 10.1.3 Historial
Lista de acciones recientes con undo/redo rápido.

### 10.2 Variante móvil
- `xs` / `sm`: drawer desde la derecha con overlay. Se cierra al perder foco.

---

## 11. Flujo de Trabajo Ejemplo

### 11.1 Nuevo proyecto desde cero
1. `Ctrl+Shift+N` o `Archivo → Nuevo Proyecto`.
2. Se muestra `project.new` con nombre opcional.
3. `project.created` → UI actualiza título, habilita paneles.
4. Se activa vista DAW vacía.

### 11.2 Guardar proyecto
1. `Ctrl+S`.
2. Si no hay ruta: dialog nativo `Guardar Como`.
3. `project.save` serializa y escribe `.jaswave`.
4. Validación post-escritura por tamaño.
5. `proyecto.guardado` → UI marca tab como guardado, actualiza barra de título.

### 11.3 Cerrar proyecto con cambios
1. `Ctrl+W` o `Archivo → Cerrar`.
2. `project.close` detecta `modificado: true`.
3. Devuelve `requiereConfirmacion: true`.
4. UI muestra modal:
   ```
   El proyecto tiene cambios sin guardar.
   [ Guardar ] [ Descartar ] [ Cancelar ]
   ```
5. Si Guardar: flujo `project.save` → luego cerrar.
6. Si Descartar: cerrar directo.
7. `proyecto.cerrado` → UI limpia estado.

### 11.4 Importar audio
1. `Ctrl+I` o drag & drop en timeline.
2. Si no hay pista: se crea pista de audio automáticamente.
3. Se crea `AudioReference` con ruta relativa en `media/`.
4. Clip se inserta en compás 1 de la pista.
5. `proyecto.modificado = true`.

---

## 12. Especificación de Componentes

### 12.1 Mapa de componentes React

```
Electron/src/
├── componentes/
│   ├── DAWProvider.tsx
│   ├── MenuBar.tsx
│   ├── BarraActividades.tsx
│   ├── BarraLateral.tsx
│   ├── PanelDerecho.tsx
│   ├── PanelInferior.tsx
│   ├── AreaEditor.tsx
│   ├── EspacioTrabajoDaw.tsx
│   ├── MenuArchivo.tsx          ← Nuevo
│   ├── DialogoConfirmacion.tsx  ← Nuevo
│   ├── PropertiesPanel.tsx      ← Nuevo
│   └── ...
├── ganchos/
│   ├── useMotorAudio.ts
│   ├── useLayout.ts
│   ├── usePestanas.ts
│   └── useDAW.ts
└── utilidades/
    ├── tipos.ts
    ├── file-service-electron.ts
    └── atajos.ts
```

### 12.2 Hook de atajos
Implementar un hook global `useAtajos` que escuche `keydown` en `window` y despache comandos por atajo.

```ts
type Atajo = {
  id: string;
  teclas: string[];
  descripcion: string;
  categoria: 'global' | 'daw' | 'edicion' | 'transporte';
  accion: () => void;
};
```

Catálogo en `shared/src/config/atajos.ts` (o local en Electron).

### 12.3 Servicio de archivos nativo
`FileServiceElectron` (creado) implementa la interfaz `FileService` para usar `window.electronAPI.fs`.

---

## 13. Accesibilidad

- Todos los controles focuseables con `Tab`.
- `aria-label` en icon-only buttons.
- `role` semántico en paneles (`navigation`, `main`, `complementary`).
- Contraste mínimo `4.5:1` en texto UI.
- Focus visible con outline accent.

---

## 14. Siguientes Pasos

1. Implementar `MenuArchivo` y submenús con atajos reales.
2. Implementar `DialogoConfirmacion` genérico (reutilizable para cierre, sobrescritura, etc.).
3. Migrar `Aplicacion.tsx` a consumo exclusivo de `useDAW` (eliminar `pistas`, `rutaProyecto` locales duplicados).
4. Implementar `PropertiesPanel` contextual.
5. Crear sistema de temas (claro/oscuro) sobre CSS variables.
6. Pruebas de layout en breakpoints reales (Chrome DevTools + dispositivos físicos).
