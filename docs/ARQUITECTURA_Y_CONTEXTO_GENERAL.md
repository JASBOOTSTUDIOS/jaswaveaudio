# JasWave DAW — Especificación Integral de Arquitectura, Tecnologías y Estado del Proyecto

> **Documento Maestro:** Contexto General, Arquitectura de Sistemas, Pila Tecnológica y Hoja de Ruta  
> **Versión:** 4.5 (Fase de Producción y Robustez Agéntica)  
> **Repositorio:** `jaswave-ia`  
> **Fecha de Actualización:** Octubre 2026  

---

## 1. Visión y Propósito del Proyecto

### 1.1. ¿Qué es JasWave?
**JasWave** es una Estación de Trabajo de Audio Digital (**DAW - Digital Audio Workstation**) moderna, profesional y nativa para escritorio (Windows), concebida bajo el paradigma **"AI-First"**. 

A diferencia de los DAWs tradicionales (donde la IA es un plugin externo o un simple generador de texto) o de las herramientas web de generación por prompts (donde el usuario no tiene control sobre las pistas individuales), JasWave combina:
1. **Un DAW completo de grado profesional:** Edición en línea de tiempo (Arrangement), vista de mezcla (Mixer), editor de notas (Piano Roll), automatizaciones, soporte de instrumentos y procesadores VST3/VST2 y motor de audio de baja latencia.
2. **Un Equipo Agéntico de Producción Musical Integrado:** Un conjunto de agentes de inteligencia artificial coordinados (**Director**, **Productor**, **Ingeniero de Mezcla**, **Ingeniero de Mastering** y **Auditor de Calidad QA**) que interactúan con el DAW a través de un catálogo tipado de herramientas y comandos canónicos, con capacidad de medir acústicamente la mezcla en tiempo real y ejecutar cambios deshacibles (*undo/redo*).

### 1.2. Principios Rectores de Diseño
* **La única fuente de verdad es el Estado de Dominio:** La interfaz visual (React) es únicamente una proyección reactiva del estado. La IA y el usuario operan sobre el mismo modelo canónico.
* **Toda mutación pasa por Comandos:** Ninguna parte de la UI o de la IA muta objetos directamente en memoria. Todo cambio emite un comando (`tienda.executor.execute`), garantizando auditoría completa, sincronización por eventos y una pila de *Deshacer/Rehacer* unificada.
* **Aislamiento Robusto de Procesos:** Un plugin VST inestable o mal programado jamás debe tumbar el DAW. Los plugins corren fuera del proceso principal (*Out-of-Process*).
* **Ingeniería basada en Evidencia Acústica:** El copiloto de mezcla no adivina; utiliza medición física real (LUFS integrado, True-Peak con sobremuestreo, espectro FFT en 31 bandas y correlación de fase) para diagnosticar problemas de audio antes de mover un fader o ecualizador.

---

## 2. Pila Tecnológica (Tech Stack)

