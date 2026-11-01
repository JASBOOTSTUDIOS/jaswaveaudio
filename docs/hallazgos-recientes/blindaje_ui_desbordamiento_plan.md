# Plan Maestro de Blindaje contra Desbordamiento y Diseño Intuitivo (Estilo REAPER MCP)

## Resumen del Acuerdo de Diseño

Tras la sesión interactiva de alineación (/grill-me), se establecieron los siguientes principios arquitectónicos y de experiencia de usuario:

1. **Estructura del Mixer estilo REAPER MCP**:
   - **Base de Faders Fija y Blindada**: Altura métrica rígida constante (160 px) para el recorrido del fader en todas las pistas y en el Master.
   - **Medición Estéreo Paralela (L/R)**: VU meters dobles verticales al lado del fader con gradiente (verde → amarillo → rojo) y escala gráfica de dB (+12 a -60 dB).
   - **Lectura Digital de dB y Peak/Clip Hold**: Display digital estilo hardware con fuente `JetBrains Mono` (`tabular-nums`), lectura precisa de ganancia y badge indicador de clipping clickeable para resetear picos.
   - **Scroll Únicamente en Plugins**: La zona de inserts (FX Bank) y envíos tiene scroll vertical interno independiente (`overflow-y-auto jw-scrollbar`), impidiendo que el agregado de plugins desplace o cambie la altura del fader.
   - **Mini Analizador de Espectro por Canal**: Mini botón con icono de espectro en la cabecera de la tira que despliega un analizador de frecuencias en tiempo real en la parte superior sin alterar la altura fija de la base de volumen.

2. **Blindaje de Espacio Crítico con Banner Proactivo**:
   - Cuando un panel acoplado (Mixer, Inspector, Piano Roll, etc.) se redimensione por debajo de su umbral operativo seguro, se mostrará un **banner superior compacto y elegante** que explica la situación y ofrece soluciones inmediatas:
     - `[Flotar ventana]`: Desacopla la herramienta a una ventana independiente para trabajar con amplitud.
     - `[Ocultar]`: Minimiza el panel para dar prioridad al arreglo.
     - `[Mantener]`: Permite al usuario continuar en el panel compacto si así lo prefiere.
     - Opción *"Recordar preferencia"* para no resultar intrusivo.

3. **Consistencia Métrica Global**:
   - Tipografía mono (`JetBrains Mono`, `tabular-nums`), anchos y alturas de cajas numéricas reservados para evitar saltos o que unos números se vean más grandes que otros.

---

## Diagrama de la Tira de Canal (REAPER MCP)

```
┌──────────────────────────────────────┐
│  Track Name / Color / # / Grip       │  Cabecera fija
│  [M] [S] [REC] [MON]  [Espectro 📊]   │  Botones de estado y toggle de espectro
├──────────────────────────────────────┤
│  [ Mini Analizador de Espectro FFT ] │  (Colapsable bajo demanda)
├──────────────────────────────────────┤
│  [FX INSERTS / SENDS]                │
│  • Reverb                            │  Zona con scroll interno independiente
│  • Delay                             │  (overflow-y-auto)
│  • EQ                                │  (Nunca empuja el fader hacia abajo)
├──────────────────────────────────────┤
│  [Pan Knob (L/R) o Slider Horizontal]│
├──────────────────────────────────────┤
│  ══ ZONA DE VOLUMEN FIJA (160 px) ══ │
│   Scale   VU-L  VU-R   Fader         │  Altura fija e idéntica en todos
│   +12 ──   █     █      ┌───┐        │  los canales y en el Master
│     0 ──   █     █      │ ░ │        │  Alineación matemática de marcas dB
│   -18 ──   █     █      └───┘        │
│   -60 ──   ░     ░       │           │
├──────────────────────────────────────┤
│  [ -3.2 dB ]   [ PK: -0.4 ] (Reset)  │  Display digital mono tabular-nums
└──────────────────────────────────────┘
```

