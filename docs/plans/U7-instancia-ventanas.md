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
- [ ] `main.ts`: `requestSingleInstanceLock()`; en `second-instance` enfocar la ventana y abrir el `.jaswave` recibido en argv
      (con el guard de U1). Manejar `open-file`/argv al arrancar (asociación de archivos).
- [ ] Satélites: no ejecutar comandos localmente; enviar `{type,payload}` al primario y aplicar solo el estado que este difunde;
      undo/redo/guardar/abrir en satélite → reenviar al primario.
- [ ] Cuarentena: solo si la salida ocurre con un `load`/`prepare` de ese plugin **en curso** (pendiente RPC) o dentro de su
      primer bloque de proceso; registrar motivo en el log.
- [ ] Crash-loop: en vez de rendirse, mostrar en UI "El motor de audio se reinició varias veces · Reiniciar motor" (IPC
      `plugin-host-reset` que limpia el contador y reinicia sin cargar plugins, luego recarga uno a uno).
- [ ] Conflicto en disco: guardar `mtime` al cargar/guardar; al guardar, si el archivo cambió → diálogo "El archivo cambió en
      disco: Sobrescribir / Guardar como / Cancelar".
- [ ] Tests: unit del detector de cuarentena y del chequeo de mtime; e2e: lanzar segunda instancia → no abre otra ventana.

## Archivos
`jas-wave/electron/{main,plugin-host-bridge}.ts`, `components/multi-window-sync.tsx`, `src/lib/project-io.ts`,
`shared/src/state/validacion-conflictos.ts`.

## Verificación
`npm run verify`; e2e.

## Notas de traspaso
_(vacío)_
