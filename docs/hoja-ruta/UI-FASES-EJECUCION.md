# Hoja de Ruta UI — JasWave DAW (por fases probadas, sin regresión)

> **Regla de Oro**: Antes de marcar una fase como CERRADA, se ejecuta el checklist de NO REGRESIÓN de TODAS las fases anteriores.
> **Regla 2**: Cada fase toca el MENOR número de archivos posible, y cada commit de fase es atómico (git).
> **Regla 3**: `npx tsc --noEmit -p Electron` = 0 errores OBLIGATORIO antes de cerrar.

---

## Convenciones
- 🧪 = Prueba manual paso-a-paso
- 🔁 = Prueba de NO REGRESIÓN (repetir pruebas de fases pasadas)
- ✅ = Criterio de aceptación
- 📁 = Archivos que se tocan en la fase
- ⚙️ = Pre-requisito (antes de empezar)

---

# FASE 00: DIAGNÓSTICO Y BASE SANA (antes de tocar UI)

## Objetivo
Confirmar qué cosas ya funcionan y cuáles no, antes de romper nada. Ningún cambio funcional en esta fase.

## ⚙️ Pre-requisitos
- Rama `ui-fase-00` creada desde `main` / master
- `npm install` (root, `Electron/`, `shared/`)
- Terminal 1: `cd Electron ; npm run dev` (Vite + Electron)
- Terminal 2: `npx tsc --noEmit -p Electron` (TS limpio)

