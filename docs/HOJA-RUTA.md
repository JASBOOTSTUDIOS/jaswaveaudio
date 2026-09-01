# Roadmap de Jaswave

## Visión

Construir un DAW AI-First donde la inteligencia artificial no sea un complemento, sino una capa integral que comprende, analiza y colabora en el proceso de producción musical.

Checklist de huecos para producción real: [`docs/CHECKLIST-PRODUCTO.md`](CHECKLIST-PRODUCTO.md).

> **Reconciliación 2026-08-28:** el criterio de producto 1.0 es el checklist (canción + bounce), no esta hoja entera. Muchos ítems de Fase 2–4 ya están en el app híbrido (plugin-host) aunque los checkboxes históricos abajo sigan `[ ]`. No reabrir trabajo solo para marcarlos; ver checklist y `_audit-matrix-cierre.md`.

## Fases del Proyecto

### Fase 0: Cimientos (Semana 1-3)

**Objetivo**: Establecer la arquitectura base, la documentación completa y los módulos core sin los cuales nada más puede construirse.

**Entregable de Fase**: Documentación arquitectónica completa + núcleo funcional en tests.

- [x] **Event Bus** [docs/hoja-ruta/001-event-bus.md]
  - EventBus tipado, con subscriptions y schemas versionados
  - Criterio: Los eventos se emiten y consumen correctamente

- [x] **State Model** [docs/hoja-ruta/002-state-model.md]
  - DAWState centralizado, serializable, con interfaces TypeScript estrictas
  - Criterio: El estado se puede serializar/deserializar sin pérdida

- [x] **Command System** [docs/hoja-ruta/003-command-system.md]
  - Registry, executor, undo/redo stack
  - Criterio: Los comandos se ejecutan, deshacen y rehacen correctamente

- [x] **Validation Layer** [docs/hoja-ruta/004-validation-layer.md]
  - Pipeline de validación (schema, permisos, dominio)
  - Criterio: Las acciones inválidas son rechazadas antes de ejecutarse

- [x] **AI Provider** [docs/hoja-ruta/005-ai-provider.md]
  - Interfaz AIProvider + adapter Ollama
  - Criterio: Se puede enviar un mensaje a un modelo local

- [x] **Context Manager** [docs/hoja-ruta/006-context-manager.md]
  - Niveles 1-3 (inmediato, proyecto, eventos recientes)
  - Criterio: La IA recibe contexto relevante del proyecto

- [x] **Tool Registry** [docs/hoja-ruta/007-tool-registry.md]
  - Registro dinámico de herramientas + generación de prompt fragment
  - Criterio: Las herramientas se describen correctamente al modelo

- [x] **Permissions** [docs/hoja-ruta/008-permissions.md]
  - Matriz de permisos por nivel de autonomía
  - Criterio: Las herramientas se bloquean según el nivel del usuario

---

### Fase 1: MVP Funcional (Semana 4-9)

**Objetivo**: Un DAW funcional básico que permite crear proyectos, grabar/editar audio básico y mezclar, con IA capaz de leer y sugerir.

**Entregable de Fase**: Aplicación Electron ejecutable con DAW funcional básico.

- [x] **Proyectos** [docs/hoja-ruta/009-proyectos.md]
  - Crear, guardar, cargar, cerrar proyectos
  - Criterio: Los proyectos persisten correctamente
  - Notas MVP: open vía `project.load`; diálogo guardar/descartar/cancelar al cerrar sucio

- [x] **Transporte** [docs/hoja-ruta/010-transporte.md]
  - Play, pause, stop, seek, loop
  - Criterio: El transporte controla la timeline
  - Notas MVP: record flag UI (captura de entrada → Fase 2)

- [x] **Tracks** [docs/hoja-ruta/011-tracks.md]
  - CRUD de tracks (audio, MIDI, instrumento, bus, folder)
  - Criterio: Se pueden crear y gestionar tracks

- [x] **Clips** [docs/hoja-ruta/012-clips.md]
  - Crear, mover, redimensionar, dividir, eliminar clips de audio
  - Criterio: Los clips se comportan correctamente en la timeline
  - Notas MVP: `clip.resize`, move cross-track, waveform LOD

