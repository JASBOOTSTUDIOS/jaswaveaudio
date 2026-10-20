# U5 · Atajos y foco

**Objetivo:** un atajo actúa solo en el editor que tiene el foco; nunca dos acciones a la vez.

## Contexto y hallazgos
- El piano roll maneja Delete/Backspace en un listener de captura con `preventDefault` pero sin `stopPropagation`
  (`components/piano-roll.tsx` ~1282-1285); el dispatcher global (`hooks/use-shortcut-dispatcher.ts:622-645`,
  `shared/src/actions/action-system.ts:180`) no mira `defaultPrevented` → borrar notas también borra el clip en edición.
  Igual con Ctrl+D, Ctrl+A, `S` (split), flechas (cambia pista), Enter (stop + pause-toggle = vuelve a reproducir), Home.
- Rueda sobre BPM/compás cambia valores al hacer scroll (`components/transport-bar.tsx:131-143, 230-246`).
- Guardas de "escribiendo en input" correctas (`shared/src/actions/scope.ts:56-68`).

## Tareas
- [x] Dispatcher global: ignorar eventos con `e.defaultPrevented`.
- [x] Piano roll, score editor, automation lanes, inspector: `stopPropagation()` en toda tecla que manejan.
- [x] Revisar mapeo Enter: una sola acción (stop o toggle, no ambas).
- [x] Rueda sobre BPM/compás solo con el control enfocado o con Alt; en otro caso se deja pasar el scroll.
- [x] Tests (node:test o e2e): Delete en piano roll borra notas y el clip sigue; Enter una sola vez.

## Archivos
`hooks/use-shortcut-dispatcher.ts`, `shared/src/actions/action-system.ts`, `components/{piano-roll,transport-bar}.tsx`,
`components/score-editor-panel.tsx`, `components/automation-lanes-panel.tsx`.

## Verificación
`npm run verify`; e2e: abrir piano roll de un clip, seleccionar nota, Delete → clip existe.

## Notas de traspaso
- **Guard global**: `shared/src/actions/action-system.ts` (`handleKeyboardEvent` devuelve `false` si
  `e.defaultPrevented`) y `hooks/use-shortcut-dispatcher.ts` (mismo check al inicio del handler de window burbuja).
  Cualquier editor que maneje una tecla solo tiene que hacer `preventDefault()` (+ `stopPropagation` si corre en captura).
- **Piano roll**: el listener de captura en window (`components/piano-roll.tsx`, `onKeyHandled`) llama a `onKey` y hace
  `stopPropagation()` si `defaultPrevented` → el dispatcher global (burbuja) ni se entera. Cubre Delete/Backspace,
  Ctrl+A/D, flechas, Home, Enter, dígitos, letras sueltas.
- **Partitura** (`components/score-editor-panel.tsx`): `rootRef` + `tabIndex={0}` + foco en `onPointerDownCapture`,
  contexto = foco dentro de la raíz o undock `toolId === 'score-editor'`; listener pasó a captura con
  `preventDefault + stopPropagation` en Delete/Backspace.
- **Automation lanes e inspector**: verificado que no tienen handlers de teclado → no se tocó nada.
- **Enter**: único binding global `Enter → transport.pause` (`shared/src/actions/catalog.ts:28`); con el piano roll
  enfocado manda su `transport.stop` local y el global queda cancelado. `components/ui/confirm-dialog.tsx` pasó a fase
  de captura para que Enter/Escape del diálogo se resuelvan antes que el dispatcher.
- **Rueda**: `components/transport-bar.tsx` — `EditableStat` y `TimeSigEditor` solo hacen `preventDefault` con Alt o
  con el control enfocado (div con `tabIndex={0}`); si no, la rueda se deja pasar al scroll. Mientras se edita el valor
  (`editingRef`) la rueda también se ignora.
- Tests: unit `shared/src/test/actions-system.test.ts` (4 tests: defaultPrevented, Enter = una acción); e2e
  `jas-wave/e2e/07-piano-roll-focus.spec.ts` (3 tests: Delete no borra el clip, Enter una sola vez, rueda BPM).
  E2E: `npm run build` y
  `JASWAVE_E2E_TARGET=dev npx playwright test -c e2e/playwright.config.ts 07-piano-roll-focus.spec.ts`.
