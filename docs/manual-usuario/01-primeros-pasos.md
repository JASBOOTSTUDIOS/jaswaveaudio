# 01 · Primeros pasos

## Requisitos

- Windows 64-bit
- Interfaz de audio (ASIO recomendado) o salida del sistema (WASAPI)
- Opcional: [ffmpeg](https://ffmpeg.org/) en el PATH para exportar **FLAC** y **MP3**
- Opcional: proveedor de IA local (p. ej. Ollama) para el Asistente Jas

## Abrir JasWave

1. Instala con el setup NSIS o ejecuta en desarrollo (`npm run dev` en `jas-wave`).
2. Al abrir verás el **Arrange**, el rail izquierdo y la barra de transporte.

## Configurar audio (imprescindible)

1. Menú **Acciones** → **Ajustes del proyecto…** (o panel **Configuración**).
2. Pestaña **Audio**.
3. Elige backend:
   - **ASIO** — baja latencia; usa el driver **x64** del fabricante (no wrappers tipo ASIO4ALL si puedes evitarlo).
   - **WASAPI** — cómodo para empezar; Shared permite monitor de entrada por Chromium con más facilidad.
4. Pulsa el tone test / verifica que oyes señal.
5. Si cambias de device a menudo, deja el **Plugin Host** como dueño del device (así salen VST + clips por la misma ruta).

## Configurar IA (opcional pero recomendado)

1. Ajustes → pestaña **IA** / **Permisos**.
2. Elige proveedor (p. ej. Ollama) y nivel de autonomía.
3. Abre el rail **Asistente Jas** y comprueba que responde a:  
   `¿Cuántas pistas hay en el proyecto?` en modo **Consulta**.

## Primer proyecto en 5 minutos (sin IA)

1. **Archivo → Nuevo proyecto** (`Ctrl+N`).
2. En Arrange: **Nueva pista MIDI**.
3. Rail **Instrumentos** → **Insertar JasWave Roles** (o escanea e inserta un VST).
4. Doble clic / selecciona la pista → abre **Piano roll** → dibuja unas notas.
5. **Espacio** para reproducir.
6. **Ctrl+S** → guarda como `MiCancion.jaswave`.
7. **Archivo → Exportar bounce WAV…** → Exportar.

## Primer proyecto con IA (5 minutos)

1. Ajusta audio e IA.
2. Asistente Jas → modo **Crear** (o **Auto**).
3. Escribe algo como:

```text
Music Build: balada pop 90 BPM, C mayor, 1 minuto.
Pistas: piano, pad, bajo. Usa JasWave Roles si no hay VST.
Luego mezcla suave y deja listo para bounce.
```

4. Revisa la tarjeta **Music Build** / pasos; si el modo es **Plan** o **Pensar**, pulsa **Construir** para aplicar.
5. Reproduce, ajusta faders, exporta.

Siguiente: [02 · Interfaz](./02-interfaz.md).