- [x] **Mixer** [docs/hoja-ruta/013-mixer.md]
  - Volumen, panorámica, mute, solo por track
  - Criterio: El mixer refleja y controla el estado de los tracks

- [x] **Timeline** [docs/hoja-ruta/014-timeline.md]
  - Timeline visual con clips y playhead
  - Criterio: La timeline se actualiza en tiempo real

- [x] **Command Palette** [docs/hoja-ruta/015-command-palette.md]
  - Búsqueda y ejecución de comandos
  - Criterio: Se accede con Ctrl+Shift+P

- [x] **Undo/Redo** [docs/hoja-ruta/016-undo-redo.md]
  - Pila funcional para todas las operaciones
  - Criterio: Se puede deshacer/rehacer cualquier acción

- [x] **IA Básica** [docs/hoja-ruta/017-ia-basica.md]
  - Chat con herramientas de lectura (getState, getTracks, etc.)
  - Criterio: La IA puede responder preguntas sobre el proyecto
  - Notas MVP: CoProducer solo lectura + Ollama opcional; mutaciones vía Actions/Palette

---

### Fase 2: Audio Real (Semana 10-13)

**Objetivo**: Reemplazar la simulación de audio por un motor de audio nativo real con reproducción, efectos y análisis.

**Entregable de Fase**: Reproducción y grabación de audio real con análisis y efectos.

- [ ] **Motor de Audio** [docs/hoja-ruta/018-motor-audio.md]
  - Motor en C++ con audio thread dedicado
  - Criterio: Reproducción sin clicks ni glitches

- [ ] **Audio I/O** [docs/hoja-ruta/019-audio-io.md]
  - Entrada/salida con selección de dispositivo
  - Criterio: Se puede grabar y reproducir por la interfaz del sistema

- [ ] **DSP Básico** [docs/hoja-ruta/020-dsp-basico.md]
  - Procesamiento de audio en tiempo real
  - Criterio: Ganancia, paneo, clip gain

- [ ] **FX Chains** [docs/hoja-ruta/021-fx-chains.md]
  - Cadena de efectos por track/insert/send
  - Criterio: Los plugins de efecto procesan el audio

- [ ] **Análisis** [docs/hoja-ruta/022-analisis.md]
  - Peak, RMS, LUFS, espectro
  - Criterio: Los valores se actualizan en tiempo real

- [ ] **Routing** [docs/hoja-ruta/023-routing.md]
  - Buses, sends, returns
  - Criterio: El audio se enruta correctamente entre tracks

- [ ] **Metrónomo** [docs/hoja-ruta/024-metronomo.md]
  - Click track con tiempo y compás
  - Criterio: Sincronizado con el transporte

- [ ] **Grabación** [docs/hoja-ruta/025-grabacion.md]
  - Grabar audio en clips
  - Criterio: La grabación crea clips en el track armado

---

### Fase 3: IA Profunda (Semana 14-17)

**Objetivo**: La IA se convierte en un colaborador musical proactivo, no solo un asistente de consulta.

**Entregable de Fase**: IA que puede ejecutar operaciones complejas de forma segura y recordar preferencias.

- [ ] **Context Manager Avanzado** [docs/hoja-ruta/026-context-manager-avanzado.md]
  - Niveles 4-5 (memoria de sesión y persistente)
  - Criterio: La IA recuerda preferencias y decisiones

- [ ] **Planner** [docs/hoja-ruta/027-planner.md]
  - Planificación de secuencias complejas de herramientas
  - Criterio: La IA ejecuta operaciones multi-paso atómicamente

- [ ] **Transacciones** [docs/hoja-ruta/028-transacciones.md]
  - TransactionManager con rollback
  - Criterio: Las operaciones complejas son atómicas

- [ ] **Validación AI** [docs/hoja-ruta/029-validacion-ai.md]
  - Detección de complejidad excesiva, relevancia de herramientas
  - Criterio: La IA no ejecuta secuencias peligrosas sin confirmación

- [ ] **Dry Run** [docs/hoja-ruta/030-dry-run.md]
  - Preview de cambios sin ejecución
  - Criterio: La IA puede mostrar qué hará antes de commitear