---

## Cambios Propuestos por Componente

### 1. Banner de Blindaje de Espacio en Paneles (`jas-wave/components/workspace/panel-space-guard.tsx`)
#### [NEW] `components/workspace/panel-space-guard.tsx`
- Componente que monitorea el tamaño del viewport de la herramienta mediante `ResizeObserver`.
- Si el espacio cae por debajo del `minW` o `minH` operativo de la herramienta, renderiza un banner sutil en la parte superior:
  ```tsx
  "Espacio reducido para Mixer. ¿Deseas desacoplarlo a una ventana flotante?"
  [ Flotar ] [ Ocultar ] [ Mantener ]
  ```
- Se conecta con `undockTool(toolId)` y `closeTool(toolId)` de `useWorkspace()`.

### 2. Integración en ToolHost (`jas-wave/components/workspace/tool-host.tsx`)
#### [MODIFY] `components/workspace/tool-host.tsx`
- Incorporar `PanelSpaceGuard` en el contenedor de cada herramienta.
- Asegurar que el contenedor use `min-w-[...]` y `min-h-[...]` para proteger los elementos internos contra deformaciones.

### 3. Fader y Medidores Estilo Reaper (`jas-wave/components/ui/controls.tsx`)
#### [MODIFY] `components/ui/controls.tsx`
- **`FaderControl`**:
  - Altura fija por defecto de 160 px (`h-[160px]`).
  - Soporte para VU meter estéreo dual (L/R) con clip indicator.
  - Escala métrica gráfica de dB integrada con marcas visuales legibles.
  - Display digital tabular con formato limpio y soporte para reseteo de pico.
- **`KnobControl`**:
  - Estandarización de badges numéricos (`tabular-nums`, altura y ancho fijos).

### 4. Mixer Consola MCP (`jas-wave/components/mixer.tsx`)
#### [MODIFY] `components/mixer.tsx`
- Estructurar el strip en secciones:
  1. Cabecera con botón de toggle de espectro `Mini Espectro`.
  2. Mini espectro FFT en tiempo real usando los datos del analizador de audio.
  3. Contenedor de FX / Sends con altura flexible y `overflow-y-auto jw-scrollbar`.
  4. Perilla de paneo centrada.
  5. Bloque de volumen fijo (`h-[210px]` contenedor, `h-[160px]` recorrido del fader).
  6. Display numérico digital uniforme en todas las pistas y en el Master.
  7. Ajustar `UMBRALES_MIXER` para que no colapse faders abruptamente.

### 5. Inspector de Pistas (`jas-wave/components/track-detail-panel.tsx`)
#### [MODIFY] `components/track-detail-panel.tsx`
- Envolver el fader de volumen en la pestaña Audio con la misma altura protegida de 160 px para evitar que colapse o varíe.

---

## Plan de Verificación

### Pruebas Automatizadas
```bash
npm run typecheck --workspace=jas-wave
npm run lint --workspace=jas-wave
npm test --workspace=jas-wave
```

### Verificación Manual
1. **Mixer Estilo Reaper**:
   - Abrir http://localhost:5173/ y comprobar los canales del Mixer y el Master.
   - Comprobar que todos los faders miden exactamente 160 px y la marca de 0 dB está en la misma línea horizontal.
   - Probar el botón de mini espectro en la cabecera del canal.
   - Agregar varios plugins a un canal y verificar que solo hace scroll el área de plugins, sin mover el fader.
2. **Banner de Espacio Reducido**:
   - Redimensionar el panel inferior del Mixer hacia abajo hasta un tamaño muy pequeño.
   - Verificar que aparece el banner ofreciendo `[Flotar]`, `[Ocultar]` o `[Mantener]`.
   - Probar que `[Flotar]` abre la herramienta desacoplada y `[Ocultar]` minimiza el panel de forma limpia.
