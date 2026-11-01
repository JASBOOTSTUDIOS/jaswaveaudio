# Plan Maestro Consolidado: Reparación de VSTs Simultáneos, Jerarquía de Pistas, Vocal-Tune, Piano Interactivo VST, Atajo Global de Play en Paneles Flotantes y Timing de Nanosegundos

## 1. Resumen Ejecutivo y Decisiones Consolidadas

Tras la sesión de alineación interactiva (/grill-me), el plan integra los siguientes **siete pilares de desarrollo**:

1. **VSTs Simultáneos en el Mismo Canal (Layers / Capas de Sonido):**
   - Despacho MIDI en paralelo a todos los instrumentos VST de la misma pista y suma en paralelo de sus salidas de audio antes de pasar a la cadena de efectos (EQ, reverb, compresión).
   - Corrección del descarte de puertos globales (`port < 0`) en el host nativo C++ (`native/plugin-host/src/main.cpp`) y soporte multi-slot en `vst-voice-router.ts` y `midi-lookahead.ts`.
2. **Jerarquía Estricta de Pistas (Carpetas como Buses de Submezcla):**
   - Las carpetas actúan como verdaderos **Buses de Submezcla (Submix)**: todo el audio de las pistas hijas fluye a través del fader, paneo, mute, solo y plugins de inserción de la carpeta madre antes de llegar al Master.
   - **Interacción Drag & Drop:** Arrastre libre con guía visual de sangría/indentación para soltar pistas dentro de una carpeta o desanidarlas hacia la izquierda.
   - **Orden Topológico en C++:** Las pistas hijas se procesan primero, luego sus carpetas padre, y finalmente el Master.
3. **Piano Interactivo en la UI de los VSTs (Ratón + Glissando + Teclado QWERTY + Grabación + IA):**
   - El teclado de 88 notas en la UI de los VSTs (tanto en C++ nativo como en el canvas web) pasa de ser un visor pasivo a un **teclado virtual interactivo completo**.
   - **Ratón y Pantallas Táctiles:** Clic inmediato, arrastre continuo con glissando/slide entre teclas, y modulación dinámica de velocidad según la posición vertical del clic en la tecla (más abajo = más fuerte).
   - **Teclado de PC (QWERTY):** Permite tocar notas con las teclas de la computadora (A-K para blancas, W-U para negras) y cambiar de octava con Z y X.
   - **Integración con Grabación e IA:** Las notas tocadas suenan en vivo en el plugin, se graban en la pista si está armada en modo grabación, y alimentan el búfer de escucha de la IA para demostraciones sin hardware externo.
4. **Atajo Global de Transporte Ininterrumpido en Paneles Flotantes (Barra Espaciadora para Play/Stop):**
   - La barra espaciadora alterna la reproducción (Play/Stop) en **cualquier parte del DAW**, cubriendo exhaustivamente los **tres tipos de paneles flotantes**:
     1. **Ventanas Satélite Desancladas de Electron (Undock):** Ventanas secundarias flotantes del Mixer, Piano Roll o VSTs reenvían el comando `transport.toggle` a través de `BroadcastChannel` (`satellite-channel.ts`) de forma inmediata.
     2. **Ventanas Nativas Win32 de Plugins VST (creadas por `plugin-host.exe`):** Al tener el foco del sistema operativo en una ventana nativa de plugin, el mensaje `WM_KEYDOWN` con `VK_SPACE` es capturado y notificado vía IPC al DAW para alternar Play/Stop sin ser tragado por el plugin.
     3. **Paneles Flotantes y Modales Web (dentro de la ventana principal):** Capturado en fase de captura (`capture: true`) en toda la jerarquía DOM.
   - **Única excepción:** Solo se desactiva cuando el cursor está dentro de un campo de texto editable (específicamente en la caja de texto del chat de la IA o renombrando pistas), permitiendo escribir espacios normalmente.
5. **Control MIDI con Timestamps de Nanosegundos (QPC / hrtime) para MIDI 2.0 y la IA:**
   - Registro de eventos MIDI de entrada en C++ estampados inmediatamente con `QueryPerformanceCounter` (QPC) de Windows en **nanosegundos** (`uint64_t timestampNs`).
   - Mapeo preciso al bloque de audio ASIO/WASAPI para cálculo exacto de muestra (`delaySamples` y jitter reduction sin fluctuaciones).
   - En TypeScript y en el búfer de escucha de la IA: eventos con resolución de nanosegundos (`process.hrtime.bigint()`), permitiendo a la IA analizar micro-timing, flams de percusión y dinámicas ultra rápidas con máxima exactitud.
