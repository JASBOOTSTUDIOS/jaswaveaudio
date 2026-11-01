# JasWave VST — Sistema de diseño "Cyber" (fuente: imagen de referencia del usuario, 2026-10-23)

Todos los VST JasWave deben verse como la referencia: una **pantalla de instrumento sci-fi** enmarcada en metal
cepillado, con fondo azul marino casi negro, retícula fina cian y controles que brillan en cian. Esta guía describe la
imagen para poder implementarla sin verla. Renderizado: **Direct2D + DirectWrite**, antialiasing, HiDPI (escala por
DPI de la ventana), sin asignaciones de memoria por frame, refresco de visualizadores a ~60 fps con timer.

## 1. Composición general (relación 16:9, tamaño base 1100×620 px lógicos, redimensionable proporcionalmente)

```
┌──╲________________________/‾‾‾‾‾‾‾‾‾‾\_____________________________╱──┐   ← marco metálico (34 px)
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ NOMBRE-PLUGIN                    ·  ●  ·   MODO [▾]   JASWAVE  │  │   ← cabecera dentro de la pantalla
▌  │                                         ┌────────┐┌─────────┐  │  ▐   ← LEDs cian verticales en los laterales
▌  │   VISUALIZADOR PRINCIPAL (≈60 % ancho)  │SECCIÓN ││ SECCIÓN │  │  ▐
│  │   onda/espectro/curva en hilo cian      │ perillas││ perillas│  │  │
│  │                                         └────────┘└─────────┘  │  │
│  │  ┌ mini-panel (envolvente/historial) ┐   ┌ faders ┐┌ sección ┐ │  │
│  │  └────────────────────────────────────┘   └────────┘└─────────┘ │  │
│  │                                                   jaswave · id  │  │   ← pie tenue abajo a la derecha
│  └───────────────────────────────────────────────────────────────┘  │
└──╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾\▂▂▂▂▂▂▂▂▂/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲──┘
```

- **Marco** (bezel) de 34 px: metal gris acero cepillado (gradiente vertical + finas líneas horizontales de ruido
  al 4 % de opacidad), **esquinas achaflanadas** a 45° (chaflán de 26 px) y un bisel interior (1 px claro arriba-izq,
  1 px oscuro abajo-der). En el centro superior, una **pestaña** trapezoidal que sobresale 10 px; en el centro inferior,
  una pestaña igual con un **LED cian horizontal** de 60×4 px.
- **LEDs del marco**: barras cian verticales de 4×70 px a media altura en ambos laterales, con resplandor (glow) de 10 px.
  Arriba a la derecha y abajo a la derecha, un grupo de 8 **marcas LED** verticales (2×10 px, separación 4 px), que se
  iluminan como medidor de nivel de salida (encendidas = cian, apagadas = cian al 15 %).
- **Pantalla** interior: esquinas achaflanadas de 14 px, borde 1 px cian al 35 %, sombra interior.

## 2. Paleta (tokens)

V6: la paleta sale del logo de JasWave (`jas-wave/public/jaswavelogo.png`, valores medidos sobre el PNG): negro profundo,
violeta, azul eléctrico, cian y plata cromada. "JAS" va en plata y "WAVE" con el degradado violeta → azul → cian; ese mismo
degradado (`gradienteMarca`) se usa en la marca, el borde de la pantalla y los LEDs (violeta a la izquierda, cian a la derecha).

| Token | Valor | Uso |
|---|---|---|
| `metal.alto` / `metal.bajo` | `#3A3F5E` / `#14152B` | gradiente del marco |
| `metal.brillo` / `metal.sombra` | `#6A70A6` / `#08081A` | bisel |
| `pantalla.fondo` | `#05060F` → `#0D0F2C` | gradiente radial (centro más claro, viñeta en bordes) |
| `panel.fondo` | `#0B0D27` al 62 % | cajas de sección |
| `panel.borde` | `#2D3375` | contorno 1 px de secciones |
| `reticula` | `#1E2260` al 55 % | líneas de grid cada 44 px |
| `reticula.nodo` | `#7C86FF` | puntos en algunas intersecciones (brillo suave) |
| `cian` | `#19D9FF` | arcos de perilla, trazos activos, LEDs, espectro de salida |
| `cian.nucleo` | `#C6F7FF` | centro de LEDs y punto del indicador |
| `cian.glow` | `#19D9FF` al 35 % | resplandor (blur 6–10 px) |
| `violeta` / `azul` / `plata` | `#8A4DFF` / `#3D5BFF` / `#D6D9EE` | marca (degradado violeta → azul → cian), LED izquierdo / inferior, "JAS" |
| `texto.titulo` | `#DCE0FA` | nombre del plugin (plata) |
| `texto.etiqueta` | `#9AA3DA` | etiquetas de control |
| `texto.valor` | `#B6E8FF` | lecturas numéricas |
| `texto.tenue` | `#5C6399` | pie, unidades, ejes |
| `espectro.in` | `#8F83FF` al 65 % | espectro de entrada |
| `bloqueado` | `#5D6288` + candado | controles sin licencia/feature |
| `alerta` | `#FF4FC3` | clip, true-peak sobre techo |
| `acento` por plugin | EQ/Utility/Piano `#19D9FF` · Compresor `#9560FF` · Limitador `#E052FF` · De-esser `#4D7CFF` · Roles `#B59BFF` | detalles propios de cada plugin dentro de la familia del logo |

## 3. Tipografía

