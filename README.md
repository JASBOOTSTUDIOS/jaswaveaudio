# JasWave

DAW (Digital Audio Workstation) **AI-first** — Electron + React + Vite, con dominio compartido en TypeScript.

Repositorio: [JASBOOTSTUDIOS/jaswaveaudio](https://github.com/JASBOOTSTUDIOS/jaswaveaudio)

## Qué incluye

- Timeline / arrange, mixer, transporte, metrónomo
- Piano roll MIDI (edición, snap, velocity, expression lanes)
- Reproducción de clips de audio + notas MIDI (synth interno)
- Co-producer / agente IA conectado al estado del DAW
- Workspace con paneles dockables y ventanas flotantes
- Persistencia de sesión (proyecto + buffers en IndexedDB)

## Estructura

```
jaswaveaudio/
├── shared/       # @jaswave/shared — estado, comandos, eventos, MIDI, IA
├── jas-wave/     # App Electron + React + Tailwind
├── docs/         # Arquitectura, hoja de ruta, ADRs
├── AGENTS.md     # Guía para agentes de código
└── package.json  # Scripts del monorepo
```

## Requisitos

- Node.js 20+ (recomendado)
- npm

## Instalación

```bash
# Dependencias de la UI
cd jas-wave
npm install

# Dependencias de la librería compartida
cd ../shared
npm install
```

## Desarrollo

Desde la raíz:

```bash
npm run dev
```

O directamente:

```bash
cd jas-wave
npm run dev          # Electron + Vite
npm run web:dev      # Solo navegador (Vite)
```

## Scripts útiles

| Comando | Dónde | Descripción |
|--------|--------|-------------|
| `npm run dev` | raíz / `jas-wave` | App en desarrollo |
| `npm run build` | raíz / `jas-wave` | Build UI + Electron |
| `npm run lint` | raíz / `jas-wave` | ESLint |
| `npm test` | raíz / `shared` | Tests Vitest |
| `npm run typecheck` | raíz / `shared` | Typecheck shared |

```bash
cd shared && npm test
cd jas-wave && npm run build
```

## Documentación

- [`docs/HOJA-RUTA.md`](docs/HOJA-RUTA.md) — roadmap
- [`docs/00-RESUMEN-ARQUITECTURA.md`](docs/00-RESUMEN-ARQUITECTURA.md) — visión general
- [`docs/midi-piano-roll-ai.md`](docs/midi-piano-roll-ai.md) — MIDI / piano roll AI-first
- [`AGENTS.md`](AGENTS.md) — convenciones para agentes

## Licencia

Proyecto privado de JASBOOT STUDIOS. Todos los derechos reservados salvo indicación contraria.