El proyecto está estructurado como un monorepo TypeScript/C++ dividido en módulos especializados:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                   JASWAVE DAW                                    │
├──────────────────────────┬──────────────────────────┬────────────────────────────┤
│   CAPA DE PRESENTACIÓN   │    SISTEMA DE CONTROL    │      MOTOR DE AUDIO Y      │
│     (Renderer React)     │     (Electron Main)      │      HOST DE PLUGINS       │
├──────────────────────────┼──────────────────────────┼────────────────────────────┤
│ • React 19               │ • Electron 30+           │ • C++17 / C++20 Nativo     │
│ • TypeScript             │ • Node.js runtime        │ • Steinberg VST3 SDK       │
│ • Vite 5 (Bundler)       │ • IPC Bidireccional      │ • Wrapper VST2             │
│ • Tailwind CSS           │ • File System Guards     │ • CMake Build System       │
│ • Canvas 2D API          │ • Single-Instance Lock   │ • Out-of-Process Host      │
│ • Lucide Icons           │ • Agent Bridge (HTTP)    │ • Audio Engine WASAPI/ASIO │
└──────────────────────────┴──────────────────────────┴────────────────────────────┘
```

### 2.1. Frontend y Capa de Presentación (`jas-wave/src/`, `jas-wave/components/`)
* **React 19 + TypeScript:** Interfaz declarativa, modular y de alto rendimiento.
* **Tailwind CSS + Tokens de Audio:** Sistema de diseño oscuro para producción musical (*dark theme* con acentos funcionales ámbar, cian y esmeralda).
* **Renderizado de Alto Rendimiento:**
  * *Piano Roll:* Renderizado por Canvas 2D acelerado para gestionar miles de eventos de notas MIDI con respuesta inmediata y drag & drop sin lag.
  * *Stereo Waveforms:* Generación de formas de onda en tiempo real para clips de audio.
  * *Mixer Profesional:* Tiras de canal con faders analógicos calibrados, potenciómetros de paneo con captura de gestos y barras VU de nivel post-fader.

### 2.2. Proceso Principal y Entorno de Escritorio (`jas-wave/electron/`)
* **Electron:** Encargado del ciclo de vida de la ventana, menús nativos del sistema operativo, gestión de diálogos de archivo y canales de comunicación inter-proceso (IPC).
* **Confinamiento de Seguridad (`path-grants.ts`):** Sistema estricto de concesión de rutas. La app y la IA solo pueden leer y escribir dentro de las carpetas explícitamente autorizadas del proyecto o las carpetas de recursos VST del sistema.
* **Cuarentena y Crash-Loop Guard (`plugin-host-lifecycle.ts`):** Monitorea la estabilidad de los plugins de terceros. Si un plugin causa un fallo en el arranque o durante el procesamiento, se aparta automáticamente a cuarentena para proteger el trabajo del usuario.
* **Agent Bridge (`agent-bridge.ts`):** Servidor HTTP local autenticado por token que expone las capacidades del DAW a herramientas externas o scripts CLI (`daw-cli.mjs`).

### 2.3. Motor de Audio y Host Nativo C++ (`native/`)
* **`native/plugin-host/`:** Proceso binario independiente en C++ que aloja instancias de plugins VST3 y VST2. Se comunica con Electron mediante tuberías/sockets IPC de alta velocidad, aislando los hilos de audio en tiempo real de los ciclos de recolección de basura de JavaScript.
* **Plugins Propios Incluidos:**
  * `JasWaveRoles.vst3`: Instrumento multi-tímbrico propio optimizado para la IA.
  * `JasWavePiano.vst3`: Sintetizador de piano acústico modelado.
* **`native/audio-engine/`:** Motor de mezcla y enrutamiento PCM en tiempo real para salida a dispositivos Windows (WASAPI / ASIO).

### 2.4. Monorepo y Paquetes de Dominio
1. **`@jaswave/shared` (`shared/`):**
   * Núcleo agnóstico de UI.
   * Contiene la definición de tipos de datos (`Track`, `Clip`, `MidiNote`, `PluginInfo`, `DAWState`).
   * Motor de comandos (`CommandExecutor`), Event Bus, validador de invariantes de dominio y cálculo de diffs semánticos de estado.
   * Algoritmos de notas MIDI (`note-ops.ts`): cuantización, humanización, inversión, estiramiento temporal y **rasgueo de acordes (`strumNotes`)**.
   * Medición DSP acústica (`mix-analysis.ts`, `loudness-bs1770.ts`, `true-peak.ts`, `spectrum.ts`, `diagnosis.ts`).
2. **`@jaswave/ai-harness` (`ai-harness/`):**
   * Motor de IA headless que puede ejecutarse tanto dentro del DAW como en tests sin interfaz.
   * Orquestador del equipo multi-agente (`director`, `productor`, `mezcla`, `mastering`, `qa`).
   * Evaluación de planes estructurados (`plan.md`).
   * Catálogo de herramientas y política estricta de permisos de acciones (`action-policy.ts`).
3. **`jas-wave` (`jas-wave/`):**
   * Aplicación completa para el usuario final (Electron + React UI + CLI).

---

## 3. Diagrama Arquitectónico General

```
                              [ USUARIO / PRODUCTOR ]
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
         [ INTERFAZ GRÁFICA (UI) ]                   [ TERMINAL / CLI ]
         Arrangement, Mixer, Piano Roll              daw-cli.mjs (Turnos y Certificación)
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
   ══════════════════════════════════════════════════════════════════════════════════════
   CAPA DE DOMINIO Y CONTROL: @jaswave/shared & @jaswave/ai-harness
   ══════════════════════════════════════════════════════════════════════════════════════
     │  - Command Executor (tienda.executor.execute): Mutación pura y transicional
     │  - Event Bus Central: Emisión de eventos tipados de dominio
     │  - Undo/Redo Engine: Pila unificada de deshacer/rehacer con soporte de gestos
     │  - Equipo Multi-Agente IA (Director ∥ Productor ∥ Mezcla ∥ Mastering ∥ QA)
     │  - Motor de Análisis Acústico DSP (BS.1770 LUFS, True-Peak, Espectro Welch)
     │
     │ IPC Tipado (ContextBridge) / Sockets
     ▼
   ══════════════════════════════════════════════════════════════════════════════════════
   PROCESO PRINCIPAL DE ESCRITORIO: Electron Main
   ══════════════════════════════════════════════════════════════════════════════════════
     │  - Single-Instance Guard & Window Manager
     │  - Path Grants: Confinamiento seguro de lectura/escritura en disco
     │  - Watchdog de Estabilidad y Cuarentena de Plugins
     │  - Agent Bridge HTTP Server (Puerto local autenticado)
     │
     │ IPC de Alto Rendimiento (Named Pipes / Shared Memory)
     ▼
   ══════════════════════════════════════════════════════════════════════════════════════
   HOST DE AUDIO Y PLUGINS NATIVO (C++ Out-of-Process)
   ══════════════════════════════════════════════════════════════════════════════════════
     ├── VST3 Slot Manager (Carga y automatización de plugins de terceros y propios)
     ├── VST2 Compatibility Wrapper
     ├── Audio Thread de Prioridad en Tiempo Real (WASAPI / ASIO Driver)
     └── Render Backend para Análisis Acústico sin Bloqueo de UI
