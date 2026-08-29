# 04 · Transporte y Arrange

## Barra de transporte

| Control | Atajo típico | Qué hace |
|---------|--------------|----------|
| Reproducir / Pausar | `Espacio` | Play / pause |
| Pausar | `Enter` | Pausa |
| Detener | `Ctrl+Espacio` | Stop y playhead a inicio (según configuración) |
| Grabar | `Ctrl+R` | Alterna grabación |
| Bucle | `R` | Activa/desactiva loop |
| Ir al inicio | `W` / `Home` | Seek inicio |
| Ir al final | `End` | Seek final |
| Metrónomo | `K` | Click track |
| BPM | (campo en barra) | Tempo del proyecto |

También: **Punch in/out** y **Count-in** (MVP) desde transporte / toggles relacionados.

El **medidor de buffer** (blanco → amarillo → rojo) indica ocupación mix→ASIO. Si se pone rojo a menudo, sube el buffer o quita FX pesados.

## Arrange — pistas

1. **Nueva pista de audio** o **Nueva pista MIDI**.
2. Cabecera de pista:
   - Color, nombre
   - **M** mute · **S** solo · armado · monitor
   - Añadir instrumento / FX
   - Importar audio
   - Asa **⋮⋮** — arrastra para **reordenar** (también en el Mixer)
3. Selecciona la pista para el Inspector / FX Chain / Piano roll.

### Tipos útiles

- **Audio** — clips WAV, grabación, import
- **MIDI / instrumento** — notas + VST en la cadena

## Clips

- **Mover** — arrastra el cuerpo del clip (imán/snap según cuadrícula)
- **Recortar** — asas izquierda/derecha
- **Dividir en playhead** — atajo `S` (herramienta cortar)
- Copiar / cortar / pegar / duplicar / borrar — menú Editar o atajos
- Arrastrar a otra pista cuando el tipo lo permita

## Herramientas de edición (toolbar)

| Herramienta | Atajo catálogo | Uso |
|-------------|----------------|-----|
| Seleccionar | `1` / N | Selección |
| Mover | `2` / M | Mover clips |
| Dibujar | `3` / B | Crear |
| Cortar / Split | `4` / S | Dividir |
| Borrador | `5` | Borrar |

**Snap / cuadrícula:** Off, 1 compás, 1/2 … 1/16.  
**Zoom:** `Ctrl+=` / `Ctrl+-`, o `Ctrl` + rueda (ancla al cursor).

## Marcadores

Crea marcadores en el playhead para secciones (Intro, Estribillo…). Útiles para ti y para el Asistente / Music Build.

## Grabación básica de audio

1. Elige pista **audio**.
2. Asigna entrada (dispositivo) en cabecera / Inspector.
3. **Arma** la pista.
4. Activa metrónomo / count-in si quieres.
5. `Ctrl+R` + Play según flujo.
6. Detén → aparece un clip.

> Con **ASIO** como dueño del device, el monitor soft por Chromium puede estar deshabilitado (mensaje honesto). Usa monitor de hardware del interface o WASAPI Shared si necesitas soft-monitor.

Siguiente: [05 · Mixer, FX y automatización](./05-mixer-fx-automatizacion.md).