## 📁 Archivos (solo lectura)
- [Aplicacion.tsx](file:///c:/src/jaswave/Electron/src/Aplicacion.tsx)
- [LayoutDock.tsx](file:///c:/src/jaswave/Electron/src/componentes/LayoutDock.tsx)
- [LineaTiempo.tsx](file:///c:/src/jaswave/Electron/src/componentes/LineaTiempo.tsx)
- [Transporte.tsx](file:///c:/src/jaswave/Electron/src/componentes/Transporte.tsx)
- [BarraEstado.tsx](file:///c:/src/jaswave/Electron/src/componentes/BarraEstado.tsx)
- [MenuBar.tsx](file:///c:/src/jaswave/Electron/src/componentes/MenuBar.tsx)
- [BarraActividades.tsx](file:///c:/src/jaswave/Electron/src/componentes/BarraActividades.tsx)
- [Mezclador.tsx](file:///c:/src/jaswave/Electron/src/componentes/Mezclador.tsx)
- [PanelPropiedades.tsx](file:///c:/src/jaswave/Electron/src/componentes/PanelPropiedades.tsx)

## 🧪 Pruebas manuales (llenar tabla con PASS/FAIL)
| # | Prueba | Esperado | Real |
|---|--------|----------|------|
| 00.1 | App arranca sin errores de consola | 0 errores rojos | |
| 00.2 | Menús (Archivo / Editar / Ver) se abren al clic | Despliegan opciones | |
| 00.3 | Archivo → Nuevo proyecto | Responde (aunque sea no-op visiblemente) | |
| 00.4 | Split izquierdo se mueve al arrastrar | Anchura cambia sin saltos | |
| 00.5 | Split derecho se mueve al arrastrar | Anchura cambia sin saltos | |
| 00.6 | Split inferior se mueve al arrastrar | Altura cambia sin saltos | |
| 00.7 | Tabs de zonas tienen icono + texto legibles | No se cortan, sin emojis | |
| 00.8 | Botón Play / Stop del transporte responde | Alterna color + estado | |
| 00.9 | Barra de estado muestra BPM + tiempo | Valores cambian si se actualiza el estado | |
| 00.10 | Timebar (ruler superior) se ve | Marcas de tiempo visibles | |
| 00.11 | Ctrl + scroll sobre timeline = zoom horizontal | Anchura de compases cambia | |
| 00.12 | Shift + drag área vacía timeline = pan horizontal/vertical | Scroll cambia sin saltos | |
| 00.13 | Click vacío en timeline = mueve playhead | Línea roja salta a la posición clicada | |
| 00.14 | Drag tab a otra zona = highlight drop | Zona destiono brilla al soltar | |
| 00.15 | Atajo `Space` = Play/Stop | Dispara transport.toggle | |
| 00.16 | Atajo `W` = ir al inicio | Playhead a 0 | |
| 00.17 | Atajo `E` = ir al final | Playhead al último clip | |

## ✅ Cierre de FASE 00
- Se ha completado la tabla de PASS/FAIL
- Se identifica el PRIMER bloque real (casi siempre FASE 01)

---

# FASE 01: SHELL DE APLICACIÓN ROBUSTO (LayoutDock Aislado)

## Objetivo
El layout dock funciona PERFECTAMENTE con **solo placeholders** de contenido (sin LineaTiempo, sin Mezclador, sin props).
Se prueba solo el contenedor de 4 zonas, splitters, tabs, y colapsados.

## 📁 Archivos que se tocan
- [LayoutDock.tsx](file:///c:/src/jaswave/Electron/src/componentes/LayoutDock.tsx)
- TEMPORALMENTE: [Aplicacion.tsx](file:///c:/src/jaswave/Electron/src/Aplicacion.tsx) — se reemplazan TODOS los paneles por un `<PlaceholderPanel />` simple (un div con texto)
- Al final de fase, restaurar contenido real de Aplicacion.

## Checklist implementación
- [ ] Split izq (3px + 6px hitbox transparente) sin saltos, min=200 max=620 px
- [ ] Split der igual al izq
- [ ] Split inf min=180 max=680 px
- [ ] Collapse toggle izq (botón ↑▼): colapsa a 48px, expandir restaura tamaño anterior
- [ ] Collapse toggle der igual
- [ ] Collapse toggle inf: colapsa a 28 px
- [ ] Tabs dentro de cada zona: clic = cambia activa, texto + icono Lucide sin emojis
- [ ] Botón × (Square) en cada tab: cierra la pestaña, pasa a la siguiente si hay
- [ ] Drag tab dentro de MISMA zona: reordena tabs (si hay soporte, opcional)
- [ ] Drag tab a zona DIFERENTE: soltar → panel pasa a la nueva zona + highlight `ring-sky-500/60` al sobrevolar
- [ ] Doble click en tab = se COLOCA un console.log "undock: panelId, zona, titulo" (luego IPC, ahora solo verificar evento)
- [ ] Persistencia: al cerrar/reabrir app, anchos de splits se mantienen (localStorage `jaswave.layout-dock`)

## 🧪 Pruebas manuales (14 pasos OBLIGATORIOS)
| # | Prueba | Esperado |
|---|--------|----------|
| 01.1 | Arrastrar split izq MUY rápido 20 veces | No se traba, no se sale del min/max |
| 01.2 | Touch 1 dedo splitter izq en emulador DevTools | Se mueve sin perder puntero |
| 01.3 | Colapsar izq → expandir → colapsar der → expandir → colapsar inf → expandir | Tamaños guardados por zona |
| 01.4 | 20 tabs en zona center (crearlas dummy) | Scroll horizontal automático, no desborda |
| 01.5 | Drag tab de left → center → right → bottom → left de vuelta | Siempre llega a la zona |
| 01.6 | Soltar tab FUERA de las 4 zonas (en barra estado) | Tab vuelve a su zona, no desaparece |
| 01.7 | Minimizar ventana Electron a 600×400 | Split inf colapsa automáticamente si es necesario |
| 01.8 | Maximizar ventana | Los 3 splits no pierden su proporción |
| 01.9 | Cerrar todas las tabs de una zona menos 1 | No se puede cerrar la última (protegida) |
| 01.10 | localStorage está vacío → splits = default anchoLeft=280 anchoRight=300 altoBottom=260 | Valores default aplicados |
| 01.11 | Resize 1 vez, refresh F5, medir anchos por código | Coinciden ± 2 px |
| 01.12 | Doble click 10 tabs distintos | Todos disparan evento + console.log |
| 01.13 | Split arrastra hasta el límite MAX y luego MIN | Sin overflow en consola |
| 01.14 | Ctrl+R recargar app, inmediatamente arrastrar splitter antes de que cargue completamente | No crashea, evento pointerup se limpia |

## 🔁 NO REGRESIÓN (repetir todas de FASE 00 que apliquen)
- 00.1, 00.4, 00.5, 00.6, 00.7, 00.14

## ✅ Cierre
- 14/14 PASS
- `npx tsc --noEmit -p Electron` = 0
- Commit atómico: `feat(ui): fase 01 LayoutDock robusto`

---

# FASE 02: BARRAS FIJAS (MenuBar + Transporte + BarraEstado + BarraActividades)

## Objetivo
Las 4 barras periféricas funcionan aisladas del contenido central. 0 lógica de dominio, solo UI + navegación.

## 📁 Archivos
- [MenuBar.tsx](file:///c:/src/jaswave/Electron/src/componentes/MenuBar.tsx)
- [Transporte.tsx](file:///c:/src/jaswave/Electron/src/componentes/Transporte.tsx)
- [BarraEstado.tsx](file:///c:/src/jaswave/Electron/src/componentes/BarraEstado.tsx)
- [BarraActividades.tsx](file:///c:/src/jaswave/Electron/src/componentes/BarraActividades.tsx)

## Checklist
- [ ] MenuBar: cada menú Archivo/Editar/Ver/Pista/Transporte/Ayuda tiene el mismo orden que REAPER y los items clicables disparan un console.log de su `accionId`
- [ ] Transporte: Play, Pause, Stop, Rec, BPM +/- , Snap, Master Vol, Zoom, Undo, Redo. Todos disparan accionId correspondiente. **SIN EMOJIS**, solo iconos Lucide. Tooltip muestra accion + shortcut.
- [ ] BarraEstado: 12 secciones (proyecto, tiempo, BPM, sampleRate, bitDepth, nPistas, nClips, dock, IA, play/stop, vista, err/warn). Todas leen del estado DAWProvider sin crashear si valor = undefined
- [ ] BarraActividades: 8 íconos (Arrange, Mixer, Automation, Files, Media, Plugins, IO, Search, Settings). Clic alterna panel correspondiente. Tooltip en hover.

## 🧪 Pruebas
| # | Prueba | Esperado |
|---|--------|----------|
| 02.1 | Abrir 6 menús con el teclado (Alt+F, Alt+E, Alt+V, Alt+P, Alt+T, Alt+H) | Se abren, se cierran con Esc |
| 02.2 | 100 clicks en Play/Stop alternados | No se queda pegado en PLAY sin estado |
| 02.3 | Drag slider Master Vol de 0 a 100 | Sin saltos, valor se actualiza en texto |
| 02.4 | BPM − 50 veces luego + 50 veces | Vuelve a 120 exacto |
| 02.5 | Snap dropdown 1/1 → 1/4 → 1/8 → 1/16 → off | Todos renderizan sin cortes |
| 02.6 | BarraActividades clic icono 3 → icono 7 → icono 1 | Paneles correspondientes se abren/colapsan |
| 02.7 | Minimizar ventana a 700 px de ancho | Transporte wrap (gap-2), no se rompe layout |
| 02.8 | Undo/Redo en estado vacío (sin historial) | Botones disabled (opacidad 40%) |
| 02.9 | Playhead se actualiza en BarraEstado cada 100 ms cuando está en PLAY | Valores tabular-nums se mueven |
| 02.10 | Ancho total 400 px | BarraEstado muestra solo las 4 secciones más importantes (trunca con …) |

## 🔁 NO REGRESIÓN
- Repetir todas FASE 01 (14/14)
- Repetir FASE 00 que apliquen

---

# FASE 03: TIMELINE MVP SOLO PAN / ZOOM / PLAYHEAD (SIN CLIPS, SIN PISTAS)

## Objetivo
El área de timeline funciona VACÍA: regla, playhead draggable, pan horizontal+vertical, zoom anchored. 0 clips = 0 distracciones.

## 📁 Archivos
- [LineaTiempo.tsx](file:///c:/src/jaswave/Electron/src/componentes/LineaTiempo.tsx) (copiar backup antes: LineaTiempo-backup-fase02.tsx)
- Solo se TOCAN las partes de ruler, playhead, pan, zoom. Clip rendering se COMENTA temporalmente.

## Checklist
- [ ] Ruler: marcas por compás visibles según BPM=120 y compás 4/4. Números "1 · 2 · 3 · 4 · 5".
- [ ] Playhead rojo (#f43f5e) con flecha superior rotate-45 visible. No parpadea.
- [ ] Playhead draggable sobre ruler (solo pointer down sobre el área de regla)
- [ ] Clic vacío sobre regilla: playhead salta al clicado
- [ ] Pan: Shift + drag en cualquier punto vacío (ruler o área regilla) = mover offset X+Y
- [ ] Pan: botón medio (button=1) = mismo comportamiento
- [ ] Pan: 1 dedo touch (pointerType === touch) dentro de la regilla = mover offset sin zoom
- [ ] Zoom: Ctrl + rueda ratón sobre timeline. PPS se actualiza 15 ≤ pps ≤ 320. Zoom ANCLADO a la posición del ratón (el beat bajo cursor NO se mueve)
- [ ] Zoom táctil 2 dedos pinch: 2 dedos = factor distancia, anclado al centro del pinch
- [ ] Botones UI ZoomIn / ZoomOut / FitToContent (Maximize2) = trabajan
- [ ] Barras scroll manuales X e Y sincronizadas con pan

## 🧪 Pruebas (22 pasos)
| # | Prueba | Esperado |
|---|--------|----------|
| 03.01 | PPS=60, compás 4/4, BPM=120: marcas 1, 2, 3, 4 equiespaciadas por 1 segundo | Espacio entre 1 y 2 = ~60 px en PPS=60 |
| 03.02 | 100 drags de playhead sobre ruler | Siempre sigue cursor sin desfase |
| 03.03 | Shift+drag vacío 500 px a la derecha, luego a la izquierda a 0 | Offset vuelve exacto a 0 |
| 03.04 | Ctrl+scroll 10 vueltas hacia adentro | PPS llega a 320 y se clampea |
| 03.05 | Ctrl+scroll 10 vueltas hacia afuera | PPS llega a 15 y se clampea |
| 03.06 | Zoom anchored: coloca playhead en beat 3, haz Ctrl+scroll sobre él | Playhead visualmente se mantiene en el cursor |
| 03.07 | Botón FitToContent (Maximize2) | PPS se ajusta para ver 32 compases (8×4 beats) |
| 03.08 | ZoomIn 1 clic / ZoomOut 1 clic | PPS cambia de a ± 15 |
| 03.09 | Touch pinch (2 dedos) en emulador DevTools | Zoom cambia sin oscilar |
| 03.10 | 1 dedo touch drag horizontal 400 px | Pan H solo, V = 0 |
| 03.11 | Minimizar altura de timeline a 200 px | Scroll bar V aparece sin romper |
| 03.12 | Rueda sin Ctrl + sin Shift → scroll V normal | Se mueve área de pistas verticalmente |
| 03.13 | Alt + rueda → scroll H normal | Se mueve horizontalmente |
| 03.14 | Shift + rueda → scroll H normal | Opcional, si es costumbre usuario |
| 03.15 | Cambiar ventana tamaño 3 veces seguidas | Playhead no se desalinea del tiempo |
| 03.16 | Clic fuera de ventana (pierde foco) mientras drag pan | Al volver, no se queda arrastrando solo |
| 03.17 | HMR Vite actualiza LineaTiempo.tsx | Pan/offset NO se resetean a 0 (si guardado en state) |
| 03.18 | PPS=320 (zoom máximo) y arrastrar 100 px = 1 segundo | Relación exacta: 1 segundo = 320 px |
| 03.19 | PPS=15 (zoom mínimo) scroll 1000 px horizontal | No crashea, no hay NaN en consola |
| 03.20 | Playhead + pan: playhead al final visible, pan para ocultarlo fuera a la izq → volver a pan derecho | Playhead vuelve a aparecer sin desfase tiempo vs px |
| 03.21 | Grabación activada (REC) → pan sigue trabajando | No hay dead-zone |
| 03.22 | Clic sobre playhead (línea roja), no sobre área ruler | No mueve playhead accidentalmente (opcional) |

## 🔁 NO REGRESIÓN
- FASE 01 + FASE 02 completas

---

# FASE 04: TIMELINE PISTAS + 1 CLIP MVP (drag, resize, snap, mute/solo)

## Objetivo
Se renderizan 2 pistas dummy. Cada pista tiene 1 clip audio (waveform placeholder). Drag del clip, resize handles izq/der, snap default 1/4, M/S toggles.

## 📁 Archivos
- [LineaTiempo.tsx](file:///c:/src/jaswave/Electron/src/componentes/LineaTiempo.tsx)
- [WaveformClip.tsx](file:///c:/src/jaswave/Electron/src/componentes/WaveformClip.tsx)

## Checklist
- [ ] Estructura pista: color barra izquierda, nombre pista, M, S, R, I, FX, IO
- [ ] Altura pista min 64 px, default 88 px
- [ ] 1 clip por pista con waveform placeholder (sin AudioBuffer aún)
- [ ] Drag clip horizontal: cambia `clip.inicio` con snap 1/4
- [ ] Resize handle izq (2.5 px hover blanco/10)
- [ ] Resize handle der igual
- [ ] Clip no puede ser < 0.05 s
- [ ] Selección clip = clic, borde blanco 1 px, sombra
- [ ] M = mutear clip gris, S = solo clip amarillo neon (temporalmente UI, sin audio aún)
- [ ] Doble clic clip = inline rename
- [ ] Drop File audio externo en pista = highlight `ring-sky-500/60` y clip nuevo en posición soltada
- [ ] Toolbar timeline: Plus (nuevo clip), Scissors (cortar), Copy, Paste, Combine, Upload (drop), ZoomIn, ZoomOut, Fit (solo UI clickeable + console.log de accion)

## 🧪 Pruebas (24)
| # | Prueba | Esperado |
|---|--------|----------|
| 04.01 | 20 drags horizontales clip, snap=1/4 | Siempre cae en beat exacto |
| 04.02 | Drag clip hasta inicio negativo | Se clamp en inicio=0 |
| 04.03 | Resize der 1 px → 100 veces → clip duplica largo | Sin saltos, sin NaN |
| 04.04 | Resize izq más allá del inicio del clip | Min 0.05 s, no desaparece |
| 04.05 | Snap off → drag 1 px | Se mueve 1 px, no se salta a beat |
| 04.06 | Snap 1/16 → drag | Caída en sub-beats 16avos |
| 04.07 | Clic clip 1, clic clip 2, clic vacío | Selección cambia, luego se limpia |
| 04.08 | 10 renombramientos dobles clic | Entra/sale modo rename sin perder foco |
| 04.09 | M toggle clip 50 veces → luego S → luego M | Estado UI consistente |
| 04.10 | Drop 1 archivo .mp3 externo | Highlight aparece, desaparece al soltar, clip nuevo con nombre archivo |
| 04.11 | Drop FUERA de pista (en espacio entre pistas) | No se crea clip (no-op sin error) |
| 04.12 | Drop sobre barra nombre de pista (fuera de la regilla) | No crashea |
| 04.13 | Drag clip mientras Ctrl + scroll zoom | Se sigue moviendo, no se pierde pointer |
| 04.14 | Zoom máximo PPS=320 → resize handle 1 px es detectable | Agarra sin problema |
| 04.15 | Zoom mínimo PPS=15 → handles siguen capturando clicks 2.5px | No se pierde el hit |
| 04.16 | Drag clip fuera de la pista (a otra pista) — opcional cross-track | Si no soporta cross, vuelve a origen sin error |
| 04.17 | Ctrl+C clip seleccionado → console.log | Copiado |
| 04.18 | Ctrl+V pegar 10 veces | 10 clips nuevos desplazados 1 beat |
| 04.19 | Tijera (Scissors) sobre clip = click → corta en 2 en el playhead | 2 clips en vez de 1 |
| 04.20 | Combine 2 clips adyacentes | Vuelven a 1 |
| 04.21 | Botón Plus del toolbar = agrega 1 clip en playhead | Creado |
| 04.22 | Hover 3s sobre botón toolbar | Tooltip aparece con nombre + atajo |
| 04.23 | Botón Upload abre <input type=file multiple> y al cancelar no crashea | OK |
| 04.24 | 1000 clips generados automáticamente (script de prueba) | Scroll con 60 fps (virtualizar si hace falta) |

## 🔁 NO REGRESIÓN
- FASE 01 + FASE 02 + FASE 03 (especial 03.01-03.22)

---

# FASE 05: ATAJOS TECLADO REAPER MVP (8 BÁSICOS) + CONFIGURABLE

## Objetivo
Solo 8 atajos funcionan BIEN, sin conflictos. Hook `useAtajos` configurable por usuario. Los restantes 65 se agregan en fases siguientes.

## 📁 Archivos
- [shared/src/config/atajos.ts](file:///c:/src/jaswave/shared/src/config/atajos.ts)
- [Electron/src/ganchos/useAtajos.ts](file:///c:/src/jaswave/Electron/src/ganchos/useAtajos.ts)

## Checklist (solo 8 atajos)
- [ ] Space → Play/Pause
- [ ] Ctrl+Space → Stop
- [ ] W → ir al inicio (playhead a 0)
- [ ] E → ir al final (último clip)
- [ ] M → mute pista seleccionada
- [ ] S → solo pista seleccionada
- [ ] R → armar grabación pista
- [ ] Backspace → eliminar clip seleccionado

Plus:
- [ ] Los atajos NO se disparan si foco está en `<input>`/`<textarea>` y no hay modificadores Ctrl/Alt/Meta
- [ ] Combinación duplicada → warning de consola y gana la primera
- [ ] Todos los 8 atajos aparecen en tooltip de su botón correspondiente en UI

## 🧪 Pruebas (16)
| # | Prueba | Esperado |
|---|--------|----------|
| 05.01 | Space 100 veces en área timeline | Play/Stop alterna sin perder |
| 05.02 | Dentro `<input type=text>` del rename clip, presionar Space → **NO** debe disparar play | Inserta espacio en el texto |
| 05.03 | Dentro del mismo `<input>`, Ctrl+Space → sí debe disparar Stop | Para playback |
| 05.04 | W inmediatamente después de reproducir 10 s | Playhead instantáneamente en 0 |
| 05.05 | Con un clip al final, E salta al final del clip | Playhead al `inicio + duracion` |
| 05.06 | Pista 1 sin seleccionar, clic en nombre para seleccionar, M → toggle | Icono M cambia color |
| 05.07 | S idem a M | |
| 05.08 | R idem | |
| 05.09 | Backspace sin clip seleccionado → no-op | Nada se borra |
| 05.10 | Backspace con clip → se borra y siguiente se muestra | |
| 05.11 | Teclado en español (con ñ, ¿): Space = `' '`, W, E, M, S, R = ASCII. Todas detectan | |
| 05.12 | Caps Lock activado: M sigue detectando (mayúsculas se normalizan a minúsculas) | |
| 05.13 | Shift + M → distinto accion (opcional) o no-conflicto | No dispara Mute |
| 05.14 | Duplicar Space manualmente en config = consola warning | OK |
| 05.15 | Tooltip botón Play = "Reproducir / Pausar (Space)" | Muestra combo correcto |
| 05.16 | 40 inputs/textarea distribuidos en UI, focus en cada uno + Space = **ninguno** dispara play | |

---

# FASE 06: MEZCLADOR MVP (Solo 1 Master + 2 canales, volumen + paneo)

## 📁 Archivos
- [Mezclador.tsx](file:///c:/src/jaswave/Electron/src/componentes/Mezclador.tsx)

## Checklist
- [ ] Canal por pista (máx 2 iniciales) + canal Master último siempre
- [ ] Fader vertical arrastrable 0..1, tabla dB -∞..+6 dB
- [ ] Pan L/R -1..0..1
- [ ] M, S botones por canal
- [ ] Meter VU (verde → amarillo → rojo) animado en tiempo real aunque sea señal sintética
- [ ] Ancho canal fijo ~104 px, scroll horizontal si > N

## 🧪 Pruebas
- 16 pasos detallados en documento posterior (por brevedad)

---

# FASE 07: PANEL PROPIEDADES (Nombre, Tipo, Color, Volumen, Paneo)
# FASE 08: PANELES FLOTANTES MULTI-MONITOR IPC (undock / re-dock)
# FASE 09: CONSISTENCIA VISUAL FINAL — Design Tokens + CSS Variables globales
# FASE 10: PRUEBA DE ESTRÉS + E2E SMOKE (100 pistas, 10,000 clips, 2 horas)

---

# Checklist global de cierre (antes de pasar a producción)
- [ ] Todas fases 00-09 marcadas 100% PASS
- [ ] `npx tsc --noEmit -p Electron` 0 errores
- [ ] `npx tsc --noEmit -p shared` 0 errores
- [ ] Todos los tests shared `npm test` pasan
- [ ] 2 horas ejecutando app de forma continua sin crashear
- [ ] Windows 10/11 + macOS + Linux (WSL2) probados mínimo 1 vez