```

---

## 4. El Sistema Agéntico de Inteligencia Artificial

### 4.1. Del Monólogo al Equipo Multi-Agente (A6)
JasWave ha evolucionado de un modelo monolítico que interpretaba voces simultáneas a un **Equipo de Especialistas con Responsabilidades y Herramientas Aisladas**:

| Agente | Rol | Responsabilidad Principal | Herramientas Permitidas (`toolsForRole`) |
|---|---|---|---|
| **Director** | Planificador | Comprender el pedido del usuario, estructurar el archivo `plan.md`, asignar tareas y coordinar la sesión. | `plan.*`, `session.*`, `project.getSummary`, `track.list`, `doc.*` |
| **Productor** | Músico y Arreglista | Estructura armónica, progresión de acordes, notas MIDI, melodías, selección de instrumentos y dinámicas de interpretación. | `track.create`, `clip.*`, `midi.*`, `plugin.insert`, `daw.musicBuild`, `style.*` |
| **Mezcla** | Ingeniero de Mezcla | Gain staging (−18 dBFS RMS pre-fader), ecualización correctiva y tonal, compresión, paneo, buses y envíos de reverberación/delay. | `analysis.*`, `audit.mix`, `plugin.setParameter`, `send.set`, `bus.create`, `mix.*` |
| **Mastering** | Ingeniero de Mastering | Cadena del bus master, cumplimiento de estándares de sonoridad comercial (LUFS por plataforma), True-Peak y preservación de rango dinámico. | `analysis.*`, `reference.*`, `master.update`, `mix.limit`, `daw.masterPass`, `render.*` |
| **QA** | Auditor de Calidad | Verificación estricta de criterios técnicos con mediciones numéricas. Emite veredictos vinculantes de aprobación o rechazo. | **Solo lectura:** `analysis.*`, `audit.*`, `qa.verdict` (Nunca muta el proyecto) |

### 4.2. Los 5 Modos de Operación (A3)
1. **`auto`:** El agente evalúa la situación; si la tarea es sencilla ejecuta directamente, si es compleja elabora un plan estructurado.
2. **`ask`:** Modo de solo lectura y consulta pedagógica. Responde dudas sobre teoría musical, mezcla o estado del proyecto sin aplicar ninguna modificación.
3. **`plan`:** Diseña un plan de trabajo detallado paso a paso en Markdown con casillas de verificación y criterios de aceptación medibles antes de tocar una sola pista.
4. **`create`:** Modo de producción activa: ejecuta las acciones propuestas directamente en el DAW.
5. **`think`:** Razonamiento profundo multi-paso para resolver problemas de mezcla complejos o análisis armónico antes de emitir cambios.

### 4.3. Motor de Medición y Diagnóstico DSP Acústico (A7a / A7b)
El DAW incluye un motor de análisis acústico con estándares de la industria que procesa buffers de audio reales:
* **Loudness BS.1770-4:** Cálculo exacto de LUFS integrado, Short-Term, Momentary y Loudness Range (LRA).
* **True-Peak:** Detección de picos inter-sample con sobremuestreo 4x para evitar distorsión analógica tras la conversión D/A.
* **Espectro Welch de 31 Bandas:** División en tercios de octava para evaluar balance espectral tonal.
* **Diagnóstico Experto de Mezcla (`diagnosis.ts`):**
  * *Detección de Barro:* Alerta sobre acumulación excesiva de energía entre 200 y 500 Hz identificando las pistas causantes.
  * *Detección de Aspereza:* Resonancias estridentes entre 2 y 5 kHz.
  * *Matriz de Enmascaramiento:* Detección de frecuencias en conflicto entre pares de pistas (ej. Bombo vs Bajo en 60 Hz).
  * *Correlación Estéreo:* Monitoreo de fase (-1 a +1) y cálculo de pérdida de nivel en reproducción mono.

### 4.4. Actuación con Valores Reales (A7c)
* **Valores físicos:** Soporte de parámetros en unidades legibles de ingeniería (`-18 dB`, `3.2 kHz`, `Q 1.4`, `ratio 4:1`, `attack 30 ms`) mediante `parsePhysicalValue` y perfiles semánticos (`processor-profiles.json`).
* **Humanización Orgánica:** Algoritmo `strumNotes` para rasgueo natural de guitarras acústicas y teclados, rompiendo la rigidez mecánica de los acordes en bloque.

---

## 5. Estado Actual de Desarrollo (Workstreams y Progreso)

El proyecto se rige por la matriz oficial de workstreams documentada en [`docs/plans/STATUS.md`](docs/plans/STATUS.md):

| ID | Workstream | Alcance Técnico | Estado Actual | Verificación |
|---|---|---|---|---|
| **U1** | Cambios sin guardar | Diálogo de confirmación, prevención de pérdida de datos al cerrar. | **Hecho** | Tests en verde |
| **U2** | Undo limpio | Pila unificada de deshacer/rehacer basada en comandos atómicos. | **Hecho** | Tests en verde |
| **U3** | Validación de dominio | Validación estricta de pistas, límites de clips y tipos de audio. | **Hecho** | Tests en verde |
| **U4** | Media y archivos | Gestión de archivos huérfanos, guardado de proyecto y rutas relativas. | **Hecho** | Tests en verde |
| **U5** | Atajos y foco | Gestión de eventos de teclado, foco de ventanas y accesibilidad. | **Hecho** | Tests en verde |
| **U6** | Transporte y grabación | Robustez de motor de reproducción, grabación de tomas y bloqueo en bounce. | **Hecho** | Tests en verde |
| **U7** | Instancia única | Single-instance lock en Electron y sincronización de ventanas satélite. | **Hecho** | Tests en verde |
| **A1** | Motor headless | Motor de turnos decoupled de la interfaz gráfica. | **Hecho** | Tests en verde |
| **A2** | Tool-calling nativo | Protocolo de herramientas tipadas y proveedor mock determinista. | **Hecho** | Tests en verde |
| **A3** | Los 5 modos | Implementación de `auto`, `ask`, `plan`, `create`, `think`. | **Hecho** | Tests en verde |
| **A4** | Plan estructurado | Generación y sincronización de `plan.md` editable con el DAW. | **Hecho** | Tests en verde |
| **A5** | Ejecución hasta terminar | Bucle autónomo de reparación y avance de pasos del plan. | **Hecho** | Tests en verde |
| **A6** | Equipo multi-agente | Registro de especialistas (`director`, `productor`, `mezcla`, `mastering`, `qa`). | **En curso** (Registry + Prompts + Tests completados) | 7/7 tests aprobados |
| **A7a** | Medición DSP | Loudness BS.1770, True-Peak, Crest factor y espectro Welch. | **Hecho** | Tests en verde |
| **A7b** | Análisis por pista | Stems PCM, referencia A/B y diagnóstico de mezclas. | **Hecho** | Tests en verde |
| **A7c** | Valores reales | Parámetros físicos (dB/Hz), `processor-profiles.json` y `strumNotes`. | **En curso** | Tests aprobados |
| **A7d** | FX propios JasWave | Procesadores nativos en C++ (JasWave EQ, Compresor, Limitador). | Pendiente | — |
| **A7e** | MasterPass y Mezcla | Calibración automática de mezcla por stems y mastering por medición. | Pendiente | — |
| **A8** | CLI del agente | Endpoints en `agent-bridge.ts` y ejecución de turnos en `daw-cli.mjs`. | Pendiente | — |
| **A9** | Auditoría y progreso | Bitácora de turnos estructurada y timeline de eventos. | **Hecho** | Tests en verde |
| **A10** | Workspace FS & Terminal | Creación de estructuras completas en disco y comandos de terminal. | **Especificado** | Plan listo |

---

## 6. Evolución Futura: JasWave como Entorno de Producción Estilo IDE

JasWave está incorporando patrones de diseño probados en los entornos de desarrollo modernos (IDEs como Cursor, Antigravity y VS Code), documentados en [`PROPUESTA_SKILLS_Y_PATRONES_IDE.md`](docs/ia/PROPUESTA_SKILLS_Y_PATRONES_IDE.md):

1. **Gestión de Proyectos por Carpetas (Workspace Folders):**
   * El proyecto deja de ser un archivo binario aislado; es una carpeta abierta en el sistema operativo donde conviven `project.jaswave`, carpetas de stems `audio/`, archivos de notas `clips/*.mid`, documentación `docs/` y reglas locales `.jaswaverules`.
2. **Explorador de Archivos Contextual (Project File Tree):**
   * Panel lateral estilo IDE que renderiza y previsualiza archivos según su naturaleza (hacer clic en un `.wav` reproduce su forma de onda al instante; hacer clic en un `.mid` abre el Piano Roll; hacer clic en un `.md` abre el editor de texto).
3. **Audio Linter en Tiempo Real:**
   * Diagnóstico continuo en segundo plano que alerta sobre problemas antes del renderizado (cancelaciones de fase estéreo, faders en saturación peligrosa o frecuencias enmascaradas).
4. **Sistema Modular de Skills Musicales:**
   * Carpetas con directrices técnicas por género (`skills/worship-moderno/`, `skills/trap-808/`) que cargan presets, voicings y cadenas de procesamiento adaptadas al estilo.
5. **Visor de Cambios Acústicos ("Audio Git Diff"):**
   * Tarjeta visual que muestra la comparación antes/después de cada propuesta (curvas de EQ y notas añadidas) con aprobación quirúrgica pista por pista.

---

## 7. Estructura de Directorios del Código Fuente

```
jaswave-ia/
├── shared/                       # Biblioteca @jaswave/shared (Dominio puro)
│   ├── src/
│   │   ├── types/                # Modelos de datos TypeScript (pista, clip, nota, plugin)
│   │   ├── state/                # Command executor, transiciones, macros, undo/redo
│   │   ├── events/               # Event Bus y eventos de dominio
│   │   ├── commands/             # Definiciones canónicas de comandos (dominio y plugins)
│   │   ├── audio/                # Algoritmos DSP: loudness, espectro, true-peak, diagnosis
│   │   ├── midi/                 # note-ops (cuantización, humanización, strumNotes)
│   │   └── test/                 # Suites de pruebas con Vitest
│
├── ai-harness/                   # Biblioteca @jaswave/ai-harness (Motor de IA)
│   ├── src/
│   │   ├── agents/               # Equipo Multi-Agente A6: registry, tipos, prompts del sistema
│   │   ├── agent/                # Modos (A3), políticas de acciones y permisos
│   │   ├── loop/                 # Harness de ejecución y avance hasta terminar (A5)
│   │   ├── plan/                 # Evaluación de plan.md frente al estado del DAW (A4)
│   │   ├── audit/                # Bitácora estructurada y seguimiento de eventos (A9)
│   │   └── test/                 # Suites de pruebas del motor de IA
│
├── jas-wave/                     # Aplicación Principal Electron + React
│   ├── electron/                 # Proceso Main, Preload, Path Grants, Plugin Guard, Bridge
│   ├── src/                      # UI React (App, Contextos de DAW y Workspace, Hooks)
│   ├── components/               # Componentes visuales:
│   │   ├── arrangement/          # Línea de tiempo, cabeceras de pista y clips
│   │   ├── mixer.tsx             # Mezclador profesional con tiras de canal y faders
│   │   ├── piano-roll.tsx        # Editor de notas MIDI en Canvas 2D
│   │   ├── coproducer-panel.tsx  # Panel conversacional y timeline de agentes
│   │   ├── daw-terminal-panel.tsx# Terminal integrada del DAW
│   │   └── ui/controls.tsx       # Faders calibrados, knobs de paneo y barras de nivel
│   ├── lib/                      # Audio engine, conversiones dB/lineal, transport clock
│   └── cli/                      # daw-cli.mjs y suites de certificación automatizada
│
├── native/                       # Código Fuente Nativo en C++
│   ├── plugin-host/              # Host de plugins Out-of-Process (VST3/VST2)
│   ├── jaswave-roles-vst/        # Plugin de instrumento propio JasWave Roles
│   ├── piano-synth/              # Plugin de instrumento propio JasWave Piano
│   └── audio-engine/             # Motor de mezcla y enrutamiento PCM en tiempo real
│
└── docs/                         # Documentación de Arquitectura, Manuales y Planes
    ├── plans/                    # Planes ejecutables de producción (STATUS.md, PROTOCOL.md)
    ├── ia/                       # Arquitectura agéntica y propuesta de Skills / IDE
    └── decisiones/               # Registros de decisiones de arquitectura (ADRs)
```

---

## 8. Verificación, Compilación y Comandos de Desarrollo

El proyecto cuenta con certificación estricta en cada uno de sus paquetes. Desde la raíz de `jaswave-ia`:

```bash
# 1. Instalación de dependencias en todos los paquetes
npm run install:all

# 2. Verificación global completa (Linter + Typecheck + Tests en los 3 paquetes)
npm run verify

# 3. Compilación de producción (Renderer React + Proceso Main de Electron)
npm run build

# 4. Pruebas unitarias por paquete independiente
cd shared && npm test              # Tests de dominio y DSP (Vitest)
cd ai-harness && npm test          # Tests del motor de agentes (Vitest)
cd jas-wave && npm test            # Tests de la aplicación cliente (Node Test Runner)

# 5. Typecheck estricto de TypeScript
cd jas-wave && npm run typecheck

# 6. Certificación rápida por CLI (con la aplicación abierta o bridge activo)
node jas-wave/cli/daw-cli.mjs certify --quick
```

---

## 9. Arquitectura Microkernel y Ecosistema VST3 Bajo Demanda

Para evitar instaladores masivos ("bloatware"), JasWave implementa una arquitectura **Microkernel**:
1. **Núcleo Mínimo (Lean Installer < 60 MB):** El instalador únicamente incluye el motor de audio, el host de plugins, el bus de estado y el harness de IA.
2. **Descarga Just-In-Time (JIT):** Los plugins oficiales de procesamiento y mastering (`JasWaveParamEq`, `JasWaveBusCompressor`, `JasWaveTruePeakLimiter`) no se empaquetan dentro del instalador, sino que se descargan de forma modular y bajo demanda según el usuario o la IA los solicite.
3. **Compatibilidad Universal VST3:** Todos los plugins siguen rigurosamente el estándar Steinberg VST 3.7+ nativo con interfaz vectorial acelerada. Son 100% compatibles y utilizables en cualquier DAW del mercado (Cockos Reaper, Cubase, FL Studio, Ableton Live), pero ofrecen telemetría lock-free de audio en tiempo real optimizada cuando operan dentro de JasWave.
4. **Documentación Detallada:** Para consultar la especificación completa, diagramas de flujo y arquitectura interna, consultar [`docs/arquitectura/MICROKERNEL_Y_VST_ON_DEMAND.md`](docs/arquitectura/MICROKERNEL_Y_VST_ON_DEMAND.md).

---

## 10. Conclusión

JasWave se encuentra en la vanguardia de la intersección entre la **ingeniería de audio digital** y los **sistemas agénticos de inteligencia artificial**. Con una arquitectura desacoplada en tres niveles, un sistema de mutación estricto por comandos, análisis DSP real y un equipo de especialistas de IA con roles definidos, el proyecto proporciona la base técnica para una experiencia de producción musical donde la IA y el ser humano colaboran con precisión quirúrgica y musicalidad orgánica.
