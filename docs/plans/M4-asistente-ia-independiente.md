# M4 — Asistente IA (y Documentos) como paquetes independientes

**Depende de:** M2, M3 · **Estado:** ver STATUS.md

## Hecho

- [x] `plugins/com.jaswave.modulo.asistente-ia`: motor del agente, chat, tarjetas, progreso, ajustes de modelos
      («Mis modelos»), catálogo y transporte de IA (49 archivos fuera del DAW). Página de ajustes «IA», zoom del
      chat y herramienta destacada por contribución. 48 pruebas de contrato contra el DAW real.
- [x] `plugins/com.jaswave.modulo.documentos`: editor y explorador de docs/ con servicio `documentos` (lo usan el
      explorador de archivos del DAW y el asistente).
- [x] `plugins/lib/ui-markdown` (`@jaswave/ui-markdown`): Markdown + Mermaid compartido; Mermaid se carga por
      chunks solo al pintar un diagrama. `mermaid` deja de ser dependencia del DAW.
- [x] Núcleo sin código conversacional: zoom de UI propio (`ui-zoom.ts`), conversación activa (`conversacion-activa.ts`),
      tipos del puente de IA (`ia/proveedores.ts`), aclaraciones, `project-plan` y el motor de acciones
      (`executeDawActions`, catálogo, política) se quedan como API de automatización publicada en el SDK.
- [x] Puente de IA del escritorio para módulos (`api-escritorio-ia.ts`): gateway local, credenciales, ejecuciones
      del agente y log; modo de pruebas (`JASWAVE_AI_MOCK`) con proveedor simulado.
- [x] Herramientas: `extraer-modulo.mjs` (tipos inline, `.then`, re-exports, librerías, colisiones),
      `mover-tests.mjs`; verificador de independencia con `window.electron` y librerías.
- [x] Ventanas satélite y layouts aceptan herramientas de módulos aún no cargados.
- [x] e2e completo en Electron (38/38).

## Notas de traspaso

- El panel Admin → IA sigue en el núcleo (administra el backend) y reutiliza el formulario de proveedor del núcleo.
- Publicar en la web: `npm run build:modulos`, `node native/scripts/package-plugins.mjs`, POST del catálogo y
  `plugins/scripts/publicar-modulos-web.mjs`.
