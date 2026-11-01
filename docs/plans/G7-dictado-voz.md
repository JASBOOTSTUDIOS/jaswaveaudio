# G7 · Dictado por voz

**Objetivo:** dictar con el micrófono y ver el texto en tiempo real (provisional → final, sin duplicar), como el
teclado de Google en Android, en el Asistente IA, la paleta de comandos y las notas de pista. Especificación:
[`docs/hallazgos-recientes/plan_dictado_voz.md`](../hallazgos-recientes/plan_dictado_voz.md).

## Decisiones
- **Dos motores.** En Electron la Web Speech API de Chromium falla con `network` (sin claves de Google), así que el
  preferido es el **reconocedor local de Windows** (System.Speech, `es-ES` «MS-3082-80-DESK» instalado): main lanza
  `powershell.exe -EncodedCommand <script>` con `SpeechRecognitionEngine` + `DictationGrammar` +
  `SetInputToDefaultAudioDevice()` + `RecognizeAsync(Multiple)`, que escribe una línea JSON por evento en stdout
  (UTF-8): `listo`, `parcial` (SpeechHypothesized), `final` (SpeechRecognized), `error`, `fin`.
  Respaldo: Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, `interimResults`), la única en navegador.
- **Elección** (`src/lib/voice-dictation-core.ts`, `motoresDisponibles`): Electron → `windows` y después `web`;
  navegador → `web`. Si un motor no arranca se prueba el siguiente (salvo permiso/micrófono, que no dependen del
  motor). `network`, `sin-reconocedor`, `no-soportado`… descartan el motor para la sesión; sin motores el botón queda
  deshabilitado (icono MicOff) con el motivo en el título, sin romper la UI.
- **Sin duplicados:** el valor del campo se recalcula entero en cada resultado: ancla (lo escrito al pulsar) +
  finales + provisional (`componerTextoDictado`). Lo que el usuario teclee mientras dicta pasa a ser el ancla.
  El reconocedor capitaliza cada frase: a mitad de frase se quita la mayúscula (salvo siglas).
- **Modos:** «Solo transcribir» (por defecto) y «Dictar y enviar al pausar (2 s)» (solo donde hay `onAutoSubmit`:
  el asistente). Clic derecho o la flecha del botón eligen el modo; se recuerda en `localStorage`.
- **Un dictado a la vez** en toda la app (el reconocedor de Windows es uno): empezar otro para el anterior.
- **Chime** al empezar (600→900 Hz) y al parar (800→500 Hz) con Web Audio. El de inicio suena antes de abrir el
  micrófono para que el reconocedor no lo oiga.
- **Alt+V** (`ai.toggleVoiceDictation`, reasignable): campo enfocado → el que está escuchando (para pararlo) → el
  asistente (`isDefaultTarget`). Funciona también con el foco en campos de texto y con la paleta abierta (el
  dispatcher lo resuelve antes de esas guardas).
- **Notas de pista** por el mismo `track.update` que al teclear; los resultados de un dictado (pausas < 4 s) se
  agrupan en un solo deshacer (`crearVentanaGesto(4000)` + `coalesceKey`).

## Tareas
- [x] `shared/src/voice/voice-text-formatter.ts`: puntuación hablada (coma, punto, punto y coma, dos puntos,
  interrogación/exclamación con apertura ¿¡, punto y seguido/aparte, nueva línea/salto de línea, nuevo párrafo,
  puntos suspensivos), términos DAW (MIDI, VST, BPM, dB, EQ, Pan, LUFS…), espacios y mayúsculas; «punto de inicio»
  no se convierte. Exportado desde `shared/src/index.ts`.
- [x] `jas-wave/src/lib/audio-chime.ts`.
- [x] `electron/dictado-windows-parser.ts` (script, `-EncodedCommand`, parseo/troceo de stdout; la cultura se valida
  para que no se pueda inyectar en el script) y `electron/dictado-windows.ts` (`SesionDictadoWindows`).
  IPC en `electron/main.ts` (`dictado-disponible`, `dictado-iniciar`, `dictado-detener`; eventos `dictado-evento` al
  remitente; se suelta el micrófono al cerrar la ventana y en `will-quit`) y `preload.ts` (`window.electron.dictado`).
- [x] `src/lib/voice-dictation-core.ts` (motores, `ControladorDictado`, errores legibles, registro de Alt+V),
  `hooks/use-voice-dictation.ts` y `components/ui/voice-dictation-button.tsx`.
