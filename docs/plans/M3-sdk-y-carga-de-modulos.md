# M3 — SDK de host y carga de módulos en tiempo de ejecución

**Depende de:** M1, D1 · **Estado:** ver STATUS.md

## Objetivo

Que las herramientas instalables del DAW (asistente IA, partitura, MIDI·MD, terceros) sean paquetes
independientes en `plugins/`, que el DAW descarga, verifica y carga sin contener su código.

## Hecho

- [x] `plugins/sdk/host-sdk` (`@jaswave/host-sdk`): contrato (`definirModulo`, herramientas, menús de clip,
      ajustes, globales, zoom), runtime (`__JASWAVE_SDK__`), shims de React, build de módulos (`vite.ts`),
      tema Tailwind compartido (`tema.css`), pruebas de contrato con el host real (`pruebas/`).
- [x] Host: `src/modulos/{api-host,sdk-host,registro-modulos,cargador,arranque,contribuciones}.ts`; catálogo de
      herramientas dinámico (`registrarHerramienta`), layout que conserva herramientas de módulos aún no
      cargados; ToolHost, rail, menús y pestañas con iconos de módulos; panel «Módulos» con catálogo.
- [x] Generador `jas-wave/scripts/generar-sdk.mjs` (tipos del host + `host-api.generated.ts`, `--comprobar`).
- [x] Electron: protocolo `jaswave-modulo://` (hash por petición), instalador de paquetes de módulo, CSP.
- [x] Backend: catálogo con `categoria/plataformas/descripcion/ui/uiEstilos/archivos`, `ArchivoModulo`,
      `POST /catalogo/modulos/:id/:version/archivos` (admin, inmutable), `GET /modulos/:id/:version/*`.
- [x] Empaquetado (`native/scripts/package-plugins.mjs`) y publicación web (`plugins/scripts/publicar-modulos-web.mjs`).
- [x] `plugins/scripts/extraer-modulo.mjs` (mueve archivos y reescribe imports al SDK) y
      `plugins/scripts/verificar-independencia.mjs` (en `npm run verify`).
- [x] Piloto: `plugins/com.jaswave.modulo.midi-md` (MIDI·MD), e2e `16-modulos`.

## Verificación

- `npm run verify` (incluye `verify:modulos`), `npm run build:modulos`.
- `jas-wave`: `electron/plugins/protocolo-modulos.test.ts`, `src/modulos/*.test.ts`, e2e 15 y 16.
- `backend`: `test/integracion/catalogo.int.test.ts` (módulos web).

## Notas de traspaso

- Nueva API para módulos = añadir a `api-host.ts` y `npm run sdk:generar` (o usar `extraer-modulo.mjs`).
- `plugins/` es un workspace npm propio (`npm ci --prefix plugins`).
