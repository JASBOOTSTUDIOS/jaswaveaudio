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
- [ ] `project-io.ts`: antes de nuevo/abrir/cerrar → parar transporte y finalizar toma (esperar a que se escriba el WAV).
- [ ] Finalización de grabación: validar que la pista sigue existiendo; si no, crear pista "Toma recuperada" y avisar.
- [ ] `track.delete`: rechazar si la pista está armada y grabando (mensaje claro); limpiar sends, sidechains y referencias de buses
      (y que su inverso los restaure).
- [ ] Bounce: estado global `renderLock` en UI (deshabilita transporte, edición y atajos salvo Cancelar); el host rechaza
      `setTransport`, `clip.schedule`, `setTrackGraph`, `setAudioDevice` con `gOfflineRunning` (responder `RenderBusy`).
- [ ] Render en streaming a disco en el host (escribir WAV por bloques en lugar de acumular `gOfflinePcm`) para renders largos.
- [ ] Dispositivo: parar transporte antes de `setAudioDevice`; manejar `kAsioResetRequest`/`BufferSizeChange` en el host
      (reinicializar con el mismo dispositivo y notificar `audio-device-reset` por stderr→main→UI); miniaudio
      `ma_device_notification` → `device-lost`; UI muestra banner "Interfaz desconectada · Reintentar".
- [ ] Tests: unit de guardas; e2e: grabar (si hay entrada) o simular finalización con pista borrada; bounce con Espacio pulsado
      no altera el resultado.

## Archivos
`jas-wave/src/lib/project-io.ts`, `src/context/project-ready-context.tsx`, `components/{playback-provider,export-bounce-dialog,project-settings-dialog}.tsx`,
`src/lib/bounce-service.ts`, `shared/src/commands/domain-commands.ts`, `native/plugin-host/src/{main.cpp,asio_output.cpp,audio_output.cpp}`,
`electron/plugin-host-bridge.ts`.

## Verificación
`npm run verify`; `npm run native:build`; e2e; certificación CLI (`daw-cli certify --quick`).

## Notas de traspaso
_(vacío)_
