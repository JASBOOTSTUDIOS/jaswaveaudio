# 09 · Mezcla y exportar

## Antes de exportar — checklist

1. Reproduce de principio a fin sin clips mudos inesperados.
2. Quita solos accidentales; revisa mutes.
3. Master no al rojo constante (true peak / clipping).
4. VSTs con caption **host listo** en pistas MIDI importantes.
5. `Ctrl+S`.

## Diálogo Exportar

**Archivo → Exportar (canción, pistas, MIDI, proyecto)…** · atajo **Ctrl+Alt+R**

| Pestaña | Qué exporta |
|---------|-------------|
| **Canción** | La mezcla completa por la misma cadena que Play (clips, instrumentos VST3, efectos, envíos y master) |
| **Pistas (stems)** | Un WAV por pista elegida, con sus efectos, tras el fader (o antes, si lo eliges), más la mezcla |
| **MIDI** | Un `.mid` estándar (tipo 1): una pista por pista, con tempo, compás y marcadores; la batería va en el canal 10 |
| **Proyecto** | Un `.zip` con el proyecto y todo su audio; se abre con **Archivo → Abrir proyecto empaquetado** |

| Opción | Notas |
|--------|--------|
| Formato | **WAV** siempre; **AIFF, FLAC, MP3, AAC (M4A), OGG, Opus** con el codificador (ffmpeg). Si no está, el diálogo ofrece **Descargar codificador** (una sola vez) |
| Profundidad | 16 bits (con dither), 24 bits o 32 bits float (WAV/AIFF) |
| Frecuencia | 44,1 / 48 / 88,2 / 96 kHz |
| Calidad | 128–320 kbps en formatos con pérdida |
| **Duración** | **Automática** (por defecto): del inicio hasta el final del último clip audible, más la cola de reverb/delay hasta que se apaga; el silencio sobrante se recorta. También: región de loop, clips seleccionados o **rango manual en mm:ss** |
| Normalizar | No / Pico −1 dB / −14 LUFS |
| Informe para | Streaming / Club / CD / sin informe |
| Progreso / Cancelar | Sí |

El metrónomo nunca entra en un export. Los stems duran lo mismo que la mezcla, para que se alineen al importarlos
en otro DAW. Si el proyecto no tiene clips audibles, **Exportar** queda desactivado.  
Si hay MIDI con VST **sin slot host**, el export **aborta** con error (mejor que un WAV silencioso).

Desde la CLI: `daw-cli export mix|stems|midi|project <ruta> […]` (ver `daw-cli --help`). El asistente usa las mismas
acciones: `render.start`, `export.midi` y `export.projectBundle`.

## Mixer

Cada tira (y el Master) tiene la misma estructura, de arriba abajo:

- **Cabecera:** nombre, M/S, IN/rec y el botón de **espectro** (icono de barras), que abre un mini analizador
  20 Hz–20 kHz de esa pista, después del fader. Cada tira tiene el suyo: puedes abrir varios a la vez y cerrar
  uno no cierra los demás.
- **Entradas, FX y envíos:** con su propio scroll. Ocupan todo el alto libre de la tira, así que no quedan huecos
  vacíos. Por muchos plugins que añadas, el fader no se mueve ni se encoge.
- **Paneo** centrado (doble clic o clic central = centro). Es una perilla; con poco alto pasa a una barra fina L/R.
- **Volumen:** fader de 160 px idéntico en todas las tiras (la marca de 0 dB queda a la misma altura),
  VU estéreo L/R con escala +12…−60 dB, la ganancia en dB y el **pico máximo**. Si el pico llega a 0 dBFS
  la insignia se pone roja con **CLIP**; un clic la resetea.

**Selección sincronizada:** al seleccionar una pista en el Arrange, su tira del mixer se desplaza hasta verse
si estaba fuera por el scroll; al elegir una tira en el mixer, el Arrange baja o sube hasta su pista.

**Ancho de las tiras:** Ctrl + rueda sobre el mixer las ensancha o estrecha (se recuerda); el botón «−» de la
barra las deja al mínimo. El alto del panel nunca cambia el ancho.

Si el panel es bajo, el mixer oculta por orden: primero entradas, FX y envíos (con IN/rec y el espectro), después
la perilla de paneo pasa a barra y, al final, el paneo desaparece. Siempre quedan **M/S y el fader de volumen**:
el divisor del panel no deja bajar de ese mínimo, así que el mixer nunca necesita scroll. Avisa arriba:
**Flotar** (ventana propia), **Ocultar** o **Mantener**.
Con «Recordar preferencia» no vuelve a avisar en ese panel; el botón **Restablecer layout** (↺ en el menú de
espacio de trabajo) reactiva los avisos. El mismo aviso aparece en Piano Roll, Inspector, Editor de plugin y FX Chain.

## Medidores / Listen

Tras bounce, panel **Medidores**:

- LUFS integrados, true peak
- Listen OK / FAIL según target
- Espectro / estéreo

No digas “master listo” si Listen falla: baja master, ajusta picos, re-exporta.

## Stems

Los stems salen del motor en la misma pasada que la mezcla: cada pista con su instrumento, sus inserts, el fader y
el paneo (o antes del fader, si eliges esa toma). Un bus de retorno exportado incluye lo que le llega por envíos,
ya procesado por sus efectos; el stem de una **carpeta** es la submezcla de sus pistas tras los FX y el fader de la
carpeta.

**Envíos y buses:** lo que llega a un bus por un envío pasa por los efectos del bus (la reverb de un retorno
procesa los envíos) y por su fader antes del Master.
Los stems no pasan por la cadena del master; se guardan siempre en WAV en la carpeta `<nombre>-stems`.

## Master Pass (asistido)

Pide al Asistente:

```text
daw.masterPass target streaming; luego bounce con listen.
```

Revisa el informe; el humano siempre valida de oído.

## Destinos típicos

| Destino | Orientación |
|---------|-------------|
| Streaming | ~−14 LUFS, true peak ≤ −1 dBTP |
| Club | Más hot (según target del análisis) |
| CD | Dinámica distinta — usa el preset listen de la app |

Siguiente: [10 · Atajos](./10-atajos.md).
