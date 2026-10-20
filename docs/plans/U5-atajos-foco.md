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
- [ ] Dispatcher global: ignorar eventos con `e.defaultPrevented`.
- [ ] Piano roll, score editor, automation lanes, inspector: `stopPropagation()` en toda tecla que manejan.
- [ ] Revisar mapeo Enter: una sola acción (stop o toggle, no ambas).
- [ ] Rueda sobre BPM/compás solo con el control enfocado o con Alt; en otro caso se deja pasar el scroll.
- [ ] Tests (node:test o e2e): Delete en piano roll borra notas y el clip sigue; Enter una sola vez.

## Archivos
`hooks/use-shortcut-dispatcher.ts`, `shared/src/actions/action-system.ts`, `components/{piano-roll,transport-bar}.tsx`,
`components/score-editor-panel.tsx`, `components/automation-lanes-panel.tsx`.

## Verificación
`npm run verify`; e2e: abrir piano roll de un clip, seleccionar nota, Delete → clip existe.

## Notas de traspaso
_(vacío)_
