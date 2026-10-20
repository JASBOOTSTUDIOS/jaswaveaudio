# U1 · Cambios sin guardar

**Objetivo:** que el usuario nunca pierda trabajo al cerrar la ventana, abrir otro proyecto o crear uno nuevo, y que guardar
dos veces seguidas no dispare dos diálogos ni dos guardados concurrentes.

## Contexto y hallazgos
- `jas-wave/electron/main.ts`: no hay `mainWindow.on('close')`; IPC `window-close` llama `mainWindow.close()` directo;
  `title-bar.tsx:58` lo usa. Solo hay un flush async a IndexedDB en `beforeunload` (`src/lib/session-persist.ts:441-445`)
  que además intenta snapshot de VST por RPC mientras `before-quit` para el plugin host.
- `abrirProyectoIO` (`src/lib/project-io.ts:79-88`) y `project.load` (`shared/src/commands/project-commands.ts:157-224`) no
  miran `modificado`. Afecta: Abrir de la barra, Ctrl+O (`hooks/use-shortcut-dispatcher.ts:221`), IA `project.load`
  (`src/lib/ai-daw-agent.ts`).
- Solo `nuevoProyectoIO` comprueba; muestra además un error nativo "Hay cambios sin guardar" (`hooks/use-file-service.ts:171`).
- IA `project.new` ejecuta el comando directo saltándose el chequeo (`ai-daw-agent.ts`).
- Ctrl+S sin guard de "en curso": `use-shortcut-dispatcher.ts:228-241` llama `guardarProyectoIO` directo; solo el hook de la
  barra tiene `loadingRef` (`use-file-service.ts:128`).

## Tareas
- [x] `main.ts`: `mainWindow.on('close', e)` → si no hay confirmación previa, `e.preventDefault()` y enviar
      `app-close-requested`; IPC `app-close-confirmed` (`createGuardedIpc`) marca permitido y cierra. Mismo flujo para
      `window-close` y para Alt+F4/menú Salir (`before-quit` → pedir confirmación si hay cambios).
- [x] Preload: `onAppCloseRequested(cb)` con unsubscribe, `confirmAppClose()`; tipos en `hooks/use-file-service.ts`.
- [x] Renderer: listener global (p. ej. en `src/context/daw-context.tsx` o un `components/app-close-guard.tsx`) que, si
      `project.modificado`, abre `ProjectCloseDialog` (reutilizar el de "nuevo proyecto") con Guardar / No guardar /
      Cancelar; Guardar → `guardarProyectoIO`; si se cancela el diálogo de guardar, no cerrar. Antes de cerrar: flush de
      sesión **sync-safe** (sin RPC al host).
- [x] `project-io.ts`: función `confirmarDescartarCambios(tienda)` reutilizada por nuevo/abrir/cerrar y por la IA.
      `abrirProyectoIO` y `nuevoProyectoIO` la usan; la IA (`project.new/load` en `ai-daw-agent.ts`) también (si hay cambios →
      devolver `needs-user` con confirmación, nunca descartar en silencio).
- [x] `requiereConfirmacion` deja de mostrarse como error nativo (`use-file-service.ts:171`).
- [x] Guard único de guardado en `project-io.ts` (promesa en curso compartida) usado por menú, atajo, barra y CLI;
      segundo Ctrl+S mientras guarda → espera la misma promesa.
- [x] Tests: unit de `confirmarDescartarCambios` y del guard de guardado (doble llamada = un solo guardado).
- [x] E2E (`jas-wave/e2e/`): modificar proyecto → cerrar ventana → aparece diálogo; "Cancelar" mantiene la app; "No guardar"
      cierra; abrir otro proyecto con cambios → diálogo.

## Archivos
`jas-wave/electron/main.ts`, `electron/preload.ts`, `hooks/use-file-service.ts`, `src/lib/project-io.ts`,
`hooks/use-shortcut-dispatcher.ts`, `components/title-bar.tsx`, `src/lib/ai-daw-agent.ts`, `src/lib/session-persist.ts`,
componente de diálogo existente (buscar `ProjectCloseDialog`).

## Criterios de aceptación
- Imposible cerrar/abrir/crear con cambios sin elegir explícitamente.
- La IA no puede descartar cambios sin confirmación del usuario.
- Doble Ctrl+S = un solo guardado y un solo diálogo.

## Verificación
`npm run verify`; `cd jas-wave && npm run build && npx electron-builder --win dir && npm run e2e`.

## Riesgos
- Bloquear el cierre si el renderer colgó: timeout (p. ej. 5 s) tras el cual main cierra igualmente tras guardar sesión.

## Notas de traspaso
- **Cierre de la app**: `electron/main.ts` (`closeGuard`, `CLOSE_ACK_TIMEOUT_MS = 5000`) retiene `close`/`window-close`/
  `before-quit` y envía `app-close-requested`; el renderer acusa recibo (`app-close-ack`) y responde
  `app-close-confirmed` (cierra) / `app-close-canceled` (sigue abierto), con remitente validado por `isMainWindowSender`.
  El listener vive en `components/app-close-guard.tsx` (montado en `src/App.tsx`) y hace flush de sesión sync-safe
  (`flushSessionForClose`, tope 3 s) antes de confirmar.
- **Confirmaciones**: `src/lib/project-guards.ts` → `solicitarEleccionCambios` / `confirmarDescartarCambios` /
  `conGuardadoUnico` (doble Ctrl+S = un guardado). El diálogo es `components/project-close-dialog.tsx`
  (`data-testid="unsaved-changes-dialog"`, botones `unsaved-save` / `unsaved-discard` / `unsaved-cancel`) con motivos
  `nuevo | abrir | cerrar | cerrar-app`; la IA (`ai-daw-agent.ts` `project.new/load`) pasa por ahí con `origen: 'ia'`.
- `use-shortcut-dispatcher.ts` ya no muestra error nativo si el guardado se canceló (`!r.success && !r.canceled`).
- Tests: unit `jas-wave/src/lib/project-guards.test.ts` (node:test); e2e `jas-wave/e2e/08-close-guard.spec.ts`
  (3 tests: diálogo + Cancelar, `project.new` de la IA con cambios, "No guardar" termina el proceso).
  Para e2e hace falta build: `npm run build` y
  `JASWAVE_E2E_TARGET=dev npx playwright test -c e2e/playwright.config.ts 08-close-guard.spec.ts`.
- U7 (instancia única y ventanas) debe engancharse a este mismo guard antes de tocar `app.quit()`.
