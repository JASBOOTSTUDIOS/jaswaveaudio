# U2 · Undo limpio y completo

**Objetivo:** Ctrl+Z siempre deshace la última edición real del usuario; nada invisible ensucia la pila; todo lo destructivo se
puede deshacer o pide confirmación.

## Contexto y hallazgos
- Autosave: `snapshotTrackPluginIntoProject` (`src/lib/plugin/track-vst-runtime.ts:933-962`) ejecuta `track.update {plugins}`
  por cada VST desde `saveSessionNow` (`src/lib/session-persist.ts:205-208`) cada ≤12 s tras cualquier cambio (incluido scroll).
  `track.update` es undoable y pone `modificado:true` (`shared/src/commands/domain-commands.ts`) → tras Ctrl+S el proyecto vuelve
  a "modificado", Ctrl+Z deshace snapshots invisibles y se borra el redo. El master usa `project.update {datos:{master}}` que
  **ignora `master`** (`shared/src/commands/auxiliary-commands.ts:381-402`) → el estado de plugins del master nunca se guarda.
- Transporte con inversos: `transport.toggle/seek/toggleRecord/toggleLoop/toggleMetronome` (`domain-commands.ts` ~2449/2512/2588)
  → Espacio, clic en timeline o Record generan entradas de undo; Ctrl+Z tras Play para la reproducción.
- Faders/knobs: cada `pointermove` ejecuta `track.update` (`components/mixer.tsx:194,200`, `hooks/use-drag-value.ts:43`); rueda
  sobre BPM ejecuta `project.setBpm` por tick (`components/transport-bar.tsx:134-139`). Pila limitada a 200
  (`shared/src/state/tienda.ts`, `pila-deshacer-rehacer.ts`).
- Sin inverso: `automation.clear/setCurve/writePoint`, `take.delete`, `comp.segment.*`, `project.update`,
  `project.setTimeSignature`, `master.update`, `marker.create`, `bus.create`, `send.set`, `sidechain.connect`,
  `track.freeze/unfreeze`. Sin confirmación: "Limpiar" automatización (`components/automation-lanes-panel.tsx:162`), presets de
  rampa (`:154`), borrar toma (`components/take-lanes-panel.tsx:156`), Ctrl+Delete borra pista
  (`shared/src/actions/catalog.ts:296`, `use-shortcut-dispatcher.ts:371`) sin la confirmación del menú contextual
  (`components/arrangement/ArrangementView.tsx:1215`).
- Copiar/pegar/duplicar pierden `clipInicio` (`use-shortcut-dispatcher.ts:85`; `clip.create` no lo acepta,
  `domain-commands.ts:983-996`); cortar/borrar múltiple = un `clip.delete` por clip (un undo cada uno).

## Tareas
- [x] Comando `track.snapshotPluginState` (y `master.snapshotPluginState`) **sin `inverseType` y sin tocar `modificado`**;
      `snapshotTrackPluginIntoProject` lo usa y solo si el estado cambió (comparar hash del blob). Master vía el nuevo comando.
- [x] Quitar `inverseType` de los comandos de transporte (`transport.*`, incluido `togglePunch/toggleCountIn`) y que no marquen
      `modificado` (salvo loop/metrónomo si se decide que son parte del proyecto: documentar la decisión).
- [x] Coalescencia en `shared/src/state/ejecutor-comandos.ts`: opción `{ coalesceKey, gestureId }` en `execute`; comandos con
      la misma clave dentro del mismo gesto se fusionan en una sola entrada (inverso = estado previo al primer comando).
      `use-drag-value.ts`/`mixer.tsx`/knobs generan `gestureId` en pointerdown y lo cierran en pointerup; rueda de BPM con ventana
      de 600 ms.
- [x] Inversos (patrón `inversePayload` con el valor previo, o snapshot parcial) para la lista de comandos sin inverso.
- [x] Confirmaciones: "Limpiar automatización", presets de rampa sobre curva existente, borrar toma, Ctrl+Delete de pista
      (reutilizar el diálogo del menú contextual).
- [x] `clip.create` acepta `clipInicio`; copiar/pegar/duplicar lo pasan; cortar y borrar múltiple usan `executor.batch`
      (una entrada de undo).
