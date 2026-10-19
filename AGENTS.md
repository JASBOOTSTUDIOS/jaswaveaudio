# AGENTS.md — Instrucciones para Agentes de Código

> Leído automáticamente por agentes de código que trabajen en este proyecto.

## Arquitectura del proyecto

JasWave es un DAW (Digital Audio Workstation) basado en Electron + React + Vite, con host nativo de plugins (VST3/VST2) para Windows.

```
jaswave-ia/
├── shared/              # Biblioteca @jaswave/shared (TypeScript)
│   ├── src/types/       # Tipos del dominio
│   ├── src/events/      # Event bus + eventos de dominio
│   ├── src/state/       # Estado, validador, ejecutor, macros, undo/redo, permisos
│   ├── src/commands/    # Definiciones de comandos
│   ├── src/ai/          # Sistema de IA
│   └── src/test/        # Tests con Vitest
├── ai-harness/          # Biblioteca @jaswave/ai-harness (bucle IA + plan.md)
│   └── src/
│       ├── plan/        # evaluación plan.md ↔ DAW
│       ├── loop/        # harness de reparación, agent loop, cola de jobs
│       ├── agent/       # modos y política de acciones
│       └── ask/         # contexto solo lectura (consultas)
├── jas-wave/            # Aplicación (Electron + React + TS + Tailwind)
│   ├── electron/        # Proceso main, preload, IPC, puente al plugin host
│   ├── src/             # UI React: App, context, hooks, lib
│   ├── lib/             # Audio engine, transport clock
│   ├── components/      # Componentes UI
│   └── cli/             # CLI de control (daw-cli.mjs) y suites de certificación
├── native/              # C++: plugin-host, jaswave-roles-vst, piano-synth, audio-engine
└── docs/                # Arquitectura, ADRs (docs/decisiones), manual
```

## Verificación

Desde la raíz (Node según `.nvmrc`):

```bash
npm run install:all   # npm ci en shared, ai-harness y jas-wave
npm run verify        # lint + typecheck + tests de los tres paquetes
npm run build         # build de renderer + main
```

Por paquete: `npm test` / `npm run typecheck` dentro de `shared/`, `ai-harness/` o `jas-wave/`.
Los tests de `jas-wave` usan `node:test` (`tsx --test`); los de las librerías, Vitest.

CI (`.github/workflows/ci.yml`) ejecuta lint, typecheck, tests y build en cada PR.

## Convenciones

- Identificadores de dominio en español en `shared/` (p. ej. `pista`, `clip`, `tienda`).
- Toda mutación del proyecto pasa por comandos (`tienda.executor.execute`) para que exista undo y auditoría.
- Los scripts `jas-wave/cli/_*` son temporales y están ignorados por git salvo los ya versionados.
