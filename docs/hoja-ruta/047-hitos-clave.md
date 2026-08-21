# Hitos Clave

## Objetivo
Definir los hitos de verificación del proyecto: puntos de control donde se evalúa el progreso y se decide si continuar, ajustar o pivotar.

## Hito 1: Arquitectura (Fin Fase 0)

**Fecha objetivo**: Semana 3

**Descripción**: Documentación arquitectónica completa + núcleo funcional en tests.

**Criterios de verificación**:
- [ ] Todos los documentos de arquitectura creados y revisados.
- [ ] Event Bus implementado y con tests passing.
- [ ] State Model implementado y serializable.
- [ ] Command System con undo/redo funcional.
- [ ] Validation Layer con pipeline completa.
- [ ] AI Provider abstraction + Ollama adapter.
- [ ] Context Manager niveles 1-3.
- [ ] Tool Registry con prompt fragment.
- [ ] Permissions con matriz default.
- [ ] Cobertura de tests > 80% en módulos core.

**Entregable**: Repositorio con núcleo funcional y documentación completa.

---

## Hito 2: MVP (Fin Fase 1)

**Fecha objetivo**: Semana 9

**Descripción**: Aplicación Electron ejecutable con DAW funcional básico.

**Criterios de verificación**:
- [ ] Proyectos: crear, guardar, cargar, cerrar.
- [ ] Transporte: play, pause, stop, seek.
- [ ] Tracks: CRUD de tracks básico.
- [ ] Clips: crear, mover, redimensionar, eliminar.
- [ ] Mixer: volumen, panorámica, mute, solo.
- [ ] Timeline: visual básica con playhead.
- [ ] Command Palette funcional.
- [ ] Undo/Redo para todas las operaciones.
- [ ] IA básica con herramientas de lectura.
- [ ] Electron app empaquetada y ejecutable.

**Entregable**: DAW ejecutable con funciones básicas.

---

## Hito 3: Audio Real (Fin Fase 2)

**Fecha objetivo**: Semana 13

**Descripción**: Reproducción y grabación de audio real con análisis y efectos.

**Criterios de verificación**:
- [ ] Motor de audio en C++ funcional.
- [ ] Reproducción sin clicks ni glitches.
- [ ] Grabación crea clips en tracks armadas.
- [ ] Análisis: peak, RMS, LUFS, espectro.
- [ ] FX chains con plugins de efecto.
- [ ] Routing básico (sends, buses).
- [ ] Metrónomo sincronizado.
- [ ] Latencia < 20ms en configuraciones medias.

**Entregable**: Reproducción y grabación de audio real.

---

## Hito 4: IA Colaborativa (Fin Fase 3)

**Fecha objetivo**: Semana 17

**Descripción**: IA que ejecuta operaciones complejas de forma segura y recuerda preferencias.

**Criterios de verificación**:
- [ ] Context Manager niveles 4-5.
- [ ] Memory Manager con consolidación y decaimiento.
- [ ] Planner para secuencias complejas.
- [ ] Transacciones atómicas con rollback.
- [ ] Validación AI avanzada.
- [ ] Dry run funcional.
- [ ] Sugerencias proactivas activas.
- [ ] IA puede ejecutar operaciones write con confirmación.

**Entregable**: IA colaboradora musical funcional.

---

## Hito 5: Producto (Fin Fase 4)

**Fecha objetivo**: Semana 24

**Descripción**: DAW usable para producción musical profesional.

**Criterios de verificación**:
- [ ] Edición MIDI con piano roll.
- [ ] Instrumentos virtuales VST3.
- [ ] Automatización completa.
- [ ] Render/exportación a WAV, FLAC, MP3.
- [ ] Sistema de plugins completo.
- [ ] Presets guardados y cargados.
- [ ] Macros y scripting.
- [ ] UI pulida con themes y layouts.
- [ ] Cobertura de tests > 80%.
- [ ] Sin crashes en sesiones de 4+ horas.

**Entregable**: DAW completo usable para producción profesional.

---

## Proceso de Revisión

- Cada hito se revisa en reunión de equipo.
- Si no se cumplen los criterios, se ajusta el roadmap.
- Los hitos son flexibles: se pueden renegociar fechas, no scope.
