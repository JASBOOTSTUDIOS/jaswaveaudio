# Estructura del Proyecto Jaswave

## 1. Estructura de Directorios (Monorepo)

```
jaswave/
├── .kilo/                    # Configuración de Kilo
├── docs/                     # Documentación arquitectónica
│   ├── 00-RESUMEN-ARQUITECTURA.md
│   ├── HOJA-RUTA.md
│   ├── GLOSARIO.md
│   ├── ESPECIFICACION-API.md
│   ├── ESTRUCTURA-PROYECTO.md
│   ├── arquitectura/         # Documentación de arquitectura core
│   ├── ia/                   # Documentación del sistema de IA
│   ├── audio/                # Documentación del motor de audio
│   ├── interfaz/             # Documentación de la interfaz
│   ├── concurrencia/         # Documentación de modelo de threading
│   ├── electron/             # Documentación de arquitectura Electron
│   ├── pruebas/              # Estrategia de pruebas
│   ├── decisiones/           # Architecture Decision Records (ADRs)
│   └── hoja-ruta/            # Documentos detallados por tarea
│
├── electron/                 # UI Electron + React (frontend)
│   ├── src/
│   │   ├── main/             # Proceso principal de Electron
│   │   │   ├── index.ts
│   │   │   ├── ipc/
│   │   │   │   ├── handlers/ # Manejadores de IPC
│   │   │   │   └── channels.ts
│   │   │   ├── services/
│   │   │   │   ├── project.service.ts
│   │   │   │   ├── audio.service.ts
│   │   │   │   └── ai.service.ts
│   │   │   └── native-bridge/ # Puente hacia motor nativo
│   │   │       └── bridge.ts
│   │   ├── preload/          # Script de preload
│   │   │   └── index.ts
│   │   └── renderer/         # App React
│   │       ├── index.tsx
│   │       ├── app/
│   │       │   ├── components/
│   │       │   ├── panels/
│   │       │   ├── hooks/
│   │       │   ├── stores/
│   │       │   └── styles/
│   │       └── utils/
│   └── package.json
│
├── core/                     # Lógica de dominio pura
│   ├── src/
│   │   ├── events/           # Event Bus
│   │   │   ├── domain-event.ts
│   │   │   ├── event-bus.ts
│   │   │   ├── replay-buffer.ts
│   │   │   ├── subscription.ts
│   │   │   └── event-bus.test.ts
│   │   ├── state/            # DAWState, serialización
│   │   ├── commands/         # Command System, undo/redo
│   │   ├── validation/       # Pipeline de validación
│   │   ├── types/            # Tipos base del dominio
│   │   ├── constants/        # Constantes
│   │   └── index.ts
│   └── package.json
│
├── ai-harness/               # Capa de IA
│   ├── src/
│   │   ├── harness/          # AI Harness principal
│   │   ├── providers/        # Adaptadores de proveedores
│   │   ├── context/          # Context Manager
│   │   ├── memory/           # Memory Manager
│   │   ├── tools/            # Tool Registry
│   │   ├── permissions/      # Permissions
│   │   └── index.ts
│   └── package.json
│
├── audio-engine/             # Motor de audio nativo (C++)
│   ├── src/
│   │   ├── engine/           # Audio thread, DSP
│   │   ├── dsp/              # Procesamiento de señal
│   │   ├── io/               # Audio I/O
│   │   ├── plugins/          # Plugin host
│   │   ├── analysis/         # Análisis de audio
│   │   └── bindings/         # Bindings C/FFI
│   ├── include/              # Headers C++
│   ├── Cargo.toml            # Build con cargo (wrapper C++/C++)
│   └── CMakeLists.txt        # Build nativo C++
│
├── native-bridge/            # FFI / IPC entre Electron y audio-engine
│   ├── src/
│   │   └── bridge.ts         # Wrapper TypeScript del bridge nativo
│   └── package.json
│
├── plugin-system/            # Sistema de plugins del DAW
│   ├── src/
│   │   ├── scanner/          # Escáner de plugins
│   │   ├── host/             # Plugin host abstraction
│   │   ├── preset-manager/   # Presets
│   │   └── formats/          # VST3/AU/LV2 wrappers
│   └── package.json
│
└── shared/                   # Contratos compartidos entre packages
    ├── src/
    │   ├── types/            # Tipos comunes
    │   ├── constants/        # Constantes
    │   ├── schemas/          # JSON Schemas
    │   └── index.ts
    └── package.json
```

## 2. Packages

### electron/
Frontend de Electron + React. Contiene proceso principal, preload y renderer.

### core/
Lógica de dominio pura del DAW. Sin dependencias de frameworks. Contiene Event Bus, State Model, Command System, Validation.

### ai-harness/
Capa de inteligencia artificial. Contiene AI Harness, providers, context manager, memory manager, tool registry, permissions.

### audio-engine/
Motor de audio nativo en **C++**. Contiene audio thread, DSP, audio I/O, plugin host, análisis.

### native-bridge/
Puente FFI/IPC entre Electron y el audio-engine.

### plugin-system/
Sistema de plugins del DAW. Escáner, host, presets, formatos.

### shared/
Contratos compartidos entre packages. Solo tipos e interfaces estables.

## 3. Dependencias

```
electron → core, ai-harness, native-bridge
ai-harness → core
audio-engine → (ninguna, es nativo)
native-bridge → core
plugin-system → core, audio-engine
shared → (ninguna)
```

## 4. Desarrollo

Cada package es independiente y tiene su propio `package.json` o `Cargo.toml`. En el futuro, se puede usar pnpm workspaces o turborepo para coordinar builds.
