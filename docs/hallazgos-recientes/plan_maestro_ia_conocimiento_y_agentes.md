# Plan Maestro Definitivo JasWave DAW: Voice-to-MIDI, Suite de 6 Plugins VST3/WASM Independientes, Ecosistema de Agentes y Control de FX Chain

> **Consensuado, Profundizado y Blindado mediante la sesión `/grill-me`**.

---

## 1. Decisiones Arquitectónicas Consolidadas

### 1.1. Grabación de Notas de Voz en el Chat (Estilo WhatsApp) y Voice-to-MIDI por DSP
La IA opera como un **modelo de razonamiento de producción asistido por herramientas analíticas DSP deterministas** (no como un generador de audio opaco):

```mermaid
graph TD
    UserVoice[Usuario: Nota de voz tipo WhatsApp / Arrastrar Audio / @mención de clip] --> ChatUI[Chat Asistente: Input Text + Tarjeta Rica de Audio]
    
    ChatUI --> DualFlow{Flujo de Ejecución}
    DualFlow -->|Prompt Conversacional| AIEngine[Coproductor IA: Razonamiento + Mapeo de Compases]
    DualFlow -->|Acción Rápida 1-Clic| QuickAction[Botones: A Batería / A Melodía / AudioLens / Insertar Clip]
    
    AIEngine --> DSPTools[Motor DSP: analysis.voiceToMelody & analysis.voiceToDrums]
    QuickAction --> DSPTools
    
    subgraph DSPAnalysis [Extracción de Parámetros por Audio Lens]
        DSPTools --> PitchTrack[Pitch Tracking f0: YIN + Ajuste inteligente a Escala del Proyecto]
        DSPTools --> TransientTrack[Detección de Transitorios: Bombo, Caja, Charles al Tempo]
    end
    
    DSPAnalysis --> FXInspector[Inspección de Pista: Lectura de Plugins y FX Chain Actual]
    FXInspector --> SpecialistAction[Especialista IA: Añade/Quita FX según necesidad con plugin.insert/remove]
    SpecialistAction --> Routing[Enrutamiento Inteligente: Pista seleccionada o Creación Automática]
    Routing --> TimelineClip[Clip MIDI Cuantizado insertado en el Timeline del DAW]
```

#### Especificación Detallada de la Interacción:
1. **Entrada de Voz Estilo WhatsApp en la Barra de Chat**:
   - Botón de micrófono reactivo en la barra del input del chat.
   - Grabación con cronómetro en segundos, visualizador de forma de onda en tiempo real y cancelación o envío directo.
   - Posibilidad de enviar la nota de voz sola o acompañada de un **input de texto libre** (ej. *"hazme un solo de guitarra eléctrica con esta melodía e insértalo en el compás 16 al 24"*).
   - Soporte para **arrastrar y soltar (drag & drop)** cualquier archivo de audio dentro del área de chat.
   - Soporte para autocompletar menciones de clips existentes escribiendo `@clip:NombreClip`.

2. **Flujo Dual Amplio (Conversacional + Acciones Rápidas)**:
   - **Tarjeta interactiva de audio**: Muestra reproductor Play/Pausa, visualización waveform, duración y opciones rápidas:
     - **`Convertir a Melodía`**: Permite elegir instrumento destino (Guitarra, Piano, Bajo, Sintetizador, Cuerdas), cuantización (sin cuantizar, 1/16, 1/8, 1/4) y compás de inserción.
     - **`Convertir a Batería`**: Extrae bombos, cajas y charles alineados al tempo del proyecto mediante `analysis.voiceToDrums`.
     - **`Analizar AudioLens`**: Extrae tonalidad, progresión de acordes, tempo y descripción musical detallada.
     - **`Insertar como Clip de Audio`**: Inserta la muestra original como clip de audio en la pista correspondiente.
   - **Flujo Conversacional por IA**: Si el usuario simplemente redacta su instrucción junto a la nota de voz, el Coproductor IA o el especialista mencionado (`@guitarrista`, `@baterista`, etc.) invoca la herramienta DSP adecuada, analiza la pista y ejecuta la creación sin fricción.

