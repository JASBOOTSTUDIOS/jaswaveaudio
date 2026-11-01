# U7 · Instancia única, ventanas satélite y conflictos

**Objetivo:** dos instancias o dos ventanas nunca se pisan el proyecto, el dispositivo de audio ni la sesión.

## Contexto y hallazgos
- No se llama `app.requestSingleInstanceLock()` en `jas-wave/electron/` → dos instancias comparten IndexedDB/sesión, pelean por el ASIO
  exclusivo y pueden guardar el mismo `.jaswave` (último gana; chequeo de disco lleno es un stub en
  `shared/src/state/validacion-conflictos.ts:49-56`).
- Satélites (undock) ejecutan comandos localmente y los reenvían (`components/multi-window-sync.tsx:95-103`); undo/redo no se reenvía
  (`:87-92`); ids generados localmente difieren del primario; Ctrl+S en satélite guarda estado "slim" sin waveforms (`:12-30`).
- Cuarentena de plugins: cualquier salida del host en los 20 s tras un `load` pone en cuarentena ese plugin aunque la causa sea otra
  (`electron/plugin-host-bridge.ts` ~745-753); tras 4 crashes en 60 s el host no vuelve hasta reiniciar la app (~806-811).

## Tareas
- [x] `main.ts`: `requestSingleInstanceLock()`; en `second-instance` enfocar la ventana y abrir el `.jaswave` recibido en argv
      (con el guard de U1). Manejar `open-file`/argv al arrancar (asociación de archivos).
- [x] Satélites: no ejecutar comandos localmente; enviar `{type,payload}` al primario y aplicar solo el estado que este difunde;
      undo/redo/guardar/abrir en satélite → reenviar al primario.
- [x] Cuarentena: solo si la salida ocurre con un `load`/`prepare` de ese plugin **en curso** (pendiente RPC) o dentro de su
      primer bloque de proceso; registrar motivo en el log.
- [x] Crash-loop: en vez de rendirse, mostrar en UI "El motor de audio se reinició varias veces · Reiniciar motor" (IPC
      `plugin-host-reset` que limpia el contador y reinicia sin cargar plugins, luego recarga uno a uno).
- [x] Conflicto en disco: guardar `mtime` al cargar/guardar; al guardar, si el archivo cambió → diálogo "El archivo cambió en
      disco: Sobrescribir / Guardar como / Cancelar".
- [x] Tests: unit del detector de cuarentena y del chequeo de mtime; e2e: lanzar segunda instancia → no abre otra ventana.

## Archivos
`jas-wave/electron/{main,preload,instancia-unica,crash-loop,quarantine,plugin-host-bridge}.ts`,
`jas-wave/src/workspace/{multi-window-sync,satellite-channel}.tsx|ts`, `jas-wave/src/lib/{project-io,project-conflict,save-conflict}.ts`,
`jas-wave/components/{open-project-request,save-conflict-dialog,plugin-host-crash-loop-banner}.tsx`,
`shared/src/project/conflicto-disco.ts`, `jas-wave/e2e/{12-instancia-unica,13-conflicto-disco,14-satelite-autoridad}.spec.ts`.

## Verificación
`npm run verify`; e2e.

## Notas de traspaso

Estado: **hecho** (rama `ws/u4-u7`, 2026-10-22). Último commit: `8678198`.

Commits del workstream: `cefb102` (instancia única + apertura del proyecto recibido), `7348a5d` (conflicto por `mtime` en disco),
`75f5e21` (cuarenta con motivo + banner "Reiniciar motor"), `e056b86` (el reinicio del host no arrastra el contador de cargas),
`8678198` (los satélites no ejecutan comandos: los reenvían al primario).

Decisiones:
- **Instancia única**: `requestSingleInstanceLock()` en el main; la segunda instancia cede el foco y se cierra con código 0. El
  proyecto recibido en argv (o `open-file`) se entrega al renderer por `project-take-pending` y se abre con la guarda de cambios
  sin guardar de U1 (`components/open-project-request.tsx`).
- **Conflicto en disco**: la firma es `mtimeMs` + `size` (`shared/src/project/conflicto-disco.ts`). Si no hay firma conocida o el
  archivo no existe, no hay conflicto. El alcance es de sesión: la firma se refresca al cargar y al guardar.
- **Cuarentena**: solo culpa a un plugin si el host muere con su `load`/`prepare` en curso (motivo `carga-en-curso`) o dentro de
  su primer bloque en ese proceso (5 s, motivo `primer-bloque`). En otro caso el log dice "sin cuarentena: la muerte del host no
  es atribuible a un plugin" (antes se culpaba al último plugin cargado).
- **Crash-loop**: 4 salidas en 60 s → banner "El motor de audio se reinició varias veces · Reiniciar motor". El reinicio limpia el
  contador, reinicia el host **sin cargar plugins** (el ciclo de vida los recarga uno a uno tras `plugin-host-restarted`).
- **Satélites**: canal `BroadcastChannel('jaswave-daw-sync-v1')`. El satélite sobrescribe `execute`/`undo`/`redo` para reenviar y
  devuelve `result: { reenviadoAlPrimario: true }`; aplica solo el estado que difunde el primario (recorte sin waveforms). Guardar,
  guardar como y abrir se delegan al primario (`src/lib/project-io.ts`), que es el único con el estado completo.