- [ ] **Sugerencias Proactivas** [docs/hoja-ruta/031-sugerencias-proactivas.md]
  - IA sugiere mejoras basadas en el estado
  - Criterio: El usuario recibe sugerencias contextuales

---

### Fase 4: Madurez (Semana 18-24)

**Objetivo**: DAW usable para producción musical real.

**Entregable de Fase**: DAW completo usable para producción musical profesional.

- [x] **Edición MIDI** [docs/hoja-ruta/032-edicion-midi.md]
  - Piano roll + dominio MIDI AI-first (PPQ, expression, grooves, generators, canvas)
  - Criterio: El piano roll funciona para editar MIDI
  - Notas: ver docs/midi-piano-roll-ai.md

- [ ] **Instrumentos virtuales** [docs/hoja-ruta/033-instrumentos-virtuales.md]
  - Carga y ejecución de VST3
  - Criterio: Los instrumentos virtuales se cargan y ejecutan

- [ ] **Automatización** [docs/hoja-ruta/034-automatizacion.md]
  - Curvas de automatización editables
  - Criterio: La automatización se puede crear y editar

- [ ] **Render/exportación** [docs/hoja-ruta/035-render.md]
  - Exportación a WAV, FLAC, MP3
  - Criterio: El renderizado se ejecuta correctamente

- [ ] **Sistema de plugins completo** [docs/hoja-ruta/036-sistema-plugins-completo.md]
  - Escaneo, carga, preset manager
  - Criterio: Los plugins se descubren y cargan dinámicamente

- [ ] **Presets** [docs/hoja-ruta/037-presets.md]
  - Guardar/cargar presets de tracks, plugins, proyectos
  - Criterio: Los presets persisten y se aplican correctamente

- [ ] **Macros** [docs/hoja-ruta/038-macros.md]
  - Definir y ejecutar macros de comandos
  - Criterio: Las macros se pueden grabar y reproducir

- [ ] **Scripting** [docs/hoja-ruta/039-scripting.md]
  - API de scripts sandboxeados
  - Criterio: Los scripts pueden extender el DAW

- [ ] **UI Pulida** [docs/hoja-ruta/040-ui-pulida.md]
  - Themes, layouts guardados, atajos de teclado configurables
  - Criterio: La UI es productiva y agradable

---

### Fase 5: Extensibilidad (Post-MVP)

- [ ] **Sistema de extensiones/plugins del DAW** [docs/hoja-ruta/041-sistema-extensiones.md]
- [ ] **Colaboración en tiempo real (multi-usuario)** [docs/hoja-ruta/042-colaboracion.md]
- [ ] **IA generativa de audio (texto a audio)** [docs/hoja-ruta/043-ia-generativa.md]
- [ ] **Análisis avanzado (separación de stems, detección de tonalidad)** [docs/hoja-ruta/044-analisis-avanzado.md]
- [ ] **Integración con servicios en la nube** [docs/hoja-ruta/045-servicios-nube.md]
- [ ] **Market de presets y plugins** [docs/hoja-ruta/046-marketplace.md]

---

## Hitos Clave

- [x] **H1: Arquitectura** — Fin Fase 0
  - Documentación completa + core funcional
- [ ] **H2: MVP** — Fin Fase 1
  - DAW ejecutable con funciones básicas
- [ ] **H3: Audio Real** — Fin Fase 2
  - Reproducción y grabación real
- [ ] **H4: IA Colaborativa** — Fin Fase 3
  - IA que ejecuta operaciones complejas
- [ ] **H5: Producto** — Fin Fase 4
  - DAW usable para producción

---

## Métricas de Éxito

- [ ] **Rendimiento de audio**: Latencia < 10ms, sin xruns en configuraciones medias
- [ ] **Estabilidad**: Sin crashes en sesiones de 4+ horas
- [ ] **IA**: Respuestas a consultas en < 2s; ejecución de herramientas en < 500ms
- [ ] **UX**: Tareas comunes realizables en < 3 clics
- [ ] **Código**: Cobertura de tests > 80% en módulos core