3. **Algoritmo DSP de Pitch Tracking ($f_0$) con Ajuste a Escala (`analysis.voiceToMelody`)**:
   - Implementado en TypeScript puro en `@jaswave/shared/src/audio/pitch-tracking.ts` (0 dependencias externas, 100% compatible con Electron y Web/Render, testea en Vitest a 60 fps).
   - Detección precisa de tono fundamental ($f_0$) mediante algoritmo YIN / autocorrelación normalizada.
   - **Ajuste inteligente con escala**: Centra la frecuencia al semitono afinado más cercano (12-TET) y, si el proyecto tiene tonalidad definida (ej. Re Menor), pondera la escala para corregir las notas desafinadas del canto o tarareo sin perder la intención melódica.
   - Fusión de notas consecutivas y eliminación de ruido no fonético/respiraciones.

4. **Enrutamiento Inteligente en el Timeline**:
   - Si el usuario tiene una pista de instrumento seleccionada en el DAW, el clip MIDI generado se inserta en esa pista.
   - Si no hay pista seleccionada o la seleccionada es de audio o master, se crea automáticamente una nueva pista de instrumento con el nombre y color representativo del instrumento solicitado.

---

### 1.2. Gobernabilidad de Plugins y Gestión de FX Chain por Especialistas IA
El usuario definió que los especialistas de la IA deben tener **visibilidad y control total sobre los plugins y efectos**:
- **Inspección de Cadena**: Los especialistas leen los plugins activos en la pista (`plugins=[...]`).
- **Mutación Dinámica**: Capacidad de insertar los efectos necesarios (`plugin.insert`), retirar los innecesarios (`plugin.remove`), conmutar bypass (`plugin.bypass`) y calibrar parámetros canónicos (`plugin.setParameter`).
- **Criterio de Especialista**:
  - `@guitarrista`: Verifica la presencia de simulador de amplificador, saturación o delay; inserta o ajusta la cadena si falta.
  - `@baterista`: Ajusta compresión y ecualización de pegada; retira reverberaciones excesivas en bajas frecuencias.
  - `@bajista`: Controla corte de agudos y compresión de graves.
  - `@director` / `@mezcla`: Valida el headroom y balance general.

---

### 1.3. Suite de 6 Plugins de Instrumentos Independientes (VST3 en Desktop + WASM en Web)
Cada instrumento es su propio paquete y plugin individual e independiente (no compartido), con estética cyber/futurista JasWave, **100% compatible con cualquier DAW VST3 (REAPER, Cubase)** y con réplica WebAssembly:

| Plugin Independiente | Tipo de Instrumento | Arquitectura de Sonido | Parámetros Expuestos para la IA | Compatibilidad |
|---|---|---|---|---|
| **`JasWave Grand Piano`** | Piano de cola acústico de concierto | Motor híbrido: modelado de resonancia de cuerdas y tabla armónica + muestras esenciales | `attack`, `decay`, `release`, `velocity_curve`, `brightness`, `reverb_send` | VST3 64-bit + WASM / AudioWorklet |
| **`JasWave Worship Drums`** | Batería acústica completa (kick, snare, toms, hi-hat, ride, crash) | Síntesis modal física de parches + transitorios muestreados con afinación por cuerpo | `kick_tune`, `snare_snap`, `toms_damp`, `overhead_air`, `room_blend` | VST3 64-bit + WASM / AudioWorklet |
| **`JasWave Electric Bass`** | Bajo eléctrico Precision / Jazz | Modelado físico de cuerda pulsada (Karplus-Strong extendido) con simulador de pastilla y drive | `tone`, `finger_attack`, `drive`, `low_boost`, `compressor_mix` | VST3 64-bit + WASM / AudioWorklet |
| **`JasWave Electric Guitar`** | Guitarra eléctrica (leads, solos, acordes) | Modelado de cuerda vibrante con módulo de distorsión, emulación de pantalla (cab sim) y delay | `amp_gain`, `cab_sim`, `tone`, `delay_feedback`, `chorus_mix` | VST3 64-bit + WASM / AudioWorklet |
| **`JasWave Shimmer Pad`** | Sintetizador ambiental de texturas y pads | Síntesis sustractiva/wavetable dual con motor de reverberación shimmer y octava superior | `cutoff`, `resonance`, `shimmer_octave`, `shimmer_decay`, `lfo_rate` | VST3 64-bit + WASM / AudioWorklet |
| **`JasWave Strings Section`** | Ensamble orquestal de cuerdas legato | Modelado de cuerda frotada con control continuo de expresión, vibrato y tamaño de sala | `expression`, `vibrato_depth`, `attack_time`, `release_time`, `hall_size` | VST3 64-bit + WASM / AudioWorklet |

