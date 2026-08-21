# Resumen Arquitectónico de Jaswave

## 1. Visión General

Jaswave es una **Estación de Trabajo de Audio Digital (DAW) AI-First**. El estado interno del DAW es la única fuente de verdad; la interfaz gráfica es solo una proyección visual de ese estado. La IA interactúa con el DAW exclusivamente a través de una capa de herramientas estructurada, nunca mediante observación de la UI.

## 2. Decisiones Tomadas

### 2.1 Arquitectura General
- **Topología en tres capas**: Electron (UI + lógica de dominio) ↔ AI Harness ↔ Motor de audio nativo (C++).
- **Event Bus como sistema nervioso**: Todos los cambios de estado emiten eventos tipados. Los consumidores nunca hacen polling.
- **Command System como único camino de mutación**: UI, teclado, macros, scripts e IA ejecutan todas las operaciones a través del mismo sistema.
- **Undo/Redo unificado**: El usuario y la IA comparten la misma pila de deshacer/rehacer. No hay sistemas separados.
- **Estado serializable**: Todo el estado del proyecto (excepto buffers de audio) se puede serializar a JSON para consultas de IA y persistencia.

### 2.2 AI Harness
- **Proveedor abstracto**: Interfaz `AIProvider` independiente del modelo. Se puede cambiar entre Ollama, OpenAI, Anthropic, etc. sin modificar el núcleo.
- **Context Manager de 5 niveles**: Inmediato, proyecto, eventos recientes, memoria de sesión, memoria persistente.
- **Memory Manager con 4 alcances**: Corto plazo, sesión, largo plazo, proyecto.
- **Tool System**: Toda acción del usuario es representable como herramienta. Las herramientas tienen esquemas, validación, permisos y niveles de riesgo.
- **Permisos por niveles**: READ_ONLY, SUGGEST, CONFIRM, AUTO_EXECUTE_SAFE, FULL_AUTONOMY.

### 2.3 Audio y Threading
- **Thread de audio prioritario**: Nunca bloquea, nunca asigna memoria dinámicamente, nunca llama al LLM.
- **Aislamiento del Renderer**: El proceso de Renderer de Electron no tiene acceso directo al sistema de archivos, motor de audio o proveedor de IA.
- **Puente nativo**: Interfaz clara entre Electron y el motor de audio futuro.

### 2.4 UI
- **Inspiración en VS Code y REAPER**: Paneles acoplables, barra de actividad, palette de comandos, mixer, timeline. No copia visual, solo conceptos de UX.
- **IPC tipado**: Comunicación entre Main y Renderer mediante IPC tipado.

## 3. Decisiones que Requieren Aprobación del Usuario

| Decisión | Opciones | Recomendación |
|-----------|----------|---------------|
| **Motor de audio** | C++ (JUCE), C++, o wrapper sobre motor existente | C++ para MVP por seguridad de memoria y facilidad de integración con Electron via FFI |
| **Modelo local por defecto** | Ollama + Llama 3, Ollama + Qwen 2.5, Gemma 2 nativo | Ollama + Llama 3 8B por equilibrio rendimiento/herramientas |
| **Framework UI** | React + CSS puro, React + Tailwind, React + Material UI | React + CSS Modules para máximo control y rendimiento |
| **Base de datos para memoria** | IndexedDB, SQLite (better-sqlite3), archivos JSON | SQLite para MVP por consultas avanzadas; IndexedDB como alternativa web |
| **Formato de proyecto** | JSON plano, SQLite, formato binario custom | JSON plano para MVP; SQLite para proyectos grandes |
| **Soporte de plugins** | VST3, AU, LV2, todos | VST3 primero por amplia adopción en Windows/Mac |
| **Estrategia de testing** | Jest, Vitest, Playwright | Vitest para unitario/integración; Playwright para E2E UI |

## 4. Riesgos Principales

