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

## Web — pendiente

1. `plugins/lib/ui-cyber` (`@jaswave/ui-cyber`): tokens idénticos a `Pal`, widgets (perilla, fader,
   toggle, desplegable, secciones), espectro dual y vectorscopio en Canvas, dibujados desde
   `ui-layout.json`; balística de 14 dB/s; breakpoints y pestañas en móvil; táctil (`touch-action:
   none`, 44 px, pulsación larga = teclado numérico); 30 fps en ahorro de energía.
2. Módulo `com.jaswave.modulo.editores-vst` (contribución «Editor de plugin» solo en la web):
   parámetros por `plugin.setParameter` (undo y auditoría), espectro IN/OUT con `AnalyserNode`, aviso de
   que el DSP del VST no corre en la web.
3. Evento `plugin.parametro.cambiado` en el bus del DAW (escritorio y web).