---

### 1.4. Ecosistema de Agentes, Base de Conocimientos y Modo Grill-Me
- Comandos en español e inglés: `/aprender` (`/learn`), `/meta` (`/goal`), `/plan`, `/entrevista` (`/grill-me`), `/programar` (`/schedule`).
- Base de Conocimientos Markdown (`.md`) híbrida con recuperación bajo demanda y control RBAC (`Owner`, `Editor`, `Viewer`).
- Modo de aclaración interactivo con tarjetas de selección en el chat.

---

### 1.5. Estado Sincronizado, Versionado y Eliminación de VST2
- **Offline-First**: Cola local persistente con reconciliación vectorial.
- **Resolución Híbrida**: 3-way merge en MIDI + *Take Lanes* en audio.
- **Eliminación Total de VST2**: Retiro de `vst2_slot.*` en `native/plugin-host`; enfoque exclusivo en **VST3 64-bit**.
- **Waveforms de 0 ms**: Cache embebida en proyecto `.jaswave` y archivos `.peak`.

---

## 2. Hoja de Ruta de Ejecución Secuenciada

> Estado verificado el 2026-10-26: `npm run verify` y `npm run build` en verde. Las casillas marcadas tienen código y tests; lo que depende de oír el resultado en el DAW sigue abierto.

1. **Fase 3 (Voz→MIDI y agentes)**:
   - [x] DSP de Pitch Tracking f0 con ajuste cíclico a escala (`shared/src/audio/pitch-tracking.ts`, con tests).
   - [x] Comandos `analysis.voiceToMelody`, `voiceToDrums` y `analysis.extractMidi` con undo, registrados en el catálogo del agente.
   - [x] Notas de voz tipo WhatsApp en `audio-sample-recorder.tsx` y `coproducer-panel.tsx` (remuestreo real a 22 050 Hz, cancelación, limpieza).
   - [x] Drag & drop de audio sobre toda el área del chat y menciones `@clip:` (prueba manual en la app pendiente).
   - [x] FX chain por especialistas: `plugin.insert/remove/bypass/setParameter` con undo exacto; existen `@guitarrista`, `@baterista`, `@bajista`, `@pianista`, `@director`, `@mezcla`.
   - [ ] Botón «Insertar como Clip de Audio»: sigue siendo un stub.
   - [ ] Prueba funcional en caliente con micrófono real.

2. **Fase 4 (6 plugins independientes VST3 + web)**:
   - [x] Seis paquetes en `plugins/` con manifiestos, parámetros para la IA, réplica AudioWorklet y botón RESET.
   - [x] Validator de Steinberg 47/47 y tests de render por plugin.
   - [ ] Calidad sonora: el usuario los oye artificiales; en curso la versión con samples libres (CC0 / CC-BY con créditos).

3. **Fase 1 y 2 (motor C++ y waveforms)**:
   - [x] VST2 retirado (ADR-0019); solo VST3 64-bit.
   - [x] `.peak` versionado con firma del audio de origen.
   - [x] Host nativo: corrección de corrupción de memoria al reconfigurar buses, cierre limpio (código 0) y relevo del host sin carreras (este último pendiente de reiniciar la app para probarlo).
   - [ ] «Buffer elástico» del Named Pipe: hoy es solo `highWaterMark`.

4. **Fase 5 y 6 (comandos, conocimiento, sync)**:
   - [x] `/aprender`, `/meta`, `/plan`, `/entrevista`, `/programar` (planificador real) y RBAC de `.md`.
   - [x] Sync con reconciliación vectorial (`shared/src/sync`, tests de convergencia).
   - [ ] El rol de sala no se conecta aún al RBAC; falta la presencia estilo Figma en la UI.

5. **Fase 7 (verificación)**:
   - [x] `npm run verify` y `npm run build` en verde.
   - [ ] Certificación auditiva de la canción worship en el DAW.
