# 07 · VST e instrumentos

## Filosofía JasWave

No hay Soft Pad Web Audio: el sonido de instrumentos sale del **Plugin Host** (VST nativo o **JasWave Roles / Piano**).

## JasWave Roles y Piano

1. Rail **Instrumentos** → **Insertar JasWave Roles** (o Piano).
2. En el panel Roles elige el rol (piano, pad, bajo, etc.) / parámetros.
3. Ideal para demos, Music Build nativo (`rolesOnly` / soft pad only) y cuando no tienes librerías externas.

## Escanear e insertar VST

1. **Instrumentos** → añade carpetas de búsqueda (Common Files VST3, etc.).
2. Escanea el catálogo.
3. Inserta en la pista seleccionada (o pide al Asistente `plugin.insert`).

### Preferencias de formato

| Formato | Recomendación |
|--------|----------------|
| **VST3** (`.vst3`) | Preferido |
| **VST2** (`.dll`) | Solo **x64**; si falla MIDI/audio, busca la edición VST3 |

### Alias que entiende el Asistente

| Dices | Resuelve a |
|-------|------------|
| Descent / Decent | **DecentSampler** |
| Font / Font Piano | **Kontakt** (si está instalado) |
| BFD | **BFD Player** |

Ruta típica DecentSampler:  
`C:\Program Files\Common Files\VST3\DecentSampler.vst3`

## DecentSampler — tips

1. Inserta el VST en una pista MIDI.
2. Abre el **Editor de plugin**.
3. Carga un preset **`.dspreset`** — sin preset suele quedar en silencio.
4. Guarda el estado en **Biblioteca** cuando suene bien.

## Kontakt / BFD / librerías pesadas

1. Inserta → espera confirmación del host.
2. Carga el instrumento/kit **dentro** de la UI del plugin.
3. **Guarda proyecto** + preset en Biblioteca.
4. Si el CPU duele: **Freeze** la pista.

## Biblioteca de presets

Panel **Biblioteca**:

| Acción | Uso |
|--------|-----|
| **Guardar** | Snapshot del VST de la pista actual |
| **Probar** | Audition corto (~2 compases) |
| **Aplicar** | Carga el preset en la pista |
| **Proyecto / Global** | Scope |
| **Promover a global** | Reutilizar entre canciones |

La IA puede usar `presetId` / `library.preset.apply` — **mejor que** pelear parámetros a ciegas.

## Editor de plugin y crashes

- La UI nativa corre **fuera de proceso** (otra instancia editor).
- Si un VST crashea: cuarentena + el DAW sigue vivo.
- Ajustes → limpiar cuarentena cuando hayas actualizado el plugin.
- Tras restart del host, JasWave reintenta cargar slots; si algo queda mudo, reinserta o reabre el proyecto.

## Checklist “¿por qué no suena el VST?”

1. Caption: ¿`host listo` o `MISSING` / error?
2. ¿Bypass activado?
3. ¿Preset cargado (DecentSampler)?
4. ¿MIDI llega a esa pista (entrada / clip)?
5. ¿Fader / mute / solo?
6. ¿Device ASIO correcto y no en otra app?

Siguiente: [08 · Asistente Jas y prompts](./08-asistente-y-prompts.md).
