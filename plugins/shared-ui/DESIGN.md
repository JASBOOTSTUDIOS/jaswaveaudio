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

| Token | Valor | Uso |
|---|---|---|
| `metal.alto` / `metal.bajo` | `#3A4148` / `#15191D` | gradiente del marco |
| `metal.brillo` / `metal.sombra` | `#5C666F` / `#0A0C0E` | bisel |
| `pantalla.fondo` | `#050D14` → `#0A1822` | gradiente radial (centro más claro, viñeta en bordes) |
| `panel.fondo` | `#0B1823` al 88 % | cajas de sección |
| `panel.borde` | `#1E4656` | contorno 1 px de secciones |
| `reticula` | `#163543` al 55 % | líneas de grid cada 44 px |
| `reticula.nodo` | `#3FB8D0` | puntos en algunas intersecciones (brillo suave) |
| `cian` | `#2FD6F2` | arcos de perilla, trazos activos, LEDs |
| `cian.nucleo` | `#BFF6FF` | centro de LEDs y punto del indicador |
| `cian.glow` | `#2FD6F2` al 35 % | resplandor (blur 6–10 px) |
| `texto.titulo` | `#7FE3F5` | nombre del plugin y marca |
| `texto.etiqueta` | `#8FB4BF` | etiquetas de control |
| `texto.valor` | `#A8EEFA` | lecturas numéricas |
| `texto.tenue` | `#4F6B75` | pie, unidades, ejes |
| `bloqueado` | `#5A6870` + candado | controles sin licencia/feature |
| `alerta` | `#F2B544` | clip, true-peak sobre techo |

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