- [x] Atajo Alt+V en `shared/src/actions/catalog.ts` + despacho en `hooks/use-shortcut-dispatcher.ts`.
- [x] Integración: `api-host.ts` exporta `VoiceDictationButton`, `useVoiceDictation`, `componerTextoDictado`,
  `formatearTextoDictado` y tipos; SDK regenerado; el módulo del asistente usa el botón del host
  (`speech-to-text-button.tsx`; `coproducer-panel.tsx`: `onAutoSubmit → handleSendMessage(texto)` y foco al textarea);
  paleta de comandos y «Notas / comentario» del inspector.
- [ ] Probar el dictado real con micrófono en la app (Windows y, en navegador, Web Speech).

## Archivos
Nuevos: `shared/src/voice/voice-text-formatter.ts`, `shared/src/test/voice-text-formatter.test.ts`,
`jas-wave/electron/dictado-windows{,-parser}.ts`, `jas-wave/electron/dictado-windows-parser.test.ts`,
`jas-wave/src/lib/{audio-chime,voice-dictation-core}.ts`, `jas-wave/src/lib/voice-dictation-core.test.ts`,
`jas-wave/hooks/use-voice-dictation.ts`, `jas-wave/components/ui/voice-dictation-button.tsx`.
Modificados: `shared/src/index.ts`, `shared/src/actions/catalog.ts`, `jas-wave/electron/{main,preload}.ts`,
`jas-wave/hooks/{use-shortcut-dispatcher,use-file-service}.ts`, `jas-wave/components/{command-palette,track-detail-panel}.tsx`,
`jas-wave/src/modulos/api-host.ts`, `plugins/sdk/host-sdk/src/host-api.generated.ts` (generado),
`plugins/com.jaswave.modulo.asistente-ia/src/ui/{speech-to-text-button,coproducer-panel}.tsx`.

## Verificación
- `shared`: `npm test` (65 archivos, 735 tests; `voice-text-formatter.test.ts` 21) y `npm run typecheck` en verde.
- `ai-harness`: `npm test` (240) y `npm run typecheck` en verde.
- `jas-wave`: `npx tsc --noEmit -p tsconfig.json` y `-p tsconfig.electron.json` en verde; `npm run lint` sin errores
  (los warnings son previos); `npm test` 744 tests, 0 fallos (`dictado-windows-parser.test.ts` 11,
  `voice-dictation-core.test.ts` 14).
- Módulo del asistente: `npx tsc --noEmit` y `npm test` (48) en verde; `vite build` compilado a una carpeta temporal
  (no se tocó `dist/`). `plugins/sdk/host-sdk`: `tsc --noEmit` y vitest en verde; `node scripts/generar-sdk.mjs --comprobar` al día.
- Script de PowerShell probado aparte: imprime `listo` (es-ES, MS-3082-80-DESK) y sale solo al morir el padre.
  Con un WAV sintetizado en español (voz Helena, `SetInputToWaveFile`) emite parciales y finales con acentos
  correctos (`«la canción … está en mi menor»`) y `fin`.

## Notas de traspaso
- **Arranque del reconocedor de Windows:** 2–5 s en frío (PowerShell + System.Speech). Mientras, el botón muestra
  un spinner («Preparando el micrófono…»). Si molesta, precalentar un proceso en pausa o usar un ejecutable propio.
- **`Dispose()` del motor tarda >10 s:** por eso el script sale con `[Environment]::Exit(0)` y main detiene con
  `kill()`; el micrófono se libera al instante. El script además vigila el PID de main y sale si muere.
- **Calidad:** la DictationGrammar de Windows es la del sistema (sin entrenamiento): con voz sintética confundió
  «Mi menor» con «súper índice tres M». Pendiente valorar con voz real; alternativa futura: Whisper local.
- **Módulo del asistente:** su `dist/` no se reconstruyó (la app está abierta grabando). Hay que hacer
  `npm run build` en `plugins/com.jaswave.modulo.asistente-ia` y desplegarlo **junto con** el host nuevo: el SDK
  resuelve la API del host al cargar (`api('VoiceDictationButton')`), así que un módulo nuevo en un host viejo falla.
- **Permisos:** `installPermissionHandlers` ya permite `media`/`audioCapture` al renderer propio (Web Speech); el
  reconocedor de Windows usa el micrófono por defecto de Windows y depende de su permiso de privacidad.
- Pruebas manuales pendientes (plan, §5): dictado en el asistente (transcribir y auto-enviar), filtrar la paleta
  (Ctrl+Shift+P) dictando, nota de pista guardada y deshecha de una vez, Alt+V con y sin foco en un campo.
