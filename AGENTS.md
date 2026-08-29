# AGENTS.md — Instrucciones para Agentes de Código

> Este archivo es leído automáticamente por Kilo y agentes de código que trabajen en este proyecto.

## Arquitectura del proyecto

JasWave es un DAW (Digital Audio Workstation) basado en Electron + React + Vite.

```
jaswave-ia/
├── shared/              # Biblioteca @jaswave/shared (TypeScript)
│   ├── src/types/       # Tipos del dominio
│   ├── src/events/      # Event bus + eventos de dominio
│   ├── src/state/       # Estado, validador, ejecutor, macros, undo/redo
│   ├── src/commands/    # Definiciones de comandos
│   ├── src/ai/          # Sistema de IA
│   └── src/test/        # Tests con Vitest
├── ai-harness/          # Biblioteca @jaswave/ai-harness (bucle IA + plan.md)
│   └── src/
│       ├── plan/        # evaluación plan.md ↔ DAW
│       ├── loop/        # harness de reparación + cola de jobs
│       ├── agent/       # modos y política de acciones
│       └── ask/         # contexto solo lectura (consultas)
├── jas-wave/            # Aplicación cliente (Electron + React + TS + Tailwind)
│   ├── src/             # UI React: App, context, hooks, lib
│   ├── lib/             # Audio engine, transport clock
│   └── components/      # Componentes UI
└── docs/                # Documentación de arquitectura
```

## Scripts de verificación

### Shared library
```bash
cd shared
npm test              # Vitest
npx tsc --noEmit      # Typecheck
```

### AI Harness library
```bash
cd ai-harness
npm test              # Vitest (harness + plan eval)
npx tsc --noEmit      # Typecheck
```

### Jas-wave UI
```bash
cd jas-wave
npm run lint          # ESLint
npm run build         # TypeScript build + Vite
```

## Sistema de coordinación multi-agente

Este proyecto usa un sistema de archivos compartidos en `.agents/` para coordinar agentes de código:

- `.agents/config.md` — Protocolo de coordinación (INSTRUCCIONES ÚNICAS)
- `.agents/tasks.json` — Tareas asignadas a cada agente
- `.agents/status.json` — Estado actual (actualización atómica)
- `.agents/messages/` — Canal de comunicación entre agentes
- `.agents/locks/` — Locks para prevenir conflictos de escritura

Ver `.agents/config.md` para el protocolo completo.

## Agentes disponibles

- **agent-a**: Biblioteca compartida (`shared/src/`) — Tests, estado, comandos, IA
- **agent-b**: Interfaz de usuario (`jas-wave/`) — Componentes React, hooks, context, audio UI

Ambos agentes están definidos en `.kilo/agent/`.