6. **Nuevo VST de Afinación Vocal Automática Natural (`jaswave-vocal-tune`):**
   - Procesador de afinación automática de **ultra baja latencia** (< 3 ms) optimizado para monitoreo e interpretación en vivo.
   - Afinación transparente que preserva la humanidad de la voz (formantes, vibrato, tolerancia microtonal, detección de sibilancias y visualizador de pitch).
7. **Paridad Total de Parámetros en la UI de los Plugins (Modos Básico / Avanzado):**
   - Exponer el 100% de los parámetros que el motor y la IA conocen en la interfaz gráfica de los plugins.
   - Selector conmutable: **Modo Básico** (perillas esenciales limpias) y **Modo Avanzado/Experto** (despliega todos los controles, switches y modulaciones profundas con estética cyber galáctica).

---

## 2. Diagrama de Flujo: Atajos en Paneles Flotantes y Topología de Audio

```mermaid
graph TD
    subgraph Orígenes del Atajo de Teclado (Barra Espaciadora)
        MainWin[Ventana Principal del DAW / Timeline / Pistas]
        UndockWin[Ventanas Satélite Flotantes Undock<br/>Mixer, Piano Roll, Paneles]
        NativeVstWin[Ventanas Nativas Win32 de Plugins VST<br/>plugin-host.exe HWND]
    end

    subgraph Enrutador de Atajo de Transporte Global
        MainWin -->|keydown capture| CheckInput{¿Foco en input de texto<br/>del chat de la IA?}
        UndockWin -->|BroadcastChannel sync| CheckInput
        NativeVstWin -->|WM_KEYDOWN VK_SPACE -> IPC| CheckInput
        CheckInput -->|Sí| AllowTyping[Escribir espacio en el texto]
        CheckInput -->|No| ExecToggle[tienda.executor.execute('transport.toggle')]
    end

    subgraph Ejecución y Grafo de Audio
        ExecToggle --> AudioPlayhead[Transporte DAW Play / Pause]
        AudioPlayhead --> TopoGraph[Grafo Topológico: Hojas -> Carpetas Submix -> Master]
    end
```

---

## 3. Especificación Técnica por Componente

### Componente 1: Atajo Global de Play en los 3 Tipos de Paneles Flotantes

#### 1.1 Paneles y Ventanas Satélite Undock (Electron)
- En `jas-wave/hooks/use-shortcut-dispatcher.ts`:
  - En ventanas satélite (`isUndockWindow() === true`), el listener de teclado captura `e.code === 'Space'`.
  - Si no está escribiendo en un input de texto, invoca:
    `enviarMensaje({ type: 'command', command: 'transport.toggle', payload: {} })`.
  - La ventana principal recibe el mensaje a través de `BroadcastChannel` en `satellite-channel.ts` y ejecuta el comando en la tienda central, iniciando o pausando la reproducción de forma instantánea.

#### 1.2 Ventanas Nativas Win32 de Plugins VST (`plugin-host.exe`)
- En `plugins/shared-ui/jw_ui_view.cpp` y en el procedimiento de ventana del host:
  - Al recibir `WM_KEYDOWN`:
    ```cpp
    case WM_KEYDOWN: {
        if (wp == VK_SPACE) {
            // Reenviar notificación IPC a JasWave Electron
            jaswave_notify_transport_toggle();
            return 0; // Consumido para evitar beep del sistema
        }
        break;
    }
    ```
  - En `jas-wave/electron/plugin-host-bridge.ts`:
    - Al recibir la notificación `transportToggle`, el proceso principal de Electron la reenvía al renderer o llama al despachador de transporte para alternar la reproducción.

#### 1.3 Paneles y Modales Web en la Ventana Principal
- `window.addEventListener('keydown', handler, true)` (fase de captura prioritaria).
- Se evalúa si el elemento activo es un `<input>` o `<textarea>` dentro de un contenedor marcado con `[data-shortcut-scope="ignore"]` o en el panel de chat de la IA (`[data-coproducer-chat]`). Si es así, se deja pasar la tecla para escribir el carácter de espacio. En cualquier otro caso, se previene el comportamiento por defecto y se ejecuta `transport.toggle`.