| Riesgo | Probabilidad | Impacto | Mitigación |
|---------|--------------|---------|------------|
| **Bloqueo del audio thread por IA** | Alta | Crítico | Aislamiento estricto de procesos; nunca llamadas al LLM desde el audio thread |
| **Latencia del modelo local** | Media | Alto | Cache de respuestas; streaming; timeouts agresivos; fallback a modelo más pequeño |
| **Complejidad del estado** | Media | Alto | Inmutabilidad lógica; structural sharing; serialización estricta |
| **Seguridad de plugins** | Media | Crítico | Sandboxing; validación de parámetros; lista blanca de operaciones |
| **Fragmentación de proveedores de IA** | Baja | Medio | Capa de abstracción robusta; pruebas por proveedor |
| **Rendimiento de la UI con muchos tracks** | Media | Medio | Virtualización; canvas para waveforms; Web Workers para análisis |
| **Curva de aprendizaje** | Alta | Medio | Documentación exhaustiva; tooltips contextuales; modo guiado |

## 5. MVP Recomendado por Fases

### Fase 0: Cimientos (2-3 semanas)
**Objetivo**: Estructura del proyecto, arquitectura base y documentación completa.

- [x] Estructura de carpetas y módulos
- [x] Documentación arquitectónica completa
- [x] Event Bus funcional
- [x] Command System básico
- [x] Modelo de estado centralizado
- [x] AI Provider abstraction + Ollama adapter
- [x] Context Manager niveles 1-3
- [x] Tool Registry básico
- [x] Sistema de permisos básico

### Fase 1: MVP Funcional (4-6 semanas)
**Objetivo**: DAW funcional con transporte, tracks, clips de audio y comandos básicos.

- [x] Proyectos: crear, guardar, cargar
- [x] Transporte: play, pause, stop, seek
- [x] Tracks: crear, eliminar, renombrar, mutear, solear
- [x] Clips de audio: crear, mover, redimensionar, eliminar
- [x] Mixer básico: volumen, panorámica
- [x] Timeline visual básica
- [x] Command Palette (Ctrl+Shift+P)
- [x] Undo/Redo funcional
- [x] Integración básica con IA (chat + herramientas de lectura)

### Fase 2: Audio Real (3-4 semanas)
**Objetivo**: Motor de audio nativo y reproducción real.

- [ ] Motor de audio en C++ (audio thread)
- [ ] Reproducción de audio real
- [ ] Metrónomo
- [ ] Análisis de audio (peak, RMS, LUFS)
- [ ] FX chain básico (compresor, EQ)
- [ ] Routing básico (sends, buses)

### Fase 3: IA Profunda (3-4 semanas)
**Objetivo**: IA como colaborador musical real.

- [ ] Niveles 4-5 del Context Manager
- [ ] Memory Manager completo
- [ ] Planner para secuencias complejas
- [ ] Transacciones atómicas
- [ ] Validación avanzada
- [ ] Dry run para IA
- [ ] Sugerencias proactivas

### Fase 4: Madurez (4-6 semanas)
**Objetivo**: DAW usable para producción real.

- [ ] Edición MIDI
- [ ] Instrumentos virtuales
- [ ] Automatización
- [ ] Render/exportación
- [ ] Sistema de plugins completo
- [ ] Presets
- [ ] Macros y scripting
- [ ] UI pulida (themes, layouts guardados)

## 6. Orden de Prioridad de Implementación

1. **Event Bus**: Sin esto, nada puede comunicarse.
2. **Modelo de Estado**: Sin estado centralizado, no hay consistencia.
3. **Command System**: Sin esto, no hay forma segura de mutar el estado.
4. **Validación**: Sin validación, la IA puede corromper el proyecto.
5. **AI Provider Abstraction**: Permite iterar en la IA independientemente.
6. **Context Manager (niveles 1-3)**: Necesario para que la IA entienda el proyecto.
7. **Tool Registry**: Conecta la IA con el Command System.
8. **Permisos**: Necesario antes de permitir que la IA escriba.
9. **UI básica**: Necesaria para interactuar visualmente.
10. **Motor de audio**: Último porque el core lógico puede funcionar sin él.

## 7. Filosofía

- **Correctitud > Rendimiento > Características**: Un DAW que crashea o corrompe proyectos no sirve.
- **IA como capa, no dependencia**: El DAW debe funcionar perfectamente sin IA.
- **Determinismo**: El DAW es determinista; la IA es probabilística. La ejecución de herramientas es determinista.
- **Auto-descripción**: El DAW debe poder describirse a sí mismo para modelos desconocidos.
