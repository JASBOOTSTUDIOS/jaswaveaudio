# JasWave

DAW (Digital Audio Workstation) **AI-first** para Windows — Electron + React + Vite, con dominio
compartido en TypeScript y un host nativo de plugins VST3/VST2 en C++.

Repositorio: [JASBOOTSTUDIOS/jaswaveaudio](https://github.com/JASBOOTSTUDIOS/jaswaveaudio)

## Qué incluye

- Timeline / arrange, mixer, transporte, metrónomo
- Piano roll MIDI (edición, snap, velocity, expression lanes) y partitura
- Reproducción de clips de audio + notas MIDI (synth interno)
- Host de plugins VST3 / VST2 x64 fuera de proceso
- Co-producer / agente IA conectado al estado del DAW (proveedores en la nube u Ollama local)
- Workspace con paneles dockables y ventanas flotantes
- Persistencia de sesión (proyecto + buffers en IndexedDB)

## Estructura

```
jaswaveaudio/
├── shared/        # @jaswave/shared — estado, comandos, eventos, MIDI, IA
├── ai-harness/    # @jaswave/ai-harness — bucle IA, plan.md, modos y política del agente
├── jas-wave/      # App Electron + React + Tailwind (UI, main, CLI, empaquetado)
├── native/
│   ├── plugin-host/       # Host VST3/VST2 en C++ (proceso separado)
│   ├── jaswave-roles-vst/ # Instrumento VST3 propio "JasWave Roles"
│   ├── piano-synth/       # Instrumento VST3 de piano (JasWavePiano)
│   └── audio-engine/      # Addon N-API de audio (ADR-0009)
├── docs/          # Arquitectura, hoja de ruta, ADRs, legal, release
├── .github/       # CI (GitHub Actions)
├── AGENTS.md      # Guía para agentes de código
└── package.json   # Scripts del monorepo
```

## Requisitos

- **Windows 10/11 x64**
- **Node.js 22** (ver [`.nvmrc`](.nvmrc); `engines: >=22`) y npm
- Para compilar el código nativo (plugin host y plugins VST3):
  - **Visual Studio 2022 Build Tools** con la carga de trabajo "Desarrollo de escritorio con C++"
  - **CMake ≥ 3.25**
  - **Steinberg VST3 SDK** en la etiqueta `v3.8.1_build_84`, clonado en
    `native/plugin-host/third_party/vst3sdk` (no se versiona en este repositorio):

    ```bash
    git clone --branch v3.8.1_build_84 https://github.com/steinbergmedia/vst3sdk.git native/plugin-host/third_party/vst3sdk
    cd native/plugin-host/third_party/vst3sdk
    git submodule update --init base cmake pluginterfaces public.sdk
    ```

## Instalación

Desde la raíz:

```bash
npm run install:all   # npm ci en shared/, ai-harness/ y jas-wave/
```

## Desarrollo

```bash
npm run dev           # Electron + Vite (desde la raíz o desde jas-wave/)
```

En `jas-wave/` también: `npm run web:dev` (solo navegador) y `npm run cli -- <comando>`
(CLI del DAW; requiere el puente del agente activo).

## Verificación

```bash
npm run verify        # lint + typecheck + tests de los tres paquetes (lo mismo que CI)
npm run build         # build del renderer (Vite) + proceso main
```

| Comando (raíz) | Descripción |
|---|---|
| `npm run lint` | ESLint de `jas-wave` |
| `npm run typecheck` | Typecheck de `shared`, `ai-harness` y `jas-wave` |
| `npm test` | Tests de `shared` y `ai-harness` (Vitest) y `jas-wave` (node:test) |
| `npm run certify` | Certificación rápida vía CLI |

## Código nativo

Plugin host (ver [`native/plugin-host/README.md`](native/plugin-host/README.md)):

```bash
cd native/plugin-host
cmake -B build-vst3 -S . -G "Visual Studio 17 2022" -A x64 -DJASWAVE_VST3_SDK=ON -DSMTG_ENABLE_VSTGUI_SUPPORT=OFF -DSMTG_ENABLE_VST3_PLUGIN_EXAMPLES=OFF
cmake --build build-vst3 --config Release --target jaswave-plugin-host
```

Plugin propio JasWave Roles: `npm run native:roles-vst`.

## Empaquetado

```bash
npm run pack:win      # build + copia del plugin host + instalador NSIS
```

El instalador queda en `jas-wave/release/JasWave-Setup-<versión>.exe`. Requiere haber
compilado antes el plugin host. Proceso completo de publicación, firma y auto-actualización en
[`docs/RELEASE.md`](docs/RELEASE.md).

## Documentación

- [`docs/00-RESUMEN-ARQUITECTURA.md`](docs/00-RESUMEN-ARQUITECTURA.md) — visión general
- [`docs/HOJA-RUTA.md`](docs/HOJA-RUTA.md) — roadmap
- [`docs/CHECKLIST-PRODUCTO.md`](docs/CHECKLIST-PRODUCTO.md) — qué falta para terminar una canción aquí
- [`docs/decisiones/`](docs/decisiones/) — ADRs
- [`docs/RELEASE.md`](docs/RELEASE.md) — cómo publicar una versión
- [`CHANGELOG.md`](CHANGELOG.md) — cambios por versión
- [`SECURITY.md`](SECURITY.md) — reporte de vulnerabilidades y modelo de seguridad
- [`AGENTS.md`](AGENTS.md) — convenciones para agentes

## Legal

- [`LICENSE`](LICENSE) — software propietario de JASBOOTSTUDIOS. Todos los derechos reservados.
- [`docs/legal/EULA.md`](docs/legal/EULA.md) — acuerdo de licencia de usuario final (borrador)
- [`docs/legal/PRIVACIDAD.md`](docs/legal/PRIVACIDAD.md) — política de privacidad (borrador)
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — licencias de componentes de terceros
  (regenerar la sección npm con `npm run notices` en `jas-wave/`)

"VST" es una marca registrada de Steinberg Media Technologies GmbH.
