# M1 — IA en la web y DAW modular

**Depende de:** B0, W1 · **Estado:** ver STATUS.md

## Objetivo

1. El asistente funciona igual en la web que en escritorio.
2. El asistente es una herramienta del DAW que se puede añadir, quitar y descargar: el DAW se organiza en
   un núcleo fijo y módulos opcionales.

## Hecho

- [x] Backend: gateway `/ia` (`backend/src/ia/`): `GET /ia/estado`, `POST /ia/chat`, `POST /ia/chat/stream` (SSE),
      `POST /ia/cancelar`. Proveedor, modelo y clave solo en el servidor (`IA_*` en `.env`); el cliente no elige
      host (sin SSRF); límite por usuario y por tokens. Tests: `backend/test/ia.test.ts`.
- [x] Renderer: `jas-wave/src/lib/ia/transporte-ia.ts`: Electron (IPC) si existe; si no, backend con el JWT de la
      sesión. Usado por `agent-engine-host.ts`, `agent-legacy-turn.ts`, `ai-settings.ts` (cancelar),
      `coproducer-panel.tsx` y ajustes de IA. En la web se hace un solo intento (el servidor elige modelo) y el
      selector de modelos locales se sustituye por «Modelo del servidor JasWave».
- [x] Registro de módulos `jas-wave/src/modulos/`: `registrarModulo`, activación persistida
      (`localStorage jaswave.modulos.v1`), descarga diferida con `import()` (chunk propio), reintento si falla.
      Módulos integrados: `asistente-ia` (coproducer, docs, docs-explorer, progress), `partitura`, `midi-md`.
- [x] Herramienta «Módulos» (`components/modulos/panel-modulos.tsx`): activar/desactivar y estado de descarga.
      Desactivar cierra sus herramientas; los menús solo listan herramientas disponibles; abrir una herramienta
      de un módulo inactivo muestra «Activar módulo».

## Verificación

- `npx tsx --test src/lib/ia/transporte-ia.test.ts src/modulos/registro-modulos.test.ts`
- En vivo (build web + backend con `IA_*` hacia un proveedor compatible con OpenAI): el asistente responde
  desde el navegador; desactivado, el chunk `coproducer-panel-*.js` no se descarga al recargar; al activarlo se
  descarga y el panel recupera la conversación.

## Pendiente

- Módulos de terceros cargados en runtime (`entrypoints.ui` del manifiesto P1): requiere catálogo firmado de
  módulos + verificación SHA-256 antes de `import()`, y CSP que lo permita. No se cargan URLs arbitrarias.
- Las librerías del agente (`agent-*`, `ai-daw-agent`) siguen en el chunk principal porque la CLI del DAW
  (`AgentAuditHost`, terminal) las usa; solo los paneles se separaron.

## Notas de traspaso

- Para producción: definir `IA_PROVEEDOR`, `IA_BASE_URL`, `IA_MODELO` (y `IA_API_KEY`, `IA_MODELOS`,
  `IA_PETICIONES_POR_MINUTO`, `IA_HERRAMIENTAS`) en `backend/.env`. Sin ellas `/ia/estado` responde
  `ia_no_configurada` y el panel lo muestra.
- El limitador es en memoria: con varias instancias del backend moverlo a Redis/BD.