- Títulos y etiquetas: **Bahnschrift** (incluida en Windows 10/11), mayúsculas, espaciado de letras +12 %.
  - Nombre del plugin (arriba-izquierda): Bahnschrift Light 22 px, `texto.titulo`, glow sutil.
  - Marca "JASWAVE" (arriba-derecha): Bahnschrift Light 26 px, subrayada por una línea de 1 px cian al 40 %.
  - Cabecera de sección ("OSC", "BANDA 1", "COMP"): Bahnschrift SemiBold SemiCondensed 13 px.
  - Etiqueta de control: Bahnschrift SemiCondensed 11 px, `texto.etiqueta`.
- Valores numéricos: **Consolas** 11–12 px, `texto.valor` (unidad en `texto.tenue`).

## 4. Componentes

- **Perilla**: cuerpo circular oscuro (`#0E1A22`) con anillo metálico fino (gradiente gris, 1.5 px). Recorrido de
  270° (de 135° a 405°). Pista del arco `#1A2C36` 3 px; **arco de valor cian** 3 px con glow; indicador = punto
  `cian.nucleo` en el borde. Tamaños: principal 64 px, normal 44 px, pequeña 30 px. Etiqueta debajo y valor al
  pasar el ratón / arrastrar. Interacción: arrastre vertical (Shift = fino), doble clic = valor por defecto,
  rueda = pasos, clic derecho = escribir valor.
- **Fader vertical**: ranura hundida 6 px de ancho con contorno `panel.borde`; tapa rectangular 22×10 px gris
  metálico con línea cian central; relleno cian tenue desde el fondo hasta la tapa. Valor numérico debajo.
- **Sección (panel)**: caja con esquinas achaflanadas 6 px, `panel.fondo`, borde `panel.borde`, cabecera con
  título a la izquierda y **toggle tipo píldora** (24×8 px, cian brillante = activo, apagado = contorno) a la derecha
  para bypass/activación de la sección.
- **Visualizador principal**: ocupa la izquierda; dibuja sobre la retícula. Estilo de "hilo" (wireframe): varias
  trazas cian superpuestas (la principal opaca 1.5 px, 2–4 ecos al 25–10 % desplazados) con glow, eje horizontal
  central al 40 %. Hexágonos de contorno muy tenues (5 %) como fondo decorativo en la esquina superior izquierda.
  Partículas: 40 puntos estáticos de 1 px al 30 % (deterministas, sin animación costosa).
- **Gráfico de nodos** (curvas EQ, envolventes): línea cian 1.5 px, nodos = círculos de 6 px con núcleo claro;
  nodo seleccionado con anillo de glow. Ejes y lecturas en Consolas `texto.tenue`.
- **Desplegable**: texto pequeño + caja con borde `panel.borde` y chevron.
- **Medidores**: barras verticales segmentadas (LED) en cian; segmento superior en `alerta` al recortar.

## 5. Estados de licencia (obligatorio en todos los VST)

- **Sin licencia válida**: el audio pasa en bypass limpio. La pantalla se oscurece al 70 % y aparece una tarjeta
  central (estilo sección) con: título "ACTIVAR JASWAVE", botón píldora cian **"INICIAR SESIÓN"** (abre el navegador),
  y durante el flujo, el **código de usuario** grande en Consolas 28 px (p. ej. `ABCD-EF23`) más "Esperando
  aprobación…". Errores en `alerta`.
- **Feature no concedida**: el control/sección correspondiente se dibuja en `bloqueado` con un pequeño candado y no
  responde; tooltip "No incluido en tu licencia".
- **Licencia por vencer** (< 2 h sin renovar y sin red): indicador discreto en la cabecera (punto ámbar).

## 6. Reglas de implementación

- Un solo módulo compartido `plugins/shared-ui/` usado por todos los plugins (sin copiar código).
- Escala: todos los tamaños se multiplican por `escala = dpi / 96 × (ancho_actual / 1100)`.
- Sin texto rasterizado por plugin: DirectWrite con caché de `IDWriteTextLayout` por etiqueta.
- El hilo de UI nunca bloquea el de audio: la telemetría llega por el bus existente (`MeterBus`) sin locks en `process`.
- **Plantilla única (V3)**: ningún editor coloca controles con coordenadas propias. Todos usan
  `jw_ui_plantilla.h`: sección de controles (rejilla 3×2), sección SALIDA (bypass en la píldora, fader en
  `kFader`, celdas y medidores IN/OUT en x=976), espectro dual IN/OUT (−120..0 dBFS, 14 dB/s), teclado de
  88 teclas, historial de GR y lecturas del mini-panel. Cada plugin solo elige su acento (`accent()`) y su
  contenido propio dentro de esas zonas. `node plugins/scripts/ui-layout.mjs` comprueba que se cumple.

## 7. Páginas extra a pantalla completa: «MIX / FX» (FX Rack)

`jw_fxrack_page.h` añade a cualquier editor, con una llamada al final de `build()` (`Plantilla::paginaMixFx(c)`), un botón
«MIX / FX» en la cabecera (x 484..568, y 48..68; LED si algún bloque del rack está activo) y una página que sustituye al editor del
plugin: ecualizador de 6 bandas con curva en vivo sobre el espectro de salida y nodos arrastrables, filtros HPF/LPF, compresor con
medidor de reducción, saturación, chorus, delay, reverb y salida/anchura, más RESET FX. Mecanismo genérico (reutilizable por otras páginas):
`Widget::pagina` marca los widgets de la página (el volcado de layout los emite con `"pagina": N` y `layoutExtra()` para los gráficos
propios), la página oculta los widgets del plugin y pone `EditorContext::suppressPanels` (no se pinta `drawPanels` ni se enrutan los
eventos del visualizador). `<Plugin>_snapshot --page 1` captura la página. Ver `docs/plans/F4-fxrack-integracion.md`.
