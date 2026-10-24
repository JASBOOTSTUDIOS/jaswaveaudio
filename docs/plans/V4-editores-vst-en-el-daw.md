# V4 — El mismo editor de VST en el DAW: nativo embebido (escritorio) y réplica web

**Depende de:** V3 (plantilla única y `ui-layout.json`).

## Objetivo

Que un VST de JasWave se vea igual en todas partes:

- **Escritorio:** siempre el editor cyber nativo del plugin (misma instancia que procesa el audio en el
  plugin-host), dentro del panel «Editor de plugin». Se eliminan los paneles web distintos
  (`jaswave-fx-panel.tsx`, `jaswave-roles-panel.tsx`).
- **Web:** una réplica en Canvas del mismo diseño, generada desde `plugins/<id>/ui-layout.json`,
  responsiva (≥1024 px 16:9 · 640–1023 compacto · <640 pestañas) y táctil.

## Escritorio — hecho

### Por qué no es una ventana hija

El plugin-host es otro proceso. Una ventana hija u «owned» de la de Electron hace que ambos procesos
se esperen con `SendMessage` (el host ya documentaba ese bloqueo). Por eso el editor es un **popup sin
borde, sin padre ni owner** que main mantiene superpuesto al panel.

### Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Host | `native/plugin-host/src/vst3_slot.cpp` (`openEditorEmbedded`, `setEmbeddedBounds`, `fitEmbeddedView`) | Popup `WS_POPUP` + `WS_EX_TOOLWINDOW` en píxeles físicos (DPI por monitor solo en ese hilo); ajusta el view al área con su proporción y lo centra; ocultar/mostrar/subir sin activar |
| Host | `native/plugin-host/src/main.cpp` | `openEditor {embedded:true,x,y,w,h}` y `setEditorBounds {embedded:true,visible,raise}` (VST2 sigue flotante) |
| Main | `jas-wave/electron/plugins/editor-embebido.ts` | Panel CSS → DIP (zoom) → físicos (`screen.dipToScreenRect`); sigue `move`, `resize`, `minimize`, `restore`, `focus`, `hide`… de la ventana y reenvía la posición |
| Main | `jas-wave/electron/main.ts` | `plugin-host-send` con `embed` → `EditoresEmbebidos`; nunca pasa `parentHwnd` |
| Renderer | `jas-wave/components/plugin-editor-panel.tsx` | Siempre `VstNativeEditor`: abre embebido con el rectángulo del panel, lo sincroniza (ResizeObserver, IntersectionObserver, visibilidad) y ofrece «En ventana» / «En el panel»; si el embebido falla, abre flotante |
| Editor VST | `plugins/shared-ui/jw_ui_view.cpp` | Ancho mínimo 300 px para caber entero en el panel lateral |

### Verificación

- `jas-wave/electron/plugins/editor-embebido.test.ts` (4 casos: validación, conversión con zoom,
  apertura sin `parentHwnd`, seguimiento de mover/minimizar/frente/cerrar).
- e2e `jas-wave/e2e/17-editor-nativo.spec.ts` (Windows, `JASWAVE_E2E_TARGET=dev`): inserta el EQ en una
  pista, abre el panel y comprueba desde Win32 que el popup coincide con el panel (±3 px físicos), que
  dentro está `JasWaveCyberEditor` en 16:9 y centrado, que se oculta al minimizar y vuelve al
  restaurar, el cambio a ventana y vuelta, y que «Cerrar UI» destruye la ventana. La captura del
  editor se hace con `PrintWindow` sobre esa ventana (nunca de la pantalla).

### Límites conocidos

- Un menú o diálogo del DAW que se abra encima del panel queda debajo del editor nativo (igual que con
  cualquier ventana nativa embebida).
- VST2 de terceros: siguen en ventana flotante.

## Web — hecho

| Pieza | Archivo | Qué hace |
|---|---|---|
| Librería | `plugins/lib/ui-cyber` (`@jaswave/ui-cyber`) | Editor cyber en Canvas desde `ui-layout.json`: mismos tokens, geometría y controles que `shared-ui`; valores y texto idénticos a `jw_params.h`; espectro −120..0 dBFS con balística de 14 dB/s; arrastre (Mayús = fino), doble clic = defecto, rueda, píldoras, desplegables, pulsación larga / clic derecho = valor numérico; táctil (`touch-action: none`, área de 44 px) |
| Responsivo | `disposicion.ts` | ≥ 1024 px completo 16:9 · 640–1023 compacto · < 640 pestañas ESPECTRO · CONTROLES · MEDICIÓN |
| Módulo | `plugins/com.jaswave.modulo.editores-vst` (solo web) | Servicio `editorPlugin` del SDK: el panel «Editor de plugin» lo usa en la web; gestos = un `plugin.setParameter` (deshacer, auditoría, evento `plugin.parametro.cambiado`); 30 fps con ahorro de energía; aviso de que el DSP del VST no corre en la web |
| Datos | `plugins/scripts/ui-layout.mjs` | Genera en el módulo `src/generado/layouts.json` (con el nombre de cada plugin) e `isotipo.ts`; `--check`/`--validar` comprueban que están al día |
| Espectro | `jas-wave/src/modulos/api-espectro.ts` (`espectroDePista` en el SDK) | AnalyserNode de 8192 puntos colgado de la pista solo mientras el editor está abierto |
| Núcleo | `jas-wave/components/plugin-editor-panel.tsx` | Escritorio: editor nativo; web: `servicioDeModulo('editorPlugin')` o aviso con enlace a Módulos |

Demostración sin el DAW (revisión de diseño): `npx vite plugins/lib/ui-cyber/demo`.

### Verificación (web)

- `plugins/lib/ui-cyber/test` (10): mapeo y texto como el VST en los 7 layouts, interpretar valores escritos,
  escalas, columnas desde bins, balística (14 dB/s, igual a 30 y 15 fps), breakpoints, hit-test táctil y dibujo
  de los 7 editores.
- `plugins/com.jaswave.modulo.editores-vst/test` (2): reconoce los 7 VST por su nombre actual y los históricos.
- En Chromium (demo): 1280 px completo 16:9, 800 px compacto, 390 px (iPhone 13, táctil) en pestañas; gesto de
  ratón y de dedo inicio → cambio… → fin, rueda y píldora de bypass.

## Pendiente

- Escritorio: reflejar en el proyecto, en vivo, los cambios hechos en el editor nativo (hoy se toman al cerrar
  el editor con `snapshotTrackPluginIntoProject`).