---

### Componente 2: Piano Interactivo en la UI de los VSTs

- **Hit-Testing y Dinámica de Velocidad (TypeScript / Canvas Web y C++ Nativo):**
  - Hit-test de 88 notas (A0 a C8, pitch 21 a 108), evaluando primero teclas negras y luego blancas.
  - Velocidad vertical dinámica: `velocity = Math.round(50 + relY * 77);` (arriba = suave, abajo = forte).
  - Glissando/Slide al arrastrar con el ratón por el teclado.
  - Teclado QWERTY del PC: Teclas blancas `A-K`, teclas negras `W-U`, octavas arriba/abajo con `Z` y `X`.
  - Salida triple simultánea: Audio directo en el VST (latencia cero), grabación en la pista activa si está armada, y alimentación del búfer de la IA para análisis musical.

---

### Componente 3: VSTs Simultáneos en el Mismo Canal (Layers)

- **Despacho Concurrente:** `resolveAllTrackSlotIds` recopila todos los slots de instrumentos de la pista y despacha `noteOn`/`noteOff` concurrentemente a cada uno.
- **Reproducción Lookahead:** `vstInstrumentSlotIds: string[]` en `midi-lookahead.ts`.
- **Corrección de Puerto en C++:** `if (port >= 0 && port != static_cast<int>(e.port)) continue;`, permitiendo que `port = -1` (Omni/All) distribuya notas a todos los destinos.
- **Suma de Audio en C++:** Suma en paralelo de todos los slots de instrumentos a `gChainL/R` antes del primer slot de efectos de la pista.

---

### Componente 4: Jerarquía Estricta de Carpetas y Ruteo Drag & Drop

- **Orden Topológico en C++:** Los stems con `tr.parentStem != 0xFFFF` acumulan su señal post-fader en `gStemAccL/R[parentStem]`. La carpeta padre procesa sus efectos sobre esa suma y la dirige al Master.
- **Herencia de Mute / Solo:** Mute en el padre silencia a todas las hijas; Solo en una hija activa el padre en modo *solo-safe*.
- **Drag & Drop con Sangría:** En `track-header.tsx`, guía visual de sangría/indentación para emparentar con `track.update` (`padreId`) o desanidar al arrastrar a la izquierda.

---

### Componente 5: Timing Híbrido a Nivel de Nanosegundos (QPC / hrtime)

- Captura con `QueryPerformanceCounter` en nanosegundos (`uint64_t timestampNs`).
- Cálculo de `delaySamples` sin fluctuaciones respecto al bloque ASIO/WASAPI.
- Búfer de eventos en TypeScript con `process.hrtime.bigint()` para análisis de micro-timing de la IA.

---

### Componente 6: Nuevo VST de Afinación Vocal Automática Natural (`jaswave-vocal-tune`)

- DSP C++ VST3 de ultra baja latencia (< 3 ms) basado en YIN/MPM y PSOLA.
- Parámetros: *Retune Speed, Humanize, Vibrato Preserve, Formant Shift, Throat Length, Tracking Sensitivity, Scale & Root, Mix Dry/Wet, Low Latency Mode* y curva visual de pitch.

---

### Componente 7: Paridad Total de Parámetros en la UI de Plugins (Modos Básico / Avanzado)

- Selector `[ Básico | Avanzado ]` en la barra superior.
- Modo Avanzado expone el 100% de los parámetros controlables por la IA con controles interactivos en estética cyber galáctica.

---

## 4. Plan de Archivos a Modificar / Crear

