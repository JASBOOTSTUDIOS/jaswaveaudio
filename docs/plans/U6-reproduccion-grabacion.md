# U6 · Operaciones durante reproducción, grabación y bounce

**Objetivo:** ninguna acción del usuario durante play/rec/bounce pierde tomas, cuelga el audio o corrompe el render.

## Contexto y hallazgos
- `project.new/load/close` no paran el transporte (`src/context/project-ready-context.tsx:128-141`); la finalización de grabación
  usa `trackIds` capturados al inicio e ignora el resultado de `clip.create` (`components/playback-provider.tsx:1128-1208`).
- `track.delete` no tiene guarda de pista armada/grabando ni limpia sends/sidechains/rutas (`shared/src/commands/domain-commands.ts`).
- Bounce: el host solo bloquea MIDI en vivo con `gOfflineRunning` (`native/plugin-host/src/main.cpp:825`); seek/play/`clip.schedule`/
  cambios de grafo o dispositivo durante el render comparten el reloj; Espacio y Ctrl+Z siguen activos bajo el modal
  (`components/export-bounce-dialog.tsx`); el host guarda todo el render en RAM (`main.cpp` ~2240).
- ASIO `kAsioResetRequest`/`BufferSizeChange`/`Resync` se reconocen pero no se actúa (`native/plugin-host/src/asio_output.cpp:345-349`);
  miniaudio sin callback de notificación (`audio_output.cpp:272`); `applyDevice` no para el transporte
  (`components/project-settings-dialog.tsx:675-739`).

## Tareas
- [x] `project-io.ts`: antes de nuevo/abrir/cerrar → parar transporte y finalizar toma (esperar a que se escriba el WAV).
- [x] Finalización de grabación: validar que la pista sigue existiendo; si no, crear pista "Toma recuperada" y avisar.
- [x] `track.delete`: rechazar si la pista está armada y grabando (mensaje claro); limpiar sends, sidechains y referencias de buses
      (y que su inverso los restaure).
- [x] Bounce: estado global `renderLock` en UI (deshabilita transporte, edición y atajos salvo Cancelar); el host rechaza
      `setTransport`, `clip.schedule`, `setTrackGraph`, `setAudioDevice` con `gOfflineRunning` (responder `RenderBusy`).
- [x] Render en streaming a disco en el host (escribir WAV por bloques en lugar de acumular `gOfflinePcm`) para renders largos.
- [x] Dispositivo: parar transporte antes de `setAudioDevice`; manejar `kAsioResetRequest`/`BufferSizeChange` en el host
      (reinicializar con el mismo dispositivo y notificar `audio-device-reset` por stderr→main→UI); miniaudio
      `ma_device_notification` → `device-lost`; UI muestra banner "Interfaz desconectada · Reintentar".
- [x] Tests: unit de guardas; e2e: grabar (si hay entrada) o simular finalización con pista borrada; bounce con Espacio pulsado
      no altera el resultado.

## Archivos
`jas-wave/src/lib/project-io.ts`, `src/context/project-ready-context.tsx`, `components/{playback-provider,export-bounce-dialog,project-settings-dialog}.tsx`,
`src/lib/bounce-service.ts`, `shared/src/commands/domain-commands.ts`, `native/plugin-host/src/{main.cpp,asio_output.cpp,audio_output.cpp}`,
`electron/plugin-host-bridge.ts`.

## Verificación
`npm run verify`; `npm run native:build`; e2e; certificación CLI (`daw-cli certify --quick`).

## Notas de traspaso

Estado: **hecho** (rama `ws/u4-u7`, 2026-10-22). Último commit: `0e65119`.

Commits del workstream: `7a7e985` (guarda de `track.delete` + limpieza de ruteo), `8c881a0` (la toma en curso se escribe antes de
cambiar de proyecto), `dc011e7` (`renderLock` en la UI), `d0b55da` (el dispositivo solo cambia con el transporte detenido),
`25add02` (WAV en streaming + `RenderBusy` en el host), `be0bdd8` (avisos de reset y pérdida del dispositivo),
`463a63e` (bloqueo del ejecutor durante el bounce), `fcdf2ae` (el bloqueo cubre todos los bounce), `7a5df35` (la IA/CLI detienen
el transporte al crear un proyecto), `0e65119` (e2e de U6).

Decisiones:
- El bloqueo del bounce es **global** (`jas-wave/src/lib/render-lock.ts`) y lo activa `runNativeBounce`, de modo que cubre
  diálogo, IA/CLI, `master-pass` y `track-freeze`. La guardia (`render-lock-guard.ts`) sustituye `tienda.executor.execute` y
  responde `RenderBusy` con "Hay un bounce en curso: no se puede editar el proyecto.".
  Se permiten los prefijos `render.`, `analysis.`, `ui.`, `selection.`, `atajos.` y `project.save`.
- El host escribe el WAV **por bloques** a disco (`main.cpp`): la cabecera se parchea al finalizar, así un render largo no
  acumula el PCM en RAM y un fallo de escritura borra el parcial (un `renderOfflineCancel` posterior ya no toca el WAV final).
- El reset ASIO **no** se ejecuta dentro del callback del driver: se marca con `gResetPending` y el hilo principal lo aplica
  con `jaswave_audio_start(st.cfg, err)` (misma configuración) al recibir `WM_JASWAVE_JOB`.
- La pérdida del dispositivo (miniaudio) y el reset ASIO viajan por stderr → `electron/plugin-host-bridge.ts` →
  IPC `jaswave-audio-device-notice` → banner "Interfaz desconectada · Reintentar" (o "Interfaz reiniciada por el driver").
- `project.new` desde la IA/CLI llama a `detenerTransporteYFinalizarGrabacion` (el menú ya lo hacía): sin esto el transporte
  seguía sonando con el proyecto nuevo.

Piezas nuevas:
- `jas-wave/src/lib/render-lock.ts`, `render-lock-guard.ts` (+ tests) y `jas-wave/electron/audio-device-notice.ts` (+ test).
- `jas-wave/components/audio-device-banner.tsx` (banner de dispositivo) y `jas-wave/e2e/11-reproduccion-grabacion.spec.ts`.
- `jas-wave/src/lib/recording-session.ts`: `iniciarFinalizacionGrabacion`, `cerrarFinalizacionGrabacion`,
  `hayGrabacionActiva`, `esperarFinalizacionGrabacion`, `_reiniciarSesionGrabacion`.

Gotchas para quien siga:
- El estado del bridge expone `grabacion` (`inactiva|armada|grabando|pausada`): sin él el e2e no puede distinguir "no hay
  entrada" de "la captura falló".
- En el E2E, `project.new` con cambios sin guardar **se queda esperando** en el diálogo "Cambios sin guardar": hay que
  pulsar `data-testid="unsaved-discard"` o la acción nunca termina.
- El e2e de grabación se auto-calibra (toma de control): si el entorno no tiene entrada utilizable (el host nativo posee el
  dispositivo y Chromium no puede capturar) el test se omite; en CI sin audio se considera omitido, no fallido.
- La app en modo dev (`JASWAVE_E2E_TARGET=dev`) necesita `npm run build` y `npm run stage:host` antes del e2e.