- [x] Tests (vitest en `shared/src/test/`): autosave no altera pila ni `modificado`; transporte no entra a la pila; 50 updates
      de un gesto = 1 undo; cada inverso nuevo hace round-trip; batch de borrado = 1 undo; `clipInicio` preservado.

## Archivos
`shared/src/state/ejecutor-comandos.ts`, `shared/src/commands/{domain,auxiliary,automation,routing,take}-commands.ts`,
`jas-wave/src/lib/plugin/track-vst-runtime.ts`, `src/lib/session-persist.ts`, `hooks/use-drag-value.ts`,
`components/{mixer,transport-bar,automation-lanes-panel,take-lanes-panel}.tsx`, `hooks/use-shortcut-dispatcher.ts`.

## Criterios de aceptación
- Tras guardar, el proyecto no vuelve a "modificado" sin edición real.
- Un arrastre de fader = 1 undo; Play/Stop/seek no están en la pila.
- Todas las operaciones listadas se deshacen o piden confirmación.

## Verificación
`npm run verify`; e2e: mover fader y Ctrl+Z restaura; Play + Ctrl+Z no para la reproducción.

## Notas de traspaso
- **Estado: HECHO (2026-10-20, Claude subagente en `hardening/production`).** Commits `5777b14`, `b684aee`, `1dc0d54`
  (sobre la infraestructura de `35e489d`).
- Autosave: `track.snapshotPluginState` / `master.snapshotPluginState` (`shared/src/commands/plugin-commands.ts`) con
  `historialUndo: 'ninguno'` y sin tocar `modificado`; `snapshotPluginSinCambios` evita ejecutar si el blob/parámetros no
  cambiaron (`src/lib/plugin/track-vst-runtime.ts`). El master ya guarda el estado de sus plugins.
- Transporte: todos los `transport.*` (incl. `stop`, `togglePunch`, `toggleCountIn`, `setRecordMode`) con
  `historialUndo: 'ninguno'`. **Decisión:** loop/metrónomo/punch/count-in son estado de sesión: no entran en la pila ni
  marcan `modificado` (se siguen guardando con el proyecto si cambian otras cosas).
- `historialUndo: 'instantanea'` en project.update, project.setTimeSignature, master.update, automation.setCurve/clear/
  writePoint, take.delete, take.rename, comp.segment.set/clear, marker.create (ahora marca `modificado`), bus.create,
  send.set, sidechain.connect, track.freeze/unfreeze.
- Gestos: `src/lib/gesture-id.ts` (`nuevoGestureId`, `crearVentanaGesto(600)`, `opcionesGesto`). `hooks/use-drag-value.ts`
  da `gestureId` por arrastre y por flechas seguidas; `FaderControl`/`KnobControl` lo propagan; mixer (pistas, master,
  envíos), inspector (`track-detail-panel.tsx`), rueda de BPM y de compás (`transport-bar.tsx`). Los puntos de
  automatización escritos durante un arrastre usan la misma clave → se deshacen con el fader. Auto-mix/aleatorio = 1 batch.
- Confirmaciones: `automation-lanes-panel.tsx` (Limpiar; preset sobre curva con puntos), `take-lanes-panel.tsx` (borrar
  toma), Ctrl+Delete vía `src/lib/track-delete-request.ts` → mismo `ConfirmDialog` del `ArrangementView` (respaldo
  `window.confirm`).
- `clip.create` acepta `clipInicio` (≥0). Pegar/duplicar/cortar/borrar múltiple: `src/lib/clip-edit-commands.ts` +
  `batchOrNotify` (`execute-or-toast.ts`) en `use-shortcut-dispatcher.ts` y `ClipContextMenu.tsx`; Ctrl+arrastrar duplicado
  del arrange también conserva `clipInicio`.
- Tests: `shared/src/test/undo-limpio.test.ts` (15), `jas-wave/src/lib/clip-edit-commands.test.ts`,
  `src/lib/gesture-id.test.ts`; e2e `jas-wave/e2e/09-undo-validacion.spec.ts`.
- Pendiente fuera de alcance: `take.add`/`take.folder.ensure` siguen sin undo (invalidan el redo); va con U6.