| Operación | Archivo | Descripción |
|---|---|---|
| **[MODIFY]** | `jas-wave/hooks/use-shortcut-dispatcher.ts` | Barra espaciadora global para Play/Stop en todas las ventanas y paneles (excepto caja de texto de IA). |
| **[MODIFY]** | `jas-wave/src/workspace/satellite-channel.ts` | Reenvío de comando de transporte desde ventanas satélite undock a la ventana principal. |
| **[MODIFY]** | `plugins/shared-ui/jw_ui_view.cpp` | Captura de `VK_SPACE` en ventanas Win32 nativas de plugins y notificación IPC al DAW. |
| **[MODIFY]** | `jas-wave/electron/plugin-host-bridge.ts` | Puente de notificación IPC de transporte desde `plugin-host` a la ventana de Electron. |
| **[MODIFY]** | `plugins/shared-ui/jw_ui_plantilla.h` | Hit-test de 88 teclas, dinámica de velocidad vertical, glissando y soporte QWERTY en el teclado VST nativo. |
| **[MODIFY]** | `plugins/lib/ui-cyber/src/editor.ts` | Clic, arrastre glissando y atajos QWERTY con feedback sonoro en el editor web. |
| **[MODIFY]** | `plugins/lib/ui-cyber/src/dibujo.ts` | Iluminación de tecla pulsada en tiempo real al tocar con ratón o QWERTY. |
| **[MODIFY]** | `native/plugin-host/src/main.cpp` | Timestamps de nanosegundos (QPC), corrección de puerto `port < 0`, capas VST simultáneas y suma jerárquica `parentStem`. |
| **[MODIFY]** | `jas-wave/src/lib/plugin/vst-voice-router.ts` | Despacho concurrente de MIDI a todos los instrumentos de la pista (`resolveAllTrackSlotIds`). |
| **[MODIFY]** | `jas-wave/lib/midi-lookahead.ts` | Array `vstInstrumentSlotIds` para reproducción concurrente de clips. |
| **[MODIFY]** | `jas-wave/lib/audio-engine.ts` | Conexión de slots completos a `midiLookahead`. |
| **[MODIFY]** | `jas-wave/src/lib/plugin/track-vst-runtime.ts` | Sincronización del grafo con `parentStem` y herencia de mute/solo. |
| **[MODIFY]** | `jas-wave/components/track-header.tsx` | Drag & Drop visual con guía de sangría para carpetas. |
| **[NEW]** | `plugins/com.jaswave.plugin.vocal-tune/` | Código fuente del nuevo VST de afinación vocal automática natural (DSP C++, CMake, Worklet web y UI). |
| **[MODIFY]** | `plugins/lib/ui-cyber/src/editor.ts` | Conmutador Básico / Avanzado para exponer el 100% de los parámetros en la UI. |
| **[MODIFY]** | `jas-wave/src/lib/agent-action-catalog.ts` | Registro de nuevas acciones de jerarquía y afinación vocal para la IA. |
| **[MODIFY]** | `jas-wave/src/lib/ai-daw-agent.ts` | Patrones y ejecutores para afinación vocal, capas y carpetas. |
| **[NEW]** | `jas-wave/src/lib/plugin/vst-interactive-keyboard.test.ts` | Tests unitarios para el teclado interactivo, glissando y atajos de transporte en paneles flotantes. |

---

## 5. Plan de Verificación

1. **Test de Barra Espaciadora en Paneles Flotantes:**
   - Desanclar el Mixer o Piano Roll en una ventana satélite flotante de Electron: presionar la barra espaciadora alterna Play/Stop.
   - Abrir la ventana nativa Win32 de un VST flotante: presionar la barra espaciadora alterna Play/Stop.
   - Hacer clic en la caja de texto del chat de la IA y presionar la barra espaciadora: escribe un espacio en el texto y no afecta al transporte.
2. **Test del Piano Interactivo VST:**
   - Hacer clic en teclas del piano: sonido inmediato con velocidad según la altura del clic.
   - Arrastrar el ratón: glissando continuo sin notas pegadas.
   - Presionar teclas QWERTY (A-K): tocan notas y cambian de octava con Z/X.
   - Grabar en pista armada: captura notas en el clip MIDI.
3. **Test de Layers VST:**
   - Pista con Piano VST + Pad VST: ambos suenan simultáneamente en perfecta sincronía.
4. **Test de Jerarquía y Carpetas Submix:**
   - Pistas hijas fluyen por los efectos de la carpeta padre y mutear la carpeta silencia a las hijas.
5. **Test del VST Vocal-Tune:**
   - Afinación automática transparente en tiempo real (< 3 ms) y preservación de formantes.
6. **Verificación Global:**
   - Ejecutar `npm run verify` (`shared`, `ai-harness`, `jas-wave`).
