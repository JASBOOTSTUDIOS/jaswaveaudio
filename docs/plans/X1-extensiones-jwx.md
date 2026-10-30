# X1 — Extensiones `.jwx` instalables desde archivo (como los `.vsix` de VS Code)

**Depende de:** M3 (módulos en runtime), D1 (instalador y catálogo firmado).

## Qué es un `.jwx`

Un zip con:

- `jaswave-plugin.json` (manifiesto V5);
- su contenido: `dist/` (módulos del DAW) o `vst3/<Bundle>.vst3/` (plugins);
- `jaswave-firma.json` (opcional): `{ version: 1, id, versionPaquete, archivos: { ruta: sha256 }, firma }`.
  La firma es Ed25519 (la clave de JasWave, la del catálogo y las licencias) sobre `jwx1.` + JSON canónico de
  `{ id, version, archivos }`. `archivos` debe listar **exactamente** todo el paquete menos la propia firma.

## Cómo se instala

| Vía | Dónde |
|---|---|
| Doble clic sobre el `.jwx` | `electron-builder.cjs` (`fileAssociations` jwx y jaswave), `instancia-unica.ts` (`rutaExtensionDeArgv`), `main.ts` (`second-instance`, `open-file`, arranque) → evento `extension-abrir-solicitada` o `extension-pendiente` |
| Arrastrar el archivo a cualquier parte de la ventana | `components/modulos/instalador-extensiones.tsx` (`webUtils.getPathForFile` en el preload) |
| «Instalar desde archivo…» | `components/modulos/extensiones-instaladas.tsx` (diálogo nativo `plugins-elegir-jwx`) |

Siempre se muestra la ficha (nombre, versión, tipo, tamaño y estado de la firma) y el usuario confirma.

- **Firmado por JasWave** → «Instalar».
- **Sin firma o firma inválida** → bloqueado; con el **Modo desarrollador** activo, «Instalar sin firma» y queda
  marcado `desarrollo` («Sin firmar» en la lista). Activar el modo exige confirmar un diálogo nativo de main
  (`ajustes-fijar-modo-desarrollador`): ningún código del renderer ni de un módulo puede hacerlo solo.

## Instalador (`jas-wave/electron/plugins/instalador.ts`)

`abrirPaquete` es común al catálogo y al archivo: límite de 300 MB y 5000 entradas, cabecera zip, listado previo
con `tar -t` (sin rutas absolutas, con unidad ni `..`), extracción en temporal, rechazo de enlaces y de entradas
fuera de la carpeta, validación de id/versión, y verificación de la firma contra los hashes reales. Después,
`instalarExtraido` intercambia de forma atómica `dist/` o el bundle VST3 y escribe `instalacion.json` con el
**origen** (`catalogo`, `archivo-firmado`, `desarrollo`), que el escáner devuelve y el panel muestra.

`desinstalarPaquete` borra la carpeta del paquete y el bundle registrado, solo dentro de sus dos raíces
(`%LOCALAPPDATA%\JasWave\plugins` y `%LOCALAPPDATA%\Programs\Common\VST3\JasWave`). Solo se ofrece para paquetes
de la cuenta del usuario (`desinstalable`). Tras instalar o desinstalar se vuelve a escanear y plugins y módulos
aparecen o desaparecen sin reiniciar.

## Firma y empaquetado

- Backend: `POST /catalogo/firmar-paquete` (solo admin, auditado como `catalogo.firmar-paquete`). La clave
  privada nunca sale del servidor. Formato compartido: `backend/src/catalog/firma-paquete.ts` ↔
  `jas-wave/electron/plugins/firma-paquete.ts` (test de compatibilidad).
- `native/scripts/package-plugins.mjs` genera `<id>-<versión>.jwx`; con `--firmar --api <backend>` y
  `JASWAVE_ADMIN_TOKEN` los firma antes de comprimir. `plugins/scripts/firmar-jwx.mjs` firma `.jwx` ya creados.
- Las URLs de descarga de los manifiestos apuntan a `.jwx` (`sync-manifests.mjs`).
- Solo en el build de desarrollo, `JASWAVE_PRUEBAS_CLAVE_PUBLICA` añade una clave de pruebas (e2e).

## Verificación

- `electron/plugins/instalador.test.ts` (8): catálogo, `.jwx` firmado, otra clave / archivo extra / alterado /
  sin firma rechazados, modo desarrollador con confirmación, rutas peligrosas y manifiesto inválido, desinstalar.
- `electron/plugins/firma-paquete.test.ts` (3) y `electron/instancia-unica.test.ts` (argv).
- Backend: `test/integracion/catalogo.int.test.ts` (firma solo admin, rutas y hashes inválidos).
- e2e `e2e/18-extensiones-jwx.spec.ts` (4, `JASWAVE_E2E_TARGET=dev`): instalar firmado y usar su herramienta sin
  reiniciar, sin firma bloqueado y con modo desarrollador, doble clic (segunda instancia), desinstalar.

## Pendiente

- Web: «Instalar desde archivo» subiendo el `.jwx` al backend (`POST /extensiones`) para publicarlo en el
  catálogo privado del usuario (la CSP web no admite `blob:`).
- Comprobar a mano la asociación `.jwx` en un instalador NSIS real.
